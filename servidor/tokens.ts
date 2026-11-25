// Tokens que va escribiendo Claude en el turno, como el contador de la terminal («↓ 2.3k tokens»). Mientras un mensaje
// llega se estiman (4 caracteres ≈ 1 token; el razonamiento oculto trae su propia estimación) y, cuando el mensaje
// termina, se cambia la estimación por lo que informó la API.
import type { Progreso } from './protocolo.ts';

type Abierto = { caracteres: number; pensamiento: number };

export class ContadorTokens {
  private cerrados = 0;
  private abiertos = new Map<string, Abierto>();   // canal (principal o subagente) → mensaje que está llegando
  fase: Progreso['fase'] = 'pensando';

  reiniciar() { this.cerrados = 0; this.abiertos.clear(); this.fase = 'pensando'; }

  get total(): number {
    let t = this.cerrados;
    for (const a of this.abiertos.values()) t += Math.ceil(a.caracteres / 4) + a.pensamiento;
    return t;
  }

  /** Un mensaje del SDK; devuelve true si cambió algo que mostrar */
  procesar(msg: unknown): boolean {
    const m = msg as { type?: string; subtype?: string; parent_tool_use_id?: string | null; event?: Record<string, any>; estimated_tokens?: unknown };
    const canal = m.parent_tool_use_id || 'principal';
    if (m.type === 'system' && m.subtype === 'thinking_tokens') {
      // Razonamiento oculto: la estimación es el total del bloque que se está pensando
      const a = this.abierto(canal);
      if (typeof m.estimated_tokens === 'number') a.pensamiento = Math.max(a.pensamiento, m.estimated_tokens);
      this.fase = 'pensando';
      return true;
    }
    if (m.type !== 'stream_event' || !m.event) return false;
    const e = m.event;
    switch (e.type) {
      case 'message_start': this.abiertos.set(canal, { caracteres: 0, pensamiento: 0 }); if (canal === 'principal') this.fase = 'pensando'; return true;
      case 'content_block_start': {
        const tipo = e.content_block?.type;
        if (canal === 'principal') this.fase = tipo === 'text' ? 'escribiendo' : tipo === 'thinking' || tipo === 'redacted_thinking' ? 'pensando' : 'herramienta';
        return true;
      }
      case 'content_block_delta': {
        const d = e.delta || {}, a = this.abierto(canal);
        if (d.type === 'text_delta') a.caracteres += String(d.text || '').length;
        else if (d.type === 'input_json_delta') a.caracteres += String(d.partial_json || '').length;
        else if (d.type === 'thinking_delta') {
          if (typeof d.estimated_tokens === 'number') a.pensamiento = Math.max(a.pensamiento, d.estimated_tokens);
          else a.caracteres += String(d.thinking || '').length;
        } else return false;
        return true;
      }
      case 'message_delta': {
        const salida = e.usage?.output_tokens;
        if (typeof salida !== 'number') return false;
        this.abiertos.delete(canal);
        this.cerrados += salida;
        return true;
      }
    }
    return false;
  }

  /** Mientras corren las herramientas del turno */
  usandoHerramientas() { this.fase = 'herramienta'; }

  private abierto(canal: string): Abierto {
    let a = this.abiertos.get(canal);
    if (!a) { a = { caracteres: 0, pensamiento: 0 }; this.abiertos.set(canal, a); }
    return a;
  }
}
