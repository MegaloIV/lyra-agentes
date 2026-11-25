// Hora, fecha y batería: grandes debajo de LYRA en el inicio y chicas a un lado de la cabecera en una conversación.
import { useEffect, useState } from 'preact/hooks';
import { estado } from '../tienda.ts';

/** La hora de ahora, renovada justo al cambiar el minuto (no cada segundo). */
function useAhora() {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const programar = () => { t = setTimeout(() => { setAhora(new Date()); programar(); }, 60_000 - Date.now() % 60_000 + 50); };
    programar();
    // Al volver de la suspensión el temporizador llega tarde: se pone al día cuando la ventana vuelve a verse
    const alVolver = () => { if (!document.hidden) { clearTimeout(t); setAhora(new Date()); programar(); } };
    document.addEventListener('visibilitychange', alVolver);
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', alVolver); };
  }, []);
  return ahora;
}

const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function Reloj({ grande }: { grande?: boolean }) {
  const ahora = useAhora();
  const h = ahora.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const fecha = grande
    ? mayuscula(ahora.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }))
    : mayuscula(ahora.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/,|\./g, ''));
  return (
    <time class={grande ? 'reloj reloj-grande' : 'reloj'} dateTime={ahora.toISOString()}
      title={grande ? undefined : mayuscula(ahora.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}>
      <span class="reloj-hora">{h}</span>
      <span class="reloj-fecha">{fecha}</span>
    </time>
  );
}

/** La batería de la laptop (la lee el servidor de /sys): ícono que se llena según el nivel y el porcentaje */
export function Bateria({ grande }: { grande?: boolean }) {
  const b = estado.bateria;
  if (!b) return null;
  const cargando = b.estado === 'cargando';
  const enchufada = cargando || b.estado === 'llena' || b.estado === 'enchufada';
  const nivel = enchufada ? 'bien' : b.nivel <= 15 ? 'baja' : b.nivel <= 30 ? 'media' : 'bien';
  const como = cargando ? 'cargando' : b.estado === 'llena' ? 'llena' : b.estado === 'enchufada' ? 'enchufada' : 'con batería';
  return (
    <span class={grande ? 'bateria bateria-grande' : 'bateria'} data-nivel={nivel} data-cargando={cargando ? 'true' : undefined} aria-label={`Batería ${b.nivel} %, ${como}`}>
      <svg viewBox="0 0 24 12" width={grande ? 30 : 22} height={grande ? 15 : 11} aria-hidden="true">
        <rect x="0.75" y="0.75" width="20" height="10.5" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.3" />
        <rect x="21.6" y="3.8" width="1.8" height="4.4" rx=".8" fill="currentColor" />
        <rect class="bateria-carga" x="2.4" y="2.4" width={Math.max(1, 16.7 * b.nivel / 100)} height="7.2" rx="1.1" />
        {cargando && <path d="M12 1.8L8.6 6.6h2.6L10 10.2l3.6-4.9h-2.7z" class="bateria-rayo" />}
      </svg>
      <span class="bateria-texto">{b.nivel} %{grande && <small> · {como}</small>}</span>
    </span>
  );
}
