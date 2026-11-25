// La batería de la laptop, leída de /sys/class/power_supply (sin batería, no se muestra nada).
import { readdir, readFile } from 'node:fs/promises';
import type { Bateria } from './protocolo.ts';

const BASE = '/sys/class/power_supply';
const leer = (d: string, k: string) => readFile(`${BASE}/${d}/${k}`, 'utf8').then(x => x.trim(), () => '');

export async function bateria(): Promise<Bateria | null> {
  const todos = await readdir(BASE).catch(() => [] as string[]);
  for (const d of todos.filter(n => /^BAT/i.test(n)).sort()) {
    if (await leer(d, 'type') !== 'Battery') continue;
    const nivel = Number(await leer(d, 'capacity'));
    if (!Number.isFinite(nivel)) continue;
    const s = (await leer(d, 'status')).toLowerCase();
    const enchufada = (await Promise.all(todos.filter(n => /^(AC|ADP)/i.test(n)).map(n => leer(n, 'online')))).includes('1');
    const estado: Bateria['estado'] = s === 'charging' ? 'cargando' : s === 'full' ? 'llena' : s === 'discharging' ? 'descargando' : enchufada ? 'enchufada' : 'descargando';
    return { nivel: Math.max(0, Math.min(100, Math.round(nivel))), estado };
  }
  return null;
}

/** Avisa cada vez que cambia (se revisa cada 20 s) */
export function vigilarBateria(alCambiar: (b: Bateria | null) => void) {
  let antes = '';
  const revisar = async () => { const b = await bateria(); const k = JSON.stringify(b); if (k !== antes) { antes = k; alCambiar(b); } };
  void revisar();
  setInterval(() => void revisar(), 20_000).unref();
}
