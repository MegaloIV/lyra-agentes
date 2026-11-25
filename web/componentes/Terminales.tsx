// Comandos de la conversación, con su salida completa.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Bloque } from '@protocolo';
import { mostrarError } from '../tienda.ts';
import { limpiarSalida } from '../terminales.ts';
import { rutaCorta } from '../util.ts';

type Herramienta = Extract<Bloque, { tipo: 'herramienta' }>;
export function comandosTerminal(bloques: Bloque[]): Herramienta[] {
  return bloques.filter((b): b is Herramienta => b.tipo === 'herramienta' && (b.nombre === 'Bash' || !!b.terminal))
    .reverse().sort((a, b) => Number(b.estado === 'corriendo') - Number(a.estado === 'corriendo'));   // lo más nuevo arriba
}

function Comando({ bloque, ahora }: { bloque: Herramienta; ahora: number }) {
  const [abierto, abrir] = useState(false);
  const salidaRef = useRef<HTMLPreElement>(null);
  const entrada = bloque.entrada as { command?: string; description?: string; cwd?: string } | null;
  const t = bloque.terminal;
  const comando = t?.comando || entrada?.command || '';
  const descripcion = t?.descripcion || entrada?.description;
  const carpeta = t?.carpeta || entrada?.cwd;
  const salida = limpiarSalida(t?.salida ?? '');
  const corriendo = bloque.estado === 'corriendo';
  const duracion = t?.duracionMs ?? (corriendo && t?.inicio ? ahora - t.inicio : undefined);
  useLayoutEffect(() => {
    const el = salidaRef.current;
    if (el && (corriendo || abierto)) el.scrollTop = el.scrollHeight;
  }, [salida, abierto]);
  const copiar = (texto: string) => void navigator.clipboard.writeText(texto).then(() => mostrarError('Copiado', 'info'), () => mostrarError('No se pudo copiar'));
  return <article class="terminal-comando" data-estado={bloque.estado}>
    <button type="button" class="terminal-resumen" aria-expanded={abierto} onClick={() => abrir(!abierto)}>
      {descripcion && <strong>{descripcion}</strong>}
      <code>{comando}</code>
      {carpeta && <span class="terminal-carpeta">{rutaCorta(carpeta)}</span>}
      <span class="terminal-estado">{corriendo && <i class="terminal-punto" />}{corriendo ? 'corriendo…' : bloque.estado === 'ok' ? 'ok' : `error${t?.codigo !== undefined ? ` (${t.codigo})` : ''}`} · {duracion === undefined ? 'duración no disponible' : `${(Math.max(0, duracion) / 1000).toFixed(1)} s`}</span>
    </button>
    <div class="terminal-acciones">
      <button type="button" onClick={() => copiar(comando)}>Copiar comando</button>
      <button type="button" disabled={!salida} onClick={() => copiar(salida)}>Copiar salida</button>
    </div>
    {abierto && <pre ref={salidaRef} class="terminal-salida" tabIndex={0} aria-label="Salida del comando">{salida || (corriendo ? 'corriendo…' : 'Sin salida')}</pre>}
  </article>;
}

export function Terminales({ bloques }: { bloques: Bloque[] }) {
  const comandos = comandosTerminal(bloques);
  const [ahora, ponerAhora] = useState(Date.now());
  const corriendo = comandos.some(b => b.estado === 'corriendo');
  useEffect(() => {
    if (!corriendo) return;
    const reloj = setInterval(() => ponerAhora(Date.now()), 1000);
    return () => clearInterval(reloj);
  }, [corriendo]);
  return <div class="terminales">{comandos.length ? comandos.map(b => <Comando key={b.id} bloque={b} ahora={ahora} />) : <p>Aún no hay comandos de terminal en esta conversación.</p>}</div>;
}
