// Entrenamiento automático: un cron (cada minuto) avanza un trabajo por invocación.
//   destilando → laboratorio.ia genera preguntas de tus temas y las responde investigando (3 por paso)
//   lanzar     → envía el script de entrenamiento a tu Kaggle (GPU gratis) con un enlace de un solo uso a tus datos
//   entrenando → consulta el estado en Kaggle
//   subiendo   → descarga el adaptador LoRA y lo sube a tu Workers AI; queda como ★ tu modelo
// Cada paso cabe en los límites del plan gratuito (50 subpeticiones, 15 min por invocación).
import { crearNucleo, jsonDe } from '../../comun/nucleo.mjs';
import { AlmacenMemoria } from '../../comun/almacen-memoria.mjs';
import { BASES_LORA } from '../../comun/entrenamiento.mjs';
import SCRIPT from '../../herramientas/entrenar/kaggle.py';

export const TEMAS = [
  'biología molecular y genética', 'biomedicina y ensayos clínicos', 'farmacología y desarrollo de fármacos',
  'ecología y evolución', 'neurociencia', 'microbiología e inmunología', 'bioinformática y métodos de laboratorio',
];
const BASES = { '@cf/meta/llama-3.2-3b-instruct': 'llama-3.2-3b', '@cf/mistral/mistral-7b-instruct-v0.2-lora': 'mistral-7b', '@cf/google/gemma-7b-it-lora': 'gemma-7b', '@cf/google/gemma-2b-it-lora': 'gemma-2b' };
const ACTIVAS = "('destilando','lanzar','entrenando','subiendo')";
const KAGGLE = 'https://api.kaggle.com/v1/kernels.KernelsApiService/';
const HORAS_MAX = 30; // un trabajo que no avanza en este tiempo se da por perdido
const POR_PASO = 3; // preguntas por invocación del cron
const BLOQUEO_MS = 14 * 60_000; // un paso nunca dura más (15 min es el máximo de un cron)

const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const sha = async t => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)));

// ── Claves ────────────────────────────────────────────────────────────────
/** «usuario:clave» (kaggle.json) o «usuario:KGAT_…» (token nuevo). También acepta el JSON de kaggle.json. */
export function normalizarKaggle(texto) {
  const t = String(texto).trim();
  try { const j = JSON.parse(t); if (j.username && j.key) return `${j.username}:${j.key}`; } catch { /* no es JSON */ }
  return t;
}
function kaggleDe(clave) {
  const i = clave.indexOf(':');
  if (i < 1) throw new Error('La clave de Kaggle va como usuario:clave (o pega el contenido de kaggle.json)');
  const usuario = clave.slice(0, i);
  const secreto = clave.slice(i + 1);
  return { usuario, auth: secreto.startsWith('KGAT_') ? `Bearer ${secreto}` : `Basic ${btoa(`${usuario}:${secreto}`)}` };
}
export async function kaggle(clave, metodo, cuerpo) {
  const { auth } = kaggleDe(clave);
  const r = await fetch(KAGGLE + metodo, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth, 'User-Agent': 'kaggle-api/v1.7.0' }, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(60_000) });
  const t = await r.text();
  let j;
  try { j = JSON.parse(t); } catch { j = { message: t.slice(0, 300) }; }
  if (r.status === 401) throw new Error('Kaggle rechazó la clave (HTTP 401). Debe ser usuario:clave de kaggle.json o usuario:KGAT_… (Kaggle → Settings → API).');
  if (r.status === 403) throw new Error(`Kaggle no lo permite (HTTP 403)${j.message ? `: ${j.message}` : ''}. Para usar GPU e Internet verifica tu teléfono en kaggle.com/settings.`);
  if (!r.ok || j.code >= 400) throw new Error(`Kaggle: ${j.message || `HTTP ${r.status}`}`);
  return j;
}
export async function probarKaggle(clave) {
  const q = await kaggle(normalizarKaggle(clave), 'GetAcceleratorQuotaStatistics', {});
  const g = q.gpuQuota || {};
  const horas = s => Math.round((Number(String(s ?? 0).replace(/s$/, '')) || 0) / 360) / 10;
  return { ok: true, detalle: g.totalQuota ? `GPU: ${horas(g.usedQuota)} de ${horas(g.totalQuota)} h usadas esta semana` : '' };
}
/** «ID_DE_CUENTA:TOKEN» con permiso Workers AI: Edit; o los secretos CF_ACCOUNT_ID y CF_API_TOKEN del Worker. */
async function credencialesCloudflare(env, gateway) {
  if (env.CF_ACCOUNT_ID && env.CF_API_TOKEN) return { cuenta: env.CF_ACCOUNT_ID, token: env.CF_API_TOKEN };
  const c = await gateway.claveDe('cloudflare');
  if (!c?.includes(':')) return null;
  const [cuenta, token] = [c.slice(0, c.indexOf(':')), c.slice(c.indexOf(':') + 1)];
  return { cuenta: cuenta.trim(), token: token.trim() };
}
export async function probarCloudflare(clave) {
  const i = clave.indexOf(':');
  if (i < 1) return { ok: false, detalle: 'Formato: ID_DE_CUENTA:TOKEN' };
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${clave.slice(0, i).trim()}/ai/finetunes`, { headers: { Authorization: `Bearer ${clave.slice(i + 1).trim()}` } });
  return { ok: r.ok, detalle: r.ok ? '' : `HTTP ${r.status}: el token necesita «Workers AI: Edit»` };
}

// ── Trabajos ──────────────────────────────────────────────────────────────
async function guardar(env, t) {
  await env.DB.prepare('UPDATE entrenamientos SET fase = ?, datos = ?, actualizado = ? WHERE id = ?').bind(t.fase, JSON.stringify(t.datos), Date.now(), t.id).run();
}
function anotar(t, texto) {
  t.datos.registro = [...(t.datos.registro || []), { t: Date.now(), texto: String(texto).slice(0, 400) }].slice(-40);
}
const leer = f => (f ? { ...f, datos: JSON.parse(f.datos) } : null);

export function vistaPublica(t) {
  if (!t) return null;
  const { token: _t, pendientes, ...d } = t.datos;
  return { id: t.id, fase: t.fase, creado: t.creado, actualizado: t.actualizado, ...d, pendientes: pendientes?.length || 0 };
}

export async function ultimo(env, usuario) {
  return leer(await env.DB.prepare('SELECT * FROM entrenamientos WHERE usuario = ? ORDER BY creado DESC LIMIT 1').bind(usuario).first());
}

export async function crear(env, usuario, origen, gateway, p) {
  if (await env.DB.prepare(`SELECT 1 FROM entrenamientos WHERE usuario = ? AND fase IN ${ACTIVAS}`).bind(usuario).first()) {
    throw Object.assign(new Error('Ya hay un entrenamiento en marcha'), { estado: 409 });
  }
  if (!(await gateway.claveDe('kaggle'))) throw Object.assign(new Error('Falta tu clave de Kaggle (Ajustes → Modelos y proveedores → Kaggle)'), { estado: 400 });
  if (!(await credencialesCloudflare(env, gateway))) throw Object.assign(new Error('Falta la clave de Cloudflare para subir el modelo (Proveedores → Cloudflare API: ID_DE_CUENTA:TOKEN)'), { estado: 400 });
  const base = BASES[p.base] ? p.base : BASES_LORA[0].id;
  const temas = (Array.isArray(p.temas) ? p.temas : String(p.temas || '').split(/[,\n;]/)).map(s => s.trim()).filter(Boolean).slice(0, 20);
  const fecha = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const nombre = `${String(p.nombre || 'mi-laboratorio').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'mi-laboratorio'}-${fecha}`;
  const objetivo = Math.max(0, Math.min(400, Number(p.objetivo ?? 150) || 0));
  const t = {
    id: crypto.randomUUID(), fase: objetivo ? 'destilando' : 'lanzar',
    datos: { objetivo, hechos: 0, fallos: 0, temas: temas.length ? temas : TEMAS, temaIdx: 0, pendientes: [], base, nombre, epocas: Math.max(1, Math.min(5, Number(p.epocas) || 2)), registro: [] },
  };
  anotar(t, objetivo ? `Empezando: generar ${objetivo} ejemplos sobre ${t.datos.temas.length} temas y entrenar ${base}` : `Empezando: entrenar ${base} solo con tus conversaciones`);
  const ahora = Date.now();
  await env.DB.prepare('INSERT INTO entrenamientos (id, usuario, fase, datos, origen, creado, actualizado, bloqueo) VALUES (?, ?, ?, ?, ?, ?, ?, 0)')
    .bind(t.id, usuario, t.fase, JSON.stringify(t.datos), origen, ahora, ahora).run();
  return t;
}

export async function cancelar(env, usuario) {
  const t = leer(await env.DB.prepare(`SELECT * FROM entrenamientos WHERE usuario = ? AND fase IN ${ACTIVAS} ORDER BY creado DESC LIMIT 1`).bind(usuario).first());
  if (!t) return null;
  t.fase = 'cancelado';
  anotar(t, 'Cancelado por ti');
  await guardar(env, t);
  await env.DB.prepare('UPDATE entrenamientos SET token_hash = NULL WHERE id = ?').bind(t.id).run();
  return t;
}

/** Datos para el script de Kaggle: solo con el enlace de un solo uso de un trabajo en marcha. */
export async function datosPorToken(env, token, crearContexto) {
  if (!/^[a-f0-9]{48}$/.test(token)) return null;
  const f = await env.DB.prepare(`SELECT * FROM entrenamientos WHERE token_hash = ? AND fase IN ${ACTIVAS}`).bind(await sha(token)).first();
  if (!f) return null;
  const { nucleo } = crearContexto(env, { id: f.usuario });
  const { sft, dpo } = await nucleo.datosEntrenamiento();
  return { sft, dpo: dpo.map(({ prompt, chosen, rejected }) => ({ prompt, chosen, rejected })) };
}

// ── Pasos ─────────────────────────────────────────────────────────────────
async function destilar(env, t, ctx) {
  const d = t.datos;
  if (d.hechos >= d.objetivo) { t.fase = 'lanzar'; anotar(t, `Datos listos: ${d.hechos} ejemplos generados`); return; }
  if (d.fallos > Math.max(20, d.objetivo)) throw new Error(`Demasiados fallos generando datos (${d.fallos}). ¿Se agotaron los proveedores? Revisa tus claves.`);

  if (!d.pendientes.length) {
    const tema = d.temas[d.temaIdx++ % d.temas.length];
    const { texto, razonamiento } = await ctx.gateway.completar([
      { role: 'system', content: 'Escribes preguntas de investigación científica en español para entrenar a un asistente. Responde SOLO con JSON: {"preguntas":["…"]}' },
      { role: 'user', content: `Escribe 10 preguntas distintas y concretas sobre «${tema}», como las haría un investigador o estudiante de posgrado: mecanismos, evidencia clínica o experimental, comparación de métodos, controversias, datos cuantitativos y aplicaciones. Cada una de 10 a 30 palabras, que se pueda responder con literatura científica. Variadas: no repitas el mismo subtema.` },
    ], { modelo: await ctx.tareas.obtener('rapido'), max: 3000, temperatura: 0.9, tiempo: 120_000 });
    const j = jsonDe(texto) || jsonDe(razonamiento);
    const preguntas = (j?.preguntas || []).map(String).map(s => s.trim()).filter(s => s.length > 15 && s.length < 400).slice(0, 10);
    if (!preguntas.length) { d.fallos++; anotar(t, `No salieron preguntas sobre «${tema}»; probando otro tema`); return; }
    d.pendientes = preguntas;
    anotar(t, `${preguntas.length} preguntas nuevas sobre «${tema}»`);
    return;
  }

  // Varias preguntas a la vez: cada una ~10 subpeticiones, dentro del límite de 50 por invocación.
  const lote = d.pendientes.splice(0, Math.min(POR_PASO, d.objetivo - d.hechos));
  const tema = d.temas[(d.temaIdx - 1 + d.temas.length) % d.temas.length];
  const resultados = await Promise.all(lote.map(p => responder(p, ctx).catch(e => ({ motivo: e.message }))));
  resultados.forEach((r, k) => {
    if (r.motivo) { d.fallos++; anotar(t, `Descartada (${r.motivo}): ${lote[k].slice(0, 80)}`); }
  });
  const buenos = resultados.filter(r => r.mensajes);
  if (buenos.length) {
    await env.DB.batch(buenos.map(r => env.DB.prepare('INSERT INTO sinteticos (id, usuario, trabajo, datos, creado) VALUES (?, ?, ?, ?, ?)')
      .bind(r.id, t.usuario, t.id, JSON.stringify({ tema, mensajes: r.mensajes }), Date.now())));
    const antes = d.hechos;
    d.hechos += buenos.length;
    if (Math.floor(d.hechos / 10) > Math.floor(antes / 10) || antes === 0) anotar(t, `${d.hechos}/${d.objetivo} ejemplos (último: ${buenos[0].fuentes} fuentes, ${buenos[0].modelo})`);
  }
}

/** Una pregunta respondida investigando (ejemplo SFT) y, si se puede, la misma sin fuentes (par DPO). */
async function responder(pregunta, ctx) {
  // El mismo núcleo que el chat, con un almacén en memoria: investiga y responde sin crear conversaciones.
  const mem = new AlmacenMemoria();
  const nucleo = crearNucleo({ gateway: ctx.gateway, almacen: mem, skills: ctx.skills, tareas: ctx.tareas, verificacionAparte: true, guardarImagen: async () => '' });
  const prep = await nucleo.prepararChat({ texto: pregunta, modo: 'investigar' });
  let error = null;
  await nucleo.chat(prep, (ev, x) => { if (ev === 'error') error = x.mensaje; }, AbortSignal.timeout(400_000));
  const [mu, ma] = mem.conversacion(prep.conv).mensajes;
  if (!ma?.contenido || ma.contenido.trim().length < 300 || !ma.meta.fuentes?.length) {
    return { motivo: error || (ma?.meta?.fuentes?.length ? 'respuesta corta' : 'sin fuentes') };
  }
  let peor = null;
  try {
    const r = await ctx.gateway.completar([{ role: 'user', content: pregunta }], { modelo: await ctx.tareas.obtener('rapido'), max: 1500, temperatura: 1, tiempo: 90_000 });
    if (r.texto?.trim().length > 100) peor = { texto: r.texto.trim().slice(0, 12_000), modelo: r.modelo, origen: 'sin-fuentes' };
  } catch { /* sin par: el ejemplo SFT sirve igual */ }
  const id = crypto.randomUUID();
  return {
    id, modelo: ma.meta.modelo, fuentes: ma.meta.fuentes.length,
    mensajes: [
      { id: `${id}-u`, rol: 'user', contenido: mu.contenido, meta: {} },
      { id: `${id}-a`, rol: 'assistant', contenido: ma.contenido, meta: { modo: 'investigar', modelo: ma.meta.modelo, fuentes: ma.meta.fuentes, sintetico: true, ...(peor ? { descartadas: [peor] } : {}) } },
    ],
  };
}

async function lanzar(env, t, ctx) {
  const d = t.datos;
  const { sft, dpo } = await ctx.nucleo.datosEntrenamiento();
  if (sft.length < 10) throw new Error(`Solo hay ${sft.length} ejemplos: hacen falta al menos 10. Genera más datos o usa más el chat.`);
  const clave = normalizarKaggle(await ctx.gateway.claveDe('kaggle'));
  const { usuario } = kaggleDe(clave);
  const token = hex(crypto.getRandomValues(new Uint8Array(24)));
  await env.DB.prepare('UPDATE entrenamientos SET token_hash = ? WHERE id = ?').bind(await sha(token), t.id).run();
  const slug = `laboratorio-ia-${d.nombre}`.slice(0, 50).replace(/-$/, '');
  const cabecera = `DATOS_URL = ${JSON.stringify(`${t.origen}/api/entrenamiento/datos/${token}`)}\nBASE = ${JSON.stringify(BASES[d.base])}\nEPOCAS = ${d.epocas}\nMAX_TOKENS = 4096\n\n`;
  const r = await kaggle(clave, 'SaveKernel', {
    slug: `${usuario}/${slug}`, newTitle: slug, text: cabecera + SCRIPT, language: 'python', kernelType: 'script',
    isPrivate: true, enableGpu: true, enableInternet: true, datasetDataSources: [], competitionDataSources: [], kernelDataSources: [], modelDataSources: [], categoryIds: [],
  });
  if (r.error) throw new Error(`Kaggle: ${r.error}`);
  const [dueño, nombreKernel] = String(r.ref || `${usuario}/${slug}`).replace(/^\/?code\//, '').split('/');
  d.kaggle = { usuario: dueño, slug: nombreKernel, url: r.url || `https://www.kaggle.com/code/${dueño}/${nombreKernel}` };
  d.ejemplos = { sft: sft.length, dpo: dpo.length };
  t.fase = 'entrenando';
  anotar(t, `Enviado a Kaggle con ${sft.length} ejemplos SFT y ${dpo.length} pares DPO. Esperando GPU…`);
}

async function vigilar(env, t, ctx) {
  const d = t.datos;
  const clave = normalizarKaggle(await ctx.gateway.claveDe('kaggle'));
  const s = await kaggle(clave, 'GetKernelSessionStatus', { userName: d.kaggle.usuario, kernelSlug: d.kaggle.slug });
  const estado = String(s.status || '').toUpperCase();
  if (estado !== d.estadoKaggle) { d.estadoKaggle = estado; anotar(t, `Kaggle: ${estado.replace(/^KERNEL_WORKER_STATUS_/, '').toLowerCase()}`); }
  if (/COMPLETE/.test(estado)) t.fase = 'subiendo';
  else if (/ERROR|CANCEL/.test(estado)) {
    const salida = await kaggle(clave, 'ListKernelSessionOutput', { userName: d.kaggle.usuario, kernelSlug: d.kaggle.slug }).catch(() => ({}));
    const res = await resultadoDe(salida);
    throw new Error(`El entrenamiento falló en Kaggle: ${res?.error || s.failureMessage || 'sin detalle'}${res?.fase ? ` (fase ${res.fase})` : ''}. Registro: ${d.kaggle.url}`);
  }
}

async function resultadoDe(salida) {
  const f = (salida.files || []).find(x => /resultado\.json$/.test(x.fileName));
  if (!f) return null;
  return fetch(f.url).then(r => r.json()).catch(() => null);
}

async function subir(env, t, ctx) {
  const d = t.datos;
  const clave = normalizarKaggle(await ctx.gateway.claveDe('kaggle'));
  const salida = await kaggle(clave, 'ListKernelSessionOutput', { userName: d.kaggle.usuario, kernelSlug: d.kaggle.slug });
  const archivo = n => (salida.files || []).find(x => x.fileName?.split('/').pop() === n);
  d.resultado = await resultadoDe(salida);
  const pesos = archivo('adapter_model.safetensors');
  const config = archivo('adapter_config.json');
  if (!pesos || !config) throw new Error(`Kaggle terminó pero no dejó el adaptador${d.resultado?.error ? `: ${d.resultado.error}` : ''}. Registro: ${d.kaggle.url}`);
  const cf = await credencialesCloudflare(env, ctx.gateway);
  if (!cf) throw new Error('Falta la clave de Cloudflare para subir el modelo');
  const api = `https://api.cloudflare.com/client/v4/accounts/${cf.cuenta}/ai/finetunes`;
  const h = { Authorization: `Bearer ${cf.token}` };
  const creado = await fetch(api, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: d.base, name: d.nombre, description: `laboratorio.ia · ${d.ejemplos?.sft || 0} SFT · ${d.ejemplos?.dpo || 0} DPO` }) }).then(r => r.json());
  if (!creado.success) throw new Error(`Cloudflare no creó el ajuste fino: ${JSON.stringify(creado.errors).slice(0, 300)}`);
  for (const [nombre, f] of [['adapter_config.json', config], ['adapter_model.safetensors', pesos]]) {
    const datos = await fetch(f.url);
    if (!datos.ok) throw new Error(`No se pudo descargar ${nombre} de Kaggle (HTTP ${datos.status})`);
    const form = new FormData();
    form.append('file_name', nombre);
    form.append('file', new Blob([await datos.arrayBuffer()]), nombre);
    const s = await fetch(`${api}/${creado.result.id}/finetune-assets/`, { method: 'POST', headers: h, body: form }).then(r => r.json());
    if (!s.success) throw new Error(`Cloudflare rechazó ${nombre}: ${JSON.stringify(s.errors).slice(0, 300)}`);
  }
  const lista = (await ctx.gateway.misLoras()).filter(l => l.lora !== d.nombre);
  lista.unshift({ lora: d.nombre, base: d.base, etiqueta: d.nombre, creado: Date.now(), ejemplos: d.ejemplos });
  await ctx.gateway.ponerLoras(lista);
  d.lora = d.nombre;
  const prueba = await ctx.nucleo.probarModelo({ modelo: `workersai/${d.base}#lora:${d.nombre}` });
  d.prueba = prueba;
  t.fase = 'listo';
  await env.DB.prepare('UPDATE entrenamientos SET token_hash = NULL WHERE id = ?').bind(t.id).run();
  anotar(t, prueba.ok ? `★ ${d.nombre} listo y respondiendo (${prueba.ms} ms)` : `★ ${d.nombre} subido; aún no responde: ${prueba.error}`);
}

/** Cron: avanza el trabajo activo que lleva más tiempo esperando. */
export async function avanzar(env, crearContexto) {
  const ahora = Date.now();
  const t = leer(await env.DB.prepare(`SELECT * FROM entrenamientos WHERE fase IN ${ACTIVAS} AND bloqueo < ? ORDER BY actualizado LIMIT 1`).bind(ahora).first());
  if (!t) return;
  // Bloqueo: si un paso tarda más de un minuto, el cron siguiente no toma el mismo trabajo.
  const tomado = await env.DB.prepare('UPDATE entrenamientos SET bloqueo = ? WHERE id = ? AND bloqueo = ?').bind(ahora + BLOQUEO_MS, t.id, t.bloqueo).run();
  if (!tomado.meta.changes) return;
  const ctx = crearContexto(env, { id: t.usuario });
  try {
    if (ahora - t.actualizado > HORAS_MAX * 3600_000) throw new Error('El trabajo dejó de avanzar');
    if (t.fase === 'destilando') await destilar(env, t, ctx);
    else if (t.fase === 'lanzar') await lanzar(env, t, ctx);
    else if (t.fase === 'entrenando') await vigilar(env, t, ctx);
    else if (t.fase === 'subiendo') await subir(env, t, ctx);
  } catch (e) {
    t.fase = 'error';
    t.datos.error = String(e.message || e).slice(0, 1500);
    anotar(t, `Error: ${t.datos.error}`);
    await env.DB.prepare('UPDATE entrenamientos SET token_hash = NULL WHERE id = ?').bind(t.id).run();
  }
  await guardar(env, t);
  await env.DB.prepare('UPDATE entrenamientos SET bloqueo = 0 WHERE id = ?').bind(t.id).run();
}
