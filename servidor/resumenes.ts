import { diffLines } from 'diff';
import type { Detalle } from './protocolo.ts';
export const objeto = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export const cadena = (v: unknown): string => typeof v === 'string' ? v : '';
export function rutaRelativa(ruta: string, cwd = ''): string {
  const base = cwd.replace(/\/+$/, '');
  return base && ruta.startsWith(base + '/') ? ruta.slice(base.length + 1) : ruta;
}
export function resumir(nombre: string, entrada: unknown, cwd = ''): { resumen: string; icono: string } {
  const e = objeto(entrada), ruta = rutaRelativa(cadena(e.file_path || e.notebook_path || e.path) || '.', cwd);
  const r = (resumen: string, icono: string) => ({ resumen, icono });
  switch (nombre) {
    case 'Read': return r(`Leyó \`${ruta}\`${e.offset || e.limit ? ` (líneas ${Number(e.offset) || 1}–${e.limit ? (Number(e.offset) || 1) + Number(e.limit) - 1 : 'fin'})` : ''}`, 'leer');
    case 'Edit': case 'MultiEdit': return r(`Editó \`${ruta}\``, 'editar');
    case 'Write': return r(`Escribió \`${ruta}\``, 'crear');
    case 'NotebookEdit': return r(`Editó el cuaderno \`${ruta}\``, 'editar');
    case 'Bash': return r(cadena(e.description) || `Ejecutó \`${cadena(e.command).slice(0, 80)}\``, 'terminal');
    case 'BashOutput': return r('Revisó un proceso en segundo plano', 'terminal');
    case 'KillShell': return r('Detuvo un proceso en segundo plano', 'terminal');
    case 'TaskOutput': return r('Revisó una tarea en segundo plano', 'terminal');
    case 'TaskStop': return r('Detuvo una tarea en segundo plano', 'terminal');
    case 'Grep': return r(`Buscó «${cadena(e.pattern)}» en \`${ruta}\``, 'buscar');
    case 'Glob': return r(`Buscó archivos \`${cadena(e.pattern)}\``, 'buscar');
    case 'WebSearch': return r(`Buscó en la web «${cadena(e.query)}»`, 'web');
    case 'WebFetch': { let dominio = cadena(e.url); try { dominio = new URL(dominio).hostname; } catch {} return r(`Abrió ${dominio}`, 'web'); }
    case 'Agent': case 'Task': return r(`Lanzó un subagente: ${cadena(e.description)}`, 'agente');
    case 'TodoWrite': return r('Actualizó la lista de tareas', 'tareas');
    case 'Skill': return r(`Usó la skill ${cadena(e.skill)}`, 'skill');
    case 'AskUserQuestion': return r('Te hizo una pregunta', 'pregunta');
    case 'ExitPlanMode': return r('Propuso un plan', 'plan');
    default: { const m = /^mcp__(.+?)__(.+)$/.exec(nombre); return m ? r(`Usó ${m[2]} (${m[1]})`, 'mcp') : r(`Usó ${nombre}`, 'otro'); }
  }
}
export function recortar(texto: string): string { return texto.length > 20000 ? texto.slice(0, 20000) + '\n… (recortado)' : texto; }
export function detalleHerramienta(nombre: string, entrada: unknown, salida?: string): Detalle {
  const e = objeto(entrada);
  if (['Edit', 'MultiEdit', 'Write'].includes(nombre)) {
    const ediciones = nombre === 'MultiEdit' && Array.isArray(e.edits) ? e.edits.map(objeto) : [e];
    return { clase: 'diff', ruta: cadena(e.file_path), lineas: ediciones.flatMap(edit => diffLines(cadena(edit.old_string), cadena(nombre === 'Write' ? edit.content : edit.new_string)).flatMap(p => p.value.replace(/\n$/, '').split('\n').map(texto => ({ tipo: p.added ? '+' as const : p.removed ? '-' as const : ' ' as const, texto })))) };
  }
  if (['Agent', 'Task'].includes(nombre)) {
    // Un subagente en segundo plano devuelve metadatos internos: se muestra el encargo en su lugar
    const util = salida !== undefined && !/^Async agent launched/.test(salida.trim()) ? salida : undefined;
    return { clase: 'md', texto: recortar(util ?? cadena(e.prompt || e.description)) };
  }
  if (['WebFetch', 'WebSearch'].includes(nombre)) return { clase: 'md', texto: recortar(salida ?? cadena(e.url || e.query)) };
  return { clase: 'codigo', lenguaje: nombre === 'Bash' ? 'bash' : undefined, texto: recortar(nombre === 'Bash' ? cadena(e.command) + (salida !== undefined ? '\n\n' + salida : '') : salida ?? '') };
}
