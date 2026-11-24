// Los «items» de Codex (app-server v2) pasados a bloques del documento. Funciones puras: sirven en vivo y para el historial.
import type { Bloque, Detalle } from './protocolo.ts';
import { cadena, objeto, recortar, rutaRelativa } from './resumenes.ts';

type Item = Record<string, unknown> & { type?: string; id?: string };
type Herr = Extract<Bloque, { tipo: 'herramienta' }>;

/** `/bin/bash -lc 'ls -la'` → `ls -la` */
export function comandoLimpio(comando: string): string {
  const m = /^(?:\/(?:usr\/)?bin\/)?(?:ba|z|fi)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/.exec(comando.trim());
  return (m ? m[2]! : comando).trim();
}

/** Diff unificado → líneas para dibujar (sin las cabeceras ---, +++ ni @@) */
export function lineasDiff(diff: string, nuevo = false): Extract<Detalle, { clase: 'diff' }>['lineas'] {
  const lineas = diff.replace(/\n$/, '').split('\n');
  if (nuevo && !lineas.some(l => l.startsWith('@@'))) return lineas.map(texto => ({ tipo: '+' as const, texto }));
  const salida: Extract<Detalle, { clase: 'diff' }>['lineas'] = [];
  for (const l of lineas) {
    if (/^(---|\+\+\+|@@|diff --git|index |new file mode|deleted file mode)/.test(l)) { if (l.startsWith('@@') && salida.length) salida.push({ tipo: ' ', texto: '⋯' }); continue; }
    if (l.startsWith('\\')) continue;
    const tipo = l[0] === '+' ? '+' : l[0] === '-' ? '-' : ' ';
    salida.push({ tipo, texto: l.slice(1) });
  }
  return salida;
}

function estadoDe(status: unknown, exito = true): Herr['estado'] {
  return status === 'inProgress' ? 'corriendo' : status === 'completed' && exito ? 'ok' : 'error';
}

function herramienta(id: string, nombre: string, resumen: string, icono: string, estado: Herr['estado'], entrada: unknown, detalle?: Detalle): Herr {
  return { tipo: 'herramienta', id, nombre, resumen, icono, estado, entrada, detalle };
}

/** Cómo contar un comando según lo que Codex entendió que hace (leer, buscar, listar) */
function resumenComando(comando: string, acciones: Record<string, unknown>[], cwd: string): { resumen: string; icono: string } {
  const ruta = (v: unknown) => rutaRelativa(cadena(v) || '.', cwd);
  if (acciones.length && acciones.every(a => a.type === 'read')) {
    const nombres = acciones.map(a => `\`${ruta(a.path || a.name)}\``);
    return { resumen: `Leyó ${nombres.slice(0, 3).join(', ')}${nombres.length > 3 ? ` y ${nombres.length - 3} más` : ''}`, icono: 'leer' };
  }
  if (acciones.length === 1 && acciones[0]!.type === 'search') return { resumen: `Buscó «${cadena(acciones[0]!.query) || '…'}» en \`${ruta(acciones[0]!.path)}\``, icono: 'buscar' };
  if (acciones.length === 1 && acciones[0]!.type === 'listFiles') return { resumen: `Listó \`${ruta(acciones[0]!.path)}\``, icono: 'buscar' };
  const corto = comando.split('\n')[0]!;
  return { resumen: `Ejecutó \`${corto.length > 80 ? corto.slice(0, 79) + '…' : corto}\``, icono: 'terminal' };
}

export function bloquesDeItem(item: Item, cwd: string): Bloque[] {
  const id = cadena(item.id);
  switch (item.type) {
    case 'userMessage': {
      const texto = (Array.isArray(item.content) ? item.content.map(objeto) : []).filter(c => c.type === 'text').map(c => cadena(c.text)).join('\n').trim();
      return texto ? [{ tipo: 'usuario', id, md: texto, fecha: 0 }] : [];
    }
    case 'agentMessage': return [{ tipo: 'texto', id, md: cadena(item.text), enCurso: false }];
    case 'reasoning': {
      const texto = [...(Array.isArray(item.summary) ? item.summary : []), ...(!Array.isArray(item.summary) || !item.summary.length ? (Array.isArray(item.content) ? item.content : []) : [])].map(cadena).join('\n\n').trim();
      return texto ? [{ tipo: 'pensamiento', id, md: texto }] : [];
    }
    case 'plan': return cadena(item.text).trim() ? [{ tipo: 'texto', id, md: cadena(item.text), enCurso: false }] : [];
    case 'commandExecution': {
      const comando = comandoLimpio(cadena(item.command)), acciones = Array.isArray(item.commandActions) ? item.commandActions.map(objeto) : [];
      const salida = cadena(item.aggregatedOutput), codigo = typeof item.exitCode === 'number' ? item.exitCode : null;
      const { resumen, icono } = resumenComando(comando, acciones, cwd);
      const texto = comando + (salida ? '\n\n' + salida.replace(/\n$/, '') : '') + (codigo ? `\n\n(terminó con código ${codigo})` : '') + (item.status === 'declined' ? '\n\n(rechazado)' : '');
      return [herramienta(id, 'Bash', resumen, icono, estadoDe(item.status, !codigo), { command: comando }, { clase: 'codigo', lenguaje: 'bash', texto: recortar(texto) })];
    }
    case 'fileChange': {
      const cambios = Array.isArray(item.changes) ? item.changes.map(objeto) : [];
      return cambios.map((c, i) => {
        const tipo = cadena(objeto(c.kind).type), ruta = cadena(c.path), relativa = rutaRelativa(ruta, cwd);
        const resumen = tipo === 'add' ? `Creó \`${relativa}\`` : tipo === 'delete' ? `Borró \`${relativa}\`` : `Editó \`${relativa}\``;
        return herramienta(`${id}-${i}`, tipo === 'add' ? 'Write' : 'Edit', resumen, tipo === 'add' ? 'crear' : 'editar', estadoDe(item.status), { file_path: ruta }, { clase: 'diff', ruta, lineas: lineasDiff(cadena(c.diff), tipo === 'add') });
      });
    }
    case 'mcpToolCall': {
      const resultado = item.error ? objeto(item.error) : item.result;
      return [herramienta(id, `mcp__${cadena(item.server)}__${cadena(item.tool)}`, `Usó ${cadena(item.tool)} (${cadena(item.server)})`, 'mcp', estadoDe(item.status, !item.error), item.arguments,
        { clase: 'codigo', lenguaje: 'json', texto: recortar(JSON.stringify({ entrada: item.arguments, ...(resultado ? { resultado } : {}) }, null, 2)) })];
    }
    case 'dynamicToolCall': return [herramienta(id, cadena(item.tool), `Usó ${cadena(item.tool)}`, 'otro', estadoDe(item.status, item.success !== false), item.arguments, { clase: 'codigo', lenguaje: 'json', texto: recortar(JSON.stringify(item.arguments, null, 2)) })];
    case 'collabAgentToolCall': {
      const lanzar = item.tool === 'spawnAgent';
      return [herramienta(id, 'Agent', lanzar ? 'Lanzó un subagente' : 'Coordinó a sus subagentes', 'agente', estadoDe(item.status), { prompt: item.prompt }, { clase: 'md', texto: recortar(cadena(item.prompt) || 'Sin encargo.') })];
    }
    case 'webSearch': {
      const accion = objeto(item.action), url = cadena(accion.url);
      let dominio = url; try { dominio = new URL(url).hostname; } catch {}
      const resumen = accion.type === 'openPage' && url ? `Abrió ${dominio}` : `Buscó en la web «${cadena(item.query) || cadena(accion.query) || '…'}»`;
      return [herramienta(id, 'WebSearch', resumen, 'web', 'ok', { query: item.query, url }, { clase: 'md', texto: url || cadena(item.query) })];
    }
    case 'imageView': return [herramienta(id, 'Read', `Miró la imagen \`${rutaRelativa(cadena(item.path), cwd)}\``, 'imagen', 'ok', { file_path: item.path })];
    case 'imageGeneration': {
      const ruta = cadena(item.savedPath), fallo = objeto(item.failure);
      return [herramienta(id, 'GenerarImagen', ruta ? `Generó la imagen \`${rutaRelativa(ruta, cwd)}\`` : 'Generó una imagen', 'imagen', estadoDe(item.status, !item.failure), { file_path: ruta || undefined, prompt: item.revisedPrompt },
        { clase: 'md', texto: cadena(fallo.message) || cadena(item.revisedPrompt) || 'Sin descripción.' })];
    }
    case 'contextCompaction': return [{ tipo: 'sistema', id, texto: 'Se resumió la conversación para liberar contexto', nivel: 'info' }];
    case 'enteredReviewMode': return [{ tipo: 'sistema', id, texto: 'Empezó una revisión del código', nivel: 'info' }];
    case 'exitedReviewMode': return [{ tipo: 'texto', id, md: cadena(item.review), enCurso: false }];
    default: return [];
  }
}

export function tareasDePlan(id: string, plan: unknown): Extract<Bloque, { tipo: 'tareas' }> {
  const items = (Array.isArray(plan) ? plan.map(objeto) : []).map(p => ({ texto: cadena(p.step), estado: p.status === 'completed' ? 'hecha' as const : p.status === 'inProgress' ? 'en_curso' as const : 'pendiente' as const }));
  return { tipo: 'tareas', id, items };
}

export function finDeTurno(turno: Record<string, unknown>, errorLegible: (t: string) => string): Extract<Bloque, { tipo: 'fin' }> {
  const error = objeto(turno.error);
  return { tipo: 'fin', id: `fin-${cadena(turno.id)}`, duracionMs: typeof turno.durationMs === 'number' ? turno.durationMs : undefined,
    error: turno.status === 'interrupted' ? 'Se detuvo antes de terminar.' : turno.status === 'failed' ? errorLegible(cadena(error.message) || 'El turno falló.') : undefined };
}

/** Un hilo entero (thread/read con turnos) → documento */
export function bloquesDeHilo(turnos: unknown, cwd: string, errorLegible: (t: string) => string): Bloque[] {
  const salida: Bloque[] = [];
  for (const t of Array.isArray(turnos) ? turnos.map(objeto) : []) {
    const fecha = typeof t.startedAt === 'number' ? t.startedAt * 1000 : 0;
    for (const item of Array.isArray(t.items) ? t.items.map(objeto) : []) for (const b of bloquesDeItem(item, cwd)) salida.push(b.tipo === 'usuario' ? { ...b, fecha } : b);
    if (t.status !== 'inProgress') salida.push(finDeTurno(t, errorLegible));
  }
  return salida;
}
