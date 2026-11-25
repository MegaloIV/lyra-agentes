// La caja de texto de abajo, con los ajustes del agente a la mano (proveedor, modelo, esfuerzo, permisos y carpeta).
// Sin agente elegido es un agente nuevo: se crea al mandar el primer mensaje, con los ajustes que estén puestos.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { PermissionMode, Proveedor, ResumenAgente } from '@protocolo';
import { estado, enviar, crearAgente, cambiarBorrador, explorar, subirAdjunto, mostrarError, type Vista } from '../tienda.ts';
import { etiquetaAdjunto, textoConAdjuntos, rutasPegadas, type Adjunto } from '../adjuntos.ts';
import { Desplegable } from './Acciones.tsx';
import { Icono } from './iconos.tsx';
import { PROVEEDORES, cronometro, horaDe, info, miles, tokensCortos, modeloDe, nombreCarpeta, nombreEsfuerzo, nombreModo, nombreProveedor, rutaCorta } from '../util.ts';

const borradores = new Map<string, string>();
const archivosBorrador = new Map<string, Adjunto[]>();
/** Con qué se retoma una conversación del historial (vacío: el modelo y el esfuerzo predeterminados) */
type Reanudo = { modelo: string; esfuerzo: string; modo: PermissionMode };
const SIN_CAMBIOS: Reanudo = { modelo: '', esfuerzo: '', modo: 'default' };
const clave = (v: Vista) => v?.tipo === 'agente' ? v.id : v?.tipo === 'sesion' ? v.sessionId : 'nuevo';

const TEXTO_ESTADO: Record<string, string> = {
  trabajando: 'Trabajando…', esperando: 'Esperando tu respuesta', iniciando: 'Iniciando…',
  error: 'Se detuvo por un error', listo: '', cerrado: '',
};


const FASES = { pensando: 'Pensando', escribiendo: 'Escribiendo', herramienta: 'Trabajando' } as const;
/** «Pensando… 1m 23s · ↓ 2.3k tokens», como el contador de la terminal: el tiempo corre aquí y los tokens llegan del servidor */
function Contador({ agente }: { agente: ResumenAgente }) {
  const p = agente.progreso!, [, tic] = useState(0);
  useEffect(() => { const r = setInterval(() => tic(x => x + 1), 1000); return () => clearInterval(r); }, []);
  const accion = agente.estado === 'esperando' ? 'Esperando tu respuesta' : `${FASES[p.fase] || 'Trabajando'}…`;
  return <span class="contador">{accion} <span class="contador-datos">{cronometro(Date.now() - p.inicio)}{p.tokens > 0 ? ` · ↓ ${tokensCortos(p.tokens)} tokens` : ''}</span></span>;
}

/** Los ajustes van siempre en una línea: si no caben, se compactan por pasos (data-compacto 1…4, ver estilo.css)
 *  hasta que entren. Se mide de verdad, así un nombre de carpeta largo o el chip del contexto cuentan. */
const PASOS = 4;
function useCompactar(ref: { current: HTMLElement | null }) {
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    let ancho = -1;
    // Se suman los anchos de los chips (no scrollWidth: el menú abierto de un chip también desborda y no cuenta)
    const usado = () => { const h = [...el.children] as HTMLElement[]; const hueco = parseFloat(getComputedStyle(el).columnGap) || 0;
      return h.reduce((t, c) => t + c.getBoundingClientRect().width, 0) + hueco * Math.max(0, h.length - 1); };
    const ajustar = () => {
      ancho = el.clientWidth;
      let paso = 0;
      el.dataset.compacto = '0';
      while (usado() > el.clientWidth + 1 && paso < PASOS) el.dataset.compacto = String(++paso);
    };
    // En el cuadro siguiente: ajustar dentro del aviso del ResizeObserver lo hace avisar de nuevo (y WebKit lo da por error)
    const tam = new ResizeObserver(() => requestAnimationFrame(() => { if (el.clientWidth !== ancho) ajustar(); }));
    const cambios = new MutationObserver(ajustar);
    tam.observe(el); cambios.observe(el, { childList: true, subtree: true, characterData: true });
    ajustar();
    return () => { tam.disconnect(); cambios.disconnect(); };
  }, []);
}

/** Un chip que abre una lista corta hacia arriba */
function Chip({ id, abierto, setAbierto, texto, titulo, datos, children }: { id: string; abierto: string; setAbierto: (v: string) => void; texto: preact.ComponentChildren; titulo: string; datos?: Record<string, string | undefined>; children?: preact.ComponentChildren }) {
  return (
    <span class="ancla">
      <button type="button" class="chip" data-chip={id} title={titulo || undefined} aria-expanded={abierto === id} {...datos} onClick={() => setAbierto(abierto === id ? '' : id)}>{texto}</button>
      {abierto === id && <Desplegable clase="desplegable-arriba" onCerrar={() => setAbierto('')}>{children}</Desplegable>}
    </span>
  );
}
function Opcion({ actual, nota, al, children }: { actual?: boolean; nota?: string; al: () => void; children: preact.ComponentChildren }) {
  return <button type="button" aria-current={actual ? 'true' : undefined} title={nota} onClick={al}>{children}</button>;
}

/** Navega por las carpetas dentro del mismo menú: la ruta de arriba sube a cualquier nivel, la lista entra */
function Explorador({ desde, alElegir }: { desde: string; alElegir: (ruta: string) => void }) {
  useEffect(() => { explorar(desde || '~'); }, []);
  const e = estado.explorado;
  const corta = e ? rutaCorta(e.ruta) : rutaCorta(desde || '~');
  // ~/Proyectos/Lyra → [~, ~/Proyectos, ~/Proyectos/Lyra]; /mnt/shared → [/, /mnt, /mnt/shared]
  const partes = corta.split('/').filter(Boolean);
  const niveles = corta.startsWith('~')
    ? partes.map((p, i) => ({ nombre: p, ruta: partes.slice(0, i + 1).join('/') }))
    : [{ nombre: '/', ruta: '/' }, ...partes.map((p, i) => ({ nombre: p, ruta: '/' + partes.slice(0, i + 1).join('/') }))];
  const arriba = e && e.ruta !== '/' ? e.ruta.replace(/\/[^/]+$/, '') || '/' : '';
  return (
    <div class="explorador">
      <div class="explorador-ruta">
        {arriba && <button type="button" class="explorador-subir" onClick={() => explorar(arriba)}>‹</button>}
        {niveles.map((n, i) => (
          <span key={n.ruta} class="explorador-nivel">
            {i > 0 && n.nombre !== '/' && niveles[i - 1]!.nombre !== '/' && <span class="explorador-sep">/</span>}
            <button type="button" aria-current={i === niveles.length - 1 ? 'true' : undefined} onClick={() => explorar(n.ruta)}>{n.nombre}</button>
          </span>
        ))}
      </div>
      <div class="explorador-lista">
        {!e && <p class="desplegable-nota">…</p>}
        {e?.aviso && <p class="desplegable-nota">{e.aviso}</p>}
        {e?.carpetas.map(c => (
          <button type="button" key={c} onClick={() => explorar(`${e.ruta === '/' ? '' : e.ruta}/${c}`)}><Icono nombre="carpeta" tam={13} />{c}</button>
        ))}
        {e && !e.carpetas.length && !e.aviso && <p class="desplegable-nota">Sin subcarpetas</p>}
      </div>
      {e && <button type="button" class="explorador-usar" onClick={() => alElegir(rutaCorta(e.ruta))}>Usar «{nombreCarpeta(rutaCorta(e.ruta) || '/')}»</button>}
    </div>
  );
}

/** Los ajustes: del agente abierto (se cambian al vuelo), del agente nuevo (se guardan para la próxima vez)
 *  o de la conversación del historial que se va a retomar (valen para ese agente) */
function Ajustes({ agente, nuevo, sesion, reanudo, cambiarReanudo }: { agente?: ResumenAgente; nuevo: boolean; sesion?: { proveedor?: Proveedor; cwd: string }; reanudo: Reanudo; cambiarReanudo: (c: Partial<Reanudo>) => void }) {
  const [abierto, setAbierto] = useState('');
  const cerrar = () => setAbierto('');
  const b = estado.borrador;
  const proveedor = agente?.proveedor || (nuevo ? b.proveedor : sesion?.proveedor) || 'claude';
  const propios = nuevo ? b : reanudo;
  const datos = info(proveedor);
  const { nombre: nombreDelModelo, modelo } = modeloDe(proveedor, agente ? agente.modelo : propios.modelo || undefined);
  const esfuerzos = modelo?.esfuerzos || [];
  const esfuerzo = agente ? agente.esfuerzo : esfuerzos.includes(propios.esfuerzo) ? propios.esfuerzo : '';
  const modo = agente?.modo || propios.modo;
  const modos = datos?.modos || [{ valor: 'default' as const, nombre: 'Preguntar' }];
  const cwd = agente?.cwd || sesion?.cwd || b.cwd;
  const recientes = [...new Set([...estado.agentes.map(a => a.cwd), ...estado.historial.map(s => s.cwd)].filter(Boolean))].slice(0, 12);
  const [ruta, setRuta] = useState('');
  const [explorando, setExplorando] = useState(false);

  const cambiar = nuevo ? cambiarBorrador : cambiarReanudo;
  const ponerModelo = (v: string | null) => { if (agente) enviar({ t: 'modelo', agente: agente.id, modelo: v }); else cambiar({ modelo: v || '' }); cerrar(); };
  const ponerEsfuerzo = (v: string | null) => { if (agente) enviar({ t: 'esfuerzo', agente: agente.id, esfuerzo: v }); else cambiar({ esfuerzo: v || '' }); cerrar(); };
  const ponerModo = (v: PermissionMode) => { if (agente) enviar({ t: 'modo', agente: agente.id, modo: v }); else cambiar({ modo: v }); cerrar(); };

  if (!agente && !nuevo && !sesion) return <span class="chip" data-chip="proveedor" data-proveedor={proveedor}><span class="proveedor-punto" />{nombreProveedor(proveedor)}</span>;
  return (
    <>
      {nuevo ? (
        <Chip id="proveedor" abierto={abierto} setAbierto={setAbierto} titulo="" datos={{ 'data-proveedor': proveedor }} texto={<><span class="proveedor-punto" />{nombreProveedor(proveedor)}</>}>
          {PROVEEDORES.map(p => {
            const i = info(p.id), nota = i && !i.instalado ? 'no instalado' : p.id === 'codex' && i?.cuota?.agotada ? 'sin cuota' : p.id === 'local' && i?.instalado && !i.sesion ? 'sin modelos' : '';
            return (
              <Opcion key={p.id} actual={p.id === proveedor} al={() => { if (i && !i.instalado) return; cambiarBorrador({ proveedor: p.id, modelo: '', esfuerzo: '', modo: info(p.id)?.modos.some(m => m.valor === b.modo) ? b.modo : 'default' }); cerrar(); }}>
                <span class="proveedor-punto" data-proveedor={p.id} />{p.nombre}{nota && <small>{nota}</small>}
              </Opcion>
            );
          })}
        </Chip>
      ) : <span class="chip" data-chip="proveedor" data-proveedor={proveedor}><span class="proveedor-punto" />{nombreProveedor(proveedor)}</span>}

      <Chip id="modelo" abierto={abierto} setAbierto={setAbierto} titulo={modelo?.descripcion || 'Modelo'} texto={nombreDelModelo}>
        {(datos?.modelos || []).map(m => <Opcion key={m.valor || ''} actual={m === modelo} nota={m.descripcion} al={() => ponerModelo(m.valor)}>{m.nombre}</Opcion>)}
      </Chip>

      {esfuerzos.length > 0 && (
        <Chip id="esfuerzo" abierto={abierto} setAbierto={setAbierto} titulo="" texto={<><Icono nombre="chispa" tam={12} />{nombreEsfuerzo(esfuerzo || undefined).replace('Esfuerzo normal', 'Normal')}</>}>
          <Opcion actual={!esfuerzo} al={() => ponerEsfuerzo(null)}>{modelo?.esfuerzoDefecto ? `Normal (${nombreEsfuerzo(modelo.esfuerzoDefecto).toLowerCase()})` : 'Normal'}</Opcion>
          {esfuerzos.map(e => <Opcion key={e} actual={e === esfuerzo} al={() => ponerEsfuerzo(e)}>{nombreEsfuerzo(e)}</Opcion>)}
        </Chip>
      )}

      <Chip id="modo" abierto={abierto} setAbierto={setAbierto} titulo="" datos={{ 'data-modo': modo }} texto={<><Icono nombre="escudo" tam={12} />{nombreModo(modo, proveedor)}</>}>
        {/* «Sin preguntar» solo al crear o retomar: los proveedores no lo aceptan después */}
        {modos.filter(m => !agente || m.valor !== 'bypassPermissions').map(m => <Opcion key={m.valor} actual={m.valor === modo} al={() => ponerModo(m.valor)}>{m.nombre}</Opcion>)}
      </Chip>

      {nuevo ? (
        <Chip id="carpeta" abierto={abierto} setAbierto={setAbierto} titulo={`Carpeta: ${rutaCorta(cwd) || '~/'}`} texto={<><Icono nombre="carpeta" tam={12} />{nombreCarpeta(rutaCorta(cwd) || '~')}</>}>
          <div class="desplegable-pestanas">
            <button type="button" aria-pressed={!explorando} onClick={() => setExplorando(false)}>Recientes</button>
            <button type="button" aria-pressed={explorando} onClick={() => setExplorando(true)}>Explorar</button>
          </div>
          {explorando
            ? <Explorador desde={cwd} alElegir={r => { cambiarBorrador({ cwd: r }); cerrar(); }} />
            : recientes.map(r => <Opcion key={r} actual={rutaCorta(r) === rutaCorta(cwd)} nota={rutaCorta(r)} al={() => { cambiarBorrador({ cwd: rutaCorta(r) }); cerrar(); }}>{nombreCarpeta(r)}<small>{rutaCorta(r).replace(/\/[^/]+$/, '') || '/'}</small></Opcion>)}
          <form class="desplegable-campo" onSubmit={e => { e.preventDefault(); if (ruta.trim()) { cambiarBorrador({ cwd: ruta.trim() }); setRuta(''); cerrar(); } }}>
            <input placeholder="Otra ruta… (Enter)" value={ruta} spellcheck={false} onInput={e => setRuta((e.currentTarget as HTMLInputElement).value)} />
          </form>
        </Chip>
      ) : <span class="chip" data-chip="carpeta" title={rutaCorta(cwd)}><Icono nombre="carpeta" tam={12} />{nombreCarpeta(cwd)}</span>}

      {agente?.contexto && <span class="chip" data-chip="contexto">{miles(agente.contexto.usados)} / {miles(agente.contexto.total)}</span>}
    </>
  );
}

export function Redactor({ vista, agente }: { vista: Vista; agente?: ResumenAgente }) {
  const prefijo = useRef(0);
  const caja = useRef<HTMLTextAreaElement>(null);
  const selector = useRef<HTMLInputElement>(null);
  const ajustes = useRef<HTMLDivElement>(null);
  useCompactar(ajustes);
  const componiendo = useRef(false);
  /** Lo último que borró Ctrl+U, para que Ctrl+Z lo devuelva */
  const borrado = useRef<{ clave: string; texto: string; adjuntos: Adjunto[] } | null>(null);
  const [texto, actualizarTexto] = useState(() => borradores.get(clave(vista)) || '');
  const [adjuntos, setAdjuntos] = useState<Adjunto[]>(() => archivosBorrador.get(clave(vista)) || []);
  const [subiendo, setSubiendo] = useState(0);
  const [elegido, setElegido] = useState(0);
  const [popupCerrado, setPopupCerrado] = useState(false);
  const [avisoEsc, setAvisoEsc] = useState(0);
  const [reanudo, setReanudo] = useState<Reanudo>(SIN_CAMBIOS);
  const cambiarReanudo = (c: Partial<Reanudo>) => setReanudo(r => ({ ...r, ...c }));
  const k = clave(vista);
  const vistaActual = useRef(k);
  vistaActual.current = k;
  function setTexto(valor: string | ((anterior: string) => string)) {
    actualizarTexto(prev => { const siguiente = typeof valor === 'function' ? valor(prev) : valor; borradores.set(k, siguiente); return siguiente; });
  }
  const nuevo = vista === null;

  useLayoutEffect(() => { prefijo.current = 0; componiendo.current = false; actualizarTexto(borradores.get(k) || ''); setAdjuntos(archivosBorrador.get(k) || []); setElegido(0); setPopupCerrado(false); setReanudo(SIN_CAMBIOS); caja.current?.focus({ preventScroll: true }); }, [k]);
  useLayoutEffect(() => {
    const t = caja.current; if (!t || componiendo.current) return;
    // No controlar value en cada render: WebKit puede cancelar la tecla muerta o el IME
    // cuando llega un bloque del agente mientras se está componiendo una vocal acentuada.
    if (t.value !== texto) t.value = texto;
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, window.innerHeight * 0.4) + 'px';
  }, [texto]);
  useEffect(() => {
    const enfocar = () => caja.current?.focus();
    window.addEventListener('lyra-enfocar', enfocar);
    // La pestaña GitHub escribe encargos aquí; se suman a lo que ya hubiera escrito
    const insertar = (e: Event) => {
      const t = String((e as CustomEvent).detail || '');
      setTexto(prev => prev.trim() ? prev.trimEnd() + '\n\n' + t : t);
      setTimeout(() => { const c = caja.current; if (c) { c.focus(); c.setSelectionRange(c.value.length, c.value.length); c.scrollTop = c.scrollHeight; } }, 0);
    };
    window.addEventListener('lyra-insertar', insertar);
    return () => { window.removeEventListener('lyra-enfocar', enfocar); window.removeEventListener('lyra-insertar', insertar); };
  }, [k]);
  // El agente nuevo arranca en la carpeta del último usado si no hay una elegida
  if (nuevo && !estado.borrador.cwd) { const c = estado.agentes[0]?.cwd || estado.historial[0]?.cwd; if (c) estado.borrador.cwd = rutaCorta(c); }

  const trabajando = agente?.estado === 'trabajando' || agente?.estado === 'esperando';
  // Sin agente abierto (una conversación del historial) sirven los de otro agente del mismo proveedor
  const proveedorVista = agente?.proveedor || (vista?.tipo === 'sesion' ? vista.proveedor : undefined);
  const comandos = (agente ? estado.comandos.get(agente.id) : undefined)?.length ? estado.comandos.get(agente!.id)!
    : estado.agentes.filter(a => a.proveedor === proveedorVista).map(a => estado.comandos.get(a.id) || []).find(l => l.length)
      || (proveedorVista === 'claude' ? estado.comandos.get('claude') : undefined) || [];
  const buscando = /^\/(\S*)$/.exec(texto);
  // Si la lista llegó vacía (se pidió antes de que el agente terminara de arrancar) se vuelve a pedir al escribir «/»
  useEffect(() => {
    if (!buscando || comandos.length || (agente ? agente.proveedor === 'codex' : proveedorVista !== 'claude')) return;
    const t = setTimeout(() => enviar({ t: 'comandos', agente: agente?.id || 'claude' }), 150);
    return () => clearTimeout(t);
  }, [!!buscando, agente?.id, agente?.estado, comandos.length]);
  const filtrados = buscando && !popupCerrado ? comandos.filter(c => c.nombre.replace(/^\//, '').toLowerCase().startsWith(buscando[1]!.toLowerCase())).slice(0, 30) : [];
  const indice = Math.min(elegido, Math.max(0, filtrados.length - 1));
  const b = estado.borrador, datosNuevo = nuevo ? info(b.proveedor) : undefined;
  const falta = nuevo ? !datosNuevo ? 'Cargando los modelos…' : !datosNuevo.instalado ? `${datosNuevo.nombre} no está instalado.` : '' : '';

  /** `ya`: Ctrl+X Ctrl+S, como en la terminal: si el agente está trabajando, lo interrumpe y manda el mensaje enseguida */
  function mandar(ya = false) {
    if (subiendo || componiendo.current || !texto.trim()) return;
    const t = textoConAdjuntos(texto, adjuntos);
    if (nuevo) {
      if (falta) return;
      const modelo = modeloDe(b.proveedor, b.modelo || undefined).modelo;
      let cwd = b.cwd.trim() || '~/'; if (cwd === '~') cwd = '~/';
      crearAgente({ t: 'crear', cwd, proveedor: b.proveedor, modelo: b.modelo || undefined, esfuerzo: modelo?.esfuerzos?.includes(b.esfuerzo) ? b.esfuerzo : undefined, modo: b.modo, prompt: t });
    }
    else if (vista?.tipo === 'sesion') {
      const esfuerzos = modeloDe(vista.proveedor || 'claude', reanudo.modelo || undefined).modelo?.esfuerzos;
      crearAgente({ t: 'reanudar', sessionId: vista.sessionId, cwd: vista.cwd, proveedor: vista.proveedor, texto: t, modelo: reanudo.modelo || undefined,
        esfuerzo: esfuerzos?.includes(reanudo.esfuerzo) ? reanudo.esfuerzo : undefined, modo: reanudo.modo === 'default' ? undefined : reanudo.modo });
    }
    else if (agente?.estado === 'error' && agente.sessionId) crearAgente({ t: 'reanudar', sessionId: agente.sessionId, cwd: agente.cwd, proveedor: agente.proveedor, texto: t });
    else if (agente) enviar({ t: 'enviar', agente: agente.id, texto: t, ...(ya && trabajando ? { ya: true } : {}) });
    else return;
    setTexto(''); borradores.delete(k);
    archivosBorrador.delete(k); setAdjuntos([]);
  }

  function agregarAdjunto(ruta: string, nombre: string, tipo: string, destino: string) {
    const anteriores = archivosBorrador.get(destino) || [];
    const etiqueta = etiquetaAdjunto(nombre, tipo, anteriores);
    const lista = [...anteriores, { ruta, nombre, etiqueta }];
    archivosBorrador.set(destino, lista);
    const insertar = (prev: string) => `${prev}${prev && !/\s$/.test(prev) ? ' ' : ''}${etiqueta} `;
    if (vistaActual.current === destino) { setAdjuntos(lista); setTexto(insertar); }
    else borradores.set(destino, insertar(borradores.get(destino) || ''));
  }
  async function adjuntar(archivos: File[]) {
    const destino = k;
    setSubiendo(n => n + 1);
    try {
      for (const archivo of archivos) {
        const a = await subirAdjunto(archivo);
        agregarAdjunto(a.ruta, a.nombre, archivo.type, destino);
      }
    } catch (e) { mostrarError(e instanceof Error ? e.message : 'No se pudo adjuntar.'); }
    finally { setSubiendo(n => n - 1); }
  }
  function recibirArchivos(datos: DataTransfer | null): boolean {
    if (!datos) return false;
    let archivos = [...datos.files];
    if (!archivos.length) archivos = [...datos.items].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter((f): f is File => !!f);
    if (archivos.length) { void adjuntar(archivos); return true; }
    // Una captura (Super+P) llega como image/png sin archivo en algunos WebKit: se lee del portapapeles
    if (datos.types.some(t => t.startsWith('image/')) && navigator.clipboard?.read) {
      void navigator.clipboard.read().then(async items => {
        const imagenes: File[] = [];
        for (const item of items) {
          const tipo = item.types.find(t => t.startsWith('image/')); if (!tipo) continue;
          imagenes.push(new File([await item.getType(tipo)], `captura.${tipo.split('/')[1] || 'png'}`, { type: tipo }));
        }
        if (imagenes.length) await adjuntar(imagenes); else mostrarError('No se pudo leer la imagen del portapapeles.');
      }, () => mostrarError('No se pudo leer la imagen del portapapeles.'));
      return true;
    }
    const rutas = rutasPegadas(datos.getData('text/uri-list') || datos.getData('x-special/gnome-copied-files'));
    for (const ruta of rutas) agregarAdjunto(ruta, ruta.split('/').at(-1) || 'archivo', '', k);
    return rutas.length > 0;
  }

  function completar(i: number) {
    const c = filtrados[i]; if (!c) return;
    setTexto('/' + c.nombre.replace(/^\//, '') + ' ');
    setPopupCerrado(true);
    caja.current?.focus();
  }

  /** Shift+Tab: siguiente modo de permisos, como en la terminal */
  function siguienteModo() {
    const proveedor = agente?.proveedor || (vista?.tipo === 'sesion' ? vista.proveedor || 'claude' : b.proveedor);
    const ciclo = (info(proveedor)?.modos.map(m => m.valor) || ['default']).filter(m => m !== 'bypassPermissions') as PermissionMode[];
    const actual = agente?.modo || (vista?.tipo === 'sesion' ? reanudo.modo : b.modo);
    const sig = ciclo[(ciclo.indexOf(actual) + 1) % ciclo.length] || 'default';
    if (agente) enviar({ t: 'modo', agente: agente.id, modo: sig }); else if (vista?.tipo === 'sesion') cambiarReanudo({ modo: sig }); else cambiarBorrador({ modo: sig });
  }

  function tecla(e: KeyboardEvent) {
    if (componiendo.current || e.isComposing || e.key === 'Dead' || e.keyCode === 229) return;
    const letra = e.key.toLowerCase();
    if (e.ctrlKey && !e.altKey && !e.metaKey && letra === 'x') {
      // Sin nada seleccionado no hay qué cortar: la ventana sonaba con cada Ctrl+X
      const c = caja.current;
      if (!c || c.selectionStart === c.selectionEnd) e.preventDefault();
      if (!e.repeat) prefijo.current = Date.now();
      return;
    }
    if (e.ctrlKey && !e.altKey && !e.metaKey && letra === 's') {
      e.preventDefault();
      if (!e.repeat && prefijo.current && Date.now() - prefijo.current <= 1500) mandar(true);
      prefijo.current = 0; return;
    }
    if (!['Control', 'Shift'].includes(e.key)) prefijo.current = 0;
    // Ctrl+U: borra todo lo escrito y los adjuntos; Ctrl+Z, mientras no se escriba otra cosa, los devuelve.
    // Se guarda aquí y no se confía en el deshacer de WebKit, que en la ventana no lo recuperaba.
    if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && letra === 'u') {
      e.preventDefault();
      if (texto || adjuntos.length) borrado.current = { clave: k, texto, adjuntos };
      setTexto(''); archivosBorrador.delete(k); setAdjuntos([]);
      return;
    }
    if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && letra === 'z' && borrado.current?.clave === k && !caja.current?.value) {
      e.preventDefault();
      const b = borrado.current; borrado.current = null;
      archivosBorrador.set(k, b.adjuntos); setAdjuntos(b.adjuntos); setTexto(b.texto);
      requestAnimationFrame(() => { const c = caja.current; if (c) { c.focus(); c.setSelectionRange(c.value.length, c.value.length); } });
      return;
    }
    if (e.ctrlKey && letra === 'c') {
      const c = caja.current;
      if (window.getSelection()?.toString() || (c && c.selectionStart !== c.selectionEnd)) return;
      e.preventDefault();
      if (!e.repeat && trabajando && agente) enviar({ t: 'interrumpir', agente: agente.id });
      return;
    }
    if (filtrados.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setElegido((indice + 1) % filtrados.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setElegido((indice - 1 + filtrados.length) % filtrados.length); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && buscando?.[1] !== filtrados[indice]!.nombre.replace(/^\//, ''))) { e.preventDefault(); completar(indice); return; }
      if (e.key === 'Escape') { e.preventDefault(); setPopupCerrado(true); return; }
    }
    if (e.key === 'Tab' && e.shiftKey && (nuevo || agente || vista?.tipo === 'sesion')) { e.preventDefault(); siguienteModo(); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); mandar(); return; }
    if (e.key === 'Escape' && trabajando && agente) {
      e.preventDefault();
      if (Date.now() - avisoEsc < 2000) { enviar({ t: 'interrumpir', agente: agente.id }); setAvisoEsc(0); }
      else { const ahora = Date.now(); setAvisoEsc(ahora); setTimeout(() => setAvisoEsc(v => v === ahora ? 0 : v), 2000); }
    }
  }

  const soloLectura = vista?.tipo === 'sesion';
  const textoEstado = avisoEsc ? 'Pulsa Esc otra vez para detener'
    : falta || (agente?.estado === 'error' && agente.sessionId ? 'Se detuvo · escribe o reanuda'
    : TEXTO_ESTADO[agente?.estado || ''] || '');
  const cuota = datosNuevo?.cuota;
  const quien = nombreProveedor(agente?.proveedor || (nuevo ? b.proveedor : vista?.tipo === 'sesion' ? vista.proveedor : undefined));

  return (
    <footer class="redactor">
      {nuevo && datosNuevo?.id === 'local' && datosNuevo.instalado && !datosNuevo.sesion && (
        <div class="redactor-aviso">Ollama no tiene modelos que sepan usar herramientas con al menos 16k de contexto.</div>
      )}
      {nuevo && datosNuevo?.id === 'local' && datosNuevo.sesion && (
        <div class="redactor-aviso redactor-aviso-suave">Corre en tu computadora: nada sale de ella, pero es más lento que los otros.</div>
      )}
      {nuevo && cuota && (cuota.agotada || cuota.usado >= 80) && (
        <div class="redactor-aviso" data-nivel={cuota.agotada ? 'error' : 'info'}>{cuota.agotada ? 'Se acabó tu cuota de Codex' : `Usaste el ${cuota.usado} % de tu cuota de Codex`}{cuota.renueva ? `; vuelve ${horaDe(cuota.renueva)}.` : '.'}</div>
      )}
      {filtrados.length > 0 && (
        <div class="comandos" role="listbox">
          {filtrados.map((c, i) => (
            <button key={c.nombre} type="button" class="comando" aria-selected={i === indice} onMouseDown={e => { e.preventDefault(); completar(i); }}>
              <strong>/{c.nombre.replace(/^\//, '')}</strong><span>{c.descripcion}</span>
            </button>
          ))}
        </div>
      )}
      <div class="redactor-caja" data-nuevo={nuevo ? 'true' : undefined}
        onDragOver={e => { if ([...e.dataTransfer?.types || []].some(t => t === 'Files' || t === 'text/uri-list')) e.preventDefault(); }}
        onDrop={e => { if (recibirArchivos(e.dataTransfer)) e.preventDefault(); }}>
        {/* Flota sobre la caja: que aparezca o cambie de largo no corre los ajustes ni los botones */}
        {!filtrados.length && <span class="redactor-estado">{!avisoEsc && trabajando && agente?.progreso && !agente.progreso.fin ? <Contador agente={agente} /> : textoEstado}</span>}
        {!!adjuntos.length && <div class="redactor-adjuntos">{adjuntos.map(a => <span class="redactor-adjunto" key={a.etiqueta} title={a.ruta}>
          <Icono nombre={a.etiqueta.startsWith('[imagen') ? 'imagen' : 'leer'} tam={13} />
          <span class="redactor-adjunto-texto"><b>{a.etiqueta.slice(1, -1)}</b> {a.nombre}</span>
          <button type="button" aria-label={`Quitar ${a.nombre}`} onClick={() => {
            const lista = adjuntos.filter(x => x !== a); archivosBorrador.set(k, lista); setAdjuntos(lista); setTexto(t => t.replaceAll(a.etiqueta, '').replace(/ {2,}/g, ' '));
          }}><Icono nombre="cerrar" tam={11} /></button></span>)}</div>}
        <textarea ref={caja} class="redactor-texto" rows={1}
          placeholder={soloLectura ? 'Escribe para retomar esta conversación…' : nuevo ? `¿Qué hacemos? (Enter envía · Shift+Enter, nueva línea)` : `Escribe a ${quien}…`}
          onInput={e => { if (e.currentTarget.value) borrado.current = null; e.currentTarget.dataset.escribiendo = String(Date.now()); setTexto(e.currentTarget.value); setPopupCerrado(false); setElegido(0); }}
          onCompositionStart={() => { componiendo.current = true; }}
          onCompositionEnd={e => { componiendo.current = false; setTexto(e.currentTarget.value); }}
          onPaste={e => { if (recibirArchivos(e.clipboardData)) e.preventDefault(); }}
          onKeyDown={tecla} onBlur={() => { prefijo.current = 0; }} />
        <div class="redactor-barra">
          <input ref={selector} type="file" multiple hidden onChange={e => { void adjuntar([...e.currentTarget.files || []]); e.currentTarget.value = ''; }} />
          <button type="button" class="redactor-adjuntar" aria-label="Adjuntar archivos" data-subiendo={subiendo ? 'true' : undefined} disabled={!!subiendo} onClick={() => selector.current?.click()}><Icono nombre="clip" tam={15} /></button>
          <div class="ajustes" ref={ajustes}><Ajustes agente={agente} nuevo={nuevo} sesion={!agente && vista?.tipo === 'sesion' ? vista : undefined} reanudo={reanudo} cambiarReanudo={cambiarReanudo} /></div>
          {agente?.estado === 'error' && agente.sessionId && <button type="button" class="icono-boton" onClick={() => crearAgente({ t: 'reanudar', sessionId: agente.sessionId!, cwd: agente.cwd, proveedor: agente.proveedor })}><Icono nombre="recargar" /></button>}
          {trabajando && <button type="button" class="boton-detener" aria-label="Detener" onClick={() => agente && enviar({ t: 'interrumpir', agente: agente.id })}><Icono nombre="detener" /></button>}
          <button type="button" class="boton-enviar" aria-label="Enviar" disabled={!texto.trim() || !!falta || !!subiendo} onClick={() => mandar()}><Icono nombre="enviar" /></button>
        </div>
      </div>
    </footer>
  );
}
