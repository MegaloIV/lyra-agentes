// Abajo en la barra: cuánto usaste de cada proveedor, todos a la vez. Una fila por proveedor con la ventana corta
// (5 h) y la larga (semana); el detalle (cuándo se renueva, otras ventanas) va en el globo de cada celda.
import type { Limite, Ventana } from '@protocolo';
import { enviar, estado, pedirLimites } from '../tienda.ts';
import { haceCuanto, horaDe, nombreProveedor } from '../util.ts';

const nivel = (u: number) => u >= 100 ? 'agotado' : u >= 80 ? 'alto' : undefined;
const detalle = (v: Ventana) => `${v.nombre}: usaste el ${v.usado} %` + (v.renueva ? `; se renueva ${horaDe(v.renueva)}` : '');

function Celda({ l, tipo }: { l: Limite; tipo: Ventana['tipo'] }) {
  const todas = l.ventanas.filter(v => v.tipo === tipo);
  if (!todas.length) return <span class="limites-celda" />;
  // La que más se usó manda; las demás (Opus, Sonnet…) quedan en el globo
  const v = todas.reduce((a, b) => b.usado > a.usado ? b : a);
  return (
    <span class="limites-celda" data-nivel={nivel(v.usado)} title={`${nombreProveedor(l.proveedor)}${l.plan ? ` (${l.plan})` : ''}\n${todas.map(detalle).join('\n')}`}>
      <span class="limites-barra"><i style={{ width: `${Math.min(100, v.usado)}%` }} /></span>
      <span class="limites-pct">{v.usado} %</span>
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
        <button type="button" class="limites-titulo" title={`Actualizado ${haceCuanto(datos.fecha)}. Toca para actualizar`} disabled={!!estado.pidiendoLimites}
          onClick={() => pedirLimites(true)}>Uso{estado.pidiendoLimites ? '…' : ''}</button>
        <span>{nombre('corta', '5 h')}</span><span>{nombre('larga', 'Semana')}</span>
      </div>
      {datos.limites.map(l => (
        <div class="limites-fila" key={l.proveedor} data-proveedor={l.proveedor}>
          <span class="limites-nombre" title={l.plan ? `Plan ${l.plan}` : undefined}>{nombreProveedor(l.proveedor)}</span>
          {l.ventanas.length
            ? <><Celda l={l} tipo="corta" /><Celda l={l} tipo="larga" /></>
            : l.proveedor === 'gemini' && l.nota === 'sin clave'
              ? <button type="button" class="limites-nota enlace" title="Abre una terminal para pegar tu clave de Google AI Studio" onClick={() => enviar({ t: 'abrir', con: 'loginGemini' })}>poner la clave</button>
              : <span class="limites-nota" title={l.proveedor === 'gemini' ? 'Con clave de API, Google muestra el uso solo en aistudio.google.com' : undefined}>{l.nota || 'sin datos'}</span>}
        </div>
      ))}
    </footer>
  );
}
