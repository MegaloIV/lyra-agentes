// JSON-RPC por stdio (una línea por mensaje): lo hablan `codex app-server` y `gemini --acp`.
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

type Espera = { ok: (v: unknown) => void; mal: (e: Error) => void };

export class ClienteRpc {
  private proc: ChildProcess;
  private n = 0;
  private esperas = new Map<number, Espera>();
  private conVersion: boolean;
  vivo = true;
  stderr = '';
  /** Aviso del otro lado (sin id) */
  alAviso: (metodo: string, params: Record<string, unknown>) => void = () => {};
  /** Pedido del otro lado (con id): lo que devuelve es la respuesta */
  alPedido: (metodo: string, params: Record<string, unknown>) => Promise<unknown> = async metodo => { throw new Error(`No se atiende ${metodo}`); };
  alCerrar: () => void = () => {};

  constructor(comando: string, args: string[], opciones: { cwd?: string; jsonrpc: boolean }) {
    this.conVersion = opciones.jsonrpc;
    this.proc = spawn(comando, args, { cwd: opciones.cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env } });
    this.proc.stderr!.on('data', d => { this.stderr = (this.stderr + d.toString()).slice(-4000); });
    this.proc.on('error', e => this.terminar(e));
    this.proc.on('exit', () => this.terminar(new Error(`${comando} terminó.`)));
    this.proc.stdin!.on('error', () => {});
    createInterface({ input: this.proc.stdout! }).on('line', linea => this.recibir(linea));
  }

  private terminar(e: Error) {
    if (!this.vivo) return;
    this.vivo = false;
    for (const espera of this.esperas.values()) espera.mal(e);
    this.esperas.clear();
    this.alCerrar();
  }

  private escribir(m: Record<string, unknown>) {
    if (!this.vivo) throw new Error('El proceso del agente ya terminó.');
    this.proc.stdin!.write(JSON.stringify(this.conVersion ? { jsonrpc: '2.0', ...m } : m) + '\n');
  }

  private recibir(linea: string) {
    let m: Record<string, unknown>;
    try { m = JSON.parse(linea); } catch { return; }
    const id = m.id as number | string | undefined, metodo = typeof m.method === 'string' ? m.method : undefined;
    const params = (m.params && typeof m.params === 'object' ? m.params : {}) as Record<string, unknown>;
    if (metodo && id !== undefined) {
      this.alPedido(metodo, params).then(
        result => { try { this.escribir({ id, result: result ?? null }); } catch {} },
        e => { try { this.escribir({ id, error: { code: -32000, message: e instanceof Error ? e.message : String(e) } }); } catch {} });
      return;
    }
    if (metodo) { try { this.alAviso(metodo, params); } catch (e) { console.error('Aviso con error', metodo, e); } return; }
    const espera = typeof id === 'number' ? this.esperas.get(id) : undefined;
    if (!espera) return;
    this.esperas.delete(id as number);
    const error = m.error as { message?: string } | undefined;
    if (error) espera.mal(new Error(error.message || 'Error del agente.'));
    else espera.ok(m.result);
  }

  pedir<T = Record<string, unknown>>(metodo: string, params: unknown = {}): Promise<T> {
    return new Promise<T>((ok, mal) => {
      const id = ++this.n;
      this.esperas.set(id, { ok: v => ok(v as T), mal });
      try { this.escribir({ id, method: metodo, params }); } catch (e) { this.esperas.delete(id); mal(e as Error); }
    });
  }

  avisar(metodo: string, params: unknown = {}) { this.escribir({ method: metodo, params }); }

  cerrar() { if (this.vivo) { this.proc.kill(); } }
}
