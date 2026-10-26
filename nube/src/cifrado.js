// Cifrado de las claves de proveedores (AES-GCM) y contraseñas (PBKDF2).
// La clave maestra sale del secreto CLAVE_MAESTRA; si no existe, se genera una y se guarda en D1
// (así el botón «Deploy to Cloudflare» funciona sin pasos extra). Con el secreto es más seguro:
//   npx wrangler secret put CLAVE_MAESTRA
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const desdeB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');

let claveCache = null;

async function claveMaestra(env) {
  if (claveCache) return claveCache;
  let bruta = env.CLAVE_MAESTRA;
  if (!bruta) {
    const fila = await env.DB.prepare("SELECT valor FROM ajustes WHERE usuario = '' AND clave = 'clave_maestra'").first();
    bruta = fila?.valor;
    if (!bruta) {
      bruta = b64(crypto.getRandomValues(new Uint8Array(32)));
      await env.DB.prepare("INSERT OR IGNORE INTO ajustes (usuario, clave, valor) VALUES ('', 'clave_maestra', ?)").bind(bruta).run();
      bruta = (await env.DB.prepare("SELECT valor FROM ajustes WHERE usuario = '' AND clave = 'clave_maestra'").first()).valor;
    }
  }
  const material = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bruta));
  claveCache = await crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return claveCache;
}

export async function cifrar(env, texto) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const datos = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await claveMaestra(env), new TextEncoder().encode(texto));
  return { cifrada: b64(datos), iv: b64(iv) };
}

export async function descifrar(env, cifrada, iv) {
  const datos = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: desdeB64(iv) }, await claveMaestra(env), desdeB64(cifrada));
  return new TextDecoder().decode(datos);
}

export async function sha256(texto) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)));
}

// 20 000 iteraciones: suficiente contra fuerza bruta casual y cabe en los 10 ms de CPU del plan gratuito.
const ITERACIONES = 20_000;

export async function hashContrasena(contrasena, sal = b64(crypto.getRandomValues(new Uint8Array(16)))) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(contrasena), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: desdeB64(sal), iterations: ITERACIONES }, base, 256);
  return { hash: b64(bits), sal };
}

export function aleatorio(bytes = 24) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Comparación en tiempo constante de dos textos. */
export function iguales(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
