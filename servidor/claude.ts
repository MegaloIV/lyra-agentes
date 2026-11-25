// Claude Code por el Agent SDK.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { query, listSessions, getSessionMessages, getSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import type { Query, SDKUserMessage, CanUseTool, PermissionResult, EffortLevel } from '@anthropic-ai/claude-agent-sdk';
import type { AskUserQuestionInput } from '@anthropic-ai/claude-agent-sdk/sdk-tools';
import type { Bloque, Comando, Limite, Modelo, PermissionMode, Sesion, Solicitud, Ventana } from './protocolo.ts';
import { aplicarOps } from './protocolo.ts';
import { crearNormalizador } from './normalizar.ts';
import { Cola } from './cola.ts';
import { leerFinal, SeguidorFondo } from './fondo.ts';
import { ContadorTokens } from './tokens.ts';
import { cadena } from './resumenes.ts';
import type { Agente, Contexto, Motor } from './motor.ts';
import { anotarLocal, entornoLocal, HERRAMIENTAS_LOCALES, asegurarOllama, modelosLocales } from './local.ts';

const EJECUTABLE = '/usr/bin/claude';

export async function historialClaude(): Promise<Sesion[]> {
  return (await listSessions({ limit: 5000 })).map(s => ({ proveedor: 'claude' as const, sessionId: s.sessionId, titulo: s.customTitle || s.summary || s.firstPrompt?.slice(0, 60) || 'Sin título', cwd: s.cwd || '', modificado: s.lastModified, rama: s.gitBranch && s.gitBranch !== 'HEAD' ? s.gitBranch : undefined }));
}

export async function cargarClaude(sessionId: string, cwd: string) {
  const n = crearNormalizador(cwd); let bloques: Bloque[] = [];
  for (const m of await getSessionMessages(sessionId, { dir: cwd })) bloques = aplicarOps(bloques, n.procesar(m));
  // Sin el proceso que las lanzó, las shells de fondo ya no corren; la salida que dejaron se lee del archivo si sigue ahí
  bloques = aplicarOps(bloques, n.cerrarFondos());
  for (const b of bloques) if (b.tipo === 'herramienta' && b.terminal?.tarea && b.terminal.archivo && !b.terminal.salida) {
    const r = await leerFinal(b.terminal.archivo);
    if (r?.texto) bloques = aplicarOps(bloques, n.ponerSalida(b.id, r.texto));
  }
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
    for (const m of lista) if (m.resolvedModel) resueltos.set(m.value === 'default' ? null : m.value, m.resolvedModel);
    return conEsfuerzoClaude(lista.map(m => ({ valor: m.value === 'default' ? null : m.value, nombre: m.value === 'default' ? 'Predeterminado' : m.displayName, descripcion: m.description, esfuerzos: m.supportsEffort ? m.supportedEffortLevels : undefined })));
  } finally { vacia.cerrar(); q.close(); }
}

/** El id real detrás de cada alias («opus» → claude-opus-5-5), para buscar su ajuste */
const resueltos = new Map<string | null, string>();
/** El esfuerzo que usa Claude Code si Lyra no elige ninguno: el del modelo en ~/.claude/settings.json o, si no, el general.
 *  Se lee cada vez, así un cambio en el archivo se ve sin reiniciar. */
export function conEsfuerzoClaude(lista: Modelo[]): Modelo[] {
  let ajustes: { effortLevel?: unknown; modelSettings?: Record<string, { effortLevel?: unknown }> } = {};
  try { ajustes = JSON.parse(readFileSync(join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json'), 'utf8')); } catch { /* sin ajustes */ }
  const texto = (v: unknown) => typeof v === 'string' && v ? v : undefined;
  return lista.map(m => {
    if (!m.esfuerzos) return m;
    const id = resueltos.get(m.valor) ?? m.valor ?? undefined;
    const defecto = texto(id && ajustes.modelSettings?.[id]?.effortLevel) ?? texto(ajustes.effortLevel);
    return { ...m, esfuerzoDefecto: defecto && m.esfuerzos.includes(defecto) ? defecto : undefined };
  });
}

/** Los comandos de Claude Code sin un agente abierto (para escribir «/» en una conversación del historial); se piden una vez */
let comandosGuardados: Promise<Comando[]> | undefined;
export function comandosClaude(): Promise<Comando[]> {
  comandosGuardados ??= (async () => {
    const vacia = new Cola<SDKUserMessage>();
    const q = query({ prompt: vacia, options: { pathToClaudeCodeExecutable: EJECUTABLE, settingSources: ['user', 'project', 'local'], env: { ...process.env } } });
    try { return (await Promise.race([q.supportedCommands(), new Promise<never>((_, mal) => setTimeout(() => mal(new Error('tiempo')), 20000))])).map(c => ({ nombre: c.name, descripcion: c.description })); }
    finally { vacia.cerrar(); q.close(); }
  })();
  comandosGuardados.catch(() => { comandosGuardados = undefined; });
  return comandosGuardados;
}

/** Los límites del plan de claude.ai (los mismos de /usage), de la API experimental del SDK */
type Uso = Awaited<ReturnType<Query['usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET']>>;
const usoDe = (q: Query) => Promise.race([q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }), new Promise<never>((_, mal) => setTimeout(() => mal(new Error('tiempo')), 20000))]);
function limiteDe(u: Uso): Limite {
  const plan = u.subscription_type ? u.subscription_type[0]!.toUpperCase() + u.subscription_type.slice(1) : undefined;
  const r = u.rate_limits;
  if (!u.rate_limits_available || !r) return { proveedor: 'claude', plan, ventanas: [], nota: 'sin límites de plan' };
  const ventana = (tipo: Ventana['tipo'], nombre: string, v?: { utilization: number | null; resets_at: string | null } | null): Ventana[] =>
    v && typeof v.utilization === 'number' ? [{ tipo, nombre, usado: Math.round(v.utilization), renueva: v.resets_at ? Date.parse(v.resets_at) || undefined : undefined }] : [];
  return { proveedor: 'claude', plan, ventanas: [
    ...ventana('corta', '5 h', r.five_hour), ...ventana('larga', 'Semana', r.seven_day),
    ...ventana('larga', 'Opus (semana)', r.seven_day_opus), ...ventana('larga', 'Sonnet (semana)', r.seven_day_sonnet),
    ...(r.model_scoped || []).flatMap(m => ventana('larga', `${m.display_name} (semana)`, m)),
  ] };
}
/** Sin un agente abierto se le preguntan a una consulta vacía (no gasta nada) */
export async function limitesClaude(): Promise<Limite> {
  const vacia = new Cola<SDKUserMessage>();
  const q = query({ prompt: vacia, options: { pathToClaudeCodeExecutable: EJECUTABLE, settingSources: ['user'], env: { ...process.env } } });
  try { return limiteDe(await usoDe(q)); } finally { vacia.cerrar(); q.close(); }
}
/** Al terminar cada turno de Claude (no local) se leen de su misma consulta y se avisan */
let alUsarClaude: (l: Limite) => void = () => {};
export function avisarUsoClaude(f: (l: Limite) => void) { alUsarClaude = f; }

export class MotorClaude implements Motor {
  private consulta?: Query;
  private cola = new Cola<SDKUserMessage>();
  private abortar = new AbortController();
  normalizador: ReturnType<typeof crearNormalizador>;
  private ctx: Contexto;
  private a: Agente;
  /** `local`: el mismo Claude Code, pero con un modelo de Ollama (servidor/local.ts) */
  private local: boolean;
  private fondo: SeguidorFondo;
  /** Los tokens que va escribiendo en el turno, para el contador de abajo */
  private tokens = new ContadorTokens();
  constructor(ctx: Contexto, a: Agente, normalizador?: ReturnType<typeof crearNormalizador>, local = false) {
    this.ctx = ctx; this.a = a; this.local = local; this.normalizador = normalizador || crearNormalizador(a.cwd);
    this.fondo = new SeguidorFondo(this.normalizador, ops => { if (!this.a.cerrado && ops.length) this.ctx.ops(this.a, ops); });
  }

  /** Las shells de fondo mueren con el proceso de Claude */
  private cerrarFondos() {
    const ops = this.normalizador.cerrarFondos();
    if (ops.length) { this.ctx.ops(this.a, ops); this.fondo.revisar(ops); }
  }

  iniciar() {
    const a = this.a;
    this.consulta?.close(); this.abortar.abort(); this.cola.cerrar(); this.cerrarFondos();
    this.abortar = new AbortController(); this.cola = new Cola(); a.cerrado = false; this.tokens.reiniciar();
    this.ctx.estado(a, 'iniciando');
    if (this.local) { void this.iniciarLocal(); return; }
    this.arrancar({ model: a.modelo, effort: a.esfuerzo as EffortLevel | undefined, settingSources: ['user', 'project', 'local'], env: { ...process.env } });
  }

  /** Ollama tiene que estar corriendo y el modelo elegido (o el primero que sirva) */
  private async iniciarLocal() {
    const a = this.a;
    try {
      if (!await asegurarOllama()) throw new Error('No se pudo conectar con Ollama. Revisa que esté instalado o corriendo.');
      if (!a.modelo) { a.modelo = (await modelosLocales())[0]?.valor || undefined; this.ctx.barra(); }
      if (!a.modelo) throw new Error('Ollama no tiene ningún modelo que sepa usar herramientas.');
      // Sin las instrucciones del usuario (~/.claude) ni sus plugins: solo las del proyecto, para ahorrar contexto
      this.arrancar({ model: a.modelo, settingSources: ['project', 'local'], env: entornoLocal(a.modelo), tools: HERRAMIENTAS_LOCALES });
    } catch (e) { this.ctx.fallo(a, e); }
  }

  private arrancar(extra: Pick<Parameters<typeof query>[0]['options'] & {}, 'model' | 'effort' | 'settingSources' | 'env' | 'tools'>) {
    const a = this.a;
    try {
      this.consulta = query({ prompt: this.cola, options: {
        cwd: a.cwd, resume: a.sessionId, permissionMode: a.modo, systemPrompt: { type: 'preset', preset: 'claude_code' },
        includePartialMessages: true, pathToClaudeCodeExecutable: EJECUTABLE, ...extra,
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
        if (msg.type === 'system' && msg.subtype === 'init') { if (this.local && msg.session_id !== a.sessionId) void anotarLocal(msg.session_id, msg.model); a.sessionId = msg.session_id; a.modelo = msg.model; a.modo = msg.permissionMode; ctx.barra(); if (a.estado === 'iniciando') ctx.estado(a, 'listo'); }
        if (msg.type === 'assistant' || msg.type === 'stream_event') {
          const ids = msg.user_message_uuids || (msg.user_message_uuid ? [msg.user_message_uuid] : []);
          ctx.ops(a, ids.map(id => ({ op: 'actualizar', id, cambios: { enCola: false } })));
          if (!a.pendientes.size && a.estado !== 'trabajando') ctx.estado(a, 'trabajando');
        }
        if (this.tokens.procesar(msg)) ctx.progreso(a, this.tokens.total, this.tokens.fase);
        // Terminó un mensaje que pidió herramientas: mientras corren, el contador dice que está usándolas
        if (msg.type === 'assistant' && !msg.parent_tool_use_id && Array.isArray(msg.message.content) && msg.message.content.some(c => c.type === 'tool_use')) { this.tokens.usandoHerramientas(); ctx.progreso(a, this.tokens.total, 'herramienta'); }
        const ops = this.normalizador.procesar(msg);
        ctx.ops(a, ops); this.fondo.revisar(ops);
        if (msg.type === 'result') {
          // Lo que informó la API manda sobre lo estimado; el próximo turno empieza de cero
          ctx.progreso(a, Math.max(this.tokens.total, msg.usage?.output_tokens || 0));
          this.tokens.reiniciar();
          ctx.estado(a, a.pendientes.size ? 'esperando' : 'listo');
          // Título que Claude Code genera para la sesión (el mismo del historial)
          if (a.sessionId) void getSessionInfo(a.sessionId, { dir: a.cwd }).then(info => { const t = info?.customTitle || info?.summary; if (t && t !== a.titulo && t !== info?.firstPrompt) { a.titulo = t.slice(0, 80); ctx.barra(); } }).catch(() => {});
          if (typeof consulta.getContextUsage === 'function') void consulta.getContextUsage({ detail: 'summary' }).then(c => { if (!a.cerrado && this.consulta === consulta) { a.contexto = { usados: c.totalTokens, total: c.rawMaxTokens }; ctx.barra(); } }).catch(() => {});
          if (!this.local && typeof consulta.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET === 'function') void usoDe(consulta).then(u => alUsarClaude(limiteDe(u))).catch(() => {});
        }
      }
      if (!a.cerrado && this.consulta === consulta) this.cerrarFondos();
      if (!a.cerrado && this.consulta === consulta) ctx.fallo(a, new Error(`El proceso de ${this.local ? 'el agente local' : 'Claude'} terminó. Puedes reanudar la sesión.`));
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
  async modelo(m?: string) {
    // En local, el modelo va en el entorno (también el de fondo): se cambia arrancando de nuevo sobre la misma sesión
    if (this.local) { if (m && m !== this.a.modelo) { this.a.modelo = m; if (this.a.estado !== 'trabajando') this.iniciar(); } return; }
    await this.consulta?.setModel(m); this.a.modelo = m;
  }
  async esfuerzo(e?: string) { if (this.local) return; await this.consulta?.applyFlagSettings({ effortLevel: (e ?? null) as EffortLevel | null }); this.a.esfuerzo = e; }
  async comandos(): Promise<Comando[]> { return (await this.consulta?.supportedCommands() || []).map(c => ({ nombre: c.name, descripcion: c.description })); }
  cerrar() { this.fondo.parar(); this.cola.cerrar(); this.abortar.abort(); this.consulta?.close(); }
}
