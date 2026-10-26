// Navegación y verificación: leer páginas de los resultados, comprobar enlaces y DOI,
// cuadrar las citas [n] con las fuentes y (en modo completo) revisar cada afirmación con IA.
import { red } from './red.mjs';

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function textoDeHtml(html) {
  let h = html.replace(/<(script|style|noscript|svg|nav|header|footer|form|aside)[\s\S]*?<\/\1>/gi, ' ');
  const cuerpo = h.match(/<article[\s\S]*?<\/article>/i)?.[0] || h.match(/<main[\s\S]*?<\/main>/i)?.[0] || h;
  const resumen = h.match(/<meta[^>]+name=["'](?:citation_abstract|description|dc\.description)["'][^>]+content=["']([^"']+)/i)?.[1] || '';
  const texto = cuerpo
    .replace(/<\/(p|div|li|h\d|tr|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#?\w+);/g, (m, e) => ENTIDADES[e] ?? (e.startsWith('#') ? String.fromCharCode(Number(e.slice(1)) || 32) : m))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
  return (resumen && !texto.includes(resumen.slice(0, 60)) ? resumen + '\n' : '') + texto;
}

/** Lee el texto principal de una página (o el resumen que publica). null si no se puede. */
export async function leerPagina(url, max = 3500) {
  try {
    // En datos móviles una página grande puede tardar minutos: basta con el principio.
    const r = await red.obtener(url, 'text', 0, { max: 600_000, total: 15_000, parcial: true });
    if (r.estado >= 400 || !/html|xml|text\/plain/i.test(r.tipo)) return null;
    const t = textoDeHtml(r.texto);
    return t.length > 200 ? t.slice(0, max) : null;
  } catch { return null; }
}

/** Números citados en la respuesta: [3], [1, 4], [2-5], [1][2]. */
export function citasDe(texto) {
  const usadas = new Set();
  for (const m of String(texto).matchAll(/\[(\d{1,2}(?:\s*[,–-]\s*\d{1,2})*)\]/g)) {
    for (const parte of m[1].split(/\s*,\s*/)) {
      const [a, b] = parte.split(/\s*[–-]\s*/).map(Number);
      if (b && b > a && b - a < 12) for (let i = a; i <= b; i++) usadas.add(i); else usadas.add(a);
    }
  }
  return [...usadas].sort((x, y) => x - y);
}

const palabras = t => new Set(String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]{4,}/g) || []);
function parecido(a, b) {
  const A = palabras(a), B = palabras(b);
  if (!A.size || !B.size) return 0;
  let comunes = 0;
  for (const w of A) if (B.has(w)) comunes++;
  return comunes / Math.min(A.size, B.size);
}

async function comprobarFuente(f) {
  const r = { n: f.n, url: f.url };
  try {
    const e = await red.obtener(f.url, 'text', 0, { max: 20_000, total: 15_000, parcial: true });
    r.http = e.estado;
    r.enlace = e.estado < 400 ? 'abre' : e.estado === 401 || e.estado === 403 || e.estado === 429 ? 'bloquea robots' : 'roto';
  } catch (err) { r.enlace = 'sin respuesta'; r.detalle = err.message; }
  if (f.doi) {
    try {
      const d = await red.pedir(`https://api.crossref.org/works/${encodeURIComponent(f.doi)}?mailto=lab@cardon.app`);
      const titulo = (d.message?.title || [])[0] || '';
      r.doi = parecido(titulo, f.titulo) >= 0.5 ? 'registrado' : 'registrado con otro título';
      r.tituloDoi = titulo;
    } catch (err) {
      r.doi = /404/.test(err.message) ? 'no existe' : 'no comprobado';
    }
  }
  // Verificada: el enlace abre (o bloquea robots pero el DOI está registrado con ese título).
  r.ok = r.enlace === 'abre' || (r.enlace === 'bloquea robots' && r.doi === 'registrado');
  return r;
}

// Busca el último objeto JSON válido con "afirmaciones" en un texto (quita ```json y basura alrededor).
function extraerJson(texto) {
  const limpio = String(texto || '').replace(/```(?:json)?/gi, '');
  for (let fin = limpio.lastIndexOf('}'); fin > 0; fin = limpio.lastIndexOf('}', fin - 1)) {
    for (let ini = limpio.indexOf('{'); ini >= 0 && ini < fin; ini = limpio.indexOf('{', ini + 1)) {
      try {
        const j = JSON.parse(limpio.slice(ini, fin + 1));
        if (Array.isArray(j.afirmaciones)) return j;
      } catch { /* sigue probando */ }
    }
  }
  return null;
}

const INSTRUCCION = `Eres un verificador de hechos científicos riguroso. Recibes una respuesta con citas [n] y el texto de las fuentes.
Extrae las afirmaciones factuales importantes (máximo 10) y decide si las fuentes citadas las respaldan.
Responde SOLO con JSON, sin texto antes ni después:
{"afirmaciones":[{"texto":"afirmación resumida","citas":[n],"veredicto":"respaldada|parcial|no_respaldada|sin_cita","nota":"por qué, en una frase"}],"resumen":"una o dos frases sobre la fiabilidad global"}
"parcial" = la fuente apoya solo una parte o con matices. "sin_cita" = afirmación factual sin [n].`;

async function revisarAfirmaciones(gateway, modelo, respuesta, fuentes) {
  const citadas = new Set(citasDe(respuesta));
  // Dos intentos: el segundo con menos texto, por si el modelo se queda sin tokens razonando.
  for (const [largoFuente, largoRespuesta] of [[1200, 9000], [500, 5000]]) {
    const bloque = fuentes.filter(f => citadas.has(f.n)).map(f => `[${f.n}] ${f.titulo}\n${(f.texto || f.resumen || '').slice(0, largoFuente)}`).join('\n\n');
    const r = await gateway.completar([
      { role: 'system', content: INSTRUCCION },
      { role: 'user', content: `RESPUESTA:\n${respuesta.slice(0, largoRespuesta)}\n\nFUENTES:\n${bloque}` },
    ], { modelo, max: 8000, temperatura: 0, tiempo: 240_000 });
    const j = extraerJson(r.texto) || extraerJson(r.razonamiento);
    if (!j) continue;
    const validos = new Set(['respaldada', 'parcial', 'no_respaldada', 'sin_cita']);
    return {
      afirmaciones: j.afirmaciones.slice(0, 12).map(a => ({
        texto: String(a.texto || '').slice(0, 400),
        citas: (a.citas || []).map(Number).filter(Number.isFinite),
        veredicto: validos.has(a.veredicto) ? a.veredicto : 'parcial',
        nota: String(a.nota || '').slice(0, 300),
      })),
      resumen: String(j.resumen || '').slice(0, 500),
      modeloRevisor: r.modelo,
    };
  }
  throw new Error('el verificador no devolvió un JSON válido');
}

/**
 * Verificación automática de una respuesta con fuentes.
 * completa = además revisa cada afirmación contra el texto de las fuentes (usa un modelo).
 */
export async function verificar({ respuesta, fuentes, completa, gateway, modelo }) {
  const usadas = citasDe(respuesta);
  const numeros = new Set(fuentes.map(f => f.n));
  const inexistentes = usadas.filter(n => !numeros.has(n));
  const citadas = fuentes.filter(f => usadas.includes(f.n));
  const enlaces = await Promise.all(citadas.map(comprobarFuente));
  const v = {
    fecha: Date.now(),
    citas: { usadas, inexistentes, sinUsar: fuentes.filter(f => !usadas.includes(f.n)).map(f => f.n) },
    enlaces,
  };
  if (completa && citadas.length) {
    try {
      Object.assign(v, await revisarAfirmaciones(gateway, modelo, respuesta, fuentes));
    } catch (e) {
      // Si el modelo de razonamiento no responde, se intenta con el automático antes de rendirse.
      if (modelo && modelo !== 'auto') {
        try { Object.assign(v, await revisarAfirmaciones(gateway, 'auto', respuesta, fuentes)); v.modeloRevision = 'auto'; } catch (e2) { v.errorRevision = e2.message; }
      } else v.errorRevision = e.message;
    }
  }
  const ok = enlaces.filter(e => e.ok).length;
  const malas = (v.afirmaciones || []).filter(a => a.veredicto === 'no_respaldada' || a.veredicto === 'sin_cita').length;
  v.estado = inexistentes.length || enlaces.some(e => e.enlace === 'roto' || e.doi === 'no existe') || malas ? 'revisar'
    : ok === enlaces.length ? 'verificada' : 'parcial';
  return v;
}
