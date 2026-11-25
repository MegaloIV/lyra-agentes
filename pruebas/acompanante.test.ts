import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearAcompanante, queDice, ultimoTexto, type Aviso } from '../servidor/acompanante.ts';
import { GestorAgentes } from '../servidor/agentes.ts';
import { validarApi } from '../servidor/seguridad.ts';
import type { Bloque, Solicitud } from '../servidor/protocolo.ts';

const solicitud = (herramienta: string, entrada: Record<string, unknown>): Solicitud => ({ id: 's1', agente: 'a1', herramienta, entrada, haySugerencias: false });

test('acompañante: sin URL no manda nada; con URL avisa y queda presente', async () => {
  assert.equal(await crearAcompanante(undefined).avisar({ tipo: 'tecleando' }), false);
  const recibidos: { url: string; cabecera: string | null; cuerpo: Aviso }[] = [];
  const falso = (async (url: string, op: RequestInit) => {
    recibidos.push({ url, cabecera: new Headers(op.headers).get('X-Lyra'), cuerpo: JSON.parse(String(op.body)) });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const a = crearAcompanante('http://127.0.0.1:1/api/agentes', falso);
  assert.equal(a.presente(), false);
  assert.equal(await a.avisar({ tipo: 'tecleando' }), true);
  assert.equal(a.presente(), true);
  assert.deepEqual(recibidos, [{ url: 'http://127.0.0.1:1/api/agentes', cabecera: '1', cuerpo: { tipo: 'tecleando' } }]);
  const caido = crearAcompanante('http://127.0.0.1:1/x', (async () => { throw new Error('sin conexión'); }) as typeof fetch);
  assert.equal(await caido.avisar({ tipo: 'tecleando' }), false);
});

test('acompañante: qué pide un permiso o una pregunta, en una línea', () => {
  assert.equal(queDice({ tipo: 'permiso', id: 'p', estado: 'pendiente', solicitud: solicitud('Bash', { command: 'npm test' }) }), 'ejecutar `npm test`');
  assert.equal(queDice({ tipo: 'permiso', id: 'p', estado: 'pendiente', solicitud: solicitud('Edit', { file_path: '/tmp/a.ts' }) }), 'editar /tmp/a.ts');
  assert.equal(queDice({ tipo: 'pregunta', id: 'p', estado: 'pendiente', solicitud: solicitud('AskUserQuestion', { questions: [{ question: '¿Sigo?' }] }) }), '¿Sigo?');
  assert.equal(queDice({ tipo: 'plan', id: 'p', estado: 'pendiente', md: '', solicitud: solicitud('ExitPlanMode', {}) }), 'aprobar un plan');
});

test('acompañante: lo último que dijo el agente, sin los subagentes', () => {
  const bloques: Bloque[] = [
    { tipo: 'texto', id: '1', md: 'Primero', enCurso: false },
    { tipo: 'texto', id: '2', md: 'Listo: 3 pruebas arregladas.', enCurso: false },
    { tipo: 'texto', id: '3', md: 'del subagente', enCurso: false, padre: 'x' },
  ];
  assert.equal(ultimoTexto(bloques), 'Listo: 3 pruebas arregladas.');
  assert.equal(ultimoTexto([{ tipo: 'texto', id: '1', md: 'a'.repeat(50), enCurso: false }], 10), 'aaaaaaaaa…');
});

test('gestor: avisa al acompañante y, si responde, no manda la notificación del escritorio', async () => {
  const notificadas: string[] = [], avisos: Aviso[] = [];
  const g = new GestorAgentes(() => {}, (_id, _t, texto) => { notificadas.push(texto); }, () => false);
  let responde = true;
  g.acompanante = { configurado: true, presente: () => true, avisar: async (a: Aviso) => { avisos.push(a); return responde; } };
  const a = { id: 'a1', proveedor: 'codex', titulo: 'Tests', cwd: '/tmp', estado: 'listo', bloques: [{ tipo: 'texto', id: 't', md: 'Hecho.', enCurso: false }], pendientes: new Map(), cerrado: false } as never;
  g.estado(a, 'trabajando');
  g.estado(a, 'listo');
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(avisos.map(x => x.tipo), ['trabaja', 'fin']);
  assert.equal((avisos[1] as { texto: string }).texto, 'Hecho.');
  assert.deepEqual(notificadas, []);
  responde = false;
  g.estado(a, 'trabajando'); g.estado(a, 'listo');
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(notificadas, ['Codex terminó']);
});

test('API: el token vale sin Origin (otro programa), pero no desde otra página', () => {
  const t = 'a'.repeat(64);
  assert.equal(validarApi(t, t, undefined, 4317), true);
  assert.equal(validarApi(t, t, 'http://127.0.0.1:4317', 4317), true);
  assert.equal(validarApi(t, t, 'https://malo.example', 4317), false);
  assert.equal(validarApi(t, 'b'.repeat(64), undefined, 4317), false);
});
