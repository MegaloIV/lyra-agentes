import type { ClienteMensaje, PermissionMode } from './protocolo.ts';
import { objeto } from './resumenes.ts';
export const modos: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'];
export function validarMensaje(valor: unknown): ClienteMensaje {
  const m = objeto(valor), texto = (k: string, opcional = false) => opcional && m[k] === undefined || typeof m[k] === 'string' && (m[k] as string).length <= 200000;
  let valido = false;
  switch (m.t) {
    case 'hola': case 'historial': case 'elegirCarpeta': valido = true; break;
    case 'foco': valido = typeof m.visible === 'boolean'; break;
    case 'crear': valido = texto('cwd') && !!m.cwd && texto('modelo', true) && texto('prompt', true) && (m.modo === undefined || modos.includes(m.modo as PermissionMode)); break;
    case 'abrirSesion': case 'reanudar': valido = texto('sessionId') && !!m.sessionId && texto('cwd') && !!m.cwd && texto('texto', true); break;
    case 'enviar': valido = texto('agente') && texto('texto'); break;
    case 'interrumpir': case 'cerrar': case 'leer': case 'comandos': valido = texto('agente'); break;
    case 'modelo': valido = texto('agente') && (m.modelo === null || texto('modelo')); break;
    case 'modo': valido = texto('agente') && modos.includes(m.modo as PermissionMode); break;
    case 'responder': valido = texto('agente') && texto('solicitud') && ['permitir', 'siempre', 'rechazar'].includes(String(m.decision)) && texto('mensaje', true) && (m.respuestas === undefined || m.respuestas !== null && typeof m.respuestas === 'object' && !Array.isArray(m.respuestas) && Object.values(m.respuestas).every(v => typeof v === 'string')); break;
  }
  if (!valido) throw new Error('El mensaje recibido no es válido.');
  return m as ClienteMensaje;
}
