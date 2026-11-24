import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, open, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
export function validarConexion(token: string, recibido: string | null, origen: string | undefined, puerto: number, desarrollo = false): boolean {
  const origenes = [`http://127.0.0.1:${puerto}`, `http://localhost:${puerto}`];
  if (desarrollo) origenes.push('http://127.0.0.1:5173', 'http://localhost:5173');
  const a = Buffer.from(token), b = Buffer.from(recibido || '');
  return a.length === 64 && b.length === a.length && timingSafeEqual(a, b) && origenes.includes(origen || '');
}
export async function cargarToken(base = join(homedir(), '.local/state/atril')): Promise<string> {
  await mkdir(base, { recursive: true, mode: 0o700 }); await chmod(base, 0o700);
  const archivo = join(base, 'token');
  try { const f = await open(archivo, 'wx', 0o600); try { await f.writeFile(randomBytes(32).toString('hex')); } finally { await f.close(); } }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  await chmod(archivo, 0o600);
  const token = (await readFile(archivo, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('El archivo de token no contiene un token válido.');
  return token;
}
export async function archivoPublico(dist: string, ruta: string): Promise<string | null> {
  try {
    const limpia = decodeURIComponent(ruta.split('?')[0]!);
    if (limpia.includes('\0') || limpia.includes('\\') || limpia.split('/').some(p => p === '..' || p === '.')) return null;
    const base = await realpath(dist), destino = await realpath(resolve(base, '.' + (limpia === '/' ? '/index.html' : limpia)));
    if (!destino.startsWith(base + sep) || !(await stat(destino)).isFile()) return null;
    return destino;
  } catch { return null; }
}
