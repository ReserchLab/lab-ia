// Proveedores de FreeLLMAPI desde la app: sesión del dashboard, activar los gratis sin clave,
// añadir y probar claves. La sesión se guarda en la configuración de `ia`
// (/root/.config/ia/config), así la app y el menú de Termux comparten la misma.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const CONFIG_IA = '/root/.config/ia/config';
const ENLACES = [
  '/root/freellmapi/client/src/components/keys/shared.tsx',
  '/root/freellmapi/client/src/lib/search.ts',
];
// Claves gratis que más mejoran laboratorio.ia, con el motivo.
const RECOMENDADOS = {
  tavily: 'Búsqueda web (1000 gratis al mes): el catálogo gratuito no trae buscador sin clave',
  groq: 'Texto muy rápido y gratis',
  google: 'Gemini: contexto enorme, ideal para investigar',
  openrouter: 'Muchos modelos :free',
  cloudflare: 'Imágenes FLUX de buena calidad',
  pollinations: 'Imágenes sin marca de agua',
};
// Funcionan sin clave aunque el servidor no los marque como keyless.
const ANONIMOS = { llm7: 'unused' };

function guardarEnConfig(variable, valor) {
  if (!existsSync(CONFIG_IA)) return;
  const texto = readFileSync(CONFIG_IA, 'utf8');
  const linea = `${variable}="${valor}"`;
  const re = new RegExp(`^${variable}=.*$`, 'm');
  const nuevo = re.test(texto) ? texto.replace(re, linea) : `${texto.trimEnd()}\n${linea}\n`;
  writeFileSync(CONFIG_IA, nuevo, { mode: 0o600 });
}
const guardarToken = token => guardarEnConfig('FREELLMAPI_DASHBOARD_TOKEN', token);

function enlaces() {
  const mapa = {};
  const re = /value:\s*'([\w-]+)',\s*label:\s*'((?:[^'\\]|\\.)*)',\s*url:\s*'([^']+)'/g;
  for (const f of ENLACES) {
    try { for (const m of readFileSync(f, 'utf8').matchAll(re)) mapa[m[1]] = { etiqueta: m[2], url: m[3] }; } catch { /* sin enlaces */ }
  }
  return mapa;
}

export class Proveedores {
  constructor(gateway) { this.gateway = gateway; }

  async tablero(ruta, metodo = 'GET', cuerpo) {
    const res = await this.gateway.pedir(ruta, { metodo, cuerpo, tablero: true, tiempo: 60_000 });
    const datos = await res.json().catch(() => ({}));
    // Un 401 del dashboard (sesión caducada, contraseña mal) no es el PIN de laboratorio.ia: se devuelve como 400.
    if (!res.ok) throw Object.assign(new Error(datos?.error?.message || `FreeLLMAPI respondió ${res.status}`), { estado: res.status === 401 ? 400 : res.status });
    return datos;
  }

  /** 'ok' con sesión válida, 'setup' si aún no hay cuenta, 'login' si hay que iniciar sesión. */
  async sesion() {
    const s = await this.tablero('/api/auth/status');
    return s.authenticated ? 'ok' : s.needsSetup ? 'setup' : 'login';
  }

  async entrar(email, password) {
    const estado = await this.sesion();
    if (estado === 'ok') return { sesion: 'ok' };
    const r = await this.tablero(`/api/auth/${estado === 'setup' ? 'setup' : 'login'}`, 'POST', { email, password });
    guardarToken(r.token);
    // Cuenta recién creada: se activan los gratis sin clave.
    const activados = estado === 'setup' ? await this.activarGratis() : [];
    return { sesion: 'ok', activados };
  }

  async lista() {
    const sesion = await this.sesion();
    if (sesion !== 'ok') return { sesion, proveedores: [] };
    const { providers, summary } = await this.tablero('/api/keys/providers');
    const claves = await this.tablero('/api/keys');
    const links = enlaces();
    return {
      sesion,
      resumen: summary,
      proveedores: providers.map(p => {
        const suyas = claves.filter(k => k.platform === p.platform);
        return {
          id: p.platform,
          nombre: p.name,
          tipo: p.kind === 'search' ? 'búsqueda' : 'chat',
          sinClave: Boolean(p.keyless || p.platform in ANONIMOS),
          configurado: p.configured,
          estado: suyas.length ? (suyas.some(k => k.status === 'healthy') ? 'sana' : suyas[0].status) : null,
          enlace: links[p.platform]?.url || '',
          nota: links[p.platform]?.etiqueta?.match(/\(([^)]+)\)/)?.[1] || '',
          recomendado: RECOMENDADOS[p.platform] || '',
        };
      }),
    };
  }

  async activarGratis() {
    const { providers } = await this.tablero('/api/keys/providers');
    const hechos = [];
    for (const p of providers.filter(x => (x.keyless || x.platform in ANONIMOS) && !x.configured)) {
      const clave = ANONIMOS[p.platform];
      await this.tablero('/api/keys', 'POST', { platform: p.platform, label: 'anónimo', ...(clave ? { key: clave } : {}) });
      hechos.push(p.name);
    }
    return hechos;
  }

  /** Guarda la clave y la comprueba con el chequeo de salud del gateway. */
  async agregar(plataforma, clave) {
    // laboratorio.ia usa la clave de Pollinations directamente para las imágenes (FLUX real, sin marca de agua).
    if (plataforma === 'pollinations') guardarEnConfig('POLLINATIONS_API_KEY', clave);
    // Google también sirve para las imágenes Nano Banana (de pago, opcional).
    if (plataforma === 'google') guardarEnConfig('GOOGLE_API_KEY', clave);
    if (plataforma === 'openai') guardarEnConfig('OPENAI_API_KEY', clave);
    const r = await this.tablero('/api/keys', 'POST', { platform: plataforma, key: clave });
    let estado = 'desconocido';
    let detalle = '';
    try {
      const h = await this.tablero(`/api/health/check/${r.id}`, 'POST');
      const actual = (await this.tablero('/api/keys')).find(k => k.id === r.id);
      estado = actual?.lastHealthError && h.status !== 'invalid' ? 'sin confirmar' : (h.status === 'healthy' ? 'válida' : h.status);
      detalle = actual?.lastHealthError || '';
    } catch (e) { detalle = e.message; }
    return { id: r.id, enmascarada: r.maskedKey, modelos: r.modelsAvailable ?? null, estado, detalle };
  }
}
