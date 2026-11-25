// Imagen del visor con zoom: pellizcar en el touchpad o Ctrl + rueda acerca donde está el puntero, dos dedos o
// arrastrar la mueve, doble clic alterna entre ajustada y tamaño real. Teclas: + − 0 1.
// En la ventana GTK el pellizco no llega a la página (WebKit lo usa para su propio zoom): ventana.py lo toma
// y lo manda como el evento `lyra-pellizco`.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { BotonIcono } from './Acciones.tsx';
import { ajustada, alternar, mover, zoomEn, type Tam, type Vista } from '../zoom.ts';

type Pellizco = { fase: 'inicio' | 'cambio' | 'fin'; escala: number; x: number; y: number };

export function Imagen({ url, nombre }: { url: string; nombre: string }) {
  const marcoRef = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<Tam | null>(null);
  const [marco, setMarco] = useState<Tam>({ ancho: 0, alto: 0 });
  const [v, setV] = useState<Vista>({ escala: 1, x: 0, y: 0 });
  const [arrastrando, setArrastrando] = useState(false);
  // Lo último, para los manejadores que se registran una sola vez
  const actual = useRef({ v, marco, img });
  actual.current = { v, marco, img };

  // El marco cambia de tamaño (panel más ancho, ventana): vuelve a ajustarse
  useLayoutEffect(() => {
    const el = marcoRef.current!;
    const medir = () => setMarco({ ancho: el.clientWidth, alto: el.clientHeight });
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  useLayoutEffect(() => { if (img && marco.ancho) setV(ajustada(marco, img)); }, [img, marco.ancho, marco.alto]);

  const punto = (cx: number, cy: number) => {
    const r = marcoRef.current!.getBoundingClientRect();
    return [cx - r.left, cy - r.top] as const;
  };
  const zoom = (escala: number, px?: number, py?: number) => {
    const { v, marco, img } = actual.current;
    if (img) setV(zoomEn(v, escala, px ?? marco.ancho / 2, py ?? marco.alto / 2, marco, img));
  };

  useEffect(() => {
    const el = marcoRef.current!;
    let base = 1, gestoSafari = 1;
    const rueda = (e: WheelEvent) => {
      const { v, marco, img } = actual.current;
      if (!img) return;
      const px = e.deltaMode === 1 ? 16 : 1;
      if (e.ctrlKey) {   // pellizco en Chromium/Firefox, o Ctrl + rueda
        e.preventDefault();
        const [x, y] = punto(e.clientX, e.clientY);
        zoom(v.escala * Math.pow(1.002, -Math.max(-120, Math.min(120, e.deltaY * px))), x, y);
      } else if (img.ancho * v.escala > marco.ancho + 1 || img.alto * v.escala > marco.alto + 1) {
        e.preventDefault();
        setV(mover(v, -e.deltaX * px, -e.deltaY * px, marco, img));
      }
    };
    // Safari y algunos WebKit mandan el pellizco así
    const gesto = (e: Event & { scale?: number; clientX?: number; clientY?: number }) => {
      e.preventDefault();
      if (e.type === 'gesturestart') { gestoSafari = actual.current.v.escala; return; }
      const [x, y] = punto(e.clientX ?? 0, e.clientY ?? 0);
      zoom(gestoSafari * (e.scale ?? 1), x, y);
    };
    // Desde la ventana GTK (ventana.py); solo si el pellizco empezó encima de la imagen
    let mio = false;
    const pellizco = (e: Event) => {
      const d = (e as CustomEvent<Pellizco>).detail;
      if (d.fase === 'inicio') {
        const r = el.getBoundingClientRect();
        mio = d.x >= r.left && d.x <= r.right && d.y >= r.top && d.y <= r.bottom;
        base = actual.current.v.escala;
        return;
      }
      if (!mio) return;
      if (d.fase === 'fin') { mio = false; return; }
      const [x, y] = punto(d.x, d.y);
      zoom(base * d.escala, x, y);
    };
    el.addEventListener('wheel', rueda, { passive: false });
    for (const t of ['gesturestart', 'gesturechange']) el.addEventListener(t, gesto as EventListener, { passive: false });
    window.addEventListener('lyra-pellizco', pellizco);
    return () => {
      el.removeEventListener('wheel', rueda);
      for (const t of ['gesturestart', 'gesturechange']) el.removeEventListener(t, gesto as EventListener);
      window.removeEventListener('lyra-pellizco', pellizco);
    };
  }, []);

  function agarrar(e: PointerEvent) {
    if (e.button !== 0 || !img) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    let ultimo = [e.clientX, e.clientY];
    setArrastrando(true);
    const moverse = (m: PointerEvent) => {
      const { v, marco, img } = actual.current;
      if (img) setV(mover(v, m.clientX - ultimo[0]!, m.clientY - ultimo[1]!, marco, img));
      ultimo = [m.clientX, m.clientY];
    };
    const soltar = () => {
      setArrastrando(false);
      el.removeEventListener('pointermove', moverse);
      el.removeEventListener('pointerup', soltar);
      el.removeEventListener('pointercancel', soltar);
    };
    el.addEventListener('pointermove', moverse);
    el.addEventListener('pointerup', soltar);
    el.addEventListener('pointercancel', soltar);
  }

  function tecla(e: KeyboardEvent) {
    if (e.ctrlKey || e.altKey || e.metaKey || !img) return;
    if (e.key === '+' || e.key === '=') zoom(v.escala * 1.25);
    else if (e.key === '-') zoom(v.escala / 1.25);
    else if (e.key === '0') setV(ajustada(marco, img));
    else if (e.key === '1') zoom(1);
    else return;
    e.preventDefault();
  }

  const grande = !!img && (img.ancho * v.escala > marco.ancho + 1 || img.alto * v.escala > marco.alto + 1);
  return (
    <div class="visor-imagen-zoom">
      <div class="paginas-barra">
        {img && <span class="paginas-info">{img.ancho} × {img.alto} px</span>}
        <BotonIcono icono="menos" titulo="Alejar" onClick={() => zoom(v.escala / 1.25)} />
        <button type="button" class="paginas-zoom" onClick={() => img && setV(ajustada(marco, img))}>{Math.round(v.escala * 100)}%</button>
        <BotonIcono icono="nuevo" titulo="Acercar" onClick={() => zoom(v.escala * 1.25)} />
        <button type="button" class="paginas-zoom" onClick={() => zoom(1)}>1:1</button>
      </div>
      <div ref={marcoRef} class="visor-imagen" tabIndex={0} data-grande={grande ? 'true' : undefined} data-arrastrando={arrastrando ? 'true' : undefined}
        onPointerDown={grande ? agarrar : undefined} onKeyDown={tecla}
        onDblClick={e => { if (!img) return; const [x, y] = punto(e.clientX, e.clientY); setV(alternar(v, x, y, marco, img)); }}>
        <img src={url} alt={nombre} draggable={false}
          onLoad={e => { const i = e.currentTarget as HTMLImageElement; setImg({ ancho: i.naturalWidth, alto: i.naturalHeight }); }}
          style={{ width: img ? `${img.ancho}px` : undefined, height: img ? `${img.alto}px` : undefined, visibility: img ? undefined : 'hidden',
            transform: `translate(${v.x}px, ${v.y}px) scale(${v.escala})`, imageRendering: v.escala >= 4 ? 'pixelated' : undefined }} />
      </div>
    </div>
  );
}
