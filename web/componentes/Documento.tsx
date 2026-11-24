import { createContext } from 'preact';
import { useContext, useEffect, useMemo, useState } from 'preact/hooks';
import hljs from 'highlight.js/lib/common';
import type { Bloque, Detalle, Solicitud } from '@protocolo';
import { detalleHerramienta } from '../../servidor/resumenes.ts';
import { renderizar, renderizarLinea, encabezados } from '../md.ts';
import { enviar, ver } from '../tienda.ts';
import { Icono } from './iconos.tsx';
import { contarAcciones, duracion, hora, lenguajeDe, textoPlano, type Herr } from '../util.ts';

type Usuario = Extract<Bloque, { tipo: 'usuario' }>;
type Turno = { id: string; usuario?: Usuario; cuerpo: Bloque[] };
type Hijos = Map<string, Bloque[]>;
/** Quién trabaja en el documento: Claude, Codex o Gemini */
const Quien = createContext('Claude');

/** Separa los bloques en turnos (uno por mensaje del usuario) y aparta el trabajo de los subagentes */
export function armarTurnos(bloques: Bloque[]): { turnos: Turno[]; hijos: Hijos } {
  const herramientas = new Set(bloques.filter(b => b.tipo === 'herramienta').map(b => b.id));
  const hijos: Hijos = new Map(), turnos: Turno[] = [];
  let actual: Turno | undefined;
  for (const b of bloques) {
    const padre = 'padre' in b ? b.padre : undefined;
    if (padre && herramientas.has(padre)) { const l = hijos.get(padre) || []; l.push(b); hijos.set(padre, l); continue; }
    if (b.tipo === 'usuario') { actual = { id: b.id, usuario: b, cuerpo: [] }; turnos.push(actual); continue; }
    if (!actual) { actual = { id: 'inicio', cuerpo: [] }; turnos.push(actual); }
    actual.cuerpo.push(b);
  }
  return { turnos, hijos };
}

export type Entrada = { id: string; nivel: 'turno' | 'h2' | 'h3'; texto: string };
export function armarIndice(turnos: Turno[]): Entrada[] {
  const lista: Entrada[] = [];
  for (const t of turnos) {
    if (t.usuario) {
      const primera = textoPlano(t.usuario.md.split('\n').find(l => l.trim()) || '');
      lista.push({ id: `turno-${t.id}`, nivel: 'turno', texto: primera.length > 60 ? primera.slice(0, 59) + '…' : primera || 'Mensaje' });
    }
    for (const b of t.cuerpo) if (b.tipo === 'texto') for (const e of encabezados(b.md, b.id)) lista.push({ id: e.id, nivel: e.nivel as 'h2' | 'h3', texto: textoPlano(e.texto) });
  }
  return lista;
}

function Md({ texto, clase = 'md', prefijo = '', enCurso }: { texto: string; clase?: string; prefijo?: string; enCurso?: boolean }) {
  const html = useMemo(() => renderizar(texto, prefijo), [texto, prefijo]);
  return <div class={clase} data-en-curso={enCurso === undefined ? undefined : String(enCurso)} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Codigo({ texto, lenguaje }: { texto: string; lenguaje?: string }) {
  const html = useMemo(() => {
    if (lenguaje && hljs.getLanguage(lenguaje) && texto.length < 60000) return hljs.highlight(texto, { language: lenguaje }).value;
    const d = document.createElement('div'); d.textContent = texto; return d.innerHTML;
  }, [texto, lenguaje]);
  return <pre class="codigo"><code class="hljs" dangerouslySetInnerHTML={{ __html: html }} /></pre>;
}

const MAX_LINEAS = 1500;
function VerDetalle({ d, cwd }: { d: Detalle; cwd: string }) {
  if (d.clase === 'md') return <Md texto={d.texto} />;
  if (d.clase === 'codigo') return d.texto.trim() ? <Codigo texto={d.texto} lenguaje={d.lenguaje} /> : null;
  const ruta = cwd && d.ruta.startsWith(cwd + '/') ? d.ruta.slice(cwd.length + 1) : d.ruta;
  const lineas = d.lineas.slice(0, MAX_LINEAS);
  return (
    <div class="diff">
      <div class="diff-ruta">{ruta}</div>
      {lineas.map((l, i) => <div key={i} class="diff-linea" data-tipo={l.tipo}>{l.texto || ' '}</div>)}
      {d.lineas.length > MAX_LINEAS && <div class="diff-linea" data-tipo=" ">… ({d.lineas.length - MAX_LINEAS} líneas más)</div>}
    </div>
  );
}

function detalleDe(h: Herr): Detalle | undefined {
  const e = (h.entrada || {}) as Record<string, unknown>;
  if (h.nombre === 'ExitPlanMode' && typeof e.plan === 'string') return { clase: 'md', texto: e.plan };
  if (h.nombre === 'Read' && h.detalle?.clase === 'codigo' && !h.detalle.lenguaje) return { ...h.detalle, lenguaje: lenguajeDe(String(e.file_path || '')) };
  return h.detalle;
}

/** La ruta que se puede abrir en el visor: archivos creados, editados, leídos o imágenes generadas */
function rutaVisible(h: Herr): string {
  if (h.estado === 'error' || !['leer', 'editar', 'crear', 'imagen'].includes(h.icono)) return '';
  const e = (h.entrada || {}) as Record<string, unknown>, r = e.file_path || e.notebook_path || e.absolute_path || e.path;
  return typeof r === 'string' ? r : '';
}

function Herramienta({ h, hijos, cwd }: { h: Herr; hijos: Hijos; cwd: string }) {
  const [abierto, setAbierto] = useState(false);
  const ruta = rutaVisible(h);
  const sub = hijos.get(h.id);
  const resumen = useMemo(() => renderizarLinea(h.resumen), [h.resumen]);
  const d = abierto ? detalleDe(h) : undefined;
  return (
    <li class="herramienta" data-estado={h.estado} data-icono={h.icono}>
      <details onToggle={e => setAbierto((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>
          <span class="herramienta-icono"><Icono nombre={h.icono} /></span>
          <span class="herramienta-texto" dangerouslySetInnerHTML={{ __html: resumen + (sub?.length ? ` <span class="herramienta-sub">· ${sub.filter(b => b.tipo === 'herramienta').length} acciones</span>` : '') }} />
          {ruta && <button type="button" class="herramienta-ver" title="Ver en el panel" aria-label="Ver en el panel" onClick={e => { e.preventDefault(); e.stopPropagation(); ver(ruta, cwd); }}><Icono nombre="visor" tam={14} /></button>}
        </summary>
        {abierto && (
          <div class="herramienta-detalle">
            {d && <VerDetalle d={d} cwd={cwd} />}
            {sub?.length ? <div class="subagente"><Cuerpo bloques={sub} hijos={hijos} cwd={cwd} /></div> : null}
          </div>
        )}
      </details>
    </li>
  );
}

function Actividad({ lista, hijos, cwd }: { lista: Herr[]; hijos: Hijos; cwd: string }) {
  const error = lista.some(h => h.estado === 'error');
  const corriendo = lista.findLast(h => h.estado === 'corriendo');
  const estado = corriendo ? 'corriendo' : error ? 'error' : 'ok';
  return (
    <details class="actividad" open={error}>
      <summary class="actividad-resumen">
        <span class="actividad-cuenta">{lista.length} {lista.length === 1 ? 'acción' : 'acciones'}</span>
        <span class="actividad-detalle">{corriendo ? textoPlano(corriendo.resumen) : contarAcciones(lista)}</span>
        <span class="actividad-estado" data-estado={estado} />
      </summary>
      <ul class="actividad-lista">{lista.map(h => <Herramienta key={h.id} h={h} hijos={hijos} cwd={cwd} />)}</ul>
    </details>
  );
}

/** Los botones aparecen 300 ms después, para que una tecla o clic accidental no responda */
function useListo() {
  const [listo, setListo] = useState(false);
  useEffect(() => { const t = setTimeout(() => setListo(true), 300); return () => clearTimeout(t); }, []);
  return listo;
}

function responder(s: Solicitud, decision: 'permitir' | 'siempre' | 'rechazar', mensaje?: string, respuestas?: Record<string, string>) {
  enviar({ t: 'responder', agente: s.agente, solicitud: s.id, decision, mensaje: mensaje || undefined, respuestas });
}

function tituloPermiso(s: Solicitud, quien: string): string {
  switch (s.herramienta) {
    case 'Bash': return `${quien} quiere ejecutar un comando`;
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return `${quien} quiere editar un archivo`;
    case 'Write': return `${quien} quiere escribir un archivo`;
    case 'Read': return `${quien} quiere leer un archivo`;
    case 'WebFetch': return `${quien} quiere abrir una página web`;
    case 'WebSearch': return `${quien} quiere buscar en la web`;
    case 'Agent': case 'Task': return `${quien} quiere lanzar un subagente`;
    default: return s.titulo || `${quien} quiere usar ${s.nombreCorto || s.herramienta}`;
  }
}

const RESUELTO: Record<string, string> = { permitido: 'Permitido', rechazado: 'Rechazado', cancelado: 'Cancelado', respondida: 'Respondida', cancelada: 'Sin responder', aprobado: 'Plan aprobado' };

function TarjetaPermiso({ b, cwd }: { b: Extract<Bloque, { tipo: 'permiso' }>; cwd: string }) {
  const listo = useListo(), [mensaje, setMensaje] = useState(''), quien = useContext(Quien);
  const s = b.solicitud, e = s.entrada;
  const cuerpo = useMemo((): Detalle => {
    if (s.detalle) return s.detalle;
    if (['Edit', 'MultiEdit', 'Write', 'Bash'].includes(s.herramienta)) return detalleHerramienta(s.herramienta, e);
    if (s.herramienta === 'WebFetch' || s.herramienta === 'WebSearch') return { clase: 'codigo', texto: String(e.url || e.query || '') };
    return { clase: 'codigo', lenguaje: 'json', texto: JSON.stringify(e, null, 2) };
  }, [s]);
  const genericos = /^(This command requires approval|Permission required)\.?$/i;
  const motivo = [typeof e.description === 'string' && s.herramienta === 'Bash' ? e.description : '', ['Edit', 'MultiEdit', 'Write', 'Read'].includes(s.herramienta) ? '' : s.descripcion, s.motivo, s.rutaBloqueada ? `Ruta: ${s.rutaBloqueada}` : ''].filter(m => m && !genericos.test(m.trim()));
  return (
    <div class="tarjeta tarjeta-permiso" data-estado={b.estado}>
      <div class="tarjeta-titulo">{tituloPermiso(s, quien)}</div>
      <div class="tarjeta-cuerpo">
        <VerDetalle d={cuerpo} cwd={cwd} />
        {[...new Set(motivo)].map(m => <p class="tarjeta-motivo">{m}</p>)}
      </div>
      {b.estado === 'pendiente' ? (
        <div class="tarjeta-acciones">
          <button class="boton boton-primario" disabled={!listo} onClick={() => responder(s, 'permitir')}>Permitir</button>
          {s.haySugerencias && <button class="boton" disabled={!listo} onClick={() => responder(s, 'siempre')}>{s.etiquetaSiempre || 'Permitir siempre'}</button>}
          <button class="boton boton-peligro" disabled={!listo} onClick={() => responder(s, 'rechazar', mensaje)}>Rechazar</button>
          <input class="tarjeta-mensaje" placeholder="Motivo o indicación (opcional)" value={mensaje} onInput={ev => setMensaje((ev.currentTarget as HTMLInputElement).value)} />
        </div>
      ) : <div class="tarjeta-resuelta">{RESUELTO[b.estado]}</div>}
    </div>
  );
}

type Pregunta = { question: string; header?: string; multiSelect?: boolean; options?: { label: string; description?: string }[] };

function TarjetaPregunta({ b }: { b: Extract<Bloque, { tipo: 'pregunta' }> }) {
  const listo = useListo(), quien = useContext(Quien);
  const preguntas = (Array.isArray(b.solicitud.entrada.questions) ? b.solicitud.entrada.questions : []) as Pregunta[];
  const [elegidas, setElegidas] = useState<Record<string, string[]>>({});
  const [otras, setOtras] = useState<Record<string, string>>({});
  const respuesta = (p: Pregunta) => (otras[p.question]?.trim() || (elegidas[p.question] || []).join(', '));
  const completas = preguntas.every(p => respuesta(p));
  const tocar = (p: Pregunta, label: string) => setElegidas(prev => {
    const actual = prev[p.question] || [];
    return { ...prev, [p.question]: p.multiSelect ? (actual.includes(label) ? actual.filter(x => x !== label) : [...actual, label]) : [label] };
  });
  const pendiente = b.estado === 'pendiente';
  return (
    <div class="tarjeta tarjeta-pregunta" data-estado={b.estado}>
      <div class="tarjeta-titulo">{preguntas.length > 1 ? `${quien} te hace unas preguntas` : `${quien} te hace una pregunta`}</div>
      <div class="tarjeta-cuerpo">
        {preguntas.map(p => (
          <fieldset class="pregunta" disabled={!pendiente}>
            <legend>{p.question}</legend>
            {(p.options || []).map(o => {
              const marcada = pendiente ? (elegidas[p.question] || []).includes(o.label) : (b.respuestas?.[p.question] || '').split(', ').includes(o.label);
              return (
                <button type="button" class="opcion" aria-pressed={marcada} disabled={!listo || !pendiente} onClick={() => tocar(p, o.label)}>
                  <strong>{o.label}</strong>{o.description && <span>{o.description}</span>}
                </button>
              );
            })}
            {pendiente && <input class="opcion-otra" placeholder="Otra respuesta…" value={otras[p.question] || ''} onInput={ev => { const v = (ev.currentTarget as HTMLInputElement).value; setOtras(prev => ({ ...prev, [p.question]: v })); }} />}
            {!pendiente && b.respuestas?.[p.question] && !(p.options || []).some(o => o.label === b.respuestas?.[p.question]) && <p class="tarjeta-motivo">Respuesta: {b.respuestas[p.question]}</p>}
          </fieldset>
        ))}
      </div>
      {pendiente ? (
        <div class="tarjeta-acciones">
          <button class="boton boton-primario" disabled={!listo || !completas} onClick={() => responder(b.solicitud, 'permitir', undefined, Object.fromEntries(preguntas.map(p => [p.question, respuesta(p)])))}>Responder</button>
          <button class="boton" disabled={!listo} onClick={() => responder(b.solicitud, 'rechazar', 'El usuario prefirió no responder.')}>Omitir</button>
        </div>
      ) : <div class="tarjeta-resuelta">{RESUELTO[b.estado]}</div>}
    </div>
  );
}

function TarjetaPlan({ b }: { b: Extract<Bloque, { tipo: 'plan' }> }) {
  const listo = useListo(), [mensaje, setMensaje] = useState(''), quien = useContext(Quien);
  return (
    <div class="tarjeta tarjeta-plan" data-estado={b.estado}>
      <div class="tarjeta-titulo">{quien} propone un plan</div>
      <Md texto={b.md} />
      {b.estado === 'pendiente' ? (
        <div class="tarjeta-acciones">
          <button class="boton boton-primario" disabled={!listo} onClick={() => responder(b.solicitud, b.solicitud.haySugerencias ? 'siempre' : 'permitir')}>Aprobar plan</button>
          <button class="boton" disabled={!listo} onClick={() => responder(b.solicitud, 'rechazar', mensaje || 'El usuario quiere seguir planificando.')}>Seguir planificando</button>
          <input class="tarjeta-mensaje" placeholder="Qué cambiar del plan (opcional)" value={mensaje} onInput={ev => setMensaje((ev.currentTarget as HTMLInputElement).value)} />
        </div>
      ) : <div class="tarjeta-resuelta">{b.estado === 'aprobado' ? 'Plan aprobado' : 'Se siguió planificando'}</div>}
    </div>
  );
}

function Fin({ b }: { b: Extract<Bloque, { tipo: 'fin' }> }) {
  const partes = [b.duracionMs ? duracion(b.duracionMs) : ''].filter(Boolean);
  return (
    <>
      {b.error && <p class="aviso" data-nivel={b.error === 'Se detuvo antes de terminar.' ? 'info' : 'error'}>{b.error}</p>}
      {partes.length > 0 && <footer class="turno-pie">{partes.join(' · ')}</footer>}
    </>
  );
}

function Cuerpo({ bloques, hijos, cwd }: { bloques: Bloque[]; hijos: Hijos; cwd: string }) {
  const salida: preact.JSX.Element[] = [];
  let grupo: Herr[] = [];
  const cerrar = () => { if (grupo.length) salida.push(<Actividad key={'act-' + grupo[0]!.id} lista={grupo} hijos={hijos} cwd={cwd} />); grupo = []; };
  for (const b of bloques) {
    if (b.tipo === 'herramienta') { grupo.push(b); continue; }
    if (b.tipo === 'texto' && !b.md.trim() && !b.enCurso) continue;
    cerrar();
    switch (b.tipo) {
      case 'texto': salida.push(<Md key={b.id} clase="md respuesta" texto={b.md} prefijo={b.id} enCurso={b.enCurso} />); break;
      case 'pensamiento': salida.push(<details key={b.id} class="pensamiento"><summary>Razonamiento</summary><Md texto={b.md} /></details>); break;
      case 'tareas': salida.push(
        <div key={b.id} class="tareas"><h4>Tareas</h4><ul>{b.items.map((t, i) => <li key={i} data-estado={t.estado}>{t.texto}</li>)}</ul></div>); break;
      case 'permiso': salida.push(<TarjetaPermiso key={b.id} b={b} cwd={cwd} />); break;
      case 'pregunta': salida.push(<TarjetaPregunta key={b.id} b={b} />); break;
      case 'plan': salida.push(<TarjetaPlan key={b.id} b={b} />); break;
      case 'sistema': salida.push(<p key={b.id} class="aviso" data-nivel={b.nivel}>{b.texto}</p>); break;
      case 'fin': salida.push(<Fin key={b.id} b={b} />); break;
      case 'usuario': salida.push(<Md key={b.id} texto={b.md} />); break;   // solo dentro de subagentes
    }
  }
  cerrar();
  return <>{salida}</>;
}

export function Turnos({ turnos, hijos, cwd, quien }: { turnos: Turno[]; hijos: Hijos; cwd: string; quien: string }) {
  return (
    <Quien.Provider value={quien}>
      {turnos.map(t => (
        <article key={t.id} class="turno" id={`turno-${t.id}`}>
          {t.usuario && (
            <header class="turno-usuario" data-en-cola={t.usuario.enCola ? 'true' : undefined}>
              <Md texto={t.usuario.md} />
              <time class="turno-hora">{t.usuario.enCola ? 'en cola' : hora(t.usuario.fecha)}</time>
            </header>
          )}
          <div class="turno-cuerpo"><Cuerpo bloques={t.cuerpo} hijos={hijos} cwd={cwd} /></div>
        </article>
      ))}
    </Quien.Provider>
  );
}
