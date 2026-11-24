// La caja de texto de abajo, con los ajustes del agente a la mano (proveedor, modelo, esfuerzo, permisos y carpeta).
// Sin agente elegido es un agente nuevo: se crea al mandar el primer mensaje, con los ajustes que estén puestos.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { PermissionMode, Proveedor, ResumenAgente } from '@protocolo';
import { estado, enviar, crearAgente, cambiarBorrador, type Vista } from '../tienda.ts';
import { Desplegable } from './Acciones.tsx';
import { Icono } from './iconos.tsx';
import { PROVEEDORES, info, miles, modeloDe, nombreCarpeta, nombreEsfuerzo, nombreModo, nombreProveedor, rutaCorta } from '../util.ts';

const borradores = new Map<string, string>();
const clave = (v: Vista) => v?.tipo === 'agente' ? v.id : v?.tipo === 'sesion' ? v.sessionId : 'nuevo';

const TEXTO_ESTADO: Record<string, string> = {
  trabajando: 'Trabajando…', esperando: 'Esperando tu respuesta', iniciando: 'Iniciando…',
  error: 'Se detuvo por un error', listo: '', cerrado: '',
};

function horaDe(ms: number) {
  const d = new Date(ms), hoy = new Date();
  const h = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === hoy.toDateString() ? `a las ${h}` : `el ${d.toLocaleDateString('es', { weekday: 'long', day: 'numeric' })} a las ${h}`;
}

/** Un chip que abre una lista corta hacia arriba */
function Chip({ id, abierto, setAbierto, texto, titulo, datos, children }: { id: string; abierto: string; setAbierto: (v: string) => void; texto: preact.ComponentChildren; titulo: string; datos?: Record<string, string | undefined>; children?: preact.ComponentChildren }) {
  return (
    <span class="ancla">
      <button type="button" class="chip" data-chip={id} title={titulo} aria-expanded={abierto === id} {...datos} onClick={() => setAbierto(abierto === id ? '' : id)}>{texto}</button>
      {abierto === id && <Desplegable clase="desplegable-arriba" onCerrar={() => setAbierto('')}>{children}</Desplegable>}
    </span>
  );
}
function Opcion({ actual, nota, al, children }: { actual?: boolean; nota?: string; al: () => void; children: preact.ComponentChildren }) {
  return <button type="button" aria-current={actual ? 'true' : undefined} title={nota} onClick={al}>{children}</button>;
}

/** Los ajustes: del agente abierto (se cambian al vuelo) o del agente nuevo (se guardan para la próxima vez) */
function Ajustes({ agente, nuevo, solo }: { agente?: ResumenAgente; nuevo: boolean; solo?: Proveedor }) {
  const [abierto, setAbierto] = useState('');
  const cerrar = () => setAbierto('');
  const b = estado.borrador;
  const proveedor = agente?.proveedor || (nuevo ? b.proveedor : solo) || 'claude';
  const datos = info(proveedor);
  const { nombre: nombreDelModelo, modelo } = modeloDe(proveedor, agente ? agente.modelo : b.modelo || undefined);
  const esfuerzos = modelo?.esfuerzos || [];
  const esfuerzo = agente ? agente.esfuerzo : esfuerzos.includes(b.esfuerzo) ? b.esfuerzo : '';
  const modo = agente?.modo || (nuevo ? b.modo : 'default');
  const modos = datos?.modos || [{ valor: 'default' as const, nombre: 'Preguntar' }];
  const cwd = agente?.cwd || b.cwd;
  const recientes = [...new Set([...estado.agentes.map(a => a.cwd), ...estado.historial.map(s => s.cwd)].filter(Boolean))].slice(0, 12);
  const [ruta, setRuta] = useState('');

  const ponerModelo = (v: string | null) => { if (agente) enviar({ t: 'modelo', agente: agente.id, modelo: v }); else cambiarBorrador({ modelo: v || '' }); cerrar(); };
  const ponerEsfuerzo = (v: string | null) => { if (agente) enviar({ t: 'esfuerzo', agente: agente.id, esfuerzo: v }); else cambiarBorrador({ esfuerzo: v || '' }); cerrar(); };
  const ponerModo = (v: PermissionMode) => { if (agente) enviar({ t: 'modo', agente: agente.id, modo: v }); else cambiarBorrador({ modo: v }); cerrar(); };

  if (!agente && !nuevo) return <span class="chip" data-chip="proveedor" data-proveedor={proveedor}><span class="proveedor-punto" />{nombreProveedor(proveedor)}</span>;
  return (
    <>
      {nuevo ? (
        <Chip id="proveedor" abierto={abierto} setAbierto={setAbierto} titulo="Con quién trabajar" datos={{ 'data-proveedor': proveedor }} texto={<><span class="proveedor-punto" />{nombreProveedor(proveedor)}</>}>
          {PROVEEDORES.map(p => {
            const i = info(p.id), nota = i && !i.instalado ? 'no instalado' : p.id === 'codex' && i?.cuota?.agotada ? 'sin cuota' : p.id === 'gemini' && i?.instalado && !i.sesion ? 'sin sesión' : p.id === 'local' && i?.instalado && !i.sesion ? 'sin modelos' : '';
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
        <Chip id="esfuerzo" abierto={abierto} setAbierto={setAbierto} titulo="Cuánto razona antes de responder" texto={<><Icono nombre="chispa" tam={12} />{nombreEsfuerzo(esfuerzo || undefined).replace('Esfuerzo normal', 'Normal')}</>}>
          <Opcion actual={!esfuerzo} al={() => ponerEsfuerzo(null)}>{modelo?.esfuerzoDefecto ? `Normal (${nombreEsfuerzo(modelo.esfuerzoDefecto).toLowerCase()})` : 'Normal'}</Opcion>
          {esfuerzos.map(e => <Opcion key={e} actual={e === esfuerzo} al={() => ponerEsfuerzo(e)}>{nombreEsfuerzo(e)}</Opcion>)}
        </Chip>
      )}

      <Chip id="modo" abierto={abierto} setAbierto={setAbierto} titulo="Permisos: qué puede hacer sin preguntarte (Shift+Tab cambia)" datos={{ 'data-modo': modo }} texto={<><Icono nombre="escudo" tam={12} />{nombreModo(modo, proveedor)}</>}>
        {/* «Sin preguntar» solo al crear: los proveedores no lo aceptan después */}
        {modos.filter(m => nuevo || m.valor !== 'bypassPermissions').map(m => <Opcion key={m.valor} actual={m.valor === modo} al={() => ponerModo(m.valor)}>{m.nombre}</Opcion>)}
      </Chip>

      {nuevo ? (
        <Chip id="carpeta" abierto={abierto} setAbierto={setAbierto} titulo={`Carpeta: ${rutaCorta(cwd) || '~/'}`} texto={<><Icono nombre="carpeta" tam={12} />{nombreCarpeta(rutaCorta(cwd) || '~')}</>}>
          {recientes.map(r => <Opcion key={r} actual={rutaCorta(r) === rutaCorta(cwd)} nota={rutaCorta(r)} al={() => { cambiarBorrador({ cwd: rutaCorta(r) }); cerrar(); }}>{nombreCarpeta(r)}<small>{rutaCorta(r).replace(/\/[^/]+$/, '') || '/'}</small></Opcion>)}
          <form class="desplegable-campo" onSubmit={e => { e.preventDefault(); if (ruta.trim()) { cambiarBorrador({ cwd: ruta.trim() }); setRuta(''); cerrar(); } }}>
            <input placeholder="Otra ruta… (Enter)" value={ruta} spellcheck={false} onInput={e => setRuta((e.currentTarget as HTMLInputElement).value)} />
            <button type="button" class="icono-boton" title="Elegir con el selector de carpetas" onClick={() => { enviar({ t: 'elegirCarpeta' }); cerrar(); }}><Icono nombre="carpeta" /></button>
          </form>
        </Chip>
      ) : <span class="chip" data-chip="carpeta" title={rutaCorta(cwd)}><Icono nombre="carpeta" tam={12} />{nombreCarpeta(cwd)}</span>}

      {agente?.contexto && <span class="chip" data-chip="contexto" title="Contexto usado">{miles(agente.contexto.usados)} / {miles(agente.contexto.total)}</span>}
    </>
  );
}

export function Redactor({ vista, agente }: { vista: Vista; agente?: ResumenAgente }) {
  const caja = useRef<HTMLTextAreaElement>(null);
  const [texto, setTexto] = useState(() => borradores.get(clave(vista)) || '');
  const [elegido, setElegido] = useState(0);
  const [popupCerrado, setPopupCerrado] = useState(false);
  const [avisoEsc, setAvisoEsc] = useState(0);
  const k = clave(vista);
  const nuevo = vista === null;

  useEffect(() => { setTexto(borradores.get(k) || ''); setElegido(0); setPopupCerrado(false); caja.current?.focus(); }, [k]);
  useEffect(() => { borradores.set(k, texto); }, [texto, k]);
  useLayoutEffect(() => {
    const t = caja.current; if (!t) return;
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, window.innerHeight * 0.4) + 'px';
  }, [texto]);
  useEffect(() => {
    const enfocar = () => caja.current?.focus();
    window.addEventListener('lyra-enfocar', enfocar);
    return () => window.removeEventListener('lyra-enfocar', enfocar);
  }, []);
  // Respuesta del selector de carpetas (zenity)
  const vezCarpeta = useRef(estado.carpeta.vez);
  useEffect(() => {
    if (estado.carpeta.vez === vezCarpeta.current) return;
    vezCarpeta.current = estado.carpeta.vez;
    if (estado.carpeta.ruta) cambiarBorrador({ cwd: rutaCorta(estado.carpeta.ruta) });
  });
  // El agente nuevo arranca en la carpeta del último usado si no hay una elegida
  if (nuevo && !estado.borrador.cwd) { const c = estado.agentes[0]?.cwd || estado.historial[0]?.cwd; if (c) estado.borrador.cwd = rutaCorta(c); }

  const trabajando = agente?.estado === 'trabajando' || agente?.estado === 'esperando';
  const comandos = agente ? estado.comandos.get(agente.id) || [] : [];
  const buscando = /^\/(\S*)$/.exec(texto);
  const filtrados = buscando && !popupCerrado ? comandos.filter(c => c.nombre.replace(/^\//, '').toLowerCase().startsWith(buscando[1]!.toLowerCase())).slice(0, 30) : [];
  const indice = Math.min(elegido, Math.max(0, filtrados.length - 1));
  const b = estado.borrador, datosNuevo = nuevo ? info(b.proveedor) : undefined;
  const falta = nuevo ? !datosNuevo ? 'Cargando los modelos…' : !datosNuevo.instalado ? `${datosNuevo.nombre} no está instalado.` : '' : '';

  function mandar() {
    const t = texto.trim();
    if (!t) return;
    if (nuevo) {
      if (falta) return;
      const modelo = modeloDe(b.proveedor, b.modelo || undefined).modelo;
      let cwd = b.cwd.trim() || '~/'; if (cwd === '~') cwd = '~/';
      crearAgente({ t: 'crear', cwd, proveedor: b.proveedor, modelo: b.modelo || undefined, esfuerzo: modelo?.esfuerzos?.includes(b.esfuerzo) ? b.esfuerzo : undefined, modo: b.modo, prompt: t });
    }
    else if (vista?.tipo === 'sesion') crearAgente({ t: 'reanudar', sessionId: vista.sessionId, cwd: vista.cwd, proveedor: vista.proveedor, texto: t });
    else if (agente?.estado === 'error' && agente.sessionId) crearAgente({ t: 'reanudar', sessionId: agente.sessionId, cwd: agente.cwd, proveedor: agente.proveedor, texto: t });
    else if (agente) enviar({ t: 'enviar', agente: agente.id, texto: t });
    else return;
    setTexto(''); borradores.delete(k);
  }

  function completar(i: number) {
    const c = filtrados[i]; if (!c) return;
    setTexto('/' + c.nombre.replace(/^\//, '') + ' ');
    setPopupCerrado(true);
    caja.current?.focus();
  }

  /** Shift+Tab: siguiente modo de permisos, como en la terminal */
  function siguienteModo() {
    const proveedor = agente?.proveedor || b.proveedor;
    const ciclo = (info(proveedor)?.modos.map(m => m.valor) || ['default']).filter(m => m !== 'bypassPermissions') as PermissionMode[];
    const actual = agente?.modo || b.modo;
    const sig = ciclo[(ciclo.indexOf(actual) + 1) % ciclo.length] || 'default';
    if (agente) enviar({ t: 'modo', agente: agente.id, modo: sig }); else cambiarBorrador({ modo: sig });
  }

  function tecla(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (filtrados.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setElegido((indice + 1) % filtrados.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setElegido((indice - 1 + filtrados.length) % filtrados.length); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && buscando?.[1] !== filtrados[indice]!.nombre.replace(/^\//, ''))) { e.preventDefault(); completar(indice); return; }
      if (e.key === 'Escape') { e.preventDefault(); setPopupCerrado(true); return; }
    }
    if (e.key === 'Tab' && e.shiftKey && (nuevo || agente)) { e.preventDefault(); siguienteModo(); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); mandar(); return; }
    if (e.key === 'Escape' && trabajando && agente) {
      e.preventDefault();
      if (Date.now() - avisoEsc < 2000) { enviar({ t: 'interrumpir', agente: agente.id }); setAvisoEsc(0); }
      else { const ahora = Date.now(); setAvisoEsc(ahora); setTimeout(() => setAvisoEsc(v => v === ahora ? 0 : v), 2000); }
    }
  }

  const soloLectura = vista?.tipo === 'sesion';
  const textoEstado = avisoEsc ? 'Pulsa Esc otra vez para detener'
    : falta || (soloLectura ? 'Escribe para retomarla'
    : agente?.estado === 'error' && agente.sessionId ? 'Se detuvo · escribe o reanuda'
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
      {nuevo && datosNuevo?.id === 'gemini' && datosNuevo.instalado && !datosNuevo.sesion && (
        <div class="redactor-aviso">Gemini todavía no tiene tu cuenta de Google. <button type="button" class="enlace" onClick={() => enviar({ t: 'abrir', con: 'loginGemini' })}>Iniciar sesión</button></div>
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
      <div class="redactor-caja" data-nuevo={nuevo ? 'true' : undefined}>
        <textarea ref={caja} class="redactor-texto" rows={1} value={texto}
          placeholder={soloLectura ? 'Escribe para retomar esta conversación…' : nuevo ? `¿Qué hacemos? (Enter envía · Shift+Enter, nueva línea)` : `Escribe a ${quien}…`}
          onInput={e => { setTexto((e.currentTarget as HTMLTextAreaElement).value); setPopupCerrado(false); setElegido(0); }}
          onKeyDown={tecla} />
        <div class="redactor-barra">
          <div class="ajustes"><Ajustes agente={agente} nuevo={nuevo} solo={vista?.tipo === 'sesion' ? vista.proveedor : undefined} /></div>
          <span class="redactor-estado">{textoEstado}</span>
          {agente?.estado === 'error' && agente.sessionId && <button type="button" class="icono-boton" title="Reanudar" onClick={() => crearAgente({ t: 'reanudar', sessionId: agente.sessionId!, cwd: agente.cwd, proveedor: agente.proveedor })}><Icono nombre="recargar" /></button>}
          {trabajando && <button type="button" class="boton-detener" title="Detener (Esc dos veces)" aria-label="Detener" onClick={() => agente && enviar({ t: 'interrumpir', agente: agente.id })}><Icono nombre="detener" /></button>}
          <button type="button" class="boton-enviar" title={trabajando ? 'Poner en cola (Enter)' : 'Enviar (Enter)'} aria-label="Enviar" disabled={!texto.trim() || !!falta} onClick={mandar}><Icono nombre="enviar" /></button>
        </div>
      </div>
    </footer>
  );
}
