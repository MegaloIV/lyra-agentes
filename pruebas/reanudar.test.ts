import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { GestorAgentes } from '../servidor/agentes.ts';
import { MotorClaude } from '../servidor/claude.ts';

test('dos reanudaciones concurrentes reutilizan un solo agente y conservan ambos encargos', async () => {
  const gestor = new GestorAgentes(() => {}, () => {}, () => true);
  const inicio = mock.method(MotorClaude.prototype, 'iniciar', function (this: MotorClaude) {});
  const enviados: string[] = [];
  const enviar = mock.method(MotorClaude.prototype, 'enviar', (texto: string) => { enviados.push(texto); });
  // El proveedor Codex carga mediante gestor.cargar; para probar la exclusión sin
  // procesos externos se intercepta la creación interna y se simula ese await.
  const interno = gestor as unknown as { crearAgente: (opciones: { prompt?: string }) => Promise<unknown> };
  let creaciones = 0;
  const a = { id: 'unico' };
  const crear = mock.method(interno, 'crearAgente', async (opciones: { prompt?: string }) => {
    const existente = gestor.agentes.has('unico');
    await new Promise(r => setTimeout(r, 10));
    if (!existente) { creaciones++; gestor.agentes.set('unico', a as never); }
    if (opciones.prompt) enviados.push(opciones.prompt);
    return a;
  });
  try {
    const [primero, segundo] = await Promise.all([
      gestor.crear({ cwd: '/tmp', proveedor: 'codex', reanudar: 'sesion', prompt: 'primero' }),
      gestor.crear({ cwd: '/tmp', proveedor: 'codex', reanudar: 'sesion', prompt: 'segundo' }),
    ]);
    assert.equal(primero, segundo); assert.equal(creaciones, 1);
    assert.deepEqual(enviados, ['primero', 'segundo']);
  } finally { inicio.mock.restore(); enviar.mock.restore(); crear.mock.restore(); }
});
