import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumir, detalleHerramienta } from '../servidor/resumenes.ts';

const casos: [string, unknown, string, string][] = [
  ['Read', { file_path: '/p/a.ts' }, 'Leyó `a.ts`', 'leer'],
  ['Read', { file_path: '/p/a.ts', offset: 5, limit: 10 }, 'Leyó `a.ts` (líneas 5–14)', 'leer'],
  ['Edit', { file_path: '/p/a.ts' }, 'Editó `a.ts`', 'editar'],
  ['MultiEdit', { file_path: '/p/a.ts' }, 'Editó `a.ts`', 'editar'],
  ['Write', { file_path: '/otra/b.md' }, 'Escribió `/otra/b.md`', 'crear'],
  ['NotebookEdit', { notebook_path: '/p/n.ipynb' }, 'Editó el cuaderno `n.ipynb`', 'editar'],
  ['Bash', { command: 'ls', description: 'Lista archivos' }, 'Lista archivos', 'terminal'],
  ['Bash', { command: 'ls -la' }, 'Ejecutó `ls -la`', 'terminal'],
  ['BashOutput', {}, 'Revisó un proceso en segundo plano', 'terminal'],
  ['KillShell', {}, 'Detuvo un proceso en segundo plano', 'terminal'],
  ['Grep', { pattern: 'foo', path: '/p/src' }, 'Buscó «foo» en `src`', 'buscar'],
  ['Glob', { pattern: '**/*.ts' }, 'Buscó archivos `**/*.ts`', 'buscar'],
  ['WebSearch', { query: 'clima' }, 'Buscó en la web «clima»', 'web'],
  ['WebFetch', { url: 'https://ejemplo.com/a/b' }, 'Abrió ejemplo.com', 'web'],
  ['Agent', { description: 'Revisar' }, 'Lanzó un subagente: Revisar', 'agente'],
  ['Task', { description: 'Revisar' }, 'Lanzó un subagente: Revisar', 'agente'],
  ['TodoWrite', {}, 'Actualizó la lista de tareas', 'tareas'],
  ['Skill', { skill: 'pdf' }, 'Usó la skill pdf', 'skill'],
  ['AskUserQuestion', {}, 'Te hizo una pregunta', 'pregunta'],
  ['ExitPlanMode', {}, 'Propuso un plan', 'plan'],
  ['mcp__github__crear_issue', {}, 'Usó crear_issue (github)', 'mcp'],
  ['Rara', {}, 'Usó Rara', 'otro'],
];

for (const [nombre, entrada, resumen, icono] of casos) {
  test(`${nombre} → ${resumen}`, () => assert.deepEqual(resumir(nombre, entrada, '/p'), { resumen, icono }));
}

test('Bash recorta el comando a 80 caracteres', () => {
  assert.equal(resumir('Bash', { command: 'x'.repeat(200) }).resumen, 'Ejecutó `' + 'x'.repeat(80) + '`');
});

test('el detalle de un subagente en segundo plano no muestra metadatos internos', () => {
  const d = detalleHerramienta('Agent', { prompt: 'Busca X' }, 'Async agent launched successfully. agentId: abc');
  assert.deepEqual(d, { clase: 'md', texto: 'Busca X' });
});
