// Acceso a la red que usan las fuentes y la verificación. Cada plataforma lo configura:
// el servidor del teléfono con node:https (IPv4, tiempos largos) y la nube con fetch.
//   pedir(url, tipo = 'json') → objeto JSON o texto; lanza Error en HTTP ≥ 400.
//   obtener(url, tipo, saltos, { max, total, parcial }) → { estado, tipo, final, texto }.
export const red = { pedir: null, obtener: null };

export function configurarRed(impl) {
  Object.assign(red, impl);
}
