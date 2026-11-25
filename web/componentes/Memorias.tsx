// Pestaña Memorias del panel derecho: lo que Claude, Codex y el agente local recuerdan o leen siempre
// (servidor/memorias.ts). Empieza en el proveedor de la conversación; tocar un archivo lo abre en el visor.
// Se vuelven a buscar cada vez que se abre la pestaña.
import { useEffect, useState } from 'preact/hooks';
import type { GrupoMemoria, Proveedor } from '@protocolo';
import { estado, pedirMemorias, ver } from '../tienda.ts';
import { Icono } from './iconos.tsx';
import { PROVEEDORES, haceCuanto } from '../util.ts';

function Grupo({ g, cwd }: { g: GrupoMemoria; cwd: string }) {
  const lista = (
    <ul class="git-lista">
      {g.archivos.map(a => (
        <li key={a.ruta}>
          <button type="button" class="git-fila" title={`${a.ruta}\nCambió ${haceCuanto(a.modificado)}`} onClick={() => ver(a.ruta, cwd)}>
            <Icono nombre="leer" tam={14} />
            <span class="git-fila-texto"><span>{a.nombre}</span>{a.descripcion && <small>{a.descripcion}</small>}</span>
          </button>
        </li>
      ))}
    </ul>
  );
  if (g.alcance === 'otro') return (
    <details class="mem-otro">
      <summary class="panel-titulo git-titulo"><span class="mem-otro-nombre">{g.titulo}</span><span class="git-cantidad">{g.archivos.length}</span></summary>
      {lista}
    </details>
  );
  return (
    <section class="git-seccion">
      <h3 class="panel-titulo git-titulo">{g.titulo}<span class="git-cantidad">{g.archivos.length}</span></h3>
      {lista}
    </section>
  );
}

export function Memorias({ cwd, proveedor }: { cwd: string; proveedor: Proveedor }) {
  const [elegido, setElegido] = useState<Proveedor>(proveedor);
  useEffect(() => setElegido(proveedor), [proveedor]);
  useEffect(() => pedirMemorias(cwd), [cwd]);
  const info = estado.memorias.get(cwd);
  if (!info || (!info.proveedores && !info.error)) return <p class="visor-nota">Buscando memorias…</p>;
  if (info.error) return <p class="visor-nota" data-nivel="error">{info.error}</p>;
  const p = info.proveedores!.find(x => x.proveedor === elegido);
  const llenos = p?.grupos.filter(g => g.archivos.length) || [];
  const propios = llenos.filter(g => g.alcance !== 'otro'), otros = llenos.filter(g => g.alcance === 'otro');
  return (
    <div class="git mem">
      <div class="git-rama mem-proveedores" role="group" aria-label="De qué agente">
        {PROVEEDORES.map(x => {
          const n = info.proveedores!.find(y => y.proveedor === x.id)?.grupos.reduce((s, g) => s + g.archivos.length, 0) || 0;
          return (
            <button type="button" key={x.id} class="mem-proveedor" data-proveedor={x.id} aria-pressed={elegido === x.id} onClick={() => setElegido(x.id)}>
              <span class="proveedor-punto" />{x.nombre}
            </button>
          );
        })}
      </div>
      {p?.nota && <p class="git-nota">{p.nota}</p>}
      {!propios.length && <p class="git-nota">Nada guardado para esta carpeta.</p>}
      {propios.map(g => <Grupo key={g.titulo} g={g} cwd={cwd} />)}
      {otros.length > 0 && (
        <section class="git-seccion">
          <h3 class="panel-titulo git-titulo">De otros proyectos<span class="git-cantidad">{otros.length}</span></h3>
          {otros.map(g => <Grupo key={g.titulo} g={g} cwd={cwd} />)}
        </section>
      )}
    </div>
  );
}
