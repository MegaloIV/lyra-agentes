// Carpetas propias para ordenar las conversaciones (las crea el usuario; no son carpetas del disco).
// Se guardan en ~/.local/state/lyra-agentes/carpetas.json: qué carpetas hay y en cuál está cada sesión.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Grupos } from './protocolo.ts';
import { objeto } from './resumenes.ts';

const archivo = join(homedir(), '.local/state/lyra-agentes/carpetas.json');
let cache: Grupos | null = null;

/** Deja solo lo válido: ids y nombres cortos, sesiones que apuntan a carpetas que existen */
export function limpiarGrupos(valor: unknown): Grupos {
  const v = objeto(valor), lista = Array.isArray(v.carpetas) ? v.carpetas.map(objeto) : [];
  const carpetas: Grupos['carpetas'] = [];
  for (const c of lista.slice(0, 200)) {
    const id = typeof c.id === 'string' && /^[\w-]{1,40}$/.test(c.id) ? c.id : '';
    const nombre = typeof c.nombre === 'string' ? c.nombre.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
    if (id && nombre && !carpetas.some(x => x.id === id)) carpetas.push({ id, nombre, abierta: c.abierta !== false });
  }
  const ids = new Set(carpetas.map(c => c.id)), sesiones: Record<string, string> = {};
  for (const [s, c] of Object.entries(objeto(v.sesiones)).slice(0, 5000)) if (s.length <= 200 && typeof c === 'string' && ids.has(c)) sesiones[s] = c;
  return { carpetas, sesiones };
}

export async function leerGrupos(): Promise<Grupos> {
  if (cache) return cache;
  try { cache = limpiarGrupos(JSON.parse(await readFile(archivo, 'utf8'))); } catch { cache = { carpetas: [], sesiones: {} }; }
  return cache;
}

// Los guardados van en fila: dos seguidos no pueden terminar en desorden
let fila: Promise<unknown> = Promise.resolve();
export function guardarGrupos(valor: unknown): Promise<Grupos> {
  const p = fila.then(() => escribir(valor));
  fila = p.catch(() => {});
  return p;
}
async function escribir(valor: unknown): Promise<Grupos> {
  const g = limpiarGrupos(valor);
  await mkdir(join(archivo, '..'), { recursive: true, mode: 0o700 });
  await writeFile(archivo + '.tmp', JSON.stringify(g, null, 1), { mode: 0o600 });
  await rename(archivo + '.tmp', archivo);   // sin archivos a medio escribir
  cache = g;
  return g;
}

/** Al borrar una conversación, que no quede anotada en su carpeta */
export async function olvidarSesion(sessionId: string) {
  const g = await leerGrupos();
  if (!(sessionId in g.sesiones)) return null;
  const sesiones = { ...g.sesiones }; delete sesiones[sessionId];
  return guardarGrupos({ ...g, sesiones });
}
