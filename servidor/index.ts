import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type { ServidorMensaje } from './protocolo.ts';
import { cargarToken, validarConexion, archivoPublico } from './seguridad.ts';
import { validarMensaje } from './validar.ts';
import { GestorAgentes } from './agentes.ts';
import { elegirCarpeta } from './carpetas.ts';
import { crearNotificador } from './notificar.ts';
import { catalogo } from './catalogo.ts';
import { abrirCon } from './abrir.ts';
import { avisarCuota, cerrarCodex } from './codex.ts';
// Si el servidor se lanzó desde una sesión de Claude Code, sus agentes heredarían estas variables y se
// creerían sesiones hijas (no se guardan ni se pueden retomar). Lyra hace lo mismo en adaptadores/claude_code.py.
for (const k of ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'AI_AGENT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN']) delete process.env[k];
const puerto = Number(process.env.LYRA_AGENTES_PUERTO || 4317);
if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) throw new Error('LYRA_AGENTES_PUERTO debe ser un puerto válido.');
const token = await cargarToken(), desarrollo = process.env.LYRA_AGENTES_DESARROLLO === '1';
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const clientes = new Map<WebSocket, { visible: boolean; fecha: number; agente?: string }>();
const enviar = (ws: WebSocket, m: ServidorMensaje) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
const emitir = (m: ServidorMensaje) => { for (const ws of clientes.keys()) enviar(ws, m); };
const visible = () => [...clientes.values()].some(c => c.visible && Date.now() - c.fecha < 2000);
const gestor = new GestorAgentes(emitir, crearNotificador(visible), id => [...clientes.values()].some(c => c.agente === id && c.visible && Date.now() - c.fecha < 2000));
const mandarCatalogo = async (fresco = false) => emitir({ t: 'catalogo', proveedores: await catalogo(fresco) });
avisarCuota(() => void mandarCatalogo(true).catch(() => {}));
void catalogo().catch(() => {});   // se arma al arrancar para que el diálogo lo tenga listo
const servidor = createServer(async (req, res) => {
  res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  const archivo = await archivoPublico(dist, req.url || '/');
  if (!archivo) { res.writeHead(404); res.end('No encontrado'); return; }
  try {
    const tipos: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
    const datos = await readFile(archivo); res.writeHead(200, { 'Content-Type': tipos[extname(archivo)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(req.method === 'HEAD' ? undefined : datos);
  } catch { res.writeHead(404); res.end('No encontrado'); }
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
servidor.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${puerto}`);
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => {
    if (!validarConexion(token, url.searchParams.get('t'), req.headers.origin, puerto, desarrollo)) { ws.close(4401, 'Acceso no autorizado'); return; }
    clientes.set(ws, { visible: false, fecha: 0 });
    ws.on('error', () => {}); ws.on('close', () => clientes.delete(ws));
    ws.on('message', async datos => {
      try {
        const m = validarMensaje(JSON.parse(datos.toString())), cliente = clientes.get(ws)!;
        switch (m.t) {
          case 'hola': enviar(ws, { t: 'agentes', agentes: gestor.resumenes() }); for (const a of gestor.agentes.values()) enviar(ws, { t: 'documento', agente: a.id, bloques: a.bloques }); enviar(ws, { t: 'historial', sesiones: await gestor.historial() }); enviar(ws, { t: 'catalogo', proveedores: await catalogo() }); break;
          case 'foco': cliente.visible = m.visible; cliente.fecha = Date.now(); break;
          case 'crear': { const a = await gestor.crear({ cwd: m.cwd, proveedor: m.proveedor, modelo: m.modelo, esfuerzo: m.esfuerzo, modo: m.modo, prompt: m.prompt }); cliente.agente = a.id; break; }
          case 'reanudar': { const a = await gestor.crear({ cwd: m.cwd, proveedor: m.proveedor, prompt: m.texto, reanudar: m.sessionId }); cliente.agente = a.id; break; }
          case 'abrirSesion': { const bloques = await gestor.cargar(m.proveedor || 'claude', m.sessionId, m.cwd); emitir({ t: 'documento', agente: m.sessionId, bloques, soloLectura: true }); break; }
          case 'enviar': gestor.enviar(m.agente, m.texto); break;
          case 'responder': gestor.responder(m); break;
          case 'cerrar': gestor.cerrar(m.agente); emitir({ t: 'historial', sesiones: await gestor.historial() }); break;
          case 'interrumpir': await gestor.obtener(m.agente).motor.interrumpir(); break;
          case 'leer': { cliente.agente = m.agente; const a = gestor.agentes.get(m.agente); if (a) { a.sinLeer = false; gestor.barra(); } break; }
          case 'modo': { const a = gestor.obtener(m.agente); await a.motor.modo(m.modo); gestor.barra(); break; }
          case 'modelo': { const a = gestor.obtener(m.agente); await a.motor.modelo(m.modelo ?? undefined); gestor.barra(); break; }
          case 'esfuerzo': { const a = gestor.obtener(m.agente); await a.motor.esfuerzo(m.esfuerzo ?? undefined); gestor.barra(); break; }
          case 'comandos': emitir({ t: 'comandos', agente: m.agente, comandos: await gestor.obtener(m.agente).motor.comandos() }); break;
          case 'catalogo': enviar(ws, { t: 'catalogo', proveedores: await catalogo(true) }); break;
          case 'abrir': await abrirCon(m.con, m.cwd); break;
          case 'historial': emitir({ t: 'historial', sesiones: await gestor.historial() }); break;
          case 'elegirCarpeta': emitir({ t: 'carpeta', ruta: await elegirCarpeta() }); break;
        }
      } catch (e) { enviar(ws, { t: 'error', texto: e instanceof Error ? e.message : 'Ocurrió un error inesperado.' }); }
    });
  });
});
servidor.listen(puerto, '127.0.0.1', () => console.log(`Lyra (agentes) escuchando en http://127.0.0.1:${puerto}`));
function cerrar() { for (const id of [...gestor.agentes.keys()]) gestor.cerrar(id); cerrarCodex(); for (const ws of clientes.keys()) ws.close(1001, 'Lyra se cerró'); wss.close(); servidor.close(); }
process.once('SIGINT', cerrar); process.once('SIGTERM', cerrar);
