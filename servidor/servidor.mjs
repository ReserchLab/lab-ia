// laboratorio.ia — servidor de chat, investigación e imágenes sobre FreeLLMAPI.
// Escucha en toda la red local (puerto 8790). Desde el propio teléfono entra sin PIN;
// cualquier otro equipo de la red necesita el PIN que imprime al arrancar.
import http from 'node:http';
import dns from 'node:dns';
import os from 'node:os';
import path from 'node:path';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Gateway } from './lib/gateway.mjs';
import { Almacen } from './lib/almacen.mjs';
import { Skills } from './lib/skills.mjs';
import './lib/red.mjs';
import { Proveedores } from './lib/proveedores.mjs';
import { crearNucleo } from '../comun/nucleo.mjs';
import { rutasComunes } from '../comun/api.mjs';

const VERSION = '1.5.0';
// Muchas redes móviles no enrutan IPv6: probarlo primero hace que las conexiones expiren.
dns.setDefaultResultOrder('ipv4first');
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.join(AQUI, '..', 'web');
const DATOS = process.env.CARDON_LAB_DATOS || path.join(os.homedir(), '.cardon-lab');
const MEDIA = path.join(DATOS, 'media');
const APK = path.join(AQUI, '..', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
mkdirSync(MEDIA, { recursive: true });

// ── Configuración persistente (PIN y sesiones de otros equipos) ─────────────
const ARCHIVO_CFG = path.join(DATOS, 'config.json');
const cfg = existsSync(ARCHIVO_CFG) ? JSON.parse(readFileSync(ARCHIVO_CFG, 'utf8')) : {};
cfg.puerto ??= Number(process.env.PORT) || 8790;
cfg.pin ??= String(randomInt(0, 1_000_000)).padStart(6, '0');
cfg.sesiones ??= {};
cfg.tareas ??= {}; // { chat: 'id-de-modelo', investigar: …, imagen: … }; vacío = auto
const guardarCfg = () => writeFileSync(ARCHIVO_CFG, JSON.stringify(cfg, null, 2), { mode: 0o600 });
guardarCfg();

const gateway = new Gateway();
const almacen = new Almacen(path.join(DATOS, 'lab.db'));
const skills = new Skills(path.join(AQUI, 'skills'), path.join(DATOS, 'skills'));
const proveedores = new Proveedores(gateway);
const tareas = {
  obtener: id => cfg.tareas[id] || 'auto',
  todas: () => ({ ...cfg.tareas }),
  poner: (id, modelo) => { if (!modelo || modelo === 'auto') delete cfg.tareas[id]; else cfg.tareas[id] = modelo; guardarCfg(); },
};

// FreeLLMAPI tarda en arrancar en el teléfono (a veces más que laboratorio.ia): se le espera en vez de fallar.
async function asegurarGateway(emitir, señal) {
  if (await gateway.enLinea()) return;
  emitir('estado', { texto: 'Esperando a que FreeLLMAPI termine de arrancar…' });
  for (let i = 0; i < 45 && !señal?.aborted; i++) {
    await new Promise(ok => setTimeout(ok, 2000));
    if (await gateway.enLinea()) return;
  }
  throw Object.assign(new Error('FreeLLMAPI no responde'), { code: 'GATEWAY_CAIDO' });
}

function explicarFreeLLMAPI(e) {
  const m = e?.message || String(e);
  const causa = e?.cause?.code || e?.cause?.message || e?.code || '';
  if (causa === 'GATEWAY_CAIDO' || /ECONNREFUSED/.test(causa)) return 'FreeLLMAPI no responde en 127.0.0.1:31415 (lleva más de 90 s sin arrancar). Reinicia el servidor en Ajustes → Termux, o mira el registro.';
  if (/fetch failed/i.test(m)) return `Falló la conexión con FreeLLMAPI${causa ? ` (${causa})` : ''}. Prueba de nuevo; si se repite, reinicia el servidor en Ajustes → Termux.`;
  return null;
}

const nucleo = crearNucleo({
  gateway, almacen, skills, tareas,
  presupuesto: Number(process.env.LAB_PRESUPUESTO) || 40_000,
  antesDeResponder: asegurarGateway,
  explicarExtra: explicarFreeLLMAPI,
  guardarImagen: (datos, tipo) => {
    const nombre = `${randomUUID()}${EXT[tipo] || '.png'}`;
    writeFileSync(path.join(MEDIA, nombre), datos);
    return `/media/${nombre}`;
  },
  depurar: process.env.LAB_DEBUG ? m => console.log('[contexto]', JSON.stringify(m.map(x => ({ rol: x.role, largo: x.content.length, cola: x.content.slice(-400) })), null, 1)) : null,
});
const explicarError = nucleo.explicarError;

// ── Utilidades HTTP ────────────────────────────────────────────────────────
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
};
const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

function enviar(res, estado, datos) {
  res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(datos));
}

async function leerCuerpo(req, limite = 1_000_000) {
  let total = 0;
  const partes = [];
  for await (const p of req) {
    total += p.length;
    if (total > limite) throw Object.assign(new Error('Petición demasiado grande'), { estado: 413 });
    partes.push(p);
  }
  if (!partes.length) return {};
  try { return JSON.parse(Buffer.concat(partes).toString('utf8')); } catch { throw Object.assign(new Error('JSON no válido'), { estado: 400 }); }
}

function archivoEstatico(res, base, relativo, cache) {
  const ruta = path.normalize(path.join(base, relativo));
  if (!ruta.startsWith(base) || !existsSync(ruta) || !statSync(ruta).isFile()) return false;
  res.writeHead(200, {
    'Content-Type': TIPOS[path.extname(ruta).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': cache,
  });
  createReadStream(ruta).pipe(res);
  return true;
}

// ── Acceso ─────────────────────────────────────────────────────────────────
const esLocal = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const galleta = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(p => p.length === 2));
const autorizado = req => esLocal(req) || Boolean(cfg.sesiones[galleta(req).lab]);
const intentos = new Map();

function direcciones() {
  const salida = [];
  for (const [nombre, lista] of Object.entries(os.networkInterfaces())) {
    for (const d of lista || []) {
      if (d.family !== 'IPv4' || d.internal) continue;
      const tipo = /^wlan/.test(nombre) ? 'Wi-Fi'
        : /^(ap|swlan|softap)/.test(nombre) ? 'Punto de acceso'
        : /^(ccmni|rmnet|v4-)/.test(nombre) ? 'Datos móviles'
        : /^(eth|usb|rndis)/.test(nombre) ? 'Cable / USB' : nombre;
      salida.push({ interfaz: nombre, tipo, url: `http://${d.address}:${cfg.puerto}` });
    }
  }
  // Primero las que sirven para otros equipos de la red.
  const orden = { 'Wi-Fi': 0, 'Punto de acceso': 1, 'Cable / USB': 2 };
  return salida.sort((a, b) => (orden[a.tipo] ?? 9) - (orden[b.tipo] ?? 9));
}

// Respuesta en Server-Sent Events para el chat.
async function sse(res, ejecutar) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const corte = new AbortController();
  res.on('close', () => { if (!res.writableFinished) corte.abort(); });
  const emitir = (evento, datos) => { if (!res.writableEnded) res.write(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`); };
  const latido = setInterval(() => { if (!res.writableEnded) res.write(': latido\n\n'); }, 15_000);
  try { await ejecutar(emitir, corte.signal); } finally { clearInterval(latido); res.end(); }
}

// ── Rutas ──────────────────────────────────────────────────────────────────
async function api(req, res, ruta, url) {
  const metodo = req.method;

  if (ruta === '/api/acceso' && metodo === 'POST') {
    const ip = req.socket.remoteAddress;
    const i = intentos.get(ip) || { n: 0, hasta: 0 };
    if (i.hasta > Date.now()) return enviar(res, 429, { error: 'Demasiados intentos. Espera 10 minutos.' });
    const { pin } = await leerCuerpo(req);
    const ok = typeof pin === 'string' && pin.length === cfg.pin.length && timingSafeEqual(Buffer.from(pin), Buffer.from(cfg.pin));
    if (!ok) {
      i.n += 1;
      if (i.n >= 5) { i.n = 0; i.hasta = Date.now() + 10 * 60_000; }
      intentos.set(ip, i);
      return enviar(res, 401, { error: 'PIN incorrecto' });
    }
    intentos.delete(ip);
    const token = randomBytes(24).toString('hex');
    cfg.sesiones[token] = Date.now();
    guardarCfg();
    res.setHeader('Set-Cookie', `lab=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`);
    return enviar(res, 200, { ok: true });
  }

  if (ruta === '/api/estado' && metodo === 'GET') {
    const local = esLocal(req);
    return enviar(res, 200, {
      version: VERSION,
      nube: false,
      autorizado: autorizado(req),
      local,
      gateway: autorizado(req) ? await gateway.enLinea() : undefined,
      direcciones: local ? direcciones() : undefined,
      pin: local ? cfg.pin : undefined,
    });
  }

  if (!autorizado(req)) return enviar(res, 401, { error: 'Necesitas el PIN de laboratorio.ia' });

  if (ruta === '/api/proveedores' && metodo === 'GET') return enviar(res, 200, await proveedores.lista());
  if (ruta === '/api/proveedores/sesion' && metodo === 'POST') {
    const { email, password } = await leerCuerpo(req);
    if (!email || !password) return enviar(res, 400, { error: 'Escribe email y contraseña' });
    return enviar(res, 200, await proveedores.entrar(email, password));
  }
  if (ruta === '/api/proveedores/gratis' && metodo === 'POST') return enviar(res, 200, { activados: await proveedores.activarGratis() });
  if (ruta === '/api/proveedores/clave' && metodo === 'POST') {
    const { plataforma, clave } = await leerCuerpo(req);
    if (!plataforma || !clave?.trim()) return enviar(res, 400, { error: 'Falta la clave' });
    return enviar(res, 200, await proveedores.agregar(plataforma, clave.trim()));
  }

  const comun = await rutasComunes(nucleo, { almacen, skills, tareas }, { metodo, ruta, cuerpo: () => leerCuerpo(req) });
  if (comun?.sse) return sse(res, comun.sse);
  if (comun?.archivo) {
    res.writeHead(200, { 'Content-Type': comun.archivo.tipo, 'Content-Disposition': `attachment; filename="${comun.archivo.nombre}"`, 'Cache-Control': 'no-store' });
    return res.end(comun.archivo.texto);
  }
  if (comun) return enviar(res, comun.estado, comun.datos);

  if (ruta === '/api/registro' && metodo === 'GET' && esLocal(req)) {
    const cola = (archivo, n) => {
      try { return readFileSync(archivo, 'utf8').split('\n').slice(-n).join('\n'); } catch { return '(sin registro)'; }
    };
    return enviar(res, 200, {
      lab: cola('/data/data/com.termux/files/home/.cardon-lab.log', 40),
      freellmapi: cola('/root/freellmapi/logs/server.log', 40),
    });
  }

  if (ruta === '/api/sesiones' && metodo === 'DELETE' && esLocal(req)) {
    cfg.sesiones = {};
    cfg.pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
    guardarCfg();
    return enviar(res, 200, { pin: cfg.pin });
  }

  enviar(res, 404, { error: 'Ruta desconocida' });
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://lab');
  const ruta = decodeURIComponent(url.pathname);
  try {
    if (ruta.startsWith('/api/')) return await api(req, res, ruta, url);
    // El APK es público: se descarga sin PIN para instalarlo en otros teléfonos de la red.
    if (ruta === '/descargar' || ruta === '/lab.ia.apk') {
      if (!existsSync(APK)) return enviar(res, 404, { error: 'El APK aún no está compilado' });
      res.writeHead(200, {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Disposition': `attachment; filename="lab.ia-${VERSION}.apk"`,
        'Content-Length': statSync(APK).size,
        'Cache-Control': 'no-cache',
      });
      createReadStream(APK).pipe(res);
      return;
    }
    if (ruta.startsWith('/media/')) {
      if (!autorizado(req)) return enviar(res, 401, { error: 'Sin acceso' });
      if (!archivoEstatico(res, MEDIA, ruta.slice(7), 'private, max-age=31536000, immutable')) enviar(res, 404, { error: 'No existe' });
      return;
    }
    if (!archivoEstatico(res, PUBLICO, ruta === '/' ? 'index.html' : ruta, 'no-cache')) {
      archivoEstatico(res, PUBLICO, 'index.html', 'no-cache');
    }
  } catch (e) {
    if (!res.headersSent) enviar(res, e.estado || 500, { error: explicarError(e) });
    else res.end();
  }
});

servidor.listen(cfg.puerto, '0.0.0.0', () => {
  console.log(`laboratorio.ia ${VERSION}`);
  console.log(`  En este teléfono: http://127.0.0.1:${cfg.puerto}`);
  for (const d of direcciones()) console.log(`  ${d.tipo.padEnd(15)} ${d.url}`);
  console.log(`  PIN para otros equipos: ${cfg.pin}`);
  console.log(`  Descargar el APK: <dirección>/descargar`);
});
