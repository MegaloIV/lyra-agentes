// Comandos de la conversación, con su salida completa.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Bloque } from '@protocolo';
import { mostrarError } from '../tienda.ts';
import { limpiarSalida } from '../terminales.ts';
import { rutaCorta } from '../util.ts';
import { Icono } from './iconos.tsx';

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
  const titulo = descripcion || comando.split('\n')[0] || 'Comando';
  const estadoTexto = corriendo ? 'corriendo…' : bloque.estado === 'ok' ? 'ok' : `error${t?.codigo !== undefined ? ` (${t.codigo})` : ''}`;
  return <article class="cuadro terminal-comando" data-estado={bloque.estado} data-abierto={abierto ? 'true' : undefined}>
    <button type="button" class="cuadro-cabecera terminal-resumen" aria-expanded={abierto} onClick={() => abrir(!abierto)}>
      <span class="carpeta-flecha" aria-hidden="true" />
      <span class="terminal-icono" aria-label={estadoTexto}>{corriendo ? <i class="terminal-punto" /> : <Icono nombre={bloque.estado === 'ok' ? 'ok' : 'cerrar'} tam={12} />}</span>
      <span class="terminal-titulo">{titulo}</span>
      <span class="terminal-duracion">{duracion === undefined ? '' : `${(Math.max(0, duracion) / 1000).toFixed(1)} s`}</span>
    </button>
    {abierto && <div class="terminal-detalle">
      <pre class="terminal-codigo">{comando}</pre>
      <p class="terminal-datos">{estadoTexto}{carpeta && <> · <span class="terminal-carpeta">{rutaCorta(carpeta)}</span></>}</p>
      <pre ref={salidaRef} class="terminal-salida" tabIndex={0} aria-label="Salida del comando">{salida || (corriendo ? 'corriendo…' : 'Sin salida')}</pre>
      <div class="terminal-acciones">
        <button type="button" class="git-accion" onClick={() => copiar(comando)}>Copiar comando</button>
        <button type="button" class="git-accion" disabled={!salida} onClick={() => copiar(salida)}>Copiar salida</button>
      </div>
    </div>}
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
  return <div class="terminales">{comandos.length ? comandos.map(b => <Comando key={b.id} bloque={b} ahora={ahora} />) : <p class="visor-nota">Aún no hay comandos de terminal en esta conversación.</p>}</div>;
}
