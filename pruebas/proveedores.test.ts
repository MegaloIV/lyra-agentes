import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarOps, type Bloque } from '../servidor/protocolo.ts';
import { bloquesDeItem, bloquesDeHilo, comandoLimpio, lineasDiff, tareasDePlan } from '../servidor/normalizarCodex.ts';
import { crearNormalizadorGemini } from '../servidor/gemini.ts';
import { errorLegible } from '../servidor/motor.ts';

test('Codex: el comando sale sin el envoltorio de bash', () => {
  assert.equal(comandoLimpio("/bin/bash -lc 'ls -la'"), 'ls -la');
  assert.equal(comandoLimpio('git status'), 'git status');
});

test('Codex: un comando que solo lee se cuenta como lectura', () => {
  const [b] = bloquesDeItem({ type: 'commandExecution', id: 'c1', command: "bash -lc 'cat a.ts'", commandActions: [{ type: 'read', command: 'cat a.ts', name: 'a.ts', path: '/p/a.ts' }], status: 'completed', aggregatedOutput: 'hola', exitCode: 0 }, '/p');
  assert.equal(b!.tipo, 'herramienta');
  if (b!.tipo !== 'herramienta') return;
  assert.equal(b.icono, 'leer'); assert.equal(b.resumen, 'Leyó `a.ts`'); assert.equal(b.estado, 'ok');
});

test('Codex: un comando que falla queda en error', () => {
  const [b] = bloquesDeItem({ type: 'commandExecution', id: 'c2', command: 'false', commandActions: [{ type: 'unknown', command: 'false' }], status: 'completed', exitCode: 1 }, '/p');
  assert.equal(b!.tipo === 'herramienta' && b.estado, 'error');
});

test('Codex: un cambio de archivos da un bloque con diff por archivo', () => {
  const bloques = bloquesDeItem({ type: 'fileChange', id: 'f', status: 'completed', changes: [
    { path: '/p/a.ts', kind: { type: 'update', move_path: null }, diff: '--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-viejo\n+nuevo\n' },
    { path: '/p/b.ts', kind: { type: 'add' }, diff: 'uno\ndos' },
  ] }, '/p');
  assert.equal(bloques.length, 2);
  const [a, b] = bloques as Extract<Bloque, { tipo: 'herramienta' }>[];
  assert.equal(a!.resumen, 'Editó `a.ts`');
  assert.deepEqual(a!.detalle?.clase === 'diff' && a!.detalle.lineas, [{ tipo: '-', texto: 'viejo' }, { tipo: '+', texto: 'nuevo' }]);
  assert.equal(b!.resumen, 'Creó `b.ts`');
  assert.equal(b!.detalle?.clase === 'diff' && b!.detalle.lineas.every(l => l.tipo === '+'), true);
});

test('Codex: diff con dos tramos marca el salto', () => {
  assert.deepEqual(lineasDiff('@@ -1 +1 @@\n-a\n+b\n@@ -9 +9 @@\n c'), [{ tipo: '-', texto: 'a' }, { tipo: '+', texto: 'b' }, { tipo: ' ', texto: '⋯' }, { tipo: ' ', texto: 'c' }]);
});

test('Codex: el plan pasa a tareas', () => {
  const t = tareasDePlan('t', [{ step: 'Leer', status: 'completed' }, { step: 'Escribir', status: 'inProgress' }, { step: 'Probar', status: 'pending' }]);
  assert.deepEqual(t.items.map(i => i.estado), ['hecha', 'en_curso', 'pendiente']);
});

test('Codex: un hilo guardado se arma con usuario, respuesta y fin', () => {
  const bloques = bloquesDeHilo([{ id: 't1', status: 'completed', startedAt: 100, durationMs: 1500, items: [
    { type: 'userMessage', id: 'u', content: [{ type: 'text', text: 'Hola' }] },
    { type: 'reasoning', id: 'r', summary: ['Pienso'], content: [] },
    { type: 'agentMessage', id: 'm', text: 'Respuesta' },
  ] }, { id: 't2', status: 'failed', error: { message: 'You’ve hit your usage limit. Try again at 2:52 PM.' }, items: [] }], '/p', t => errorLegible(t, 'Codex'));
  assert.deepEqual(bloques.map(b => b.tipo), ['usuario', 'pensamiento', 'texto', 'fin', 'fin']);
  assert.equal(bloques[0]!.tipo === 'usuario' && bloques[0]!.fecha, 100000);
  assert.equal(bloques[4]!.tipo === 'fin' && bloques[4]!.error, 'Se acabó tu cuota de Codex. Vuelve a estar disponible a las 2:52 PM.');
});

test('Gemini: los trozos de texto se juntan y una herramienta corta el párrafo', () => {
  const n = crearNormalizadorGemini('/p'); let bloques: Bloque[] = [];
  const dar = (u: Record<string, unknown>) => { bloques = aplicarOps(bloques, n.procesar(u, bloques)); };
  n.turno();
  dar({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Ho' } });
  dar({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'la' } });
  dar({ sessionUpdate: 'tool_call', toolCallId: 'x', title: 'ReadFile', kind: 'read', status: 'in_progress', locations: [{ path: '/p/a.md' }] });
  dar({ sessionUpdate: 'tool_call_update', toolCallId: 'x', status: 'completed' });
  dar({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Listo' } });
  bloques = aplicarOps(bloques, n.cerrar(bloques));
  assert.deepEqual(bloques.map(b => b.tipo), ['texto', 'herramienta', 'texto']);
  assert.equal(bloques[0]!.tipo === 'texto' && bloques[0]!.md, 'Hola');
  const h = bloques[1] as Extract<Bloque, { tipo: 'herramienta' }>;
  assert.equal(h.resumen, 'Leyó `a.md`'); assert.equal(h.estado, 'ok');
  assert.equal(bloques.every(b => b.tipo !== 'texto' || !b.enCurso), true);
});

test('Gemini: un diff de edición se dibuja con + y -', () => {
  const n = crearNormalizadorGemini('/p');
  const ops = n.procesar({ sessionUpdate: 'tool_call', toolCallId: 'e', title: 'Edit', kind: 'edit', status: 'pending', locations: [{ path: '/p/a.ts' }], content: [{ type: 'diff', path: '/p/a.ts', oldText: 'a\n', newText: 'b\n' }] }, []);
  const b = ops[0]!.op === 'agregar' ? ops[0]!.bloque : undefined;
  assert.equal(b?.tipo === 'herramienta' && b.detalle?.clase === 'diff' && b.detalle.lineas.map(l => l.tipo).join(''), '-+');
});
