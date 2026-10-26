// Formato de las skills: el mismo SKILL.md que las skills de Claude (frontmatter `name` y
// `description` + instrucciones en Markdown) con campos propios opcionales:
//   nombre, resumen (descripción en español para la interfaz), icono, modo (chat|investigar|imagen),
//   fuentes (lista separada por comas), modelo, tarea (chat|investigar|razonamiento|codigo),
//   leer (si: abre y lee las páginas de los resultados),
//   verificacion (basica: citas, enlaces y DOI | completa: además revisa cada afirmación con IA), categoria.
// Las referencias (carpeta references/ en disco) aportan material extra al contexto.

const LIMITE_INSTRUCCIONES = 14_000;
const LIMITE_TOTAL = 22_000;
const MODOS = new Set(['chat', 'investigar', 'imagen']);

export function slug(texto) {
  return String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'skill';
}

export function leerFrontmatter(texto) {
  const m = texto.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { datos: {}, cuerpo: texto };
  const datos = {};
  for (const linea of m[1].split(/\r?\n/)) {
    const kv = linea.match(/^([\w-]+):\s*(.*)$/);
    if (kv) datos[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return { datos, cuerpo: m[2].trim() };
}

/** Normaliza los datos de una skill nueva o editada (formulario o IA). */
export function normalizar(datos) {
  const id = slug(datos.id || datos.nombre);
  return {
    id,
    nombre: datos.nombre || id,
    descripcion: datos.descripcion || '',
    icono: datos.icono || '◇',
    modo: MODOS.has(datos.modo) ? datos.modo : 'chat',
    fuentes: Array.isArray(datos.fuentes) ? datos.fuentes : [],
    modelo: datos.modelo || '',
    tarea: datos.tarea || '',
    leer: Boolean(datos.leer),
    verificacion: datos.verificacion === 'completa' ? 'completa' : 'basica',
    categoria: datos.categoria || 'Mis skills',
    instrucciones: datos.instrucciones || '',
  };
}

export function aMarkdown(s) {
  const una = v => String(v ?? '').replace(/\r?\n/g, ' ').trim();
  const lineas = [
    `name: ${s.id}`,
    `description: ${una(s.descripcion)}`,
    `nombre: ${una(s.nombre)}`,
    `icono: ${una(s.icono)}`,
    `modo: ${s.modo}`,
    `fuentes: ${(s.fuentes || []).join(', ')}`,
    `categoria: ${una(s.categoria)}`,
  ];
  if (s.modelo) lineas.push(`modelo: ${una(s.modelo)}`);
  if (s.tarea) lineas.push(`tarea: ${una(s.tarea)}`);
  if (s.leer) lineas.push('leer: si');
  if (s.verificacion === 'completa') lineas.push('verificacion: completa');
  return `---\n${lineas.join('\n')}\n---\n\n${String(s.instrucciones || '').trim()}\n`;
}

/** SKILL.md → objeto skill. referencias: [{ nombre, contenido }]. */
export function desdeMarkdown(texto, { id: idPorDefecto, propia = false, referencias = [] } = {}) {
  const { datos, cuerpo } = leerFrontmatter(texto);
  const id = slug(datos.name || idPorDefecto || 'skill');
  return {
    id,
    nombre: datos.nombre || datos.name || id,
    descripcion: datos.resumen || datos.description || '',
    icono: datos.icono || '◇',
    modo: MODOS.has(datos.modo) ? datos.modo : 'chat',
    fuentes: (datos.fuentes || '').split(',').map(f => f.trim()).filter(Boolean),
    modelo: datos.modelo || '',
    tarea: datos.tarea || '',
    leer: datos.leer === 'si',
    verificacion: ['basica', 'completa'].includes(datos.verificacion) ? datos.verificacion : 'basica',
    categoria: datos.categoria || (propia ? 'Mis skills' : 'General'),
    instrucciones: cuerpo,
    referencias,
    propia,
  };
}

export const ordenar = lista => [...lista].sort((a, b) => a.categoria.localeCompare(b.categoria) || a.nombre.localeCompare(b.nombre));

/** Texto de sistema de la skill: instrucciones + referencias hasta el límite de contexto. */
export function sistemaDe(skill) {
  if (!skill) return '';
  let texto = skill.instrucciones.slice(0, LIMITE_INSTRUCCIONES);
  for (const ref of skill.referencias || []) {
    if (texto.length + ref.contenido.length > LIMITE_TOTAL) {
      texto += `\n\n(Referencia disponible no incluida por espacio: ${ref.nombre})`;
      continue;
    }
    texto += `\n\n---\n## Referencia: ${ref.nombre}\n\n${ref.contenido}`;
  }
  return texto;
}

/** Lo que ve la interfaz: sin el contenido de las referencias. */
export const publica = ({ dir, referencias = [], ...s }) => ({ ...s, referencias: referencias.map(r => r.nombre) });
