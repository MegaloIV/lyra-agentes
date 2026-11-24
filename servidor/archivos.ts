// El visor: lee un archivo que un agente creó, editó o nombró, para mostrarlo al costado.
// Solo con el token, solo archivos comunes (nada de carpetas ocultas como ~/.ssh) y con un tope de tamaño.
// Videos y audio van por partes (Range); presentaciones, hojas y documentos viejos se pasan a PDF con LibreOffice.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, type Stats } from 'node:fs';
import { mkdir, mkdtemp, open, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { extname, isAbsolute, join, resolve, sep } from 'node:path';
import { instalado } from './motor.ts';
import { entornoLimpio } from './abrir.ts';

const MAXIMO = 60 * 1024 * 1024;
const TIPOS: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.html': 'text/html', '.htm': 'text/html',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.doc': 'application/msword', '.ppt': 'application/vnd.ms-powerpoint', '.xls': 'application/vnd.ms-excel',
  '.odt': 'application/vnd.oasis.opendocument.text', '.odp': 'application/vnd.oasis.opendocument.presentation', '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.rtf': 'application/rtf',
};
export const MEDIOS: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime', '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.opus': 'audio/ogg',
};
/** Lo que se pasa a PDF para verlo (los .docx se dibujan en la página, sin convertir) */
export const OFICINA = /\.(pptx?|xlsx?|docx?|odt|odp|ods|rtf)$/i;
/** Carpetas ocultas que sí se pueden mostrar: imágenes de Codex y planes de Claude */
const PERMITIDAS = ['.codex/generated_images', '.claude/plans'];

export type Archivo = { ruta: string; tipo: string; tamano: number; datos: Buffer };

/** Resuelve la ruta y comprueba que se pueda mostrar. `ruta` puede ser relativa a `cwd`; ~/ es la carpeta personal */
export async function ubicar(ruta: string, cwd = ''): Promise<{ real: string; info: Stats }> {
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
  return { real, info };
}

export async function leerArchivo(ruta: string, cwd = ''): Promise<Archivo> {
  const { real, info } = await ubicar(ruta, cwd);
  if (info.size > MAXIMO) throw new Error('El archivo es demasiado grande para el visor.');
  const ext = extname(real).toLowerCase();
  const f = await open(real, 'r');
  try {
    const datos = await f.readFile();
    const tipo = TIPOS[ext] || (datos.subarray(0, 8000).includes(0) ? 'application/octet-stream' : 'text/plain; charset=utf-8');
    return { ruta: real, tipo, tamano: info.size, datos };
  } finally { await f.close(); }
}

/** Video o audio, por partes: el reproductor pide trozos con Range */
export async function servirMedio(req: IncomingMessage, res: ServerResponse, ruta: string, cwd: string) {
  const { real, info } = await ubicar(ruta, cwd);
  const tipo = MEDIOS[extname(real).toLowerCase()];
  if (!tipo) throw new Error('No es un video ni un audio.');
  const rango = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  let inicio = 0, fin = info.size - 1, estado = 200;
  if (rango && (rango[1] || rango[2])) {
    if (rango[1]) { inicio = Number(rango[1]); if (rango[2]) fin = Math.min(Number(rango[2]), fin); }
    else inicio = Math.max(0, info.size - Number(rango[2]));
    if (inicio > fin || inicio >= info.size) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return; }
    estado = 206;
  }
  res.writeHead(estado, {
    'Content-Type': tipo, 'Accept-Ranges': 'bytes', 'Content-Length': fin - inicio + 1, 'Cache-Control': 'no-store',
    ...(estado === 206 ? { 'Content-Range': `bytes ${inicio}-${fin}/${info.size}` } : {}),
  });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(real, { start: inicio, end: fin }).on('error', () => res.destroy()).pipe(res);
}

/** LibreOffice, si está instalado */
export const conversor = () => ['soffice', 'libreoffice'].find(instalado) || '';
const CACHE = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'lyra-agentes', 'pdf');
let filaPdf: Promise<unknown> = Promise.resolve();

/** Pasa un documento de oficina a PDF (una conversión a la vez) y lo guarda en caché según fecha y tamaño */
export async function comoPdf(ruta: string, cwd = ''): Promise<Archivo> {
  const { real, info } = await ubicar(ruta, cwd);
  if (!OFICINA.test(real)) throw new Error('Este archivo no se convierte a PDF.');
  if (info.size > MAXIMO) throw new Error('El archivo es demasiado grande para el visor.');
  const soffice = conversor();
  if (!soffice) throw new Error('Para ver presentaciones, hojas de cálculo y documentos de Office aquí, instala LibreOffice.');
  const clave = createHash('sha256').update(`${real}\0${info.mtimeMs}\0${info.size}`).digest('hex').slice(0, 32);
  const destino = join(CACHE, clave + '.pdf');
  const leer = async () => { const f = await open(destino, 'r'); try { const datos = await f.readFile(); return { ruta: real, tipo: 'application/pdf', tamano: datos.length, datos }; } finally { await f.close(); } };
  try { return await leer(); } catch {}
  const p = filaPdf.then(async () => {
    try { return await leer(); } catch {}
    await mkdir(CACHE, { recursive: true, mode: 0o700 });
    const tmp = await mkdtemp(join(CACHE, 'tmp-'));   // en la misma carpeta: rename no cruza discos
    try {
      // Perfil propio: no choca con un LibreOffice que el usuario tenga abierto
      const perfil = 'file://' + join(CACHE, '..', 'libreoffice-perfil');
      await new Promise<void>((ok, mal) => execFile(soffice, [`-env:UserInstallation=${perfil}`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', tmp, real],
        { timeout: 120000, env: entornoLimpio() }, e => e ? mal(new Error('LibreOffice no pudo convertir el archivo.')) : ok()));
      const pdf = (await readdir(tmp)).find(n => n.endsWith('.pdf'));
      if (!pdf) throw new Error('LibreOffice no pudo convertir el archivo.');
      await rename(join(tmp, pdf), destino);
      return await leer();
    } finally { await rm(tmp, { recursive: true, force: true }); }
  });
  filaPdf = p.catch(() => {});
  return p;
}
