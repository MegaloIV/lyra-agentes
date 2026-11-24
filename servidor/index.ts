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
const puerto = Number(process.env.ATRIL_PUERTO || 4317);
if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) throw new Error('ATRIL_PUERTO debe ser un puerto válido.');
const token = await cargarToken(), desarrollo = process.env.ATRIL_DESARROLLO === '1';
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const clientes = new Map<WebSocket, { visible: boolean; fecha: number; agente?: string }>();
const enviar = (ws: WebSocket, m: ServidorMensaje) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
const emitir = (m: ServidorMensaje) => { for (const ws of clientes.keys()) enviar(ws, m); };
const visible = () => [...clientes.values()].some(c => c.visible && Date.now() - c.fecha < 2000);
const gestor = new GestorAgentes(emitir, crearNotificador(visible), id => [...clientes.values()].some(c => c.agente === id && c.visible && Date.now() - c.fecha < 2000));
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
          case 'hola': enviar(ws, { t: 'agentes', agentes: gestor.resumenes() }); for (const a of gestor.agentes.values()) enviar(ws, { t: 'documento', agente: a.id, bloques: a.bloques }); enviar(ws, { t: 'historial', sesiones: await gestor.historial() }); break;
          case 'foco': cliente.visible = m.visible; cliente.fecha = Date.now(); break;
          case 'crear': { const a = await gestor.crear(m.cwd, m.modelo, m.modo, m.prompt); cliente.agente = a.id; break; }
          case 'reanudar': { const a = await gestor.crear(m.cwd, undefined, 'default', m.texto, m.sessionId); cliente.agente = a.id; break; }
          case 'abrirSesion': { const { bloques } = await gestor.cargar(m.sessionId, m.cwd); emitir({ t: 'documento', agente: m.sessionId, bloques, soloLectura: true }); break; }
          case 'enviar': gestor.enviar(m.agente, m.texto); break;
          case 'responder': gestor.responder(m); break;
          case 'cerrar': gestor.cerrar(m.agente); emitir({ t: 'historial', sesiones: await gestor.historial() }); break;
          case 'interrumpir': await gestor.obtener(m.agente).consulta?.interrupt(); break;
          case 'leer': { cliente.agente = m.agente; const a = gestor.agentes.get(m.agente); if (a) { a.sinLeer = false; gestor.barra(); } break; }
          case 'modo': { const a = gestor.obtener(m.agente); await a.consulta?.setPermissionMode(m.modo); a.modo = m.modo; gestor.barra(); break; }
          case 'modelo': { const a = gestor.obtener(m.agente); await a.consulta?.setModel(m.modelo ?? undefined); a.modelo = m.modelo ?? undefined; gestor.barra(); break; }
          case 'comandos': { const comandos = await gestor.obtener(m.agente).consulta?.supportedCommands() || []; emitir({ t: 'comandos', agente: m.agente, comandos: comandos.map(c => ({ nombre: c.name, descripcion: c.description })) }); break; }
          case 'historial': emitir({ t: 'historial', sesiones: await gestor.historial() }); break;
          case 'elegirCarpeta': emitir({ t: 'carpeta', ruta: await elegirCarpeta() }); break;
        }
      } catch (e) { enviar(ws, { t: 'error', texto: e instanceof Error ? e.message : 'Ocurrió un error inesperado.' }); }
    });
  });
});
servidor.listen(puerto, '127.0.0.1', () => console.log(`Atril escuchando en http://127.0.0.1:${puerto}`));
function cerrar() { for (const id of [...gestor.agentes.keys()]) gestor.cerrar(id); for (const ws of clientes.keys()) ws.close(1001, 'Atril se cerró'); wss.close(); servidor.close(); }
process.once('SIGINT', cerrar); process.once('SIGTERM', cerrar);
