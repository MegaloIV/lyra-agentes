import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validarConexion, cargarToken, archivoPublico } from '../servidor/seguridad.ts';

const token = 'a'.repeat(64);

test('acepta solo el token correcto desde el origen propio', () => {
  assert.equal(validarConexion(token, token, 'http://127.0.0.1:4317', 4317), true);
  assert.equal(validarConexion(token, token, 'http://localhost:4317', 4317), true);
  assert.equal(validarConexion(token, 'b'.repeat(64), 'http://127.0.0.1:4317', 4317), false);
  assert.equal(validarConexion(token, null, 'http://127.0.0.1:4317', 4317), false);
  assert.equal(validarConexion(token, token.slice(1), 'http://127.0.0.1:4317', 4317), false);
  assert.equal(validarConexion(token, token, 'https://ataque.com', 4317), false);
  assert.equal(validarConexion(token, token, undefined, 4317), false);
  assert.equal(validarConexion(token, token, 'http://127.0.0.1:5173', 4317), false, 'Vite solo en desarrollo');
  assert.equal(validarConexion(token, token, 'http://127.0.0.1:5173', 4317, true), true);
});

test('el token se crea una vez, con permisos 0600 y carpeta 0700', async () => {
  const base = join(await mkdtemp(join(tmpdir(), 'atril-')), 'estado');
  const t1 = await cargarToken(base), t2 = await cargarToken(base);
  assert.match(t1, /^[a-f0-9]{64}$/);
  assert.equal(t1, t2);
  assert.equal((await stat(join(base, 'token'))).mode & 0o777, 0o600);
  assert.equal((await stat(base)).mode & 0o777, 0o700);
});

test('el servidor HTTP no sale de dist/', async () => {
  const raiz = await mkdtemp(join(tmpdir(), 'atril-')), dist = join(raiz, 'dist');
  await mkdir(join(dist, 'assets'), { recursive: true });
  await writeFile(join(dist, 'index.html'), 'x'); await writeFile(join(dist, 'assets', 'a.js'), 'x'); await writeFile(join(raiz, 'secreto'), 'x');
  assert.equal(await archivoPublico(dist, '/'), join(dist, 'index.html'));
  assert.equal(await archivoPublico(dist, '/assets/a.js?v=1'), join(dist, 'assets', 'a.js'));
  assert.equal(await archivoPublico(dist, '/../secreto'), null);
  assert.equal(await archivoPublico(dist, '/%2e%2e/secreto'), null);
  assert.equal(await archivoPublico(dist, '/assets'), null, 'no lista carpetas');
  assert.equal(await archivoPublico(dist, '/no-existe'), null);
});

test('la terminal se abre con el shell de inicio y sin las variables de otra terminal', async () => {
  const { entornoLimpio } = await import('../servidor/abrir.ts');
  const { userInfo } = await import('node:os');
  const env = entornoLimpio({ PATH: '/usr/bin', HOME: '/home/x', SHELL: '/usr/bin/zsh', KITTY_WINDOW_ID: '1', TERM: 'xterm-kitty', STARSHIP_SHELL: 'zsh', CLAUDE_CODE_SESSION_ID: 'a' });
  assert.equal(env.SHELL, userInfo().shell || '/usr/bin/zsh');
  assert.equal(env.PATH, '/usr/bin');
  for (const k of ['KITTY_WINDOW_ID', 'TERM', 'STARSHIP_SHELL', 'CLAUDE_CODE_SESSION_ID']) assert.equal(env[k], undefined);
});
