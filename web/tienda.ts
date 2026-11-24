// Estado de la interfaz y conexión con el servidor. Un solo objeto mutable; los componentes se
// suscriben y se vuelven a dibujar como máximo una vez por frame.
import type { Bloque, ClienteMensaje, ServidorMensaje, ResumenAgente, Sesion, Comando, InfoProveedor, Limite, Proveedor, Grupos, PermissionMode } from '@protocolo';
import { aplicarOps } from '@protocolo';

/** `null`: un agente nuevo, todavía sin crear (se crea al mandar el primer mensaje) */
export type Vista = { tipo: 'agente'; id: string } | { tipo: 'sesion'; sessionId: string; cwd: string; proveedor?: Proveedor } | null;
/** Con qué se crea el próximo agente; se recuerda entre sesiones */
export type Borrador = { proveedor: Proveedor; modelo: string; esfuerzo: string; modo: PermissionMode; cwd: string };
export type Panel = 'indice' | 'visor' | null;

function leerLocal<T>(clave: string, defecto: T): T { try { const v = localStorage.getItem(clave); return v ? { ...defecto, ...JSON.parse(v) } as T : defecto; } catch { return defecto; } }
export function guardarLocal(clave: string, valor: unknown) { try { localStorage.setItem(clave, JSON.stringify(valor)); } catch {} }
export type Documento = { bloques: Bloque[]; soloLectura: boolean };

export const estado = {
  conectado: false,
  rechazado: false,                       // el servidor no aceptó el token
  agentes: [] as ResumenAgente[],
  documentos: new Map<string, Documento>(),
  historial: [] as Sesion[],
  catalogo: [] as InfoProveedor[],
  /** Límites de uso de cada proveedor (abajo en la barra); `pidiendoLimites`: desde cuándo se están pidiendo */
  limites: null as { limites: Limite[]; fecha: number } | null,
  pidiendoLimites: 0,
  comandos: new Map<string, Comando[]>(),
  vista: null as Vista,
  errores: [] as { id: number; texto: string; nivel: 'error' | 'info' }[],
  /** Qué título se está renombrando: `agente:<id>` o `sesion:<sessionId>` */
  editando: null as string | null,
  grupos: { carpetas: [], sesiones: {} } as Grupos,
  borrador: leerLocal<Borrador>('lyra-borrador', { proveedor: 'claude', modelo: '', esfuerzo: '', modo: 'default', cwd: '' }),
  /** Panel de la derecha: índice, visor de archivos o cerrado */
  panel: leerLocal<{ v: Panel }>('lyra-panel', { v: 'indice' }).v,
  /** Lo que muestra el visor (`vez` cambia al pedir el mismo archivo otra vez) */
  visor: null as { ruta: string; cwd: string; vez: number } | null,
  /** Respuesta a «Abrir con…»: las apps que pueden abrir ese archivo */
  apps: null as { ruta: string; apps: { id: string; nombre: string; predeterminada?: boolean }[] } | null,
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

/** Lee un archivo para el visor (el servidor comprueba el token y la ruta) */
export async function leerArchivo(ruta: string, cwd: string, como?: 'pdf'): Promise<{ tipo: string; datos: Blob; ruta: string }> {
  const r = await fetch(`/api/archivo?ruta=${encodeURIComponent(ruta)}&cwd=${encodeURIComponent(cwd)}${como ? '&como=' + como : ''}`, { headers: { 'X-Lyra-Token': token }, cache: 'no-store' });
  if (!r.ok) throw new Error((await r.text()) || 'No se pudo leer el archivo.');
  return { tipo: r.headers.get('Content-Type') || '', datos: await r.blob(), ruta: decodeURIComponent(r.headers.get('X-Ruta') || '') || ruta };
}

/** Videos y audio: el reproductor no manda cabeceras, el token va en la dirección (solo a este servidor) */
export const urlMedio = (ruta: string, cwd: string) => `/api/medio?ruta=${encodeURIComponent(ruta)}&cwd=${encodeURIComponent(cwd)}&t=${token}`;

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

/** Claude y Gemini van a la papelera del escritorio; Codex se archiva. Nunca es definitivo. */
export function borrar(o: Objetivo) { enviar({ t: 'borrar', proveedor: o.proveedor, sessionId: o.sessionId, agente: o.agente }); }
/** Borra todas las conversaciones de una carpeta del historial (van a la papelera o se archivan) */
export function borrarVarias(sesiones: { proveedor: Proveedor; sessionId: string }[]) {
  if (sesiones.length) enviar({ t: 'borrarVarias', sesiones: sesiones.map(s => ({ proveedor: s.proveedor, sessionId: s.sessionId })) });
}

export function cambiarBorrador(cambios: Partial<Borrador>) {
  estado.borrador = { ...estado.borrador, ...cambios };
  guardarLocal('lyra-borrador', estado.borrador);
  avisar();
}

export function abrirPanel(p: Panel) {
  estado.panel = p;
  guardarLocal('lyra-panel', { v: p });
  avisar();
}
/** Muestra un archivo en el visor (la ruta puede ser relativa a la carpeta del agente) */
export function ver(ruta: string, cwd: string) {
  estado.visor = { ruta, cwd, vez: (estado.visor?.vez || 0) + 1 };
  abrirPanel('visor');
}

// Carpetas propias: se manda el estado entero y el servidor lo guarda y lo reparte
function grupos(g: Grupos) { estado.grupos = g; avisar(); enviar({ t: 'guardarGrupos', grupos: g }); }
export function crearCarpeta(nombre: string): string {
  const id = Math.random().toString(36).slice(2, 10);
  grupos({ ...estado.grupos, carpetas: [...estado.grupos.carpetas, { id, nombre: nombre.trim() || 'Carpeta', abierta: true }] });
  return id;
}
export function renombrarCarpeta(id: string, nombre: string) {
  estado.editando = null;
  if (nombre.trim()) grupos({ ...estado.grupos, carpetas: estado.grupos.carpetas.map(c => c.id === id ? { ...c, nombre: nombre.trim() } : c) });
  else avisar();
}
export function alternarCarpeta(id: string) {
  grupos({ ...estado.grupos, carpetas: estado.grupos.carpetas.map(c => c.id === id ? { ...c, abierta: !c.abierta } : c) });
}
/** Las conversaciones de la carpeta no se borran: vuelven a la lista general */
export function borrarCarpeta(id: string) {
  grupos({ carpetas: estado.grupos.carpetas.filter(c => c.id !== id), sesiones: Object.fromEntries(Object.entries(estado.grupos.sesiones).filter(([, c]) => c !== id)) });
}
export function moverSesion(sessionId: string, carpeta: string | null) {
  const sesiones = { ...estado.grupos.sesiones };
  if (carpeta) sesiones[sessionId] = carpeta; else delete sesiones[sessionId];
  grupos({ carpetas: estado.grupos.carpetas.map(c => c.id === carpeta ? { ...c, abierta: true } : c), sesiones });
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
    case 'limites': estado.limites = { limites: m.limites, fecha: m.fecha }; estado.pidiendoLimites = 0; break;
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
    case 'grupos': estado.grupos = m.grupos; break;
    case 'aplicaciones': estado.apps = { ruta: m.ruta, apps: m.apps }; break;
    case 'enfocar': if (estado.agentes.some(a => a.id === m.agente)) elegir({ tipo: 'agente', id: m.agente }); break;
  }
  avisar();
}

function conectar() {
  if (!token) { estado.rechazado = true; avisar(); return; }
  const s = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?t=${encodeURIComponent(token)}`);
  ws = s;
  s.onopen = () => { estado.conectado = true; espera = 1000; s.send(JSON.stringify({ t: 'hola' })); pedirLimites(); avisarFoco(); avisar(); };
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
/** Los límites se piden al abrir, cada 5 min con la ventana a la vista y al volver a ella si pasaron 2 min */
export function pedirLimites(fresco = false) {
  if (ws?.readyState !== WebSocket.OPEN) return;
  estado.pidiendoLimites = Date.now(); avisar();
  ws.send(JSON.stringify({ t: 'limites', fresco }));
}
const limitesViejos = (ms: number) => Date.now() - estado.pidiendoLimites > 60_000 && (!estado.limites || Date.now() - estado.limites.fecha > ms);
setInterval(() => { if (document.visibilityState === 'visible' && limitesViejos(5 * 60_000)) pedirLimites(); }, 60_000);
window.addEventListener('focus', () => { if (limitesViejos(2 * 60_000)) pedirLimites(); });

// El servidor considera «visible» solo si lo oyó hace menos de 2 s: latido cada segundo
setInterval(avisarFoco, 1000);
for (const ev of ['visibilitychange', 'focus', 'blur']) (ev === 'visibilitychange' ? document : window).addEventListener(ev, () => {
  avisarFoco();
  const v = estado.vista;
  if (ev !== 'blur' && v?.tipo === 'agente' && estado.agentes.find(a => a.id === v.id)?.sinLeer) enviar({ t: 'leer', agente: v.id });
});

conectar();
