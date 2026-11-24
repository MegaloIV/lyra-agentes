import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ResumenAgente } from '@protocolo';
import { estado, enviar, crearAgente, type Vista } from '../tienda.ts';

const borradores = new Map<string, string>();
const clave = (v: Vista) => v?.tipo === 'agente' ? v.id : v?.tipo === 'sesion' ? v.sessionId : '';

const TEXTO_ESTADO: Record<string, string> = {
  trabajando: 'Trabajando…', esperando: 'Esperando tu respuesta', iniciando: 'Iniciando…',
  error: 'Se detuvo por un error', listo: '', cerrado: '',
};

export function Redactor({ vista, agente }: { vista: Vista; agente?: ResumenAgente }) {
  const caja = useRef<HTMLTextAreaElement>(null);
  const [texto, setTexto] = useState(() => borradores.get(clave(vista)) || '');
  const [elegido, setElegido] = useState(0);
  const [popupCerrado, setPopupCerrado] = useState(false);
  const [avisoEsc, setAvisoEsc] = useState(0);
  const k = clave(vista);

  useEffect(() => { setTexto(borradores.get(k) || ''); setElegido(0); setPopupCerrado(false); caja.current?.focus(); }, [k]);
  useEffect(() => { borradores.set(k, texto); }, [texto, k]);
  useLayoutEffect(() => {
    const t = caja.current; if (!t) return;
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, window.innerHeight * 0.4) + 'px';
  }, [texto]);
  useEffect(() => {
    const enfocar = () => caja.current?.focus();
    window.addEventListener('atril-enfocar', enfocar);
    return () => window.removeEventListener('atril-enfocar', enfocar);
  }, []);

  const trabajando = agente?.estado === 'trabajando' || agente?.estado === 'esperando';
  const comandos = agente ? estado.comandos.get(agente.id) || [] : [];
  const buscando = /^\/(\S*)$/.exec(texto);
  const filtrados = buscando && !popupCerrado ? comandos.filter(c => c.nombre.replace(/^\//, '').toLowerCase().startsWith(buscando[1]!.toLowerCase())).slice(0, 30) : [];
  const indice = Math.min(elegido, Math.max(0, filtrados.length - 1));

  function mandar() {
    const t = texto.trim();
    if (!t) return;
    if (vista?.tipo === 'sesion') crearAgente({ t: 'reanudar', sessionId: vista.sessionId, cwd: vista.cwd, texto: t });
    else if (agente?.estado === 'error' && agente.sessionId) crearAgente({ t: 'reanudar', sessionId: agente.sessionId, cwd: agente.cwd, texto: t });
    else if (agente) enviar({ t: 'enviar', agente: agente.id, texto: t });
    else return;
    setTexto(''); borradores.delete(k);
  }

  function completar(i: number) {
    const c = filtrados[i]; if (!c) return;
    setTexto('/' + c.nombre.replace(/^\//, '') + ' ');
    setPopupCerrado(true);
    caja.current?.focus();
  }

  function tecla(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (filtrados.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setElegido((indice + 1) % filtrados.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setElegido((indice - 1 + filtrados.length) % filtrados.length); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && buscando?.[1] !== filtrados[indice]!.nombre.replace(/^\//, ''))) { e.preventDefault(); completar(indice); return; }
      if (e.key === 'Escape') { e.preventDefault(); setPopupCerrado(true); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); mandar(); return; }
    if (e.key === 'Escape' && trabajando && agente) {
      e.preventDefault();
      if (Date.now() - avisoEsc < 2000) { enviar({ t: 'interrumpir', agente: agente.id }); setAvisoEsc(0); }
      else { const ahora = Date.now(); setAvisoEsc(ahora); setTimeout(() => setAvisoEsc(v => v === ahora ? 0 : v), 2000); }
    }
  }

  const soloLectura = vista?.tipo === 'sesion';
  const textoEstado = avisoEsc ? 'Pulsa Esc otra vez para detener'
    : soloLectura ? 'Solo lectura · escribe para continuar esta sesión'
    : agente?.estado === 'error' && agente.sessionId ? 'Se detuvo · escribe o pulsa Reanudar para seguir'
    : TEXTO_ESTADO[agente?.estado || ''] || '';

  return (
    <footer class="redactor">
      {filtrados.length > 0 && (
        <div class="comandos" role="listbox">
          {filtrados.map((c, i) => (
            <button key={c.nombre} type="button" class="comando" aria-selected={i === indice} onMouseDown={e => { e.preventDefault(); completar(i); }}>
              <strong>/{c.nombre.replace(/^\//, '')}</strong><span>{c.descripcion}</span>
            </button>
          ))}
        </div>
      )}
      <div class="redactor-caja">
        <textarea ref={caja} class="redactor-texto" rows={1} value={texto}
          placeholder={soloLectura ? 'Escribe para retomar esta conversación…' : 'Escribe a Claude…  (Enter envía · Shift+Enter nueva línea)'}
          onInput={e => { setTexto((e.currentTarget as HTMLTextAreaElement).value); setPopupCerrado(false); setElegido(0); }}
          onKeyDown={tecla} />
        <div class="redactor-barra">
          <span class="redactor-estado">{textoEstado}</span>
          {agente?.estado === 'error' && agente.sessionId && <button class="boton" onClick={() => crearAgente({ t: 'reanudar', sessionId: agente.sessionId!, cwd: agente.cwd })}>Reanudar</button>}
          <button class="boton-detener" hidden={!trabajando} onClick={() => agente && enviar({ t: 'interrumpir', agente: agente.id })}>Detener</button>
          <button class="boton-enviar" disabled={!texto.trim()} onClick={mandar}>{trabajando ? 'Poner en cola' : 'Enviar'}</button>
        </div>
      </div>
    </footer>
  );
}
