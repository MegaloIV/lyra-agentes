import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
export type { PermissionMode };
export type Proveedor = 'claude' | 'codex' | 'local';
/** Detalle listo para dibujar (Codex lo mandan armado) y texto del botón «Permitir siempre» */
export type Solicitud = { id: string; agente: string; herramienta: string; entrada: Record<string, unknown>; titulo?: string; descripcion?: string; nombreCorto?: string; motivo?: string; rutaBloqueada?: string; haySugerencias: boolean; detalle?: Detalle; etiquetaSiempre?: string };
export type Detalle = { clase: 'codigo'; lenguaje?: string; texto: string } | { clase: 'diff'; ruta: string; lineas: { tipo: '+' | '-' | ' '; texto: string }[] } | { clase: 'md'; texto: string };
/** `fondo`: la shell quedó en segundo plano (run_in_background o Ctrl+B) y sigue viva o ya terminó; `tarea` y `archivo` son su id y el archivo de su salida */
export type Fondo = 'corriendo' | 'terminado' | 'fallido' | 'detenido';
export type Terminal = { comando: string; descripcion?: string; carpeta?: string; salida?: string; codigo?: number; inicio?: number; duracionMs?: number; fondo?: Fondo; tarea?: string; archivo?: string };
export type Bloque =
  | { tipo: 'usuario'; id: string; md: string; fecha: number; enCola?: boolean }
  | { tipo: 'texto'; id: string; md: string; enCurso: boolean; padre?: string }
  | { tipo: 'pensamiento'; id: string; md: string }
  | { tipo: 'herramienta'; id: string; nombre: string; resumen: string; icono: string; estado: 'corriendo' | 'ok' | 'error'; entrada: unknown; detalle?: Detalle; terminal?: Terminal; padre?: string }
  | { tipo: 'tareas'; id: string; items: { texto: string; estado: 'pendiente' | 'en_curso' | 'hecha' }[] }
  | { tipo: 'permiso'; id: string; solicitud: Solicitud; estado: 'pendiente' | 'permitido' | 'rechazado' | 'cancelado' }
  | { tipo: 'pregunta'; id: string; solicitud: Solicitud; estado: 'pendiente' | 'respondida' | 'cancelada'; respuestas?: Record<string, string> }
  | { tipo: 'plan'; id: string; solicitud: Solicitud; md: string; estado: 'pendiente' | 'aprobado' | 'rechazado' }
  | { tipo: 'fin'; id: string; duracionMs?: number; costoUsd?: number; turnos?: number; error?: string }
  | { tipo: 'sistema'; id: string; texto: string; nivel: 'info' | 'error' };
export type Cambios = Partial<Bloque extends infer B ? B extends Bloque ? Omit<B, 'id' | 'tipo'> : never : never>;
export type Op = { op: 'agregar'; bloque: Bloque } | { op: 'actualizar'; id: string; cambios: Cambios } | { op: 'delta'; id: string; md: string };
export type ResumenAgente = { id: string; proveedor: Proveedor; sessionId?: string; titulo: string; cwd: string; estado: 'iniciando' | 'trabajando' | 'esperando' | 'listo' | 'error' | 'cerrado'; modelo?: string; esfuerzo?: string; modo: PermissionMode; sinLeer: boolean; ultimaActividad: number; contexto?: { usados: number; total: number } };
export type Sesion = { proveedor: Proveedor; sessionId: string; titulo: string; cwd: string; modificado: number; rama?: string };
export type Modelo = { valor: string | null; nombre: string; descripcion?: string; esfuerzos?: string[]; esfuerzoDefecto?: string };
/** Lo que se puede elegir de cada proveedor. `cuota`: cuánto queda (Codex) */
export type InfoProveedor = { id: Proveedor; nombre: string; instalado: boolean; sesion: boolean; modelos: Modelo[]; modos: { valor: PermissionMode; nombre: string }[]; cuota?: { usado: number; renueva?: number; agotada: boolean } };
export type Comando = { nombre: string; descripcion: string };
/** Una ventana de un límite de uso: `usado` en %, `renueva` en ms. `corta` es la de horas (5 h) y `larga` la semanal */
/** Pestaña Memorias: un archivo, un grupo (del proyecto, general u otro proyecto) y lo de cada proveedor */
export type ArchivoMemoria = { ruta: string; nombre: string; descripcion?: string; modificado: number; tamano: number };
export type GrupoMemoria = { titulo: string; alcance: 'proyecto' | 'general' | 'otro'; archivos: ArchivoMemoria[] };
export type MemoriasProveedor = { proveedor: Proveedor; grupos: GrupoMemoria[]; nota?: string };
export type Ventana = { tipo: 'corta' | 'larga'; nombre: string; usado: number; renueva?: number };
/** Cuánto le queda a cada proveedor; sin ventanas, `nota` dice por qué (sin sesión, no lo informa…) */
export type Limite = { proveedor: Proveedor; plan?: string; ventanas: Ventana[]; nota?: string };
/** Carpetas propias del usuario y en cuál está cada sesión (`sessionId` → id de carpeta) */
export type Grupos = { carpetas: { id: string; nombre: string; abierta: boolean }[]; sesiones: Record<string, string> };
/** Pestaña GitHub. `estado`: M modificado, A nuevo en el índice, D borrado, R renombrado, U en conflicto, ? sin seguimiento */
export type CambioGit = { ruta: string; estado: 'M' | 'A' | 'D' | 'R' | 'U' | '?'; preparado: boolean };
export type CommitGit = { hash: string; titulo: string; autor: string; fecha: number };
export type EstadoGit = { repo: false; nota: string }
  | { repo: true; raiz: string; rama: string; arriba?: string; adelante: number; atras: number; cambios: CambioGit[]; masCambios: number; commits: CommitGit[]; github?: string };
/** Una prueba (CI): `run`/`job` sirven para pedir su registro */
export type PruebaGit = { nombre: string; estado: 'ok' | 'error' | 'corriendo' | 'omitida'; url?: string; run?: number; job?: number };
export type InfoGithub = {
  repo?: string; rama?: string; nota?: string;
  pr?: { numero: number; titulo: string; url: string; estado: 'abierto' | 'borrador' | 'fusionado' | 'cerrado'; revision?: 'aprobado' | 'cambios' | 'pendiente'; comentarios: number; pruebas: PruebaGit[] };
  /** Sin PR: la última prueba de cada flujo en la rama */
  pruebas?: PruebaGit[];
  issues?: { numero: number; titulo: string; url: string; cuerpo: string; etiquetas: string[]; autor?: string }[];
};
/** La batería de la laptop: porcentaje y si se está cargando */
export type Bateria = { nivel: number; estado: 'cargando' | 'descargando' | 'llena' | 'enchufada' };
export type ClienteMensaje =
  | { t: 'hola' | 'historial' }
  /** Las subcarpetas de `ruta`, para el explorador del chip «carpeta» */
  | { t: 'explorar'; ruta: string }
  | { t: 'crear'; cwd: string; proveedor?: Proveedor; modelo?: string; esfuerzo?: string; modo?: PermissionMode; prompt?: string }
  | { t: 'enviar'; agente: string; texto: string }
  | { t: 'interrumpir' | 'cerrar' | 'leer' | 'comandos'; agente: string }
  | { t: 'responder'; agente: string; solicitud: string; decision: 'permitir' | 'siempre' | 'rechazar'; mensaje?: string; respuestas?: Record<string, string> }
  | { t: 'modo'; agente: string; modo: PermissionMode }
  | { t: 'modelo'; agente: string; modelo: string | null }
  | { t: 'esfuerzo'; agente: string; esfuerzo: string | null }
  | { t: 'catalogo' }
  /** Los límites de uso; `fresco` los vuelve a pedir aunque haya unos recientes */
  | { t: 'limites'; fresco?: boolean }
  | { t: 'abrir'; con: 'terminal' | 'carpeta' | 'carpetaAparte'; cwd?: string }
  /** Abre un archivo con su app (`ruta` relativa a `cwd`) */
  | { t: 'abrirArchivo'; ruta: string; cwd?: string; app?: string }
  /** Las apps que pueden abrir ese archivo (para «Abrir con…») */
  | { t: 'aplicaciones'; ruta: string; cwd?: string }
  /** Manda un archivo del visor a la papelera (`id`: el bloque que lo nombró, para dejar de listarlo) */
  | { t: 'borrarArchivo'; ruta: string; cwd?: string; id?: string }
  | { t: 'guardarGrupos'; grupos: Grupos }
  /** Pestaña GitHub: el estado de git de `cwd` y, con `red`, también lo de GitHub */
  | { t: 'git'; cwd: string; red?: boolean }
  | { t: 'memorias'; cwd: string }
  /** Guarda un .md editado en el visor (`leido`: la fecha de modificación con que se abrió, para no pisar cambios) */
  | { t: 'guardarArchivo'; ruta: string; cwd?: string; texto: string; leido?: number }
  /** El diff de un archivo (`ruta`, relativa a la raíz del repo) o de un commit */
  | { t: 'gitDiff'; cwd: string; ruta?: string; commit?: string }
  /** El registro de una prueba que falló, para ponerlo en la caja */
  | { t: 'registroPrueba'; cwd: string; run: number; job?: number }
  | { t: 'abrirSesion'; sessionId: string; cwd: string; proveedor?: Proveedor }
  | { t: 'reanudar'; sessionId: string; cwd: string; proveedor?: Proveedor; texto?: string }
  | { t: 'foco'; visible: boolean }
  /** Con `agente`, el agente abierto (se cierra antes); si no, una del historial */
  | { t: 'borrar'; proveedor: Proveedor; sessionId?: string; agente?: string }
  /** Todas las conversaciones de una carpeta de la barra, de una vez */
  | { t: 'borrarVarias'; sesiones: { proveedor: Proveedor; sessionId: string }[] }
  | { t: 'renombrar'; proveedor: Proveedor; sessionId?: string; agente?: string; cwd?: string; titulo: string };
export type ServidorMensaje =
  | { t: 'agentes'; agentes: ResumenAgente[] }
  | { t: 'documento'; agente: string; bloques: Bloque[]; soloLectura?: boolean }
  | { t: 'ops'; agente: string; ops: Op[] }
  | { t: 'historial'; sesiones: Sesion[] }
  | { t: 'comandos'; agente: string; comandos: Comando[] }
  | { t: 'explorado'; pedida: string; ruta: string; carpetas: string[]; recortado?: boolean; aviso?: string }
  | { t: 'catalogo'; proveedores: InfoProveedor[] }
  | { t: 'limites'; limites: Limite[]; fecha: number }
  | { t: 'error'; texto: string }
  | { t: 'aviso'; texto: string }
  | { t: 'borrada'; sessionId?: string; agente?: string }
  | { t: 'archivoBorrado'; ruta: string; cwd?: string; id?: string }
  | { t: 'enfocar'; agente: string }
  | { t: 'grupos'; grupos: Grupos }
  | { t: 'git'; cwd: string; git?: EstadoGit; error?: string }
  | { t: 'memorias'; cwd: string; proveedores?: MemoriasProveedor[]; error?: string }
  | { t: 'github'; cwd: string; github: InfoGithub }
  | { t: 'gitDiff'; cwd: string; clave: string; texto?: string; error?: string }
  | { t: 'registroPrueba'; cwd: string; texto: string; nombre?: string }
  | { t: 'bateria'; bateria: Bateria | null }
  | { t: 'archivoGuardado'; ruta: string; cwd?: string; error?: string; modificado?: number }
  | { t: 'aplicaciones'; ruta: string; apps: { id: string; nombre: string; predeterminada?: boolean }[] };
export function aplicarOps(bloques: Bloque[], ops: Op[]): Bloque[] {
  const salida = [...bloques];
  for (const op of ops) {
    if (op.op === 'agregar') { if (!salida.some(b => b.id === op.bloque.id)) salida.push(op.bloque); continue; }
    const i = salida.findIndex(b => b.id === op.id), b = salida[i];
    if (!b) continue;
    if (op.op === 'delta' && b.tipo === 'texto') salida[i] = { ...b, md: b.md + op.md };
    if (op.op === 'actualizar') salida[i] = { ...b, ...op.cambios } as Bloque;
  }
  return salida;
}
