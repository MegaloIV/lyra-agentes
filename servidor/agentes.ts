import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import type { Bloque, Op, PermissionMode, Proveedor, ResumenAgente, ServidorMensaje, Sesion } from './protocolo.ts';
import { aplicarOps } from './protocolo.ts';
import type { Agente, Contexto, Respuesta } from './motor.ts';
import { MotorClaude, cargarClaude, historialClaude, tituloClaude } from './claude.ts';
import { MotorCodex, cargarCodex, historialCodex } from './codex.ts';
import { MotorGemini, cargarGemini, historialGemini } from './gemini.ts';
import { instalado } from './motor.ts';
import { sesionesLocales } from './local.ts';
import { borrarSesion, renombrarSesion } from './papelera.ts';

export type { Agente };
const NOMBRES: Record<Proveedor, string> = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', local: 'El agente local' };

export class GestorAgentes implements Contexto {
  agentes = new Map<string, Agente>();
  emitir: (m: ServidorMensaje) => void;
  notificar: (id: string, titulo: string, texto: string) => void;
  mirando: (id: string) => boolean;
  constructor(emitir: (m: ServidorMensaje) => void, notificar: (id: string, titulo: string, texto: string) => void, mirando: (id: string) => boolean) {
    this.emitir = emitir; this.notificar = notificar; this.mirando = mirando;
  }

  resumenes(): ResumenAgente[] {
    return [...this.agentes.values()].map(({ id, proveedor, sessionId, titulo, cwd, estado, modelo, esfuerzo, modo, sinLeer, ultimaActividad, contexto }) => ({ id, proveedor, sessionId, titulo, cwd, estado, modelo, esfuerzo, modo, sinLeer, ultimaActividad, contexto }));
  }
  barra() { this.emitir({ t: 'agentes', agentes: this.resumenes() }); }
  ops(a: Agente, ops: Op[]) { if (!ops.length || a.cerrado) return; a.bloques = aplicarOps(a.bloques, ops); this.emitir({ t: 'ops', agente: a.id, ops }); }
  estado(a: Agente, estado: Agente['estado']) {
    const anterior = a.estado; a.estado = estado; a.ultimaActividad = Date.now();
    if (estado === 'listo' && !this.mirando(a.id)) a.sinLeer = true;
    this.barra();
    if (anterior !== estado && (estado === 'esperando' || estado === 'listo') && anterior !== 'iniciando') {
      const pide = a.bloques.findLast(b => b.tipo === 'permiso' || b.tipo === 'pregunta' || b.tipo === 'plan');
      this.notificar(a.id, a.titulo, estado === 'listo' ? `${NOMBRES[a.proveedor]} terminó` : pide?.tipo === 'pregunta' ? `${NOMBRES[a.proveedor]} te hizo una pregunta` : `${NOMBRES[a.proveedor]} necesita tu permiso`);
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
      historialGemini().catch(() => []),
    ]);
    return partes.flat().sort((a, b) => b.modificado - a.modificado);
  }

  async cargar(proveedor: Proveedor, sessionId: string, cwd: string): Promise<Bloque[]> {
    if (proveedor === 'codex') return cargarCodex(sessionId, cwd);
    if (proveedor === 'gemini') return cargarGemini(sessionId, cwd);
    return (await cargarClaude(sessionId, cwd)).bloques;
  }

  async crear(opciones: { cwd: string; proveedor?: Proveedor; modelo?: string; esfuerzo?: string; modo?: PermissionMode; prompt?: string; reanudar?: string }) {
    const proveedor = opciones.proveedor || 'claude';
    let cwd = opciones.cwd;
    cwd = resolve(cwd.startsWith('~/') ? homedir() + cwd.slice(1) : cwd);
    if (!(await stat(cwd)).isDirectory()) throw new Error('La ruta no es una carpeta.');
    if (proveedor !== 'claude' && proveedor !== 'local' && !instalado(proveedor)) throw new Error(`${NOMBRES[proveedor]} no está instalado.`);
    const { reanudar, prompt } = opciones;
    if (reanudar) {
      const existente = [...this.agentes.values()].find(a => a.sessionId === reanudar && a.proveedor === proveedor);
      if (existente) { if (existente.estado === 'error') existente.motor.iniciar(); if (prompt) this.enviar(existente.id, prompt); this.emitir({ t: 'documento', agente: existente.id, bloques: existente.bloques }); return existente; }
    }
    let bloques: Bloque[] = [], titulo: string | undefined, normalizador;
    if (reanudar) {
      if (proveedor === 'claude' || proveedor === 'local') { const c = await cargarClaude(reanudar, cwd); bloques = c.bloques; normalizador = c.normalizador; titulo = await tituloClaude(reanudar, cwd); }
      else { bloques = await this.cargar(proveedor, reanudar, cwd).catch(() => []); titulo = (await this.historial()).find(s => s.sessionId === reanudar)?.titulo; }
    }
    const a: Agente = { id: randomUUID(), proveedor, sessionId: reanudar, cwd, titulo: titulo || prompt?.slice(0, 60) || 'Nuevo agente', estado: 'iniciando', modelo: opciones.modelo, esfuerzo: opciones.esfuerzo,
      modo: opciones.modo || 'default', sinLeer: false, ultimaActividad: Date.now(), bloques, pendientes: new Map(), cerrado: false, motor: undefined! };
    if (proveedor === 'local' && reanudar && !a.modelo) a.modelo = (await sesionesLocales())[reanudar] || undefined;
    a.motor = proveedor === 'codex' ? new MotorCodex(this, a) : proveedor === 'gemini' ? new MotorGemini(this, a) : new MotorClaude(this, a, normalizador, proveedor === 'local');
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
