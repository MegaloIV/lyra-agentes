import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type { Bloque, ClienteMensaje, ServidorMensaje } from './protocolo.ts';
import { cargarToken, validarConexion, validarApi, archivoPublico } from './seguridad.ts';
import { validarMensaje } from './validar.ts';
import { GestorAgentes } from './agentes.ts';
import { explorar } from './carpetas.ts';
import { crearNotificador } from './notificar.ts';
import { catalogo } from './catalogo.ts';
import { abrirCon, abrirArchivo, aplicaciones } from './abrir.ts';
import { leerArchivo, comoPdf, servirMedio, guardarMd } from './archivos.ts';
import { vigilarBateria } from './bateria.ts';
import type { Bateria } from './protocolo.ts';
import { borrarArchivo } from './papelera.ts';
import { guardarGrupos, leerGrupos, olvidarSesion } from './grupos.ts';
import { guardarNotas, leerNotas } from './notas.ts';
import { avisarCuota, cerrarCodex, limiteCodex, rutaCodex } from './codex.ts';
import { SeguidorSesiones } from './seguir.ts';
import { avisarUsoClaude, comandosClaude } from './claude.ts';
import { anotarLimite, limites, listaLimites } from './limites.ts';
import { diffGit, estadoGit, infoGithub, registroPrueba } from './git.ts';
import { memorias } from './memorias.ts';
import { Consolas } from './consolas.ts';
import { guardarAdjunto, MAX_ADJUNTO } from './adjuntos.ts';
import { crearAcompanante, queDice, ultimoTexto } from './acompanante.ts';
// Si el servidor se lanzó desde una sesión de Claude Code, sus agentes heredarían estas variables y se
// creerían sesiones hijas (no se guardan ni se pueden retomar).
for (const k of ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'AI_AGENT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN']) delete process.env[k];
const puerto = Number(process.env.LYRA_AGENTES_PUERTO || 4317);
if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) throw new Error('LYRA_AGENTES_PUERTO debe ser un puerto válido.');
const token = await cargarToken(), desarrollo = process.env.LYRA_AGENTES_DESARROLLO === '1';
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const clientes = new Map<WebSocket, { visible: boolean; fecha: number; agente?: string }>();
const enviar = (ws: WebSocket, m: ServidorMensaje) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
const emitir = (m: ServidorMensaje) => { for (const ws of clientes.keys()) enviar(ws, m); };
const visible = () => [...clientes.values()].some(c => c.visible && Date.now() - c.fecha < 2000);
// Tocar la notificación: abre (o trae al frente) la ventana y muestra ese agente
const lanzador = fileURLToPath(new URL('../bin/lyra-agentes', import.meta.url));
const alAbrir = (id: string) => {
  execFile(lanzador, [], () => { execFile('hyprctl', ['dispatch', 'focuswindow', 'class:io.lyra.Agentes'], () => {}); setTimeout(() => emitir({ t: 'enfocar', agente: id }), 600); });
};
const gestor = new GestorAgentes(emitir, crearNotificador(visible, alAbrir), id => [...clientes.values()].some(c => c.agente === id && c.visible && Date.now() - c.fecha < 2000));
const consolas = new Consolas(emitir);
// Un acompañante opcional (LYRA_AGENTES_ACOMPANANTE): recibe los avisos y la caja de texto, y maneja agentes por la API
const acompanante = crearAcompanante();
if (acompanante.configurado) gestor.acompanante = acompanante;
let sentada = { sentada: false, ancho: 0 };
const estadoAcompanante = (): ServidorMensaje => ({ t: 'acompanante', configurado: acompanante.configurado, ...sentada });
const NOMBRE_PROVEEDOR = { claude: 'Claude', codex: 'Codex', local: 'el agente local' } as const;

/** La API para el acompañante (u otro programa local): JSON, con el token en la cabecera X-Lyra-Token */
async function api(ruta: string, metodo: string, datos: Record<string, unknown>): Promise<unknown> {
  if (ruta === '/api/estado' && metodo === 'GET') {
    return { agentes: [...gestor.agentes.values()].map(a => {
      const pide = a.bloques.findLast((b): b is Extract<Bloque, { tipo: 'permiso' | 'pregunta' | 'plan' }> => (b.tipo === 'permiso' || b.tipo === 'pregunta' || b.tipo === 'plan') && b.estado === 'pendiente');
      return { id: a.id, proveedor: a.proveedor, titulo: a.titulo, cwd: a.cwd, estado: a.estado, modelo: a.modelo, ultimaActividad: a.ultimaActividad,
        ...(pide ? { pide: queDice(pide), solicitud: pide.id, tipoPedido: pide.tipo } : {}), ultimo: ultimoTexto(a.bloques, 400) };
    }) };
  }
  if (metodo !== 'POST') throw new Error('Método no válido.');
  switch (ruta) {
    case '/api/crear': {
      const m = validarMensaje({ ...datos, t: 'crear' }) as Extract<ClienteMensaje, { t: 'crear' }>;
      const a = await gestor.crear({ cwd: m.cwd, proveedor: m.proveedor, modelo: m.modelo, esfuerzo: m.esfuerzo, modo: m.modo, prompt: m.prompt });
      return { agente: a.id };
    }
    case '/api/enviar': { const m = validarMensaje({ ...datos, t: 'enviar' }) as Extract<ClienteMensaje, { t: 'enviar' }>; gestor.enviar(m.agente, m.texto); return { ok: true }; }
    case '/api/responder': { const m = validarMensaje({ ...datos, t: 'responder' }) as Extract<ClienteMensaje, { t: 'responder' }>; gestor.responder(m); return { ok: true }; }
    case '/api/enfocar': { const id = String(datos.agente || ''); gestor.obtener(id); alAbrir(id); return { ok: true }; }
    case '/api/acompanante': {
      const ancho = Number(datos.ancho);
      sentada = { sentada: datos.sentada === true, ancho: Number.isFinite(ancho) ? Math.max(0, Math.min(400, Math.round(ancho))) : 0 };
      emitir(estadoAcompanante()); return { ok: true };
    }
  }
  throw new Error('No existe esa ruta.');
}
const RUTAS_API = new Set(['/api/estado', '/api/crear', '/api/enviar', '/api/responder', '/api/enfocar', '/api/acompanante']);
async function leerJson(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  let total = 0; const partes: Buffer[] = [];
  for await (const trozo of req) { total += (trozo as Buffer).length; if (total > 1024 * 1024) throw new Error('El pedido es muy grande.'); partes.push(trozo as Buffer); }
  const datos = partes.length ? JSON.parse(Buffer.concat(partes).toString('utf8')) : {};
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) throw new Error('Se esperaba un objeto JSON.');
  return datos;
}
// Una conversación del historial que otra terminal sigue usando se vuelve a mandar cada vez que cambia su archivo
const seguidor = new SeguidorSesiones(async (s, quienes) => {
  if ([...gestor.agentes.values()].some(a => a.sessionId === s.sessionId)) return;   // ya la tiene Lyra abierta
  const bloques = await gestor.cargar(s.proveedor, s.sessionId, s.cwd);
  for (const ws of quienes) enviar(ws as WebSocket, { t: 'documento', agente: s.sessionId, bloques, soloLectura: true });
}, rutaCodex);
const mandarCatalogo = async (fresco = false) => emitir({ t: 'catalogo', proveedores: await catalogo(fresco) });
// Codex avisa solo cuando cambia su cuota; Claude, al terminar cada turno
const nuevoLimite = (l?: ReturnType<typeof limiteCodex>) => { if (l) { anotarLimite(l); emitir({ t: 'limites', ...listaLimites() }); } };
avisarCuota(() => { void mandarCatalogo(true).catch(() => {}); nuevoLimite(limiteCodex()); });
avisarUsoClaude(nuevoLimite);
let ultimaBateria: Bateria | null = null;
vigilarBateria(b => { ultimaBateria = b; emitir({ t: 'bateria', bateria: b }); });
void catalogo().catch(() => {});   // se arma al arrancar para que el diálogo lo tenga listo
const servidor = createServer(async (req, res) => {
  res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self'; frame-src blob:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  const rutaApi = (req.url || '').split('?')[0]!;
  if (RUTAS_API.has(rutaApi)) {
    if (!validarApi(token, String(req.headers['x-lyra-token'] || ''), req.headers.origin, puerto, desarrollo)) { res.writeHead(401); res.end(); return; }
    try {
      const respuesta = await api(rutaApi, req.method || 'GET', req.method === 'POST' ? await leerJson(req) : {});
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(respuesta));
    } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'No se pudo.' })); }
    return;
  }
  if (req.method === 'POST' && (req.url || '').split('?')[0] === '/api/adjunto') {
    if (!validarConexion(token, String(req.headers['x-lyra-token'] || ''), req.headers.origin, puerto, desarrollo)) {
      res.writeHead(401); res.end(); return;
    }
    if (Number(req.headers['content-length']) > MAX_ADJUNTO) { res.writeHead(413); res.end('El archivo supera los 25 MB.'); return; }
    try {
      const url = new URL(req.url!, `http://127.0.0.1:${puerto}`);
      const adjunto = await guardarAdjunto(req, url.searchParams.get('nombre') || 'archivo');
      res.writeHead(201, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(adjunto));
    } catch (e) { res.writeHead(400); res.end(e instanceof Error ? e.message : 'No se pudo adjuntar.'); }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  // Videos y audio: GET /api/medio?ruta=…&cwd=…&t=TOKEN (el reproductor no manda cabeceras propias)
  if ((req.url || '').startsWith('/api/medio?')) {
    const url = new URL(req.url!, `http://127.0.0.1:${puerto}`);
    const sitio = req.headers['sec-fetch-site'];
    if (!validarConexion(token, url.searchParams.get('t'), `http://127.0.0.1:${puerto}`, puerto) || (sitio && sitio !== 'same-origin')) { res.writeHead(401); res.end(); return; }
    try { await servirMedio(req, res, url.searchParams.get('ruta') || '', url.searchParams.get('cwd') || ''); }
    catch (e) { if (!res.headersSent) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(e instanceof Error ? e.message : 'No se pudo leer.'); } }
    return;
  }
  // El visor: GET /api/archivo?ruta=…&cwd=…[&como=pdf], con el token en la cabecera X-Lyra-Token
  if ((req.url || '').startsWith('/api/archivo?')) {
    const url = new URL(req.url!, `http://127.0.0.1:${puerto}`);
    const sitio = req.headers['sec-fetch-site'];
    if (!validarConexion(token, String(req.headers['x-lyra-token'] || ''), `http://127.0.0.1:${puerto}`, puerto) || (sitio && sitio !== 'same-origin')) { res.writeHead(401); res.end(); return; }
    try {
      const ruta = url.searchParams.get('ruta') || '', cwd = url.searchParams.get('cwd') || '';
      const a = url.searchParams.get('como') === 'pdf' ? await comoPdf(ruta, cwd) : await leerArchivo(ruta, cwd);
      res.writeHead(200, { 'Content-Type': a.tipo, 'Cache-Control': 'no-store', 'X-Ruta': encodeURIComponent(a.ruta), ...(a.modificado ? { 'X-Modificado': String(a.modificado) } : {}), 'Content-Security-Policy': "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; sandbox" });
      res.end(req.method === 'HEAD' ? undefined : a.datos);
    } catch (e) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(e instanceof Error ? e.message : 'No se pudo leer.'); }
    return;
  }
  const archivo = await archivoPublico(dist, req.url || '/');
  if (!archivo) { res.writeHead(404); res.end('No encontrado'); return; }
  try {
    const tipos: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
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
    ws.on('error', () => {}); ws.on('close', () => { clientes.delete(ws); seguidor.mirar(ws); });
    ws.on('message', async datos => {
      try {
        const m = validarMensaje(JSON.parse(datos.toString())), cliente = clientes.get(ws)!;
        switch (m.t) {
          case 'hola': enviar(ws, { t: 'agentes', agentes: gestor.resumenes() }); enviar(ws, estadoAcompanante()); for (const a of gestor.agentes.values()) enviar(ws, { t: 'documento', agente: a.id, bloques: a.bloques }); enviar(ws, { t: 'historial', sesiones: await gestor.historial() }); enviar(ws, { t: 'catalogo', proveedores: await catalogo() }); enviar(ws, { t: 'grupos', grupos: await leerGrupos() }); enviar(ws, { t: 'notas', notas: await leerNotas() }); enviar(ws, { t: 'bateria', bateria: ultimaBateria }); enviar(ws, { t: 'consolas', consolas: consolas.resumen() }); break;
          case 'foco': cliente.visible = m.visible; cliente.fecha = Date.now(); break;
          case 'caja': void acompanante.avisar({ tipo: 'caja', x: m.x, y: m.y, ancho: m.ancho, alto: m.alto, vw: m.vw, vh: m.vh }); break;
          case 'sinCaja': void acompanante.avisar({ tipo: 'sin_caja' }); break;
          case 'tecleando': void acompanante.avisar({ tipo: 'tecleando' }); break;
          case 'charla': {
            // «@lyra …» en la caja: va al acompañante con lo que se está mirando, para que sepa de qué le hablan
            const a = m.agente ? gestor.agentes.get(m.agente) : undefined;
            const contexto = a ? `Está mirando la conversación «${a.titulo}» de ${NOMBRE_PROVEEDOR[a.proveedor]} (carpeta ${a.cwd}, estado: ${a.estado}). Lo último que dijo el agente: ${ultimoTexto(a.bloques, 1500) || '(nada todavía)'}` : '';
            if (!acompanante.configurado || !await acompanante.avisar({ tipo: 'charla', texto: m.texto, contexto })) throw new Error('Lyra no está abierta: no recibió el mensaje.');
            break;
          }
          case 'crear': { const a = await gestor.crear({ cwd: m.cwd, proveedor: m.proveedor, modelo: m.modelo, esfuerzo: m.esfuerzo, modo: m.modo, prompt: m.prompt }); cliente.agente = a.id; break; }
          case 'reanudar': { const a = await gestor.crear({ cwd: m.cwd, proveedor: m.proveedor, modelo: m.modelo, esfuerzo: m.esfuerzo, modo: m.modo, prompt: m.texto, reanudar: m.sessionId }); cliente.agente = a.id; break; }
          case 'abrirSesion': { const bloques = await gestor.cargar(m.proveedor || 'claude', m.sessionId, m.cwd); emitir({ t: 'documento', agente: m.sessionId, bloques, soloLectura: true }); seguidor.mirar(ws, { proveedor: m.proveedor || 'claude', sessionId: m.sessionId, cwd: m.cwd }); break; }
          case 'soltar': seguidor.mirar(ws); break;
          case 'enviar': {
            const a = gestor.obtener(m.agente);
            if (m.ya && (a.estado === 'trabajando' || a.estado === 'esperando')) await a.motor.interrumpir().catch(() => {});
            gestor.enviar(m.agente, m.texto); break;
          }
          case 'responder': gestor.responder(m); break;
          case 'cerrar': gestor.cerrar(m.agente); emitir({ t: 'historial', sesiones: await gestor.historial() }); break;
          case 'interrumpir': await gestor.obtener(m.agente).motor.interrumpir(); break;
          case 'leer': { seguidor.mirar(ws); cliente.agente = m.agente; const a = gestor.agentes.get(m.agente); if (a) { a.sinLeer = false; gestor.barra(); } break; }
          case 'modo': { const a = gestor.obtener(m.agente); await a.motor.modo(m.modo); gestor.barra(); break; }
          case 'modelo': { const a = gestor.obtener(m.agente); await a.motor.modelo(m.modelo ?? undefined); gestor.barra(); break; }
          case 'esfuerzo': { const a = gestor.obtener(m.agente); await a.motor.esfuerzo(m.esfuerzo ?? undefined); gestor.barra(); break; }
          // «claude»: los de Claude Code sin un agente abierto
          case 'comandos': enviar(ws, { t: 'comandos', agente: m.agente, comandos: m.agente === 'claude' && !gestor.agentes.has('claude') ? await comandosClaude() : await gestor.obtener(m.agente).motor.comandos() }); break;
          case 'catalogo': enviar(ws, { t: 'catalogo', proveedores: await catalogo(true) }); break;
          case 'limites': emitir({ t: 'limites', ...await limites(m.fresco) }); break;
          case 'abrir': await abrirCon(m.con, m.cwd); break;
          case 'abrirArchivo': await abrirArchivo(m.ruta, m.cwd, m.app); break;
          case 'aplicaciones': enviar(ws, { t: 'aplicaciones', ruta: m.ruta, apps: await aplicaciones(m.ruta, m.cwd) }); break;
          case 'borrarArchivo': {
            const real = await borrarArchivo(m.ruta, m.cwd);
            emitir({ t: 'archivoBorrado', ruta: m.ruta, cwd: m.cwd, id: m.id });
            enviar(ws, { t: 'aviso', texto: `«${real.split('/').pop()}» está en la papelera.` }); break;
          }
          case 'git': {
            // Lo local llega al instante; lo de GitHub (internet) después, en otro mensaje
            try { enviar(ws, { t: 'git', cwd: m.cwd, git: await estadoGit(m.cwd) }); }
            catch (e) { enviar(ws, { t: 'git', cwd: m.cwd, error: e instanceof Error ? e.message : 'No se pudo leer git.' }); break; }
            if (m.red) enviar(ws, { t: 'github', cwd: m.cwd, github: await infoGithub(m.cwd).catch(e => ({ nota: e instanceof Error ? e.message : 'No se pudo leer GitHub.' })) });
            break;
          }
          case 'guardarArchivo':
            try { const g = await guardarMd(m.ruta, m.cwd || '', m.texto, m.leido); enviar(ws, { t: 'archivoGuardado', ruta: m.ruta, cwd: m.cwd, modificado: g.modificado }); }
            catch (e) { enviar(ws, { t: 'archivoGuardado', ruta: m.ruta, cwd: m.cwd, error: e instanceof Error ? e.message : 'No se pudo guardar.' }); }
            break;
          case 'memorias':
            try { enviar(ws, { t: 'memorias', cwd: m.cwd, proveedores: await memorias(m.cwd) }); }
            catch (e) { enviar(ws, { t: 'memorias', cwd: m.cwd, error: e instanceof Error ? e.message : 'No se pudieron leer las memorias.' }); }
            break;
          case 'gitDiff': {
            const clave = m.commit ? 'commit:' + m.commit : 'ruta:' + m.ruta;
            try { enviar(ws, { t: 'gitDiff', cwd: m.cwd, clave, texto: await diffGit(m.cwd, { ruta: m.ruta, commit: m.commit }) }); }
            catch (e) { enviar(ws, { t: 'gitDiff', cwd: m.cwd, clave, error: e instanceof Error ? e.message : 'No se pudo leer el diff.' }); }
            break;
          }
          case 'registroPrueba': enviar(ws, { t: 'registroPrueba', cwd: m.cwd, texto: await registroPrueba(m.cwd, m.run, m.job) }); break;
          case 'guardarGrupos': emitir({ t: 'grupos', grupos: await guardarGrupos(m.grupos) }); break;
          case 'guardarNotas': emitir({ t: 'notas', notas: await guardarNotas(m.notas) }); break;
          case 'historial': emitir({ t: 'historial', sesiones: await gestor.historial() }); break;
          case 'borrar': {
            const r = await gestor.borrar(m);
            if (r.sessionId) { const g = await olvidarSesion(r.sessionId); if (g) emitir({ t: 'grupos', grupos: g }); }
            emitir({ t: 'borrada', sessionId: r.sessionId, agente: m.agente }); emitir({ t: 'historial', sesiones: await gestor.historial() }); enviar(ws, { t: 'aviso', texto: r.texto }); break;
          }
          case 'borrarVarias': {
            let bien = 0, mal = 0;
            for (const x of m.sesiones) {
              try { await gestor.borrar(x); bien++; emitir({ t: 'borrada', sessionId: x.sessionId }); const g = await olvidarSesion(x.sessionId); if (g) emitir({ t: 'grupos', grupos: g }); }
              catch { mal++; }
            }
            emitir({ t: 'historial', sesiones: await gestor.historial() });
            const n = (k: number) => k === 1 ? '1 conversación' : `${k} conversaciones`;
            enviar(ws, mal ? { t: 'error', texto: `Borré ${n(bien)}; ${n(mal)} no se pudieron borrar.` } : { t: 'aviso', texto: `Borré ${n(bien)}: ${m.sesiones.some(x => x.proveedor === 'codex') ? 'las de Codex quedaron archivadas y las demás, en la papelera' : 'están en la papelera'}.` });
            break;
          }
          case 'renombrar': await gestor.renombrar(m); emitir({ t: 'historial', sesiones: await gestor.historial() }); break;
          case 'explorar': enviar(ws, { t: 'explorado', pedida: m.ruta, ...await explorar(m.ruta) }); break;
          case 'consolaCrear': await consolas.crear(m.cwd, m.cols, m.rows); break;
          case 'consolaEscribir': consolas.escribir(m.id, m.datos); break;
          case 'consolaTamano': consolas.tamano(m.id, m.cols, m.rows); break;
          case 'consolaCerrar': consolas.cerrar(m.id); break;
          case 'consolaRepetir': { const r = consolas.repetir(m.id); if (r) enviar(ws, r); break; }
        }
      } catch (e) { enviar(ws, { t: 'error', texto: e instanceof Error ? e.message : 'Ocurrió un error inesperado.' }); }
    });
  });
});
servidor.listen(puerto, '127.0.0.1', () => console.log(`Lyra (agentes) escuchando en http://127.0.0.1:${puerto}`));
function cerrar() { consolas.cerrarTodas(); for (const id of [...gestor.agentes.keys()]) gestor.cerrar(id); cerrarCodex(); for (const ws of clientes.keys()) ws.close(1001, 'Lyra se cerró'); wss.close(); servidor.close(); }
process.once('SIGINT', cerrar); process.once('SIGTERM', cerrar);
