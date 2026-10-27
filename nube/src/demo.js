// Versión de prueba abierta (DEMO = "si" en wrangler): sin registro, con sesión de invitado automática,
// solo chat e investigación, con límites diarios y sin Workers AI (no gasta las neuronas de la cuenta).
import { aleatorio, hashContrasena, sha256 } from './cifrado.js';
import { galletaSesion, usuarioDeSesion } from './cuentas.js';

export const esDemo = env => env.DEMO === 'si';

// Por día (UTC): por invitado, por IP (por si se borra la galleta) y para toda la demo.
export const LIMITES = { chat: 20, investigar: 6, ip: 40, total: 800, modelosCombinados: 3 };

const hoy = () => new Date().toISOString().slice(0, 10);
const finDelDia = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.getTime(); };

/** Devuelve el usuario de la sesión o crea un invitado nuevo (con la galleta que hay que enviar). */
export async function asegurarInvitado(env, request) {
  const u = await usuarioDeSesion(env, request);
  if (u) return { usuario: u };
  const id = crypto.randomUUID();
  const { hash, sal } = await hashContrasena(aleatorio(16));
  const token = aleatorio(32);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO usuarios (id, email, hash, sal, rol, creado) VALUES (?, ?, ?, ?, 'invitado', ?)").bind(id, `invitado-${id}@demo.labia`, hash, sal, Date.now()),
    env.DB.prepare('INSERT INTO sesiones (token_hash, usuario, expira) VALUES (?, ?, ?)').bind(await sha256(token), id, Date.now() + 7 * 86400_000),
  ]);
  // De vez en cuando se borran los invitados de hace más de 7 días y sus conversaciones.
  if (Math.random() < 0.05) await limpiar(env);
  return { usuario: { id, email: 'invitado', rol: 'invitado' }, galleta: galletaSesion(token) };
}

async function limpiar(env) {
  const antes = Date.now() - 7 * 86400_000;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM mensajes WHERE conversacion IN (SELECT c.id FROM conversaciones c JOIN usuarios u ON u.id = c.usuario WHERE u.rol = 'invitado' AND u.creado < ?)").bind(antes),
    env.DB.prepare("DELETE FROM conversaciones WHERE usuario IN (SELECT id FROM usuarios WHERE rol = 'invitado' AND creado < ?)").bind(antes),
    env.DB.prepare('DELETE FROM sesiones WHERE expira < ?').bind(Date.now()),
    env.DB.prepare("DELETE FROM usuarios WHERE rol = 'invitado' AND creado < ?").bind(antes),
    env.DB.prepare('DELETE FROM cuotas WHERE expira < ?').bind(Date.now()),
  ]);
}

async function contador(env, clave) {
  const f = await env.DB.prepare('SELECT n FROM cuotas WHERE clave = ? AND expira > ?').bind(clave, Date.now()).first();
  return f?.n || 0;
}

export async function uso(env, usuario) {
  const d = hoy();
  return {
    chat: { usados: await contador(env, `u:${usuario}:chat:${d}`), limite: LIMITES.chat },
    investigar: { usados: await contador(env, `u:${usuario}:investigar:${d}`), limite: LIMITES.investigar },
  };
}

/** Cuenta una petición; lanza 429 con un mensaje claro si se pasa de algún límite. */
/** peso: cuántos usos cuenta (combinar varios modelos cuesta uno por modelo). */
export async function consumir(env, request, usuario, modo, peso = 1) {
  const d = hoy();
  const tipo = modo === 'investigar' ? 'investigar' : 'chat';
  const ip = request.headers.get('CF-Connecting-IP') || 'sin-ip';
  const claves = [[`u:${usuario}:${tipo}:${d}`, LIMITES[tipo]], [`ip:${ip}:${d}`, LIMITES.ip], [`total:${d}`, LIMITES.total]];
  for (const [clave, limite] of claves) {
    if ((await contador(env, clave)) + peso > limite) {
      const msg = peso > 1 && !clave.startsWith('total') ? `No te quedan usos suficientes para combinar ${peso} modelos hoy. Prueba con menos modelos o con uno solo.` : clave.startsWith('total')
        ? 'La versión de prueba llegó a su límite de hoy. Vuelve mañana o crea tu propio laboratorio.ia gratis: https://labia-ciencia.pages.dev'
        : `Llegaste al límite de la versión de prueba (${limite} ${tipo === 'investigar' ? 'investigaciones' : 'mensajes'} al día). Crea tu propio laboratorio.ia gratis, sin límites de prueba: https://labia-ciencia.pages.dev`;
      throw Object.assign(new Error(msg), { estado: 429 });
    }
  }
  const expira = finDelDia();
  await env.DB.batch(claves.map(([clave]) => env.DB.prepare('INSERT INTO cuotas (clave, n, expira) VALUES (?, ?, ?) ON CONFLICT(clave) DO UPDATE SET n = n + ?').bind(clave, peso, expira, peso)));
}

// Lo que la demo no permite: cuentas, claves, configuración, crear skills, imágenes y la API.
export function rutaBloqueada(metodo, ruta) {
  if (ruta.startsWith('/api/cuenta')) return true;
  if (ruta.startsWith('/api/proveedores/') && metodo !== 'GET') return true;
  if (ruta.startsWith('/api/tareas') && metodo !== 'GET') return true;
  if (ruta.startsWith('/api/skills') && metodo !== 'GET') return true;
  if (ruta.startsWith('/api/entrenamiento/modelos') || ruta.startsWith('/api/entrenamiento/auto') || ruta.startsWith('/api/entrenamiento/sinteticos')) return true;
  return false;
}
