// Panel del gato: terminales reales en la carpeta de la conversación (servidor/consolas.ts). Se reparten el alto
// del panel para que se vean todas a la vez. Siguen vivas al cambiar de conversación o cerrar el panel.
import { useEffect, useRef } from 'preact/hooks';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { Consola } from '@protocolo';
import { enviar, estado, mostrarError, oirConsola } from '../tienda.ts';
import { rutaCorta } from '../util.ts';
import { Icono } from './iconos.tsx';

/** La próxima terminal que aparezca recibe el foco (la que se acaba de pedir) */
let enfocarNueva = false;

function color(nombre: string, defecto: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim() || defecto;
}

function Pantalla({ c, conectado }: { c: Consola; conectado: boolean }) {
  const marco = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);

  useEffect(() => {
    const t = new Terminal({
      fontFamily: color('--mono', 'monospace'), fontSize: 12, lineHeight: 1.1, cursorBlink: true, scrollback: 4000,
      allowTransparency: false, macOptionIsMeta: true,
      theme: { background: '#151614', foreground: color('--texto', '#d6d6d0'), cursor: color('--lima', '#b8e04a'), cursorAccent: '#151614', selectionBackground: 'rgba(156, 191, 222, .35)' },
    });
    const ajuste = new FitAddon();
    t.loadAddon(ajuste);
    t.open(marco.current!);
    term.current = t;
    // Copiar y pegar como en kitty: Ctrl+Shift+C / Ctrl+Shift+V (Ctrl+C sigue interrumpiendo)
    t.attachCustomKeyEventHandler(e => {
      if (e.type !== 'keydown' || !e.ctrlKey || !e.shiftKey) return true;
      const k = e.key.toLowerCase();
      if (k === 'c') { if (t.hasSelection()) void navigator.clipboard.writeText(t.getSelection()).catch(() => mostrarError('No se pudo copiar')); return false; }
      if (k === 'v') { void navigator.clipboard.readText().then(x => t.paste(x), () => mostrarError('No se pudo pegar: usa el clic central o el menú')); return false; }
      return true;
    });
    const apagar = oirConsola(c.id, (datos, completo) => { if (completo) t.reset(); t.write(datos); });
    const entrada = t.onData(datos => enviar({ t: 'consolaEscribir', id: c.id, datos }));
    const tam = t.onResize(({ cols, rows }) => enviar({ t: 'consolaTamano', id: c.id, cols, rows }));
    let cuadro = 0;
    const medir = () => { cancelAnimationFrame(cuadro); cuadro = requestAnimationFrame(() => { if (marco.current?.clientWidth) try { ajuste.fit(); } catch { /* oculto */ } }); };
    const obs = new ResizeObserver(medir);
    obs.observe(marco.current!);
    medir();
    if (enfocarNueva) { enfocarNueva = false; setTimeout(() => t.focus(), 50); }
    return () => { obs.disconnect(); cancelAnimationFrame(cuadro); apagar(); entrada.dispose(); tam.dispose(); t.dispose(); term.current = null; };
  }, [c.id]);

  // Al (re)conectarse pide todo lo que mostró: lo de antes de abrir el panel o lo que llegó sin conexión
  useEffect(() => { if (conectado) enviar({ t: 'consolaRepetir', id: c.id }); }, [c.id, conectado]);

  return <div ref={marco} class="consola-pantalla" onClick={() => term.current?.focus()} />;
}

export function Consolas({ cwd }: { cwd: string }) {
  const propias = estado.consolas.filter(c => c.cwd === cwd);
  const otras = estado.consolas.length - propias.length;
  const nueva = () => { enfocarNueva = true; enviar({ t: 'consolaCrear', cwd, cols: 80, rows: 12 }); };
  return (
    <div class="consolas">
      <div class="consolas-barra">
        <button type="button" class="git-accion" onClick={nueva}><Icono nombre="nuevo" tam={12} /> Nueva terminal</button>
        <button type="button" class="git-accion" onClick={() => enviar({ t: 'abrir', con: 'terminal', cwd })}>Abrir en kitty</button>
        <span class="consolas-carpeta" title={cwd}>{rutaCorta(cwd)}</span>
      </div>
      {propias.length ? propias.map(c => (
        <section key={c.id} class="cuadro consola" data-viva={c.viva ? 'true' : undefined}>
          <header class="consola-cabecera">
            <span class="consola-numero">{c.numero}</span>
            <span class="consola-titulo">{c.titulo}</span>
            {!c.viva && <span class="consola-fin">terminó{c.codigo ? ` (${c.codigo})` : ''}</span>}
            <button type="button" class="icono-boton consola-cerrar" aria-label={`Cerrar la terminal ${c.numero}`} onClick={() => enviar({ t: 'consolaCerrar', id: c.id })}><Icono nombre="cerrar" tam={12} /></button>
          </header>
          <Pantalla c={c} conectado={estado.conectado} />
        </section>
      )) : <p class="visor-nota">No hay terminales en esta carpeta. Crea una con «Nueva terminal».</p>}
      {otras > 0 && <p class="consolas-otras">{otras === 1 ? 'Hay 1 terminal abierta' : `Hay ${otras} terminales abiertas`} en otras carpetas.</p>}
    </div>
  );
}
