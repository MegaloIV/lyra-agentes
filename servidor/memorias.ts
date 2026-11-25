// Pestaña Memorias: lo que cada agente recuerda o lee siempre, para verlo sin buscar en carpetas ocultas.
//   Claude  ~/.claude/CLAUDE.md y rules/, los CLAUDE.md del proyecto y la memoria automática de cada proyecto
//           (~/.claude/projects/<proyecto>/memory/, el proyecto es la raíz del repo git o la carpeta)
//   Codex   ~/.codex/AGENTS.md, los AGENTS.md del proyecto y lo que arma en ~/.codex/memories/
//   Local   es Claude Code con un modelo de Ollama: los CLAUDE.md del proyecto y la misma memoria automática
// Solo se listan: el contenido se abre en el visor, que deja leer estas rutas y ninguna otra oculta.
import { existsSync } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { ArchivoMemoria, GrupoMemoria, MemoriasProveedor } from './protocolo.ts';

const CASA = homedir();
const PROYECTOS_CLAUDE = join(CASA, '.claude/projects');
const MAX_POR_GRUPO = 300;

/** Descripción corta: la del encabezado `description:` o la primera línea con texto */
function descripcionDe(texto: string): string | undefined {
  const fm = /^---\n([\s\S]*?)\n---/.exec(texto);
  const d = fm && /^description:\s*(.+)$/m.exec(fm[1]!)?.[1]?.trim().replace(/^["']|["']$/g, '');
  if (d) return d.slice(0, 200);
  const cuerpo = fm ? texto.slice(fm[0].length) : texto;
  const linea = cuerpo.split('\n').map(l => l.replace(/^[#>*\-\s]+/, '').trim()).find(l => l.length > 2);
  return linea?.slice(0, 200);
}

async function archivo(ruta: string, nombre?: string): Promise<ArchivoMemoria | undefined> {
  const info = await stat(ruta).catch(() => null);
  if (!info?.isFile()) return undefined;
  let inicio = '';
  const f = await open(ruta, 'r').catch(() => null);
  if (f) try { const b = Buffer.alloc(4096); const { bytesRead } = await f.read(b, 0, 4096, 0); inicio = b.subarray(0, bytesRead).toString('utf8'); } finally { await f.close(); }
  return { ruta, nombre: nombre || ruta.split(sep).pop()!, descripcion: descripcionDe(inicio), modificado: info.mtimeMs, tamano: info.size };
}

const juntar = async (rutas: (string | [string, string])[]) =>
  (await Promise.all(rutas.map(r => typeof r === 'string' ? archivo(r) : archivo(r[0], r[1])))).filter(x => !!x);

/** Los .md de una carpeta (y de sus subcarpetas hasta `hondo`), el índice primero y lo más nuevo después */
async function mdsDe(dir: string, hondo = 0): Promise<ArchivoMemoria[]> {
  const out: ArchivoMemoria[] = [];
  const recorrer = async (d: string, nivel: number) => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (out.length >= MAX_POR_GRUPO || e.name.startsWith('.')) continue;
      const r = join(d, e.name);
      if (e.isDirectory() && nivel < hondo) await recorrer(r, nivel + 1);
      else if (e.isFile() && e.name.endsWith('.md')) { const a = await archivo(r, relative(dir, r)); if (a) out.push(a); }
    }
  };
  await recorrer(dir, 0);
  const indice = (n: string) => /^(MEMORY|memory_summary)\.md$/.test(n) ? 0 : 1;
  return out.sort((a, b) => indice(a.nombre) - indice(b.nombre) || b.modificado - a.modificado);
}

/** La raíz del repo git de la carpeta, o la carpeta si no hay */
function raizGit(cwd: string): string {
  for (let d = cwd; ; d = dirname(d)) { if (existsSync(join(d, '.git'))) return d; if (dirname(d) === d) return cwd; }
}

/** Las carpetas de la de trabajo hacia arriba, hasta la raíz del repo (o hasta tu carpeta personal) */
function haciaArriba(cwd: string): string[] {
  const tope = raizGit(cwd), dirs: string[] = [];
  for (let d = cwd; ; d = dirname(d)) {
    dirs.push(d);
    if (d === tope || d === CASA || dirname(d) === d || !(d + sep).startsWith(CASA + sep)) break;
  }
  return dirs;
}

/** Claude Code nombra la carpeta del proyecto cambiando todo lo que no es letra o número por «-» */
const carpetaProyecto = (ruta: string) => join(PROYECTOS_CLAUDE, ruta.replace(/[^a-zA-Z0-9]/g, '-'), 'memory');

const corta = (r: string) => r === CASA ? '~' : (r + sep).startsWith(CASA + sep) ? '~' + r.slice(CASA.length) : r;

/** La carpeta real de un proyecto de Claude: la que anotó en sus conversaciones (el nombre de la carpeta pierde los «/») */
async function cwdDeProyecto(dirProyecto: string): Promise<string | undefined> {
  for (const jsonl of (await readdir(dirProyecto).catch(() => [] as string[])).filter(n => n.endsWith('.jsonl')).slice(0, 5)) {
    const f = await open(join(dirProyecto, jsonl), 'r').catch(() => null);
    if (!f) continue;
    try { const b = Buffer.alloc(65536); const { bytesRead } = await f.read(b, 0, b.length, 0); const c = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(b.subarray(0, bytesRead).toString('utf8'))?.[1]; if (c) return c; }
    finally { await f.close(); }
  }
  return undefined;
}

/** Sin conversaciones guardadas, la ruta se adivina del nombre: cada «-» pudo ser «/» o «-»; manda la que existe */
function adivinarRuta(nombre: string): string {
  const partes = nombre.replace(/^-/, '').split('-');
  const buscar = (base: string, i: number): string | undefined => {
    if (i === partes.length) return base;
    for (let j = partes.length; j > i; j--) {
      const d = join(base, partes.slice(i, j).join('-'));
      if (existsSync(d)) { const r = buscar(d, j); if (r) return r; }
    }
    return undefined;
  };
  return buscar('/', 0) || '/' + partes.join('/');
}

async function memoriaAutomatica(cwd: string): Promise<{ propia: GrupoMemoria; otras: GrupoMemoria[] }> {
  const propiaDir = carpetaProyecto(raizGit(cwd));
  const propia: GrupoMemoria = { titulo: `Memoria automática de ${corta(raizGit(cwd))}`, alcance: 'proyecto', archivos: await mdsDe(propiaDir) };
  const otras: GrupoMemoria[] = [];
  for (const nombre of await readdir(PROYECTOS_CLAUDE).catch(() => [] as string[])) {
    const dir = join(PROYECTOS_CLAUDE, nombre, 'memory');
    if (dir === propiaDir) continue;
    const archivos = await mdsDe(dir);
    if (!archivos.length) continue;
    const real = await cwdDeProyecto(join(PROYECTOS_CLAUDE, nombre));
    otras.push({ titulo: corta(real || adivinarRuta(nombre)), alcance: 'otro', archivos });
  }
  otras.sort((a, b) => Math.max(...b.archivos.map(x => x.modificado)) - Math.max(...a.archivos.map(x => x.modificado)));
  return { propia, otras };
}

/** Instrucciones del proyecto de un proveedor (CLAUDE.md, AGENTS.md…), de la carpeta hacia arriba */
async function delProyecto(cwd: string, nombres: string[]): Promise<ArchivoMemoria[]> {
  const rutas: [string, string][] = [];
  for (const d of haciaArriba(cwd)) for (const n of nombres) rutas.push([join(d, n), corta(join(d, n))]);
  return juntar(rutas);
}

export async function memorias(cwdPedido: string): Promise<MemoriasProveedor[]> {
  const cwd = resolve(cwdPedido.startsWith('~/') ? CASA + cwdPedido.slice(1) : cwdPedido);
  if (!(cwd + sep).startsWith(CASA + sep) && !cwd.startsWith('/tmp/') && !cwd.startsWith('/mnt/shared/')) throw new Error('Esa carpeta queda fuera de tu carpeta personal.');
  const auto = await memoriaAutomatica(cwd);
  const claudeProyecto = await delProyecto(cwd, ['CLAUDE.md', 'CLAUDE.local.md', '.claude/CLAUDE.md']);
  const grupo = (titulo: string, alcance: GrupoMemoria['alcance'], archivos: ArchivoMemoria[]): GrupoMemoria => ({ titulo, alcance, archivos });

  const claude: MemoriasProveedor = { proveedor: 'claude', grupos: [
    auto.propia,
    grupo('Instrucciones del proyecto', 'proyecto', claudeProyecto),
    grupo('Generales (todas las carpetas)', 'general', [...await juntar([[join(CASA, '.claude/CLAUDE.md'), '~/.claude/CLAUDE.md']]), ...(await mdsDe(join(CASA, '.claude/rules'))).map(a => ({ ...a, nombre: 'rules/' + a.nombre }))]),
    ...auto.otras,
  ] };
  const codexMem = join(CASA, '.codex/memories');
  const codex: MemoriasProveedor = { proveedor: 'codex', grupos: [
    grupo('Instrucciones del proyecto', 'proyecto', await delProyecto(cwd, ['AGENTS.override.md', 'AGENTS.md'])),
    grupo('Generales (todas las carpetas)', 'general', await juntar([[join(CASA, '.codex/AGENTS.override.md'), '~/.codex/AGENTS.override.md'], [join(CASA, '.codex/AGENTS.md'), '~/.codex/AGENTS.md']])),
    grupo('Memorias que armó Codex', 'general', await mdsDe(codexMem, 2)),
  ], nota: existsSync(codexMem) ? undefined : 'Codex todavía no guardó memorias: las arma en ~/.codex/memories cuando tiene activada su función de memoria.' };
  const local: MemoriasProveedor = { proveedor: 'local', grupos: [
    { ...auto.propia, titulo: auto.propia.titulo + ' (la misma de Claude)' },
    grupo('Instrucciones del proyecto', 'proyecto', claudeProyecto),
  ], nota: 'El agente local es Claude Code con tu modelo de Ollama: lee los CLAUDE.md del proyecto y comparte con Claude la memoria automática; no lee ~/.claude/CLAUDE.md.' };
  return [claude, codex, local];
}

/** Para el visor: estas rutas ocultas se pueden leer (relativas a tu carpeta personal, solo .md) */
const MEMORIAS_LEGIBLES = [
  /^\.claude\/projects\/[^/]+\/memory\/[^/]+\.md$/,
  /^\.claude\/rules\/[^/]+\.md$/,
  /^\.codex\/AGENTS(\.override)?\.md$/,
  /^\.codex\/memories\/(?:[^/.][^/]*\/){0,2}[^/]+\.md$/,
  /(?:^|\/)\.claude\/CLAUDE\.md$/,
];
export const esMemoriaLegible = (dentro: string) => MEMORIAS_LEGIBLES.some(r => r.test(dentro.split(sep).join('/')));
