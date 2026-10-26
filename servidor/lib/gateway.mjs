// Cliente de FreeLLMAPI. La URL y la clave salen de la configuración de `ia`
// (/root/.config/ia/config) o de FREELLMAPI_URL / FREELLMAPI_API_KEY.
import { existsSync, readFileSync } from 'node:fs';
import { esDePago, generarDePago, modelosDePago } from '../../comun/imagenes-pago.mjs';

function leerConfigIa() {
  const archivo = '/root/.config/ia/config';
  const datos = {};
  if (!existsSync(archivo)) return datos;
  for (const linea of readFileSync(archivo, 'utf8').split('\n')) {
    const m = linea.match(/^(\w+)="?(.*?)"?$/);
    if (m) datos[m[1]] = m[2];
  }
  return datos;
}

// Pollinations genera imágenes sin clave: respaldo cuando el gateway no tiene proveedor de imágenes.
const POLLINATIONS = ['flux', 'turbo'];

export class Gateway {
  get cfg() {
    const ia = leerConfigIa();
    return {
      url: (process.env.FREELLMAPI_URL || ia.FREELLMAPI_URL || 'http://127.0.0.1:31415').replace(/\/+$/, ''),
      clave: process.env.FREELLMAPI_API_KEY || ia.FREELLMAPI_API_KEY || '',
      token: process.env.FREELLMAPI_DASHBOARD_TOKEN || ia.FREELLMAPI_DASHBOARD_TOKEN || '',
      // Opcionales, para imágenes de calidad: Workers AI de tu Cloudflare y clave de Pollinations.
      cfCuenta: process.env.CLOUDFLARE_ACCOUNT_ID || ia.CLOUDFLARE_ACCOUNT_ID || '',
      cfToken: process.env.CLOUDFLARE_API_TOKEN || ia.CLOUDFLARE_API_TOKEN || '',
      pollinations: process.env.POLLINATIONS_API_KEY || ia.POLLINATIONS_API_KEY || '',
      // De pago, opcionales: Nano Banana (Google AI Studio) y GPT Image (OpenAI).
      google: process.env.GOOGLE_API_KEY || ia.GOOGLE_API_KEY || '',
      openai: process.env.OPENAI_API_KEY || ia.OPENAI_API_KEY || '',
    };
  }

  async pedir(ruta, { metodo = 'GET', cuerpo, señal, tablero = false, tiempo = 30_000 } = {}) {
    const { url, clave, token } = this.cfg;
    const señales = [AbortSignal.timeout(tiempo), señal].filter(Boolean);
    return fetch(url + ruta, {
      method: metodo,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tablero ? token : clave}`,
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.any(señales),
    });
  }

  async json(ruta, opciones) {
    const res = await this.pedir(ruta, opciones);
    const datos = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(datos?.error?.message || `FreeLLMAPI respondió ${res.status}`);
    return datos;
  }

  async enLinea() {
    try { return (await this.pedir('/v1/models', { tiempo: 4000 })).ok; } catch { return false; }
  }

  async modelosTexto() {
    const d = await this.json('/v1/models');
    return (d.data || [])
      .filter(m => m.available !== false)
      .map(m => ({ id: m.id, nombre: m.name || m.id, contexto: m.context_window || m.context_length || null }));
  }

  async modelosImagen() {
    const lista = [{ id: 'auto', nombre: 'Automático (FreeLLMAPI → Pollinations)' }];
    if (this.cfg.token) {
      try {
        const d = await this.json('/api/media', { tablero: true });
        for (const m of d.models || []) {
          if (m.modality === 'image' && m.enabled && m.keyCount > 0) {
            lista.push({ id: m.modelId, nombre: `${m.displayName || m.modelId} · ${m.platform}` });
          }
        }
      } catch { /* sin sesión del dashboard solo se listan los modelos sin clave */ }
    }
    for (const p of POLLINATIONS) lista.push({ id: `pollinations/${p}`, nombre: `Pollinations ${p} (sin clave)` });
    lista.push(...modelosDePago(this.cfg));
    return lista;
  }

  /** Respuesta completa (sin streaming), para tareas internas cortas. */
  async completar(mensajes, { modelo = 'auto', max = 400, temperatura = 0.2, tiempo = 90_000 } = {}) {
    const d = await this.json('/v1/chat/completions', {
      metodo: 'POST',
      cuerpo: { model: modelo, messages: mensajes, max_tokens: max, temperature: temperatura, stream: false },
      tiempo,
    });
    const m = d.choices?.[0]?.message || {};
    return { texto: m.content || '', razonamiento: m.reasoning_content || m.reasoning || '', fin: d.choices?.[0]?.finish_reason, modelo: d.model };
  }

  /** Streaming: llama a alTexto / alRazonamiento por cada fragmento y devuelve el modelo usado. */
  async conversar(mensajes, { modelo = 'auto', señal, alTexto, alRazonamiento }) {
    const res = await this.pedir('/v1/chat/completions', {
      metodo: 'POST',
      cuerpo: { model: modelo, messages: mensajes, stream: true },
      señal,
      tiempo: 300_000,
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d?.error?.message || `FreeLLMAPI respondió ${res.status}`);
    }
    let usado = modelo;
    let resto = '';
    const decod = new TextDecoder();
    for await (const trozo of res.body) {
      resto += decod.decode(trozo, { stream: true });
      const lineas = resto.split('\n');
      resto = lineas.pop();
      for (const linea of lineas) {
        if (!linea.startsWith('data:')) continue;
        const dato = linea.slice(5).trim();
        if (!dato || dato === '[DONE]') continue;
        let j;
        try { j = JSON.parse(dato); } catch { continue; }
        if (j.error) throw new Error(j.error.message || 'Error del proveedor');
        if (j.model) usado = j.model;
        const delta = j.choices?.[0]?.delta || {};
        const razon = delta.reasoning_content || delta.reasoning;
        if (razon) alRazonamiento?.(razon);
        if (delta.content) alTexto(delta.content);
      }
    }
    return usado;
  }

  async buscar(consulta, n = 5) {
    return this.json('/v1/search', { metodo: 'POST', cuerpo: { query: consulta, max_results: n }, tiempo: 40_000 });
  }

  /** Devuelve { datos: Buffer, tipo, modelo }. */
  /** Workers AI por la API REST de Cloudflare (los modelos devuelven JSON con base64 o la imagen en binario). */
  async imagenWorkersAI(modelo, prompt, ancho, alto) {
    const { cfCuenta, cfToken } = this.cfg;
    const cuerpo = modelo.includes('flux-1-schnell') ? { prompt, steps: 8 } : { prompt, width: ancho, height: alto };
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cfCuenta}/ai/run/${modelo}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(180_000),
    });
    const tipo = r.headers.get('content-type') || '';
    if (tipo.startsWith('image/')) return { datos: Buffer.from(await r.arrayBuffer()), tipo, modelo: `workersai/${modelo}` };
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.result?.image) throw new Error(/4006|daily free allocation/.test(JSON.stringify(d)) ? 'Workers AI: cuota diaria agotada' : `Workers AI: ${d.errors?.[0]?.message || `HTTP ${r.status}`}`);
    return { datos: Buffer.from(d.result.image, 'base64'), tipo: 'image/jpeg', modelo: `workersai/${modelo}` };
  }

  /**
   * Cadena de imagen: Workers AI de tu Cloudflare (si está configurado) → FreeLLMAPI →
   * Pollinations con tu clave (FLUX real, sin marca) → Pollinations sin clave (modelo rebajado, con marca).
   */
  async imagen(prompt, { modelo = 'auto', ancho = 1024, alto = 1024, estilo = 'fotorrealista', calidad = 'rapida' } = {}) {
    const errores = [];
    const { cfCuenta, cfToken, pollinations, google, openai } = this.cfg;
    if (esDePago(modelo)) {
      const r = await generarDePago({ google, openai }, modelo, prompt, { ancho, alto });
      if (r) return r;
      throw new Error('La calidad «De pago» necesita tu clave de Google AI Studio (Nano Banana) o de OpenAI (GPT Image): añádela en Ajustes → Modelos y proveedores (Google) o como OPENAI_API_KEY en /root/.config/ia/config.');
    }
    if (modelo.startsWith('workersai/')) return this.imagenWorkersAI(modelo.slice(10), prompt, ancho, alto);
    if (modelo === 'auto' && cfCuenta && cfToken) {
      const alta = estilo === 'fotorrealista' ? ['@cf/leonardo/lucid-origin', '@cf/black-forest-labs/flux-2-dev'] : ['@cf/black-forest-labs/flux-2-dev', '@cf/leonardo/lucid-origin'];
      for (const m of [...(calidad === 'alta' ? alta : []), '@cf/black-forest-labs/flux-1-schnell']) {
        try { return await this.imagenWorkersAI(m, prompt, ancho, alto); } catch (e) {
          errores.push(e.message);
          if (/cuota diaria/.test(e.message)) break;
        }
      }
    }
    if (!modelo.startsWith('pollinations/')) {
      try {
        const d = await this.json('/v1/images/generations', {
          metodo: 'POST',
          cuerpo: { prompt, n: 1, size: `${ancho}x${alto}`, ...(modelo !== 'auto' ? { model: modelo } : {}) },
          tiempo: 180_000,
        });
        const img = d.data?.[0];
        if (img?.b64_json) return { datos: Buffer.from(img.b64_json, 'base64'), tipo: 'image/png', modelo: d.model || modelo };
        if (img?.url?.startsWith('data:')) {
          const [cab, b64] = img.url.split(',');
          return { datos: Buffer.from(b64, 'base64'), tipo: cab.slice(5).split(';')[0], modelo: d.model || modelo };
        }
        if (img?.url) {
          const r = await fetch(img.url, { signal: AbortSignal.timeout(120_000) });
          return { datos: Buffer.from(await r.arrayBuffer()), tipo: r.headers.get('content-type') || 'image/png', modelo: d.model || modelo };
        }
        errores.push('FreeLLMAPI no devolvió imagen');
      } catch (e) {
        errores.push(`FreeLLMAPI: ${e.message}`);
        if (modelo !== 'auto') throw e;
      }
    }
    const variante = modelo.startsWith('pollinations/') ? modelo.split('/')[1] : 'flux';
    const semilla = Math.floor(Math.random() * 1e9);
    if (pollinations) {
      const r = await fetch(`https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?width=${ancho}&height=${alto}&model=${variante}&nologo=true&seed=${semilla}`, { headers: { Authorization: `Bearer ${pollinations}` }, signal: AbortSignal.timeout(180_000) });
      if (r.ok) return { datos: Buffer.from(await r.arrayBuffer()), tipo: r.headers.get('content-type') || 'image/jpeg', modelo: `pollinations/${variante}` };
      errores.push(`Pollinations con clave: HTTP ${r.status}`);
    }
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${ancho}&height=${alto}&model=${variante}&nologo=true&seed=${semilla}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    if (!r.ok) throw new Error(`No se pudo generar la imagen (${[...errores, `Pollinations ${r.status}`].join('; ')})`);
    return { datos: Buffer.from(await r.arrayBuffer()), tipo: r.headers.get('content-type') || 'image/jpeg', modelo: `pollinations/${variante} (sin clave: calidad baja)` };
  }
}
