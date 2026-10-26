// Modelos por tarea: cada tipo de trabajo puede usar el modelo que mejor le va.
// La elección se guarda en config.json (cfg.tareas); 'auto' deja que FreeLLMAPI elija.

export const TAREAS = [
  { id: 'chat', nombre: 'Conversación', icono: '◎', descripcion: 'Chat general y skills sin tarea propia.' },
  { id: 'investigar', nombre: 'Investigación', icono: '⌕', descripcion: 'Leer muchas fuentes y redactar con citas. Mejor con contexto largo.' },
  { id: 'razonamiento', nombre: 'Razonamiento', icono: '∑', descripcion: 'Matemáticas, estadística, diseño experimental, revisar artículos.' },
  { id: 'codigo', nombre: 'Código', icono: '⌘', descripcion: 'Python, R, bioinformática y pipelines.' },
  { id: 'rapido', nombre: 'Tareas internas', icono: '⚡', descripcion: 'Planificar búsquedas, mejorar prompts de imagen, crear skills. Mejor rápido.' },
  { id: 'imagen', nombre: 'Imágenes', icono: '◉', descripcion: 'Generación de imágenes.' },
];

// Pistas por nombre de modelo, de más a menos adecuado para cada tarea.
const PISTAS = {
  codigo: [/coder|codestral|devstral|north-.*code|poolside|kimi-dev/i, /qwen3\.[5-9]|gpt-oss-120b|nemotron-3-ultra|deepseek/i, /qwen|gpt-oss|glm|kimi|nemotron-3-super/i],
  razonamiento: [/\br1\b|-r1|qwq|magistral|thinking|nemotron-3-ultra|qwen3\.5-397b/i, /reason|gpt-oss-120b|qwen3\.8|deepseek/i, /qwen3|nemotron-3-super|glm|kimi|dots/i],
  investigar: [/nemotron-3-ultra|qwen3\.5-397b|gemini|llama-4|dots3/i, /nemotron-3-super|gpt-oss-120b|qwen3\.[6-9]|deepseek|glm|kimi|agnes-2\.5-pro/i, /qwen3|mistral-small|llama-3\.3/i],
  rapido: [/flash|lightning|instant|turbo|nano|lite/i, /gpt-oss-20b|qwen3\.5-9b|mistral-small|llama-3\.2-3b|mini|small|lfm/i],
  chat: [/gpt-oss-120b|qwen3\.5-397b|qwen3\.8|nemotron-3-super|nemotron-3-ultra|llama-3\.3-70b|dots3/i, /qwen3|mistral-small|agnes-2\.5|gemma|deepseek|glm|llama-4/i],
};
// Modelos que no sirven para estas tareas: rol/sin censura, moderación, de juguete, routers genéricos y
// alias de compatibilidad (claude-*, gpt-4o…: FreeLLMAPI los redirige a otro modelo, no son el original).
const DESCARTA = /^(claude|gpt-4|gpt-5|o[134])-|embed|whisper|tts|guard|safety|moderation|rerank|uncensored|heretic|abliterat|(^|[-_])rp([-_]|$)|stheno|impish|behemoth|drummer|cydonia|skyfall|angelic|safeword|bloodmoon|magnum|lotus|rocinante|thea|magidonia|nymphaea|nova-rp|pythia|cerebras-gpt|111m|70m|0\.[568]b|[-_]1b|^(auto|default|fusion|free-router|kilo-auto)$/i;

function puntuar(m, tarea) {
  if (DESCARTA.test(m.id)) return -1;
  let p = 0;
  for (const [i, re] of (PISTAS[tarea] || []).entries()) {
    if (re.test(m.id) || re.test(m.nombre || '')) { p += 12 - i * 4; break; }
  }
  if (!p) return -1;
  const ctx = m.contexto || 0;
  if (ctx && ctx < 16_000) p -= 6; // con poco contexto no caben las fuentes ni el historial
  if (tarea === 'investigar') p += Math.min(ctx / 128_000, 4);
  else if (tarea !== 'rapido') p += Math.min(ctx / 256_000, 1);
  return p;
}

export function recomendados(modelos, tarea, n = 6) {
  return modelos
    .map(m => ({ m, p: puntuar(m, tarea) }))
    .filter(x => x.p > 0)
    .sort((a, b) => b.p - a.p)
    .slice(0, n)
    .map(x => x.m);
}

/** Tarea que corresponde a una petición: la de la skill si la declara; si no, por modo y categoría. */
export function tareaDe(skill, modo) {
  if (modo === 'imagen') return 'imagen';
  if (skill?.tarea && TAREAS.some(t => t.id === skill.tarea)) return skill.tarea;
  if (modo === 'investigar') return 'investigar';
  if (skill?.categoria === 'Código') return 'codigo';
  return 'chat';
}

// ── Recomendación según lo que se pregunta ─────────────────────────────────
// Temas detectados por palabras clave (español e inglés). Cada tema elige la tarea cuyos modelos
// encajan mejor y explica el motivo; la skill y el modo pesan, pero el texto manda.
const TEMAS = [
  { id: 'codigo', tarea: 'codigo', motivo: 'Es código o análisis de datos', re: /```|\b(python|javascript|typescript|bash|sql|código|codigo|script|traceback|stack trace|pandas|numpy|scanpy|seurat|bioconductor|ggplot|nextflow|snakemake|docker|regex|bug|compila|programa en|en R|jupyter|notebook)\b/i },
  { id: 'matematicas', tarea: 'razonamiento', motivo: 'Necesita cálculo o razonamiento paso a paso', re: /\b(demuestra|demostración|ecuaci|integral|derivad|matriz|probabilidad|estadístic|estadistic|p-valor|p valor|anova|regresi|bayes|tamaño de muestra|potencia estadística|calcula|resuelve|teorema|optimiza|lógica)\b|[=∑∫√≤≥±]/i },
  { id: 'biomedicina', tarea: 'investigar', motivo: 'Tema biomédico: conviene contexto largo para leer estudios', re: /\b(paciente|enfermedad|tratamiento|fármaco|farmaco|medicamento|mecanismo de acción|mecanismo de accion|farmacolog\w*|dosis|ensayo clínico|ensayo clinico|cáncer|cancer|diabetes|tumor\w*|síntoma\w*|sintoma\w*|terapia|vacuna\w*|clínic\w*|clinic\w*|metaanálisis|metaanalisis|cohorte|mortalidad|insulina|hígado|higado|riñón|rinon|corazón|cerebr\w*|sangre|hormona\w*|inflamaci\w*|infecci\w*|virus|bacteria\w*|antibiótic\w*|fisiolog\w*|patolog\w*|nutrici\w*|dieta|obesidad|hipertensi\w*|alzheimer|parkinson|metformina|aspirina|fda)\b/i },
  { id: 'biologia', tarea: 'investigar', motivo: 'Biología molecular y celular: fuentes especializadas y contexto largo', re: /\b(gen|genes|proteína\w*|proteina\w*|crispr|arn|adn|rna|dna|célula\w*|celula\w*|mitocondri\w*|enzima\w*|receptor\w*|expresión génica|secuenciación|secuenciacion|mutaci\w*|genoma\w*|single-cell|scrna|epigen\w*|metabol\w*|ribosoma\w*|fotosíntesis|fotosintesis|evoluci\w*|especie\w*|ecosistema\w*|microbio\w*)\b/i },
  { id: 'quimica', tarea: 'razonamiento', motivo: 'Química: estructura y mecanismo, razonamiento cuidadoso', re: /\b(molécula|molecula|reacción|reaccion|síntesis|sintesis|smiles|enlace|ph|pka|estequiometr|orgánica|organica|catalizador|ic50|ki\b)/i },
  { id: 'revision', tarea: 'razonamiento', motivo: 'Revisión crítica de un texto: razonamiento y precisión', re: /\b(revisa|revisión del|critica|evalúa este|evalua este|abstract|manuscrito|paper|artículo adjunto|peer review)\b/i },
  { id: 'redaccion', tarea: 'chat', motivo: 'Redacción o traducción: fluidez y estilo', re: /\b(redacta|escribe|traduce|traducción|resume|resumen de|corrige|mejora el texto|carta|correo|ensayo)\b/i },
];

/** Familia del modelo (para combinar modelos distintos entre sí, no variantes del mismo). */
export function familia(id) {
  const n = id.toLowerCase();
  const fams = ['nemotron', 'qwen', 'llama', 'gemma', 'gpt-oss', 'glm', 'mistral', 'deepseek', 'poolside', 'dots', 'kimi', 'granite', 'agnes', 'command', 'gemini', 'phi', 'codestral', 'north', 'sea-lion', 'openai'];
  return fams.find(f => n.includes(f)) || n.split('/').slice(-1)[0].split(/[-:._]/)[0];
}

export function clasificar(texto = '', { skill, modo } = {}) {
  const t = String(texto);
  if (t.length > 6000) return { tema: 'largo', tarea: 'investigar', motivo: 'Texto largo: hace falta un modelo con mucho contexto' };
  const tema = TEMAS.find(x => x.re.test(t));
  if (tema) return { tema: tema.id, tarea: tema.tarea, motivo: tema.motivo };
  if (skill?.tarea) return { tema: 'skill', tarea: skill.tarea, motivo: `Lo que mejor encaja con la skill ${skill.nombre}` };
  if (modo === 'investigar') return { tema: 'investigar', tarea: 'investigar', motivo: 'Investigación con fuentes: contexto largo' };
  return { tema: 'general', tarea: 'chat', motivo: 'Conversación general' };
}

/**
 * Modelos recomendados para un texto concreto. `combinacion`: los mejores de familias distintas,
 * para que al combinar respuestas cada modelo aporte una perspectiva diferente.
 */
export function recomendarPara(lista, texto, opciones = {}, n = 6) {
  const c = clasificar(texto, opciones);
  const candidatos = recomendados(lista, c.tarea, 20);
  const modelos = candidatos.slice(0, n);
  const combinacion = [];
  const vistas = new Set();
  for (const m of candidatos) {
    const f = familia(m.id);
    if (vistas.has(f)) continue;
    vistas.add(f);
    combinacion.push(m.id);
    if (combinacion.length === 3) break;
  }
  return { ...c, modelos, combinacion };
}
