// La salida de los comandos de Claude Code (/context, /usage…) llega como texto en inglés pensado para la terminal.
// Aquí se lee lo que se puede dibujar mejor: las categorías del contexto y los límites de uso.
import type { DatosComando } from './protocolo.ts';
import { objeto } from './resumenes.ts';

/** «4.3k» → 4300, «1m» → 1 000 000, «142» → 142 */
export function numeroCorto(t: string): number {
  const m = /^~?\s*([\d.,]+)\s*([kKmM]?)/.exec(t.trim());
  if (!m) return NaN;
  const n = Number(m[1]!.replace(/,/g, ''));
  return Math.round(n * (m[2]?.toLowerCase() === 'k' ? 1e3 : m[2]?.toLowerCase() === 'm' ? 1e6 : 1));
}

const NOMBRES: Record<string, string> = {
  'system prompt': 'Instrucciones del sistema', 'system tools': 'Herramientas del sistema', 'system tools (deferred)': 'Herramientas diferidas',
  'mcp tools': 'Herramientas MCP', 'mcp tools (deferred)': 'Herramientas MCP diferidas', 'mcp instructions': 'Instrucciones de MCP',
  'custom agents': 'Agentes propios', 'memory files': 'Memoria (CLAUDE.md)', skills: 'Skills', messages: 'Mensajes',
  'free space': 'Libre', 'autocompact buffer': 'Reserva para resumir', 'compact buffer': 'Reserva para resumir',
};

/** «## Context Usage … | Category | Tokens | Percentage | …» → categorías (y el resto del texto, para el detalle) */
export function leerContexto(texto: string): { datos?: DatosComando; resto: string } {
  if (!/Context Usage/i.test(texto)) return { resto: texto };
  const modelo = /\*\*Model:\*\*\s*([^\n]+?)\s*$/m.exec(texto)?.[1];
  const tokens = /\*\*Tokens:\*\*\s*([\d.,]+[kKmM]?)\s*\/\s*([\d.,]+[kKmM]?)/.exec(texto);
  const seccion = /###\s*Estimated usage by category\s*\n([\s\S]*?)(?=\n###|\n*$)/i.exec(texto);
  if (!tokens || !seccion) return { resto: texto };
  const categorias: Extract<DatosComando, { clase: 'contexto' }>['categorias'] = [];
  for (const linea of seccion[1]!.split('\n')) {
    const celdas = linea.split('|').map(c => c.trim()).filter(Boolean);
    if (celdas.length < 2 || /^-+$/.test(celdas[0]!) || /^category$/i.test(celdas[0]!)) continue;
    const n = numeroCorto(celdas[1]!), clave = celdas[0]!.toLowerCase();
    if (!Number.isFinite(n)) continue;
    categorias.push({ nombre: NOMBRES[clave] || celdas[0]!, tokens: n, tipo: /free/.test(clave) ? 'libre' : /buffer/.test(clave) ? 'reserva' : /deferred/.test(clave) ? 'diferido' : 'usado' });
  }
  if (!categorias.length) return { resto: texto };
  const resto = texto.slice(seccion.index + seccion[0].length).trim();
  return { datos: { clase: 'contexto', modelo, usados: numeroCorto(tokens[1]!), total: numeroCorto(tokens[2]!), categorias }, resto };
}

const LIMITES: Record<string, string> = { session: 'Sesión (5 h)', weekly_all: 'Semana · todos los modelos', weekly_opus: 'Semana · Opus', weekly_sonnet: 'Semana · Sonnet' };

/** /usage: los límites del informe que trae el mensaje (en vivo) o, si no está, los de las líneas «Current …: 66% used» */
export function leerUso(texto: string, informe?: unknown): { datos?: DatosComando; resto: string } {
  const filas = objeto(objeto(objeto(informe).rate_limits)).limits;
  const lineas = /^(Current [^:\n]+):\s*(\d+)% used(?: · resets ([^\n]+))?$/gm;
  const resto = texto.replace(lineas, '').replace(/^You are currently using[^\n]*\n?/m, '').replace(/\n{3,}/g, '\n\n').trim();
  if (Array.isArray(filas) && filas.length) {
    const limites = filas.map(objeto).filter(f => typeof f.percent === 'number').map(f => {
      const tipo = String(f.kind || ''), ambito = typeof f.scope === 'string' ? f.scope : String(objeto(f.scope).display_name || objeto(f.scope).name || '');
      const renueva = typeof f.resets_at === 'string' ? Date.parse(f.resets_at) : NaN;
      return { nombre: LIMITES[tipo] || (ambito ? `Semana · ${ambito}` : tipo.replace(/_/g, ' ')), usado: Math.round(f.percent as number), renueva: Number.isFinite(renueva) ? renueva : undefined, activo: f.is_active === true };
    });
    if (limites.length) return { datos: { clase: 'uso', limites }, resto };
  }
  const limites = [...texto.matchAll(lineas)].map(m => ({
    nombre: /session/i.test(m[1]!) ? LIMITES.session! : /all models/i.test(m[1]!) ? LIMITES.weekly_all! : m[1]!.replace(/^Current /, ''),
    usado: Number(m[2]), renuevaTexto: m[3],
  }));
  return limites.length ? { datos: { clase: 'uso', limites }, resto } : { resto: texto };
}

export function datosComando(nombre: string, texto: string, informe?: unknown): { datos?: DatosComando; resto: string } {
  if (nombre === 'context' || /^##\s*Context Usage/.test(texto)) return leerContexto(texto);
  if (nombre === 'usage' || nombre === 'cost' || /^Current session: \d+% used/m.test(texto)) return leerUso(texto, informe);
  return { resto: texto };
}
