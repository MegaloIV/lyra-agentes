// Abrir la carpeta de un agente en otra app: una terminal o el gestor de archivos.
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import { resolve } from 'node:path';
import { instalado } from './motor.ts';

/** El entorno de una app abierta desde el escritorio: el shell de inicio del usuario y nada de la terminal
 *  desde la que se lanzó el servidor (si no, kitty abre ese shell y no el tuyo, con sus variables). */
export function entornoLimpio(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (/^(KITTY_|WEZTERM_|ALACRITTY_|GHOSTTY_|KONSOLE_|VTE_|TERM_PROGRAM|STARSHIP_SESSION_KEY$|STARSHIP_SHELL$|P9K_|POWERLEVEL9K_|ZDOTDIR$|SHLVL$|OLDPWD$|PWD$|TERM$|TERMINFO$|COLORTERM$|CLAUDE|AI_AGENT$)/.test(k)) continue;
    env[k] = v;
  }
  let shell = '';
  try { shell = userInfo().shell || ''; } catch {}
  if (shell) env.SHELL = shell;
  return env;
}

const TERMINALES = ['kitty', 'ghostty', 'wezterm', 'alacritty', 'foot', 'konsole', 'gnome-terminal', 'xfce4-terminal', 'xterm'];
/** LYRA_AGENTES_TERMINAL, después $TERMINAL y si no la primera instalada */
function terminal(): string {
  for (const t of [process.env.LYRA_AGENTES_TERMINAL, process.env.TERMINAL]) if (t && instalado(t)) return t;
  const t = TERMINALES.find(instalado);
  if (!t) throw new Error('No encontré una terminal. Define LYRA_AGENTES_TERMINAL.');
  return t;
}
/** Abre la terminal en una carpeta, con un comando opcional */
function abrirTerminal(cwd: string, comando: string[] = []) {
  const t = terminal();
  if (!comando.length) return lanzar(t, t === 'kitty' ? ['--directory', cwd] : [], cwd);
  const args = t === 'kitty' || t === 'foot' ? comando : t === 'gnome-terminal' ? ['--', ...comando] : ['-e', ...comando];
  lanzar(t, args, cwd);
}

function lanzar(comando: string, args: string[], cwd: string) {
  const p = spawn(comando, args, { cwd, detached: true, stdio: 'ignore', env: entornoLimpio() });
  p.on('error', () => {});
  p.unref();
}

export async function abrirCon(con: 'terminal' | 'carpeta' | 'loginGemini', ruta?: string) {
  const cwd = ruta ? resolve(ruta.startsWith('~/') ? homedir() + ruta.slice(1) : ruta) : homedir();
  if (!(await stat(cwd).catch(() => null))?.isDirectory()) throw new Error('Esa carpeta ya no existe.');
  switch (con) {
    case 'terminal': return abrirTerminal(cwd);
    case 'carpeta': return lanzar('xdg-open', [cwd], cwd);
    case 'loginGemini':
      // Gemini CLI interactivo: la primera vez pregunta cómo iniciar sesión (elegir «Sign in with Google»)
      return abrirTerminal(homedir(), ['gemini']);
  }
}

/** Abre un archivo con la app que le corresponde (la misma comprobación que el visor) */
export async function abrirArchivo(ruta: string, cwd?: string, app?: string) {
  const { ubicar } = await import('./archivos.ts');
  const { real } = await ubicar(ruta, cwd);
  if (app) { const { abrirConApp } = await import('./aplicaciones.ts'); return abrirConApp(real, app); }
  lanzar('xdg-open', [real], homedir());
}

export async function aplicaciones(ruta: string, cwd?: string) {
  const { ubicar } = await import('./archivos.ts');
  const { aplicacionesPara } = await import('./aplicaciones.ts');
  const { real } = await ubicar(ruta, cwd);
  return aplicacionesPara(real);
}
