// El visor: lee un archivo que un agente creó, editó o nombró, para mostrarlo al costado.
// Solo con el token, solo archivos comunes (nada de carpetas ocultas como ~/.ssh) y con un tope de tamaño.
import { open, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, isAbsolute, resolve, sep } from 'node:path';

const MAXIMO = 40 * 1024 * 1024;
const TIPOS: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.html': 'text/html', '.htm': 'text/html',
};
/** Carpetas ocultas que sí se pueden mostrar: imágenes de Codex y planes de Claude */
const PERMITIDAS = ['.codex/generated_images', '.claude/plans'];

export type Archivo = { ruta: string; tipo: string; tamano: number; datos: Buffer };

/** `ruta` puede ser relativa a `cwd`; empieza con ~/ para la carpeta personal */
export async function leerArchivo(ruta: string, cwd = ''): Promise<Archivo> {
  const casa = homedir();
  let r = ruta.trim().replace(/^file:\/\//, '');
  try { r = decodeURIComponent(r); } catch {}
  r = r.replace(/[#?].*$/, '').replace(/:\d+(?::\d+)?$/, '');   // archivo.ts:12 → archivo.ts
  if (r.startsWith('~/')) r = casa + r.slice(1);
  const base = cwd.startsWith('~/') ? casa + cwd.slice(1) : cwd;
  if (!isAbsolute(r)) { if (!base) throw new Error('Falta la carpeta del agente.'); r = resolve(base, r); }
  if (r.includes('\0')) throw new Error('Ruta inválida.');
  const real = await realpath(r).catch(() => { throw new Error('No encontré ese archivo.'); });
  const raices = [casa, '/tmp', '/mnt/shared'];
  const raiz = raices.find(x => real === x || real.startsWith(x + sep));
  if (!raiz) throw new Error('Solo se muestran archivos de tu carpeta personal, /tmp o /mnt/shared.');
  const dentro = real.slice(raiz.length + 1);
  if (dentro.split(sep).some(p => p.startsWith('.')) && !PERMITIDAS.some(p => dentro.startsWith(p + sep)))
    throw new Error('No se muestran archivos de carpetas ocultas.');
  const info = await stat(real);
  if (!info.isFile()) throw new Error('No es un archivo.');
  if (info.size > MAXIMO) throw new Error('El archivo es demasiado grande para el visor.');
  const ext = extname(real).toLowerCase();
  const f = await open(real, 'r');
  try {
    const datos = await f.readFile();
    const tipo = TIPOS[ext] || (datos.subarray(0, 8000).includes(0) ? 'application/octet-stream' : 'text/plain; charset=utf-8');
    return { ruta: real, tipo, tamano: info.size, datos };
  } finally { await f.close(); }
}
