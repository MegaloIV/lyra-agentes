import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { crearNormalizador, limpiarUsuario, textoError } from '../servidor/normalizar.ts';
import { aplicarOps, type Bloque } from '../servidor/protocolo.ts';

const sdk = (m: unknown) => m as SDKMessage;
const base = { session_id: 's1', parent_tool_use_id: null };

test('secuencia completa: deltas, texto final, Read, Edit, subagente y result', () => {
  const n = crearNormalizador('/proy');
  let bloques: Bloque[] = [];
  const paso = (m: unknown) => { bloques = aplicarOps(bloques, n.procesar(sdk(m))); };

  paso({ ...base, type: 'user', uuid: 'u1', message: { role: 'user', content: 'Arregla el error' } });
  paso({ ...base, type: 'stream_event', uuid: 'e1', event: { type: 'message_start', message: { id: 'msg_1' } } });
  paso({ ...base, type: 'stream_event', uuid: 'e2', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Voy a ' } } });
  paso({ ...base, type: 'stream_event', uuid: 'e3', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'revisar.' } } });
  const enCurso = bloques.find(b => b.tipo === 'texto');
  assert.equal(enCurso?.tipo === 'texto' && enCurso.enCurso, true);
  paso({ ...base, type: 'assistant', uuid: 'a1', message: { id: 'msg_1', content: [{ type: 'text', text: 'Voy a revisar.' }] } });
  paso({ ...base, type: 'assistant', uuid: 'a2', message: { id: 'msg_1', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/proy/src/app.ts', offset: 10, limit: 5 } }] } });
  paso({ ...base, type: 'user', uuid: 'u2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'const x = 1;' }] } });
  paso({ ...base, type: 'assistant', uuid: 'a3', message: { id: 'msg_2', content: [{ type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: '/proy/src/app.ts', old_string: 'const x = 1;', new_string: 'const x = 2;' } }] } });
  paso({ ...base, type: 'user', uuid: 'u3', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok' }] } });
  paso({ ...base, type: 'assistant', uuid: 'a4', message: { id: 'msg_3', content: [{ type: 'tool_use', id: 't3', name: 'Agent', input: { description: 'Buscar usos', prompt: 'Busca usos de x' } }] } });
  paso({ ...base, type: 'assistant', uuid: 'a5', parent_tool_use_id: 't3', message: { id: 'msg_4', content: [{ type: 'tool_use', id: 't4', name: 'Grep', input: { pattern: 'x', path: '/proy/src' } }] } });
  paso({ ...base, type: 'result', uuid: 'r1', subtype: 'success', duration_ms: 1500, total_cost_usd: 0.1, num_turns: 3, is_error: false, result: 'listo' });

  const textos = bloques.filter(b => b.tipo === 'texto');
  assert.equal(textos.length, 1, 'el texto no se duplica');
  assert.deepEqual(textos[0] && { md: textos[0].md, enCurso: textos[0].enCurso }, { md: 'Voy a revisar.', enCurso: false });

  const usuarios = bloques.filter(b => b.tipo === 'usuario');
  assert.equal(usuarios.length, 1, 'los tool_result no son mensajes del usuario');

  const read = bloques.find(b => b.id === 't1');
  assert.ok(read?.tipo === 'herramienta');
  assert.equal(read.resumen, 'Leyó `src/app.ts` (líneas 10–14)');
  assert.equal(read.estado, 'ok');
  assert.deepEqual(read.detalle, { clase: 'codigo', lenguaje: undefined, texto: 'const x = 1;' });

  const edit = bloques.find(b => b.id === 't2');
  assert.ok(edit?.tipo === 'herramienta' && edit.detalle?.clase === 'diff');
  assert.deepEqual(edit.detalle.lineas, [{ tipo: '-', texto: 'const x = 1;' }, { tipo: '+', texto: 'const x = 2;' }]);

  const grep = bloques.find(b => b.id === 't4');
  assert.ok(grep?.tipo === 'herramienta');
  assert.equal(grep.padre, 't3', 'el trabajo del subagente queda anidado');

  const fin = bloques.at(-1);
  assert.deepEqual(fin && fin.tipo === 'fin' && { d: fin.duracionMs, e: fin.error }, { d: 1500, e: undefined });
});

test('un error de herramienta marca el bloque y recorta la salida', () => {
  const n = crearNormalizador();
  let bloques: Bloque[] = [];
  const paso = (m: unknown) => { bloques = aplicarOps(bloques, n.procesar(sdk(m))); };
  paso({ ...base, type: 'assistant', uuid: 'a1', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'false' } }] } });
  paso({ ...base, type: 'user', uuid: 'u1', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'x'.repeat(25000) }] } });
  const b = bloques[0];
  assert.ok(b?.tipo === 'herramienta' && b.detalle?.clase === 'codigo');
  assert.equal(b.estado, 'error');
  assert.ok(b.detalle.texto.endsWith('… (recortado)') && b.detalle.texto.length < 20100);
});

test('los mensajes repetidos (mismo uuid) no se duplican', () => {
  const n = crearNormalizador();
  const m = sdk({ ...base, type: 'user', uuid: 'u1', message: { content: 'hola' } });
  assert.equal(n.procesar(m).length, 1);
  assert.equal(n.procesar(m).length, 0);
});

test('TodoWrite arma un único bloque de tareas por turno', () => {
  const n = crearNormalizador();
  let bloques: Bloque[] = [];
  const paso = (m: unknown) => { bloques = aplicarOps(bloques, n.procesar(sdk(m))); };
  const todos = (estado: string) => ({ todos: [{ content: 'Leer', status: 'completed' }, { content: 'Escribir', status: estado }] });
  paso({ ...base, type: 'assistant', uuid: 'a1', message: { content: [{ type: 'tool_use', id: 't1', name: 'TodoWrite', input: todos('pending') }] } });
  paso({ ...base, type: 'assistant', uuid: 'a2', message: { content: [{ type: 'tool_use', id: 't2', name: 'TodoWrite', input: todos('in_progress') }] } });
  const tareas = bloques.filter(b => b.tipo === 'tareas');
  assert.equal(tareas.length, 1);
  assert.deepEqual(tareas[0]?.tipo === 'tareas' && tareas[0].items.map(i => i.estado), ['hecha', 'en_curso']);
});

test('limpiarUsuario quita lo que agrega Claude Code', () => {
  assert.deepEqual(limpiarUsuario('<task-notification>x</task-notification>'), { tipo: 'nada', texto: '' });
  assert.deepEqual(limpiarUsuario('Hola<system-reminder>ruido</system-reminder>'), { tipo: 'usuario', texto: 'Hola' });
  assert.deepEqual(limpiarUsuario('<command-name>/compact</command-name><command-args></command-args>'), { tipo: 'usuario', texto: '`/compact`' });
  assert.equal(limpiarUsuario('This session is being continued from a previous conversation that ran out of context.').tipo, 'resumen');
});

test('textoError oculta el diagnóstico interno', () => {
  assert.equal(textoError(['[ede_diagnostic] result_type=user']), 'Se detuvo antes de terminar.');
  assert.equal(textoError(['Falló la red']), 'Falló la red');
});

test('shell en segundo plano: queda viva, recibe salida y termina con el aviso', () => {
  const n = crearNormalizador('/proy');
  let bloques: Bloque[] = [];
  const paso = (m: unknown) => { bloques = aplicarOps(bloques, n.procesar(sdk(m))); };
  const terminal = () => { const b = bloques.find(x => x.id === 't1'); return b?.tipo === 'herramienta' ? b : undefined; };
  paso({ ...base, type: 'assistant', uuid: 'a1', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm run dev', description: 'Servidor', run_in_background: true } }] } });
  paso({ ...base, type: 'user', uuid: 'u1', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Command running in background with ID: b7x. Output is being written to: /tmp/c/tasks/b7x.output. You will be notified when it completes.' }] } });
  assert.equal(terminal()?.estado, 'ok');
  assert.equal(terminal()?.terminal?.fondo, 'corriendo');
  assert.equal(terminal()?.terminal?.tarea, 'b7x');
  assert.equal(terminal()?.terminal?.archivo, '/tmp/c/tasks/b7x.output');
  assert.equal(terminal()?.terminal?.salida, '', 'el aviso de Claude no es la salida del comando');
  assert.deepEqual(n.fondosVivos(), [{ id: 't1', archivo: '/tmp/c/tasks/b7x.output' }]);
  bloques = aplicarOps(bloques, n.ponerSalida('t1', 'listo en :5173'));
  assert.equal(terminal()?.terminal?.salida, 'listo en :5173');
  // El aviso del SDK y el mismo como mensaje: cuenta una sola vez
  paso({ ...base, type: 'system', subtype: 'task_notification', uuid: 's1', task_id: 'b7x', tool_use_id: 't1', status: 'failed', output_file: '/tmp/c/tasks/b7x.output', summary: 'Background command "Servidor" failed with exit code 1' });
  paso({ ...base, type: 'user', uuid: 'u2', message: { content: '<task-notification>\n<task-id>b7x</task-id>\n<status>completed</status>\n<summary>x</summary>\n</task-notification>' } });
  assert.equal(terminal()?.terminal?.fondo, 'fallido');
  assert.equal(terminal()?.terminal?.codigo, 1);
  assert.equal(terminal()?.estado, 'error');
  assert.equal(terminal()?.terminal?.salida, 'listo en :5173', 'la salida leída se mantiene');
  assert.deepEqual(n.fondosVivos(), []);
  assert.equal(bloques.filter(b => b.tipo === 'usuario').length, 0, 'el aviso no es un mensaje del usuario');
});

test('shell en segundo plano en el historial y al cerrarse el proceso', () => {
  const n = crearNormalizador('/proy');
  let bloques: Bloque[] = [];
  const paso = (m: unknown) => { bloques = aplicarOps(bloques, n.procesar(sdk(m))); };
  const fondo = (id: string) => { const b = bloques.find(x => x.id === id); return b?.tipo === 'herramienta' ? b.terminal?.fondo : undefined; };
  for (const id of ['t1', 't2', 't3']) {
    paso({ ...base, type: 'assistant', uuid: `a${id}`, message: { id: `m${id}`, content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'sleep 99', run_in_background: true } }] } });
    paso({ ...base, type: 'user', uuid: `u${id}`, message: { content: [{ type: 'tool_result', tool_use_id: id, content: `Command running in background with ID: k${id}. Output is being written to: /tmp/c/tasks/k${id}.output.` }] } });
  }
  // Dentro de un recordatorio, como lo guarda Claude Code
  paso({ ...base, type: 'user', uuid: 'r1', message: { content: [{ type: 'text', text: '<system-reminder>\n<task-notification>\n<task-id>kt1</task-id>\n<tool-use-id>t1</tool-use-id>\n<status>completed</status>\n<summary>Background command "x" completed (exit code 0)</summary>\n</task-notification>\n</system-reminder>' }] } });
  assert.equal(fondo('t1'), 'terminado');
  // Ya no está entre las vivas: terminó aunque no llegue su aviso
  paso({ ...base, type: 'system', subtype: 'background_tasks_changed', uuid: 'l1', tasks: [{ task_id: 'kt3', task_type: 'local_bash', description: 'x' }] });
  assert.equal(fondo('t2'), 'terminado');
  assert.equal(fondo('t3'), 'corriendo');
  bloques = aplicarOps(bloques, n.cerrarFondos());
  assert.equal(fondo('t3'), 'detenido');
  assert.equal(fondo('t1'), 'terminado');
});

test('un Bash normal no queda en segundo plano', () => {
  const n = crearNormalizador('/proy');
  let bloques: Bloque[] = [];
  const paso = (m: unknown) => { bloques = aplicarOps(bloques, n.procesar(sdk(m))); };
  paso({ ...base, type: 'assistant', uuid: 'a1', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } });
  paso({ ...base, type: 'user', uuid: 'u1', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a.txt' }] } });
  const b = bloques.find(x => x.id === 't1');
  assert.equal(b?.tipo === 'herramienta' && b.terminal?.fondo, undefined);
  assert.equal(b?.tipo === 'herramienta' && b.terminal?.salida, 'a.txt');
});

test('una salida que menciona el aviso no es una shell de fondo', () => {
  const n = crearNormalizador('/proy');
  let bloques: Bloque[] = [];
  const paso = (m: unknown) => { bloques = aplicarOps(bloques, n.procesar(sdk(m))); };
  paso({ ...base, type: 'assistant', uuid: 'a1', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'grep -o background log' } }] } });
  paso({ ...base, type: 'user', uuid: 'u1', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'running in background with ID: bq1. Output is being written to: /tmp/x.output' }] } });
  const b = bloques.find(x => x.id === 't1');
  assert.equal(b?.tipo === 'herramienta' && b.terminal?.fondo, undefined);
});
