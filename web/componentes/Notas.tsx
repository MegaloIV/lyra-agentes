// Panel de notas (post-its): texto libre con un color, de la más nueva a la más vieja. No son de ninguna
// conversación, así que se ven en todas. Se guardan solas mientras se escribe (servidor/notas.ts).
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { COLORES_NOTA, type Nota } from '@protocolo';
import { estado, crearNota, cambiarNota, borrarNota, guardarNotasYa } from '../tienda.ts';
import { haceCuanto } from '../util.ts';
import { Papelera } from './Acciones.tsx';
import { Icono } from './iconos.tsx';

const NOMBRES: Record<Nota['color'], string> = { amarillo: 'Amarillo', lima: 'Verde', azul: 'Azul', violeta: 'Violeta', rojo: 'Rojo' };

/** La nota que se acaba de crear recibe el foco */
let enfocar = '';

function Postit({ n }: { n: Nota }) {
  const caja = useRef<HTMLTextAreaElement>(null);
  // Crece con el texto, sin barra de desplazamiento propia
  const medir = () => { const t = caja.current; if (t) { t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; } };
  useLayoutEffect(medir, []);
  // Si cambió en otra ventana y aquí no se está escribiendo, se muestra lo nuevo
  useEffect(() => { const t = caja.current; if (t && document.activeElement !== t && t.value !== n.texto) { t.value = n.texto; medir(); } }, [n.texto]);
  useEffect(() => { if (enfocar === n.id) { enfocar = ''; caja.current?.focus(); } }, []);
  return (
    <article class="nota" data-color={n.color}>
      <textarea ref={caja} class="nota-texto" defaultValue={n.texto} rows={2} placeholder="Escribe una nota…" aria-label="Texto de la nota" spellcheck={false}
        onInput={e => { cambiarNota(n.id, { texto: (e.currentTarget as HTMLTextAreaElement).value }); medir(); }}
        onBlur={guardarNotasYa}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); (e.currentTarget as HTMLTextAreaElement).blur(); } }} />
      <footer class="nota-pie">
        <span class="nota-colores" role="group" aria-label="Color">
          {COLORES_NOTA.map(c => <button type="button" key={c} class="nota-color" data-color={c} aria-label={NOMBRES[c]} aria-pressed={n.color === c} onClick={() => cambiarNota(n.id, { color: c })} />)}
        </span>
        <span class="nota-fecha">{haceCuanto(n.fecha)}</span>
        <Papelera clase="icono-boton nota-borrar" titulo="Borrar la nota" onBorrar={() => borrarNota(n.id)} />
      </footer>
    </article>
  );
}

export function Notas() {
  const nueva = () => { enfocar = crearNota(); };
  return (
    <div class="notas">
      <div class="consolas-barra">
        <button type="button" class="git-accion" onClick={nueva}><Icono nombre="nuevo" tam={12} /> Nueva nota</button>
      </div>
      {estado.notas.length
        ? estado.notas.map(n => <Postit key={n.id} n={n} />)
        : <p class="visor-nota">No hay notas. Crea una con «Nueva nota»: se guarda sola y se ve en todas las conversaciones.</p>}
    </div>
  );
}
