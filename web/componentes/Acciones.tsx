// Renombrar y borrar conversaciones: el título que se edita en su lugar y la confirmación antes de borrar.
import { useEffect, useRef } from 'preact/hooks';
import { estado, avisar } from '../tienda.ts';

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

export function Confirmar() {
  const ref = useRef<HTMLDialogElement>(null);
  const c = estado.confirmar;
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (c && !d.open) { d.showModal(); setTimeout(() => d.querySelector<HTMLButtonElement>('button[value="no"]')?.focus(), 20); }
    if (!c && d.open) d.close();
  }, [c]);
  const cerrar = () => { estado.confirmar = null; avisar(); };
  return (
    <dialog ref={ref} class="dialogo dialogo-confirmar" onClose={cerrar} onCancel={cerrar}>
      <form method="dialog" onSubmit={e => { if (((e as SubmitEvent).submitter as HTMLButtonElement | null)?.value === 'si') c?.al(); }}>
        <h2>{c?.titulo}</h2>
        <p>{c?.texto}</p>
        <div class="dialogo-acciones">
          <button class="boton" value="no">Cancelar</button>
          <button class="boton boton-peligro-lleno" value="si">{c?.boton}</button>
        </div>
      </form>
    </dialog>
  );
}
