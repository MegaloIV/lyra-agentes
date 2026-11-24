// Estado de la interfaz y conexión con el servidor. Un solo objeto mutable; los componentes se
// suscriben y se vuelven a dibujar como máximo una vez por frame.
import type { Bloque, ClienteMensaje, ServidorMensaje, ResumenAgente, Sesion, Comando, InfoProveedor, Proveedor } from '@protocolo';
import { aplicarOps } from '@protocolo';

export type Vista = { tipo: 'agente'; id: string } | { tipo: 'sesion'; sessionId: string; cwd: string; proveedor?: Proveedor } | null;
export type Documento = { bloques: Bloque[]; soloLectura: boolean };

export const estado = {
  conectado: false,
  rechazado: false,                       // el servidor no aceptó el token
  agentes: [] as ResumenAgente[],
  documentos: new Map<string, Documento>(),
  historial: [] as Sesion[],
  catalogo: [] as InfoProveedor[],
  comandos: new Map<string, Comando[]>(),
  vista: null as Vista,
  errores: [] as { id: number; texto: string; nivel: 'error' | 'info' }[],
  /** Qué título se está renombrando: `agente:<id>` o `sesion:<sessionId>` */
  editando: null as string | null,
  confirmar: null as { titulo: string; texto: string; boton: string; al: () => void } | null,
  carpeta: { ruta: null as string | null, vez: 0 },
  primeraLista: false,
};

const oyentes = new Set<() => void>();
let programado = false;
export function suscribir(f: () => void) { oyentes.add(f); return () => { oyentes.delete(f); }; }
export function avisar() {
  if (programado) return;
  programado = true;
  requestAnimationFrame(() => { programado = false; for (const f of oyentes) f(); });
}

// Token: llega una vez en la URL y se guarda en la pestaña
function leerToken(): string {
  const url = new URL(location.href), t = url.searchParams.get('t');
  try {
    if (t) { sessionStorage.setItem('lyra-token', t); url.searchParams.delete('t'); history.replaceState(null, '', url.pathname + url.search + url.hash); }
    return t || sessionStorage.getItem('lyra-token') || '';
  } catch { return t || ''; }
}
const token = leerToken();

let ws: WebSocket | null = null, espera = 1000, esperandoNuevo = 0, numeroError = 0;

export function enviar(m: ClienteMensaje) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  else mostrarError('Sin conexión con el servidor. Se reintentará en unos segundos.');
}

export function mostrarError(texto: string, nivel: 'error' | 'info' = 'error') {
  const id = ++numeroError;
  estado.errores = [...estado.errores, { id, texto, nivel }].slice(-3);
  avisar();
  setTimeout(() => { estado.errores = estado.errores.filter(e => e.id !== id); avisar(); }, nivel === 'info' ? 3500 : 6000);
}

/** Una conversación: abierta (`agente`) o del historial (`sessionId`) */
export type Objetivo = { proveedor: Proveedor; titulo: string; agente?: string; sessionId?: string; cwd?: string; trabajando?: boolean };

export function pedirBorrar(o: Objetivo) {
  const donde = o.proveedor === 'codex' ? 'Codex la archiva: deja de aparecer aquí y en Codex, pero no se pierde.'
    : !o.sessionId && o.agente ? 'Todavía no tiene nada guardado.'
    : 'Va a la papelera del escritorio: puedes recuperarla desde el gestor de archivos.';
  estado.confirmar = {
    titulo: '¿Borrar esta conversación?',
    texto: `«${o.titulo}». ${o.trabajando ? 'El agente está trabajando y se va a detener. ' : o.agente ? 'Se cierra el agente. ' : ''}${donde}`,
    boton: 'Borrar',
    al: () => enviar({ t: 'borrar', proveedor: o.proveedor, sessionId: o.sessionId, agente: o.agente }),
  };
  avisar();
}

export function renombrar(o: Objetivo, titulo: string) {
  estado.editando = null;
  const limpio = titulo.trim();
  if (limpio && limpio !== o.titulo) {
    enviar({ t: 'renombrar', proveedor: o.proveedor, sessionId: o.sessionId, agente: o.agente, cwd: o.cwd, titulo: limpio });
    const s = o.sessionId && estado.historial.find(x => x.sessionId === o.sessionId);   // se ve al instante
    if (s) s.titulo = limpio;
    const a = o.agente && estado.agentes.find(x => x.id === o.agente);
    if (a) a.titulo = limpio;
  }
  avisar();
}

/** Crear o reanudar: el próximo documento de un agente que llegue pasa a ser la vista. */
export function crearAgente(m: Extract<ClienteMensaje, { t: 'crear' | 'reanudar' }>) {
  esperandoNuevo = Date.now();
  enviar(m);
}

export function elegir(vista: Vista) {
  estado.vista = vista;
  try { sessionStorage.setItem('lyra-vista', JSON.stringify(vista)); } catch {}
  if (vista?.tipo === 'agente') {
    enviar({ t: 'leer', agente: vista.id });
    if (!estado.comandos.has(vista.id)) enviar({ t: 'comandos', agente: vista.id });
  }
  if (vista?.tipo === 'sesion') {
    const abierto = estado.agentes.find(a => a.sessionId === vista.sessionId);
    if (abierto) return elegir({ tipo: 'agente', id: abierto.id });
    if (!estado.documentos.has(vista.sessionId)) enviar({ t: 'abrirSesion', sessionId: vista.sessionId, cwd: vista.cwd, proveedor: vista.proveedor });
  }
  avisar();
}

function recibir(m: ServidorMensaje) {
  switch (m.t) {
    case 'agentes': {
      const antes = new Set(estado.agentes.map(a => a.id));
      estado.agentes = m.agentes;
      for (const id of estado.documentos.keys()) if (antes.has(id) && !m.agentes.some(a => a.id === id)) estado.documentos.delete(id);
      const v = estado.vista;
      if (v?.tipo === 'agente' && !m.agentes.some(a => a.id === v.id)) estado.vista = null;
      if (!estado.primeraLista) {
        estado.primeraLista = true;
        try {
          const guardada = JSON.parse(sessionStorage.getItem('lyra-vista') || 'null') as Vista;
          if (guardada?.tipo === 'agente' && m.agentes.some(a => a.id === guardada.id)) elegir(guardada);
          else if (guardada?.tipo === 'sesion') elegir(guardada);
        } catch {}
      }
      break;
    }
    case 'documento': {
      estado.documentos.set(m.agente, { bloques: m.bloques, soloLectura: !!m.soloLectura });
      if (!m.soloLectura && esperandoNuevo && Date.now() - esperandoNuevo < 60000) { esperandoNuevo = 0; elegir({ tipo: 'agente', id: m.agente }); }
      break;
    }
    case 'ops': {
      const doc = estado.documentos.get(m.agente);
      if (doc) doc.bloques = aplicarOps(doc.bloques, m.ops);
      else estado.documentos.set(m.agente, { bloques: aplicarOps([], m.ops), soloLectura: false });
      const v = estado.vista;
      if (v?.tipo === 'agente' && v.id === m.agente && document.visibilityState === 'visible' && m.ops.some(o => o.op === 'agregar' && o.bloque.tipo === 'fin')) enviar({ t: 'leer', agente: m.agente });
      break;
    }
    case 'historial': estado.historial = m.sesiones; break;
    case 'catalogo': estado.catalogo = m.proveedores; break;
    case 'comandos': estado.comandos.set(m.agente, m.comandos); break;
    case 'carpeta': estado.carpeta = { ruta: m.ruta, vez: estado.carpeta.vez + 1 }; break;
    case 'error': mostrarError(m.texto); break;
    case 'aviso': mostrarError(m.texto, 'info'); break;
    case 'borrada': {
      if (m.sessionId) { estado.documentos.delete(m.sessionId); estado.historial = estado.historial.filter(s => s.sessionId !== m.sessionId); }
      const v = estado.vista;
      if (v && (v.tipo === 'sesion' ? v.sessionId === m.sessionId : v.id === m.agente)) elegir(null);
      break;
    }
    case 'enfocar': if (estado.agentes.some(a => a.id === m.agente)) elegir({ tipo: 'agente', id: m.agente }); break;
  }
  avisar();
}

function conectar() {
  if (!token) { estado.rechazado = true; avisar(); return; }
  const s = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?t=${encodeURIComponent(token)}`);
  ws = s;
  s.onopen = () => { estado.conectado = true; espera = 1000; s.send(JSON.stringify({ t: 'hola' })); avisarFoco(); avisar(); };
  s.onmessage = e => { try { recibir(JSON.parse(String(e.data)) as ServidorMensaje); } catch {} };
  s.onclose = e => {
    estado.conectado = false; ws = null;
    if (e.code === 4401) { estado.rechazado = true; avisar(); return; }
    avisar();
    setTimeout(conectar, espera); espera = Math.min(espera * 2, 10000);
  };
}

function avisarFoco() {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'foco', visible: document.visibilityState === 'visible' && document.hasFocus() }));
}
// El servidor considera «visible» solo si lo oyó hace menos de 2 s: latido cada segundo
setInterval(avisarFoco, 1000);
for (const ev of ['visibilitychange', 'focus', 'blur']) (ev === 'visibilitychange' ? document : window).addEventListener(ev, () => {
  avisarFoco();
  const v = estado.vista;
  if (ev !== 'blur' && v?.tipo === 'agente' && estado.agentes.find(a => a.id === v.id)?.sinLeer) enviar({ t: 'leer', agente: v.id });
});

conectar();
