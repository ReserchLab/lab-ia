// Enrutador de modelos de la nube (hace el papel de FreeLLMAPI en el teléfono).
// Workers AI va por el binding AI (sin clave, incluido en la cuenta de Cloudflare); el resto son
// APIs compatibles con OpenAI, unas sin clave y otras con la clave de cada usuario (cifrada en D1).
import { recomendados } from '../../comun/tareas.mjs';
import { cifrar, descifrar } from './cifrado.js';
import { esDePago, generarDePago, modelosDePago } from '../../comun/imagenes-pago.mjs';
import { normalizarKaggle, probarCloudflare, probarKaggle } from './entrenador.js';

// Modelos de Workers AI disponibles en el plan gratuito (probados uno a uno, 2026-10-26).
const WAI_TEXTO = [
  ['@cf/openai/gpt-oss-120b', 'gpt-oss 120B', 128_000],
  ['@cf/nvidia/nemotron-3-120b-a12b', 'Nemotron 3 120B', 256_000],
  ['@cf/qwen/qwen3.8-27b', 'Qwen 3.8 27B', 262_144],
  ['@cf/zai-org/glm-4.7-flash', 'GLM-4.7 Flash', 131_072],
  ['@cf/google/gemma-4-26b-a4b-it', 'Gemma 4 26B', 256_000],
  ['@cf/meta/llama-4-scout-17b-16e-instruct', 'Llama 4 Scout', 131_000],
  ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'Llama 3.3 70B', 24_000],
  ['@cf/mistralai/mistral-small-3.1-24b-instruct', 'Mistral Small 3.1', 128_000],
  ['@cf/qwen/qwq-32b', 'QwQ 32B (razonamiento)', 24_000],
  ['@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', 'DeepSeek R1 Distill 32B', 80_000],
  ['@cf/qwen/qwen3-30b-a3b-fp8', 'Qwen 3 30B A3B', 32_768],
  ['@cf/qwen/qwen2.5-coder-32b-instruct', 'Qwen 2.5 Coder 32B', 32_768],
  ['@cf/openai/gpt-oss-20b', 'gpt-oss 20B', 128_000],
  ['@cf/aisingapore/gemma-sea-lion-v4-27b-it', 'SEA-LION v4 27B', 128_000],
  ['@cf/ibm-granite/granite-4.0-h-micro', 'Granite 4.0 Micro', 131_000],
  ['@cf/meta/llama-3.1-8b-instruct-fp8', 'Llama 3.1 8B', 32_000],
].map(([id, nombre, contexto]) => ({ id: `workersai/${id}`, nombre: `${nombre} · Workers AI`, contexto }));

// entrada: forma de la petición; salida: JSON con base64 o binario.
const WAI_IMAGEN = [
  { id: '@cf/black-forest-labs/flux-1-schnell', nombre: 'FLUX.1 schnell', entrada: (p) => ({ prompt: p.prompt, steps: 8 }) },
  { id: '@cf/black-forest-labs/flux-2-dev', nombre: 'FLUX.2 dev', entrada: (p) => ({ prompt: p.prompt, width: p.ancho, height: p.alto }) },
  { id: '@cf/leonardo/lucid-origin', nombre: 'Leonardo Lucid Origin', entrada: (p) => ({ prompt: p.prompt, width: p.ancho, height: p.alto }) },
  { id: '@cf/leonardo/phoenix-1.0', nombre: 'Leonardo Phoenix 1.0', entrada: (p) => ({ prompt: p.prompt, width: p.ancho, height: p.alto }) },
  { id: '@cf/bytedance/stable-diffusion-xl-lightning', nombre: 'SDXL Lightning', entrada: (p) => ({ prompt: p.prompt, width: p.ancho, height: p.alto }) },
];

// tipo: chat (por defecto) | busqueda. filtro: qué modelos listar. anonima: clave cuando no hay una propia.
export const CATALOGO = [
  { id: 'workersai', nombre: 'Cloudflare Workers AI', sinClave: true, nota: 'incluido en tu cuenta: 10 000 neuronas al día gratis', enlace: 'https://dash.cloudflare.com/?to=/:account/ai/workers-ai' },
  { id: 'kilo', nombre: 'Kilo Gateway', base: 'https://api.kilo.ai/api/gateway', sinClave: true, filtro: id => /:free$/.test(id), nota: 'modelos :free sin clave', enlace: 'https://app.kilo.ai' },
  { id: 'pollinations', nombre: 'Pollinations', base: 'https://text.pollinations.ai/openai', sinClave: true, nota: 'texto sin clave; imágenes con clave gratis', enlace: 'https://enter.pollinations.ai', recomendado: 'Imágenes FLUX cuando se agota Workers AI (desde Cloudflare, sin clave casi siempre está al límite)' },
  { id: 'ovh', nombre: 'OVH AI Endpoints', base: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1', sinClave: true, nota: 'sin clave: 2 peticiones por minuto', enlace: 'https://endpoints.ai.cloud.ovh.net' },
  { id: 'tavily', nombre: 'Tavily', tipo: 'busqueda', nota: '1000 búsquedas al mes gratis', enlace: 'https://app.tavily.com/home', recomendado: 'Búsqueda web: sin ella, Investigar usa solo las bases académicas' },
  { id: 'groq', nombre: 'Groq', base: 'https://api.groq.com/openai/v1', nota: 'gratis, muy rápido', enlace: 'https://console.groq.com/keys', recomendado: 'Texto muy rápido y gratis' },
  { id: 'google', nombre: 'Google AI Studio (Gemini)', base: 'https://generativelanguage.googleapis.com/v1beta/openai', filtro: id => /gemini|gemma/.test(id) && !/embedding|tts|image|audio|live/.test(id), nota: 'texto gratis con límites diarios; imágenes Nano Banana de pago', enlace: 'https://aistudio.google.com/apikey', recomendado: 'Gemini: contexto enorme, ideal para investigar. Con facturación activa, también imágenes Nano Banana (~0,04 US$)' },
  { id: 'openrouter', nombre: 'OpenRouter', base: 'https://openrouter.ai/api/v1', filtro: id => /:free$/.test(id), nota: 'decenas de modelos :free', enlace: 'https://openrouter.ai/keys', recomendado: 'Muchos modelos gratis' },
  { id: 'cerebras', nombre: 'Cerebras', base: 'https://api.cerebras.ai/v1', nota: 'gratis, muy rápido', enlace: 'https://cloud.cerebras.ai' },
  { id: 'mistral', nombre: 'Mistral', base: 'https://api.mistral.ai/v1', filtro: id => !/embed|moderation|ocr/.test(id), nota: 'plan gratuito de experimentación', enlace: 'https://console.mistral.ai/api-keys/' },
  { id: 'nvidia', nombre: 'NVIDIA NIM', base: 'https://integrate.api.nvidia.com/v1', filtro: id => !/embed|rerank|guard|reward|parse|clip|retriever/.test(id), nota: 'créditos gratis', enlace: 'https://build.nvidia.com/settings/api-keys' },
  { id: 'github', nombre: 'GitHub Models', base: 'https://models.github.ai/inference', nota: 'token de GitHub con permiso models:read', enlace: 'https://github.com/settings/personal-access-tokens' },
  { id: 'huggingface', nombre: 'Hugging Face', base: 'https://router.huggingface.co/v1', nota: 'créditos mensuales gratis; texto e imágenes FLUX.1', enlace: 'https://huggingface.co/settings/tokens', recomendado: 'Imágenes FLUX.1 de respaldo' },
  { id: 'sambanova', nombre: 'SambaNova', base: 'https://api.sambanova.ai/v1', nota: 'gratis con límites', enlace: 'https://cloud.sambanova.ai/apis' },
  { id: 'cohere', nombre: 'Cohere', base: 'https://api.cohere.ai/compatibility/v1', filtro: id => /command/.test(id), nota: 'clave de prueba gratis', enlace: 'https://dashboard.cohere.com/api-keys' },
  { id: 'llm7', nombre: 'LLM7', base: 'https://api.llm7.io/v1', nota: 'clave gratis', enlace: 'https://dash.llm7.io/#/api-keys' },
  { id: 'zai', nombre: 'Z.ai (GLM)', base: 'https://api.z.ai/api/paas/v4', nota: 'GLM-4.x Flash gratis', enlace: 'https://z.ai/manage-apikey/apikey-list' },
  { id: 'deepseek', nombre: 'DeepSeek', base: 'https://api.deepseek.com/v1', nota: 'de pago, muy barato', enlace: 'https://platform.deepseek.com/api_keys' },
  { id: 'kaggle', nombre: 'Kaggle (GPU para entrenar)', tipo: 'entrenamiento', nota: 'gratis: 30 h de GPU a la semana. Formato usuario:clave (o pega kaggle.json). Verifica tu teléfono en Kaggle', enlace: 'https://www.kaggle.com/settings', recomendado: 'Entrenar tu propio modelo automáticamente' },
  { id: 'cloudflare', nombre: 'Cloudflare API (subir tu modelo)', tipo: 'entrenamiento', nota: 'formato ID_DE_CUENTA:TOKEN; token con permiso «Workers AI: Edit»', enlace: 'https://dash.cloudflare.com/profile/api-tokens' },
  { id: 'openai', nombre: 'OpenAI', base: 'https://api.openai.com/v1', filtro: id => /^(gpt|o\d)/.test(id) && !/audio|realtime|tts|transcribe|image|search/.test(id), nota: 'de pago: texto y GPT Image', enlace: 'https://platform.openai.com/api-keys', recomendado: 'Imágenes GPT Image (desde ~0,005 US$ con gpt-image-1-mini)' },
];
const POR_ID = Object.fromEntries(CATALOGO.map(p => [p.id, p]));
const HORAS_CACHE = 6;
// Si el usuario no elige modelo ni tarea, estos van al final como red de seguridad.
const RESPALDO = ['workersai/@cf/openai/gpt-oss-120b', 'workersai/@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'workersai/@cf/qwen/qwen3.8-27b'];

class ErrorProveedor extends Error {
  constructor(mensaje, estado, proveedor) { super(mensaje); this.estado = estado; this.proveedor = proveedor; }
}

/** Lee un flujo SSE y llama a alDato con cada objeto JSON. */
async function leerSSE(flujo, alDato) {
  const lector = flujo.getReader();
  const dec = new TextDecoder();
  let resto = '';
  for (;;) {
    const { value, done } = await lector.read();
    if (done) break;
    resto += dec.decode(value, { stream: true });
    const lineas = resto.split('\n');
    resto = lineas.pop();
    for (const l of lineas) {
      if (!l.startsWith('data:')) continue;
      const d = l.slice(5).trim();
      if (!d || d === '[DONE]') continue;
      try { alDato(JSON.parse(d)); } catch (e) { if (e instanceof ErrorProveedor) throw e; }
    }
  }
}

function trozo(j) {
  if (j.error) throw new ErrorProveedor(j.error.message || JSON.stringify(j.error), 502);
  const d = j.choices?.[0]?.delta || {};
  return { texto: d.content || (typeof j.response === 'string' ? j.response : ''), razon: d.reasoning_content || d.reasoning || '' };
}

async function aBytes(salida) {
  if (salida instanceof ReadableStream) return new Uint8Array(await new Response(salida).arrayBuffer());
  if (salida instanceof ArrayBuffer) return new Uint8Array(salida);
  if (salida instanceof Uint8Array) return salida;
  const b64 = salida?.image || salida?.result?.image;
  if (b64) return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  throw new Error('el modelo no devolvió una imagen');
}

const tipoImagen = b => (b[0] === 0x89 ? 'image/png' : b[0] === 0x52 && b[8] === 0x57 ? 'image/webp' : 'image/jpeg');

// sinWorkersAI: la versión de prueba no usa Workers AI para no gastar las neuronas de la cuenta.
export function crearGateway(env, usuario, { sinWorkersAI = false } = {}) {
  const sinWAI = m => (sinWorkersAI && m?.startsWith('workersai/') ? 'auto' : m);
  let filasClaves = null;
  const claves = new Map();

  async function misClaves() {
    if (!filasClaves) {
      const r = await env.DB.prepare('SELECT proveedor, cifrada, iv, estado, detalle FROM claves WHERE usuario = ?').bind(usuario).all();
      filasClaves = Object.fromEntries(r.results.map(f => [f.proveedor, f]));
    }
    return filasClaves;
  }

  async function claveDe(prov) {
    if (claves.has(prov)) return claves.get(prov);
    const f = (await misClaves())[prov];
    const clave = f ? await descifrar(env, f.cifrada, f.iv) : null;
    claves.set(prov, clave);
    return clave;
  }

  async function disponibles() {
    const mias = await misClaves();
    return CATALOGO.filter(p => (p.tipo || 'chat') === 'chat' && (p.sinClave || mias[p.id]) && !(sinWorkersAI && p.id === 'workersai'));
  }

  // ── Listas de modelos (en caché 6 h en D1) ───────────────────────────────
  async function modelosDe(p) {
    if (p.id === 'workersai') return WAI_TEXTO;
    const llave = `modelos:${p.id}:${p.sinClave ? '' : usuario}`;
    const c = await env.DB.prepare('SELECT valor FROM cache WHERE clave = ? AND expira > ?').bind(llave, Date.now()).first();
    if (c) return JSON.parse(c.valor);
    const clave = await claveDe(p.id);
    const res = await fetch(`${p.base}/models`, { headers: clave ? { Authorization: `Bearer ${clave}` } : {}, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new ErrorProveedor(`${p.nombre}: HTTP ${res.status}`, res.status, p.id);
    const d = await res.json();
    const lista = (d.data || d.models || [])
      .map(m => ({ id: String(m.id || m.name || '').replace(/^models\//, ''), contexto: m.context_length || m.context_window || m.max_context_length || null }))
      .filter(m => m.id && (!p.filtro || p.filtro(m.id)))
      .slice(0, 120)
      .map(m => ({ id: `${p.id}/${m.id}`, nombre: `${m.id} · ${p.nombre}`, contexto: m.contexto }));
    await env.DB.prepare('INSERT OR REPLACE INTO cache (clave, valor, expira) VALUES (?, ?, ?)').bind(llave, JSON.stringify(lista), Date.now() + HORAS_CACHE * 3600_000).run();
    return lista;
  }

  // Modelos propios: adaptadores LoRA entrenados con tus conversaciones y subidos a Workers AI.
  async function misLoras() {
    if (sinWorkersAI) return [];
    const f = await env.DB.prepare("SELECT valor FROM ajustes WHERE usuario = ? AND clave = 'loras'").bind(usuario).first();
    return f ? JSON.parse(f.valor) : [];
  }
  async function ponerLoras(lista) {
    await env.DB.prepare("INSERT OR REPLACE INTO ajustes (usuario, clave, valor) VALUES (?, 'loras', ?)").bind(usuario, JSON.stringify(lista.slice(0, 20))).run();
    listaTexto = null;
  }

  let listaTexto = null;
  async function modelosTexto() {
    if (listaTexto) return listaTexto;
    const provs = await disponibles();
    const [listas, loras] = await Promise.all([Promise.allSettled(provs.map(modelosDe)), misLoras()]);
    listaTexto = [
      { id: 'auto', nombre: 'Automático (laboratorio.ia elige y cambia si falla)' },
      ...loras.map(l => ({ id: `workersai/${l.base}#lora:${l.lora}`, nombre: `★ ${l.etiqueta || l.lora} · tu modelo entrenado`, propio: true })),
      ...listas.flatMap(r => (r.status === 'fulfilled' ? r.value : [])),
    ];
    return listaTexto;
  }

  async function modelosImagen() {
    return [
      { id: 'auto', nombre: 'Automático (según estilo y calidad; respaldo con tus claves)' },
      ...WAI_IMAGEN.map(m => ({ id: `workersai/${m.id}`, nombre: `${m.nombre} · Workers AI` })),
      { id: 'pollinations/flux', nombre: 'Pollinations FLUX (con tu clave gratis)' },
      { id: 'huggingface/black-forest-labs/FLUX.1-schnell', nombre: 'FLUX.1 schnell · Hugging Face (con tu token)' },
      ...modelosDePago({ google: await claveDe('google'), openai: await claveDe('openai') }),
    ];
  }

  // ── Candidatos para un modelo («auto» = varios en orden) ──────────────────
  // Cuota diaria de Workers AI agotada: se salta hasta las 00:00 UTC en vez de fallar cada vez.
  const LLAVE_AGOTADO = 'workersai:agotado';
  let agotado = null;
  async function waiAgotado() {
    if (agotado === null) agotado = Boolean(await env.DB.prepare('SELECT 1 FROM cache WHERE clave = ? AND expira > ?').bind(LLAVE_AGOTADO, Date.now()).first());
    return agotado;
  }
  async function marcarAgotado() {
    agotado = true;
    const mañana = new Date(); mañana.setUTCHours(24, 0, 0, 0);
    await env.DB.prepare('INSERT OR REPLACE INTO cache (clave, valor, expira) VALUES (?, ?, ?)').bind(LLAVE_AGOTADO, '1', mañana.getTime()).run();
  }

  /** «auto» = varios en orden. Con un modelo concreto y sin `estricto`, el automático queda de respaldo. */
  async function candidatos(modelo, estricto = false) {
    modelo = sinWAI(modelo);
    if (modelo && modelo !== 'auto' && estricto) return [modelo];
    const lista = (await modelosTexto()).filter(m => m.id !== 'auto');
    let orden = [...new Set([...recomendados(lista, 'chat', 4).map(m => m.id), ...(sinWorkersAI ? [] : RESPALDO)])];
    if (await waiAgotado()) orden = [...orden.filter(m => !m.startsWith('workersai/')), ...orden.filter(m => m.startsWith('workersai/'))];
    return modelo && modelo !== 'auto' ? [modelo, ...orden.filter(m => m !== modelo)] : orden;
  }

  function separar(modelo) {
    const i = modelo.indexOf('/');
    const prov = POR_ID[modelo.slice(0, i)];
    if (!prov) throw new ErrorProveedor(`Modelo desconocido: ${modelo}`, 400);
    return { prov, id: modelo.slice(i + 1) };
  }

  /** Una llamada a un modelo concreto. stream: devuelve el flujo SSE; si no, el JSON. */
  async function llamar(modelo, mensajes, { stream, max = 4096, temperatura, señal, tiempo = 60_000 }) {
    const { prov, id } = separar(modelo);
    if (prov.id === 'workersai') {
      try {
        const [base, lora] = id.split('#lora:');
        return await env.AI.run(base, { messages: mensajes, stream, max_tokens: lora ? Math.min(max, 2048) : max, ...(lora ? { lora } : {}), ...(temperatura != null ? { temperature: temperatura } : {}) });
      } catch (e) {
        if (/4006|daily free allocation/.test(e.message)) await marcarAgotado();
        throw new ErrorProveedor(`Workers AI: ${e.message}`, /5035|not available on the Workers Free/.test(e.message) ? 402 : 502, 'workersai');
      }
    }
    const clave = await claveDe(prov.id);
    if (!clave && !prov.sinClave) throw new ErrorProveedor(`${prov.nombre}: falta la clave`, 401, prov.id);
    const corte = AbortSignal.any([AbortSignal.timeout(tiempo), ...(señal ? [señal] : [])]);
    const res = await fetch(`${prov.base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(clave ? { Authorization: `Bearer ${clave}` } : {}) },
      body: JSON.stringify({ model: id, messages: mensajes, stream, max_tokens: max, ...(temperatura != null ? { temperature: temperatura } : {}) }),
      signal: corte,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      let m = t.slice(0, 300);
      try { const j = JSON.parse(t); m = j.error?.message || j.message || m; } catch { /* texto plano */ }
      throw new ErrorProveedor(`${prov.nombre}: ${m || `HTTP ${res.status}`}`, res.status, prov.id);
    }
    return stream ? res.body : res.json();
  }

  async function completar(mensajes, { modelo = 'auto', max = 400, temperatura = 0.2, tiempo = 90_000, estricto = false } = {}) {
    let ultimo;
    for (const m of (await candidatos(modelo, estricto)).slice(0, 4)) {
      try {
        const d = await llamar(m, mensajes, { stream: false, max, temperatura, tiempo });
        const msg = d.choices?.[0]?.message || {};
        const texto = msg.content ?? (typeof d.response === 'string' ? d.response : '') ?? '';
        const razonamiento = msg.reasoning_content || msg.reasoning || '';
        if (!texto && !razonamiento) throw new ErrorProveedor('respuesta vacía', 502);
        return { texto: texto || '', razonamiento, fin: d.choices?.[0]?.finish_reason, modelo: m };
      } catch (e) { ultimo = e; }
    }
    throw ultimo || new Error('sin proveedores');
  }

  async function conversar(mensajes, { modelo = 'auto', señal, alTexto, alRazonamiento }) {
    let ultimo;
    // Con un modelo concreto no se cambia en silencio: el núcleo avisa y reintenta con «auto».
    for (const m of (await candidatos(modelo, true)).slice(0, 4)) {
      let empezo = false;
      try {
        const flujo = await llamar(m, mensajes, { stream: true, max: 8192, señal, tiempo: 300_000 });
        await leerSSE(flujo, j => {
          const { texto, razon } = trozo(j);
          if (razon) { empezo = true; alRazonamiento?.(razon); }
          if (texto) { empezo = true; alTexto(texto); }
        });
        if (!empezo) throw new ErrorProveedor(`${m}: respuesta vacía`, 502);
        return m;
      } catch (e) {
        ultimo = e;
        if (empezo || señal?.aborted) throw e; // ya se mostró parte de la respuesta: no se mezcla con otro modelo
      }
    }
    throw ultimo || new Error('sin proveedores');
  }

  // Cadena de imagen: Workers AI (sin clave) → Pollinations y Hugging Face con la clave del usuario.
  // Desde Cloudflare los servicios de imagen sin clave rechazan la petición (IP compartida), así que
  // cuando se agota la cuota diaria de Workers AI hace falta una clave gratis de alguno de los dos.
  async function imagen(prompt, { modelo = 'auto', ancho = 1024, alto = 1024, estilo = 'fotorrealista', calidad = 'rapida' } = {}) {
    if (esDePago(modelo)) {
      const r = await generarDePago({ google: await claveDe('google'), openai: await claveDe('openai') }, modelo, prompt, { ancho, alto });
      if (r) return r;
      throw Object.assign(new Error('La calidad «De pago» necesita tu clave de Google AI Studio (Nano Banana, ~0,04 US$ por imagen) o de OpenAI (GPT Image). Añádela en Ajustes → Modelos y proveedores.'), { imagen: true });
    }
    let intentos;
    if (modelo !== 'auto') intentos = [modelo];
    else {
      const wai = calidad === 'alta'
        ? (estilo === 'fotorrealista' ? ['@cf/leonardo/lucid-origin', '@cf/black-forest-labs/flux-2-dev'] : ['@cf/black-forest-labs/flux-2-dev', '@cf/leonardo/lucid-origin'])
        : [];
      intentos = [...wai, '@cf/black-forest-labs/flux-1-schnell'].map(m => `workersai/${m}`);
      if (await waiAgotado()) intentos = [];
      intentos.push('pollinations/flux', 'huggingface/black-forest-labs/FLUX.1-schnell');
    }
    const errores = [];
    for (const m of intentos) {
      try {
        if (m.startsWith('pollinations/')) {
          const clave = await claveDe('pollinations');
          const sem = Math.floor(Math.random() * 1e9);
          const url = clave
            ? `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?width=${ancho}&height=${alto}&model=${m.split('/')[1]}&nologo=true&seed=${sem}`
            : `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${ancho}&height=${alto}&model=${m.split('/')[1]}&nologo=true&seed=${sem}`;
          const r = await fetch(url, { headers: clave ? { Authorization: `Bearer ${clave}` } : {}, signal: AbortSignal.timeout(120_000) });
          if (!r.ok) throw new Error(r.status === 402 || r.status === 401 ? 'sin clave, límite de la IP compartida' : `HTTP ${r.status}`);
          const datos = new Uint8Array(await r.arrayBuffer());
          return { datos, tipo: r.headers.get('content-type') || tipoImagen(datos), modelo: m };
        }
        if (m.startsWith('huggingface/')) {
          const clave = await claveDe('huggingface');
          if (!clave) { errores.push('Hugging Face: sin token'); continue; }
          const r = await fetch(`https://router.huggingface.co/hf-inference/models/${m.slice('huggingface/'.length)}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json', Accept: 'image/png' },
            body: JSON.stringify({ inputs: prompt, parameters: { width: ancho, height: alto } }),
            signal: AbortSignal.timeout(120_000),
          });
          if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
          const datos = new Uint8Array(await r.arrayBuffer());
          return { datos, tipo: r.headers.get('content-type') || tipoImagen(datos), modelo: m };
        }
        const def = WAI_IMAGEN.find(x => `workersai/${x.id}` === m);
        if (!def) throw new Error(`Modelo de imagen desconocido: ${m}`);
        let salida;
        try { salida = await env.AI.run(def.id, def.entrada({ prompt, ancho, alto })); } catch (e) {
          if (/4006|daily free allocation/.test(e.message)) { await marcarAgotado(); throw new Error('cuota diaria agotada'); }
          throw e;
        }
        const datos = await aBytes(salida);
        return { datos, tipo: tipoImagen(datos), modelo: m };
      } catch (e) { errores.push(`${m.split('/').slice(1).join('/').replace('@cf/', '')}: ${e.message}`); }
    }
    const tieneClaves = Boolean(await claveDe('pollinations')) || Boolean(await claveDe('huggingface'));
    if (modelo === 'auto' && (await waiAgotado()) && !tieneClaves) {
      throw Object.assign(new Error('Hoy se acabó la cuota gratis de imágenes de Workers AI (vuelve a las 00:00 UTC). Para seguir generando ya, añade una clave gratis de Pollinations (https://enter.pollinations.ai) o un token de Hugging Face (https://huggingface.co/settings/tokens) en Ajustes → Modelos y proveedores.'), { imagen: true });
    }
    throw Object.assign(new Error(`No se pudo generar la imagen. ${errores.join(' · ')}`), { imagen: true });
  }

  async function buscar(consulta, n = 5) {
    const clave = await claveDe('tavily');
    if (!clave) throw new Error('No search key configured');
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clave}` },
      body: JSON.stringify({ query: consulta, max_results: n }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`Tavily HTTP ${r.status}`);
    return r.json();
  }

  // ── Gestión de claves (Ajustes → Proveedores) ───────────────────────────
  async function lista() {
    const mias = await misClaves();
    const proveedores = CATALOGO.map(p => ({
      id: p.id, nombre: p.nombre, tipo: p.tipo === 'busqueda' ? 'búsqueda' : p.tipo || 'chat',
      sinClave: Boolean(p.sinClave), configurado: Boolean(p.sinClave || mias[p.id]), propia: Boolean(mias[p.id]),
      estado: mias[p.id]?.estado || (p.sinClave ? 'sana' : null), detalle: mias[p.id]?.detalle || '',
      enlace: p.enlace, nota: p.nota || '', recomendado: p.recomendado || '',
    }));
    return { sesion: 'ok', nube: true, resumen: { configured: proveedores.filter(p => p.configurado).length, total: proveedores.length }, proveedores };
  }

  async function probarClave(p, clave) {
    if (p.id === 'kaggle') return probarKaggle(clave);
    if (p.id === 'cloudflare') return probarCloudflare(clave);
    if (p.id === 'tavily') {
      const r = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clave}` }, body: JSON.stringify({ query: 'test', max_results: 1 }), signal: AbortSignal.timeout(20_000) });
      return { ok: r.ok, detalle: r.ok ? '' : `HTTP ${r.status}` };
    }
    const r = await fetch(`${p.base}/models`, { headers: { Authorization: `Bearer ${clave}` }, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return { ok: false, detalle: `HTTP ${r.status}` };
    const d = await r.json().catch(() => ({}));
    const n = (d.data || d.models || []).filter(m => !p.filtro || p.filtro(String(m.id || m.name || '').replace(/^models\//, ''))).length;
    return { ok: true, modelos: n };
  }

  async function agregar(plataforma, clave) {
    const p = POR_ID[plataforma];
    if (!p || p.id === 'workersai') throw Object.assign(new Error('Proveedor desconocido'), { estado: 400 });
    if (p.id === 'kaggle') clave = normalizarKaggle(clave);
    const prueba = await probarClave(p, clave).catch(e => ({ ok: false, detalle: e.message }));
    const { cifrada, iv } = await cifrar(env, clave);
    await env.DB.batch([
      env.DB.prepare('INSERT OR REPLACE INTO claves (usuario, proveedor, cifrada, iv, estado, detalle, creada) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(usuario, p.id, cifrada, iv, prueba.ok ? 'sana' : 'inválida', prueba.detalle || '', Date.now()),
      env.DB.prepare('DELETE FROM cache WHERE clave = ?').bind(`modelos:${p.id}:${p.sinClave ? '' : usuario}`),
    ]);
    return { enmascarada: `${clave.slice(0, 4)}…${clave.slice(-4)}`, estado: prueba.ok ? 'válida' : 'inválida', modelos: prueba.modelos ?? null, detalle: prueba.detalle || '' };
  }

  async function quitar(plataforma) {
    await env.DB.prepare('DELETE FROM claves WHERE usuario = ? AND proveedor = ?').bind(usuario, plataforma).run();
  }

  return { completar, conversar, imagen, modelosTexto, modelosImagen, buscar, enLinea: async () => true, lista, agregar, quitar, misLoras, ponerLoras, claveDe };
}
