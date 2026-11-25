// Visor del panel derecho: los archivos que el agente creó, editó, generó o nombró, y la vista de uno.
// Muestra Markdown, imágenes, video y audio, PDF, Word, presentaciones y hojas (pasadas a PDF con LibreOffice),
// HTML (sin scripts) y código. «Abrir con…» elige otra app (OnlyOffice, VS Code…). La papelera lo manda a la del escritorio.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Bloque } from '@protocolo';
import { enviar, estado, leerArchivo, urlMedio, ver, avisar, borrarArchivo, claveArchivo, guardarArchivo, mostrarError } from '../tienda.ts';
import { Docx, Pdf } from './Paginas.tsx';
import { renderizar } from '../md.ts';
import { Codigo } from './Documento.tsx';
import { Imagen } from './Imagen.tsx';
import { BotonIcono, Desplegable, Papelera } from './Acciones.tsx';
import { Icono } from './iconos.tsx';
import { lenguajeDe, nombreCarpeta, rutaCorta } from '../util.ts';

export const IMAGEN = /\.(png|jpe?g|gif|webp|avif|bmp|svg|ico)$/i;
export const MEDIO = /\.(mp4|m4v|webm|mkv|mov|ogv|mp3|ogg|oga|opus|wav|m4a|flac)$/i;
const AUDIO = /\.(mp3|ogg|oga|opus|wav|m4a|flac)$/i;
const DOCUMENTO = /\.(md|markdown|pdf|html?|txt|csv|tsv|docx?|odt|odp|ods|rtf|xlsx?|pptx?)$/i;
/** Se pasan a PDF en el servidor (los .docx se dibujan aquí mismo) */
const OFICINA = /\.(pptx?|xlsx?|doc|odt|odp|ods|rtf)$/i;

export type ArchivoVisto = { ruta: string; como: 'creó' | 'editó' | 'generó' | 'miró' | 'nombró'; id: string };

const rutaDe = (e: unknown) => { const o = (e || {}) as Record<string, unknown>; const r = o.file_path || o.notebook_path || o.absolute_path || o.path; return typeof r === 'string' ? r : ''; };

/** Archivos de la conversación, del más reciente al más viejo y sin repetir */
export function archivosDe(bloques: Bloque[], cwd = ''): ArchivoVisto[] {
  const lista: ArchivoVisto[] = [];
  for (const b of bloques) {
    if (b.tipo === 'herramienta' && b.estado !== 'error') {
      const ruta = rutaDe(b.entrada);
      if (!ruta) continue;
      if (b.icono === 'imagen' && b.nombre === 'GenerarImagen') lista.push({ ruta, como: 'generó', id: b.id });
      else if (b.icono === 'crear') lista.push({ ruta, como: 'creó', id: b.id });
      else if (b.icono === 'editar') lista.push({ ruta, como: 'editó', id: b.id });
      else if (IMAGEN.test(ruta) || MEDIO.test(ruta)) lista.push({ ruta, como: 'miró', id: b.id });
    }
    if (b.tipo === 'texto' && !b.enCurso && !('padre' in b && b.padre)) {
      // Enlaces a archivos locales y rutas entre `comillas` que sean documentos o imágenes
      for (const m of b.md.matchAll(/\]\(([^)\s]+)\)|`([^`\s]+)`/g)) {
        const r = (m[1] || m[2] || '').replace(/^file:\/\//, '').replace(/:\d+(?::\d+)?$/, '');
        if (!/^[a-z]+:/i.test(r) && (IMAGEN.test(r) || DOCUMENTO.test(r) || MEDIO.test(r))) lista.push({ ruta: r, como: 'nombró', id: b.id });
      }
    }
  }
  const vistos = new Set<string>(), salida: ArchivoVisto[] = [];
  // La misma ruta escrita relativa o absoluta cuenta una vez
  const absoluta = (r: string) => r.startsWith('/') || r.startsWith('~') || !cwd ? r : `${cwd}/${r.replace(/^\.\//, '')}`;
  for (const a of lista.reverse()) { const k = absoluta(a.ruta); if (!vistos.has(k)) { vistos.add(k); salida.push(a); } }
  return salida.slice(0, 80);
}

const relativa = (ruta: string, cwd: string) => cwd && ruta.startsWith(cwd + '/') ? ruta.slice(cwd.length + 1) : rutaCorta(ruta);
const carpetaDe = (ruta: string, cwd: string) => { const d = relativa(ruta, cwd).replace(/\/?[^/]+$/, ''); return d ? nombreCarpeta(d) : nombreCarpeta(cwd); };
const iconoDe = (ruta: string) => IMAGEN.test(ruta) ? 'imagen' : MEDIO.test(ruta) ? 'video' : /\.(md|markdown|txt|pdf|html?|docx?|odt)$/i.test(ruta) ? 'leer' : 'codigo';

type Cargado = { estado: 'cargando' } | { estado: 'error'; texto: string } | { estado: 'listo'; tipo: string; url?: string; texto?: string; datos?: Blob; ruta: string; modificado?: number };

/** «Abrir con…»: la lista de apps que el escritorio tiene para ese archivo */
function AbrirCon({ ruta, cwd }: { ruta: string; cwd: string }) {
  const [abierto, setAbierto] = useState(false);
  const apps = estado.apps?.ruta === ruta ? estado.apps.apps : null;
  return (
    <span class="ancla">
      <BotonIcono icono="abrir" titulo="Abrir con…" activo={abierto} onClick={() => { if (!abierto) enviar({ t: 'aplicaciones', ruta, cwd }); setAbierto(x => !x); }} />
      {abierto && (
        <Desplegable onCerrar={() => setAbierto(false)} clase="desplegable-derecha">
          {!apps && <p class="desplegable-nota">Buscando apps…</p>}
          {apps && !apps.length && <p class="desplegable-nota">Ninguna app dice abrir este tipo de archivo.</p>}
          {apps?.map(a => (
            <button type="button" key={a.id} onClick={() => { enviar({ t: 'abrirArchivo', ruta, cwd, app: a.id }); setAbierto(false); }}>
              <Icono nombre="apps" tam={14} />{a.nombre}{a.predeterminada && <small>predeterminada</small>}
            </button>
          ))}
        </Desplegable>
      )}
    </span>
  );
}

/** Editar un .md en el mismo visor. Ctrl+S guarda, Esc sale (si hay cambios, pregunta con un segundo Esc). */
function EditorMd({ texto, modificado, alGuardar, alSalir }: { texto: string; modificado?: number; alGuardar: (t: string, leido?: number) => Promise<boolean>; alSalir: () => void }) {
  const [borrador, setBorrador] = useState(texto);
  // La versión con que se empezó a editar: si el agente la cambia mientras tanto, guardar avisa en vez de pisarla
  const [leido] = useState(modificado);
  const [guardando, setGuardando] = useState(false);
  const [salirArmado, setSalirArmado] = useState(false);
  const caja = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { caja.current?.focus(); caja.current?.setSelectionRange(0, 0); }, []);
  const cambiado = borrador !== texto;
  async function guardar() {
    if (guardando || !cambiado) return;
    setGuardando(true);
    const bien = await alGuardar(borrador, leido);
    setGuardando(false);
    if (bien) alSalir();
  }
  function salir() {
    if (!cambiado || salirArmado) { alSalir(); return; }
    setSalirArmado(true); setTimeout(() => setSalirArmado(false), 2500);
  }
  return (
    <div class="visor-editor">
      <div class="visor-editor-barra">
        <span class="visor-editor-estado">{guardando ? 'Guardando…' : salirArmado ? 'Sin guardar: otra vez para descartar' : cambiado ? 'Cambios sin guardar' : 'Editando'}</span>
        <button type="button" class="git-accion" onClick={salir}>{salirArmado ? 'Descartar' : 'Cancelar'}</button>
        <button type="button" class="git-accion visor-guardar" disabled={!cambiado || guardando} title="Guardar (Ctrl+S)" onClick={() => void guardar()}>Guardar</button>
      </div>
      <textarea ref={caja} class="visor-editor-texto" value={borrador} spellcheck={false} aria-label="Texto del archivo"
        onInput={e => setBorrador((e.currentTarget as HTMLTextAreaElement).value)}
        onKeyDown={e => {
          if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); void guardar(); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); salir(); }
          else if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {   // sangría con Tab, como en un editor
            e.preventDefault();
            const t = e.currentTarget as HTMLTextAreaElement, i = t.selectionStart;
            t.setRangeText('  ', i, t.selectionEnd, 'end'); setBorrador(t.value);
          }
        }} />
    </div>
  );
}

function Vista({ ruta, cwd, firma, id }: { ruta: string; cwd: string; firma: number; id?: string }) {
  const [c, setC] = useState<Cargado>({ estado: 'cargando' });
  const [fuente, setFuente] = useState(false);
  const [vez, setVez] = useState(0);
  const esMedio = MEDIO.test(ruta), aPdf = OFICINA.test(ruta);
  useEffect(() => {
    let vivo = true, url = '';
    if (esMedio) { setC({ estado: 'listo', tipo: AUDIO.test(ruta) ? 'audio/*' : 'video/*', url: urlMedio(ruta, cwd) + `&v=${firma}.${vez}`, ruta }); return; }
    setC(prev => prev.estado === 'listo' ? prev : { estado: 'cargando' });
    leerArchivo(ruta, cwd, aPdf ? 'pdf' : undefined).then(async r => {
      if (!vivo) return;
      const tipo = r.tipo.split(';')[0]!;
      if (tipo === 'application/pdf' || /\.docx$/i.test(ruta)) setC({ estado: 'listo', tipo, datos: r.datos, ruta: r.ruta });
      else if (tipo.startsWith('image/')) { url = URL.createObjectURL(r.datos); setC({ estado: 'listo', tipo, url, ruta: r.ruta }); }
      else if (tipo.startsWith('text/')) setC({ estado: 'listo', tipo, texto: await r.datos.text(), ruta: r.ruta, modificado: r.modificado });
      else setC({ estado: 'listo', tipo, ruta: r.ruta });
    }).catch((e: Error) => vivo && setC({ estado: 'error', texto: e.message }));
    return () => { vivo = false; if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); };
  }, [ruta, cwd, firma, vez]);
  const [editando, setEditando] = useState(false);
  useEffect(() => { setFuente(false); setEditando(false); }, [ruta]);

  const nombre = ruta.split('/').pop() || ruta;
  const esMd = /\.(md|markdown)$/i.test(ruta), esHtml = /\.html?$/i.test(ruta);
  const html = useMemo(() => c.estado === 'listo' && esMd && c.texto !== undefined ? renderizar(c.texto, 'visor') : '', [c, esMd]);
  let cuerpo: preact.JSX.Element;
  if (c.estado === 'cargando') cuerpo = <p class="visor-nota">Cargando…</p>;
  else if (c.estado === 'error') cuerpo = (
    <div class="visor-nota" data-nivel="error">
      <p>{c.texto}</p>
      <button type="button" class="boton" onClick={() => enviar({ t: 'abrirArchivo', ruta, cwd })}>Abrir con su app</button>
    </div>
  );
  else if (c.tipo === 'video/*') cuerpo = <div class="visor-medio"><video src={c.url} controls preload="metadata" /></div>;
  else if (c.tipo === 'audio/*') cuerpo = <div class="visor-medio"><audio src={c.url} controls preload="metadata" /></div>;
  else if (c.datos && c.tipo === 'application/pdf') cuerpo = <Pdf datos={c.datos} />;
  else if (c.datos) cuerpo = <Docx datos={c.datos} />;
  else if (c.tipo.startsWith('image/')) cuerpo = <Imagen key={c.url} url={c.url!} nombre={nombre} />;
  else if (c.texto !== undefined && esMd && editando) cuerpo = (
    <EditorMd texto={c.texto} modificado={c.modificado} alSalir={() => setEditando(false)} alGuardar={async (t, leido) => {
      const r = await guardarArchivo(c.ruta, cwd, t, leido);
      if (r.error) { mostrarError(r.error); return false; }
      setC({ ...c, texto: t, modificado: r.modificado });
      mostrarError(`Guardé «${nombre}».`, 'info');
      return true;
    }} />
  );
  else if (c.texto !== undefined && esHtml && !fuente) cuerpo = <iframe class="visor-marco visor-html" sandbox="" srcdoc={c.texto} title={nombre} />;
  else if (c.texto !== undefined && esMd && !fuente) cuerpo = <div class="md visor-md" dangerouslySetInnerHTML={{ __html: html }} />;
  else if (c.texto !== undefined) cuerpo = <Codigo texto={c.texto.length > 400000 ? c.texto.slice(0, 400000) + '\n… (recortado)' : c.texto} lenguaje={lenguajeDe(ruta)} />;
  else cuerpo = (
    <div class="visor-nota">
      <p>Este archivo no se puede mostrar aquí.</p>
      <button type="button" class="boton" onClick={() => enviar({ t: 'abrirArchivo', ruta, cwd })}>Abrir con su app</button>
    </div>
  );

  return (
    <div class="visor-vista">
      <header class="visor-cabecera">
        <BotonIcono icono="indice" titulo="Todos los archivos" onClick={() => { estado.visor = null; avisar(); }} />
        <span class="visor-nombre" title={c.estado === 'listo' ? rutaCorta(c.ruta) : ruta}>{nombre}</span>
        {esMd && !editando && c.estado === 'listo' && c.texto !== undefined && <BotonIcono icono="editar" titulo="Editar este Markdown" onClick={() => setEditando(true)} />}
        {(esMd || esHtml) && !editando && <BotonIcono icono="codigo" titulo={fuente ? 'Ver como documento' : 'Ver el código'} activo={fuente} onClick={() => setFuente(x => !x)} />}
        <BotonIcono icono="recargar" titulo="Volver a cargar" onClick={() => setVez(x => x + 1)} />
        <AbrirCon ruta={ruta} cwd={cwd} />
        <Papelera clase="icono-boton" titulo="Mandar a la papelera" onBorrar={() => borrarArchivo(ruta, cwd, id)} />
      </header>
      <div class="visor-cuerpo">{cuerpo}</div>
    </div>
  );
}

export function Visor({ bloques, cwd }: { bloques: Bloque[]; cwd: string }) {
  const todos = useMemo(() => archivosDe(bloques, cwd), [bloques, cwd]);
  // Los que se mandaron a la papelera no se listan, salvo que el agente los haya vuelto a tocar después
  const borrado = (a: ArchivoVisto) => { const k = claveArchivo(a.ruta, cwd); return estado.borrados.has(k) && estado.borrados.get(k) === a.id; };
  const archivos = todos.filter(a => !borrado(a));
  const v = estado.visor;
  // Si el agente vuelve a tocar el archivo que se está viendo, se recarga solo
  const firma = v ? bloques.filter(b => b.tipo === 'herramienta' && b.estado === 'ok' && rutaDe(b.entrada).endsWith(v.ruta.replace(/^\.\//, ''))).length + v.vez * 1000 : 0;
  if (v) return <Vista key={v.ruta} ruta={v.ruta} cwd={v.cwd} firma={firma} id={todos.find(a => a.ruta === v.ruta)?.id} />;
  // Agrupados por carpeta, cada una en su cuadro (como la barra izquierda); el orden: la que tiene lo más reciente primero
  const porCarpeta = new Map<string, ArchivoVisto[]>();
  for (const a of archivos) { const k = carpetaDe(a.ruta, cwd); porCarpeta.set(k, [...porCarpeta.get(k) || [], a]); }
  return (
    <div class="visor-lista">
      {!archivos.length && <p class="visor-nota">Aún no hay archivos en esta conversación.</p>}
      {[...porCarpeta].map(([carpeta, lista]) => (
        <details key={carpeta} class="cuadro" open>
          <summary class="cuadro-cabecera"><span class="carpeta-flecha" aria-hidden="true" /><Icono nombre="carpeta" tam={14} /><span class="cuadro-nombre">{carpeta}</span><span class="git-cantidad">{lista.length}</span></summary>
          <ul class="cuadro-lista">
            {lista.map(a => (
              <li key={a.ruta}>
                <button type="button" class="visor-archivo" title={rutaCorta(a.ruta)} onClick={() => ver(a.ruta, cwd)}>
                  <Icono nombre={iconoDe(a.ruta)} tam={14} />
                  <span class="visor-archivo-texto"><span>{a.ruta.split('/').pop()}</span><small>{a.como}</small></span>
                </button>
                <Papelera clase="agente-accion visor-borrar" titulo="Mandar a la papelera" onBorrar={() => borrarArchivo(a.ruta, cwd, a.id)} />
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}
