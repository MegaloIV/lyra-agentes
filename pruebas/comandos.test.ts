import { test } from 'node:test';
import assert from 'node:assert/strict';
import { datosComando, numeroCorto } from '../servidor/comandos.ts';
import { ContadorTokens } from '../servidor/tokens.ts';
import { crearNormalizador } from '../servidor/normalizar.ts';
import { aplicarOps, type Bloque } from '../servidor/protocolo.ts';

const CONTEXTO = `## Context Usage

**Model:** claude-haiku-5-5  
**Tokens:** 10k / 1m (1%)

### Estimated usage by category

| Category | Tokens | Percentage |
|----------|--------|------------|
| System prompt | 142 | 0.0% |
| System tools | 4.3k | 0.4% |
| System tools (deferred) | 21.5k | 2.2% |
| Messages | 10 | 0.0% |
| Free space | 957k | 95.7% |
| Autocompact buffer | 33k | 3.3% |

### Skills

| Skill | Source | Tokens |
|-------|--------|--------|
| dataviz | Built-in | ~480 |`;

test('números cortos de Claude Code', () => {
  assert.equal(numeroCorto('4.3k'), 4300);
  assert.equal(numeroCorto('1m'), 1_000_000);
  assert.equal(numeroCorto('~480'), 480);
});

test('/context: categorías, total y el resto para el detalle', () => {
  const { datos, resto } = datosComando('context', CONTEXTO);
  assert.equal(datos?.clase, 'contexto');
  if (datos?.clase !== 'contexto') return;
  assert.equal(datos.total, 1_000_000);
  assert.equal(datos.modelo, 'claude-haiku-5-5');
  assert.deepEqual(datos.categorias.map(c => [c.nombre, c.tokens, c.tipo]), [
    ['Instrucciones del sistema', 142, 'usado'], ['Herramientas del sistema', 4300, 'usado'], ['Herramientas diferidas', 21500, 'diferido'],
    ['Mensajes', 10, 'usado'], ['Libre', 957000, 'libre'], ['Reserva para resumir', 33000, 'reserva']]);
  assert.match(resto, /^### Skills/);
});

const USO = `You are currently using your subscription to power your Claude Code usage

Current session: 66% used · resets Nov 25, 1:30am (UTC)
Current week (all models): 35% used · resets Nov 30, 7pm (UTC)

What's contributing to your usage?
Last 24h · 1649 requests · 9 sessions`;

test('/usage: con el informe del SDK y, sin él, de las líneas del texto', () => {
  const informe = { rate_limits: { limits: [{ kind: 'session', percent: 70, resets_at: '2026-11-25T06:30:00Z', is_active: true }, { kind: 'weekly_all', percent: 36, resets_at: null }] } };
  const con = datosComando('usage', USO, informe);
  assert.deepEqual(con.datos, { clase: 'uso', limites: [
    { nombre: 'Sesión (5 h)', usado: 70, renueva: Date.parse('2026-11-25T06:30:00Z'), activo: true },
    { nombre: 'Semana · todos los modelos', usado: 36, renueva: undefined, activo: false }] });
  assert.match(con.resto, /^What's contributing/);
  const sin = datosComando('usage', USO);
  assert.deepEqual(sin.datos?.clase === 'uso' && sin.datos.limites.map(l => [l.nombre, l.usado, l.renuevaTexto]), [
    ['Sesión (5 h)', 66, 'Nov 25, 1:30am (UTC)'], ['Semana · todos los modelos', 35, 'Nov 30, 7pm (UTC)']]);
});

test('la salida de un comando local queda como bloque «comando»', () => {
  const n = crearNormalizador('/tmp');
  let b: Bloque[] = [];
  b = aplicarOps(b, n.procesar({ type: 'user', uuid: 'u1', session_id: 's', parent_tool_use_id: null, message: { role: 'user', content: '/context' } } as never));
  b = aplicarOps(b, n.procesar({ type: 'assistant', uuid: 'a1', session_id: 's', parent_tool_use_id: null, local_command_source: '<local-command-stdout>…', message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: CONTEXTO }] } } as never));
  const c = b.find(x => x.tipo === 'comando');
  assert.equal(c?.tipo === 'comando' && c.nombre, 'context');
  assert.equal(c?.tipo === 'comando' && c.datos?.clase, 'contexto');
  assert.ok(!b.some(x => x.tipo === 'texto'));
});

test('contador de tokens: estima mientras llega y usa lo informado al cerrar', () => {
  const c = new ContadorTokens(), ev = (event: object, padre: string | null = null) => c.procesar({ type: 'stream_event', parent_tool_use_id: padre, event });
  ev({ type: 'message_start', message: {} });
  ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } });
  ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '', estimated_tokens: 50 } });
  assert.equal(c.total, 50);
  assert.equal(c.fase, 'pensando');
  ev({ type: 'content_block_start', index: 1, content_block: { type: 'text' } });
  ev({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'x'.repeat(40) } });
  assert.equal(c.total, 60);
  assert.equal(c.fase, 'escribiendo');
  ev({ type: 'message_delta', usage: { output_tokens: 232 } });
  assert.equal(c.total, 232);
  // Un subagente suma aparte y no cambia lo que hace el principal
  ev({ type: 'message_start', message: {} }, 'tool-1');
  ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'y'.repeat(8) } }, 'tool-1');
  assert.equal(c.total, 234);
  c.reiniciar();
  assert.equal(c.total, 0);
});
