import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { query, listSessions, getSessionMessages, getSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import type { Query, SDKUserMessage, CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import type { AskUserQuestionInput } from '@anthropic-ai/claude-agent-sdk/sdk-tools';
import type { Bloque, Op, ResumenAgente, ServidorMensaje, ClienteMensaje, Sesion, Solicitud, PermissionMode } from './protocolo.ts';
import { aplicarOps } from './protocolo.ts';
import { crearNormalizador } from './normalizar.ts';
import { Cola } from './cola.ts';
import { cadena, resumir } from './resumenes.ts';
type Respuesta = Extract<ClienteMensaje, { t: 'responder' }>;
type Pendiente = { responder: (r?: Respuesta) => void };
export type Agente = ResumenAgente & { bloques: Bloque[]; consulta?: Query; cola: Cola<SDKUserMessage>; abortar: AbortController; normalizador: ReturnType<typeof crearNormalizador>; pendientes: Map<string, Pendiente>; cerrado: boolean };
export class GestorAgentes {
  agentes = new Map<string, Agente>();
  emitir: (m: ServidorMensaje) => void;
  notificar: (id: string, titulo: string, texto: string) => void;
  mirando: (id: string) => boolean;
  constructor(emitir: (m: ServidorMensaje) => void, notificar: (id: string, titulo: string, texto: string) => void, mirando: (id: string) => boolean) { this.emitir = emitir; this.notificar = notificar; this.mirando = mirando; }
  resumenes(): ResumenAgente[] { return [...this.agentes.values()].map(({ id, sessionId, titulo, cwd, estado, modelo, modo, sinLeer, ultimaActividad, contexto }) => ({ id, sessionId, titulo, cwd, estado, modelo, modo, sinLeer, ultimaActividad, contexto })); }
  barra() { this.emitir({ t: 'agentes', agentes: this.resumenes() }); }
  ops(a: Agente, ops: Op[]) { if (!ops.length || a.cerrado) return; a.bloques = aplicarOps(a.bloques, ops); this.emitir({ t: 'ops', agente: a.id, ops }); }
  estado(a: Agente, estado: Agente['estado']) {
    const anterior = a.estado; a.estado = estado; a.ultimaActividad = Date.now();
    if (estado === 'listo' && !this.mirando(a.id)) a.sinLeer = true;
    this.barra();
    if (anterior !== estado && (estado === 'esperando' || estado === 'listo')) this.notificar(a.id, a.titulo, estado === 'listo' ? 'Terminó' : 'Necesita tu permiso: ' + (a.bloques.findLast(b => 'solicitud' in b)?.tipo === 'pregunta' ? 'Te hizo una pregunta' : 'Revisa la solicitud en Atril'));
  }
  obtener(id: string) { const a = this.agentes.get(id); if (!a) throw new Error('No se encontró el agente.'); return a; }
  async historial(): Promise<Sesion[]> { return (await listSessions({ limit: 200 })).map(s => ({ sessionId: s.sessionId, titulo: s.customTitle || s.summary || s.firstPrompt?.slice(0, 60) || 'Sin título', cwd: s.cwd || '', modificado: s.lastModified, rama: s.gitBranch && s.gitBranch !== 'HEAD' ? s.gitBranch : undefined })); }
  async cargar(sessionId: string, cwd: string) {
    const n = crearNormalizador(cwd); let bloques: Bloque[] = [];
    for (const m of await getSessionMessages(sessionId, { dir: cwd })) bloques = aplicarOps(bloques, n.procesar(m));
    return { bloques, normalizador: n };
  }
  async crear(cwd: string, modelo?: string, modo: PermissionMode = 'default', prompt?: string, resume?: string) {
    cwd = resolve(cwd.startsWith('~/') ? homedir() + cwd.slice(1) : cwd);
    if (!(await stat(cwd)).isDirectory()) throw new Error('La ruta no es una carpeta.');
    if (resume) {
      const existente = [...this.agentes.values()].find(a => a.sessionId === resume && a.cwd === cwd);
      if (existente) { if (existente.estado === 'error') this.iniciar(existente); if (prompt) this.enviar(existente.id, prompt); this.emitir({ t: 'documento', agente: existente.id, bloques: existente.bloques }); return existente; }
    }
    const cargado = resume ? await this.cargar(resume, cwd) : { bloques: [], normalizador: crearNormalizador(cwd) };
    const sesiones = resume ? await this.historial() : [];
    const a: Agente = { id: randomUUID(), sessionId: resume, cwd, titulo: sesiones.find(s => s.sessionId === resume)?.titulo || prompt?.slice(0, 60) || 'Nuevo agente', estado: 'iniciando', modelo, modo, sinLeer: false, ultimaActividad: Date.now(), ...cargado, cola: new Cola(), abortar: new AbortController(), pendientes: new Map(), cerrado: false };
    this.agentes.set(a.id, a); this.barra(); this.emitir({ t: 'documento', agente: a.id, bloques: a.bloques }); this.iniciar(a);
    if (prompt) this.enviar(a.id, prompt);
    return a;
  }
  iniciar(a: Agente) {
    a.consulta?.close(); a.abortar.abort(); a.cola.cerrar();
    a.abortar = new AbortController(); a.cola = new Cola(); a.cerrado = false;
    this.estado(a, 'iniciando');
    try {
      a.consulta = query({ prompt: a.cola, options: {
        cwd: a.cwd, resume: a.sessionId, model: a.modelo, permissionMode: a.modo,
        settingSources: ['user', 'project', 'local'], systemPrompt: { type: 'preset', preset: 'claude_code' },
        includePartialMessages: true, pathToClaudeCodeExecutable: '/usr/bin/claude', env: { ...process.env },
        canUseTool: this.permisos(a), abortController: a.abortar, allowDangerouslySkipPermissions: a.modo === 'bypassPermissions'
      } });
      void this.consumir(a, a.consulta);
    } catch (e) { this.fallo(a, e); }
  }
  fallo(a: Agente, e: unknown) {
    for (const p of [...a.pendientes.values()]) p.responder();
    this.ops(a, [{ op: 'agregar', bloque: { tipo: 'sistema', id: randomUUID(), texto: `No se pudo continuar la sesión: ${e instanceof Error ? e.message : String(e)}`, nivel: 'error' } }]);
    this.estado(a, 'error');
  }
  async consumir(a: Agente, consulta: Query) {
    try {
      for await (const msg of consulta) {
        if (a.cerrado || a.consulta !== consulta) break;
        if (msg.type === 'system' && msg.subtype === 'status' && msg.permissionMode && msg.permissionMode !== a.modo) { a.modo = msg.permissionMode; this.barra(); }
        if (msg.type === 'system' && msg.subtype === 'init') { a.sessionId = msg.session_id; a.modelo = msg.model; a.modo = msg.permissionMode; this.barra(); if (a.estado === 'iniciando') this.estado(a, 'listo'); }
        if (msg.type === 'assistant' || msg.type === 'stream_event') {
          const ids = msg.user_message_uuids || (msg.user_message_uuid ? [msg.user_message_uuid] : []);
          this.ops(a, ids.map(id => ({ op: 'actualizar', id, cambios: { enCola: false } })));
          if (!a.pendientes.size && a.estado !== 'trabajando') this.estado(a, 'trabajando');
        }
        this.ops(a, a.normalizador.procesar(msg));
        if (msg.type === 'result') {
          this.estado(a, a.pendientes.size ? 'esperando' : 'listo');
          // Título que Claude Code genera para la sesión (el mismo del historial)
          if (a.sessionId) void getSessionInfo(a.sessionId, { dir: a.cwd }).then(info => { const t = info?.customTitle || info?.summary; if (t && t !== a.titulo && t !== info?.firstPrompt) { a.titulo = t.slice(0, 80); this.barra(); } }).catch(() => {});
          if (typeof consulta.getContextUsage === 'function') void consulta.getContextUsage({ detail: 'summary' }).then(c => { if (!a.cerrado && a.consulta === consulta) { a.contexto = { usados: c.totalTokens, total: c.rawMaxTokens }; this.barra(); } }).catch(() => {});
        }
      }
      if (!a.cerrado && a.consulta === consulta) this.fallo(a, new Error('El proceso de Claude terminó. Puedes reanudar la sesión.'));
    } catch (e) { if (!a.cerrado && a.consulta === consulta) this.fallo(a, e); }
  }
  enviar(id: string, texto: string) {
    const a = this.obtener(id);
    if (!texto.trim()) return;
    if (a.estado === 'error') throw new Error('Reanuda el agente antes de enviar un mensaje.');
    const msg: SDKUserMessage = { type: 'user', uuid: randomUUID(), session_id: a.sessionId, message: { role: 'user', content: texto }, parent_tool_use_id: null, timestamp: new Date().toISOString() };
    const ops = a.normalizador.procesar(msg);
    for (const op of ops) if (op.op === 'agregar' && op.bloque.tipo === 'usuario') op.bloque.enCola = a.estado === 'trabajando' || a.estado === 'esperando';
    if (a.titulo === 'Nuevo agente') a.titulo = texto.slice(0, 60);
    this.ops(a, ops); a.cola.poner(msg); this.estado(a, a.pendientes.size ? 'esperando' : 'trabajando');
  }
  permisos(a: Agente): CanUseTool {
    return (herramienta, entrada, opciones) => new Promise<PermissionResult>(resolve => {
      const id = randomUUID(), solicitud: Solicitud = { id, agente: a.id, herramienta, entrada, titulo: opciones.title, descripcion: opciones.description, nombreCorto: opciones.displayName, motivo: opciones.decisionReason, rutaBloqueada: opciones.blockedPath, haySugerencias: !!opciones.suggestions?.length && !opciones.suppressAlwaysAllowRule };
      const bloque: Bloque = herramienta === 'AskUserQuestion' ? { tipo: 'pregunta', id, solicitud, estado: 'pendiente' } : herramienta === 'ExitPlanMode' ? { tipo: 'plan', id, solicitud, md: cadena(entrada.plan) || a.bloques.filter(b => b.tipo === 'texto').map(b => b.md).at(-1) || 'Revisa el plan de la conversación antes de aprobarlo.', estado: 'pendiente' } : { tipo: 'permiso', id, solicitud, estado: 'pendiente' };
      let resuelto = false;
      const responder = (r?: Respuesta) => {
        if (resuelto) return; resuelto = true; opciones.signal.removeEventListener('abort', cancelar); a.pendientes.delete(id);
        const permitir = r && r.decision !== 'rechazar';
        const estado = bloque.tipo === 'pregunta' ? permitir ? 'respondida' : 'cancelada' : bloque.tipo === 'plan' ? permitir ? 'aprobado' : 'rechazado' : !r ? 'cancelado' : permitir ? 'permitido' : 'rechazado';
        this.ops(a, [{ op: 'actualizar', id, cambios: { estado, ...(bloque.tipo === 'pregunta' ? { respuestas: r?.respuestas } : {}) } }]);
        if (permitir) {
          const answers: AskUserQuestionInput['answers'] = r.respuestas || {};
          resolve({ behavior: 'allow', updatedInput: herramienta === 'AskUserQuestion' ? { ...entrada, answers } : entrada, updatedPermissions: r.decision === 'siempre' && solicitud.haySugerencias ? opciones.suggestions : undefined });
        } else resolve({ behavior: 'deny', message: r?.mensaje || (r ? 'El usuario rechazó esta acción.' : 'La solicitud fue cancelada.') });
        if (!a.cerrado) this.estado(a, a.pendientes.size ? 'esperando' : 'trabajando');
      };
      const cancelar = () => responder();
      a.pendientes.set(id, { responder }); this.ops(a, [{ op: 'agregar', bloque }]); this.estado(a, 'esperando');
      opciones.signal.addEventListener('abort', cancelar, { once: true }); if (opciones.signal.aborted) cancelar();
    });
  }
  responder(r: Respuesta) { const p = this.obtener(r.agente).pendientes.get(r.solicitud); if (!p) throw new Error('La solicitud ya fue resuelta o cancelada.'); p.responder(r); }
  cerrar(id: string) { const a = this.obtener(id); a.cerrado = true; for (const p of [...a.pendientes.values()]) p.responder(); a.cola.cerrar(); a.abortar.abort(); a.consulta?.close(); this.agentes.delete(id); this.barra(); }
}
