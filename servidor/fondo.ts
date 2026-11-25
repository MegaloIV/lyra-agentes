// Shells que Claude deja en segundo plano: su salida va a un archivo (…/tasks/<id>.output) que se lee mientras
// siguen vivas, y una vez más cuando terminan, para verla en Terminales sin que Claude tenga que revisarla.
import { open, stat } from 'node:fs/promises';
import type { Op, Terminal } from './protocolo.ts';

const CADA_MS = 1500;
const TOPE = 256 * 1024;   // solo el final, como la terminal

type Fuente = {
  fondosVivos(): { id: string; archivo: string }[];
  terminal(id: string): Terminal | undefined;
  ponerSalida(id: string, salida: string): Op[];
};

export async function leerFinal(archivo: string): Promise<{ texto: string; tam: number; mtime: number } | undefined> {
  try {
    const info = await stat(archivo);
    const desde = Math.max(0, info.size - TOPE), largo = info.size - desde;
    const f = await open(archivo, 'r');
    try {
      const buf = Buffer.alloc(largo);
      await f.read(buf, 0, largo, desde);
      let texto = buf.toString('utf8');
      if (desde > 0) texto = '…\n' + texto.slice(texto.indexOf('\n') + 1);   // sin la primera línea cortada
      return { texto, tam: info.size, mtime: info.mtimeMs };
    } finally { await f.close(); }
  } catch { return undefined; }
}

export class SeguidorFondo {
  private reloj?: ReturnType<typeof setInterval>;
  private vistos = new Map<string, string>();   // id → «tamaño:mtime» de la última lectura
  private leyendo = false;
  private fuente: Fuente;
  private emitir: (ops: Op[]) => void;
  constructor(fuente: Fuente, emitir: (ops: Op[]) => void) { this.fuente = fuente; this.emitir = emitir; }

  /** Después de cada lote de ops: arranca el reloj si hay shells vivas y lee las que acaban de terminar */
  revisar(ops: Op[]) {
    const terminadas = ops.flatMap(o => {
      const t = o.op === 'actualizar' ? (o.cambios as { terminal?: Terminal }).terminal : undefined;
      return o.op === 'actualizar' && t?.fondo && t.fondo !== 'corriendo' ? [o.id] : [];
    });
    for (const id of terminadas) void this.leer(id, this.fuente.terminal(id)?.archivo, true);
    if (this.fuente.fondosVivos().length) this.reloj ??= setInterval(() => void this.vuelta(), CADA_MS);
  }

  private async vuelta() {
    if (this.leyendo) return;
    const vivos = this.fuente.fondosVivos();
    if (!vivos.length) { this.parar(); return; }
    this.leyendo = true;
    try { for (const v of vivos) await this.leer(v.id, v.archivo); } finally { this.leyendo = false; }
  }

  private async leer(id: string, archivo: string | undefined, final = false) {
    if (!archivo) return;
    const r = await leerFinal(archivo);
    if (!r) return;
    const marca = `${r.tam}:${r.mtime}`;
    if (!final && this.vistos.get(id) === marca) return;
    this.vistos.set(id, marca);
    const t = this.fuente.terminal(id);
    if (!t || t.salida === r.texto) return;
    if (!final && t.fondo !== 'corriendo') return;   // terminó mientras se leía: la lectura final ya va en camino
    this.emitir(this.fuente.ponerSalida(id, r.texto));
  }

  parar() { if (this.reloj) clearInterval(this.reloj); this.reloj = undefined; }
}
