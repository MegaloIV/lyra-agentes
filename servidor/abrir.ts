// Abrir la carpeta de un agente en otra app: una terminal o el gestor de archivos (también en un escritorio vacío).
import { execFile, spawn } from 'node:child_process';
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
/** Abre la terminal en una carpeta, con un comando opcional. En Hyprland sale flotando en el medio de la pantalla
 *  (solo la que abre Lyra: las demás siguen en mosaico) */
async function abrirTerminal(cwd: string, comando: string[] = []) {
  const t = terminal();
  const args = !comando.length ? (t === 'kitty' ? ['--directory', cwd] : []) : t === 'kitty' || t === 'foot' ? comando : t === 'gnome-terminal' ? ['--', ...comando] : ['-e', ...comando];
  if (hyprland() && await flotando(t, args, cwd)) return;
  lanzar(t, args, cwd);
}

const hyprland = () => !!process.env.HYPRLAND_INSTANCE_SIGNATURE && instalado('hyprctl');
/** 'a b' → «'a b'» para la línea de comandos que ejecuta Hyprland */
const comillas = (x: string) => /^[\w@%+=:,./-]+$/.test(x) ? x : `'${x.replace(/'/g, `'\\''`)}'`;
/** Lanza por Hyprland con reglas de ventana (flotante, 62 × 70 % de la pantalla, centrada), sin pasar por mosaico */
async function flotando(cmd: string, args: string[], cwd: string): Promise<boolean> {
  const linea = `cd ${comillas(cwd)} && exec ${[cmd, ...args].map(comillas).join(' ')}`;
  const orden = `hl.dsp.exec_cmd(${JSON.stringify(linea)}, { float = true, size = "(monitor_w*0.62) (monitor_h*0.7)", center = true })`;
  return (await salida('hyprctl', ['dispatch', orden])).trim() === 'ok';
}

function lanzar(comando: string, args: string[], cwd: string) {
  const p = spawn(comando, args, { cwd, detached: true, stdio: 'ignore', env: entornoLimpio() });
  p.on('error', () => {});
  p.unref();
}

const salida = (cmd: string, args: string[]) => new Promise<string>(ok => execFile(cmd, args, { timeout: 3000 }, (e, o) => ok(e ? '' : String(o))));
/** Gestores de archivos que saben abrir una ventana nueva aunque ya estén abiertos (si no, xdg-open abre una pestaña) */
const VENTANA_NUEVA: Record<string, string[]> = {
  'org.kde.dolphin.desktop': ['dolphin', '--new-window'], 'org.gnome.Nautilus.desktop': ['nautilus', '--new-window'],
  'thunar.desktop': ['thunar'], 'nemo.desktop': ['nemo'], 'pcmanfm-qt.desktop': ['pcmanfm-qt'], 'caja-folder-handler.desktop': ['caja'],
};
const ventanas = async () => { try { return JSON.parse(await salida('hyprctl', ['clients', '-j'])) as { address: string }[]; } catch { return []; } };

/** El gestor de archivos en una ventana nueva y, en Hyprland, en un escritorio vacío (y te lleva ahí) */
async function carpetaAparte(cwd: string) {
  const predeterminado = (await salida('xdg-mime', ['query', 'default', 'inode/directory'])).trim();
  const [cmd, ...args] = VENTANA_NUEVA[predeterminado] || ['xdg-open'];
  const hypr = hyprland();
  const antes = new Set(hypr ? (await ventanas()).map(v => v.address) : []);
  lanzar(cmd!, [...args, cwd], cwd);
  if (!hypr) return;
  // Se espera la ventana nueva (hasta 6 s) y se la manda a un escritorio vacío; la orden usa la sintaxis Lua de Hyprland 0.5x
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    const nueva = (await ventanas()).find(v => !antes.has(v.address));
    if (nueva && /^0x[0-9a-f]+$/i.test(nueva.address)) {
      await salida('hyprctl', ['dispatch', `hl.dsp.window.move({workspace = "empty", follow = true, window = "address:${nueva.address}"})`]);
      return;
    }
  }
}

export async function abrirCon(con: 'terminal' | 'carpeta' | 'carpetaAparte', ruta?: string) {
  const cwd = ruta ? resolve(ruta.startsWith('~/') ? homedir() + ruta.slice(1) : ruta) : homedir();
  if (!(await stat(cwd).catch(() => null))?.isDirectory()) throw new Error('Esa carpeta ya no existe.');
  switch (con) {
    case 'terminal': return abrirTerminal(cwd);
    case 'carpeta': return lanzar('xdg-open', [cwd], cwd);
    case 'carpetaAparte': void carpetaAparte(cwd).catch(() => {}); return;
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
