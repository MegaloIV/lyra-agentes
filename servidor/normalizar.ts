import type { SDKMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Bloque, Fondo, Op, Terminal } from './protocolo.ts';
import { cadena, objeto, resumir, detalleHerramienta, recortar } from './resumenes.ts';
export function crearNormalizador(cwd = '') {
  let serie = 0, turno = 0;
  const vistos = new Set<string>(), herramientas = new Map<string, Extract<Bloque, { tipo: 'herramienta' }>>();
  const flujos = new Map<string, { mensaje: string; textos: Map<number, string> }>();
  const tareas = new Set<string>();
  // Lo último de cada comando (para las shells de fondo, que cambian después del tool_result) y qué tarea es cada una
  const terminales = new Map<string, Terminal>(), porTarea = new Map<string, string>();
  const ponerTerminal = (ops: Op[], id: string, cambios: Partial<Terminal>, estado?: 'ok' | 'error') => {
    const t = terminales.get(id);
    if (!t) return;
    const nuevo = { ...t, ...cambios };
    terminales.set(id, nuevo);
    ops.push({ op: 'actualizar', id, cambios: { terminal: nuevo, ...(estado ? { estado } : {}) } });
  };
  /** Una shell de fondo terminó: por el aviso del SDK, el del historial o porque dejó de estar entre las vivas */
  const avisadas = new Set<string>();
  const terminarFondo = (ops: Op[], aviso: { tarea?: string; herramienta?: string; fondo: Fondo; codigo?: number; archivo?: string; fecha: number }, porLista = false) => {
    const id = (aviso.herramienta && terminales.has(aviso.herramienta) ? aviso.herramienta : undefined) ?? (aviso.tarea ? porTarea.get(aviso.tarea) : undefined);
    const t = id ? terminales.get(id) : undefined;
    // El aviso manda sobre la lista (trae el código); cada aviso cuenta una vez (llega del SDK y también como mensaje)
    if (!id || !t?.tarea || avisadas.has(id) || (porLista && t.fondo !== 'corriendo')) return;
    if (!porLista) avisadas.add(id);
    ponerTerminal(ops, id, { fondo: aviso.fondo, codigo: aviso.codigo ?? t.codigo, archivo: aviso.archivo || t.archivo, duracionMs: t.inicio ? Math.max(0, aviso.fecha - t.inicio) : t.duracionMs }, aviso.fondo === 'fallido' ? 'error' : 'ok');
  };
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
            if (bloque.terminal) terminales.set(toolId, bloque.terminal);
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
            const deFondo = h.terminal && !c.is_error ? enSegundoPlano(salida, objeto(h.entrada).run_in_background === true) : undefined;
            if (deFondo) {
              // Sigue viva: la salida llega después (servidor/fondo.ts la lee del archivo) y el final, con el aviso de la tarea
              porTarea.set(deFondo.tarea, h.id);
              ops.push({ op: 'actualizar', id: h.id, cambios: { estado: 'ok', detalle: detalleHerramienta(h.nombre, h.entrada, salida) } });
              ponerTerminal(ops, h.id, { fondo: 'corriendo', tarea: deFondo.tarea, archivo: deFondo.archivo, salida: '' });
              continue;
            }
            const final = h.terminal ? { ...(terminales.get(h.id) ?? h.terminal), fondo: undefined, salida, codigo: codigoSalida(objeto((msg as unknown as Record<string, unknown>).tool_use_result), salida), duracionMs: Math.max(0, fechaMensaje(msg) - (h.terminal.inicio || fechaMensaje(msg))) } : undefined;
            if (final) terminales.set(h.id, final);
            ops.push({ op: 'actualizar', id: h.id, cambios: { estado: c.is_error ? 'error' : 'ok', ...(final ? { terminal: final } : {}), detalle: c.is_error ? { clase: 'codigo', texto: recortar(salida) } : detalleHerramienta(h.nombre, h.entrada, salida) } });
          }
        }
        // Avisos de shells de fondo que terminaron, sueltos o dentro de un recordatorio (también en el historial)
        const textos = contenido.map(c => c.type === 'text' ? cadena(c.text) : c.type === 'tool_result' ? (typeof c.content === 'string' ? c.content : Array.isArray(c.content) ? c.content.map(objeto).map(p => cadena(p.text)).join('\n') : '') : '').join('\n');
        if (textos.includes('<task-notification>')) for (const aviso of avisosTarea(textos)) terminarFondo(ops, { ...aviso, fecha: fechaMensaje(msg) });
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
    if (msg.type === 'system' && 'subtype' in msg && msg.subtype === 'task_notification') {
      const m = msg as unknown as { task_id: string; tool_use_id?: string; status: string; output_file?: string; summary?: string };
      terminarFondo(ops, { tarea: m.task_id, herramienta: m.tool_use_id, fondo: fondoDe(m.status), codigo: codigoResumen(m.summary), archivo: m.output_file, fecha: Date.now() });
    }
    // La lista completa de tareas vivas: la shell que ya no está terminó, aunque se pierda su aviso
    if (msg.type === 'system' && 'subtype' in msg && msg.subtype === 'background_tasks_changed') {
      const vivas = new Set(((msg as unknown as { tasks?: { task_id: string }[] }).tasks || []).map(t => t.task_id));
      for (const [tarea, id] of porTarea) if (!vivas.has(tarea) && terminales.get(id)?.fondo === 'corriendo') terminarFondo(ops, { tarea, fondo: 'terminado', fecha: Date.now() }, true);
    }
    if (msg.type === 'system' && 'subtype' in msg && msg.subtype === 'compact_boundary') agregar({ tipo: 'sistema', id, texto: 'Se resumió la conversación para liberar contexto', nivel: 'info' });
    return ops;
  },
  /** El proceso de Claude se cerró o arranca de nuevo: sus shells de fondo murieron con él */
  cerrarFondos(): Op[] {
    const ops: Op[] = [];
    for (const [id, t] of terminales) if (t.fondo === 'corriendo') ponerTerminal(ops, id, { fondo: 'detenido' });
    return ops;
  },
  /** Las shells de fondo que siguen vivas, para leer su salida mientras corren */
  fondosVivos(): { id: string; archivo: string }[] {
    return [...terminales].flatMap(([id, t]) => t.fondo === 'corriendo' && t.archivo ? [{ id, archivo: t.archivo }] : []);
  },
  terminal(id: string) { return terminales.get(id); },
  /** La salida que se leyó del archivo de una shell de fondo */
  ponerSalida(id: string, salida: string): Op[] { const ops: Op[] = []; ponerTerminal(ops, id, { salida }); return ops; } };
}

/** «Command running in background with ID: bqeyh7axg. Output is being written to: /tmp/…/tasks/bqeyh7axg.output. …» */
export function enSegundoPlano(salida: string, pedido: boolean): { tarea: string; archivo?: string } | undefined {
  // Sin run_in_background (lo mandaron al fondo a mitad de camino) el aviso tiene que ser todo el resultado,
  // no un texto parecido dentro de la salida de un comando cualquiera
  const m = (pedido ? /running in (?:the )?background with ID: ([\w-]+)/i : /^Command [^\n]*background with ID: ([\w-]+)/).exec(salida);
  if (!m) return undefined;
  return { tarea: m[1]!, archivo: /written to: (\/\S+?\.output)\b/.exec(salida)?.[1] };
}

function fondoDe(estado: string): Fondo {
  return estado === 'completed' ? 'terminado' : estado === 'failed' ? 'fallido' : 'detenido';
}
function codigoResumen(resumen?: string): number | undefined {
  const m = /exit code (-?\d+)/i.exec(resumen || '');
  return m ? Number(m[1]) : undefined;
}

/** Los <task-notification> que Claude Code guarda en el historial cuando termina una tarea de fondo */
export function avisosTarea(texto: string): { tarea?: string; herramienta?: string; fondo: Fondo; codigo?: number; archivo?: string }[] {
  return [...texto.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)].map(([, cuerpo]) => {
    const campo = (n: string) => new RegExp(`<${n}>([\\s\\S]*?)</${n}>`).exec(cuerpo!)?.[1]?.trim() || undefined;
    return { tarea: campo('task-id'), herramienta: campo('tool-use-id'), fondo: fondoDe(campo('status') || ''), codigo: codigoResumen(campo('summary')), archivo: campo('output-file') };
  }).filter(a => a.tarea || a.herramienta);
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
