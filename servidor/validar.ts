import type { ClienteMensaje, PermissionMode } from './protocolo.ts';
import { objeto } from './resumenes.ts';
export const modos: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'];
const proveedores = ['claude', 'codex', 'gemini', 'local'];
const proveedorValido = (v: unknown) => v === undefined || proveedores.includes(String(v));
export function validarMensaje(valor: unknown): ClienteMensaje {
  const m = objeto(valor), texto = (k: string, opcional = false) => opcional && m[k] === undefined || typeof m[k] === 'string' && (m[k] as string).length <= 200000;
  let valido = false;
  switch (m.t) {
    case 'hola': case 'historial': case 'catalogo': valido = true; break;
    case 'explorar': valido = texto('ruta') && (m.ruta as string).length <= 4096; break;
    case 'limites': valido = m.fresco === undefined || typeof m.fresco === 'boolean'; break;
    case 'foco': valido = typeof m.visible === 'boolean'; break;
    case 'crear': valido = texto('cwd') && !!m.cwd && texto('modelo', true) && texto('esfuerzo', true) && texto('prompt', true) && proveedorValido(m.proveedor) && (m.modo === undefined || modos.includes(m.modo as PermissionMode)); break;
    case 'abrirSesion': case 'reanudar': valido = texto('sessionId') && !!m.sessionId && texto('cwd') && !!m.cwd && texto('texto', true) && proveedorValido(m.proveedor); break;
    case 'esfuerzo': valido = texto('agente') && (m.esfuerzo === null || texto('esfuerzo')); break;
    case 'abrir': valido = ['terminal', 'carpeta', 'carpetaAparte', 'loginGemini'].includes(String(m.con)) && texto('cwd', true); break;
    case 'abrirArchivo': valido = texto('ruta') && !!m.ruta && texto('cwd', true) && (m.app === undefined || typeof m.app === 'string' && /^[\w.+-]{1,200}\.desktop$/.test(m.app)); break;
    case 'aplicaciones': valido = texto('ruta') && !!m.ruta && texto('cwd', true); break;
    case 'borrarArchivo': valido = texto('ruta') && !!m.ruta && texto('cwd', true) && (m.id === undefined || typeof m.id === 'string' && m.id.length <= 200); break;
    case 'guardarGrupos': valido = m.grupos !== null && typeof m.grupos === 'object'; break;
    case 'enviar': valido = texto('agente') && texto('texto'); break;
    case 'interrumpir': case 'cerrar': case 'leer': case 'comandos': valido = texto('agente'); break;
    case 'modelo': valido = texto('agente') && (m.modelo === null || texto('modelo')); break;
    case 'modo': valido = texto('agente') && modos.includes(m.modo as PermissionMode); break;
    case 'borrar': valido = proveedores.includes(String(m.proveedor)) && texto('sessionId', true) && texto('agente', true) && (!!m.sessionId || !!m.agente); break;
    case 'borrarVarias': valido = Array.isArray(m.sesiones) && m.sesiones.length > 0 && m.sesiones.length <= 500
      && m.sesiones.every((x: any) => x && typeof x === 'object' && proveedores.includes(String(x.proveedor)) && typeof x.sessionId === 'string' && x.sessionId.length > 0 && x.sessionId.length <= 200); break;
    case 'renombrar': valido = proveedores.includes(String(m.proveedor)) && texto('sessionId', true) && texto('agente', true) && texto('cwd', true) && (!!m.sessionId || !!m.agente)
      && typeof m.titulo === 'string' && m.titulo.trim().length > 0 && m.titulo.length <= 200; break;
    case 'responder': valido = texto('agente') && texto('solicitud') && ['permitir', 'siempre', 'rechazar'].includes(String(m.decision)) && texto('mensaje', true) && (m.respuestas === undefined || m.respuestas !== null && typeof m.respuestas === 'object' && !Array.isArray(m.respuestas) && Object.values(m.respuestas).every(v => typeof v === 'string')); break;
  }
  if (!valido) throw new Error('El mensaje recibido no es válido.');
  return m as ClienteMensaje;
}
