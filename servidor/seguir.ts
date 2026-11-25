// Conversaciones que se están mirando sin abrirlas en Lyra (otra terminal las usa, como un `claude` en kitty):
// se vigila su archivo y, cuando cambia, se vuelve a leer y se manda de nuevo, para verlas al día.
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Proveedor } from './protocolo.ts';

const CADA_MS = 1500;
type Mirada = { proveedor: Proveedor; sessionId: string; cwd: string };
type Seguida = Mirada & { ruta?: string; firma?: string; leyendo?: boolean; quienes: Set<unknown> };

const carpetaClaude = () => join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');

/** ~/.claude/projects/<cwd con todo lo que no es letra o número cambiado por «-»>/<id>.jsonl; si no está ahí, se busca */
async function rutaClaude(sessionId: string, cwd: string): Promise<string | undefined> {
  const directa = join(carpetaClaude(), cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`);
  if (await stat(directa).catch(() => null)) return directa;
  for (const d of await readdir(carpetaClaude()).catch(() => [] as string[])) {
    const r = join(carpetaClaude(), d, `${sessionId}.jsonl`);
    if (await stat(r).catch(() => null)) return r;
  }
  return undefined;
}

export class SeguidorSesiones {
  private seguidas = new Map<string, Seguida>();
  private reloj?: ReturnType<typeof setInterval>;
  private rutaCodex: (id: string) => Promise<string | undefined>;
  /** Vuelve a leer la conversación y se la manda a quienes la miran */
  private recargar: (m: Mirada, quienes: Set<unknown>) => Promise<void>;
  constructor(recargar: SeguidorSesiones['recargar'], rutaCodex: SeguidorSesiones['rutaCodex']) { this.recargar = recargar; this.rutaCodex = rutaCodex; }

  /** `quien` (una ventana) mira esta conversación; sin `m`, ya no mira ninguna */
  mirar(quien: unknown, m?: Mirada) {
    for (const [id, s] of this.seguidas) if (s.quienes.delete(quien) && !s.quienes.size) this.seguidas.delete(id);
    if (m && m.proveedor !== 'local') {
      const s = this.seguidas.get(m.sessionId) ?? { ...m, quienes: new Set() };
      s.quienes.add(quien); this.seguidas.set(m.sessionId, s);
      void this.firmar(s);   // la firma de ahora: lo que ya se mandó al abrirla
    }
    if (this.seguidas.size) this.reloj ??= setInterval(() => void this.vuelta(), CADA_MS);
    else if (this.reloj) { clearInterval(this.reloj); this.reloj = undefined; }
  }

  private async firmar(s: Seguida): Promise<string | undefined> {
    s.ruta ??= s.proveedor === 'codex' ? await this.rutaCodex(s.sessionId).catch(() => undefined) : await rutaClaude(s.sessionId, s.cwd);
    if (!s.ruta) return undefined;
    const info = await stat(s.ruta).catch(() => null);
    const firma = info ? `${info.size}:${info.mtimeMs}` : undefined;
    s.firma ??= firma;
    return firma;
  }

  private async vuelta() {
    for (const s of this.seguidas.values()) {
      if (s.leyendo) continue;
      const anterior = s.firma, firma = await this.firmar(s);
      if (!firma || firma === anterior || this.seguidas.get(s.sessionId) !== s) continue;
      s.firma = firma; s.leyendo = true;
      try { await this.recargar(s, s.quienes); } catch { /* se intenta en la próxima vuelta */ } finally { s.leyendo = false; }
    }
  }
}
