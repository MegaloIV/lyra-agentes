// Pestaña GitHub: el estado de git de la carpeta del agente (rama, cambios, commits) y, si el repo está en GitHub,
// su PR, las pruebas (CI) y los issues abiertos. Todo es de solo lectura: git con comandos que no cambian nada y
// `gh` con la sesión que el usuario ya inició (la app no guarda tokens). Commit, push o un PR los hace el agente.
import { execFile } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { CambioGit, CommitGit, EstadoGit, InfoGithub, PruebaGit } from './protocolo.ts';
import { entornoLimpio } from './abrir.ts';
import { instalado } from './motor.ts';

const entorno = () => ({ ...entornoLimpio(), GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1', LC_ALL: 'C.UTF-8' });

function correr(cmd: string, args: string[], cwd: string, ms = 8000, maximo = 4 * 1024 * 1024): Promise<string> {
  return new Promise((ok, mal) => execFile(cmd, args, { cwd, timeout: ms, maxBuffer: maximo, env: entorno() }, (e, salida, err) => {
    if (e) mal(new Error(String(err || e.message).trim().split('\n').slice(-3).join('\n') || 'Falló ' + cmd));
    else ok(salida);
  }));
}
// Sin fsmonitor, diff externo ni textconv: un repo ajeno no puede hacer que git ejecute programas suyos
const git = (cwd: string, args: string[], ms?: number, maximo?: number) =>
  correr('git', ['-c', 'core.fsmonitor=false', '-c', 'core.quotePath=false', '-c', 'diff.external=', ...args], cwd, ms, maximo);

/** La carpeta del agente, resuelta y dentro de la carpeta personal, /tmp o /mnt/shared */
async function carpeta(cwd: string): Promise<string> {
  const casa = homedir();
  let r = cwd.trim(); if (r === '~' || r.startsWith('~/')) r = casa + r.slice(1);
  if (!r || !isAbsolute(r) || r.includes('\0')) throw new Error('Falta la carpeta del agente.');
  const real = await realpath(r).catch(() => { throw new Error('No encontré la carpeta del agente.'); });
  if (![casa, '/tmp', '/mnt/shared'].some(x => real === x || real.startsWith(x + sep))) throw new Error('Solo se leen repos de tu carpeta personal, /tmp o /mnt/shared.');
  if (!(await stat(real)).isDirectory()) throw new Error('No es una carpeta.');
  return real;
}

async function raizDe(cwd: string): Promise<string | null> {
  try { return (await git(await carpeta(cwd), ['rev-parse', '--show-toplevel'])).trim() || null; } catch { return null; }
}

/** «owner/repo» si el remoto origin (o el primero) está en GitHub */
async function repoGithub(raiz: string): Promise<string | undefined> {
  try {
    const remotos = (await git(raiz, ['remote'])).split('\n').filter(Boolean);
    const nombre = remotos.includes('origin') ? 'origin' : remotos[0];
    if (!nombre) return;
    const url = (await git(raiz, ['remote', 'get-url', nombre])).trim();
    return /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url)?.[1];
  } catch { return; }
}

const MAX_CAMBIOS = 300;
export async function estadoGit(cwd: string): Promise<EstadoGit> {
  const raiz = await raizDe(cwd);
  if (!raiz) return { repo: false, nota: instalado('git') ? 'Esta carpeta no es un repositorio de git.' : 'git no está instalado.' };
  const [estado, log, github] = await Promise.all([
    git(raiz, ['status', '--porcelain=v2', '--branch', '--untracked-files=normal']),
    git(raiz, ['log', '-15', '--format=%h%x1f%s%x1f%an%x1f%ct']).catch(() => ''),   // un repo sin commits falla
    repoGithub(raiz),
  ]);
  let rama = '', arriba: string | undefined, adelante = 0, atras = 0;
  const cambios: CambioGit[] = [];
  for (const l of estado.split('\n')) {
    if (l.startsWith('# branch.head ')) rama = l.slice(14);
    else if (l.startsWith('# branch.upstream ')) arriba = l.slice(18);
    else if (l.startsWith('# branch.ab ')) { const m = /\+(\d+) -(\d+)/.exec(l); if (m) { adelante = Number(m[1]); atras = Number(m[2]); } }
    else if (l.startsWith('? ')) cambios.push({ ruta: l.slice(2), estado: '?', preparado: false });
    else if (/^[12u] /.test(l)) {
      const partes = l.split(' '), xy = partes[1]!;
      // Tipo 1: 8 campos antes de la ruta; 2 (renombrado): 9 y «nueva\tvieja»; u (conflicto): 10
      const antes = l[0] === '1' ? 8 : l[0] === '2' ? 9 : 10;
      const ruta = partes.slice(antes).join(' ').split('\t')[0]!;
      const x = xy[0]!, y = xy[1]!;
      const letra = l[0] === 'u' ? 'U' : (x !== '.' ? x : y);
      cambios.push({ ruta, estado: (['M', 'A', 'D', 'R', 'C', 'U', 'T'].includes(letra) ? letra === 'C' ? 'A' : letra === 'T' ? 'M' : letra : 'M') as CambioGit['estado'], preparado: x !== '.' && l[0] !== 'u' });
    }
  }
  const commits: CommitGit[] = log.split('\n').filter(Boolean).map(l => { const [hash, titulo, autor, fecha] = l.split('\x1f'); return { hash: hash!, titulo: titulo || '', autor: autor || '', fecha: Number(fecha) * 1000 }; });
  return { repo: true, raiz, rama: rama === '(detached)' ? 'HEAD suelto' : rama, arriba, adelante, atras, cambios: cambios.slice(0, MAX_CAMBIOS), masCambios: Math.max(0, cambios.length - MAX_CAMBIOS), commits, github };
}

type Check = { __typename?: string; name?: string; context?: string; status?: string; conclusion?: string; state?: string; detailsUrl?: string; targetUrl?: string; workflowName?: string };
function prueba(c: Check): PruebaGit {
  const url = c.detailsUrl || c.targetUrl || '';
  const m = /\/actions\/runs\/(\d+)(?:\/job\/(\d+))?/.exec(url);
  const fin = (c.conclusion || c.state || '').toUpperCase(), corriendo = c.status && c.status !== 'COMPLETED' || fin === 'PENDING' || fin === 'EXPECTED';
  const estado: PruebaGit['estado'] = corriendo ? 'corriendo' : ['SUCCESS', 'NEUTRAL'].includes(fin) ? 'ok' : ['SKIPPED', 'CANCELLED', 'STALE'].includes(fin) ? 'omitida' : 'error';
  return { nombre: [c.workflowName, c.name || c.context].filter(Boolean).join(' · ') || 'Prueba', estado, url: url || undefined, run: m ? Number(m[1]) : undefined, job: m?.[2] ? Number(m[2]) : undefined };
}

/** Lo de GitHub (necesita internet y `gh` con sesión): PR de la rama o, si no hay, las últimas pruebas; y los issues */
export async function infoGithub(cwd: string): Promise<InfoGithub> {
  const raiz = await raizDe(cwd);
  if (!raiz) return { nota: 'Esta carpeta no es un repositorio de git.' };
  const repo = await repoGithub(raiz);
  if (!repo) return { nota: 'Este repositorio no está en GitHub.' };
  if (!instalado('gh')) return { repo, nota: 'Para ver PRs, pruebas e issues, instala GitHub CLI (gh) e inicia sesión con «gh auth login».' };
  const gh = (args: string[]) => correr('gh', args, raiz, 20000);
  const rama = (await git(raiz, ['branch', '--show-current']).catch(() => '')).trim();
  const [pr, issues] = await Promise.allSettled([
    gh(['pr', 'view', '--json', 'number,title,url,state,isDraft,reviewDecision,statusCheckRollup,headRefName,comments']),
    gh(['issue', 'list', '--limit', '15', '--json', 'number,title,url,body,labels,author']),
  ]);
  const salida: InfoGithub = { repo, rama };
  const error = [pr, issues].find(r => r.status === 'rejected' && !/no pull requests found|no default remote/i.test(String((r as PromiseRejectedResult).reason?.message))) as PromiseRejectedResult | undefined;
  if (error) {
    const t = String(error.reason?.message || '');
    salida.nota = /auth login|not logged|authentication/i.test(t) ? 'Inicia sesión en GitHub con «gh auth login» en una terminal.'
      : /could not resolve|network|timeout|connect/i.test(t) ? 'Sin conexión con GitHub.' : t.split('\n')[0]!.slice(0, 200);
  }
  if (pr.status === 'fulfilled') {
    const p = JSON.parse(pr.value) as { number: number; title: string; url: string; state: string; isDraft: boolean; reviewDecision?: string; statusCheckRollup?: Check[]; comments?: unknown[] };
    salida.pr = { numero: p.number, titulo: p.title, url: p.url, estado: p.isDraft && p.state === 'OPEN' ? 'borrador' : p.state === 'MERGED' ? 'fusionado' : p.state === 'CLOSED' ? 'cerrado' : 'abierto',
      revision: p.reviewDecision === 'APPROVED' ? 'aprobado' : p.reviewDecision === 'CHANGES_REQUESTED' ? 'cambios' : p.reviewDecision === 'REVIEW_REQUIRED' ? 'pendiente' : undefined,
      comentarios: p.comments?.length || 0, pruebas: (p.statusCheckRollup || []).map(prueba) };
  } else if (rama) {
    // Sin PR: las últimas pruebas de la rama (por ejemplo, las que corren con cada push a main)
    try {
      const runs = JSON.parse(await gh(['run', 'list', '--branch', rama, '--limit', '5', '--json', 'databaseId,workflowName,displayTitle,status,conclusion,url'])) as { databaseId: number; workflowName: string; displayTitle: string; status: string; conclusion: string; url: string }[];
      const vistos = new Set<string>();   // la última de cada flujo
      salida.pruebas = runs.filter(r => !vistos.has(r.workflowName) && vistos.add(r.workflowName))
        .map(r => ({ ...prueba({ name: r.workflowName, status: r.status.toUpperCase(), conclusion: r.conclusion.toUpperCase(), detailsUrl: r.url }), nombre: r.displayTitle && r.displayTitle !== r.workflowName ? `${r.workflowName} · ${r.displayTitle}` : r.workflowName }));
    } catch {}
  }
  if (issues.status === 'fulfilled') {
    salida.issues = (JSON.parse(issues.value) as { number: number; title: string; url: string; body: string; labels: { name: string }[]; author?: { login: string } }[])
      .map(i => ({ numero: i.number, titulo: i.title, url: i.url, cuerpo: (i.body || '').slice(0, 6000), etiquetas: i.labels.map(l => l.name), autor: i.author?.login }));
  }
  return salida;
}

const MAX_DIFF = 1.5 * 1024 * 1024;
/** El diff de un archivo contra el último commit (los nuevos se muestran enteros) o el de un commit */
export async function diffGit(cwd: string, que: { ruta?: string; commit?: string }): Promise<string> {
  const raiz = await raizDe(cwd);
  if (!raiz) throw new Error('Esta carpeta no es un repositorio de git.');
  const opciones = ['--no-color', '--no-ext-diff', '--no-textconv'];
  if (que.commit) {
    if (!/^[0-9a-f]{4,40}$/i.test(que.commit)) throw new Error('Commit inválido.');
    return git(raiz, ['show', ...opciones, '--format=%an · %ad%n%n%B', '--date=format:%d/%m/%Y %H:%M', que.commit], 10000, MAX_DIFF + 1024 * 1024).then(t => t.slice(0, MAX_DIFF));
  }
  const ruta = que.ruta || '';
  const absoluta = resolve(raiz, ruta), rel = relative(raiz, absoluta);
  if (!ruta || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Ese archivo no está en el repositorio.');
  const hayHead = await git(raiz, ['rev-parse', '--verify', '-q', 'HEAD']).then(() => true, () => false);
  const diff = await git(raiz, ['diff', ...opciones, ...(hayHead ? ['HEAD'] : ['--cached']), '--', rel], 10000, MAX_DIFF + 1024 * 1024).catch(() => '');
  if (diff.trim()) return diff.slice(0, MAX_DIFF);
  // Archivo nuevo (sin seguimiento): todo su contenido como agregado
  const info = await stat(absoluta).catch(() => null);
  if (!info) return '';
  if (info.isDirectory()) return `Carpeta nueva: ${rel}/\n`;
  if (info.size > 512 * 1024) return `Archivo nuevo de ${Math.round(info.size / 1024)} KB: demasiado grande para mostrarlo aquí.\n`;
  const datos = await readFile(absoluta);
  if (datos.subarray(0, 8000).includes(0)) return `Archivo nuevo (binario): ${rel}\n`;
  const lineas = datos.toString('utf8').replace(/\n$/, '').split('\n');
  return `--- /dev/null\n+++ b/${rel}\n@@ -0,0 +1,${lineas.length} @@\n` + lineas.map(l => '+' + l).join('\n') + '\n';
}

/** El registro de una prueba que falló, recortado, para pasárselo al agente */
export async function registroPrueba(cwd: string, run: number, job?: number): Promise<string> {
  const raiz = await raizDe(cwd);
  if (!raiz) throw new Error('Esta carpeta no es un repositorio de git.');
  const texto = await correr('gh', ['run', 'view', ...(job ? ['--job', String(job)] : [String(run)]), '--log-failed'], raiz, 30000, 32 * 1024 * 1024);
  // Cada línea viene como «trabajo\tpaso\tfecha texto»: se deja «paso: texto» sin la fecha ni colores
  const lineas = texto.replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter(Boolean).map(l => {
    const p = l.split('\t'); return p.length >= 3 ? p.slice(2).join('\t').replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, '') : l;
  });
  if (!lineas.length) throw new Error('Esa prueba no tiene un registro de error (puede que siga corriendo).');
  // Lo que importa está antes de los «##[error]»; lo último del registro suele ser solo la limpieza del trabajo
  const errores = lineas.flatMap((l, i) => l.includes('##[error]') ? [i] : []);
  const fin = errores.length ? Math.min(lineas.length, errores.at(-1)! + 5) : lineas.length;
  return lineas.slice(Math.max(0, fin - 150), fin).join('\n').slice(-12000);
}

