import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { guardarAdjunto, MAX_ADJUNTO } from '../servidor/adjuntos.ts';
import { etiquetaAdjunto, rutasPegadas, textoConAdjuntos } from '../web/adjuntos.ts';

test('los adjuntos conservan los bytes, no pisan nombres ni salen de su carpeta', async () => {
  const base = await mkdtemp(join(tmpdir(), 'lyra-adjuntos-'));
  async function* datos() { yield Buffer.from([0, 1, 255]); yield Buffer.from('imagen'); }
  try {
    const a = await guardarAdjunto(datos(), '../../imagen.png', base);
    const b = await guardarAdjunto(datos(), '../../imagen.png', base);
    assert.equal(a.nombre, 'imagen.png');
    assert.ok(a.ruta.startsWith(base + '/'));
    assert.notEqual(a.ruta, b.ruta);
    assert.deepEqual(await readFile(a.ruta), Buffer.concat([Buffer.from([0, 1, 255]), Buffer.from('imagen')]));
    assert.equal((await stat(a.ruta)).mode & 0o777, 0o600);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('una subida demasiado grande o interrumpida elimina la copia parcial', async () => {
  const base = await mkdtemp(join(tmpdir(), 'lyra-adjuntos-'));
  async function* grande() { yield Buffer.alloc(MAX_ADJUNTO); yield Buffer.from('x'); }
  async function* rota() { yield Buffer.from('inicio'); throw new Error('desconectado'); }
  try {
    await assert.rejects(guardarAdjunto(grande(), 'grande', base), /25 MB/);
    await assert.rejects(guardarAdjunto(rota(), 'roto', base), /desconectado/);
    assert.deepEqual(await readdir(base), []);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('las etiquetas apuntan a rutas y no mandan archivos quitados del texto', () => {
  const lista = [{ etiqueta: '[imagen 1]', ruta: '/tmp/mi captura.png', nombre: 'mi captura.png' },
    { etiqueta: '[archivo 1]', ruta: '/tmp/informe.pdf', nombre: 'informe.pdf' }];
  assert.equal(etiquetaAdjunto('foto.png', '', lista), '[imagen 2]');
  assert.equal(etiquetaAdjunto('informe.pdf', 'application/pdf', lista), '[archivo 2]');
  const texto = textoConAdjuntos('Revisa [imagen 1]', lista);
  assert.ok(texto.includes('[imagen 1]: "/tmp/mi captura.png"'));
  assert.ok(!texto.includes('informe.pdf'));
});

test('el portapapeles de archivos admite URI locales, espacios y varios archivos', () => {
  assert.deepEqual(rutasPegadas('copy\nfile:///tmp/captura%201.png\nfile://localhost/tmp/informe.pdf\nhttps://example.com\nfile://otro/tmp/a\nfile:///tmp/%XX'),
    ['/tmp/captura 1.png', '/tmp/informe.pdf']);
});
