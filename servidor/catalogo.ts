// Qué proveedores hay, sus modelos y sus modos. Los modelos de Claude se piden una vez y se guardan.
import type { InfoProveedor, Modelo } from './protocolo.ts';
import { conEsfuerzoClaude, modelosClaude } from './claude.ts';
import { infoCodex } from './codex.ts';
import { infoLocal } from './local.ts';

export const MODOS_CLAUDE: InfoProveedor['modos'] = [
  { valor: 'default', nombre: 'Preguntar' },
  { valor: 'acceptEdits', nombre: 'Aceptar ediciones' },
  { valor: 'plan', nombre: 'Planificar' },
  { valor: 'auto', nombre: 'Automático' },
  { valor: 'bypassPermissions', nombre: 'Sin preguntar' },
];

/** Si Claude Code no responde a tiempo */
const RESPALDO_CLAUDE: Modelo[] = [
  { valor: null, nombre: 'Predeterminado' },
  { valor: 'opus', nombre: 'Opus', esfuerzos: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { valor: 'sonnet', nombre: 'Sonnet', esfuerzos: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { valor: 'haiku', nombre: 'Haiku' },
];

let claude: Modelo[] | undefined, pidiendo: Promise<Modelo[]> | undefined;
async function modelos(): Promise<Modelo[]> {
  if (claude) return conEsfuerzoClaude(claude);
  pidiendo ??= modelosClaude().then(l => (claude = l.length ? l : RESPALDO_CLAUDE)).catch(() => RESPALDO_CLAUDE).finally(() => { pidiendo = undefined; });
  return pidiendo;
}

let ultimo: InfoProveedor[] | undefined, armando: Promise<InfoProveedor[]> | undefined;
export async function catalogo(fresco = false): Promise<InfoProveedor[]> {
  if (ultimo && !fresco) return ultimo;
  armando ??= Promise.all([
    modelos().then(m => ({ id: 'claude' as const, nombre: 'Claude', instalado: true, sesion: true, modelos: m, modos: MODOS_CLAUDE })),
    infoCodex(),
    infoLocal().catch(() => ({ id: 'local' as const, nombre: 'Local', instalado: false, sesion: false, modelos: [], modos: [] })),
  ]).then(l => (ultimo = l)).finally(() => { armando = undefined; });
  return armando;
}
