// Claude Code por el Agent SDK.
import { randomUUID } from 'node:crypto';
import { query, listSessions, getSessionMessages, getSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import type { Query, SDKUserMessage, CanUseTool, PermissionResult, EffortLevel } from '@anthropic-ai/claude-agent-sdk';
import type { AskUserQuestionInput } from '@anthropic-ai/claude-agent-sdk/sdk-tools';
import type { Bloque, Comando, Modelo, PermissionMode, Sesion, Solicitud } from './protocolo.ts';
import { aplicarOps } from './protocolo.ts';
import { crearNormalizador } from './normalizar.ts';
import { Cola } from './cola.ts';
import { cadena } from './resumenes.ts';
import type { Agente, Contexto, Motor } from './motor.ts';

const EJECUTABLE = '/usr/bin/claude';

export async function historialClaude(): Promise<Sesion[]> {
  return (await listSessions({ limit: 200 })).map(s => ({ proveedor: 'claude' as const, sessionId: s.sessionId, titulo: s.customTitle || s.summary || s.firstPrompt?.slice(0, 60) || 'Sin título', cwd: s.cwd || '', modificado: s.lastModified, rama: s.gitBranch && s.gitBranch !== 'HEAD' ? s.gitBranch : undefined }));
}

export async function cargarClaude(sessionId: string, cwd: string) {
  const n = crearNormalizador(cwd); let bloques: Bloque[] = [];
  for (const m of await getSessionMessages(sessionId, { dir: cwd })) bloques = aplicarOps(bloques, n.procesar(m));
  return { bloques, normalizador: n };
}

export async function tituloClaude(sessionId: string, cwd: string) {
  return (await historialClaude().catch(() => [])).find(s => s.sessionId === sessionId && (!cwd || s.cwd === cwd))?.titulo;
}

/** Los modelos que ofrece Claude Code a esta cuenta: se los pide a una consulta vacía, que no gasta nada */
export async function modelosClaude(): Promise<Modelo[]> {
  const vacia = new Cola<SDKUserMessage>();
  const q = query({ prompt: vacia, options: { pathToClaudeCodeExecutable: EJECUTABLE, settingSources: ['user'], env: { ...process.env } } });
  try {
    const lista = await Promise.race([q.supportedModels(), new Promise<never>((_, mal) => setTimeout(() => mal(new Error('tiempo')), 20000))]);
    return lista.map(m => ({ valor: m.value === 'default' ? null : m.value, nombre: m.value === 'default' ? 'Predeterminado' : m.displayName, descripcion: m.description, esfuerzos: m.supportsEffort ? m.supportedEffortLevels : undefined }));
  } finally { vacia.cerrar(); q.close(); }
}

export class MotorClaude implements Motor {
  private consulta?: Query;
  private cola = new Cola<SDKUserMessage>();
  private abortar = new AbortController();
  normalizador: ReturnType<typeof crearNormalizador>;
  private ctx: Contexto;
  private a: Agente;
  constructor(ctx: Contexto, a: Agente, normalizador?: ReturnType<typeof crearNormalizador>) {
    this.ctx = ctx; this.a = a; this.normalizador = normalizador || crearNormalizador(a.cwd); }

  iniciar() {
    const a = this.a;
    this.consulta?.close(); this.abortar.abort(); this.cola.cerrar();
    this.abortar = new AbortController(); this.cola = new Cola(); a.cerrado = false;
    this.ctx.estado(a, 'iniciando');
    try {
      this.consulta = query({ prompt: this.cola, options: {
        cwd: a.cwd, resume: a.sessionId, model: a.modelo, permissionMode: a.modo, effort: a.esfuerzo as EffortLevel | undefined,
        settingSources: ['user', 'project', 'local'], systemPrompt: { type: 'preset', preset: 'claude_code' },
        includePartialMessages: true, pathToClaudeCodeExecutable: EJECUTABLE, env: { ...process.env },
        canUseTool: this.permisos(), abortController: this.abortar, allowDangerouslySkipPermissions: a.modo === 'bypassPermissions'
      } });
      void this.consumir(this.consulta);
    } catch (e) { this.ctx.fallo(a, e); }
  }

  private async consumir(consulta: Query) {
    const a = this.a, ctx = this.ctx;
    try {
      for await (const msg of consulta) {
        if (a.cerrado || this.consulta !== consulta) break;
        if (msg.type === 'system' && msg.subtype === 'status' && msg.permissionMode && msg.permissionMode !== a.modo) { a.modo = msg.permissionMode; ctx.barra(); }
        if (msg.type === 'system' && msg.subtype === 'init') { a.sessionId = msg.session_id; a.modelo = msg.model; a.modo = msg.permissionMode; ctx.barra(); if (a.estado === 'iniciando') ctx.estado(a, 'listo'); }
        if (msg.type === 'assistant' || msg.type === 'stream_event') {
          const ids = msg.user_message_uuids || (msg.user_message_uuid ? [msg.user_message_uuid] : []);
          ctx.ops(a, ids.map(id => ({ op: 'actualizar', id, cambios: { enCola: false } })));
          if (!a.pendientes.size && a.estado !== 'trabajando') ctx.estado(a, 'trabajando');
        }
        ctx.ops(a, this.normalizador.procesar(msg));
        if (msg.type === 'result') {
          ctx.estado(a, a.pendientes.size ? 'esperando' : 'listo');
          // Título que Claude Code genera para la sesión (el mismo del historial)
          if (a.sessionId) void getSessionInfo(a.sessionId, { dir: a.cwd }).then(info => { const t = info?.customTitle || info?.summary; if (t && t !== a.titulo && t !== info?.firstPrompt) { a.titulo = t.slice(0, 80); ctx.barra(); } }).catch(() => {});
          if (typeof consulta.getContextUsage === 'function') void consulta.getContextUsage({ detail: 'summary' }).then(c => { if (!a.cerrado && this.consulta === consulta) { a.contexto = { usados: c.totalTokens, total: c.rawMaxTokens }; ctx.barra(); } }).catch(() => {});
        }
      }
      if (!a.cerrado && this.consulta === consulta) ctx.fallo(a, new Error('El proceso de Claude terminó. Puedes reanudar la sesión.'));
    } catch (e) { if (!a.cerrado && this.consulta === consulta) ctx.fallo(a, e); }
  }

  enviar(texto: string) {
    const a = this.a;
    const msg: SDKUserMessage = { type: 'user', uuid: randomUUID(), session_id: a.sessionId, message: { role: 'user', content: texto }, parent_tool_use_id: null, timestamp: new Date().toISOString() };
    const ops = this.normalizador.procesar(msg);
    for (const op of ops) if (op.op === 'agregar' && op.bloque.tipo === 'usuario') op.bloque.enCola = a.estado === 'trabajando' || a.estado === 'esperando';
    this.ctx.ops(a, ops); this.cola.poner(msg); this.ctx.estado(a, a.pendientes.size ? 'esperando' : 'trabajando');
  }

  private permisos(): CanUseTool {
    const a = this.a;
    return (herramienta, entrada, opciones) => new Promise<PermissionResult>(resolve => {
      const id = randomUUID(), solicitud: Solicitud = { id, agente: a.id, herramienta, entrada, titulo: opciones.title, descripcion: opciones.description, nombreCorto: opciones.displayName, motivo: opciones.decisionReason, rutaBloqueada: opciones.blockedPath, haySugerencias: !!opciones.suggestions?.length && !opciones.suppressAlwaysAllowRule };
      const bloque = herramienta === 'AskUserQuestion' ? { tipo: 'pregunta' as const, id, solicitud, estado: 'pendiente' as const }
        : herramienta === 'ExitPlanMode' ? { tipo: 'plan' as const, id, solicitud, md: cadena(entrada.plan) || a.bloques.filter(b => b.tipo === 'texto').map(b => b.md).at(-1) || 'Revisa el plan de la conversación antes de aprobarlo.', estado: 'pendiente' as const }
        : { tipo: 'permiso' as const, id, solicitud, estado: 'pendiente' as const };
      const cancelar = this.ctx.solicitar(a, bloque, r => {
        opciones.signal.removeEventListener('abort', cancelar);
        if (r && r.decision !== 'rechazar') {
          const answers: AskUserQuestionInput['answers'] = r.respuestas || {};
          resolve({ behavior: 'allow', updatedInput: herramienta === 'AskUserQuestion' ? { ...entrada, answers } : entrada, updatedPermissions: r.decision === 'siempre' && solicitud.haySugerencias ? opciones.suggestions : undefined });
        } else resolve({ behavior: 'deny', message: r?.mensaje || (r ? 'El usuario rechazó esta acción.' : 'La solicitud fue cancelada.') });
      });
      opciones.signal.addEventListener('abort', cancelar, { once: true }); if (opciones.signal.aborted) cancelar();
    });
  }

  async interrumpir() { await this.consulta?.interrupt(); }
  async modo(m: PermissionMode) { await this.consulta?.setPermissionMode(m); this.a.modo = m; }
  async modelo(m?: string) { await this.consulta?.setModel(m); this.a.modelo = m; }
  async esfuerzo(e?: string) { await this.consulta?.applyFlagSettings({ effortLevel: (e ?? null) as EffortLevel | null }); this.a.esfuerzo = e; }
  async comandos(): Promise<Comando[]> { return (await this.consulta?.supportedCommands() || []).map(c => ({ nombre: c.name, descripcion: c.description })); }
  cerrar() { this.cola.cerrar(); this.abortar.abort(); this.consulta?.close(); }
}
