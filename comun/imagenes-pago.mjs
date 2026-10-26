// Generadores de imagen de pago, opcionales y con la clave del usuario (común a nube y teléfono).
// Nunca se usan en automático: solo con la calidad «De pago» o eligiéndolos como modelo.
//   Nano Banana (Gemini Image, Google AI Studio): ~0,04 US$ por imagen.
//   GPT Image (OpenAI): gpt-image-1-mini desde ~0,005 US$ (baja) a gpt-image-1 ~0,04–0,17 US$ (alta).

const b64aBytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

// Los nombres de los modelos de Google cambian a menudo: se prueba del más nuevo al más antiguo.
export const MODELOS_GEMINI = ['gemini-3.1-flash-image-preview', 'gemini-2.5-flash-image', 'gemini-2.5-flash-image-preview'];

function proporcion(ancho, alto) {
  const r = ancho / alto;
  return r > 1.3 ? '16:9' : r < 0.77 ? '9:16' : '1:1';
}

export async function nanoBanana(clave, prompt, { ancho = 1024, alto = 1024, modelo } = {}) {
  const errores = [];
  for (const m of modelo ? [modelo] : MODELOS_GEMINI) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': clave },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: proporcion(ancho, alto) } },
      }),
      signal: AbortSignal.timeout(180_000),
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 404) { errores.push(`${m}: no existe`); continue; }
    if (!r.ok) throw new Error(`Nano Banana: ${d.error?.message || `HTTP ${r.status}`}`);
    const parte = (d.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.data);
    if (!parte) throw new Error(`Nano Banana no devolvió imagen${d.candidates?.[0]?.finishReason ? ` (${d.candidates[0].finishReason})` : ''}`);
    return { datos: b64aBytes(parte.inlineData.data), tipo: parte.inlineData.mimeType || 'image/png', modelo: `google/${m}` };
  }
  throw new Error(`Nano Banana: ningún modelo disponible (${errores.join(' · ')})`);
}

export async function gptImage(clave, prompt, { ancho = 1024, alto = 1024, modelo = 'gpt-image-1-mini', calidad = 'medium' } = {}) {
  const size = ancho > alto * 1.3 ? '1536x1024' : alto > ancho * 1.3 ? '1024x1536' : '1024x1024';
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clave}` },
    body: JSON.stringify({ model: modelo, prompt, size, quality: calidad, n: 1 }),
    signal: AbortSignal.timeout(180_000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GPT Image: ${d.error?.message || `HTTP ${r.status}`}`);
  const b64 = d.data?.[0]?.b64_json;
  if (!b64) throw new Error('GPT Image no devolvió imagen');
  return { datos: b64aBytes(b64), tipo: 'image/png', modelo: `openai/${modelo}` };
}

/** Lista para el selector de modelos de imagen, según las claves que tenga el usuario. */
export function modelosDePago({ google, openai }) {
  return [
    ...(google ? [{ id: 'google/nano-banana', nombre: 'Nano Banana · Gemini Image (de pago, tu clave)' }] : []),
    ...(openai ? [
      { id: 'openai/gpt-image-1-mini', nombre: 'GPT Image mini (de pago, tu clave)' },
      { id: 'openai/gpt-image-1', nombre: 'GPT Image (de pago, tu clave)' },
    ] : []),
  ];
}

/**
 * Genera con el modelo de pago pedido, o con el primero disponible si es «premium».
 * Devuelve null si no hay ninguna clave de pago.
 */
export async function generarDePago(claves, modelo, prompt, opciones) {
  const intentos = modelo === 'premium'
    ? [...(claves.google ? ['google/nano-banana'] : []), ...(claves.openai ? ['openai/gpt-image-1'] : [])]
    : [modelo];
  if (!intentos.length) return null;
  const errores = [];
  for (const m of intentos) {
    try {
      if (m === 'google/nano-banana') {
        if (!claves.google) throw new Error('falta la clave de Google AI Studio');
        return await nanoBanana(claves.google, prompt, opciones);
      }
      if (m.startsWith('openai/')) {
        if (!claves.openai) throw new Error('falta la clave de OpenAI');
        return await gptImage(claves.openai, prompt, { ...opciones, modelo: m.slice(7), calidad: m.endsWith('mini') ? 'medium' : 'high' });
      }
    } catch (e) { errores.push(e.message); }
  }
  throw Object.assign(new Error(`No se pudo generar la imagen de pago: ${errores.join(' · ')}`), { imagen: true });
}

export const esDePago = m => m === 'premium' || m === 'google/nano-banana' || m?.startsWith('openai/gpt-image');
