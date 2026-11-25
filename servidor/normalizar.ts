import type { SDKMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Bloque, Op } from './protocolo.ts';
import { cadena, objeto, resumir, detalleHerramienta, recortar } from './resumenes.ts';
export function crearNormalizador(cwd = '') {
  let serie = 0, turno = 0;
  const vistos = new Set<string>(), herramientas = new Map<string, Extract<Bloque, { tipo: 'herramienta' }>>();
  const flujos = new Map<string, { mensaje: string; textos: Map<number, string> }>();
  const tareas = new Set<string>();
  return { procesar(msg: SDKMessage | SessionMessage): Op[] {
    const ops: Op[] = [], agregar = (bloque: Bloque) => ops.push({ op: 'agregar', bloque });
    const padre = ('parent_tool_use_id' in msg ? msg.parent_tool_use_id : null) ?? undefined;
    const canal = padre || 'principal';
    if (msg.type === 'stream_event') {
      const e = msg.event;
      if (e.type === 'message_start') flujos.set(canal, { mensaje: e.message.id, textos: new Map() });
      if (e.type === 'content_block_delta' && e.delta.type === 'text_delta') {
        let flujo = flujos.get(canal);
        if (!flujo) { flujo = { mensaje: `flujo-${++serie}`, textos: new Map() }; flujos.set(canal, flujo); }
        let id = flujo.textos.get(e.index);
        if (!id) { id = `${canal}-${flujo.mensaje}-${e.index}`; flujo.textos.set(e.index, id); agregar({ tipo: 'texto', id, md: '', enCurso: true, padre }); }
        ops.push({ op: 'delta', id, md: e.delta.text });
      }
      return ops;
    }
    if (msg.uuid && vistos.has(msg.uuid)) return ops;
    if (msg.uuid) vistos.add(msg.uuid);
    const id = msg.uuid || `mensaje-${++serie}`;
    if (msg.type === 'assistant' || msg.type === 'user') {
      const m = objeto(msg.message), contenido = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : Array.isArray(m.content) ? m.content.map(objeto) : [];
      if (msg.type === 'assistant') {
        const flujo = flujos.get(canal), pendientes = [...(flujo?.textos.values() || [])];
        contenido.forEach((c, i) => {
          if (c.type === 'text') {
            const existente = pendientes.shift();
            if (existente) { ops.push({ op: 'actualizar', id: existente, cambios: { md: cadena(c.text), enCurso: false } }); flujo?.textos.forEach((v, k) => { if (v === existente) flujo.textos.delete(k); }); }
            else agregar({ tipo: 'texto', id: `${id}-${i}`, md: cadena(c.text), enCurso: false, padre });
          }
          if (c.type === 'thinking' && cadena(c.thinking).trim()) agregar({ tipo: 'pensamiento', id: `${id}-${i}`, md: cadena(c.thinking) });
          if (c.type === 'tool_use') {
            const nombre = cadena(c.name), entrada = objeto(c.input), toolId = cadena(c.id);
            if (herramientas.has(toolId)) return;
            const bloque: Extract<Bloque, { tipo: 'herramienta' }> = { tipo: 'herramienta', id: toolId, nombre, entrada, ...resumir(nombre, entrada, cwd), estado: 'corriendo', terminal: nombre === 'Bash' ? { comando: cadena(entrada.command), descripcion: cadena(entrada.description) || undefined, carpeta: cadena(entrada.cwd) || cwd, inicio: fechaMensaje(msg) } : undefined, detalle: detalleHerramienta(nombre, entrada), padre };
            herramientas.set(toolId, bloque); agregar(bloque);
            if (nombre === 'TodoWrite') {
              const tid = `tareas-${turno}-${canal}`, items = (Array.isArray(entrada.todos) ? entrada.todos : []).map(objeto).map(t => ({ texto: cadena(t.content), estado: t.status === 'completed' ? 'hecha' as const : t.status === 'in_progress' ? 'en_curso' as const : 'pendiente' as const }));
              if (tareas.has(tid)) ops.push({ op: 'actualizar', id: tid, cambios: { items } });
              else { tareas.add(tid); agregar({ tipo: 'tareas', id: tid, items }); }
            }
          }
        });
      } else {
        for (const c of contenido) if (c.type === 'tool_result') {
          const h = herramientas.get(cadena(c.tool_use_id));
          if (h) {
            const salida = typeof c.content === 'string' ? c.content : Array.isArray(c.content) ? c.content.map(objeto).map(p => cadena(p.text)).join('\n') : '';
            ops.push({ op: 'actualizar', id: h.id, cambios: { estado: c.is_error ? 'error' : 'ok', ...(h.terminal ? { terminal: { ...h.terminal, salida, codigo: codigoSalida(objeto((msg as unknown as Record<string, unknown>).tool_use_result), salida), duracionMs: Math.max(0, fechaMensaje(msg) - (h.terminal.inicio || fechaMensaje(msg))) } } : {}), detalle: c.is_error ? { clase: 'codigo', texto: recortar(salida) } : detalleHerramienta(h.nombre, h.entrada, salida) } });
          }
        }
        const crudo = msg as unknown as Record<string, unknown>;
        const sintetico = !!crudo.isSynthetic || !!crudo.isMeta || !!crudo.isCompactSummary;
        const limpio = limpiarUsuario(contenido.filter(c => c.type === 'text').map(c => cadena(c.text)).join('\n'));
        if (!padre && (crudo.isCompactSummary || limpio.tipo === 'resumen')) agregar({ tipo: 'sistema', id, texto: 'Se resumió la conversación para liberar contexto', nivel: 'info' });
        else if (!sintetico && !padre && limpio.tipo === 'usuario') {
          turno++;
          const fecha = typeof crudo.timestamp === 'string' ? Date.parse(crudo.timestamp) : 0;
          agregar({ tipo: 'usuario', id, md: limpio.texto, fecha: Number.isFinite(fecha) ? fecha : 0 });
        }
      }
    }
    if (msg.type === 'result') {
      for (const f of flujos.values()) for (const id of f.textos.values()) ops.push({ op: 'actualizar', id, cambios: { enCurso: false } });
      flujos.clear();
      agregar({ tipo: 'fin', id, duracionMs: msg.duration_ms, costoUsd: msg.total_cost_usd, turnos: msg.num_turns, error: msg.subtype !== 'success' ? textoError(msg.errors) : msg.is_error ? msg.result : undefined });
    }
    if (msg.type === 'system' && 'subtype' in msg && msg.subtype === 'compact_boundary') agregar({ tipo: 'sistema', id, texto: 'Se resumió la conversación para liberar contexto', nivel: 'info' });
    return ops;
  } };
}

/** Quita lo que Claude Code agrega al mensaje del usuario (recordatorios, avisos de tareas, salida de comandos locales) */
export function limpiarUsuario(texto: string): { tipo: 'usuario' | 'resumen' | 'nada'; texto: string } {
  if (/^This session is being continued from a previous conversation/.test(texto.trim())) return { tipo: 'resumen', texto: '' };
  const comando = /<command-name>([^<]*)<\/command-name>/.exec(texto);
  if (comando) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(texto)?.[1]?.trim();
    return { tipo: 'usuario', texto: ('`' + comando[1]!.trim() + '`' + (args ? ' ' + args : '')).trim() };
  }
  const limpio = texto
    .replace(/<(system-reminder|task-notification|local-command-stdout|local-command-stderr|local-command-caveat|bash-stdout|bash-stderr|user-prompt-submit-hook)>[\s\S]*?<\/\1>/g, '')
    .replace(/^\[Request interrupted by user[^\]]*\]$/m, '')
    .trim();
  return limpio ? { tipo: 'usuario', texto: limpio } : { tipo: 'nada', texto: '' };
}

/** Los errores de un turno, sin las líneas de diagnóstico interno; si no queda nada, fue una interrupción */
export function textoError(errores: string[]): string {
  const utiles = errores.filter(e => e.trim() && !e.trim().startsWith('[ede_diagnostic]'));
  return utiles.length ? utiles.join('\n') : 'Se detuvo antes de terminar.';
}

/** Usa las fechas guardadas también al leer el historial. */
function fechaMensaje(msg: unknown): number {
  const fecha = objeto(msg).timestamp;
  const n = typeof fecha === 'string' ? Date.parse(fecha) : NaN;
  return Number.isFinite(n) ? n : Date.now();
}
function codigoSalida(resultado: Record<string, unknown>, salida: string): number | undefined {
  if (typeof resultado.exitCode === 'number') return resultado.exitCode;
  if (typeof resultado.exit_code === 'number') return resultado.exit_code;
  const m = /(?:Exit code:|Exit code|exited with code)\s*(\d+)/i.exec(salida);
  return m ? Number(m[1]) : undefined;
}
