// Abajo en la barra: cuánto usaste de cada proveedor, todos a la vez. Una fila por proveedor con la ventana corta
// (5 h) y la larga (semana). Al pasar el mouse por una celda, su barra se cambia por cuándo se renueva.
import type { Limite, Ventana } from '@protocolo';
import { estado, pedirLimites } from '../tienda.ts';
import { nombreProveedor, renuevaCorto } from '../util.ts';

const nivel = (u: number) => u >= 100 ? 'agotado' : u >= 80 ? 'alto' : undefined;

function Celda({ l, tipo }: { l: Limite; tipo: Ventana['tipo'] }) {
  const todas = l.ventanas.filter(v => v.tipo === tipo);
  if (!todas.length) return <span class="limites-celda" />;
  // La que más se usó manda (si hay varias: Opus, Sonnet…)
  const v = todas.reduce((a, b) => b.usado > a.usado ? b : a);
  return (
    <span class="limites-celda" data-nivel={nivel(v.usado)} data-renueva={v.renueva ? 'true' : undefined}>
      <span class="limites-uso">
        <span class="limites-barra"><i style={{ width: `${Math.min(100, v.usado)}%` }} /></span>
        <span class="limites-pct">{v.usado} %</span>
      </span>
      {v.renueva && <span class="limites-renueva">↻ {renuevaCorto(v.renueva)}</span>}
    </span>
  );
}

export function Limites() {
  const datos = estado.limites;
  if (!datos?.limites.length) return null;
  const nombre = (tipo: Ventana['tipo'], defecto: string) => datos.limites.flatMap(l => l.ventanas).find(v => v.tipo === tipo)?.nombre.replace(/ \(.*\)$/, '') || defecto;
  return (
    <footer class="limites" aria-label="Límites de uso">
      <div class="limites-fila limites-cabecera">
        <button type="button" class="limites-titulo" disabled={!!estado.pidiendoLimites}
          onClick={() => pedirLimites(true)}>Uso{estado.pidiendoLimites ? '…' : ''}</button>
        <span>{nombre('corta', '5 h')}</span><span>{nombre('larga', 'Semana')}</span>
      </div>
      {datos.limites.map(l => (
        <div class="limites-fila" key={l.proveedor} data-proveedor={l.proveedor}>
          <span class="limites-nombre">{nombreProveedor(l.proveedor)}</span>
          {l.ventanas.length
            ? <><Celda l={l} tipo="corta" /><Celda l={l} tipo="larga" /></>
            : <span class="limites-nota">{l.nota || 'sin datos'}</span>}
        </div>
      ))}
    </footer>
  );
}
