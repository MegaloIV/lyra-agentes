// Abrir la carpeta de un agente en otra app: Antigravity, una terminal o el gestor de archivos.
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { instalado } from './motor.ts';

function lanzar(comando: string, args: string[], cwd: string) {
  const p = spawn(comando, args, { cwd, detached: true, stdio: 'ignore' });
  p.on('error', () => {});
  p.unref();
}

export async function abrirCon(con: 'antigravity' | 'terminal' | 'carpeta' | 'loginGemini', ruta?: string) {
  const cwd = ruta ? resolve(ruta.startsWith('~/') ? homedir() + ruta.slice(1) : ruta) : homedir();
  if (!(await stat(cwd).catch(() => null))?.isDirectory()) throw new Error('Esa carpeta ya no existe.');
  switch (con) {
    case 'antigravity':
      if (!instalado('antigravity')) throw new Error('Antigravity no está instalado.');
      return lanzar('antigravity', [cwd], cwd);
    case 'terminal': return lanzar('kitty', ['--directory', cwd], cwd);
    case 'carpeta': return lanzar('xdg-open', [cwd], cwd);
    case 'loginGemini':
      // Gemini CLI interactivo: la primera vez pregunta cómo iniciar sesión (elegir «Sign in with Google»)
      return lanzar('kitty', ['--title', 'Gemini · iniciar sesión', '--directory', homedir(), 'gemini'], homedir());
  }
}

/** Abre un archivo con la app que le corresponde (la misma comprobación que el visor) */
export async function abrirArchivo(ruta: string, cwd?: string) {
  const { leerArchivo } = await import('./archivos.ts');
  const a = await leerArchivo(ruta, cwd);
  lanzar('xdg-open', [a.ruta], homedir());
}
