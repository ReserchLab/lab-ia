// Cuentas de laboratorio.ia en la nube: registro, sesión por galleta y clave unificada (labia-…)
// para usar los modelos desde otros programas (API compatible con OpenAI en /v1).
import { aleatorio, cifrar, descifrar, hashContrasena, iguales, sha256 } from './cifrado.js';

const DIAS_SESION = 30;
const NOMBRE_GALLETA = 'labia_sesion';

export function leerGalleta(request) {
  const c = request.headers.get('Cookie') || '';
  return c.split(';').map(x => x.trim()).find(x => x.startsWith(`${NOMBRE_GALLETA}=`))?.slice(NOMBRE_GALLETA.length + 1) || '';
}

export const galletaSesion = token => `${NOMBRE_GALLETA}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DIAS_SESION * 86400}`;
export const galletaBorrada = () => `${NOMBRE_GALLETA}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export async function usuarioDeSesion(env, request) {
  const token = leerGalleta(request);
  if (!token) return null;
  return env.DB.prepare('SELECT u.id, u.email, u.rol FROM sesiones s JOIN usuarios u ON u.id = s.usuario WHERE s.token_hash = ? AND s.expira > ?')
    .bind(await sha256(token), Date.now()).first();
}

export async function usuarioDeClave(env, request) {
  const auth = request.headers.get('Authorization') || '';
  const clave = auth.replace(/^Bearer\s+/i, '').trim() || request.headers.get('x-api-key') || '';
  if (!clave.startsWith('labia-')) return null;
  return env.DB.prepare('SELECT id, email, rol FROM usuarios WHERE clave_hash = ?').bind(await sha256(clave)).first();
}

async function nuevaClave(env) {
  const clave = `labia-${aleatorio(24)}`;
  const { cifrada, iv } = await cifrar(env, clave);
  return { clave, clave_hash: await sha256(clave), clave_cifrada: cifrada, clave_iv: iv };
}

async function crearSesion(env, usuario) {
  const token = aleatorio(32);
  await env.DB.prepare('INSERT INTO sesiones (token_hash, usuario, expira) VALUES (?, ?, ?)')
    .bind(await sha256(token), usuario, Date.now() + DIAS_SESION * 86400_000).run();
  return token;
}

export async function registroAbierto(env) {
  const fila = await env.DB.prepare("SELECT valor FROM ajustes WHERE usuario = '' AND clave = 'registro_abierto'").first();
  return fila?.valor === 'si';
}

export async function hayUsuarios(env) {
  return Boolean(await env.DB.prepare('SELECT 1 FROM usuarios LIMIT 1').first());
}

/** El primer usuario es el administrador. Después, solo si el administrador abre el registro. */
export async function registrar(env, email, contrasena) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Object.assign(new Error('Escribe un email válido'), { estado: 400 });
  if (String(contrasena || '').length < 8) throw Object.assign(new Error('La contraseña necesita al menos 8 caracteres'), { estado: 400 });
  const primero = !(await hayUsuarios(env));
  if (!primero && !(await registroAbierto(env))) throw Object.assign(new Error('El registro está cerrado. Pide acceso al administrador de este laboratorio.ia.'), { estado: 403 });
  if (await env.DB.prepare('SELECT 1 FROM usuarios WHERE email = ?').bind(email).first()) throw Object.assign(new Error('Ese email ya tiene cuenta'), { estado: 409 });
  const { hash, sal } = await hashContrasena(contrasena);
  const id = crypto.randomUUID();
  const c = await nuevaClave(env);
  await env.DB.prepare('INSERT INTO usuarios (id, email, hash, sal, rol, clave_hash, clave_cifrada, clave_iv, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, email, hash, sal, primero ? 'admin' : 'usuario', c.clave_hash, c.clave_cifrada, c.clave_iv, Date.now()).run();
  return crearSesion(env, id);
}

export async function entrar(env, email, contrasena) {
  const u = await env.DB.prepare('SELECT id, hash, sal FROM usuarios WHERE email = ?').bind(String(email || '').trim().toLowerCase()).first();
  // Se calcula el hash aunque el usuario no exista, para no revelar qué emails tienen cuenta.
  const { hash } = await hashContrasena(String(contrasena || ''), u?.sal || 'AAAAAAAAAAAAAAAAAAAAAA==');
  if (!u || !iguales(hash, u.hash)) throw Object.assign(new Error('Email o contraseña incorrectos'), { estado: 400 });
  await env.DB.prepare('DELETE FROM sesiones WHERE expira < ?').bind(Date.now()).run();
  return crearSesion(env, u.id);
}

export async function salir(env, request) {
  const token = leerGalleta(request);
  if (token) await env.DB.prepare('DELETE FROM sesiones WHERE token_hash = ?').bind(await sha256(token)).run();
}

export async function claveUnificada(env, usuario) {
  const u = await env.DB.prepare('SELECT clave_cifrada, clave_iv FROM usuarios WHERE id = ?').bind(usuario).first();
  return u?.clave_cifrada ? descifrar(env, u.clave_cifrada, u.clave_iv) : null;
}

export async function regenerarClave(env, usuario) {
  const c = await nuevaClave(env);
  await env.DB.prepare('UPDATE usuarios SET clave_hash = ?, clave_cifrada = ?, clave_iv = ? WHERE id = ?').bind(c.clave_hash, c.clave_cifrada, c.clave_iv, usuario).run();
  return c.clave;
}

export async function ponerRegistroAbierto(env, abierto) {
  await env.DB.prepare("INSERT OR REPLACE INTO ajustes (usuario, clave, valor) VALUES ('', 'registro_abierto', ?)").bind(abierto ? 'si' : 'no').run();
}
