import { useEffect, useRef, useState } from 'preact/hooks';
import type { PermissionMode, Proveedor } from '@protocolo';
import { estado, enviar, crearAgente } from '../tienda.ts';
import { PROVEEDORES, info, nombreEsfuerzo, rutaCorta } from '../util.ts';

function leer(clave: string, defecto: string) { try { return localStorage.getItem(clave) || defecto; } catch { return defecto; } }
function guardar(clave: string, valor: string) { try { localStorage.setItem(clave, valor); } catch {} }

function horaDe(ms: number) {
  const d = new Date(ms), hoy = new Date();
  const h = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === hoy.toDateString() ? `a las ${h}` : `el ${d.toLocaleDateString('es', { weekday: 'long', day: 'numeric' })} a las ${h}`;
}

export function DialogoNuevo({ abierto, carpetaInicial, onCerrar }: { abierto: boolean; carpetaInicial: string; onCerrar: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [cwd, setCwd] = useState(carpetaInicial);
  const [proveedor, setProveedor] = useState<Proveedor>(() => leer('lyra-proveedor', 'claude') as Proveedor);
  const [modelo, setModelo] = useState(() => leer(`lyra-modelo-${proveedor}`, ''));
  const [esfuerzo, setEsfuerzo] = useState(() => leer(`lyra-esfuerzo-${proveedor}`, ''));
  const [modo, setModo] = useState<PermissionMode>('default');
  const [prompt, setPrompt] = useState('');
  const vezCarpeta = useRef(estado.carpeta.vez);

  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (abierto && !d.open) { setCwd(carpetaInicial); setPrompt(''); enviar({ t: 'catalogo' }); d.showModal(); setTimeout(() => d.querySelector<HTMLTextAreaElement>('textarea')?.focus(), 30); }
    if (!abierto && d.open) d.close();
  }, [abierto]);

  // Respuesta del selector de carpetas (zenity)
  if (estado.carpeta.vez !== vezCarpeta.current) {
    vezCarpeta.current = estado.carpeta.vez;
    if (estado.carpeta.ruta) setTimeout(() => setCwd(rutaCorta(estado.carpeta.ruta!)), 0);
  }

  const datos = info(proveedor);
  const modelos = datos?.modelos || [];
  const elegido = modelos.find(m => (m.valor || '') === modelo) || modelos[0];
  const modeloEf = elegido?.valor || '';
  const esfuerzos = elegido?.esfuerzos || [];
  const modos = datos?.modos || [{ valor: 'default' as const, nombre: 'Preguntar' }];
  const recientes = [...new Set([...estado.agentes.map(a => a.cwd), ...estado.historial.map(s => s.cwd)].filter(Boolean))].slice(0, 20);
  const falta = !datos ? 'Cargando…' : !datos.instalado ? `${datos.nombre} no está instalado.` : '';
  const sinSesion = datos?.id === 'gemini' && datos.instalado && !datos.sesion;
  const cuota = datos?.cuota;

  function cambiarProveedor(p: Proveedor) {
    setProveedor(p); guardar('lyra-proveedor', p);
    setModelo(leer(`lyra-modelo-${p}`, '')); setEsfuerzo(leer(`lyra-esfuerzo-${p}`, ''));
    if (!info(p)?.modos.some(m => m.valor === modo)) setModo('default');
  }

  function crear() {
    if (falta) return;
    let ruta = cwd.trim() || '~/';
    if (ruta === '~') ruta = '~/';
    guardar(`lyra-modelo-${proveedor}`, modeloEf); guardar(`lyra-esfuerzo-${proveedor}`, esfuerzo);
    crearAgente({ t: 'crear', cwd: ruta, proveedor, modelo: modeloEf || undefined, esfuerzo: esfuerzos.includes(esfuerzo) ? esfuerzo : undefined, modo, prompt: prompt.trim() || undefined });
    onCerrar();
  }

  return (
    <dialog ref={ref} class="dialogo dialogo-nuevo" onClose={onCerrar} onCancel={onCerrar}>
      <form method="dialog" onSubmit={e => { const boton = (e as SubmitEvent).submitter as HTMLButtonElement | null; if (boton?.value === 'crear') { e.preventDefault(); crear(); } }}>
        <h2>Nuevo agente</h2>
        <div class="proveedores" role="radiogroup" aria-label="Proveedor">
          {PROVEEDORES.map(p => {
            const i = info(p.id);
            return (
              <button type="button" key={p.id} role="radio" class="proveedor" data-proveedor={p.id} aria-checked={proveedor === p.id}
                disabled={i && !i.instalado} title={i && !i.instalado ? `${p.nombre} no está instalado` : undefined} onClick={() => cambiarProveedor(p.id)}>
                <span class="proveedor-punto" />{p.nombre}
                {p.id === 'codex' && i?.cuota?.agotada && <small>sin cuota</small>}
                {p.id === 'gemini' && i?.instalado && !i.sesion && <small>sin sesión</small>}
              </button>
            );
          })}
        </div>
        {sinSesion && (
          <div class="aviso-dialogo">
            <p>Gemini todavía no tiene tu cuenta de Google. Abre Gemini en una terminal, elige <strong>Sign in with Google</strong> y, cuando termine, ciérrala.</p>
            <button type="button" class="boton" onClick={() => enviar({ t: 'abrir', con: 'loginGemini' })}>Iniciar sesión en Gemini</button>
          </div>
        )}
        {cuota && (cuota.agotada || cuota.usado >= 80) && (
          <div class="aviso-dialogo" data-nivel={cuota.agotada ? 'error' : 'info'}>
            <p>{cuota.agotada ? 'Se acabó tu cuota de Codex' : `Usaste el ${cuota.usado} % de tu cuota de Codex`}{cuota.renueva ? `; se renueva ${horaDe(cuota.renueva)}.` : '.'}</p>
          </div>
        )}
        <label>Carpeta
          <div class="campo-carpeta">
            <input name="cwd" list="carpetas-recientes" value={cwd} spellcheck={false} onInput={e => setCwd((e.currentTarget as HTMLInputElement).value)} />
            <button type="button" class="boton" onClick={() => enviar({ t: 'elegirCarpeta' })}>Elegir…</button>
          </div>
        </label>
        <datalist id="carpetas-recientes">{recientes.map(r => <option key={r} value={rutaCorta(r)} />)}</datalist>
        <div class="dialogo-fila">
          <label>Modelo
            <select name="modelo" value={modeloEf} onChange={e => setModelo((e.currentTarget as HTMLSelectElement).value)}>
              {modelos.map(m => <option key={m.valor || ''} value={m.valor || ''} title={m.descripcion}>{m.nombre}</option>)}
            </select>
          </label>
          {esfuerzos.length > 0 && (
            <label>Esfuerzo
              <select name="esfuerzo" value={esfuerzos.includes(esfuerzo) ? esfuerzo : ''} onChange={e => setEsfuerzo((e.currentTarget as HTMLSelectElement).value)}>
                <option value="">{elegido?.esfuerzoDefecto ? `Normal (${nombreEsfuerzo(elegido.esfuerzoDefecto).toLowerCase()})` : 'Normal'}</option>
                {esfuerzos.map(x => <option key={x} value={x}>{nombreEsfuerzo(x)}</option>)}
              </select>
            </label>
          )}
          <label>Permisos
            <select name="modo" value={modo} onChange={e => setModo((e.currentTarget as HTMLSelectElement).value as PermissionMode)}>
              {modos.map(m => <option key={m.valor} value={m.valor}>{m.nombre}</option>)}
            </select>
          </label>
        </div>
        {elegido?.descripcion && <p class="dialogo-nota">{elegido.descripcion}</p>}
        <label>Primer mensaje
          <textarea name="prompt" rows={4} value={prompt} placeholder="¿Qué quieres que haga? (Ctrl+Enter crea)"
            onInput={e => setPrompt((e.currentTarget as HTMLTextAreaElement).value)}
            onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); crear(); } }} />
        </label>
        <div class="dialogo-acciones">
          {falta && <span class="dialogo-nota">{falta}</span>}
          <button value="cancelar" class="boton">Cancelar</button>
          <button value="crear" class="boton boton-primario" disabled={!!falta}>Crear</button>
        </div>
      </form>
    </dialog>
  );
}
