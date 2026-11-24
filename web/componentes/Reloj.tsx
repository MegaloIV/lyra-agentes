// Hora y fecha actuales: grandes debajo de LYRA en el inicio y chicas a un lado de la cabecera en una conversación.
import { useEffect, useState } from 'preact/hooks';

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
