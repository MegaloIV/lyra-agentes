import type { ResumenAgente, Sesion } from '@protocolo';
import { estado, elegir, enviar } from '../tienda.ts';
import { haceCuanto, nombreCarpeta, rutaCorta } from '../util.ts';

const GRUPOS = [
  { clave: 'atencion', titulo: 'Necesitan tu atención', estados: ['esperando', 'error'] },
  { clave: 'trabajando', titulo: 'Trabajando', estados: ['trabajando', 'iniciando'] },
  { clave: 'listos', titulo: 'Listos', estados: ['listo', 'cerrado'] },
] as const;

function Agente({ a, actual, onElegir }: { a: ResumenAgente; actual: boolean; onElegir: () => void }) {
  return (
    <li class="agente" data-estado={a.estado} aria-current={actual ? 'true' : undefined} onClick={onElegir}
      title={`${a.titulo}\n${rutaCorta(a.cwd)}`}>
      <span class="agente-estado" />
      <div class="agente-texto">
        <span class="agente-titulo">{a.titulo}</span>
        <span class="agente-meta">{nombreCarpeta(a.cwd)} · {a.estado === 'esperando' ? 'espera tu respuesta' : a.estado === 'error' ? 'se detuvo' : haceCuanto(a.ultimaActividad)}</span>
      </div>
      {a.sinLeer && !actual && <span class="agente-sinleer" title="Terminó y no lo has visto" />}
      <button class="agente-cerrar" title="Cerrar (la sesión queda en el historial)" onClick={e => { e.stopPropagation(); enviar({ t: 'cerrar', agente: a.id }); }}>×</button>
    </li>
  );
}

function Historial({ sesiones, onElegir }: { sesiones: Sesion[]; onElegir: () => void }) {
  const abiertas = new Set(estado.agentes.map(a => a.sessionId).filter(Boolean));
  const porCarpeta = new Map<string, Sesion[]>();
  for (const s of sesiones) {
    if (abiertas.has(s.sessionId)) continue;
    const l = porCarpeta.get(s.cwd) || []; l.push(s); porCarpeta.set(s.cwd, l);
  }
  const carpetas = [...porCarpeta.entries()].sort((a, b) => b[1][0]!.modificado - a[1][0]!.modificado);
  const v = estado.vista;
  if (!carpetas.length) return null;
  return (
    <section class="grupo" data-grupo="historial">
      <h3 class="grupo-titulo">Historial <span class="grupo-cuenta">{carpetas.reduce((n, c) => n + c[1].length, 0)}</span></h3>
      {carpetas.map(([cwd, lista]) => (
        <details class="historial-carpeta" key={cwd} open={v?.tipo === 'sesion' && v.cwd === cwd}>
          <summary title={rutaCorta(cwd)}>{nombreCarpeta(cwd)} <span class="grupo-cuenta">{lista.length}</span></summary>
          <ul class="grupo-lista">
            {lista.map(s => (
              <li key={s.sessionId} class="agente" data-estado="historial" aria-current={v?.tipo === 'sesion' && v.sessionId === s.sessionId ? 'true' : undefined}
                title={s.titulo} onClick={() => { elegir({ tipo: 'sesion', sessionId: s.sessionId, cwd: s.cwd }); onElegir(); }}>
                <span class="agente-estado" />
                <div class="agente-texto">
                  <span class="agente-titulo">{s.titulo}</span>
                  <span class="agente-meta">{haceCuanto(s.modificado)}{s.rama ? ` · ${s.rama}` : ''}</span>
                </div>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}

export function Barra({ abierta, onNuevo, onCerrarCajon }: { abierta: boolean; onNuevo: () => void; onCerrarCajon: () => void }) {
  const v = estado.vista;
  const agentes = [...estado.agentes].sort((a, b) => b.ultimaActividad - a.ultimaActividad);
  return (
    <aside class="agentes" data-abierto={String(abierta)}>
      <header class="agentes-cabecera">
        <span class="marca">Atril</span>
        <button class="boton-nuevo" title="Nuevo agente (Alt+N)" onClick={onNuevo}>+ Nuevo</button>
      </header>
      {GRUPOS.map(g => {
        const lista = agentes.filter(a => (g.estados as readonly string[]).includes(a.estado));
        if (!lista.length) return null;
        return (
          <section class="grupo" data-grupo={g.clave} key={g.clave}>
            <h3 class="grupo-titulo">{g.titulo} <span class="grupo-cuenta">{lista.length}</span></h3>
            <ul class="grupo-lista">
              {lista.map(a => <Agente key={a.id} a={a} actual={v?.tipo === 'agente' && v.id === a.id} onElegir={() => { elegir({ tipo: 'agente', id: a.id }); onCerrarCajon(); }} />)}
            </ul>
          </section>
        );
      })}
      <Historial sesiones={estado.historial} onElegir={onCerrarCajon} />
    </aside>
  );
}
