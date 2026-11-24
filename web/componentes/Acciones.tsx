// Renombrar en su lugar, botones de ícono y la papelera de dos clics (sin ventanas de confirmación).
import { useEffect, useRef, useState } from 'preact/hooks';
import { estado, avisar } from '../tienda.ts';
import { Icono } from './iconos.tsx';

/** Muestra el título o, si `estado.editando === clave`, un campo para cambiarlo (Enter guarda, Esc cancela) */
export function TituloEditable({ clave, titulo, clase, onGuardar }: { clave: string; titulo: string; clase: string; onGuardar: (t: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const editando = estado.editando === clave;
  useEffect(() => { if (editando) { ref.current?.focus(); ref.current?.select(); } }, [editando]);
  if (!editando) return <span class={clase} onDblClick={e => { e.stopPropagation(); estado.editando = clave; avisar(); }}>{titulo}</span>;
  const cancelar = () => { estado.editando = null; avisar(); };
  return (
    <input ref={ref} class={`${clase} titulo-editando`} defaultValue={titulo} maxLength={120} aria-label="Nuevo nombre"
      onClick={e => e.stopPropagation()} onDblClick={e => e.stopPropagation()}
      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); onGuardar(e.currentTarget.value); } if (e.key === 'Escape') { e.preventDefault(); cancelar(); } }}
      onBlur={e => { if (estado.editando === clave) onGuardar(e.currentTarget.value); }} />
  );
}

/** Botón cuadrado con un ícono; el texto va en el globito al pasar el cursor */
export function BotonIcono({ icono, titulo, onClick, activo, clase = '', ...resto }: { icono: string; titulo: string; onClick: (e: MouseEvent) => void; activo?: boolean; clase?: string; [k: string]: unknown }) {
  return (
    <button type="button" class={`icono-boton ${clase}`} title={titulo} aria-label={titulo} aria-pressed={activo === undefined ? undefined : activo} onClick={onClick} {...resto}>
      <Icono nombre={icono} />
    </button>
  );
}

/** Papelera: el primer clic la arma (se pone roja), el segundo borra. Se desarma sola a los 3 s. */
export function Papelera({ titulo = 'Borrar', onBorrar, clase = 'agente-accion' }: { titulo?: string; onBorrar: () => void; clase?: string }) {
  const [armada, setArmada] = useState(false);
  useEffect(() => { if (!armada) return; const t = setTimeout(() => setArmada(false), 3000); return () => clearTimeout(t); }, [armada]);
  return (
    <button type="button" class={clase} data-accion="borrar" data-armada={armada ? 'true' : undefined}
      title={armada ? 'Clic otra vez para borrar' : titulo} aria-label={armada ? 'Confirmar: borrar' : titulo}
      onClick={e => { e.stopPropagation(); if (armada) { setArmada(false); onBorrar(); } else setArmada(true); }}
      onMouseLeave={() => armada && setTimeout(() => setArmada(false), 1200)}>
      <Icono nombre="papelera" />{armada && <span class="papelera-texto">¿Borrar?</span>}
    </button>
  );
}

/** Lista corta que se abre junto a un botón y se cierra al hacer clic afuera o con Esc */
export function Desplegable({ onCerrar, children, clase = '' }: { onCerrar: () => void; children: preact.ComponentChildren; clase?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fuera = (e: MouseEvent) => { if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onCerrar(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onCerrar(); } };
    document.addEventListener('mousedown', fuera); document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc, true); };
  }, []);
  return <div ref={ref} class={`desplegable ${clase}`} role="menu" onClick={e => e.stopPropagation()}>{children}</div>;
}
