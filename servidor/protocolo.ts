import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
export type { PermissionMode };
export type Proveedor = 'claude' | 'codex' | 'gemini';
/** Detalle listo para dibujar (Codex y Gemini lo mandan armado) y texto del botón «Permitir siempre» */
export type Solicitud = { id: string; agente: string; herramienta: string; entrada: Record<string, unknown>; titulo?: string; descripcion?: string; nombreCorto?: string; motivo?: string; rutaBloqueada?: string; haySugerencias: boolean; detalle?: Detalle; etiquetaSiempre?: string };
export type Detalle = { clase: 'codigo'; lenguaje?: string; texto: string } | { clase: 'diff'; ruta: string; lineas: { tipo: '+' | '-' | ' '; texto: string }[] } | { clase: 'md'; texto: string };
export type Bloque =
  | { tipo: 'usuario'; id: string; md: string; fecha: number; enCola?: boolean }
  | { tipo: 'texto'; id: string; md: string; enCurso: boolean; padre?: string }
  | { tipo: 'pensamiento'; id: string; md: string }
  | { tipo: 'herramienta'; id: string; nombre: string; resumen: string; icono: string; estado: 'corriendo' | 'ok' | 'error'; entrada: unknown; detalle?: Detalle; padre?: string }
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
export type ClienteMensaje =
  | { t: 'hola' | 'historial' | 'elegirCarpeta' }
  | { t: 'crear'; cwd: string; proveedor?: Proveedor; modelo?: string; esfuerzo?: string; modo?: PermissionMode; prompt?: string }
  | { t: 'enviar'; agente: string; texto: string }
  | { t: 'interrumpir' | 'cerrar' | 'leer' | 'comandos'; agente: string }
  | { t: 'responder'; agente: string; solicitud: string; decision: 'permitir' | 'siempre' | 'rechazar'; mensaje?: string; respuestas?: Record<string, string> }
  | { t: 'modo'; agente: string; modo: PermissionMode }
  | { t: 'modelo'; agente: string; modelo: string | null }
  | { t: 'esfuerzo'; agente: string; esfuerzo: string | null }
  | { t: 'catalogo' }
  | { t: 'abrir'; con: 'antigravity' | 'terminal' | 'carpeta' | 'loginGemini'; cwd?: string }
  | { t: 'abrirSesion'; sessionId: string; cwd: string; proveedor?: Proveedor }
  | { t: 'reanudar'; sessionId: string; cwd: string; proveedor?: Proveedor; texto?: string }
  | { t: 'foco'; visible: boolean }
  /** Con `agente`, el agente abierto (se cierra antes); si no, una del historial */
  | { t: 'borrar'; proveedor: Proveedor; sessionId?: string; agente?: string }
  | { t: 'renombrar'; proveedor: Proveedor; sessionId?: string; agente?: string; cwd?: string; titulo: string };
export type ServidorMensaje =
  | { t: 'agentes'; agentes: ResumenAgente[] }
  | { t: 'documento'; agente: string; bloques: Bloque[]; soloLectura?: boolean }
  | { t: 'ops'; agente: string; ops: Op[] }
  | { t: 'historial'; sesiones: Sesion[] }
  | { t: 'comandos'; agente: string; comandos: Comando[] }
  | { t: 'carpeta'; ruta: string | null }
  | { t: 'catalogo'; proveedores: InfoProveedor[] }
  | { t: 'error'; texto: string }
  | { t: 'aviso'; texto: string }
  | { t: 'borrada'; sessionId?: string; agente?: string }
  | { t: 'enfocar'; agente: string };
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
