// Límites de uso de todos los proveedores juntos, para la barra: Claude (las ventanas del plan de claude.ai, las
// mismas de /usage) y Codex (las de la cuenta de ChatGPT). El local no tiene límites.
// Se guardan un rato para no preguntar a cada rato: pedir los de Claude sin un agente abierto arranca Claude Code.
import type { Limite, Proveedor } from './protocolo.ts';
import { limitesClaude } from './claude.ts';
import { limitesCodex } from './codex.ts';
import { instalado } from './motor.ts';

const VIGENCIA = 2 * 60_000;
const ORDEN: Proveedor[] = ['claude', 'codex'];
const actuales = new Map<Proveedor, { limite: Limite; fecha: number }>();
let armando: Promise<void> | undefined;

/** Reemplaza el de un proveedor (cuando avisa él mismo, sin preguntarle) */
export function anotarLimite(l: Limite) { actuales.set(l.proveedor, { limite: l, fecha: Date.now() }); }

/** La lista para mandar, en el orden de la barra */
export function listaLimites(): { limites: Limite[]; fecha: number } {
  const lista = ORDEN.map(p => actuales.get(p)).filter(x => !!x);
  return { limites: lista.map(x => x.limite), fecha: Math.min(...lista.map(x => x.fecha), Date.now()) };
}

const fallo = (proveedor: Proveedor, e: unknown): Limite =>
  ({ proveedor, ventanas: [], nota: e instanceof Error && e.message === 'tiempo' ? 'no respondió' : 'no se pudo leer' });

/** Vuelve a preguntar los que tienen más de dos minutos (o todos, si `fresco`) */
export async function limites(fresco = false) {
  const viejo = (p: Proveedor) => fresco || !actuales.has(p) || Date.now() - actuales.get(p)!.fecha > VIGENCIA;
  if (ORDEN.some(viejo)) {
    armando ??= (async () => {
      await Promise.all([
        viejo('claude') && (instalado('claude') ? limitesClaude().catch(e => fallo('claude', e)).then(anotarLimite) : undefined),
        viejo('codex') && limitesCodex().then(l => l ? anotarLimite(l) : actuales.delete('codex'), e => anotarLimite(fallo('codex', e))),
      ]);
    })().finally(() => { armando = undefined; });
    await armando;
  }
  return listaLimites();
}
