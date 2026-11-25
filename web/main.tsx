import { Terminales, comandosTerminal, corriendoTerminal } from './componentes/Terminales.tsx';
import { render } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import './estilo.css';
import { estado, suscribir, elegir, enviar, avisar, renombrar, abrirPanel, ver, guardarLocal, mostrarError, type Panel } from './tienda.ts';
import type { Objetivo } from './tienda.ts';
import { BotonIcono, TituloEditable } from './componentes/Acciones.tsx';
import { Icono } from './componentes/iconos.tsx';
import { Barra } from './componentes/Barra.tsx';
import { Turnos, armarTurnos, armarIndice, type Entrada } from './componentes/Documento.tsx';
import { Redactor } from './componentes/Redactor.tsx';
import { Bateria, Reloj } from './componentes/Reloj.tsx';
import { Visor, archivosDe } from './componentes/Visor.tsx';
import { Github } from './componentes/Github.tsx';
import { Memorias } from './componentes/Memorias.tsx';
import type { Bloque } from '@protocolo';
import { aMarkdown, haceCuanto, nombreProveedor, rutaCorta } from './util.ts';

function Indice({ entradas, activo, onIr }: { entradas: Entrada[]; activo: string; onIr: (id: string) => void }) {
  return (
    <nav class="indice">
      <ol class="indice-lista">
        {entradas.map(e => (
          <li key={e.id}><a data-nivel={e.nivel} class={e.id === activo ? 'activo' : undefined} href={'#' + e.id}
            onClick={ev => { ev.preventDefault(); onIr(e.id); }}>{e.texto}</a></li>
        ))}
      </ol>
    </nav>
  );
}

function Lector({ claveVista, bloques, cwd, quien, onEntradas, irA }: { claveVista: string; bloques: Bloque[]; cwd: string; quien: string; onEntradas: (e: Entrada[], activo: string) => void; irA: { id: string; vez: number } }) {
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

  function clic(e: MouseEvent) {
    const objetivo = e.target as HTMLElement;
    // Una ruta del texto (`archivo.md` o un enlace a un archivo): al visor
    const ruta = objetivo.closest<HTMLElement>('[data-ruta]');
    if (ruta) { e.preventDefault(); ver(ruta.dataset.ruta!, cwd); return; }
    // Botón «Copiar» de los bloques de código
    const boton = objetivo.closest('.copiar');
    if (!boton) return;
    const codigo = boton.parentElement?.nextElementSibling?.textContent || '';
    void navigator.clipboard.writeText(codigo).then(() => { boton.textContent = 'Copiado'; setTimeout(() => { boton.textContent = 'Copiar'; }, 1500); });
  }

  return (
    <>
      <div class="documento" ref={ref} onScroll={alDesplazar} onClick={clic}>
        <div class="documento-ancho">
          {turnos.length > 0 && <Turnos turnos={turnos} hijos={hijos} cwd={cwd} quien={quien} />}
        </div>
      </div>
      <button class="ir-abajo" hidden={!nuevo} onClick={() => { const d = ref.current; if (d) { alFinal.current = true; d.scrollTo({ top: d.scrollHeight, behavior: 'smooth' }); setNuevo(false); } }}>↓ Ir al final</button>
    </>
  );
}

function guardarArchivo(nombre: string, texto: string) {
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const nombreArchivo = (titulo: string) => (titulo.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'conversacion') + '.md';

/** Ancho de la barra de la izquierda (en px); se achica arrastrando su borde derecho, pero no crece más que esto */
const BARRA = 272;
function leerBarra(): number { try { const n = Number(localStorage.getItem('lyra-barra')); return n >= 200 && n <= BARRA ? n : BARRA; } catch { return BARRA; } }

/** Ancho del panel derecho: el mismo para todas las pestañas e igual al de la barra izquierda. Si arrastras el borde, esa pestaña guarda el suyo
 *  hasta el botón «tamaños de siempre» (o doble clic en el borde) */
const PANEL = BARRA;
type Anchos = Partial<Record<Exclude<Panel, null>, number>>;
/** El panel crece mientras el nombre de la sesión se siga viendo entero en la cabecera (a uno muy largo se le dejan 380 px).
 *  Se mide con el panel en `actual` px: lo que sobra al lado del título es lo que todavía puede crecer */
function topePanel(actual: number): number {
  const caja = document.querySelector<HTMLElement>('.lectura-titulos'), titulo = document.querySelector<HTMLElement>('.lectura-titulo');
  if (!caja || !titulo) return Math.round(window.innerWidth * 0.6);
  return Math.max(PANEL, Math.round(actual + caja.clientWidth - Math.min(titulo.scrollWidth, 380)));
}
function leerAnchos(): Anchos {
  try { const a = JSON.parse(localStorage.getItem('lyra-anchos-propios') || '{}'); return a && typeof a === 'object' ? a : {}; } catch { return {}; }
}

/** Archivos ya vistos por conversación, para el punto del visor y para abrirlo solo con una imagen nueva */
const vistos = new Map<string, Set<string>>();

function App() {
  const [, forzar] = useReducer((x: number) => x + 1, 0);
  const refrescar = () => forzar(0);
  useEffect(() => suscribir(refrescar), []);
  useEffect(() => { const t = setInterval(refrescar, 30000); return () => clearInterval(t); }, []);   // «hace 3 min»

  const [angosto, setAngosto] = useState(() => matchMedia('(max-width: 1100px)').matches);
  useEffect(() => { const m = matchMedia('(max-width: 1100px)'); const f = () => setAngosto(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  // En ventanas angostas el panel tapa el texto: empieza cerrado
  const [panelAngosto, setPanelAngosto] = useState<Panel>(null);
  const panel = angosto ? panelAngosto : estado.panel;
  const ponerPanel = (p: Panel) => angosto ? setPanelAngosto(p) : abrirPanel(p);
  const alternar = (p: Exclude<Panel, null>) => ponerPanel(panel === p ? null : p);
  useEffect(() => { if (angosto && estado.panel === 'visor' && estado.visor) setPanelAngosto('visor'); }, [estado.visor?.vez]);
  const [anchos, setAnchos] = useState<Anchos>(leerAnchos);
  const [anchoBarra, setAnchoBarra] = useState(leerBarra);
  const [cajon, setCajon] = useState(false);
  const [entradas, setEntradas] = useState<{ lista: Entrada[]; activo: string }>({ lista: [], activo: '' });
  const [irA, setIrA] = useState({ id: '', vez: 0 });

  const v = estado.vista;
  const agente = v?.tipo === 'agente' ? estado.agentes.find(a => a.id === v.id) : undefined;
  const sesion = v?.tipo === 'sesion' ? estado.historial.find(s => s.sessionId === v.sessionId) : undefined;
  const claveDoc = v?.tipo === 'agente' ? v.id : v?.tipo === 'sesion' ? v.sessionId : '';
  const doc = claveDoc ? estado.documentos.get(claveDoc) : undefined;
  const cwd = agente?.cwd || (v?.tipo === 'sesion' ? v.cwd : '');
  const titulo = v ? agente?.titulo || sesion?.titulo || 'Conversación' : 'Agente nuevo';

  useEffect(() => { document.title = v ? `${titulo} · Lyra` : 'Lyra'; }, [titulo, !!v]);
  useEffect(() => { if (estado.editando === 'cabecera') estado.editando = null; estado.visor = null; }, [claveDoc]);

  // Archivos de la conversación: punto en el visor si hay nuevos; una imagen recién generada abre el visor
  const archivos = useMemo(() => doc ? archivosDe(doc.bloques, cwd) : [], [doc?.bloques, cwd]);
  const conocidos = vistos.get(claveDoc);
  if (claveDoc && doc && !conocidos) vistos.set(claveDoc, new Set(archivos.map(a => a.id + a.ruta)));
  const nuevos = conocidos ? archivos.filter(a => !conocidos.has(a.id + a.ruta)) : [];
  useEffect(() => {
    if (!nuevos.length) return;
    const imagen = nuevos.find(a => a.como === 'generó');
    if (imagen && agente) ver(imagen.ruta, cwd);
    if (panel === 'visor' || imagen) for (const a of nuevos) conocidos!.add(a.id + a.ruta);
  }, [nuevos.map(a => a.id).join()]);
  useEffect(() => { if (panel === 'visor' && conocidos) { for (const a of archivos) conocidos.add(a.id + a.ruta); refrescar(); } }, [panel, claveDoc]);
  const hayNuevos = panel !== 'visor' && nuevos.length > 0;
  /** Turnos terminados: la pestaña GitHub se vuelve a leer al terminar cada uno */
  const turnos = useMemo(() => doc?.bloques.filter(b => b.tipo === 'fin').length || 0, [doc?.bloques]);

  // Atajos de teclado
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.altKey) && k === 'n') { e.preventDefault(); elegir(null); setCajon(false); setTimeout(() => window.dispatchEvent(new Event('lyra-enfocar')), 30); return; }
      if (e.ctrlKey && k === 'k') { e.preventDefault(); window.dispatchEvent(new Event('lyra-enfocar')); return; }
      if (e.ctrlKey && k === 'i') { e.preventDefault(); alternar('indice'); return; }
      if (e.ctrlKey && k === 'o') { e.preventDefault(); alternar('visor'); return; }
      if (e.ctrlKey && k === 'g') { e.preventDefault(); alternar('github'); return; }
      if (e.ctrlKey && k === 't') { e.preventDefault(); alternar('terminales'); return; }
      if (e.ctrlKey && k === 'm') { e.preventDefault(); alternar('memorias'); return; }
      if (e.key === 'F2' && estado.vista) { e.preventDefault(); estado.editando = 'cabecera'; avisar(); return; }
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
  }, [angosto, panel]);

  const proveedor = agente?.proveedor || (v?.tipo === 'sesion' ? v.proveedor || sesion?.proveedor : undefined) || 'claude';
  const quien = nombreProveedor(proveedor);
  const exportar = () => doc ? aMarkdown(doc.bloques, titulo, quien, cwd) : '';
  const objetivo: Objetivo | undefined = agente ? { proveedor, titulo, agente: agente.id, sessionId: agente.sessionId, cwd, trabajando: agente.estado === 'trabajando' }
    : v?.tipo === 'sesion' ? { proveedor, titulo, sessionId: v.sessionId, cwd } : undefined;
  // Un ancho guardado tampoco tapa el nombre: se vuelve a medir al cambiar de sesión, de título o de ventana
  const [tope, setTope] = useState(Infinity);
  const ancho = panel ? Math.min(anchos[panel] ?? PANEL, angosto ? Infinity : tope) : 0;
  useLayoutEffect(() => {
    if (!panel || angosto) return;
    const medir = () => setTope(topePanel(ancho));
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, [panel, angosto, titulo, ancho, !!v]);

  function arrastrarBorde(e: PointerEvent) {
    if (!panel || angosto) return;
    e.preventDefault();
    const inicio = e.clientX, base = anchos[panel] ?? PANEL, p = panel, tope = Math.min(topePanel(ancho), window.innerWidth * 0.6);
    let ultimo = base;
    const mover = (ev: PointerEvent) => { ultimo = Math.round(Math.min(Math.max(base + inicio - ev.clientX, 200), tope)); setAnchos(a => ({ ...a, [p]: ultimo })); };
    const soltar = () => { window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', soltar); setAnchos(a => { guardarLocal('lyra-anchos-propios', a); return a; }); document.body.classList.remove('arrastrando'); };
    document.body.classList.add('arrastrando');
    window.addEventListener('pointermove', mover); window.addEventListener('pointerup', soltar);
  }

  /** Botón de la barra: todo vuelve al ancho con que viene (barra y cada pestaña del panel) */
  function tamanosDeSiempre() {
    setAnchoBarra(BARRA); setAnchos({});
    try { localStorage.removeItem('lyra-barra'); localStorage.removeItem('lyra-anchos'); localStorage.removeItem('lyra-anchos-propios'); } catch { /* sin almacenamiento */ }
    mostrarError('Tamaños de siempre', 'info');
  }
  function anchoDeSiempre(p: Exclude<Panel, null>) { setAnchos(a => { const n = { ...a }; delete n[p]; guardarLocal('lyra-anchos-propios', n); return n; }); }

  function arrastrarBarra(e: PointerEvent) {
    if (matchMedia('(max-width: 760px)').matches) return;
    e.preventDefault();
    const inicio = e.clientX, base = anchoBarra;
    let ultimo = base;
    const mover = (ev: PointerEvent) => { ultimo = Math.round(Math.min(Math.max(base + ev.clientX - inicio, 200), BARRA)); setAnchoBarra(ultimo); };
    const soltar = () => { window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', soltar); guardarLocal('lyra-barra', ultimo); document.body.classList.remove('arrastrando'); };
    document.body.classList.add('arrastrando');
    window.addEventListener('pointermove', mover); window.addEventListener('pointerup', soltar);
  }

  const botonesPanel = (
    <div class="iconos-grupo">
      <BotonIcono icono="indice" titulo="Índice (Ctrl+I)" activo={panel === 'indice'} onClick={() => alternar('indice')} />
      <BotonIcono icono="visor" titulo={hayNuevos ? 'Visor: hay archivos nuevos (Ctrl+O)' : 'Visor de archivos e imágenes (Ctrl+O)'} activo={panel === 'visor'} data-nuevo={hayNuevos ? 'true' : undefined} onClick={() => alternar('visor')} />
      <BotonIcono icono="rama" titulo="GitHub: cambios, PR, pruebas e issues de esta carpeta (Ctrl+G)" activo={panel === 'github'} onClick={() => alternar('github')} />
      <button type="button" class="icono-boton terminales-pestana" aria-label="Terminales" aria-pressed={panel === 'terminales'} onClick={() => alternar('terminales')}>
        <Icono nombre="terminal" />{(() => { const n = comandosTerminal(doc?.bloques || []).filter(corriendoTerminal).length; return n > 0 && <span class="terminales-contador">{n}</span>; })()}
      </button>
      <BotonIcono icono="memoria" titulo="Memorias de Claude, Codex y el local (Ctrl+M)" activo={panel === 'memorias'} onClick={() => alternar('memorias')} />
    </div>
  );

  return (
    <div id="app" class="lyra" data-panel={v && panel ? panel : 'oculto'} style={{ '--panel': `${ancho}px`, '--barra': `${anchoBarra}px` } as Record<string, string>}>
      <Barra abierta={cajon} onBorde={arrastrarBarra} onBordeDoble={() => { setAnchoBarra(BARRA); guardarLocal('lyra-barra', BARRA); }} onTamanos={tamanosDeSiempre} onNuevo={() => { elegir(null); setCajon(false); setTimeout(() => window.dispatchEvent(new Event('lyra-enfocar')), 30); }} onCerrarCajon={() => setCajon(false)} />
      <main class="lectura">
        {estado.rechazado ? (
          <div class="vacio">
            <h2>El servidor no aceptó esta ventana</h2>
            <p>Cierra esta ventana y ábrela otra vez con el comando <code>lyra-agentes</code> o desde el menú de aplicaciones.</p>
          </div>
        ) : (
          <>
            <header class="lectura-cabecera">
              <button class="boton-menu" aria-label="Conversaciones" onClick={() => setCajon(x => !x)}>☰</button>
              <div class="lectura-titulos">
                <h1 class="lectura-titulo">
                  {objetivo ? <TituloEditable clave="cabecera" titulo={titulo} clase="lectura-titulo-texto" onGuardar={t => renombrar(objetivo, t)} /> : titulo}
                </h1>
                <span class="lectura-ruta">{v ? rutaCorta(cwd) : rutaCorta(estado.borrador.cwd) || '~/'}{sesion && !agente ? ` · ${haceCuanto(sesion.modificado)}` : ''}</span>
              </div>
              {v && (
                <div class="iconos-grupo">
                  <BotonIcono icono="terminal" titulo="Abrir una terminal aquí" onClick={() => enviar({ t: 'abrir', con: 'terminal', cwd })} />
                  <BotonIcono icono="carpeta" titulo="Abrir la carpeta" onClick={() => enviar({ t: 'abrir', con: 'carpeta', cwd })} />
                  <BotonIcono icono="descargar" titulo="Guardar como Markdown (en Descargas)" onClick={() => guardarArchivo(nombreArchivo(titulo), exportar())} />
                  <BotonIcono icono="copiar" titulo="Copiar como Markdown" onClick={() => void navigator.clipboard.writeText(exportar()).then(() => mostrarError('Conversación copiada como Markdown', 'info'))} />
                </div>
              )}
              {v && botonesPanel}
              {v && <Bateria />}
              {v && <Reloj />}
            </header>
            {!estado.conectado && <div class="desconectado">Sin conexión con el servidor… reintentando</div>}
            {v ? (doc ? (
              <Lector claveVista={claveDoc} bloques={doc.bloques} cwd={cwd} quien={quien} irA={irA}
                onEntradas={(lista, activo) => setEntradas(prev => prev.lista === lista && prev.activo === activo ? prev : { lista, activo })} />
            ) : <div class="vacio"><p>Cargando la conversación…</p></div>) : (
              <div class="documento nuevo">
                <div class="portada">
                  <div class="marca-grande" aria-hidden="true">LYRA</div>
                  <Reloj grande />
                  <Bateria grande />
                </div>
              </div>
            )}
            <Redactor vista={v} agente={agente} />
          </>
        )}
        {estado.errores.length > 0 && (
          <div class="errores" role="alert">{estado.errores.map(e => <p key={e.id} data-nivel={e.nivel}>{e.texto}</p>)}</div>
        )}
      </main>
      {v && panel && (
        <aside class="panel" data-modo={panel}>
          <div class="panel-borde" onPointerDown={arrastrarBorde} onDblClick={() => anchoDeSiempre(panel)} />
          <header class="panel-cabecera">
            <span class="panel-nombre">{panel === 'indice' ? 'En esta conversación' : panel === 'github' ? 'GitHub' : panel === 'terminales' ? 'Terminales' : panel === 'memorias' ? 'Memorias' : 'Visor'}</span>
            <BotonIcono icono="cerrar" titulo="Cerrar el panel" onClick={() => ponerPanel(null)} />
          </header>
          <div class="panel-cuerpo">
            {panel === 'indice'
              ? <Indice entradas={entradas.lista} activo={entradas.activo} onIr={id => { setIrA(x => ({ id, vez: x.vez + 1 })); if (angosto) setPanelAngosto(null); }} />
              : panel === 'github' ? <Github cwd={cwd} turnos={turnos} />
              : panel === 'terminales' ? <Terminales key={claveDoc} bloques={doc?.bloques || []} />
              : panel === 'memorias' ? <Memorias cwd={cwd} proveedor={proveedor} />
              : <Visor bloques={doc?.bloques || []} cwd={cwd} />}
          </div>
        </aside>
      )}
      {cajon && <div class="cortina" onClick={() => setCajon(false)} />}
      {angosto && panelAngosto && v && <div class="cortina cortina-indice" onClick={() => setPanelAngosto(null)} />}
    </div>
  );
}

render(<App />, document.getElementById('raiz')!);
