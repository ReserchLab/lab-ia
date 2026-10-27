// Red del servidor del teléfono para comun/fuentes y comun/verificacion.

import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';

const UA = 'Mozilla/5.0 (Linux; Android 14) laboratorio.ia/1.1';
const TIEMPO = 25_000;

// node:https en lugar de fetch: el fetch de Node corta la conexión a los 10 s, y en
// datos móviles conectar con EBI o NCBI a veces tarda más. El agente reutiliza conexiones.
const agente = new https.Agent({ keepAlive: true, maxSockets: 8, family: 4 });

// opc.max: bytes como máximo; opc.total: ms como máximo para toda la descarga. Con opc.parcial,
// al llegar a cualquiera de los dos se devuelve lo descargado hasta ese momento en vez de fallar.
export function obtener(url, tipo, saltos = 0, opc = {}) {
  return new Promise((resolver, rechazar) => {
    const u = new URL(url);
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.get(u, {
      agent: u.protocol === 'http:' ? undefined : agente,
      family: 4,
      headers: { 'User-Agent': UA, Accept: tipo === 'json' ? 'application/json' : 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Encoding': 'gzip, deflate, br' },
      timeout: TIEMPO,
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && saltos < 5) {
        res.resume();
        return resolver(obtener(new URL(res.headers.location, u).href, tipo, saltos + 1, opc));
      }
      const cod = (res.headers['content-encoding'] || '').toLowerCase();
      const flujo = cod === 'gzip' ? res.pipe(zlib.createGunzip()) : cod === 'deflate' ? res.pipe(zlib.createInflate()) : cod === 'br' ? res.pipe(zlib.createBrotliDecompress()) : res;
      const partes = [];
      let total = 0;
      let hecho = false;
      const max = opc.max || 3_000_000;
      const terminar = () => {
        if (hecho) return;
        hecho = true;
        clearTimeout(reloj);
        resolver({ estado: res.statusCode, tipo: res.headers['content-type'] || '', final: u.href, texto: Buffer.concat(partes).toString('utf8') });
      };
      const reloj = opc.total ? setTimeout(() => { if (opc.parcial) { terminar(); req.destroy(); } else req.destroy(new Error('sin respuesta a tiempo')); }, opc.total) : null;
      flujo.on('data', p => {
        total += p.length;
        if (total <= max) partes.push(p);
        else if (opc.parcial) { terminar(); req.destroy(); } else res.destroy();
      });
      flujo.on('end', terminar);
      flujo.on('error', e => { if (opc.parcial && partes.length) terminar(); else if (!hecho) { hecho = true; clearTimeout(reloj); rechazar(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('sin respuesta a tiempo')));
    req.on('error', e => rechazar(e));
  });
}

export async function pedir(url, tipo = 'json', intento = 1) {
  let r;
  try {
    r = await obtener(url, tipo);
  } catch (e) {
    if (intento < 2) return pedir(url, tipo, intento + 1);
    throw new Error(e.code === 'ECONNRESET' ? 'conexión cortada' : e.message);
  }
  if ((r.estado === 429 || r.estado >= 500) && intento < 2) {
    await new Promise(ok => setTimeout(ok, 1500));
    return pedir(url, tipo, intento + 1);
  }
  if (r.estado >= 400) throw new Error(`HTTP ${r.estado}`);
  if (tipo !== 'json') return r.texto;
  try { return JSON.parse(r.texto); } catch {
    if (intento < 2) return pedir(url, tipo, intento + 1);
    throw new Error('respuesta no válida (servicio ocupado)');
  }
}

import { configurarRed } from '../../comun/red.mjs';
configurarRed({ pedir, obtener });
