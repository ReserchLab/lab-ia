// lab.ia en Cloudflare Workers. Misma interfaz (web/) y mismo núcleo (comun/) que el servidor del
// teléfono; aquí los modelos van por Workers AI y las claves de cada usuario, y los datos por D1 y KV.
import './red.js';
import { crearNucleo } from '../../comun/nucleo.mjs';
import { rutasComunes } from '../../comun/api.mjs';
import { asegurarEsquema } from './esquema.js';
import { AlmacenD1, tareasD1 } from './almacen.js';
import { SkillsD1 } from './skills.js';
import { crearGateway } from './proveedores.js';
import { manejarOpenAI } from './openai.js';
import * as cuentas from './cuentas.js';
import * as demo from './demo.js';

const VERSION = '1.4.0';

const json = (datos, estado = 200, extra = {}) => new Response(JSON.stringify(datos), {
  status: estado,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
});

function explicarNube(e) {
  const m = e?.message || '';
  if (/No search key configured/.test(m)) return 'sin buscador web: añade una clave gratis de Tavily en Ajustes → Modelos y proveedores';
  if (/not available on the Workers Free|5035/.test(m)) return 'Ese modelo de Workers AI no está en el plan gratuito de Cloudflare. Elige otro o usa «auto».';
  if (/neurons|daily free allocation|4006/.test(m)) return 'Se acabaron las 10 000 neuronas gratis de Workers AI de hoy. Añade la clave de otro proveedor (Groq, Gemini…) o espera a mañana (00:00 UTC).';
  return null;
}

function contexto(env, usuario) {
  const gateway = crearGateway(env, usuario.id, { sinWorkersAI: demo.esDemo(env) });
  const almacen = new AlmacenD1(env.DB, usuario.id);
  const skills = new SkillsD1(env.DB, usuario.id);
  const tareas = tareasD1(env.DB, usuario.id);
  const nucleo = crearNucleo({
    gateway, almacen, skills, tareas,
    explicarExtra: explicarNube,
    verificacionAparte: true,
    guardarImagen: async (datos, tipo) => {
      const id = crypto.randomUUID();
      await env.MEDIA.put(id, datos, { metadata: { tipo, usuario: usuario.id } });
      return `/media/${id}`;
    },
  });
  return { gateway, almacen, skills, tareas, nucleo };
}

/** Chat en Server-Sent Events: el núcleo emite eventos mientras la respuesta se transmite. */
function respuestaSSE(ejecutar, request) {
  const { readable, writable } = new TransformStream();
  const w = writable.getWriter();
  const enc = new TextEncoder();
  let cerrado = false;
  const emitir = (evento, datos) => { if (!cerrado) w.write(enc.encode(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`)).catch(() => { cerrado = true; }); };
  const latido = setInterval(() => { if (!cerrado) w.write(enc.encode(': latido\n\n')).catch(() => { cerrado = true; }); }, 15_000);
  const tarea = (async () => {
    try { await ejecutar(emitir, request.signal); } finally { clearInterval(latido); cerrado = true; await w.close().catch(() => {}); }
  })();
  return { respuesta: new Response(readable, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } }), tarea };
}

async function api(request, env, ctx, ruta, invitado) {
  const metodo = request.method;
  let leido;
  const cuerpo = async () => (leido ??= await request.json().catch(() => ({})));

  // ── Versión de prueba: invitado automático, límites y rutas bloqueadas ──
  if (demo.esDemo(env)) {
    if (demo.rutaBloqueada(metodo, ruta)) return json({ error: 'No disponible en la versión de prueba. Crea tu propio lab.ia gratis: https://labia-ciencia.pages.dev' }, 403);
    if (ruta === '/api/estado' && metodo === 'GET') {
      return json({ version: VERSION, nube: true, demo: true, autorizado: true, local: false, gateway: true, usuario: { email: 'invitado', rol: 'invitado' }, uso: await demo.uso(env, invitado.id), limites: demo.LIMITES, repo: env.REPO });
    }
    if (ruta === '/api/chat' && metodo === 'POST') {
      const p = await cuerpo();
      if (p.modo === 'imagen') return json({ error: 'Las imágenes no están en la versión de prueba. En tu propio lab.ia sí: https://labia-ciencia.pages.dev' }, 403);
      if (!p.regenerar || p.conversacion) await demo.consumir(env, request, invitado.id, p.modo);
    }
  }

  // ── Cuenta (sin sesión) ──
  if (ruta === '/api/estado' && metodo === 'GET') {
    const u = await cuentas.usuarioDeSesion(env, request);
    return json({
      version: VERSION, nube: true, autorizado: Boolean(u), local: false, gateway: true,
      usuario: u ? { email: u.email, rol: u.rol } : null,
      hayUsuarios: await cuentas.hayUsuarios(env),
      registroAbierto: await cuentas.registroAbierto(env),
      repo: env.REPO,
    });
  }
  if (ruta === '/api/cuenta/registro' && metodo === 'POST') {
    const { email, password } = await cuerpo();
    const token = await cuentas.registrar(env, email, password);
    return json({ ok: true }, 200, { 'Set-Cookie': cuentas.galletaSesion(token) });
  }
  if (ruta === '/api/cuenta/entrar' && metodo === 'POST') {
    const { email, password } = await cuerpo();
    const token = await cuentas.entrar(env, email, password);
    return json({ ok: true }, 200, { 'Set-Cookie': cuentas.galletaSesion(token) });
  }
  if (ruta === '/api/cuenta/salir' && metodo === 'POST') {
    await cuentas.salir(env, request);
    return json({ ok: true }, 200, { 'Set-Cookie': cuentas.galletaBorrada() });
  }

  const usuario = invitado || await cuentas.usuarioDeSesion(env, request);
  if (!usuario) return json({ error: 'Inicia sesión en lab.ia' }, 401);
  const c = contexto(env, usuario);

  // ── Cuenta (con sesión) ──
  if (ruta === '/api/cuenta' && metodo === 'GET') {
    return json({ email: usuario.email, rol: usuario.rol, clave: await cuentas.claveUnificada(env, usuario.id), registroAbierto: await cuentas.registroAbierto(env) });
  }
  if (ruta === '/api/cuenta/clave' && metodo === 'POST') return json({ clave: await cuentas.regenerarClave(env, usuario.id) });
  if (ruta === '/api/cuenta/registro-abierto' && metodo === 'PUT') {
    if (usuario.rol !== 'admin') return json({ error: 'Solo el administrador' }, 403);
    const { abierto } = await cuerpo();
    await cuentas.ponerRegistroAbierto(env, Boolean(abierto));
    return json({ registroAbierto: Boolean(abierto) });
  }

  // ── Proveedores ──
  if (ruta === '/api/proveedores' && metodo === 'GET') return json(await c.gateway.lista());
  if (ruta === '/api/proveedores/gratis' && metodo === 'POST') return json({ activados: [] }); // en la nube los gratis están siempre activos
  if (ruta === '/api/proveedores/clave' && metodo === 'POST') {
    const { plataforma, clave } = await cuerpo();
    if (!plataforma || !clave?.trim()) return json({ error: 'Falta la clave' }, 400);
    return json(await c.gateway.agregar(plataforma, clave.trim()));
  }
  const pq = ruta.match(/^\/api\/proveedores\/clave\/([\w-]+)$/);
  if (pq && metodo === 'DELETE') { await c.gateway.quitar(pq[1]); return json({ ok: true }); }

  // ── Rutas comunes (chat, skills, conversaciones, tareas, verificación) ──
  const comun = await rutasComunes(c.nucleo, c, { metodo, ruta, cuerpo });
  if (comun?.sse) {
    const { respuesta, tarea } = respuestaSSE(comun.sse, request);
    ctx.waitUntil(tarea);
    return respuesta;
  }
  if (comun) return json(comun.datos, comun.estado);
  return json({ error: 'Ruta desconocida' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const ruta = decodeURIComponent(url.pathname);
    try {
      await asegurarEsquema(env.DB);

      if (ruta.startsWith('/api/')) {
        if (!demo.esDemo(env)) return await api(request, env, ctx, ruta);
        const { usuario, galleta } = await demo.asegurarInvitado(env, request);
        const r = await api(request, env, ctx, ruta, usuario);
        if (galleta) r.headers.append('Set-Cookie', galleta);
        return r;
      }

      if (ruta.startsWith('/v1/')) {
        if (demo.esDemo(env)) return json({ error: { message: 'La API no está en la versión de prueba', type: 'invalid_request_error' } }, 404);
        if (request.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST' } });
        const usuario = await cuentas.usuarioDeClave(env, request);
        if (!usuario) return json({ error: { message: 'Clave de lab.ia no válida (labia-…)', type: 'authentication_error' } }, 401);
        return await manejarOpenAI(request, crearGateway(env, usuario.id), ruta);
      }

      if (ruta.startsWith('/media/')) {
        const usuario = await cuentas.usuarioDeSesion(env, request);
        if (!usuario) return json({ error: 'Sin acceso' }, 401);
        const { value, metadata } = await env.MEDIA.getWithMetadata(ruta.slice(7), { type: 'stream' });
        if (!value || metadata?.usuario !== usuario.id) return json({ error: 'No existe' }, 404);
        return new Response(value, { headers: { 'Content-Type': metadata.tipo || 'image/png', 'Cache-Control': 'private, max-age=31536000, immutable' } });
      }

      // APK privado (edición personal): solo con el código secreto APK_CODIGO, guardado en KV como «apk-personal».
      if (env.APK_CODIGO && ruta === `/apk/${env.APK_CODIGO}`) {
        const apk = await env.MEDIA.get('apk-personal', { type: 'stream' });
        if (!apk) return json({ error: 'No hay APK personal subido' }, 404);
        return new Response(apk, { headers: { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Disposition': 'attachment; filename="lab.ia-personal.apk"', 'Cache-Control': 'no-store' } });
      }

      // El APK se publica en GitHub Releases.
      if (ruta === '/descargar' || ruta === '/lab.ia.apk') return Response.redirect(`${env.REPO}/releases/latest/download/lab.ia.apk`, 302);

      return env.ASSETS.fetch(request);
    } catch (e) {
      return json({ error: explicarNube(e) || e.message }, e.estado || 500);
    }
  },
};
