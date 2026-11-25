// Lo que muestra un comando de Claude Code (/context, /usage…) dibujado como en la terminal: la cuadrícula del
// contexto con su leyenda, las barras de uso y, para el resto, el texto tal cual (en monoespaciada).
import { useMemo } from 'preact/hooks';
import type { Bloque, DatosComando } from '@protocolo';
import { renderizar } from '../md.ts';
import { horaDe, tokensCortos } from '../util.ts';

type B = Extract<Bloque, { tipo: 'comando' }>;
type Ctx = Extract<DatosComando, { clase: 'contexto' }>;
type Uso = Extract<DatosComando, { clase: 'uso' }>;

/** Colores de las categorías usadas, en orden (los mismos tonos del resto de la app) */
const COLORES = ['var(--claude)', 'var(--azul)', 'var(--violeta)', 'var(--turquesa)', 'var(--amarillo)', 'var(--lima)', 'var(--rojo)', 'var(--local)'];
const CUADROS = 100;   // 10 × 10: cada uno es 1 % de la ventana de contexto

const pct = (n: number, total: number) => total ? `${+(n / total * 100).toFixed(1)} %` : '';

function Contexto({ d }: { d: Ctx }) {
  const usadas = d.categorias.filter(c => c.tipo === 'usado' && c.tokens > 0);
  const reserva = d.categorias.filter(c => c.tipo === 'reserva').reduce((s, c) => s + c.tokens, 0);
  const diferidas = d.categorias.filter(c => c.tipo === 'diferido');
  const cuadros = useMemo(() => {
    const lista: { color?: string; clase: 'usado' | 'libre' | 'reserva'; nombre: string }[] = [];
    usadas.forEach((c, i) => { const n = Math.max(1, Math.round(c.tokens / d.total * CUADROS)); for (let k = 0; k < n; k++) lista.push({ color: COLORES[i % COLORES.length], clase: 'usado', nombre: c.nombre }); });
    const finales = Math.round(reserva / d.total * CUADROS);
    while (lista.length < CUADROS - finales) lista.push({ clase: 'libre', nombre: 'Libre' });
    while (lista.length < CUADROS) lista.push({ clase: 'reserva', nombre: 'Reserva para resumir' });
    return lista.slice(0, CUADROS);
  }, [d]);
  return (
    <div class="ctx">
      <div class="ctx-cuadricula" aria-hidden="true">
        {cuadros.map((c, i) => <span key={i} class="ctx-cuadro" data-clase={c.clase} style={c.color ? { background: c.color } : undefined} />)}
      </div>
      <div class="ctx-leyenda">
        <p class="ctx-total"><strong>{tokensCortos(d.usados)}</strong> de {tokensCortos(d.total)} <span>({pct(d.usados, d.total)})</span>{d.modelo && <span class="ctx-modelo">{d.modelo}</span>}</p>
        <ul>
          {usadas.map((c, i) => <li key={c.nombre}><span class="ctx-punto" style={{ background: COLORES[i % COLORES.length] }} /><span class="ctx-nombre">{c.nombre}</span><span class="ctx-num">{tokensCortos(c.tokens)}</span><span class="ctx-pct">{pct(c.tokens, d.total)}</span></li>)}
          {d.categorias.filter(c => c.tipo === 'libre').map(c => <li key={c.nombre} data-clase="libre"><span class="ctx-punto" data-clase="libre" /><span class="ctx-nombre">{c.nombre}</span><span class="ctx-num">{tokensCortos(c.tokens)}</span><span class="ctx-pct">{pct(c.tokens, d.total)}</span></li>)}
          {reserva > 0 && <li data-clase="reserva"><span class="ctx-punto" data-clase="reserva" /><span class="ctx-nombre">Reserva para resumir</span><span class="ctx-num">{tokensCortos(reserva)}</span><span class="ctx-pct">{pct(reserva, d.total)}</span></li>}
        </ul>
        {diferidas.length > 0 && <p class="ctx-nota">Fuera de la ventana (se cargan al usarlas): {diferidas.map(c => `${c.nombre.toLowerCase()} ${tokensCortos(c.tokens)}`).join(', ')}.</p>}
      </div>
    </div>
  );
}

function Limites({ d }: { d: Uso }) {
  return (
    <ul class="uso-lista">
      {d.limites.map(l => (
        <li key={l.nombre} class="uso-fila" data-nivel={l.usado >= 90 ? 'alto' : l.usado >= 70 ? 'medio' : 'bajo'}>
          <span class="uso-nombre">{l.nombre}</span>
          <span class="uso-barra"><span style={{ width: `${Math.min(100, l.usado)}%` }} /></span>
          <span class="uso-pct">{l.usado} %</span>
          {(l.renueva || l.renuevaTexto) && <span class="uso-renueva">se renueva {l.renueva ? horaDe(l.renueva) : l.renuevaTexto}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Markdown si lo parece (tablas, títulos); si no, el texto tal cual, con sus espacios */
function Texto({ texto }: { texto: string }) {
  const md = /^#{1,4} |\n\|[-| :]+\|\n/m.test(texto);
  const html = useMemo(() => md ? renderizar(texto) : '', [texto, md]);
  return md ? <div class="md comando-md" dangerouslySetInnerHTML={{ __html: html }} /> : <pre class="comando-texto">{texto}</pre>;
}

const TITULOS: Record<string, string> = { context: 'Contexto', usage: 'Uso del plan', cost: 'Uso del plan' };

export function SalidaComando({ b }: { b: B }) {
  const resto = b.datos ? b.resto || '' : b.texto;
  return (
    <section class="comando-salida" data-clase={b.datos?.clase}>
      <header class="comando-cabecera"><code>/{b.nombre}</code>{TITULOS[b.nombre] && <span>{TITULOS[b.nombre]}</span>}</header>
      {b.datos?.clase === 'contexto' && <Contexto d={b.datos} />}
      {b.datos?.clase === 'uso' && <Limites d={b.datos} />}
      {resto.trim() && (b.datos?.clase === 'contexto' ? <details class="comando-detalle"><summary>Detalle</summary><Texto texto={resto} /></details> : <Texto texto={resto} />)}
    </section>
  );
}
