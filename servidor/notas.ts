// Notas del panel derecho (post-its): texto libre con un color. No son de ninguna conversación: se ven siempre.
// Se guardan en ~/.local/state/lyra-agentes/notas.json.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { COLORES_NOTA, type Nota } from './protocolo.ts';
import { objeto } from './resumenes.ts';

const archivo = join(homedir(), '.local/state/lyra-agentes/notas.json');
let cache: Nota[] | null = null;

/** Deja solo lo válido: ids cortos sin repetir, texto de hasta 20 000 caracteres y un color conocido */
export function limpiarNotas(valor: unknown): Nota[] {
  const notas: Nota[] = [];
  for (const n of (Array.isArray(valor) ? valor : []).slice(0, 300).map(objeto)) {
    const id = typeof n.id === 'string' && /^[\w-]{1,40}$/.test(n.id) ? n.id : '';
    if (!id || notas.some(x => x.id === id)) continue;
    const color = COLORES_NOTA.includes(n.color as Nota['color']) ? n.color as Nota['color'] : 'amarillo';
    const fecha = typeof n.fecha === 'number' && Number.isFinite(n.fecha) ? n.fecha : Date.now();
    notas.push({ id, texto: typeof n.texto === 'string' ? n.texto.slice(0, 20000) : '', color, fecha });
  }
  return notas;
}

export async function leerNotas(): Promise<Nota[]> {
  if (cache) return cache;
  try { cache = limpiarNotas(JSON.parse(await readFile(archivo, 'utf8'))); } catch { cache = []; }
  return cache;
}

// Los guardados van en fila: dos seguidos no pueden terminar en desorden
let fila: Promise<unknown> = Promise.resolve();
export function guardarNotas(valor: unknown): Promise<Nota[]> {
  const p = fila.then(() => escribir(valor));
  fila = p.catch(() => {});
  return p;
}
async function escribir(valor: unknown): Promise<Nota[]> {
  const notas = limpiarNotas(valor);
  await mkdir(join(archivo, '..'), { recursive: true, mode: 0o700 });
  await writeFile(archivo + '.tmp', JSON.stringify(notas, null, 1), { mode: 0o600 });
  await rename(archivo + '.tmp', archivo);   // sin archivos a medio escribir
  cache = notas;
  return notas;
}
