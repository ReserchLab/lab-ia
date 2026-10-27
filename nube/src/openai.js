// API compatible con OpenAI para usar laboratorio.ia desde otros programas (Codex, SDK de OpenAI, Cline…)
// con la clave unificada del usuario:  base_url = https://<tu-worker>/v1 · api_key = labia-…
const json = (datos, estado = 200) => new Response(JSON.stringify(datos), { status: estado, headers: { 'Content-Type': 'application/json' } });
const errorOpenAI = (mensaje, estado = 400, tipo = 'invalid_request_error') => json({ error: { message: mensaje, type: tipo } }, estado);

export async function manejarOpenAI(request, gateway, ruta) {
  if (ruta === '/v1/models' && request.method === 'GET') {
    const lista = await gateway.modelosTexto();
    return json({ object: 'list', data: lista.map(m => ({ id: m.id, object: 'model', owned_by: m.id.split('/')[0], name: m.nombre, context_window: m.contexto || undefined })) });
  }

  if (ruta === '/v1/chat/completions' && request.method === 'POST') {
    const p = await request.json().catch(() => null);
    if (!Array.isArray(p?.messages)) return errorOpenAI('`messages` es obligatorio');
    // Solo texto: el contenido en partes (multimodal) se aplana a su texto.
    const mensajes = p.messages.map(m => ({ role: m.role, content: Array.isArray(m.content) ? m.content.map(c => c.text || '').join('') : String(m.content ?? '') }));
    const modelo = p.model || 'auto';
    const id = `chatcmpl-${crypto.randomUUID()}`;
    const creado = Math.floor(Date.now() / 1000);
    if (!p.stream) {
      try {
        const r = await gateway.completar(mensajes, { modelo, max: p.max_tokens || p.max_completion_tokens || 4096, temperatura: p.temperature, tiempo: 300_000 });
        return json({ id, object: 'chat.completion', created: creado, model: r.modelo, choices: [{ index: 0, message: { role: 'assistant', content: r.texto, ...(r.razonamiento ? { reasoning_content: r.razonamiento } : {}) }, finish_reason: r.fin || 'stop' }] });
      } catch (e) { return errorOpenAI(e.message, e.estado && e.estado < 600 ? e.estado : 502, 'server_error'); }
    }
    const { readable, writable } = new TransformStream();
    const w = writable.getWriter();
    const enc = new TextEncoder();
    let usado = modelo;
    const enviar = delta => w.write(enc.encode(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: creado, model: usado, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`));
    (async () => {
      try {
        usado = await gateway.conversar(mensajes, { modelo, alTexto: t => enviar({ content: t }), alRazonamiento: t => enviar({ reasoning_content: t }) });
        await w.write(enc.encode(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: creado, model: usado, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`));
      } catch (e) {
        await w.write(enc.encode(`data: ${JSON.stringify({ error: { message: e.message, type: 'server_error' } })}\n\n`));
      }
      await w.write(enc.encode('data: [DONE]\n\n'));
      await w.close();
    })();
    return new Response(readable, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } });
  }

  if (ruta === '/v1/images/generations' && request.method === 'POST') {
    const p = await request.json().catch(() => null);
    if (!p?.prompt) return errorOpenAI('`prompt` es obligatorio');
    const [ancho, alto] = String(p.size || '1024x1024').split('x').map(Number);
    try {
      const img = await gateway.imagen(p.prompt, { modelo: p.model || 'auto', ancho: ancho || 1024, alto: alto || 1024 });
      let bin = '';
      for (let i = 0; i < img.datos.length; i += 0x8000) bin += String.fromCharCode(...img.datos.subarray(i, i + 0x8000));
      return json({ created: Math.floor(Date.now() / 1000), model: img.modelo, data: [{ b64_json: btoa(bin) }] });
    } catch (e) { return errorOpenAI(e.message, 502, 'server_error'); }
  }

  return errorOpenAI('Ruta desconocida', 404);
}
