// Red de la nube para comun/fuentes y comun/verificacion (fetch de Workers).
import { configurarRed } from '../../comun/red.mjs';

const UA = 'Mozilla/5.0 (compatible; laboratorio.ia/1.4; +https://github.com/ReserchLab/lab-ia)';
// Plan gratuito: 10 ms de CPU por petición. Analizar páginas enormes no cabe, así que se leen
// como mucho 150 KB de HTML (de sobra para el resumen y los primeros párrafos).
const MAX_HTML = 150_000;

async function obtener(url, tipo, _saltos = 0, opc = {}) {
  const max = Math.min(opc.max || 2_000_000, tipo === 'json' ? 2_000_000 : MAX_HTML);
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: tipo === 'json' ? 'application/json' : 'text/html,application/xhtml+xml,*/*;q=0.8' },
    redirect: 'follow',
    signal: AbortSignal.timeout(opc.total || 25_000),
  });
  const partes = [];
  let total = 0;
  const lector = res.body?.getReader();
  try {
    while (lector) {
      const { value, done } = await lector.read();
      if (done) break;
      total += value.length;
      partes.push(value);
      if (total >= max) { await lector.cancel(); break; }
    }
  } catch (e) {
    if (!(opc.parcial && partes.length)) throw e; // con parcial se usa lo que llegó a tiempo
  }
  const bytes = new Uint8Array(Math.min(total, max));
  let o = 0;
  for (const p of partes) { const t = p.subarray(0, bytes.length - o); bytes.set(t, o); o += t.length; if (o >= bytes.length) break; }
  return { estado: res.status, tipo: res.headers.get('content-type') || '', final: res.url, texto: new TextDecoder().decode(bytes) };
}

async function pedir(url, tipo = 'json', intento = 1) {
  let r;
  try {
    r = await obtener(url, tipo);
  } catch (e) {
    if (intento < 2) return pedir(url, tipo, intento + 1);
    throw new Error(e.name === 'TimeoutError' ? 'sin respuesta a tiempo' : e.message);
  }
  if ((r.estado === 429 || r.estado >= 500) && intento < 2) {
    await new Promise(ok => setTimeout(ok, 1500));
    return pedir(url, tipo, intento + 1);
  }
  if (r.estado >= 400) throw new Error(`HTTP ${r.estado}`);
  if (tipo !== 'json') return r.texto;
  try { return JSON.parse(r.texto); } catch { throw new Error('respuesta no válida (servicio ocupado)'); }
}

configurarRed({ pedir, obtener });
