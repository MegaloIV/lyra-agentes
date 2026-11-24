// Documentos dibujados dentro del visor, sin abrir otra app: PDF con pdf.js (Mozilla) y Word con docx-preview.
// Las dos librerías se cargan solo al abrir un documento, para no engordar la página.
import { useEffect, useRef, useState } from 'preact/hooks';
import trabajadorPdf from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { BotonIcono } from './Acciones.tsx';

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

function Zoom({ zoom, setZoom, extra }: { zoom: number; setZoom: (z: number) => void; extra?: string }) {
  const i = ZOOMS.indexOf(zoom);
  return (
    <div class="paginas-barra">
      {extra && <span class="paginas-info">{extra}</span>}
      <BotonIcono icono="menos" titulo="Alejar" disabled={i <= 0} onClick={() => setZoom(ZOOMS[Math.max(0, i - 1)]!)} />
      <button type="button" class="paginas-zoom" title="Ajustar al ancho" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
      <BotonIcono icono="nuevo" titulo="Acercar" disabled={i >= ZOOMS.length - 1} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, i + 1)]!)} />
    </div>
  );
}

/** PDF: cada página es un lienzo que se dibuja recién cuando se acerca a la vista */
export function Pdf({ datos }: { datos: Blob }) {
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const cont = ref.current!;
    let vivo = true, obs: IntersectionObserver | null = null;
    let destruir = () => {};
    cont.replaceChildren();
    (async () => {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = trabajadorPdf;
      const tarea = pdfjs.getDocument({ data: new Uint8Array(await datos.arrayBuffer()), useSystemFonts: true });
      destruir = () => { void tarea.destroy(); };
      const doc = await tarea.promise;
      if (!vivo) return;
      setInfo(`${doc.numPages} pág.`);
      const ancho = Math.max(200, cont.clientWidth - 40) * zoom;   // menos el relleno y la barra de desplazamiento
      const dpr = window.devicePixelRatio || 1;
      const dibujadas = new Set<number>();
      obs = new IntersectionObserver(entradas => {
        for (const e of entradas) {
          const div = e.target as HTMLDivElement, n = Number(div.dataset.n);
          if (!e.isIntersecting || dibujadas.has(n)) continue;
          dibujadas.add(n);
          void doc.getPage(n).then(async p => {
            const vp = p.getViewport({ scale: ancho / p.getViewport({ scale: 1 }).width });
            const lienzo = document.createElement('canvas');
            lienzo.width = Math.floor(vp.width * dpr); lienzo.height = Math.floor(vp.height * dpr);
            lienzo.style.width = `${vp.width}px`; lienzo.style.height = `${vp.height}px`;
            await p.render({ canvas: lienzo, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined }).promise;
            if (vivo) div.replaceChildren(lienzo);
          }).catch(() => {});
        }
      }, { root: cont.parentElement, rootMargin: '600px 0px' });
      // Las páginas se crean con el tamaño de la primera, para que el desplazamiento no salte
      const primera = (await doc.getPage(1)).getViewport({ scale: 1 });
      for (let n = 1; n <= doc.numPages; n++) {
        const div = document.createElement('div');
        div.className = 'pdf-pagina'; div.dataset.n = String(n);
        div.style.width = `${ancho}px`; div.style.aspectRatio = `${primera.width} / ${primera.height}`;
        cont.append(div); obs.observe(div);
      }
    })().catch((e: Error) => vivo && setError(e?.message || 'No se pudo abrir el PDF.'));
    return () => { vivo = false; obs?.disconnect(); destruir(); };
  }, [datos, zoom]);
  return (
    <div class="paginas-marco">
      <Zoom zoom={zoom} setZoom={setZoom} extra={info} />
      {error && <p class="visor-nota" data-nivel="error">{error}</p>}
      <div class="paginas-scroll"><div ref={ref} class="paginas" /></div>
    </div>
  );
}

/** Word (.docx): docx-preview arma las páginas en HTML con su tamaño real y se escalan como una imagen
 *  (transform), para que el texto no se vuelva a acomodar; el 100 % ajusta la hoja al ancho del panel */
export function Docx({ datos }: { datos: Blob }) {
  const ref = useRef<HTMLDivElement>(null);
  const caja = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState('');
  const [listo, setListo] = useState(false);
  useEffect(() => {
    const cont = ref.current!;
    let vivo = true;
    setListo(false); cont.replaceChildren();
    import('docx-preview').then(({ renderAsync }) => renderAsync(datos, cont, undefined, {
      className: 'docx', inWrapper: true, breakPages: true, useBase64URL: true, renderHeaders: true, renderFooters: true, experimental: true,
    })).then(() => vivo && setListo(true)).catch((e: Error) => vivo && setError(e?.message || 'No se pudo abrir el documento.'));
    return () => { vivo = false; };
  }, [datos]);
  useEffect(() => {
    const cont = ref.current!, marco = caja.current!, scroll = marco.parentElement!;
    const ajustar = () => {
      const hoja = cont.querySelector<HTMLElement>('section.docx');
      if (!hoja) return;
      const escala = Math.max(0.05, (scroll.clientWidth - 24) / (hoja.offsetWidth || 1)) * zoom;
      cont.style.transform = `scale(${escala})`;
      marco.style.width = `${cont.offsetWidth * escala}px`;
      marco.style.height = `${cont.offsetHeight * escala}px`;
    };
    ajustar();
    const obs = new ResizeObserver(ajustar); obs.observe(scroll); obs.observe(cont);
    return () => obs.disconnect();
  }, [listo, zoom]);
  return (
    <div class="paginas-marco">
      <Zoom zoom={zoom} setZoom={setZoom} />
      {error && <p class="visor-nota" data-nivel="error">{error}</p>}
      <div class="paginas-scroll paginas-docx">
        <div ref={caja} class="docx-caja"><div ref={ref} class="docx-hojas" /></div>
      </div>
    </div>
  );
}
