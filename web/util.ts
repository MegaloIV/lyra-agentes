import type { Bloque, InfoProveedor, Modelo, Proveedor } from '@protocolo';
import { estado } from './tienda.ts';

export type Herr = Extract<Bloque, { tipo: 'herramienta' }>;

/** /home/usuario/Proyectos/x → ~/Proyectos/x */
export function rutaCorta(ruta: string): string {
  const m = /^\/home\/[^/]+/.exec(ruta);
  return m ? '~' + ruta.slice(m[0].length) : ruta;
}
export function nombreCarpeta(ruta: string): string {
  const partes = ruta.replace(/\/+$/, '').split('/');
  return partes.at(-1) || ruta || '/';
}

export function haceCuanto(fecha: number): string {
  const s = Math.max(0, (Date.now() - fecha) / 1000);
  if (s < 45) return 'ahora';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  if (s < 86400 * 30) { const d = Math.round(s / 86400); return d === 1 ? 'ayer' : `hace ${d} días`; }
  return new Date(fecha).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function hora(fecha: number): string {
  if (!fecha) return '';
  const d = new Date(fecha), hoy = new Date();
  const h = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === hoy.toDateString() ? h : `${d.toLocaleDateString('es', { day: 'numeric', month: 'short' })}, ${h}`;
}

export function duracion(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function costo(usd: number): string {
  return usd.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' US$';
}

export function miles(n: number): string { return n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n); }

export const MODOS = [
  { valor: 'default', nombre: 'Preguntar' },
  { valor: 'acceptEdits', nombre: 'Aceptar ediciones' },
  { valor: 'plan', nombre: 'Planificar' },
  { valor: 'auto', nombre: 'Automático' },
  { valor: 'bypassPermissions', nombre: 'Sin preguntar' },
] as const;
export const nombreModo = (m: string, proveedor?: Proveedor) => estado.catalogo.find(p => p.id === proveedor)?.modos.find(x => x.valor === m)?.nombre || MODOS.find(x => x.valor === m)?.nombre || m;

export const PROVEEDORES: { id: Proveedor; nombre: string }[] = [{ id: 'claude', nombre: 'Claude' }, { id: 'codex', nombre: 'Codex' }, { id: 'gemini', nombre: 'Gemini' }];
export const nombreProveedor = (p?: Proveedor) => PROVEEDORES.find(x => x.id === p)?.nombre || 'Claude';
export const info = (p?: Proveedor): InfoProveedor | undefined => estado.catalogo.find(x => x.id === (p || 'claude'));

const ESFUERZOS: Record<string, string> = { minimal: 'Mínimo', low: 'Bajo', medium: 'Medio', high: 'Alto', xhigh: 'Muy alto', max: 'Máximo', ultra: 'Ultra', none: 'Sin razonar' };
export const nombreEsfuerzo = (e?: string) => !e ? 'Esfuerzo normal' : ESFUERZOS[e] || e;

/** El modelo que usa un agente, como lo llama su proveedor */
export function modeloDe(proveedor: Proveedor | undefined, id?: string): { nombre: string; modelo?: Modelo } {
  const lista = info(proveedor)?.modelos || [];
  // Claude informa «claude-haiku-5-5» aunque se haya elegido el alias «haiku»: también vale el mismo nombre
  const modelo = lista.find(m => m.valor === (id ?? null)) || (id ? lista.find(m => m.valor && (id.startsWith(m.valor) || m.valor.startsWith(id)))
    || (proveedor === 'claude' || !proveedor ? lista.find(m => m.valor && m.nombre === nombreModelo(id)) : undefined) : undefined);
  return { nombre: modelo && modelo.valor ? modelo.nombre : id ? (proveedor === 'claude' || !proveedor ? nombreModelo(id) : id) : 'Predeterminado', modelo };
}

/** claude-opus-5-5 → Opus 5.5; opus → Opus */
export function nombreModelo(id?: string): string {
  if (!id) return 'Predeterminado';
  const m = /(opus|sonnet|haiku|fable|mythos)(?:-(\d+)(?:-(\d+))?)?/i.exec(id);
  if (!m) return id;
  const nombre = m[1]![0]!.toUpperCase() + m[1]!.slice(1).toLowerCase();
  const version = m[2] && Number(m[2]) < 100 ? m[2] + (m[3] && Number(m[3]) < 100 ? '.' + m[3] : '') : '';
  return version ? `${nombre} ${version}` : nombre;
}

/** «leyó 3 archivos, editó 1, ejecutó 2 comandos» */
export function contarAcciones(lista: Herr[]): string {
  const cuenta = new Map<string, number>();
  for (const h of lista) cuenta.set(h.icono, (cuenta.get(h.icono) || 0) + 1);
  const frases: Record<string, (n: number) => string> = {
    leer: n => `leyó ${n} ${n === 1 ? 'archivo' : 'archivos'}`,
    editar: n => `editó ${n}`,
    crear: n => `creó ${n} ${n === 1 ? 'archivo' : 'archivos'}`,
    terminal: n => `ejecutó ${n} ${n === 1 ? 'comando' : 'comandos'}`,
    buscar: n => `hizo ${n} ${n === 1 ? 'búsqueda' : 'búsquedas'}`,
    web: n => `consultó ${n} ${n === 1 ? 'página' : 'páginas'} web`,
    agente: n => `lanzó ${n} ${n === 1 ? 'subagente' : 'subagentes'}`,
    tareas: () => 'actualizó las tareas',
    skill: n => `usó ${n} ${n === 1 ? 'skill' : 'skills'}`,
    mcp: n => `usó ${n} ${n === 1 ? 'herramienta' : 'herramientas'} externas`,
    pregunta: () => 'te hizo una pregunta',
    plan: () => 'propuso un plan',
  };
  const orden = ['leer', 'buscar', 'editar', 'crear', 'terminal', 'web', 'agente', 'skill', 'mcp', 'tareas', 'pregunta', 'plan'];
  const partes = orden.filter(k => cuenta.has(k)).map(k => frases[k]!(cuenta.get(k)!));
  const otras = cuenta.get('otro');
  if (otras) partes.push(`${otras} ${otras === 1 ? 'acción más' : 'acciones más'}`);
  return partes.join(', ');
}

export const textoPlano = (md: string) => md.replace(/[`*_#>]/g, '').replace(/\s+/g, ' ').trim();

const extensiones: Record<string, string> = { ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', py: 'python', sh: 'bash', zsh: 'bash', fish: 'bash', md: 'markdown', json: 'json', css: 'css', html: 'xml', xml: 'xml', svg: 'xml', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', conf: 'ini', rs: 'rust', go: 'go', c: 'c', h: 'c', cpp: 'cpp', java: 'java', sql: 'sql', lua: 'lua', tex: 'latex', r: 'r' };
export function lenguajeDe(ruta: string): string | undefined {
  const ext = /\.([a-z0-9]+)$/i.exec(ruta)?.[1]?.toLowerCase();
  return ext ? extensiones[ext] : undefined;
}

/** La conversación entera como Markdown, para guardarla */
export function aMarkdown(bloques: Bloque[], titulo: string, quien: string, cwd: string): string {
  const salida = [`# ${titulo}`, '', `*${quien} · ${rutaCorta(cwd)} · ${new Date().toLocaleString('es')}*`, ''];
  for (const b of bloques) {
    if ('padre' in b && b.padre) continue;
    switch (b.tipo) {
      case 'usuario': salida.push('---', '', `**Tú**${b.fecha ? ` · ${hora(b.fecha)}` : ''}`, '', b.md, ''); break;
      case 'texto': if (b.md.trim()) salida.push(b.md, ''); break;
      case 'herramienta': salida.push(`- ${b.estado === 'error' ? '✗' : '·'} ${b.resumen}`); break;
      case 'tareas': salida.push('', ...b.items.map(t => `- [${t.estado === 'hecha' ? 'x' : ' '}] ${t.texto}`), ''); break;
      case 'plan': salida.push('', '**Plan propuesto**', '', b.md, ''); break;
      case 'sistema': salida.push('', `> ${b.texto}`, ''); break;
      case 'fin': if (b.error) salida.push('', `> ${b.error}`, ''); break;
    }
  }
  return salida.join('\n').replace(/\n{3,}/g, '\n\n');
}
