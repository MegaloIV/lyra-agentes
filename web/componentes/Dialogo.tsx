import { useEffect, useRef, useState } from 'preact/hooks';
import type { PermissionMode } from '@protocolo';
import { estado, enviar, crearAgente } from '../tienda.ts';
import { MODELOS, MODOS, rutaCorta } from '../util.ts';

export function DialogoNuevo({ abierto, carpetaInicial, onCerrar }: { abierto: boolean; carpetaInicial: string; onCerrar: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [cwd, setCwd] = useState(carpetaInicial);
  const [modelo, setModelo] = useState('');
  const [modo, setModo] = useState<PermissionMode>('default');
  const [prompt, setPrompt] = useState('');
  const vezCarpeta = useRef(estado.carpeta.vez);

  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (abierto && !d.open) { setCwd(carpetaInicial); setPrompt(''); d.showModal(); setTimeout(() => d.querySelector<HTMLTextAreaElement>('textarea')?.focus(), 30); }
    if (!abierto && d.open) d.close();
  }, [abierto]);

  // Respuesta del selector de carpetas (zenity)
  if (estado.carpeta.vez !== vezCarpeta.current) {
    vezCarpeta.current = estado.carpeta.vez;
    if (estado.carpeta.ruta) setTimeout(() => setCwd(rutaCorta(estado.carpeta.ruta!)), 0);
  }

  const recientes = [...new Set([...estado.agentes.map(a => a.cwd), ...estado.historial.map(s => s.cwd)].filter(Boolean))].slice(0, 20);

  function crear() {
    let ruta = cwd.trim() || '~/';
    if (ruta === '~') ruta = '~/';
    crearAgente({ t: 'crear', cwd: ruta, modelo: modelo || undefined, modo, prompt: prompt.trim() || undefined });
    onCerrar();
  }

  return (
    <dialog ref={ref} class="dialogo dialogo-nuevo" onClose={onCerrar} onCancel={onCerrar}>
      <form method="dialog" onSubmit={e => { const boton = (e as SubmitEvent).submitter as HTMLButtonElement | null; if (boton?.value === 'crear') { e.preventDefault(); crear(); } }}>
        <h2>Nuevo agente</h2>
        <label>Carpeta
          <div class="campo-carpeta">
            <input name="cwd" list="carpetas-recientes" value={cwd} spellcheck={false} onInput={e => setCwd((e.currentTarget as HTMLInputElement).value)} />
            <button type="button" class="boton" onClick={() => enviar({ t: 'elegirCarpeta' })}>Elegir…</button>
          </div>
        </label>
        <datalist id="carpetas-recientes">{recientes.map(r => <option key={r} value={rutaCorta(r)} />)}</datalist>
        <label>Modelo
          <select name="modelo" value={modelo} onChange={e => setModelo((e.currentTarget as HTMLSelectElement).value)}>
            {MODELOS.map(m => <option key={m.nombre} value={m.valor || ''}>{m.nombre}</option>)}
          </select>
        </label>
        <label>Permisos
          <select name="modo" value={modo} onChange={e => setModo((e.currentTarget as HTMLSelectElement).value as PermissionMode)}>
            {MODOS.map(m => <option key={m.valor} value={m.valor}>{m.nombre}</option>)}
          </select>
        </label>
        <label>Primer mensaje
          <textarea name="prompt" rows={4} value={prompt} placeholder="¿Qué quieres que haga? (Ctrl+Enter crea)"
            onInput={e => setPrompt((e.currentTarget as HTMLTextAreaElement).value)}
            onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); crear(); } }} />
        </label>
        <div class="dialogo-acciones">
          <button value="cancelar" class="boton">Cancelar</button>
          <button value="crear" class="boton boton-primario">Crear</button>
        </div>
      </form>
    </dialog>
  );
}
