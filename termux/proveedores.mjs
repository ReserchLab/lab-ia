// Ayudante de `ia` para la sesión del dashboard y las claves de proveedores de FreeLLMAPI.
// Uso: node proveedores.mjs <comando> [args]   (lee FREELLMAPI_URL y FREELLMAPI_DASHBOARD_TOKEN)
//   status                 → needsSetup|authenticated|login
//   setup <email> <pass>   → imprime el token de sesión
//   login <email> <pass>   → imprime el token de sesión
//   auto                   → activa los proveedores que funcionan sin clave
//   list                   → tabla numerada: plataforma, nombre, estado, enlace
//   add <plataforma> <key> → guarda la clave y la prueba
import { readFileSync } from 'node:fs';

const URL_BASE = (process.env.FREELLMAPI_URL || 'http://127.0.0.1:31415').replace(/\/+$/, '');
const TOKEN = process.env.FREELLMAPI_DASHBOARD_TOKEN || '';
const LINK_SOURCES = [
  '/root/freellmapi/client/src/components/keys/shared.tsx',
  '/root/freellmapi/client/src/lib/search.ts',
];

// Proveedores sin clave que el servidor no marca como keyless pero aceptan acceso anónimo.
const ANON_KEYS = { llm7: 'unused' };

async function api(method, path, body) {
  const res = await fetch(URL_BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) fail('La sesión caducó: vuelve a iniciar sesión.', 3);
  if (!res.ok) fail(data?.error?.message || `HTTP ${res.status}`);
  return data;
}

function fail(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

// Enlaces de registro/claves tal como los muestra el dashboard.
function signupLinks() {
  const links = {};
  const re = /value:\s*'([\w-]+)',\s*label:\s*'((?:[^'\\]|\\.)*)',\s*url:\s*'([^']+)'/g;
  for (const file of LINK_SOURCES) {
    try {
      for (const m of readFileSync(file, 'utf8').matchAll(re)) links[m[1]] = { label: m[2], url: m[3] };
    } catch { /* sin el código fuente solo faltan los enlaces */ }
  }
  return links;
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'status') {
  const s = await api('GET', '/api/auth/status');
  console.log(s.needsSetup ? 'needsSetup' : s.authenticated ? 'authenticated' : 'login');
} else if (cmd === 'setup' || cmd === 'login') {
  const [email, password] = args;
  const r = await api('POST', `/api/auth/${cmd}`, { email, password });
  console.log(r.token);
} else if (cmd === 'auto') {
  const { providers } = await api('GET', '/api/keys/providers');
  const auto = providers.filter(p => p.keyless || p.platform in ANON_KEYS);
  for (const p of auto) {
    if (p.configured) { console.log(`  = ${p.name}: ya estaba`); continue; }
    const key = ANON_KEYS[p.platform];
    await api('POST', '/api/keys', { platform: p.platform, label: 'anónimo', ...(key ? { key } : {}) });
    console.log(`  + ${p.name}: activado sin clave`);
  }
} else if (cmd === 'list') {
  const { providers, summary } = await api('GET', '/api/keys/providers');
  const links = signupLinks();
  providers.forEach((p, i) => {
    const mark = p.configured ? '✔' : p.keyless || p.platform in ANON_KEYS ? '○' : ' ';
    const kind = p.kind === 'search' ? ' [búsqueda]' : '';
    const url = links[p.platform]?.url || '';
    console.log([i + 1, p.platform, mark, p.name + kind, url].join('\t'));
  });
  console.error(`${summary.configured}/${summary.total} configurados`);
} else if (cmd === 'add') {
  const [platform, key] = args;
  const r = await api('POST', '/api/keys', { platform, key });
  const models = r.modelsAvailable ?? '?';
  console.log(`Guardada (${r.maskedKey}). Modelos disponibles: ${models}${r.notice ? ` — ${r.notice}` : ''}`);
} else {
  fail('Comando desconocido');
}
