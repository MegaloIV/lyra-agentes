// Gemini CLI por ACP (Agent Client Protocol, `gemini --acp`). Un proceso por agente.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { diffLines } from 'diff';
import type { Bloque, Comando, Detalle, InfoProveedor, Modelo, Op, PermissionMode, Sesion, Solicitud } from './protocolo.ts';
import { aplicarOps } from './protocolo.ts';
import { ClienteRpc } from './rpc.ts';
import { cadena, objeto, recortar, rutaRelativa } from './resumenes.ts';
import { bloqueUsuario, errorLegible, instalado, type Agente, type Contexto, type Motor, type Respuesta } from './motor.ts';

type P = Record<string, unknown>;
const legible = (t: string) => errorLegible(t, 'Gemini');

export const MODOS_GEMINI: InfoProveedor['modos'] = [
  { valor: 'default', nombre: 'Preguntar' },
  { valor: 'acceptEdits', nombre: 'Aceptar ediciones' },
  { valor: 'plan', nombre: 'Planificar' },
  { valor: 'bypassPermissions', nombre: 'Sin preguntar' },
];
const ID_MODO: Partial<Record<PermissionMode, string>> = { default: 'default', acceptEdits: 'autoEdit', plan: 'plan', bypassPermissions: 'yolo' };
const BANDERA_MODO: Partial<Record<PermissionMode, string>> = { default: 'default', acceptEdits: 'auto_edit', plan: 'plan', bypassPermissions: 'yolo' };
const modoDeId = (id: string): PermissionMode => (Object.entries(ID_MODO).find(([, v]) => v === id)?.[0] as PermissionMode) || 'default';

const DIR_ESTADO = process.env.LYRA_AGENTES_ESTADO || join(homedir(), '.local/state/lyra-agentes');
const REGISTRO = join(DIR_ESTADO, 'gemini-sesiones.json');

// ── Catálogo e historial ──────────────────────────────────────────────────────
/** Inició sesión con Google (o tiene clave) si quedaron credenciales guardadas */
/** Clave de API de AI Studio: en el entorno o en ~/.gemini/.env (Gemini CLI lee ese archivo solo) */
export function geminiConClave(): boolean {
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return true;
  try { return /^\s*(export\s+)?GEMINI_API_KEY\s*=\s*\S/m.test(readFileSync(join(homedir(), '.gemini/.env'), 'utf8')); } catch { return false; }
}
/** Solo cuenta la clave: Google ya no acepta Gemini CLI con cuentas personales, aunque deje guardada la sesión */
export function geminiConSesion(): boolean {
  return geminiConClave();
}

function listarModelos(): Promise<Modelo[]> {
  return new Promise(resolve => execFile('gemini', ['--list-models'], { timeout: 30000, cwd: homedir() }, (error, stdout) => {
    const modelos: Modelo[] = [];
    if (!error) for (const m of stdout.matchAll(/^(\S+) \(([^)]+)\)\s*\n(?:\s+Description:\s+(.+)\n)?/gm)) {
      modelos.push({ valor: m[1] === 'auto' ? null : m[1]!, nombre: m[1] === 'auto' ? 'Automático' : m[2]!, descripcion: m[1] === 'auto' ? 'Gemini CLI elige el modelo según la tarea' : m[3]?.trim() });
    }
    resolve(modelos.length ? modelos : [{ valor: null, nombre: 'Automático', descripcion: 'Gemini CLI elige el modelo' }]);
  }));
}

export async function infoGemini(): Promise<InfoProveedor> {
  const esta = instalado('gemini');
  return { id: 'gemini', nombre: 'Gemini', instalado: esta, sesion: esta && geminiConSesion(), modelos: esta ? await listarModelos() : [], modos: MODOS_GEMINI };
}

type Registro = { sessionId: string; cwd: string; titulo: string; modificado: number; renombrada?: boolean };
async function leerRegistro(): Promise<Registro[]> { try { return JSON.parse(await readFile(REGISTRO, 'utf8')); } catch { return []; } }
async function guardarEnRegistro(r: Registro) {
  const todas = await leerRegistro(), antes = todas.find(x => x.sessionId === r.sessionId);
  if (antes?.renombrada) { r.titulo = antes.titulo; r.renombrada = true; }   // el nombre que le diste no se pisa
  await escribirRegistro([r, ...todas.filter(x => x.sessionId !== r.sessionId)]);
}
async function escribirRegistro(lista: Registro[]) {
  await mkdir(DIR_ESTADO, { recursive: true, mode: 0o700 });
  await writeFile(REGISTRO, JSON.stringify(lista.slice(0, 300)), { mode: 0o600 });
}
export async function quitarDeRegistro(sessionId: string) { await escribirRegistro((await leerRegistro()).filter(x => x.sessionId !== sessionId)); }
export async function renombrarEnRegistro(sessionId: string, titulo: string) {
  const lista = await leerRegistro(), r = lista.find(x => x.sessionId === sessionId);
  if (!r) throw new Error('No se encontró esa conversación de Gemini.');
  r.titulo = titulo; r.renombrada = true; await escribirRegistro(lista);
}
/** Gemini no lista sus sesiones por ACP: se guardan las que se abren desde aquí */
export async function historialGemini(): Promise<Sesion[]> {
  return (await leerRegistro()).map(r => ({ proveedor: 'gemini' as const, sessionId: r.sessionId, titulo: r.titulo, cwd: r.cwd, modificado: r.modificado }));
}

// ── De las actualizaciones de ACP a bloques ──────────────────────────────────
const ICONOS: Record<string, string> = { read: 'leer', edit: 'editar', delete: 'editar', move: 'editar', search: 'buscar', execute: 'terminal', fetch: 'web', think: 'otro', switch_mode: 'plan', other: 'otro' };

function detalleGemini(contenido: unknown, entrada: P): Detalle | undefined {
  const partes = Array.isArray(contenido) ? contenido.map(objeto) : [];
  const diff = partes.find(c => c.type === 'diff');
  if (diff) return { clase: 'diff', ruta: cadena(diff.path), lineas: diffLines(cadena(diff.oldText), cadena(diff.newText)).flatMap(p => p.value.replace(/\n$/, '').split('\n').map(texto => ({ tipo: p.added ? '+' as const : p.removed ? '-' as const : ' ' as const, texto }))) };
  const textos = partes.filter(c => c.type === 'content').map(c => cadena(objeto(c.content).text)).filter(Boolean).join('\n\n');
  const comando = cadena(entrada.command);
  if (comando || textos) return { clase: 'codigo', lenguaje: comando ? 'bash' : undefined, texto: recortar([comando, textos].filter(Boolean).join('\n\n')) };
  return undefined;
}

export function crearNormalizadorGemini(cwd: string) {
  let serie = 0, texto: string | undefined, pensamiento: string | undefined;
  const herramientas = new Map<string, P>();
  const cortar = () => { texto = undefined; pensamiento = undefined; };
  return {
    turno() { serie++; cortar(); },
    /** Al terminar un turno: los textos abiertos se cierran */
    cerrar(bloques: Bloque[]): Op[] { cortar(); return bloques.filter(b => b.tipo === 'texto' && b.enCurso).map(b => ({ op: 'actualizar' as const, id: b.id, cambios: { enCurso: false } })); },
    procesar(u: P, bloques: Bloque[]): Op[] {
      const ops: Op[] = [], tipo = cadena(u.sessionUpdate), parte = cadena(objeto(u.content).text);
      switch (tipo) {
        case 'agent_message_chunk': {
          if (!parte) break;
          pensamiento = undefined;
          if (!texto) { texto = `g-t-${++serie}`; ops.push({ op: 'agregar', bloque: { tipo: 'texto', id: texto, md: '', enCurso: true } }); }
          ops.push({ op: 'delta', id: texto, md: parte });
          break;
        }
        case 'agent_thought_chunk': {
          if (!parte.trim()) break;
          if (texto) { ops.push({ op: 'actualizar', id: texto, cambios: { enCurso: false } }); texto = undefined; }
          if (!pensamiento) { pensamiento = `g-p-${++serie}`; ops.push({ op: 'agregar', bloque: { tipo: 'pensamiento', id: pensamiento, md: parte } }); }
          else { const b = bloques.find(x => x.id === pensamiento); ops.push({ op: 'actualizar', id: pensamiento, cambios: { md: (b && 'md' in b ? b.md : '') + '\n\n' + parte } }); }
          break;
        }
        case 'user_message_chunk': {   // solo al cargar una sesión guardada
          cortar();
          if (parte.trim()) ops.push({ op: 'agregar', bloque: { tipo: 'usuario', id: `g-u-${++serie}`, md: parte, fecha: 0 } });
          break;
        }
        case 'tool_call': case 'tool_call_update': {
          if (texto) ops.push({ op: 'actualizar', id: texto, cambios: { enCurso: false } });
          cortar();
          const id = cadena(u.toolCallId), previo = herramientas.get(id) || {}, h = { ...previo, ...Object.fromEntries(Object.entries(u).filter(([, v]) => v !== undefined && v !== null)) };
          herramientas.set(id, h);
          const kind = cadena(h.kind) || 'other', entrada = objeto(h.rawInput), ruta = cadena(objeto((Array.isArray(h.locations) ? h.locations : [])[0]).path);
          const relativa = ruta ? rutaRelativa(ruta, cwd) : '';
          const resumen = kind === 'read' && relativa ? `Leyó \`${relativa}\`` : kind === 'edit' && relativa ? `Editó \`${relativa}\`` : kind === 'execute' && cadena(entrada.command) ? `Ejecutó \`${cadena(entrada.command).slice(0, 80)}\`` : cadena(h.title) || 'Usó una herramienta';
          const estado = h.status === 'completed' ? 'ok' as const : h.status === 'failed' ? 'error' as const : 'corriendo' as const;
          const bloque: Extract<Bloque, { tipo: 'herramienta' }> = { tipo: 'herramienta', id: `g-h-${id}`, nombre: cadena(h.title) || kind, resumen, icono: ICONOS[kind] || 'otro', estado, entrada, detalle: detalleGemini(h.content, entrada) };
          ops.push(bloques.some(b => b.id === bloque.id) ? { op: 'actualizar', id: bloque.id, cambios: { resumen, estado, detalle: bloque.detalle, icono: bloque.icono } } : { op: 'agregar', bloque });
          break;
        }
        case 'plan': {
          const items = (Array.isArray(u.entries) ? u.entries.map(objeto) : []).map(e => ({ texto: cadena(e.content), estado: e.status === 'completed' ? 'hecha' as const : e.status === 'in_progress' ? 'en_curso' as const : 'pendiente' as const }));
          const id = `g-tareas-${serie}`;
          ops.push(bloques.some(b => b.id === id) ? { op: 'actualizar', id, cambios: { items } } : { op: 'agregar', bloque: { tipo: 'tareas', id, items } });
          break;
        }
      }
      return ops;
    },
  };
}

function argumentos(a: { modelo?: string; modo: PermissionMode }): string[] {
  const args = ['--acp', '--skip-trust'];
  if (a.modelo) args.push('--model', a.modelo);
  args.push('--approval-mode', BANDERA_MODO[a.modo] || 'default');
  return args;
}

async function abrirSesion(c: ClienteRpc, cwd: string, cargar?: string): Promise<P> {
  await c.pedir('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
  const pedir = () => cargar ? c.pedir<P>('session/load', { sessionId: cargar, cwd, mcpServers: [] }) : c.pedir<P>('session/new', { cwd, mcpServers: [] });
  try { return await pedir(); } catch (e) {
    if (!geminiConSesion()) throw new Error('Gemini todavía no tiene tu clave de API. Pulsa «Poner la clave» en el diálogo de nuevo agente.');
    // Hay credenciales guardadas pero esta sesión no las tomó: se le dice cuáles y se reintenta (la clave primero)
    await c.pedir('authenticate', { methodId: geminiConClave() ? 'gemini-api-key' : 'oauth-personal' });
    void e; return await pedir();
  }
}

/** Una sesión guardada, solo para leerla */
export async function cargarGemini(sessionId: string, cwd: string): Promise<Bloque[]> {
  const c = new ClienteRpc('gemini', argumentos({ modo: 'plan' }), { cwd, jsonrpc: true });
  const n = crearNormalizadorGemini(cwd); let bloques: Bloque[] = [];
  c.alAviso = (metodo, p) => { if (metodo === 'session/update') bloques = aplicarOps(bloques, n.procesar(objeto(p.update), bloques)); };
  try { await abrirSesion(c, cwd, sessionId); return aplicarOps(bloques, n.cerrar(bloques)); }
  finally { c.cerrar(); }
}

// ── Un agente de Gemini ───────────────────────────────────────────────────────
export class MotorGemini implements Motor {
  private c?: ClienteRpc;
  private sesion?: string;
  private ocupado = false;
  private cola: { texto: string; id: string }[] = [];
  private comandosDisponibles: Comando[] = [];
  private n: ReturnType<typeof crearNormalizadorGemini>;
  private cargando = false;
  private ctx: Contexto;
  private a: Agente;
  constructor(ctx: Contexto, a: Agente) {
    this.ctx = ctx; this.a = a; this.n = crearNormalizadorGemini(a.cwd); }

  iniciar() { void this.arrancar(); }

  private async arrancar() {
    const a = this.a, ctx = this.ctx;
    this.c?.cerrar();
    ctx.estado(a, 'iniciando');
    const c = new ClienteRpc('gemini', argumentos(a), { cwd: a.cwd, jsonrpc: true });
    this.c = c;
    c.alAviso = (metodo, p) => { if (metodo === 'session/update' && this.c === c) this.actualizar(objeto(p.update)); };
    c.alPedido = (metodo, p) => this.pedido(metodo, p);
    c.alCerrar = () => { if (this.c === c && !a.cerrado) { this.ocupado = false; ctx.fallo(a, new Error('Gemini se cerró.' + (c.stderr.trim() ? ' ' + c.stderr.trim().split('\n').at(-1) : '') + ' Puedes reanudar la sesión.')); } };
    try {
      // Al reanudar, Gemini vuelve a mandar toda la charla: el documento ya la tiene, así que se ignora
      this.cargando = !!a.sessionId;
      const r = await abrirSesion(c, a.cwd, a.sessionId);
      this.cargando = false;
      this.sesion = cadena(r.sessionId) || a.sessionId; a.sessionId = this.sesion;
      const modelos = objeto(r.models), modos = objeto(r.modes);
      if (cadena(modelos.currentModelId)) a.modelo = cadena(modelos.currentModelId);
      if (cadena(modos.currentModeId)) a.modo = modoDeId(cadena(modos.currentModeId));
      ctx.estado(a, 'listo');
      this.registrar();
      this.siguiente();
    } catch (e) { this.cargando = false; ctx.fallo(a, new Error(legible(e instanceof Error ? e.message : String(e)))); }
  }

  private registrar() { if (this.sesion) void guardarEnRegistro({ sessionId: this.sesion, cwd: this.a.cwd, titulo: this.a.titulo, modificado: Date.now() }).catch(() => {}); }

  private actualizar(u: P) {
    const a = this.a, ctx = this.ctx, tipo = cadena(u.sessionUpdate);
    if (tipo === 'available_commands_update') { this.comandosDisponibles = (Array.isArray(u.availableCommands) ? u.availableCommands.map(objeto) : []).map(c => ({ nombre: cadena(c.name), descripcion: cadena(c.description) })); return; }
    if (tipo === 'current_mode_update') { a.modo = modoDeId(cadena(u.currentModeId)); ctx.barra(); return; }
    if (tipo === 'usage_update') { if (typeof u.used === 'number' && typeof u.size === 'number') { a.contexto = { usados: u.used, total: u.size }; ctx.barra(); } return; }
    if (this.cargando) return;
    ctx.ops(a, this.n.procesar(u, a.bloques));
  }

  enviar(texto: string) {
    const ocupado = !this.sesion || this.ocupado, u = bloqueUsuario(texto, ocupado);
    this.ctx.ops(this.a, [{ op: 'agregar', bloque: u }]);
    if (this.a.titulo === 'Nuevo agente') { this.a.titulo = texto.slice(0, 60); this.registrar(); }
    this.cola.push({ texto, id: u.id });
    if (!ocupado) this.siguiente(); else this.ctx.barra();
  }

  private siguiente() {
    if (!this.sesion || this.ocupado || !this.cola.length || this.a.cerrado || !this.c) return;
    const { texto, id } = this.cola.shift()!, a = this.a, ctx = this.ctx, c = this.c, inicio = Date.now();
    this.ocupado = true; this.n.turno();
    ctx.ops(a, [{ op: 'actualizar', id, cambios: { enCola: false } }]);
    ctx.estado(a, 'trabajando');
    c.pedir<P>('session/prompt', { sessionId: this.sesion, prompt: [{ type: 'text', text: texto }] }).then(r => {
      const motivo = cadena(r.stopReason);
      ctx.ops(a, [...this.n.cerrar(a.bloques), { op: 'agregar', bloque: { tipo: 'fin', id: `fin-${id}`, duracionMs: Date.now() - inicio,
        error: motivo === 'cancelled' ? 'Se detuvo antes de terminar.' : motivo === 'refusal' ? 'Gemini se negó a continuar.' : motivo === 'max_tokens' ? 'Se cortó por largo.' : motivo === 'max_turn_requests' ? 'Llegó al máximo de pasos del turno.' : undefined } }]);
    }).catch(e => {
      ctx.ops(a, [...this.n.cerrar(a.bloques), { op: 'agregar', bloque: { tipo: 'fin', id: `fin-${id}`, duracionMs: Date.now() - inicio, error: legible(e instanceof Error ? e.message : String(e)) } }]);
    }).finally(() => {
      if (this.c !== c || a.cerrado) return;
      this.ocupado = false;
      ctx.estado(a, a.pendientes.size ? 'esperando' : 'listo');
      this.registrar();
      this.siguiente();
    });
  }

  private pedido(metodo: string, p: P): Promise<unknown> {
    if (metodo !== 'session/request_permission') return Promise.reject(new Error(`No se atiende ${metodo}`));
    const a = this.a, herramienta = objeto(p.toolCall), opciones = (Array.isArray(p.options) ? p.options.map(objeto) : []);
    const id = `gemini-${cadena(herramienta.toolCallId) || Date.now()}`;
    const previo = a.bloques.find(b => b.id === `g-h-${cadena(herramienta.toolCallId)}`);
    const entrada = objeto(herramienta.rawInput);
    const detalle = detalleGemini(herramienta.content, entrada) || (previo?.tipo === 'herramienta' ? previo.detalle : undefined);
    const opcion = (...tipos: string[]) => opciones.find(o => tipos.includes(cadena(o.kind)));
    const siempre = opcion('allow_always');
    const solicitud: Solicitud = { id, agente: a.id, herramienta: cadena(herramienta.kind) === 'execute' ? 'Bash' : cadena(herramienta.kind) === 'edit' ? 'Edit' : 'Gemini', entrada,
      titulo: `Gemini quiere usar: ${cadena(herramienta.title) || 'una herramienta'}`, haySugerencias: !!siempre, etiquetaSiempre: siempre ? cadena(siempre.name) || 'Permitir siempre' : undefined, detalle };
    return new Promise(resolve => {
      this.ctx.solicitar(a, { tipo: 'permiso', id, solicitud, estado: 'pendiente' }, (r?: Respuesta) => {
        const elegida = !r ? undefined : r.decision === 'permitir' ? opcion('allow_once', 'allow_always') : r.decision === 'siempre' ? siempre || opcion('allow_once') : opcion('reject_once', 'reject_always');
        resolve(elegida ? { outcome: { outcome: 'selected', optionId: cadena(elegida.optionId) } } : { outcome: { outcome: 'cancelled' } });
        if (r?.decision === 'rechazar' && r.mensaje?.trim()) this.enviar(r.mensaje.trim());
      });
    });
  }

  async interrumpir() { if (this.sesion && this.c?.vivo) this.c.avisar('session/cancel', { sessionId: this.sesion }); }
  async modo(m: PermissionMode) {
    if (this.sesion && this.c?.vivo) await this.c.pedir('session/set_mode', { sessionId: this.sesion, modeId: ID_MODO[m] || 'default' });
    this.a.modo = m;
  }
  async modelo(m?: string) {
    if (this.sesion && this.c?.vivo) await this.c.pedir('session/set_model', { sessionId: this.sesion, modelId: m || 'auto' });
    this.a.modelo = m;
  }
  async esfuerzo() { throw new Error('Gemini no tiene niveles de esfuerzo.'); }
  async comandos() { return this.comandosDisponibles; }
  cerrar() { this.c?.cerrar(); this.c = undefined; }
}
