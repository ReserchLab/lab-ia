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
