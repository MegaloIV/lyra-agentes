// Terminales propias del panel lateral (pestaña con el gato): shells reales (node-pty) en la carpeta de la
// conversación. Viven en el servidor, así que siguen abiertas al cerrar la ventana o cambiar de conversación;
// se guarda el final de lo que escribieron para mostrarlo al volver a abrirlas.
import { stat } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, type IPty } from 'node-pty';
import type { Consola, ServidorMensaje } from './protocolo.ts';
import { entornoLimpio } from './abrir.ts';

const MAXIMO = 12;
const MEMORIA = 200 * 1024;   // lo que se repite al volver a abrir una (como el scroll de la terminal)
const LOTE_MS = 12;           // junta la salida en lotes para no mandar un mensaje por cada byte

type Viva = Consola & { pty?: IPty; memoria: string; pendiente: string; reloj?: ReturnType<typeof setTimeout> };

function shell(): string {
  try { const s = userInfo().shell; if (s) return s; } catch { /* sin passwd */ }
  return process.env.SHELL || '/bin/bash';
}

export class Consolas {
  private lista = new Map<string, Viva>();
  private emitir: (m: ServidorMensaje) => void;
  private serie = 0;
  constructor(emitir: (m: ServidorMensaje) => void) { this.emitir = emitir; }

  resumen(): Consola[] { return [...this.lista.values()].map(({ id, cwd, titulo, numero, viva, codigo }) => ({ id, cwd, titulo, numero, viva, codigo })); }
  private avisar() { this.emitir({ t: 'consolas', consolas: this.resumen() }); }

  async crear(cwd: string, cols: number, rows: number) {
    if (this.lista.size >= MAXIMO) throw new Error(`Ya hay ${MAXIMO} terminales abiertas. Cierra alguna para abrir otra.`);
    const carpeta = cwd || homedir();
    try { if (!(await stat(carpeta)).isDirectory()) throw new Error(); } catch { throw new Error('Esa carpeta ya no existe.'); }
    const id = randomUUID(), programa = shell();
    // El entorno del escritorio (sin las variables de la terminal que lanzó el servidor) y sin el saludo de fish
    // (Pokémon + fastfetch): la terminal aparece limpia, con solo el prompt
    const env: Record<string, string> = { ...entornoLimpio() as Record<string, string>, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Lyra', SIN_SALUDO: '1' };
    const c: Viva = { id, cwd: carpeta, titulo: basename(programa), numero: ++this.serie, viva: true, memoria: '', pendiente: '' };
    this.lista.set(id, c);
    c.pty = spawn(programa, [], { name: 'xterm-256color', cols: limitar(cols, 20, 400), rows: limitar(rows, 4, 200), cwd: carpeta, env });
    c.pty.onData(d => this.salida(c, d));
    c.pty.onExit(({ exitCode }) => {
      this.vaciar(c);
      c.viva = false; c.codigo = exitCode; c.pty = undefined;
      this.avisar();
    });
    this.avisar();
    return id;
  }

  private salida(c: Viva, datos: string) {
    c.memoria = (c.memoria + datos).slice(-MEMORIA);
    c.pendiente += datos;
    c.reloj ??= setTimeout(() => this.vaciar(c), LOTE_MS);
    // El título que pone la shell (OSC 0/2), para la cabecera de cada terminal
    const t = /\x1b\][02];([^\x07\x1b]*)(?:\x07|\x1b\\)/.exec(datos)?.[1]?.trim();
    if (t && t !== c.titulo) { c.titulo = t.slice(0, 120); this.avisar(); }
  }
  private vaciar(c: Viva) {
    if (c.reloj) clearTimeout(c.reloj);
    c.reloj = undefined;
    if (!c.pendiente) return;
    this.emitir({ t: 'consolaDatos', id: c.id, datos: c.pendiente });
    c.pendiente = '';
  }

  /** Todo lo que guardó, para la ventana que la vuelve a mostrar */
  repetir(id: string): ServidorMensaje | undefined {
    const c = this.lista.get(id);
    if (!c) return undefined;
    this.vaciar(c);
    return { t: 'consolaDatos', id, datos: c.memoria, completo: true };
  }
  escribir(id: string, datos: string) { this.lista.get(id)?.pty?.write(datos); }
  tamano(id: string, cols: number, rows: number) { try { this.lista.get(id)?.pty?.resize(limitar(cols, 20, 400), limitar(rows, 4, 200)); } catch { /* ya salió */ } }
  cerrar(id: string) {
    const c = this.lista.get(id);
    if (!c) return;
    this.lista.delete(id);
    if (c.reloj) clearTimeout(c.reloj);
    try { c.pty?.kill(); } catch { /* ya salió */ }
    this.avisar();
  }
  cerrarTodas() { for (const id of [...this.lista.keys()]) this.cerrar(id); }
}

function limitar(n: number, min: number, max: number) { return Math.max(min, Math.min(max, Math.round(n) || min)); }
