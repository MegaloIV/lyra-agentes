import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limpiarNotas } from '../servidor/notas.ts';
import { validarMensaje } from '../servidor/validar.ts';

test('las notas guardan solo lo válido', () => {
  const n = limpiarNotas([
    { id: 'a1', texto: 'hola', color: 'azul', fecha: 5 },
    { id: 'a1', texto: 'repetida', color: 'lima', fecha: 6 },
    { id: '../x', texto: 'id raro', color: 'azul', fecha: 7 },
    { id: 'b2', texto: 42, color: 'fucsia' },
    'basura',
  ]);
  assert.equal(n.length, 2);
  assert.deepEqual(n[0], { id: 'a1', texto: 'hola', color: 'azul', fecha: 5 });
  assert.equal(n[1]!.id, 'b2');
  assert.equal(n[1]!.texto, '');
  assert.equal(n[1]!.color, 'amarillo');
  assert.deepEqual(limpiarNotas({ no: 'lista' }), []);
  assert.equal(limpiarNotas([{ id: 'c', texto: 'x'.repeat(30000) }])[0]!.texto.length, 20000);
});

test('guardarNotas se valida', () => {
  assert.doesNotThrow(() => validarMensaje({ t: 'guardarNotas', notas: [] }));
  assert.throws(() => validarMensaje({ t: 'guardarNotas', notas: 'x' }));
  assert.throws(() => validarMensaje({ t: 'guardarNotas', notas: new Array(301).fill({}) }));
});
