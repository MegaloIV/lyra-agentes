// «Abrir con…»: las apps del escritorio que dicen abrir un tipo de archivo (sus .desktop), con la
// predeterminada primero y, para texto y código, también los editores. Se abren con `gio launch`.
import { execFile, spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import { entornoLimpio } from './abrir.ts';

const ejecutar = promisify(execFile);

/** Tipos por extensión; lo demás se le pregunta a xdg-mime */
const MIME: Record<string, string> = {
  '.pdf': 'application/pdf', '.md': 'text/markdown', '.markdown': 'text/markdown', '.txt': 'text/plain', '.html': 'text/html', '.htm': 'text/html',
  '.csv': 'text/csv', '.tsv': 'text/tab-separated-values', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime', '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/x-wav', '.m4a': 'audio/mp4', '.flac': 'audio/flac',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.odt': 'application/vnd.oasis.opendocument.text', '.odp': 'application/vnd.oasis.opendocument.presentation', '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
};

export async function mimeDe(ruta: string): Promise<string> {
  const m = MIME[extname(ruta).toLowerCase()];
  if (m) return m;
  try { return (await ejecutar('xdg-mime', ['query', 'filetype', ruta], { timeout: 3000 })).stdout.trim() || 'application/octet-stream'; }
  catch { return 'application/octet-stream'; }
}

type Escritorio = { id: string; archivo: string; nombre: string; mimes: string[]; categorias: string[] };

function carpetas(): string[] {
  const datos = process.env.XDG_DATA_HOME || join(homedir(), '.local/share');
  const sistema = (process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter(Boolean);
  return [datos, join(datos, 'flatpak/exports/share'), '/var/lib/flatpak/exports/share', ...sistema].map(d => join(d, 'applications'));
}

/** Lee los .desktop visibles; el primero que aparece con un id gana (como hace el escritorio) */
async function escritorios(): Promise<Escritorio[]> {
  const lang = (process.env.LANG || '').split(/[._]/)[0] || '';
  const vistos = new Map<string, Escritorio | null>();
  for (const dir of carpetas()) {
    const nombres = await readdir(dir).catch(() => [] as string[]);
    for (const n of nombres) {
      if (!n.endsWith('.desktop') || vistos.has(n)) continue;
      const archivo = join(dir, n);
      const texto = await readFile(archivo, 'utf8').catch(() => '');
      const seccion = texto.split(/^\[/m).find(s => s.startsWith('Desktop Entry]')) || '';
      const campo = (k: string) => seccion.match(new RegExp(`^${k.replace(/[[\]]/g, '\\$&')}=(.*)$`, 'm'))?.[1]?.trim() || '';
      if (campo('NoDisplay') === 'true' || campo('Hidden') === 'true' || campo('Type') !== 'Application' || !campo('Exec')) { vistos.set(n, null); continue; }
      vistos.set(n, { id: n, archivo, nombre: (lang && campo(`Name[${lang}]`)) || campo('Name') || n, mimes: campo('MimeType').split(';').filter(Boolean), categorias: campo('Categories').split(';').filter(Boolean) });
    }
  }
  return [...vistos.values()].filter((e): e is Escritorio => !!e);
}

export type App = { id: string; nombre: string; predeterminada?: boolean };

/** Apps para este archivo: la predeterminada, las que declaran su tipo y, si es texto, los editores */
export async function aplicacionesPara(ruta: string): Promise<App[]> {
  const mime = await mimeDe(ruta);
  const todas = await escritorios();
  let predeterminada = '';
  try { predeterminada = (await ejecutar('xdg-mime', ['query', 'default', mime], { timeout: 3000 })).stdout.trim(); } catch {}
  const esTexto = mime.startsWith('text/') || /json|xml|javascript|x-shellscript|yaml|toml/.test(mime);
  const sirve = (e: Escritorio) => e.mimes.includes(mime)
    || e.mimes.includes(mime.split('/')[0] + '/*')
    || esTexto && (e.mimes.includes('text/plain') || e.categorias.includes('TextEditor') || e.categorias.includes('IDE'));
  const lista = todas.filter(sirve).map(e => ({ id: e.id, nombre: e.nombre, predeterminada: e.id === predeterminada || undefined }));
  const unicas = new Map<string, App>();
  for (const a of lista.sort((a, b) => Number(!!b.predeterminada) - Number(!!a.predeterminada) || a.nombre.localeCompare(b.nombre, 'es'))) {
    if (![...unicas.values()].some(x => x.nombre === a.nombre)) unicas.set(a.id, a);
  }
  return [...unicas.values()].slice(0, 20);
}

/** Abre el archivo con esa app; solo si la app está en la lista de las que sirven para él */
export async function abrirConApp(ruta: string, app: string) {
  const apps = await aplicacionesPara(ruta);
  if (!apps.some(a => a.id === app)) throw new Error('Esa app no abre este tipo de archivo.');
  const e = (await escritorios()).find(x => x.id === app);
  if (!e) throw new Error('No encontré esa app.');
  const p = spawn('gio', ['launch', e.archivo, ruta], { detached: true, stdio: 'ignore', env: entornoLimpio() });
  p.on('error', () => {});
  p.unref();
}
