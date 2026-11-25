import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ajustada, alternar, escalaAjuste, limitar, mover, zoomEn, MAXIMO } from '../web/zoom.ts';

const marco = { ancho: 400, alto: 300 }, grande = { ancho: 1600, alto: 800 }, chica = { ancho: 100, alto: 50 };

test('ajustada: la grande entra entera y centrada; la chica no se agranda', () => {
  assert.equal(escalaAjuste(marco, grande), 0.25);
  assert.deepEqual(ajustada(marco, grande), { escala: 0.25, x: 0, y: 50 });
  assert.deepEqual(ajustada(marco, chica), { escala: 1, x: 150, y: 125 });
});

test('zoomEn deja quieto el punto bajo el puntero', () => {
  const v = zoomEn({ escala: 1, x: -400, y: -200 }, 2, 200, 150, marco, grande);
  // El píxel de la imagen bajo (200, 150) era (600, 350) y lo sigue siendo
  assert.equal((200 - v.x) / v.escala, 600);
  assert.equal((150 - v.y) / v.escala, 350);
});

test('límites: no baja de la de ajuste (ni de 10 % en las chicas) ni pasa del máximo', () => {
  assert.equal(zoomEn(ajustada(marco, grande), 0.01, 0, 0, marco, grande).escala, 0.25);
  assert.equal(zoomEn(ajustada(marco, chica), 0.01, 0, 0, marco, chica).escala, 0.1);
  assert.equal(zoomEn(ajustada(marco, chica), 999, 0, 0, marco, chica).escala, MAXIMO);
});

test('mover no deja ver afuera de la imagen', () => {
  const v = { escala: 1, x: 0, y: 0 };
  assert.deepEqual(mover(v, 500, 500, marco, grande), { escala: 1, x: 0, y: 0 });
  assert.deepEqual(mover(v, -5000, -5000, marco, grande), { escala: 1, x: -1200, y: -500 });
  assert.deepEqual(limitar({ escala: 1, x: 37, y: 0 }, marco, chica), { escala: 1, x: 150, y: 125 });
});

test('doble clic: de ajustada a real y de vuelta', () => {
  const a = ajustada(marco, grande);
  const real = alternar(a, 200, 150, marco, grande);
  assert.equal(real.escala, 1);
  assert.deepEqual(alternar(real, 200, 150, marco, grande), a);
  assert.equal(alternar(ajustada(marco, chica), 200, 150, marco, chica).escala, 2);
});
