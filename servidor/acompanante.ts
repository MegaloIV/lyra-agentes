// Un acompañante opcional: otro programa (por ejemplo, un asistente de escritorio) que se entera de lo que pasa
// con los agentes y puede manejarlos. Se activa con LYRA_AGENTES_ACOMPANANTE=URL: a esa URL se mandan los avisos
// (POST JSON con la cabecera X-Lyra: 1). Si responde, la ventana no manda además la notificación del escritorio.
// Él habla con este servidor por la API con token (ver index.ts: /api/estado, /api/crear, /api/enviar…).
import type { Bloque, Proveedor } from './protocolo.ts';

export type AvisoAgente = {
  tipo: 'trabaja' | 'fin' | 'permiso' | 'pregunta' | 'error';
  agente: string; proveedor: Proveedor; titulo: string; cwd: string;
  /** fin: lo último que dijo; permiso o pregunta: qué pide, en corto; error: el motivo */
  texto: string;
  /** permiso: para responderlo con /api/responder */
  solicitud?: string;
  /** Si lo estás mirando en la ventana (entonces no hace falta avisar fuerte) */
  mirando: boolean;
};
/** Dónde está la caja de texto, en px de la página (`vw`×`vh`: el tamaño de la página, para pasarlo a la pantalla) */
export type CajaTexto = { x: number; y: number; ancho: number; alto: number; vw: number; vh: number };
export type Aviso = AvisoAgente
  | ({ tipo: 'caja' } & CajaTexto)
  | { tipo: 'sin_caja' }
  | { tipo: 'tecleando' }
  | { tipo: 'charla'; texto: string; contexto: string };

const ESPERA = 1500;     // ms que se espera la respuesta del acompañante
const PRESENTE = 90_000; // ms que se lo da por presente después de una respuesta buena

export function crearAcompanante(url = process.env.LYRA_AGENTES_ACOMPANANTE, enviar: typeof fetch = fetch) {
  let ultimaRespuesta = 0;
  return {
    configurado: !!url,
    /** Si contestó hace poco: está abierto */
    presente: () => !!url && Date.now() - ultimaRespuesta < PRESENTE,
    /** Manda un aviso; devuelve si lo recibió */
    async avisar(aviso: Aviso): Promise<boolean> {
      if (!url) return false;
      try {
        const r = await enviar(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lyra': '1' }, body: JSON.stringify(aviso), signal: AbortSignal.timeout(ESPERA) });
        if (r.ok) ultimaRespuesta = Date.now();
        return r.ok;
      } catch { return false; }
    },
  };
}
export type Acompanante = ReturnType<typeof crearAcompanante>;

const corto = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t).trim();

/** Lo último que dijo el agente (sin lo de los subagentes) */
export function ultimoTexto(bloques: readonly Bloque[], max = 1500): string {
  const b = bloques.findLast(x => x.tipo === 'texto' && !x.padre && x.md.trim());
  return b && b.tipo === 'texto' ? corto(b.md, max) : '';
}

/** Qué pide un permiso o una pregunta, en una línea: «ejecutar `npm test`», «editar src/app.ts»… */
export function queDice(b: Extract<Bloque, { tipo: 'permiso' | 'pregunta' | 'plan' }>): string {
  if (b.tipo === 'plan') return 'aprobar un plan';
  const s = b.solicitud, e = s.entrada || {};
  if (b.tipo === 'pregunta') {
    const preguntas = Array.isArray(e.questions) ? e.questions as { question?: unknown }[] : [];
    return corto(preguntas.map(p => String(p?.question || '')).filter(Boolean).join(' ') || s.titulo || 'una pregunta', 300);
  }
  const cadena = (v: unknown) => typeof v === 'string' ? v : '';
  const comando = cadena(e.command) || cadena(e.cmd), ruta = cadena(e.file_path) || cadena(e.path);
  if (comando) return corto(`ejecutar \`${comando}\``, 300);
  if (ruta) return corto(`${/write|edit/i.test(s.herramienta) ? 'editar' : 'usar'} ${ruta}`, 300);
  return corto(s.titulo || s.descripcion || `usar ${s.herramienta}`, 300);
}
