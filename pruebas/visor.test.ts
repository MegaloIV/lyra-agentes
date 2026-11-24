import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { leerArchivo } from '../servidor/archivos.ts';
import { limpiarGrupos } from '../servidor/grupos.ts';

test('el visor lee archivos comunes, relativos a la carpeta del agente', async () => {
  const d = await mkdtemp(join(tmpdir(), 'lyra-visor-'));
  await writeFile(join(d, 'nota.md'), '# Hola');
  await writeFile(join(d, 'foto.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const a = await leerArchivo('nota.md', d);
  assert.equal(a.datos.toString(), '# Hola');
  assert.match(a.tipo, /^text\/plain/);
  assert.equal((await leerArchivo(join(d, 'foto.png'))).tipo, 'image/png');
  assert.equal((await leerArchivo('nota.md:12', d)).datos.toString(), '# Hola');   // archivo:línea
});

test('el visor no muestra carpetas ocultas ni rutas fuera de casa, /tmp o /mnt/shared', async () => {
  await assert.rejects(leerArchivo('/etc/passwd'), /Solo se muestran/);
  await assert.rejects(leerArchivo(join(homedir(), '.ssh/id_ed25519')), /ocultas|No encontré/);
  const d = await mkdtemp(join(tmpdir(), 'lyra-visor-'));
  await mkdir(join(d, '.secreto')); await writeFile(join(d, '.secreto/clave'), 'x');
  await assert.rejects(leerArchivo('.secreto/clave', d), /ocultas/);
  await symlink('/etc/hostname', join(d, 'enlace.txt'));   // un enlace no sirve para salir
  await assert.rejects(leerArchivo('enlace.txt', d), /Solo se muestran/);
  await assert.rejects(leerArchivo('nota.md'), /Falta la carpeta/);
});

test('las carpetas propias descartan datos inválidos y sesiones huérfanas', () => {
  const g = limpiarGrupos({ carpetas: [{ id: 'a1', nombre: '  Trabajo  ' }, { id: 'a1', nombre: 'repetida' }, { id: '../x', nombre: 'mala' }, { id: 'b2', nombre: '' }], sesiones: { s1: 'a1', s2: 'zz', s3: 5 } });
  assert.deepEqual(g, { carpetas: [{ id: 'a1', nombre: 'Trabajo', abierta: true }], sesiones: { s1: 'a1' } });
  assert.deepEqual(limpiarGrupos(null), { carpetas: [], sesiones: {} });
});
