// Barra de la izquierda: agentes abiertos, carpetas propias y las conversaciones anteriores por carpeta del proyecto.
// Cada fila muestra sus acciones solo al pasar el cursor: mover a una carpeta y la papelera. La papelera de una
// carpeta de proyecto borra todas sus conversaciones (las que se ven, si hay búsqueda o filtro).
import { useState } from 'preact/hooks';
import type { Proveedor, ResumenAgente, Sesion } from '@protocolo';
import { estado, elegir, enviar, avisar, borrar, borrarVarias, cambiarBorrador, guardarLocal, renombrar, crearCarpeta, renombrarCarpeta, alternarCarpeta, borrarCarpeta, moverSesion } from '../tienda.ts';
import type { Objetivo } from '../tienda.ts';
import { BotonIcono, Desplegable, Papelera, TituloEditable } from './Acciones.tsx';
import { Icono } from './iconos.tsx';
import { Limites } from './Limites.tsx';
import { PROVEEDORES, haceCuanto, nombreCarpeta, nombreProveedor, rutaCorta, tramoDe } from '../util.ts';

const GRUPOS = [
  { clave: 'atencion', titulo: 'Te necesitan', estados: ['esperando', 'error'] },
  { clave: 'trabajando', titulo: 'Trabajando', estados: ['trabajando', 'iniciando'] },
  { clave: 'listos', titulo: 'Abiertos', estados: ['listo', 'cerrado'] },
] as const;

// Qué carpetas de proyecto abrió o cerró el usuario; las que no tocó: abiertas las 3 más recientes
const PLEGADO = 'lyra-proyectos';
const ABIERTAS_DE_ENTRADA = 3;

// Cómo se agrupa el historial: por carpeta del proyecto, por día o por semana
type Orden = 'carpeta' | 'dia' | 'semana';
const ORDEN = 'lyra-orden';
const ORDENES: { valor: Orden; nombre: string; titulo: string }[] = [
  { valor: 'carpeta', nombre: 'Carpeta', titulo: 'Agrupar por carpeta del proyecto' },
  { valor: 'dia', nombre: 'Día', titulo: 'Agrupar por día, de la más reciente' },
  { valor: 'semana', nombre: 'Semana', titulo: 'Agrupar por semana, de la más reciente' },
];

/** Arrastrar una conversación a una carpeta */
const ARRASTRE = 'application/x-lyra-sesion';
function soltable(destino: string | null, marcado: string | null, setMarcado: (v: string | null) => void) {
  const clave = destino ?? '';
  return {
    'data-soltar': marcado === clave ? 'true' : undefined,
    onDragOver: (e: DragEvent) => { if (e.dataTransfer?.types.includes(ARRASTRE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (marcado !== clave) setMarcado(clave); } },
    onDragLeave: (e: DragEvent) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setMarcado(null); },
    onDrop: (e: DragEvent) => { const s = e.dataTransfer?.getData(ARRASTRE); setMarcado(null); if (s) { e.preventDefault(); moverSesion(s, destino); } },
  };
}

/** Ícono de carpeta: abre una lista corta con las carpetas */
function Mover({ sessionId }: { sessionId: string }) {
  const [abierto, setAbierto] = useState(false);
  const actual = estado.grupos.sesiones[sessionId];
  return (
    <span class="ancla">
      <button type="button" class="agente-accion" data-accion="mover" title={actual ? 'Mover a otra carpeta' : 'Guardar en una carpeta'} aria-label="Mover a una carpeta"
        onClick={e => { e.stopPropagation(); setAbierto(x => !x); }}><Icono nombre="carpeta" /></button>
      {abierto && (
        <Desplegable onCerrar={() => setAbierto(false)}>
          {estado.grupos.carpetas.map(c => (
            <button type="button" key={c.id} aria-current={c.id === actual ? 'true' : undefined} onClick={() => { moverSesion(sessionId, c.id); setAbierto(false); }}>
              <Icono nombre="carpeta" tam={14} />{c.nombre}
            </button>
          ))}
          <button type="button" onClick={() => { const id = crearCarpeta('Nueva carpeta'); moverSesion(sessionId, id); estado.editando = `carpeta:${id}`; setAbierto(false); avisar(); }}>
            <Icono nombre="carpetaNueva" tam={14} />Nueva carpeta
          </button>
          {actual && <button type="button" onClick={() => { moverSesion(sessionId, null); setAbierto(false); }}><Icono nombre="sacar" tam={14} />Sacar de la carpeta</button>}
        </Desplegable>
      )}
    </span>
  );
}

function Agente({ a, actual, onElegir }: { a: ResumenAgente; actual: boolean; onElegir: () => void }) {
  const objetivo: Objetivo = { proveedor: a.proveedor, titulo: a.titulo, agente: a.id, sessionId: a.sessionId, cwd: a.cwd, trabajando: a.estado === 'trabajando' };
  return (
    <li class="agente" data-estado={a.estado} data-proveedor={a.proveedor} aria-current={actual ? 'true' : undefined} onClick={onElegir}
      draggable={!!a.sessionId} onDragStart={e => a.sessionId && e.dataTransfer?.setData(ARRASTRE, a.sessionId)}
      title={`${a.titulo}\n${nombreProveedor(a.proveedor)} · ${rutaCorta(a.cwd)}`}>
      <span class="agente-estado" />
      <div class="agente-texto">
        <TituloEditable clave={`agente:${a.id}`} titulo={a.titulo} clase="agente-titulo" onGuardar={t => renombrar(objetivo, t)} />
        <span class="agente-meta"><span class="proveedor-marca" data-proveedor={a.proveedor}>{nombreProveedor(a.proveedor)}</span> {nombreCarpeta(a.cwd)} · {a.estado === 'esperando' ? 'espera tu respuesta' : a.estado === 'error' ? 'se detuvo' : haceCuanto(a.ultimaActividad)}</span>
      </div>
      {a.sinLeer && !actual && <span class="agente-sinleer" title="Terminó y no lo has visto" />}
      <span class="agente-acciones">
        {a.sessionId && <Mover sessionId={a.sessionId} />}
        <Papelera titulo="Borrar la conversación" onBorrar={() => borrar(objetivo)} />
        <button type="button" class="agente-accion" title="Cerrar (queda guardada)" aria-label="Cerrar" onClick={e => { e.stopPropagation(); enviar({ t: 'cerrar', agente: a.id }); }}><Icono nombre="cerrar" /></button>
      </span>
    </li>
  );
}

function Fila({ s, onElegir, enProyecto = false }: { s: Sesion; onElegir: () => void; enProyecto?: boolean }) {
  const v = estado.vista;
  const objetivo: Objetivo = { proveedor: s.proveedor, titulo: s.titulo, sessionId: s.sessionId, cwd: s.cwd };
  return (
    <li class="agente" data-estado="historial" data-proveedor={s.proveedor} aria-current={v?.tipo === 'sesion' && v.sessionId === s.sessionId ? 'true' : undefined}
      draggable onDragStart={e => e.dataTransfer?.setData(ARRASTRE, s.sessionId)}
      title={`${s.titulo}\n${nombreProveedor(s.proveedor)} · ${rutaCorta(s.cwd)}`} onClick={() => { elegir({ tipo: 'sesion', sessionId: s.sessionId, cwd: s.cwd, proveedor: s.proveedor }); onElegir(); }}>
      <span class="agente-estado" />
      <div class="agente-texto">
        <TituloEditable clave={`sesion:${s.sessionId}`} titulo={s.titulo} clase="agente-titulo" onGuardar={t => renombrar(objetivo, t)} />
        <span class="agente-meta"><span class="proveedor-marca" data-proveedor={s.proveedor}>{nombreProveedor(s.proveedor)}</span> {enProyecto ? '' : `${nombreCarpeta(s.cwd)} · `}{haceCuanto(s.modificado)}</span>
      </div>
      <span class="agente-acciones">
        <Mover sessionId={s.sessionId} />
        <Papelera titulo="Borrar la conversación" onBorrar={() => borrar(objetivo)} />
      </span>
    </li>
  );
}

export function Barra({ abierta, onNuevo, onCerrarCajon }: { abierta: boolean; onNuevo: () => void; onCerrarCajon: () => void }) {
  const [filtro, setFiltro] = useState<Proveedor | ''>('');
  const [busqueda, setBusqueda] = useState('');
  const [plegado, setPlegado] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem(PLEGADO) || '{}'); } catch { return {}; } });
  const [marcado, setMarcado] = useState<string | null>(null);
  const [orden, setOrden] = useState<Orden>(() => { try { const o = localStorage.getItem(ORDEN); return ORDENES.some(x => x.valor === o) ? o as Orden : 'carpeta'; } catch { return 'carpeta'; } });
  const cambiarOrden = (o: Orden) => { setOrden(o); try { localStorage.setItem(ORDEN, o); } catch { /* sin almacenamiento */ } };
  const v = estado.vista;
  const q = busqueda.trim().toLowerCase();
  const pasa = (titulo: string, cwd: string, p: Proveedor) => (!filtro || p === filtro) && (!q || `${titulo} ${cwd}`.toLowerCase().includes(q));

  const agentes = [...estado.agentes].sort((a, b) => b.ultimaActividad - a.ultimaActividad).filter(a => pasa(a.titulo, a.cwd, a.proveedor));
  const abiertas = new Set(estado.agentes.map(a => a.sessionId).filter(Boolean));
  const { carpetas, sesiones: enCarpeta } = estado.grupos;
  const porCarpeta = new Map<string, Sesion[]>(carpetas.map(c => [c.id, []]));
  const porProyecto = new Map<string, Sesion[]>();   // el historial ya viene del más reciente al más viejo
  const titulos = new Map<string, string>();   // por día o semana: clave del tramo → su nombre
  for (const s of estado.historial) {
    if (abiertas.has(s.sessionId) || !pasa(s.titulo, s.cwd, s.proveedor)) continue;
    const c = enCarpeta[s.sessionId];
    if (c && porCarpeta.has(c)) porCarpeta.get(c)!.push(s);
    else {
      let clave = s.cwd;
      if (orden !== 'carpeta') { const t = tramoDe(s.modificado, orden); clave = t.clave; titulos.set(clave, t.titulo); }
      const l = porProyecto.get(clave); if (l) l.push(s); else porProyecto.set(clave, [s]);
    }
  }
  const hay = new Set(estado.historial.map(s => s.proveedor));
  const proyectos = [...porProyecto.entries()];
  const abierto = (cwd: string, i: number) => !!q || (plegado[cwd] ?? i < ABIERTAS_DE_ENTRADA);
  const alternar = (cwd: string, i: number) => { const n = { ...plegado, [cwd]: !abierto(cwd, i) }; setPlegado(n); guardarLocal(PLEGADO, n); };
  const elegirAgente = (id: string) => { elegir({ tipo: 'agente', id }); onCerrarCajon(); };

  return (
    <aside class="agentes" data-abierto={String(abierta)}>
      <header class="agentes-cabecera">
        <span class="marca">Lyra</span>
        <BotonIcono icono="carpetaNueva" titulo="Nueva carpeta" onClick={() => { const id = crearCarpeta('Nueva carpeta'); estado.editando = `carpeta:${id}`; avisar(); }} />
        <BotonIcono icono="nuevo" titulo="Agente nuevo (Alt+N)" clase="icono-boton-lima" aria-current={v === null ? 'true' : undefined} onClick={onNuevo} />
      </header>
      <div class="agentes-desplazable">
      <div class="buscador">
        <input type="search" class="buscador-campo" placeholder="Buscar…" value={busqueda} onInput={e => setBusqueda((e.currentTarget as HTMLInputElement).value)} />
        {hay.size > 1 && PROVEEDORES.filter(p => hay.has(p.id)).map(p => (
          <button type="button" key={p.id} class="buscador-proveedor" data-proveedor={p.id} aria-pressed={filtro === p.id} title={`Solo ${p.nombre}`} onClick={() => setFiltro(filtro === p.id ? '' : p.id)}><span class="proveedor-punto" /></button>
        ))}
      </div>
      {estado.historial.length > 0 && (
        <div class="orden" role="group" aria-label="Agrupar el historial">
          {ORDENES.map(o => <button type="button" key={o.valor} aria-pressed={orden === o.valor} title={o.titulo} onClick={() => cambiarOrden(o.valor)}>{o.nombre}</button>)}
        </div>
      )}

      {GRUPOS.map(g => {
        const lista = agentes.filter(a => (g.estados as readonly string[]).includes(a.estado));
        if (!lista.length) return null;
        return (
          <section class="grupo" data-grupo={g.clave} key={g.clave}>
            <h3 class="grupo-titulo">{g.titulo} <span class="grupo-cuenta">{lista.length}</span></h3>
            <ul class="grupo-lista">{lista.map(a => <Agente key={a.id} a={a} actual={v?.tipo === 'agente' && v.id === a.id} onElegir={() => elegirAgente(a.id)} />)}</ul>
          </section>
        );
      })}

      {carpetas.length > 0 && (
        <section class="grupo" data-grupo="carpetas">
          <h3 class="grupo-titulo">Carpetas</h3>
          {carpetas.map(c => {
            const lista = porCarpeta.get(c.id) || [];
            if (q && !lista.length && !c.nombre.toLowerCase().includes(q)) return null;
            const abierta = c.abierta || !!q;
            return (
              <div class="carpeta" key={c.id} data-abierta={String(abierta)} {...soltable(c.id, marcado, setMarcado)}>
                <div class="carpeta-cabecera" role="button" tabIndex={0} onClick={() => alternarCarpeta(c.id)} onKeyDown={e => e.key === 'Enter' && alternarCarpeta(c.id)}>
                  <span class="carpeta-flecha" />
                  <Icono nombre="carpeta" tam={14} />
                  <TituloEditable clave={`carpeta:${c.id}`} titulo={c.nombre} clase="carpeta-nombre" onGuardar={t => renombrarCarpeta(c.id, t)} />
                  <span class="grupo-cuenta">{lista.length}</span>
                  <span class="agente-acciones"><Papelera titulo="Borrar la carpeta (las conversaciones no se borran)" onBorrar={() => borrarCarpeta(c.id)} /></span>
                </div>
                {abierta && lista.length > 0 && <ul class="grupo-lista">{lista.map(s => <Fila key={s.proveedor + s.sessionId} s={s} onElegir={onCerrarCajon} />)}</ul>}
              </div>
            );
          })}
        </section>
      )}

      {proyectos.length > 0 && (
        <section class="grupo" data-grupo="historial" {...soltable(null, marcado, setMarcado)}>
          {proyectos.map(([cwd, lista], i) => {
            const ab = abierto(cwd, i);
            const titulo = titulos.get(cwd);
            if (titulo) return (
              <div key={cwd} class="tramo proyecto" data-abierto={String(ab)}>
                <h3 class="grupo-titulo tramo-titulo proyecto-titulo">
                  <button type="button" class="tramo-boton" aria-expanded={ab} onClick={() => alternar(cwd, i)}>
                    <span class="carpeta-flecha" /><span class="proyecto-nombre">{titulo}</span> <span class="grupo-cuenta">{lista.length}</span>
                  </button>
                  <span class="agente-acciones">
                    <Papelera titulo={`Borrar ${lista.length === 1 ? 'la conversación' : `las ${lista.length} conversaciones`} de ${titulo.toLowerCase()} (van a la papelera)`}
                      onBorrar={() => borrarVarias(lista)} />
                  </span>
                </h3>
                {ab && <ul class="grupo-lista">{lista.map(s => <Fila key={s.proveedor + s.sessionId} s={s} onElegir={onCerrarCajon} />)}</ul>}
              </div>
            );
            return (
              <div key={cwd} class="tramo proyecto" data-abierto={String(ab)}>
                <h3 class="grupo-titulo tramo-titulo proyecto-titulo" title={rutaCorta(cwd)}>
                  <button type="button" class="tramo-boton" aria-expanded={ab} onClick={() => alternar(cwd, i)}>
                    <span class="carpeta-flecha" /><span class="proyecto-nombre">{nombreCarpeta(cwd)}</span> <span class="grupo-cuenta">{lista.length}</span>
                  </button>
                  <span class="agente-acciones">
                    <button type="button" class="agente-accion" title="Abrir en otro escritorio" aria-label="Abrir la carpeta en otro escritorio"
                      onClick={() => enviar({ t: 'abrir', con: 'carpetaAparte', cwd })}><Icono nombre="abrir" /></button>
                    <button type="button" class="agente-accion" title={`Agente nuevo en ${rutaCorta(cwd)}`} aria-label="Agente nuevo en esta carpeta"
                      onClick={() => { cambiarBorrador({ cwd }); onNuevo(); }}><Icono nombre="nuevo" /></button>
                    <Papelera titulo={`Borrar ${lista.length === 1 ? 'la conversación' : `las ${lista.length} conversaciones`} de esta carpeta (van a la papelera; la carpeta del disco no se toca)`}
                      onBorrar={() => borrarVarias(lista)} />
                  </span>
                </h3>
                {ab && <ul class="grupo-lista">{lista.map(s => <Fila key={s.proveedor + s.sessionId} s={s} onElegir={onCerrarCajon} enProyecto />)}</ul>}
              </div>
            );
          })}
        </section>
      )}
      {(q || filtro) && !agentes.length && !proyectos.length && ![...porCarpeta.values()].some(l => l.length) && <p class="historial-vacio">Nada coincide.</p>}
      </div>
      <Limites />
    </aside>
  );
}
