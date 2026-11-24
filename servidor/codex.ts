// Codex por `codex app-server` (JSON-RPC v2 por stdio). Un solo proceso atiende a todos los hilos.
import type { Bloque, Comando, InfoProveedor, Limite, Modelo, PermissionMode, Sesion, Solicitud, Ventana } from './protocolo.ts';
import { ClienteRpc } from './rpc.ts';
import { cadena, objeto } from './resumenes.ts';
import { bloquesDeItem, bloquesDeHilo, comandoLimpio, finDeTurno, lineasDiff, tareasDePlan } from './normalizarCodex.ts';
import { bloqueUsuario, errorLegible, instalado, type Agente, type Contexto, type Motor, type Respuesta } from './motor.ts';

type P = Record<string, unknown>;
const legible = (t: string) => errorLegible(t, 'Codex');

/** Preguntar / Aceptar ediciones / Solo lectura / Sin preguntar → política de aprobación y sandbox de Codex */
export const MODOS_CODEX: InfoProveedor['modos'] = [
  { valor: 'default', nombre: 'Preguntar' },
  { valor: 'acceptEdits', nombre: 'Aceptar ediciones' },
  { valor: 'plan', nombre: 'Solo lectura' },
  { valor: 'bypassPermissions', nombre: 'Sin preguntar' },
];
const POLITICA: Partial<Record<PermissionMode, { aprobacion: string; sandbox: string; politica: P }>> = {
  default: { aprobacion: 'untrusted', sandbox: 'workspace-write', politica: { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } },
  acceptEdits: { aprobacion: 'on-request', sandbox: 'workspace-write', politica: { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } },
  plan: { aprobacion: 'on-request', sandbox: 'read-only', politica: { type: 'readOnly', networkAccess: false } },
  bypassPermissions: { aprobacion: 'never', sandbox: 'danger-full-access', politica: { type: 'dangerFullAccess' } },
};
const politica = (m: PermissionMode) => POLITICA[m] || POLITICA.default!;

// ── La conexión compartida ────────────────────────────────────────────────────
let cliente: ClienteRpc | null = null, conectando: Promise<ClienteRpc> | null = null;
const hilos = new Map<string, MotorCodex>();
let cuota: InfoProveedor['cuota'], limite: Limite | undefined;
export let alCambiarCuota: () => void = () => {};
export function avisarCuota(f: () => void) { alCambiarCuota = f; }
/** La última cuota leída, con sus dos ventanas (5 h y semana) */
export const limiteCodex = () => limite;

const duracion = (min: number) => min === 10080 ? 'Semana' : min === 1440 ? 'Día' : min > 1440 ? `${Math.round(min / 1440)} días` : min ? `${Math.round(min / 60)} h` : 'Límite';
function leerCuota(r: P) {
  const vista = objeto(r.rateLimits ?? r), ventanas = [objeto(vista.primary), objeto(vista.secondary)].filter(v => typeof v.usedPercent === 'number');
  if (!ventanas.length) return;
  const plan = cadena(vista.planType);
  limite = { proveedor: 'codex', plan: plan ? plan[0]!.toUpperCase() + plan.slice(1) : limite?.plan, ventanas: ventanas.map((v): Ventana => {
    const min = Number(v.windowDurationMins) || 0;
    return { tipo: min > 1440 ? 'larga' : 'corta', nombre: duracion(min), usado: Math.round(v.usedPercent as number), renueva: typeof v.resetsAt === 'number' ? v.resetsAt * 1000 : undefined };
  }) };
  const peor = ventanas.reduce((a, b) => (b.usedPercent as number) > (a.usedPercent as number) ? b : a);
  const agotada = (peor.usedPercent as number) >= 100 || r.ordinaryUsageAllowed === false || !!vista.rateLimitReachedType;
  cuota = { usado: Math.round(peor.usedPercent as number), renueva: typeof peor.resetsAt === 'number' ? peor.resetsAt * 1000 : undefined, agotada };
}

async function conexion(): Promise<ClienteRpc> {
  if (cliente?.vivo) return cliente;
  if (conectando) return conectando;
  conectando = (async () => {
    const c = new ClienteRpc('codex', ['app-server'], { jsonrpc: false });
    c.alAviso = (metodo, p) => {
      if (metodo === 'account/rateLimits/updated') { leerCuota(p); alCambiarCuota(); return; }
      const hilo = cadena(p.threadId) || cadena(objeto(p.thread).id);
      hilos.get(hilo)?.aviso(metodo, p);
    };
    c.alPedido = async (metodo, p) => {
      const motor = hilos.get(cadena(p.threadId));
      if (motor) return motor.pedido(metodo, p);
      if (metodo === 'mcpServer/elicitation/request') return { action: 'decline', content: null, _meta: null };
      if (metodo.endsWith('requestApproval')) return { decision: 'decline' };
      throw new Error(`No se atiende ${metodo}`);
    };
    c.alCerrar = () => { if (cliente === c) cliente = null; for (const m of [...hilos.values()]) m.caido(); };
    await c.pedir('initialize', { clientInfo: { name: 'lyra_agentes', title: 'Lyra', version: '0.2.0' }, capabilities: null });
    c.avisar('initialized');
    cliente = c;
    return c;
  })();
  try { return await conectando; } finally { conectando = null; }
}


export async function infoCodex(): Promise<InfoProveedor> {
  const base: InfoProveedor = { id: 'codex', nombre: 'Codex', instalado: instalado('codex'), sesion: false, modelos: [], modos: MODOS_CODEX };
  if (!base.instalado) return base;
  try {
    const c = await conexion();
    const cuenta = await c.pedir<P>('account/read', {}).catch(() => ({} as P));
    base.sesion = !!cuenta.account;
    const lista = await c.pedir<P>('model/list', {});
    const modelos: Modelo[] = (Array.isArray(lista.data) ? lista.data.map(objeto) : []).filter(m => !m.hidden).map(m => ({
      valor: cadena(m.id), nombre: cadena(m.displayName) || cadena(m.id), descripcion: cadena(m.description) || undefined,
      esfuerzos: Array.isArray(m.supportedReasoningEfforts) ? m.supportedReasoningEfforts.map(objeto).map(e => cadena(e.reasoningEffort)) : undefined,
      esfuerzoDefecto: cadena(m.defaultReasoningEffort) || undefined }));
    base.modelos = [{ valor: null, nombre: 'Predeterminado', descripcion: 'El de tu configuración de Codex' }, ...modelos];
    leerCuota(await c.pedir<P>('account/rateLimits/read', {}).catch(() => ({})));
    base.cuota = cuota;
  } catch { /* sin conexión: se ofrece igual, el error saldrá al crear */ }
  return base;
}

/** Vuelve a leer la cuota (sin Codex instalado o sin cuenta, no hay) */
export async function limitesCodex(): Promise<Limite | undefined> {
  if (!instalado('codex')) return undefined;
  const c = await conexion();
  leerCuota(await c.pedir<P>('account/rateLimits/read', {}));
  return limite ?? { proveedor: 'codex', ventanas: [], nota: 'sin sesión' };
}

export async function historialCodex(): Promise<Sesion[]> {
  const c = await conexion();
  // Todas, de a páginas (Codex devuelve un cursor mientras queden); el tope solo evita un bucle sin fin
  const hilos: P[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 50; i++) {
    const r: P = await c.pedir<P>('thread/list', { limit: 200, cursor, useStateDbOnly: true, sortKey: 'updated_at', sourceKinds: ['cli', 'vscode', 'exec', 'appServer'] });
    if (Array.isArray(r.data)) hilos.push(...r.data.map(objeto));
    cursor = cadena(r.nextCursor) || null;
    if (!cursor) break;
  }
  return hilos.filter(t => !t.ephemeral && !t.parentThreadId).map(t => ({
    proveedor: 'codex' as const, sessionId: cadena(t.id), titulo: (cadena(t.name) || cadena(t.preview).replace(/^❯\s*/, '').slice(0, 60) || 'Sin título').trim(),
    cwd: cadena(t.cwd), modificado: (Number(t.updatedAt) || 0) * 1000, rama: cadena(objeto(t.gitInfo).branch) || undefined }));
}

export async function archivarCodex(threadId: string) { await (await conexion()).pedir('thread/archive', { threadId }); }
export async function renombrarCodex(threadId: string, name: string) { await (await conexion()).pedir('thread/name/set', { threadId, name }); }

export async function cargarCodex(threadId: string, cwd: string): Promise<Bloque[]> {
  const c = await conexion();
  const r = await c.pedir<P>('thread/read', { threadId, includeTurns: true });
  return bloquesDeHilo(objeto(r.thread).turns, cwd, legible);
}

// ── Un agente de Codex ────────────────────────────────────────────────────────
export class MotorCodex implements Motor {
  private hilo?: string;
  private turno?: string;
  private cola: { texto: string; id: string }[] = [];
  private items = new Map<string, P>();
  private cambios = { modo: false, modelo: false, esfuerzo: false };
  private ctx: Contexto;
  private a: Agente;
  constructor(ctx: Contexto, a: Agente) {
    this.ctx = ctx; this.a = a;}

  iniciar() { void this.arrancar(); }

  private async arrancar() {
    const a = this.a, ctx = this.ctx;
    ctx.estado(a, 'iniciando');
    try {
      const c = await conexion(), pol = politica(a.modo);
      const comun = { cwd: a.cwd, model: a.modelo ?? null, approvalPolicy: pol.aprobacion, sandbox: pol.sandbox, config: a.esfuerzo ? { model_reasoning_effort: a.esfuerzo } : null };
      const r = a.sessionId ? await c.pedir<P>('thread/resume', { threadId: a.sessionId, ...comun, excludeTurns: true }) : await c.pedir<P>('thread/start', comun);
      const hilo = objeto(r.thread);
      this.hilo = cadena(hilo.id); a.sessionId = this.hilo; hilos.set(this.hilo, this);
      a.modelo = cadena(r.model) || a.modelo; a.esfuerzo = cadena(r.reasoningEffort) || a.esfuerzo;
      if (cadena(hilo.name)) a.titulo = cadena(hilo.name);
      this.cambios = { modo: false, modelo: false, esfuerzo: false };
      ctx.estado(a, 'listo');
      this.siguiente();
    } catch (e) { ctx.fallo(a, new Error(legible(e instanceof Error ? e.message : String(e)))); }
  }

  /** Se cayó el proceso compartido */
  caido() { if (!this.a.cerrado) { this.turno = undefined; this.ctx.fallo(this.a, new Error('Codex se cerró. Puedes reanudar la sesión.')); } }

  enviar(texto: string) {
    const ocupado = !this.hilo || !!this.turno, u = bloqueUsuario(texto, ocupado);
    this.ctx.ops(this.a, [{ op: 'agregar', bloque: u }]);
    if (this.a.titulo === 'Nuevo agente') this.a.titulo = texto.slice(0, 60);
    this.cola.push({ texto, id: u.id });
    if (!ocupado) this.siguiente(); else this.ctx.barra();
  }

  private siguiente() {
    if (!this.hilo || this.turno || !this.cola.length || this.a.cerrado) return;
    const { texto, id } = this.cola.shift()!, a = this.a, pol = politica(a.modo);
    this.ctx.ops(a, [{ op: 'actualizar', id, cambios: { enCola: false } }]);
    this.ctx.estado(a, 'trabajando');
    this.turno = 'pendiente';
    const params: P = { threadId: this.hilo, clientUserMessageId: id, input: [{ type: 'text', text: texto, text_elements: [] }] };
    if (this.cambios.modo) { params.approvalPolicy = pol.aprobacion; params.sandboxPolicy = pol.politica; }
    if (this.cambios.modelo) params.model = a.modelo ?? null;
    if (this.cambios.esfuerzo) params.effort = a.esfuerzo ?? null;
    conexion().then(c => c.pedir<P>('turn/start', params)).then(r => {
      this.cambios = { modo: false, modelo: false, esfuerzo: false };
      const t = objeto(r.turn); if (this.turno === 'pendiente') this.turno = cadena(t.id);
    }).catch(e => {
      this.turno = undefined;
      this.ctx.ops(a, [{ op: 'agregar', bloque: { tipo: 'fin', id: `fin-${id}`, error: legible(e instanceof Error ? e.message : String(e)) } }]);
      this.ctx.estado(a, 'listo');
    });
  }

  /** Avisos de este hilo */
  aviso(metodo: string, p: P) {
    const a = this.a, ctx = this.ctx;
    if (a.cerrado) return;
    switch (metodo) {
      case 'turn/started': this.turno = cadena(objeto(p.turn).id); break;
      case 'item/started': case 'item/completed': {
        const item = objeto(p.item), id = cadena(item.id);
        if (item.type === 'userMessage') return;   // ya está: lo puso enviar()
        if (item.type === 'fileChange' || item.type === 'commandExecution') this.items.set(id, item);
        const bloques = bloquesDeItem(item, a.cwd).map(b => b.tipo === 'texto' ? { ...b, enCurso: metodo === 'item/started' } : b);
        ctx.ops(a, bloques.map(b => a.bloques.some(x => x.id === b.id) ? { op: 'actualizar' as const, id: b.id, cambios: (({ id: _i, tipo: _t, ...resto }) => resto)(b as Bloque & P) } : { op: 'agregar' as const, bloque: b }));
        if (metodo === 'item/completed') this.items.delete(id);
        break;
      }
      case 'item/agentMessage/delta': {
        const id = cadena(p.itemId);
        if (!a.bloques.some(b => b.id === id)) ctx.ops(a, [{ op: 'agregar', bloque: { tipo: 'texto', id, md: '', enCurso: true } }]);
        ctx.ops(a, [{ op: 'delta', id, md: cadena(p.delta) }]);
        break;
      }
      case 'turn/plan/updated': {
        const b = tareasDePlan(`tareas-${cadena(p.turnId)}`, p.plan);
        ctx.ops(a, [a.bloques.some(x => x.id === b.id) ? { op: 'actualizar', id: b.id, cambios: { items: b.items } } : { op: 'agregar', bloque: b }]);
        break;
      }
      case 'thread/name/updated': if (cadena(p.threadName)) { a.titulo = cadena(p.threadName).slice(0, 80); ctx.barra(); } break;
      case 'thread/tokenUsage/updated': {
        const uso = objeto(p.tokenUsage), ultimo = objeto(uso.last);
        if (typeof uso.modelContextWindow === 'number' && typeof ultimo.totalTokens === 'number') { a.contexto = { usados: ultimo.totalTokens, total: uso.modelContextWindow }; ctx.barra(); }
        break;
      }
      case 'model/rerouted': if (cadena(p.toModel)) { a.modelo = cadena(p.toModel); ctx.barra(); } break;
      case 'turn/completed': {
        const t = objeto(p.turn);
        // Los textos que quedaron abiertos se cierran
        ctx.ops(a, a.bloques.filter(b => b.tipo === 'texto' && b.enCurso).map(b => ({ op: 'actualizar' as const, id: b.id, cambios: { enCurso: false } })));
        ctx.ops(a, [{ op: 'agregar', bloque: finDeTurno(t, legible) }]);
        this.turno = undefined;
        ctx.estado(a, a.pendientes.size ? 'esperando' : 'listo');
        this.siguiente();
        break;
      }
    }
  }

  /** Pedidos de este hilo: permisos y preguntas */
  pedido(metodo: string, p: P): Promise<unknown> {
    const a = this.a, id = `codex-${cadena(p.itemId)}-${cadena(p.approvalId) || metodo.split('/')[1]}`;
    const base = { id, agente: a.id, haySugerencias: true, etiquetaSiempre: 'Permitir en esta sesión' };
    return new Promise(resolve => {
      if (metodo === 'item/commandExecution/requestApproval') {
        const comando = comandoLimpio(cadena(p.command));
        const solicitud: Solicitud = { ...base, herramienta: 'Bash', entrada: { command: comando }, motivo: cadena(p.reason) || undefined, detalle: { clase: 'codigo', lenguaje: 'bash', texto: comando } };
        this.ctx.solicitar(a, { tipo: 'permiso', id, solicitud, estado: 'pendiente' }, r => { resolve({ decision: decision(r) }); this.motivo(r); });
        return;
      }
      if (metodo === 'item/fileChange/requestApproval') {
        const cambios = (Array.isArray(this.items.get(cadena(p.itemId))?.changes) ? this.items.get(cadena(p.itemId))!.changes as unknown[] : []).map(objeto);
        const primero = cambios[0] || {}, ruta = cadena(primero.path);
        const solicitud: Solicitud = { ...base, herramienta: cadena(objeto(primero.kind).type) === 'add' ? 'Write' : 'Edit', entrada: { file_path: ruta },
          motivo: [cadena(p.reason), cambios.length > 1 ? `También cambia: ${cambios.slice(1).map(c => cadena(c.path)).join(', ')}` : ''].filter(Boolean).join(' · ') || undefined,
          detalle: ruta ? { clase: 'diff', ruta, lineas: lineasDiff(cadena(primero.diff), cadena(objeto(primero.kind).type) === 'add') } : { clase: 'md', texto: 'Codex quiere modificar archivos.' } };
        this.ctx.solicitar(a, { tipo: 'permiso', id, solicitud, estado: 'pendiente' }, r => { resolve({ decision: decision(r) }); this.motivo(r); });
        return;
      }
      if (metodo === 'item/tool/requestUserInput') {
        const preguntas = (Array.isArray(p.questions) ? p.questions.map(objeto) : []);
        const entrada = { questions: preguntas.map(q => ({ question: cadena(q.question), header: cadena(q.header), multiSelect: false, options: Array.isArray(q.options) ? q.options.map(objeto).map(o => ({ label: cadena(o.label), description: cadena(o.description) })) : [] })) };
        const solicitud: Solicitud = { ...base, herramienta: 'AskUserQuestion', entrada, haySugerencias: false };
        this.ctx.solicitar(a, { tipo: 'pregunta', id, solicitud, estado: 'pendiente' }, r => {
          const respuestas = r && r.decision !== 'rechazar' ? r.respuestas || {} : {};
          resolve({ answers: Object.fromEntries(preguntas.map(q => [cadena(q.id), { answers: respuestas[cadena(q.question)] ? [respuestas[cadena(q.question)]!] : [] }])) });
        });
        return;
      }
      if (metodo === 'item/permissions/requestApproval') {
        const permisos = objeto(p.permissions);
        const solicitud: Solicitud = { ...base, herramienta: 'Permisos', titulo: 'Codex pide permisos extra', entrada: permisos, motivo: cadena(p.reason) || undefined, detalle: { clase: 'codigo', lenguaje: 'json', texto: JSON.stringify(permisos, null, 2) } };
        this.ctx.solicitar(a, { tipo: 'permiso', id, solicitud, estado: 'pendiente' }, r => {
          const si = r && r.decision !== 'rechazar';
          resolve({ permissions: si ? { ...(permisos.network ? { network: permisos.network } : {}), ...(permisos.fileSystem ? { fileSystem: permisos.fileSystem } : {}) } : {}, scope: r?.decision === 'siempre' ? 'session' : 'turn' });
        });
        return;
      }
      if (metodo === 'mcpServer/elicitation/request') { resolve({ action: 'decline', content: null, _meta: null }); return; }
      resolve({ decision: 'decline' });
    });
  }

  /** Codex no recibe un motivo al rechazar: se le manda como el próximo mensaje */
  private motivo(r?: Respuesta) { if (r?.decision === 'rechazar' && r.mensaje?.trim()) this.enviar(r.mensaje.trim()); }

  async interrumpir() {
    if (!this.hilo || !this.turno || this.turno === 'pendiente') return;
    await (await conexion()).pedir('turn/interrupt', { threadId: this.hilo, turnId: this.turno });
  }
  async modo(m: PermissionMode) { this.a.modo = m; this.cambios.modo = true; }
  async modelo(m?: string) { this.a.modelo = m; this.cambios.modelo = true; }
  async esfuerzo(e?: string) { this.a.esfuerzo = e; this.cambios.esfuerzo = true; }
  async comandos(): Promise<Comando[]> { return []; }
  cerrar() {
    const hilo = this.hilo, turno = this.turno;
    if (!hilo) return;
    hilos.delete(hilo);
    if (cliente?.vivo) {
      if (turno && turno !== 'pendiente') void cliente.pedir('turn/interrupt', { threadId: hilo, turnId: turno }).catch(() => {});
      void cliente.pedir('thread/unsubscribe', { threadId: hilo }).catch(() => {});
    }
  }
}

function decision(r?: Respuesta): string {
  return !r ? 'cancel' : r.decision === 'permitir' ? 'accept' : r.decision === 'siempre' ? 'acceptForSession' : 'decline';
}

export function cerrarCodex() { cliente?.cerrar(); cliente = null; }
