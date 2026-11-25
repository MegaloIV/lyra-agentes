import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import type { Bloque, Op, PermissionMode, Progreso, Proveedor, ResumenAgente, ServidorMensaje, Sesion } from './protocolo.ts';
import { aplicarOps } from './protocolo.ts';
import type { Agente, Contexto, Respuesta } from './motor.ts';
import { MotorClaude, cargarClaude, historialClaude, tituloClaude } from './claude.ts';
import { MotorCodex, cargarCodex, historialCodex } from './codex.ts';
import { instalado } from './motor.ts';
import { sesionesLocales } from './local.ts';
import { borrarSesion, renombrarSesion } from './papelera.ts';
import { queDice, ultimoTexto, type Acompanante, type AvisoAgente } from './acompanante.ts';

export type { Agente };
const NOMBRES: Record<Proveedor, string> = { claude: 'Claude', codex: 'Codex', local: 'El agente local' };

export class GestorAgentes implements Contexto {
  agentes = new Map<string, Agente>();
  private reanudando = new Map<string, Promise<Agente>>();
  emitir: (m: ServidorMensaje) => void;
  notificar: (id: string, titulo: string, texto: string) => void;
  mirando: (id: string) => boolean;
  /** Opcional: otro programa que se entera de lo que pasa (ver acompanante.ts) */
  acompanante?: Acompanante;
  constructor(emitir: (m: ServidorMensaje) => void, notificar: (id: string, titulo: string, texto: string) => void, mirando: (id: string) => boolean) {
    this.emitir = emitir; this.notificar = notificar; this.mirando = mirando;
  }

  resumenes(): ResumenAgente[] {
    return [...this.agentes.values()].map(({ id, proveedor, sessionId, titulo, cwd, estado, modelo, esfuerzo, modo, sinLeer, ultimaActividad, contexto, progreso }) => ({ id, proveedor, sessionId, titulo, cwd, estado, modelo, esfuerzo, modo, sinLeer, ultimaActividad, contexto, progreso }));
  }
  private relojBarra?: ReturnType<typeof setTimeout>;
  barra() { if (this.relojBarra) clearTimeout(this.relojBarra); this.relojBarra = undefined; this.emitir({ t: 'agentes', agentes: this.resumenes() }); }
  progreso(a: Agente, tokens: number, fase?: Progreso['fase']) {
    const p = a.progreso;
    if (!p || p.fin || (p.tokens === tokens && (!fase || p.fase === fase))) return;
    p.tokens = tokens; if (fase) p.fase = fase;
    this.relojBarra ??= setTimeout(() => this.barra(), 500);
  }
  ops(a: Agente, ops: Op[]) { if (!ops.length || a.cerrado) return; a.bloques = aplicarOps(a.bloques, ops); this.emitir({ t: 'ops', agente: a.id, ops }); }
  estado(a: Agente, estado: Agente['estado']) {
    const anterior = a.estado; a.estado = estado; a.ultimaActividad = Date.now();
    // Un turno nuevo empieza a contar al ponerse a trabajar desde el reposo; al terminar queda quieto con lo último
    if (estado === 'trabajando' && (!a.progreso || a.progreso.fin)) a.progreso = { inicio: Date.now(), tokens: 0, fase: 'pensando' };
    if ((estado === 'listo' || estado === 'error' || estado === 'cerrado') && a.progreso && !a.progreso.fin) a.progreso.fin = Date.now();
    if (estado === 'listo' && !this.mirando(a.id)) a.sinLeer = true;
    this.barra();
    if (anterior === estado) return;
    const base = { agente: a.id, proveedor: a.proveedor, titulo: a.titulo, cwd: a.cwd, mirando: this.mirando(a.id) };
    // También al volver de un permiso: el acompañante sabe que ya se respondió (en la ventana o en su globo)
    if (estado === 'trabajando') void this.acompanante?.avisar({ ...base, tipo: 'trabaja', texto: '' });
    if (estado === 'error') {
      const motivo = a.bloques.findLast(b => b.tipo === 'sistema' && b.nivel === 'error');
      void this.acompanante?.avisar({ ...base, tipo: 'error', texto: motivo?.tipo === 'sistema' ? motivo.texto : '' });
    }
    if ((estado === 'esperando' || estado === 'listo') && anterior !== 'iniciando') {
      const pide = a.bloques.findLast((b): b is Extract<Bloque, { tipo: 'permiso' | 'pregunta' | 'plan' }> => (b.tipo === 'permiso' || b.tipo === 'pregunta' || b.tipo === 'plan') && b.estado === 'pendiente');
      const texto = estado === 'listo' ? `${NOMBRES[a.proveedor]} terminó` : pide?.tipo === 'pregunta' ? `${NOMBRES[a.proveedor]} te hizo una pregunta` : `${NOMBRES[a.proveedor]} necesita tu permiso`;
      const aviso: AvisoAgente = estado === 'listo' || !pide ? { ...base, tipo: 'fin', texto: ultimoTexto(a.bloques) }
        : { ...base, tipo: pide.tipo === 'pregunta' ? 'pregunta' : 'permiso', texto: queDice(pide), ...(pide.tipo === 'permiso' ? { solicitud: pide.id } : {}) };
      // Si hay un acompañante que lo recibe, él te avisa: sin notificación del escritorio
      if (!this.acompanante) this.notificar(a.id, a.titulo, texto);
      else void this.acompanante.avisar(aviso).then(ok => { if (!ok) this.notificar(a.id, a.titulo, texto); });
    }
  }
  fallo(a: Agente, e: unknown) {
    for (const p of [...a.pendientes.values()]) p.responder();
    this.ops(a, [{ op: 'agregar', bloque: { tipo: 'sistema', id: randomUUID(), texto: `No se pudo continuar la sesión: ${e instanceof Error ? e.message : String(e)}`, nivel: 'error' } }]);
    this.estado(a, 'error');
  }
  solicitar(a: Agente, bloque: Extract<Bloque, { tipo: 'permiso' | 'pregunta' | 'plan' }>, al: (r?: Respuesta) => void) {
    const id = bloque.id;
    let resuelto = false;
    const responder = (r?: Respuesta) => {
      if (resuelto) return; resuelto = true; a.pendientes.delete(id);
      const permitir = !!r && r.decision !== 'rechazar';
      const estado = bloque.tipo === 'pregunta' ? permitir ? 'respondida' : 'cancelada' : bloque.tipo === 'plan' ? permitir ? 'aprobado' : 'rechazado' : !r ? 'cancelado' : permitir ? 'permitido' : 'rechazado';
      this.ops(a, [{ op: 'actualizar', id, cambios: { estado, ...(bloque.tipo === 'pregunta' ? { respuestas: r?.respuestas } : {}) } }]);
      al(r);
      if (!a.cerrado && a.estado !== 'error') this.estado(a, a.pendientes.size ? 'esperando' : 'trabajando');
    };
    a.pendientes.set(id, { responder }); this.ops(a, [{ op: 'agregar', bloque }]); this.estado(a, 'esperando');
    return () => responder();
  }

  obtener(id: string) { const a = this.agentes.get(id); if (!a) throw new Error('No se encontró el agente.'); return a; }

  /** Todas las conversaciones guardadas de los tres proveedores, de la más reciente */
  async historial(): Promise<Sesion[]> {
    const locales = await sesionesLocales();
    const partes = await Promise.all([
      // Las locales se guardan con las de Claude: se distinguen por el registro
      historialClaude().then(l => l.map(s => s.sessionId in locales ? { ...s, proveedor: 'local' as const } : s)).catch(() => []),
      instalado('codex') ? historialCodex().catch(() => []) : [],
    ]);
    return partes.flat().sort((a, b) => b.modificado - a.modificado);
  }

  async cargar(proveedor: Proveedor, sessionId: string, cwd: string): Promise<Bloque[]> {
    if (proveedor === 'codex') return cargarCodex(sessionId, cwd);
    return (await cargarClaude(sessionId, cwd)).bloques;
  }

  async crear(opciones: { cwd: string; proveedor?: Proveedor; modelo?: string; esfuerzo?: string; modo?: PermissionMode; prompt?: string; reanudar?: string }) {
    if (!opciones.reanudar) return this.crearAgente(opciones);
    // Dos mensajes WebSocket pueden llegar mientras aún se está cargando el historial.
    // Serializar por sesión permite que el segundo reutilice el agente del primero.
    const clave = `${opciones.proveedor || 'claude'}:${opciones.reanudar}`;
    const anterior = this.reanudando.get(clave);
    const actual = (anterior ? anterior.catch(() => {}) : Promise.resolve()).then(() => this.crearAgente(opciones));
    this.reanudando.set(clave, actual);
    try { return await actual; }
    finally { if (this.reanudando.get(clave) === actual) this.reanudando.delete(clave); }
  }

  private async crearAgente(opciones: { cwd: string; proveedor?: Proveedor; modelo?: string; esfuerzo?: string; modo?: PermissionMode; prompt?: string; reanudar?: string }) {
    const proveedor = opciones.proveedor || 'claude';
    let cwd = opciones.cwd;
    cwd = resolve(cwd.startsWith('~/') ? homedir() + cwd.slice(1) : cwd);
    if (!(await stat(cwd)).isDirectory()) throw new Error('La ruta no es una carpeta.');
    if (proveedor !== 'claude' && proveedor !== 'local' && !instalado(proveedor)) throw new Error(`${NOMBRES[proveedor]} no está instalado.`);
    const { reanudar, prompt } = opciones;
    if (reanudar) {
      const existente = [...this.agentes.values()].find(a => a.sessionId === reanudar && a.proveedor === proveedor);
      if (existente) {
        // Los ajustes elegidos al retomar también valen si la conversación ya estaba abierta
        if (opciones.modelo && opciones.modelo !== existente.modelo) await existente.motor.modelo(opciones.modelo);
        if (opciones.esfuerzo && opciones.esfuerzo !== existente.esfuerzo) await existente.motor.esfuerzo(opciones.esfuerzo);
        if (opciones.modo && opciones.modo !== existente.modo && opciones.modo !== 'bypassPermissions') await existente.motor.modo(opciones.modo);
        if (existente.estado === 'error') existente.motor.iniciar(); if (prompt) this.enviar(existente.id, prompt); this.emitir({ t: 'documento', agente: existente.id, bloques: existente.bloques }); return existente;
      }
    }
    let bloques: Bloque[] = [], titulo: string | undefined, normalizador;
    if (reanudar) {
      if (proveedor === 'claude' || proveedor === 'local') { const c = await cargarClaude(reanudar, cwd); bloques = c.bloques; normalizador = c.normalizador; titulo = await tituloClaude(reanudar, cwd); }
      else { bloques = await this.cargar(proveedor, reanudar, cwd).catch(() => []); titulo = (await this.historial()).find(s => s.sessionId === reanudar)?.titulo; }
    }
    const a: Agente = { id: randomUUID(), proveedor, sessionId: reanudar, cwd, titulo: titulo || prompt?.slice(0, 60) || 'Nuevo agente', estado: 'iniciando', modelo: opciones.modelo, esfuerzo: opciones.esfuerzo,
      modo: opciones.modo || 'default', sinLeer: false, ultimaActividad: Date.now(), bloques, pendientes: new Map(), cerrado: false, motor: undefined! };
    if (proveedor === 'local' && reanudar && !a.modelo) a.modelo = (await sesionesLocales())[reanudar] || undefined;
    a.motor = proveedor === 'codex' ? new MotorCodex(this, a) : new MotorClaude(this, a, normalizador, proveedor === 'local');
    this.agentes.set(a.id, a); this.barra(); this.emitir({ t: 'documento', agente: a.id, bloques: a.bloques });
    a.motor.iniciar();
    if (prompt) this.enviar(a.id, prompt);
    return a;
  }

  enviar(id: string, texto: string) {
    const a = this.obtener(id);
    if (!texto.trim()) return;
    if (a.estado === 'error') throw new Error('Reanuda el agente antes de enviar un mensaje.');
    if (a.titulo === 'Nuevo agente' && (a.proveedor === 'claude' || a.proveedor === 'local')) a.titulo = texto.slice(0, 60);
    a.motor.enviar(texto);
  }

  responder(r: Respuesta) { const p = this.obtener(r.agente).pendientes.get(r.solicitud); if (!p) throw new Error('La solicitud ya fue resuelta o cancelada.'); p.responder(r); }

  /** Borra una conversación (la cierra antes si está abierta). Nunca es definitivo: ver papelera.ts */
  async borrar(m: { proveedor: Proveedor; sessionId?: string; agente?: string }) {
    let { proveedor, sessionId } = m;
    const abierto = m.agente ? this.agentes.get(m.agente) : [...this.agentes.values()].find(a => a.sessionId === sessionId && a.proveedor === proveedor);
    if (abierto) {
      sessionId ||= abierto.sessionId; proveedor = abierto.proveedor;
      this.cerrar(abierto.id);
      if (sessionId) await new Promise(r => setTimeout(r, 400));   // que el proceso termine de escribir
    }
    if (!sessionId) return { texto: 'Agente cerrado: aún no tenía nada guardado.', sessionId };
    return { texto: await borrarSesion(proveedor, sessionId), sessionId };
  }

  async renombrar(m: { proveedor: Proveedor; sessionId?: string; agente?: string; cwd?: string; titulo: string }) {
    const titulo = m.titulo.trim().replace(/\s+/g, ' ').slice(0, 120);
    const a = m.agente ? this.agentes.get(m.agente) : [...this.agentes.values()].find(x => x.sessionId === m.sessionId && x.proveedor === m.proveedor);
    if (a) { a.titulo = titulo; this.barra(); }
    const sessionId = m.sessionId || a?.sessionId;
    if (sessionId) await renombrarSesion(a?.proveedor || m.proveedor, sessionId, titulo, m.cwd || a?.cwd);
  }

  cerrar(id: string) {
    const a = this.obtener(id);
    a.cerrado = true;
    for (const p of [...a.pendientes.values()]) p.responder();
    a.motor.cerrar();
    this.agentes.delete(id); this.barra();
  }
}
