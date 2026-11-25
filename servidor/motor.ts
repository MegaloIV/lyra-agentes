// Lo que comparten los tres proveedores: el agente, lo que el gestor le ofrece a cada motor y lo que cada motor sabe hacer.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { Bloque, ClienteMensaje, Comando, Op, PermissionMode, Progreso, ResumenAgente } from './protocolo.ts';

export type Respuesta = Extract<ClienteMensaje, { t: 'responder' }>;
export type Pendiente = { responder: (r?: Respuesta) => void };

export interface Motor {
  /** Arranca (o vuelve a arrancar) la sesión; los errores los informa con ctx.fallo */
  iniciar(): void;
  /** Manda un mensaje del usuario (el motor agrega el bloque al documento) */
  enviar(texto: string): void;
  interrumpir(): Promise<void>;
  modo(m: PermissionMode): Promise<void>;
  modelo(m?: string): Promise<void>;
  esfuerzo(e?: string): Promise<void>;
  comandos(): Promise<Comando[]>;
  cerrar(): void;
}

export type Agente = ResumenAgente & { bloques: Bloque[]; pendientes: Map<string, Pendiente>; cerrado: boolean; motor: Motor };

export interface Contexto {
  ops(a: Agente, ops: Op[]): void;
  estado(a: Agente, estado: Agente['estado']): void;
  fallo(a: Agente, e: unknown): void;
  barra(): void;
  /** Tokens que lleva el turno en curso y qué está haciendo (se avisa a la ventana como mucho dos veces por segundo) */
  progreso(a: Agente, tokens: number, fase?: Progreso['fase']): void;
  /** Muestra una tarjeta (permiso, pregunta o plan) y llama a `al` cuando se responde; devuelve cómo cancelarla */
  solicitar(a: Agente, bloque: Extract<Bloque, { tipo: 'permiso' | 'pregunta' | 'plan' }>, al: (r?: Respuesta) => void): () => void;
}

export function bloqueUsuario(texto: string, enCola: boolean, id: string = randomUUID()): Extract<Bloque, { tipo: 'usuario' }> {
  return { tipo: 'usuario', id, md: texto, fecha: Date.now(), enCola };
}

/** «You've hit your usage limit… try again at 2:52 PM.» → «Se acabó tu cuota de Codex. Vuelve a estar disponible a las 2:52 PM.» */
export function errorLegible(texto: string, proveedor: string): string {
  const limpio = texto.trim();
  if (/usage limit|rate limit|quota|RESOURCE_EXHAUSTED|429/i.test(limpio)) {
    const hora = /try again (?:at|in) ([^.]+)/i.exec(limpio)?.[1];
    return `Se acabó tu cuota de ${proveedor}.` + (hora ? ` Vuelve a estar disponible ${/^\d/.test(hora) ? 'a las ' : 'en '}${hora}.` : ' Prueba más tarde.');
  }
  return limpio || 'Ocurrió un error.';
}

/** Si el comando está en el PATH */
export function instalado(comando: string): boolean {
  return (process.env.PATH || '').split(':').some(d => d && existsSync(`${d}/${comando}`));
}
