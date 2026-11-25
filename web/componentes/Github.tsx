// Pestaña GitHub del panel derecho: rama, cambios sin commit (con su diff), PR y pruebas (CI), issues abiertos y
// commits recientes de la carpeta del agente. Nada se hace solo: los botones escriben un encargo en la caja y el
// usuario decide si lo manda (commit, push, PR, arreglar una prueba o un issue los hace el agente).
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { CambioGit, PruebaGit } from '@protocolo';
import { estado, avisar, enviar, pedirGit, verDiffGit, insertarEnCaja, ver } from '../tienda.ts';
import { BotonIcono } from './Acciones.tsx';
import { Icono } from './iconos.tsx';
import { haceCuanto } from '../util.ts';

const NOMBRE_ESTADO: Record<CambioGit['estado'], string> = { M: 'modificado', A: 'nuevo', D: 'borrado', R: 'renombrado', U: 'en conflicto', '?': 'nuevo, sin seguimiento' };
const NOMBRE_PRUEBA: Record<PruebaGit['estado'], string> = { ok: 'pasó', error: 'falló', corriendo: 'corriendo', omitida: 'omitida' };
const ICONO_PRUEBA: Record<PruebaGit['estado'], string> = { ok: 'ok', error: 'cerrar', corriendo: 'corriendo', omitida: 'menos' };
/** GitHub se vuelve a consultar al abrir el panel o al terminar un turno, si pasaron 2 min */
const CADA_RED = 2 * 60_000;

function Enlace({ url, children, clase }: { url: string; children: preact.ComponentChildren; clase?: string }) {
  return <a class={clase} href={url} target="_blank" rel="noreferrer noopener" title={url}>{children}</a>;
}

function Seccion({ titulo, cantidad, children, extra }: { titulo: string; cantidad?: number; children: preact.ComponentChildren; extra?: preact.ComponentChildren }) {
  return (
    <section class="git-seccion">
      <h3 class="panel-titulo git-titulo">{titulo}{cantidad !== undefined && <span class="git-cantidad">{cantidad}</span>}{extra}</h3>
      {children}
    </section>
  );
}

function Prueba({ p, cwd }: { p: PruebaGit; cwd: string }) {
  const pidiendo = estado.pidiendoRegistro === `${p.run}:${p.job}`;
  return (
    <li class="git-prueba" data-estado={p.estado}>
      <span class="git-prueba-icono" aria-label={NOMBRE_PRUEBA[p.estado]}><Icono nombre={ICONO_PRUEBA[p.estado]} tam={14} /></span>
      {p.url ? <Enlace url={p.url} clase="git-prueba-nombre">{p.nombre}</Enlace> : <span class="git-prueba-nombre">{p.nombre}</span>}
      {p.estado === 'error' && p.run && (
        <button type="button" class="git-accion" disabled={pidiendo}
          onClick={() => { estado.pidiendoRegistro = `${p.run}:${p.job}`; avisar(); enviar({ t: 'registroPrueba', cwd, run: p.run!, job: p.job }); }}>
          {pidiendo ? 'Trayendo…' : 'Pasarle el error'}
        </button>
      )}
    </li>
  );
}

const ORDEN_PRUEBA: Record<PruebaGit['estado'], number> = { error: 0, corriendo: 1, ok: 2, omitida: 3 };
/** Las que fallaron primero. Si son muchas, solo se ven las que fallaron o corren, y un resumen que despliega el resto */
function Pruebas({ pruebas, cwd }: { pruebas: PruebaGit[]; cwd: string }) {
  const [todas, setTodas] = useState(false);
  const orden = [...pruebas].sort((a, b) => ORDEN_PRUEBA[a.estado] - ORDEN_PRUEBA[b.estado]);
  const importantes = orden.filter(p => p.estado === 'error' || p.estado === 'corriendo');
  const corta = pruebas.length > 6 && !todas;
  const cuantas = (e: PruebaGit['estado']) => pruebas.filter(p => p.estado === e).length;
  const resumen = [[cuantas('error'), 'fallaron', 'falló'], [cuantas('corriendo'), 'corriendo', 'corriendo'], [cuantas('ok'), 'pasaron', 'pasó'], [cuantas('omitida'), 'omitidas', 'omitida']]
    .filter(([n]) => n).map(([n, plural, uno]) => `${n} ${n === 1 ? uno : plural}`).join(' · ');
  return (
    <>
      <ul class="git-lista git-pruebas">{(corta ? importantes : orden).map((p, i) => <Prueba key={i} p={p} cwd={cwd} />)}</ul>
      {pruebas.length > 6 && (
        <button type="button" class="git-resumen" onClick={() => setTodas(x => !x)}>
          {todas ? 'Ver solo las importantes' : `${resumen} · ver todas`}
        </button>
      )}
    </>
  );
}

/** Un diff de git a líneas para dibujar: cabeceras de archivo, tramos (@@), +, − y el mensaje del commit */
function lineasDiff(texto: string) {
  const salida: { tipo: string; texto: string }[] = [];
  for (const l of texto.split('\n')) {
    if (l.startsWith('diff --git ')) salida.push({ tipo: 'f', texto: l.replace(/^diff --git a\/.* b\//, '') });
    else if (/^(index |--- |\+\+\+ |new file mode|deleted file mode|old mode|new mode|similarity index|rename from|rename to|Binary files)/.test(l)) {
      if (l.startsWith('Binary files')) salida.push({ tipo: ' ', texto: '(archivo binario)' });
    }
    else if (l.startsWith('@@')) salida.push({ tipo: '@', texto: l.replace(/^(@@[^@]*@@).*/, '$1') });
    else if (l[0] === '+' || l[0] === '-') salida.push({ tipo: l[0], texto: l.slice(1) });
    else if (l[0] === ' ' && salida.some(x => x.tipo === '@')) salida.push({ tipo: ' ', texto: l.slice(1) });
    else if (l[0] === '\\') continue;   // «\ No newline at end of file»
    else salida.push({ tipo: 'm', texto: l });
  }
  while (salida.length && salida.at(-1)!.tipo === 'm' && !salida.at(-1)!.texto.trim()) salida.pop();
  return salida;
}
const MAX_LINEAS = 3000;

function VistaDiff({ cwd, raiz }: { cwd: string; raiz: string }) {
  const d = estado.gitDiff!;
  const lineas = useMemo(() => d.texto ? lineasDiff(d.texto) : [], [d.texto]);
  const ruta = d.clave.startsWith('ruta:') ? d.clave.slice(5) : '';
  const commit = d.clave.startsWith('commit:') ? d.clave.slice(7) : '';
  return (
    <div class="visor-vista">
      <header class="visor-cabecera">
        <BotonIcono icono="indice" titulo="Volver a GitHub" onClick={() => { estado.gitDiff = null; avisar(); }} />
        <span class="visor-nombre" title={ruta || commit}>{ruta ? ruta.split('/').pop() : `Commit ${commit}`}</span>
        {ruta && <BotonIcono icono="visor" titulo="Ver el archivo en el Visor" onClick={() => ver(`${raiz}/${ruta}`, cwd)} />}
        <BotonIcono icono="recargar" titulo="Volver a cargar" onClick={() => verDiffGit(cwd, ruta ? { ruta } : { commit })} />
      </header>
      <div class="visor-cuerpo">
        {!d.texto && !d.error && <p class="visor-nota">Cargando…</p>}
        {d.error && <p class="visor-nota" data-nivel="error">{d.error}</p>}
        {d.texto !== undefined && !lineas.length && <p class="visor-nota">Sin diferencias con el último commit.</p>}
        {lineas.length > 0 && (
          <div class="diff git-diff">
            {lineas.slice(0, MAX_LINEAS).map((l, i) => <div key={i} class="diff-linea" data-tipo={l.tipo}>{l.texto || ' '}</div>)}
            {lineas.length > MAX_LINEAS && <div class="diff-linea" data-tipo=" ">… ({lineas.length - MAX_LINEAS} líneas más)</div>}
          </div>
        )}
      </div>
    </div>
  );
}

export function Github({ cwd, turnos }: { cwd: string; turnos: number }) {
  const info = estado.git.get(cwd);
  // Al abrir, al cambiar de carpeta y al terminar cada turno del agente; GitHub (internet) como mucho cada 2 min
  useEffect(() => { const i = estado.git.get(cwd); pedirGit(cwd, !i?.fechaRed || Date.now() - i.fechaRed > CADA_RED); }, [cwd, turnos]);
  useEffect(() => { const f = () => pedirGit(cwd, false); window.addEventListener('focus', f); return () => window.removeEventListener('focus', f); }, [cwd]);
  useEffect(() => { if (estado.gitDiff && estado.gitDiff.cwd !== cwd) { estado.gitDiff = null; avisar(); } }, [cwd]);

  const g = info?.git, gh = info?.github;
  if (!info || (!g && !info.error)) return <p class="visor-nota">Leyendo el repositorio…</p>;
  if (info.error) return <p class="visor-nota" data-nivel="error">{info.error}</p>;
  if (!g || !g.repo) return (
    <div class="visor-nota">
      <p>{g?.nota || 'Esta carpeta no es un repositorio de git.'}</p>
      <button type="button" class="boton" onClick={() => insertarEnCaja('Inicia un repositorio de git en esta carpeta (git init) con un .gitignore adecuado para el proyecto y haz el primer commit.')}>Pedirle al agente que lo cree</button>
    </div>
  );
  if (estado.gitDiff?.cwd === cwd) return <VistaDiff cwd={cwd} raiz={g.raiz} />;

  const pidiendoRed = !!info.pidiendoRed;
  const pruebas = gh?.pr?.pruebas || gh?.pruebas || [];
  return (
    <div class="git">
      <div class="git-rama">
        <Icono nombre="rama" tam={14} />
        <span class="git-rama-nombre" title={g.arriba ? `Sigue a ${g.arriba}` : 'Sin rama remota'}>{g.rama || '—'}</span>
        {g.adelante > 0 && <span class="git-ab" title={`${g.adelante} commit(s) sin subir`}>↑{g.adelante}</span>}
        {g.atras > 0 && <span class="git-ab" title={`${g.atras} commit(s) en GitHub que no tienes`}>↓{g.atras}</span>}
        <span class="git-espacio" />
        {g.github && <Enlace url={`https://github.com/${g.github}`} clase="git-repo">{g.github}</Enlace>}
        <BotonIcono icono="recargar" titulo={pidiendoRed ? 'Consultando GitHub…' : 'Volver a leer'} clase={pidiendoRed ? 'girando' : ''} onClick={() => pedirGit(cwd, true)} />
      </div>
      {(g.adelante > 0 || g.atras > 0) && (
        <div class="git-botones">
          {g.adelante > 0 && <button type="button" class="git-accion" onClick={() => insertarEnCaja('Sube los commits que faltan a GitHub (git push). Si hay conflictos, avísame antes de resolverlos.')}>Pedirle que suba {g.adelante === 1 ? 'el commit' : `los ${g.adelante} commits`}</button>}
          {g.atras > 0 && <button type="button" class="git-accion" onClick={() => insertarEnCaja('Trae los cambios nuevos de GitHub (git pull). Si hay conflictos, avísame antes de resolverlos.')}>Pedirle que traiga los cambios</button>}
        </div>
      )}

      <Seccion titulo="Cambios sin commit" cantidad={g.cambios.length + g.masCambios}>
        {g.cambios.length ? (
          <>
            <ul class="git-lista">
              {g.cambios.map(c => (
                <li key={c.ruta}>
                  <button type="button" class="git-fila" title={`${c.ruta}\n${NOMBRE_ESTADO[c.estado]}${c.preparado ? ' (preparado para el commit)' : ''}`} onClick={() => verDiffGit(cwd, { ruta: c.ruta })}>
                    <span class="git-letra" data-estado={c.estado}>{c.estado === '?' ? 'N' : c.estado}</span>
                    <span class="git-fila-texto git-en-linea"><span>{c.ruta.replace(/\/$/, '').split('/').pop()}{c.ruta.endsWith('/') ? '/' : ''}</span><small>{c.ruta.replace(/\/?[^/]+\/?$/, '')}</small></span>
                  </button>
                </li>
              ))}
            </ul>
            {g.masCambios > 0 && <p class="git-nota">Y {g.masCambios} más.</p>}
            <div class="git-botones">
              <button type="button" class="git-accion" onClick={() => insertarEnCaja('Revisa los cambios sin commit (git status y git diff) y haz un commit con un mensaje claro que diga qué cambió y por qué.')}>Pedirle un commit al agente</button>
            </div>
          </>
        ) : <p class="git-nota">Todo está en el último commit.</p>}
      </Seccion>

      {g.github && (
        <Seccion titulo={gh?.pr ? 'Pull request' : 'Pruebas (CI)'}>
          {!gh && <p class="git-nota">Consultando GitHub…</p>}
          {gh?.nota && <p class="git-nota" data-nivel="aviso">{gh.nota}</p>}
          {gh?.pr && (
            <div class="git-pr">
              <Enlace url={gh.pr.url} clase="git-pr-titulo"><span class="git-pr-numero">#{gh.pr.numero}</span> {gh.pr.titulo}</Enlace>
              <div class="git-pr-datos">
                <span class="git-chip" data-estado={gh.pr.estado}>{gh.pr.estado}</span>
                {gh.pr.revision && <span class="git-chip" data-estado={gh.pr.revision}>{gh.pr.revision === 'aprobado' ? 'aprobado' : gh.pr.revision === 'cambios' ? 'piden cambios' : 'falta revisión'}</span>}
                {gh.pr.comentarios > 0 && <span class="git-chip">{gh.pr.comentarios === 1 ? '1 comentario' : `${gh.pr.comentarios} comentarios`}</span>}
              </div>
              {(gh.pr.comentarios > 0 || gh.pr.revision === 'cambios') && (
                <div class="git-botones">
                  <button type="button" class="git-accion" onClick={() => insertarEnCaja(`Lee los comentarios y la revisión del PR #${gh.pr!.numero} (gh pr view ${gh.pr!.numero} --comments) y corrige lo que pidan. Después dime qué cambiaste.`)}>Pedirle que atienda la revisión</button>
                </div>
              )}
            </div>
          )}
          {gh && !gh.pr && !gh.nota && g.rama && !['main', 'master'].includes(g.rama) && (
            <div class="git-botones">
              <button type="button" class="git-accion" onClick={() => insertarEnCaja(`Abre un pull request para la rama ${g.rama} con gh pr create: un título claro y una descripción de los cambios. Antes de crearlo, muéstrame el título y la descripción.`)}>Pedirle que abra un PR</button>
            </div>
          )}
          {pruebas.length > 0 && <Pruebas pruebas={pruebas} cwd={cwd} />}
          {gh && !gh.nota && !pruebas.length && <p class="git-nota">{gh.pr ? 'El PR no tiene pruebas.' : 'Esta rama no tiene pruebas automáticas.'}</p>}
        </Seccion>
      )}

      {gh?.issues && (
        <Seccion titulo="Issues abiertos" cantidad={gh.issues.length}>
          {gh.issues.length ? (
            <ul class="git-lista">
              {gh.issues.map(i => (
                <li key={i.numero} class="git-issue">
                  <Enlace url={i.url} clase="git-fila">
                    <span class="git-numero">#{i.numero}</span>
                    <span class="git-fila-texto"><span>{i.titulo}</span>{(i.etiquetas.length > 0 || i.autor) && <small>{[i.autor, ...i.etiquetas].filter(Boolean).join(' · ')}</small>}</span>
                  </Enlace>
                  <button type="button" class="agente-accion git-resolver" aria-label="Que lo resuelva el agente"
                    onClick={() => insertarEnCaja(`Resuelve el issue #${i.numero} de ${gh.repo}: «${i.titulo}» (${i.url}).\n\n${i.cuerpo.trim() || '(sin descripción)'}\n\nCuando termines, dime qué cambiaste y cómo lo probaste.`)}>
                    <Icono nombre="agente" />
                  </button>
                </li>
              ))}
            </ul>
          ) : <p class="git-nota">No hay issues abiertos.</p>}
        </Seccion>
      )}

      <Seccion titulo="Commits recientes">
        {g.commits.length ? (
          <ul class="git-lista">
            {g.commits.map(c => (
              <li key={c.hash}>
                <button type="button" class="git-fila" title={`${c.titulo}\n${c.autor} · ${new Date(c.fecha).toLocaleString()}`} onClick={() => verDiffGit(cwd, { commit: c.hash })}>
                  <span class="git-hash">{c.hash}</span>
                  <span class="git-fila-texto"><span>{c.titulo}</span><small>{c.autor} · {haceCuanto(c.fecha)}</small></span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p class="git-nota">Todavía no hay commits.</p>}
      </Seccion>
    </div>
  );
}
