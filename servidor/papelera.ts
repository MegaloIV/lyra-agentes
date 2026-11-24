// Borrar y renombrar conversaciones guardadas. Borrar nunca es definitivo:
// Claude y Gemini van a la papelera del escritorio (se recuperan desde el gestor de archivos)
// y Codex las archiva (siguen en ~/.codex/archived_sessions).
import { execFile } from 'node:child_process';
import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { renameSession } from '@anthropic-ai/claude-agent-sdk';
import type { Proveedor } from './protocolo.ts';
import { archivarCodex, renombrarCodex } from './codex.ts';
import { quitarDeRegistro, renombrarEnRegistro } from './gemini.ts';

const ID = /^[\w-]{1,100}$/;

export function aPapelera(rutas: string[]): Promise<void> {
  if (!rutas.length) return Promise.resolve();
  return new Promise((bien, mal) => execFile('gio', ['trash', '--', ...rutas], (e, _o, err) => e ? mal(new Error(`No se pudo mover a la papelera: ${err.trim() || e.message}`)) : bien()));
}

const existe = (r: string) => stat(r).then(() => true, () => false);

/** El transcript de Claude (y la carpeta de sus subagentes), en cualquier proyecto */
async function archivosClaude(sessionId: string): Promise<string[]> {
  const base = join(homedir(), '.claude/projects'), rutas: string[] = [];
  for (const dir of await readdir(base).catch(() => [])) {
    for (const r of [join(base, dir, `${sessionId}.jsonl`), join(base, dir, sessionId)]) if (await existe(r)) rutas.push(r);
  }
  return rutas;
}

/** Los archivos de Gemini: ~/.gemini/tmp/<proyecto>/chats/session-…-<8 primeros>.jsonl, con el id en la primera línea */
async function archivosGemini(sessionId: string): Promise<string[]> {
  const base = join(homedir(), '.gemini/tmp'), corto = sessionId.slice(0, 8), rutas: string[] = [];
  for (const dir of await readdir(base).catch(() => [])) {
    const chats = join(base, dir, 'chats');
    for (const f of await readdir(chats).catch(() => [])) {
      if (!f.includes(corto)) continue;
      const ruta = join(chats, f), h = await open(ruta, 'r').catch(() => null);
      if (!h) continue;
      const { buffer, bytesRead } = await h.read(Buffer.alloc(600), 0, 600, 0).finally(() => h.close());
      if (buffer.subarray(0, bytesRead).toString('utf8').includes(sessionId)) rutas.push(ruta);
    }
  }
  return rutas;
}

/** Devuelve un texto para avisar qué pasó */
export async function borrarSesion(proveedor: Proveedor, sessionId: string): Promise<string> {
  if (!ID.test(sessionId)) throw new Error('La conversación no es válida.');
  if (proveedor === 'codex') { await archivarCodex(sessionId); return 'Conversación archivada en Codex.'; }
  const rutas = proveedor === 'gemini' ? await archivosGemini(sessionId) : await archivosClaude(sessionId);
  if ((proveedor === 'claude' || proveedor === 'local') && !rutas.length) throw new Error('No se encontró el archivo de esa conversación.');
  await aPapelera(rutas);
  if (proveedor === 'gemini') await quitarDeRegistro(sessionId);
  if (proveedor === 'local') await (await import('./local.ts')).olvidarLocal(sessionId);
  return 'Conversación movida a la papelera.';
}

export async function renombrarSesion(proveedor: Proveedor, sessionId: string, titulo: string, cwd?: string) {
  if (!ID.test(sessionId)) throw new Error('La conversación no es válida.');
  if (proveedor === 'codex') return renombrarCodex(sessionId, titulo);
  if (proveedor === 'gemini') return renombrarEnRegistro(sessionId, titulo);
  return renameSession(sessionId, titulo, cwd ? { dir: cwd } : undefined).catch(() => renameSession(sessionId, titulo));
}
