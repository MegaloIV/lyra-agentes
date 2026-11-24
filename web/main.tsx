import { render } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import './estilo.css';
import { estado, suscribir, elegir, enviar } from './tienda.ts';
import { Barra } from './componentes/Barra.tsx';
import { Turnos, armarTurnos, armarIndice, type Entrada } from './componentes/Documento.tsx';
import { Redactor } from './componentes/Redactor.tsx';
import { DialogoNuevo } from './componentes/Dialogo.tsx';
import { MODELOS, MODOS, haceCuanto, miles, nombreModelo, nombreModo, rutaCorta } from './util.ts';

function leerPreferencia(clave: string, defecto: boolean) {
  try { const v = localStorage.getItem(clave); return v === null ? defecto : v === '1'; } catch { return defecto; }
}

function Indice({ entradas, activo, onIr }: { entradas: Entrada[]; activo: string; onIr: (id: string) => void }) {
  return (
    <nav class="indice">
      <h3 class="indice-titulo">En esta conversación</h3>
      <ol class="indice-lista">
        {entradas.map(e => (
          <li key={e.id}><a data-nivel={e.nivel} class={e.id === activo ? 'activo' : undefined} href={'#' + e.id}
            onClick={ev => { ev.preventDefault(); onIr(e.id); }}>{e.texto}</a></li>
        ))}
      </ol>
    </nav>
  );
}

function Lector({ claveVista, bloques, cwd, onEntradas, irA }: { claveVista: string; bloques: Parameters<typeof armarTurnos>[0]; cwd: string; onEntradas: (e: Entrada[], activo: string) => void; irA: { id: string; vez: number } }) {
  const ref = useRef<HTMLDivElement>(null);
  const alFinal = useRef(true);
  const [nuevo, setNuevo] = useState(false);
  const { turnos, hijos } = useMemo(() => armarTurnos(bloques), [bloques]);
  const entradas = useMemo(() => armarIndice(turnos), [turnos]);
  const activo = useRef('');

  const calcularActivo = () => {
    const d = ref.current; if (!d) return;
    const tope = d.getBoundingClientRect().top + 90;
    let id = entradas[0]?.id || '';
    for (const e of entradas) { const el = document.getElementById(e.id); if (el && el.getBoundingClientRect().top <= tope) id = e.id; else if (el) break; }
    if (id !== activo.current) { activo.current = id; onEntradas(entradas, id); }
  };

  // Al cambiar de agente: ir al final
  useLayoutEffect(() => { const d = ref.current; if (d) { d.scrollTo({ top: d.scrollHeight, behavior: 'instant' }); alFinal.current = true; setNuevo(false); } }, [claveVista]);
  // Con contenido nuevo: seguirlo solo si el usuario estaba al final
  useLayoutEffect(() => {
    const d = ref.current; if (!d) return;
    if (alFinal.current) d.scrollTo({ top: d.scrollHeight, behavior: 'instant' });
    else setNuevo(true);
    onEntradas(entradas, activo.current);
    calcularActivo();
  }, [bloques]);
  useEffect(() => {
    if (!irA.id) return;
    const el = document.getElementById(irA.id);
    if (el) { alFinal.current = false; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }, [irA.vez]);

  let programado = false;
  function alDesplazar() {
    const d = ref.current; if (!d) return;
    alFinal.current = d.scrollHeight - d.scrollTop - d.clientHeight < 60;
    if (alFinal.current && nuevo) setNuevo(false);
    if (!programado) { programado = true; requestAnimationFrame(() => { programado = false; calcularActivo(); }); }
  }

  // Botón «Copiar» de los bloques de código
  function clic(e: MouseEvent) {
    const boton = (e.target as HTMLElement).closest('.copiar');
    if (!boton) return;
    const codigo = boton.parentElement?.nextElementSibling?.textContent || '';
    void navigator.clipboard.writeText(codigo).then(() => { boton.textContent = 'Copiado'; setTimeout(() => { boton.textContent = 'Copiar'; }, 1500); });
  }

  return (
    <>
      <div class="documento" ref={ref} onScroll={alDesplazar} onClick={clic}>
        <div class="documento-ancho">
          {turnos.length ? <Turnos turnos={turnos} hijos={hijos} cwd={cwd} /> : <p class="aviso" data-nivel="info">Escribe abajo el primer mensaje.</p>}
        </div>
      </div>
      <button class="ir-abajo" hidden={!nuevo} onClick={() => { const d = ref.current; if (d) { alFinal.current = true; d.scrollTo({ top: d.scrollHeight, behavior: 'smooth' }); setNuevo(false); } }}>↓ Ir al final</button>
    </>
  );
}

function MenuModelo({ agente, onCerrar }: { agente: string; onCerrar: () => void }) {
  useEffect(() => {
    const fuera = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.menu, [data-chip="modelo"]')) onCerrar(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    document.addEventListener('mousedown', fuera); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc); };
  }, []);
  return (
    <div class="menu" role="menu">
      {MODELOS.map(m => <button key={m.nombre} type="button" role="menuitem" onClick={() => { enviar({ t: 'modelo', agente, modelo: m.valor }); onCerrar(); }}>{m.nombre}</button>)}
    </div>
  );
}

const CICLO_MODOS = ['default', 'acceptEdits', 'plan', 'auto'] as const;

function App() {
  const [, forzar] = useReducer((x: number) => x + 1, 0);
  const refrescar = () => forzar(0);
  useEffect(() => suscribir(refrescar), []);
  useEffect(() => { const t = setInterval(refrescar, 30000); return () => clearInterval(t); }, []);   // «hace 3 min»

  const [indiceAncho, setIndiceAncho] = useState(() => leerPreferencia('atril-indice', true));
  const [indiceAngosto, setIndiceAngosto] = useState(false);   // en ventanas angostas el índice tapa el texto: oculto al inicio
  const [angosto, setAngosto] = useState(() => matchMedia('(max-width: 1100px)').matches);
  useEffect(() => { const m = matchMedia('(max-width: 1100px)'); const f = () => setAngosto(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  const indice = angosto ? indiceAngosto : indiceAncho;
  const setIndice = (f: (x: boolean) => boolean) => angosto ? setIndiceAngosto(f) : setIndiceAncho(f);
  const [cajon, setCajon] = useState(false);
  const [dialogo, setDialogo] = useState(false);
  const [menuModelo, setMenuModelo] = useState(false);
  const [entradas, setEntradas] = useState<{ lista: Entrada[]; activo: string }>({ lista: [], activo: '' });
  const [irA, setIrA] = useState({ id: '', vez: 0 });

  const v = estado.vista;
  const agente = v?.tipo === 'agente' ? estado.agentes.find(a => a.id === v.id) : undefined;
  const sesion = v?.tipo === 'sesion' ? estado.historial.find(s => s.sessionId === v.sessionId) : undefined;
  const claveDoc = v?.tipo === 'agente' ? v.id : v?.tipo === 'sesion' ? v.sessionId : '';
  const doc = claveDoc ? estado.documentos.get(claveDoc) : undefined;
  const cwd = agente?.cwd || (v?.tipo === 'sesion' ? v.cwd : '');
  const titulo = agente?.titulo || sesion?.titulo || 'Conversación';

  useEffect(() => { try { localStorage.setItem('atril-indice', indiceAncho ? '1' : '0'); } catch {} }, [indiceAncho]);
  useEffect(() => { document.title = v ? `${titulo} · Atril` : 'Atril'; }, [titulo, !!v]);
  useEffect(() => { setMenuModelo(false); }, [claveDoc]);

  // Atajos de teclado
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if ((e.ctrlKey && e.key.toLowerCase() === 'n') || (e.altKey && e.key.toLowerCase() === 'n')) { e.preventDefault(); setDialogo(true); return; }
      if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); window.dispatchEvent(new Event('atril-enfocar')); return; }
      if (e.ctrlKey && e.key.toLowerCase() === 'i') { e.preventDefault(); setIndice(x => !x); return; }
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const lista = [...document.querySelectorAll<HTMLElement>('.agentes .agente')];
        if (!lista.length) return;
        const i = lista.findIndex(el => el.getAttribute('aria-current') === 'true');
        const j = i < 0 ? 0 : (i + (e.key === 'ArrowDown' ? 1 : -1) + lista.length) % lista.length;
        lista[j]!.click(); lista[j]!.scrollIntoView({ block: 'nearest' });
      }
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [angosto]);

  const modoActual = agente?.modo || 'default';
  const siguienteModo = CICLO_MODOS[(CICLO_MODOS.indexOf(modoActual as typeof CICLO_MODOS[number]) + 1) % CICLO_MODOS.length]!;
  const recientes = estado.historial.slice(0, 5);

  return (
    <div id="app" class="atril" data-indice={indice && v ? 'visible' : 'oculto'}>
      <Barra abierta={cajon} onNuevo={() => { setDialogo(true); setCajon(false); }} onCerrarCajon={() => setCajon(false)} />
      <main class="lectura">
        {estado.rechazado ? (
          <div class="vacio">
            <h2>Atril no aceptó esta ventana</h2>
            <p>Cierra esta ventana y ábrela otra vez con el comando <code>atril</code> o desde el menú de aplicaciones.</p>
          </div>
        ) : v ? (
          <>
            <header class="lectura-cabecera">
              <button class="boton-menu" title="Agentes" onClick={() => setCajon(x => !x)}>☰</button>
              <div class="lectura-titulos">
                <h1 class="lectura-titulo" title={titulo}>{titulo}</h1>
                <span class="lectura-ruta">{rutaCorta(cwd)}{sesion && !agente ? ` · ${haceCuanto(sesion.modificado)}` : ''}</span>
              </div>
              <div class="chips">
                {agente ? (
                  <>
                    <span class="menu-ancla">
                      <button class="chip" data-chip="modelo" title="Cambiar modelo" onClick={() => setMenuModelo(x => !x)}>{nombreModelo(agente.modelo)}</button>
                      {menuModelo && <MenuModelo agente={agente.id} onCerrar={() => setMenuModelo(false)} />}
                    </span>
                    <button class="chip" data-chip="modo" data-modo={modoActual} title={`Permisos: ${nombreModo(modoActual)}. Clic para pasar a «${nombreModo(siguienteModo)}»`}
                      onClick={() => enviar({ t: 'modo', agente: agente.id, modo: siguienteModo })}>{MODOS.find(m => m.valor === modoActual)?.nombre || modoActual}</button>
                    {agente.contexto && <span class="chip" data-chip="contexto" title="Contexto usado">{miles(agente.contexto.usados)} / {miles(agente.contexto.total)}</span>}
                  </>
                ) : <span class="chip">Solo lectura</span>}
                <button class="chip" data-chip="indice" title="Mostrar u ocultar el índice (Ctrl+I)" onClick={() => setIndice(x => !x)}>Índice</button>
              </div>
            </header>
            {!estado.conectado && <div class="desconectado">Sin conexión con Atril… reintentando</div>}
            {doc ? (
              <Lector claveVista={claveDoc} bloques={doc.bloques} cwd={cwd} irA={irA}
                onEntradas={(lista, activo) => setEntradas(prev => prev.lista === lista && prev.activo === activo ? prev : { lista, activo })} />
            ) : <div class="vacio"><p>Cargando la conversación…</p></div>}
            <Redactor vista={v} agente={agente} />
          </>
        ) : (
          <>
            <header class="lectura-cabecera solo-menu"><button class="boton-menu" title="Agentes" onClick={() => setCajon(x => !x)}>☰</button></header>
            {!estado.conectado && <div class="desconectado">Sin conexión con Atril… reintentando</div>}
            <div class="vacio">
              <h2>¿En qué trabajamos?</h2>
              <p>Crea un agente o retoma una conversación anterior.</p>
              <button class="boton boton-primario" onClick={() => setDialogo(true)}>Nuevo agente</button>
              {recientes.length > 0 && (
                <ul>
                  {recientes.map(s => (
                    <li key={s.sessionId} onClick={() => elegir({ tipo: 'sesion', sessionId: s.sessionId, cwd: s.cwd })}>
                      <strong>{s.titulo}</strong><br /><small>{rutaCorta(s.cwd)} · {haceCuanto(s.modificado)}</small>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
        {estado.errores.length > 0 && (
          <div class="errores" role="alert">{estado.errores.map(e => <p key={e.id}>{e.texto}</p>)}</div>
        )}
      </main>
      {v && <Indice entradas={entradas.lista} activo={entradas.activo} onIr={id => { setIrA(x => ({ id, vez: x.vez + 1 })); if (angosto) setIndiceAngosto(false); }} />}
      <DialogoNuevo abierto={dialogo} carpetaInicial={rutaCorta(agente?.cwd || (v?.tipo === 'sesion' ? v.cwd : '') || estado.agentes[0]?.cwd || estado.historial[0]?.cwd || '~/')} onCerrar={() => setDialogo(false)} />
      {cajon && <div class="cortina" onClick={() => setCajon(false)} />}
      {angosto && indiceAngosto && v && <div class="cortina cortina-indice" onClick={() => setIndiceAngosto(false)} />}
    </div>
  );
}

render(<App />, document.getElementById('raiz')!);
