// Agente local: Claude Code (el mismo motor que el proveedor Claude) apuntado a un Ollama de esta máquina,
// que habla la API de Anthropic (/v1/messages). Nada sale de la computadora.
//
//   LYRA_AGENTES_OLLAMA       dirección de Ollama (por defecto http://127.0.0.1:11434)
//   LYRA_AGENTES_OLLAMA_BIN   si Ollama no está corriendo, se arranca con este ejecutable (o `ollama` del PATH)
//   OLLAMA_MODELS             carpeta de modelos, si no es la de siempre (pasa tal cual a `ollama serve`)
//
// Solo se ofrecen modelos que saben usar herramientas y tienen al menos 16k de contexto: Claude Code manda unas
// instrucciones largas y con menos se corta.
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { InfoProveedor, Modelo } from './protocolo.ts';
import { instalado } from './motor.ts';

export const URL_OLLAMA = (process.env.LYRA_AGENTES_OLLAMA || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const CONTEXTO_MINIMO = 16384;
/** Herramientas que se le dan: pocas, para que las instrucciones quepan y un modelo chico no se pierda */
export const HERRAMIENTAS_LOCALES = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'TodoWrite'];

export const MODOS_LOCAL: InfoProveedor['modos'] = [
  { valor: 'default', nombre: 'Preguntar' },
  { valor: 'acceptEdits', nombre: 'Aceptar ediciones' },
  { valor: 'plan', nombre: 'Planificar' },
  { valor: 'bypassPermissions', nombre: 'Sin preguntar' },
];

const pedir = async (ruta: string, cuerpo?: unknown, ms = 4000) => {
  const r = await fetch(URL_OLLAMA + ruta, { method: cuerpo ? 'POST' : 'GET', body: cuerpo ? JSON.stringify(cuerpo) : undefined, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`Ollama respondió ${r.status}`);
  return r.json() as Promise<Record<string, unknown>>;
};
const vivo = () => pedir('/api/version', undefined, 1500).then(() => true, () => false);

function binario(): string {
  const b = process.env.LYRA_AGENTES_OLLAMA_BIN?.replace(/^~(?=\/)/, homedir());
  return b || (instalado('ollama') ? 'ollama' : '');
}

/** Arranca Ollama si no está corriendo (queda corriendo para los demás); devuelve si quedó disponible */
let arrancando: Promise<boolean> | undefined;
export function asegurarOllama(): Promise<boolean> {
  return arrancando ??= (async () => {
    if (await vivo()) return true;
    const bin = binario();
    if (!bin) return false;
    const host = new URL(URL_OLLAMA).host;
    const p = spawn(bin, ['serve'], { detached: true, stdio: 'ignore', env: { ...process.env, OLLAMA_HOST: host } });
    p.on('error', () => {}); p.unref();
    for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 250)); if (await vivo()) return true; }
    return false;
  })().finally(() => { arrancando = undefined; });
}

const legible = (n: string) => n.replace(/:latest$/, '');

/** Modelos con herramientas y contexto suficiente, del más chico al más grande */
export async function modelosLocales(): Promise<Modelo[]> {
  const tags = await pedir('/api/tags');
  const lista = Array.isArray(tags.models) ? tags.models as Record<string, any>[] : [];
  const salida: (Modelo & { tam: number })[] = [];
  await Promise.all(lista.map(async m => {
    const nombre = String(m.name || m.model || '');
    if (!nombre) return;
    const info = await pedir('/api/show', { model: nombre }).catch(() => null);
    const capacidades = Array.isArray(info?.capabilities) ? info!.capabilities as string[] : [];
    if (!capacidades.includes('tools') || !capacidades.includes('completion')) return;
    const ctx = Number(/(?:^|\n)num_ctx\s+(\d+)/.exec(String(info?.parameters || ''))?.[1] || 0);
    if (ctx && ctx < CONTEXTO_MINIMO) return;
    const d = (m.details || {}) as Record<string, string>;
    salida.push({ valor: nombre, nombre: legible(nombre), tam: Number(m.size) || 0,
      descripcion: [d.parameter_size, d.quantization_level, ctx ? `${Math.round(ctx / 1024)}k de contexto` : ''].filter(Boolean).join(' · ') });
  }));
  return salida.sort((a, b) => a.tam - b.tam).map(({ tam: _, ...m }) => m);
}

export async function infoLocal(): Promise<InfoProveedor> {
  const base = { id: 'local' as const, nombre: 'Local', modos: MODOS_LOCAL };
  const hay = !!binario() || await vivo();
  if (!hay) return { ...base, instalado: false, sesion: false, modelos: [] };
  const modelos = await asegurarOllama().then(ok => ok ? modelosLocales() : []).catch(() => []);
  return { ...base, instalado: true, sesion: modelos.length > 0, modelos };
}

/** El entorno de Claude Code para hablar con Ollama: todo pasa por el modelo local, también lo de fondo */
export function entornoLocal(modelo: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ANTHROPIC_API_KEY; delete env.CLAUDE_CODE_PLUGIN_DIRS; delete env.CLAUDE_CODE_USE_BEDROCK; delete env.CLAUDE_CODE_USE_VERTEX;
  return {
    ...env,
    ANTHROPIC_BASE_URL: URL_OLLAMA, ANTHROPIC_AUTH_TOKEN: 'ollama', ANTHROPIC_API_KEY: '',
    ANTHROPIC_MODEL: modelo, ANTHROPIC_DEFAULT_OPUS_MODEL: modelo, ANTHROPIC_DEFAULT_SONNET_MODEL: modelo,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: modelo, ANTHROPIC_SMALL_FAST_MODEL: modelo, CLAUDE_CODE_SUBAGENT_MODEL: modelo,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
    // Que no intente pensar con presupuesto de Claude ni pedir 32k de salida a un modelo chico
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: '8192', MAX_THINKING_TOKENS: '0',
  };
}

// Qué conversaciones de Claude Code son locales (se guardan en el mismo lugar que las de Claude)
const REGISTRO = join(homedir(), '.local/state/lyra-agentes/local-sesiones.json');
let cache: Record<string, string> | null = null;
export async function sesionesLocales(): Promise<Record<string, string>> {
  if (cache) return cache;
  try { const v = JSON.parse(await readFile(REGISTRO, 'utf8')); cache = v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { cache = {}; }
  return cache!;
}
let fila: Promise<unknown> = Promise.resolve();
async function guardar(cambio: (r: Record<string, string>) => void) {
  const p = fila.then(async () => {
    const r = { ...await sesionesLocales() }; cambio(r);
    await mkdir(join(REGISTRO, '..'), { recursive: true, mode: 0o700 });
    await writeFile(REGISTRO + '.tmp', JSON.stringify(r), { mode: 0o600 }); await rename(REGISTRO + '.tmp', REGISTRO);
    cache = r;
  });
  fila = p.catch(() => {});
  return p;
}
export const anotarLocal = (sessionId: string, modelo: string) => guardar(r => { r[sessionId] = modelo; });
export const olvidarLocal = (sessionId: string) => guardar(r => { delete r[sessionId]; });
