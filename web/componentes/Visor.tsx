// Visor del panel derecho: los archivos que el agente creó, editó, generó o nombró, y la vista de uno.
// Muestra Markdown, imágenes, video y audio, PDF, Word, presentaciones y hojas (pasadas a PDF con LibreOffice),
// HTML (sin scripts) y código. «Abrir con…» elige otra app (OnlyOffice, VS Code…). La papelera lo manda a la del escritorio.
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Bloque } from '@protocolo';
import { enviar, estado, leerArchivo, urlMedio, ver, avisar, borrarArchivo, claveArchivo } from '../tienda.ts';
import { Docx, Pdf } from './Paginas.tsx';
import { renderizar } from '../md.ts';
import { Codigo } from './Documento.tsx';
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

type Cargado = { estado: 'cargando' } | { estado: 'error'; texto: string } | { estado: 'listo'; tipo: string; url?: string; texto?: string; datos?: Blob; ruta: string };

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
      else if (tipo.startsWith('text/')) setC({ estado: 'listo', tipo, texto: await r.datos.text(), ruta: r.ruta });
      else setC({ estado: 'listo', tipo, ruta: r.ruta });
    }).catch((e: Error) => vivo && setC({ estado: 'error', texto: e.message }));
    return () => { vivo = false; if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); };
  }, [ruta, cwd, firma, vez]);
  useEffect(() => setFuente(false), [ruta]);

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
  else if (c.tipo.startsWith('image/')) cuerpo = <div class="visor-imagen"><img src={c.url} alt={nombre} onClick={e => (e.currentTarget as HTMLElement).classList.toggle('real')} title="Clic: tamaño real" /></div>;
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
        {(esMd || esHtml) && <BotonIcono icono="codigo" titulo={fuente ? 'Ver como documento' : 'Ver el código'} activo={fuente} onClick={() => setFuente(x => !x)} />}
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
  return (
    <div class="visor-lista">
      <h3 class="panel-titulo">Archivos</h3>
      <ul>
        {archivos.map(a => (
          <li key={a.ruta}>
            <button type="button" class="visor-archivo" title={rutaCorta(a.ruta)} onClick={() => ver(a.ruta, cwd)}>
              <Icono nombre={iconoDe(a.ruta)} tam={14} />
              <span class="visor-archivo-texto"><span>{a.ruta.split('/').pop()}</span><small>{carpetaDe(a.ruta, cwd)}</small></span>
            </button>
            <Papelera clase="agente-accion visor-borrar" titulo="Mandar a la papelera" onBorrar={() => borrarArchivo(a.ruta, cwd, a.id)} />
          </li>
        ))}
      </ul>
    </div>
  );
}
