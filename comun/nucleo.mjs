// Núcleo de laboratorio.ia, común al servidor del teléfono y a la nube (Cloudflare).
// Cada plataforma aporta:
//   gateway  — completar(), conversar(), imagen(), modelosTexto(), modelosImagen(), buscar()
//   almacen  — conversaciones y mensajes (métodos síncronos o asíncronos)
//   skills   — todas(), obtener(), guardar(), borrar(), sistema()
//   tareas   — obtener(id) → modelo|'auto', todas(), poner(id, modelo)
//   guardarImagen(datos, tipo) → URL pública de la imagen
import { catalogo, scholar } from './fuentes.mjs';
import { citasDe, leerPagina, verificar } from './verificacion.mjs';
import { TAREAS, recomendados, recomendarPara, tareaDe } from './tareas.mjs';
import { publica } from './skills.mjs';
import { construirDatos } from './entrenamiento.mjs';

export const TAMANOS = { cuadrado: [1024, 1024], vertical: [768, 1344], horizontal: [1344, 768] };

// Estilos de imagen: guía para que el prompt describa la imagen como lo haría un profesional del género.
export const ESTILOS = {
  fotorrealista: { nombre: 'Fotorrealista', guia: 'A professional photograph. Name the camera type (full-frame DSLR or mirrorless), the lens (e.g. 35 mm, 85 mm portrait, 100 mm macro), aperture and depth of field, and the exact lighting (golden-hour sunlight, overcast softbox, rim light…). Realistic textures, accurate proportions and true-to-life colors, sharp focus on the subject. It must not look like an illustration, painting or CGI.' },
  cientifica: { nombre: 'Ilustración científica', guia: 'An editorial scientific illustration in the style of a Nature or Cell cover: anatomically and molecularly accurate structures, clean balanced composition, cutaway or cross-section when it explains the subject, soft volumetric lighting, refined harmonious palette, very high detail.' },
  render3d: { nombre: 'Render 3D', guia: 'A high-end cinematic 3D render: physically based materials, global illumination, ambient occlusion, subtle depth of field, studio backdrop, crisp micro-detail.' },
  microscopia: { nombre: 'Microscopía', guia: 'A realistic microscopy image. Name the technique (confocal fluorescence, scanning electron microscopy, phase contrast or H&E histology), the magnification, and the characteristic colors, contrast and textures of that technique, with scale-appropriate detail.' },
  infografia: { nombre: 'Esquema', guia: 'A clean, minimal flat vector-style scientific diagram with clear shapes and arrows, consistent limited palette and plain background. Leave space for labels but do not write any text.' },
  arte: { nombre: 'Arte', guia: 'An artistic interpretation: choose the art style, medium and palette that best fit the request, with expressive lighting and strong composition.' },
};
export const CALIDADES = { rapida: 'Rápida', alta: 'Alta', premium: 'De pago' };

export const SISTEMA_BASE = `Eres laboratorio.ia, un asistente de investigación y creación.
- Responde en el idioma del usuario (español por defecto), con Markdown claro: títulos cortos, listas y tablas cuando ayuden.
- Para fórmulas usa notación legible en texto; para código, bloques con el lenguaje indicado.
- Sé preciso. Si no sabes algo o no hay evidencia, dilo; nunca inventes datos, cifras ni referencias.
- Recuerdas esta conversación: tienes sus mensajes y, si es larga, una memoria resumida de lo anterior.
  Cuando el usuario se refiera a algo previo («lo de antes», «la fuente 3 que citaste», «tu primera respuesta»),
  búscalo en el historial y la memoria y respóndelo con precisión; si no está, dilo.`;

const REGLAS_FUENTES = `Tienes resultados de búsqueda numerados. Básate en ellos y cita cada afirmación con [n] usando sus números.
Distingue evidencia sólida (revisiones, ensayos, metaanálisis) de preliminar (preprints, estudios pequeños, in vitro).
Si las fuentes no responden la pregunta, dilo y sugiere cómo buscar mejor. No inventes fuentes ni números de cita.`;

const INTEGRAR = `## Integración de respuestas
Recibes, al final del último mensaje, las respuestas de varios modelos distintos a esta misma pregunta.
Escribe UNA respuesta final mejor que cualquiera de ellas por separado:
- Combina lo correcto y lo complementario de cada una; corrige errores y elimina repeticiones.
- Si discrepan en algo importante, dilo explícitamente («Los modelos discrepan en…») y explica qué sostiene la evidencia o el razonamiento más sólido.
- Las respuestas se llaman A, B, C…: no son fuentes. Nunca las cites ni escribas «[1]», «[A]» o «según la respuesta B».
- Si hay «Resultados de búsqueda» numerados, conserva las citas [n] a esas fuentes. Si no los hay, no pongas ninguna cita entre corchetes.
- Mantén el formato pedido por la skill y responde en el idioma del usuario.
- Termina con una línea breve en cursiva: _Integrado a partir de N modelos_ (N = cuántas respuestas recibiste).`;

const FUENTES_POR_DEFECTO = ['web', 'semanticscholar', 'openalex', 'europepmc', 'wikipedia'];

export function jsonDe(texto) {
  const m = String(texto).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

const metaDe = m => (typeof m.meta === 'string' ? JSON.parse(m.meta || '{}') : m.meta || {});

/** Mensaje de error comprensible; cada plataforma puede añadir los suyos con `explicarExtra`. */
export function explicarErrorBase(e) {
  const m = e?.message || String(e);
  const causa = e?.cause?.code || e?.cause?.message || e?.code || '';
  if (/no_providers_configured|No candidate model|sin proveedores/i.test(m)) return 'No hay un proveedor con clave para este modelo. Añade claves en Ajustes → Modelos y proveedores, o elige otro modelo.';
  if (/aborted|timeout/i.test(m) || /TIMEOUT/.test(causa)) return `El proveedor tardó demasiado en responder${causa ? ` (${causa})` : ''}. Prueba de nuevo u otro modelo.`;
  return causa ? `${m} (${causa})` : m;
}

// verificacionAparte: en vez de verificar dentro de la petición del chat, se avisa al cliente para que
// la pida en otra (en Cloudflare cada petición tiene un límite de subpeticiones).
export function crearNucleo({ gateway, almacen, skills, tareas, guardarImagen, presupuesto = 40_000, explicarExtra, antesDeResponder, depurar, verificacionAparte = false }) {
  const FUENTES = catalogo(gateway);
  const modeloTarea = id => tareas.obtener(id);
  const explicarError = e => explicarExtra?.(e) || explicarErrorBase(e);

  // ── Investigación ────────────────────────────────────────────────────────
  async function planificarBusqueda(pregunta, contexto, modelo) {
    try {
      const { texto, razonamiento } = await gateway.completar([
        { role: 'system', content: 'Conviertes preguntas en consultas para bases de datos científicas y la web. Responde SOLO con JSON: {"es":"consulta breve en español","en":"short English keyword query (3-8 words, no stopwords, use standard scientific terms)","entidad":"the main gene symbol, protein, organism or compound name in English (e.g. TP53, insulin, imatinib), or empty string"}' },
        { role: 'user', content: `${contexto ? `Contexto previo: ${contexto}\n\n` : ''}Pregunta: ${pregunta}` },
      ], { modelo, max: 1500, temperatura: 0 }); // margen para los modelos que razonan antes de responder
      const j = jsonDe(texto) || jsonDe(razonamiento);
      if (j?.en && j?.es) return { es: String(j.es).slice(0, 200), en: String(j.en).slice(0, 200), entidad: String(j.entidad || '').slice(0, 80) };
    } catch { /* si el plan falla se busca con la pregunta tal cual */ }
    return { es: pregunta.slice(0, 200), en: pregunta.slice(0, 200), entidad: '' };
  }

  async function investigar(pregunta, contexto, ids, modelo, emitir) {
    const elegidas = FUENTES.filter(f => ids.includes(f.id));
    if (!elegidas.length) return { fuentes: [], fallos: [], consultas: [] };
    emitir('estado', { texto: 'Preparando la búsqueda…' });
    const plan = await planificarBusqueda(pregunta, contexto, modelo);
    emitir('estado', { texto: `Buscando «${plan.es}» en ${elegidas.map(f => f.nombre).join(', ')}…`, plan });
    const porFuente = elegidas.length > 5 ? 3 : 4;
    const termino = f => (f.entidad && plan.entidad ? plan.entidad : f.idioma === 'en' ? plan.en : plan.es);
    const resultados = await Promise.allSettled(elegidas.map(f => f.buscar(termino(f), porFuente)));
    const lista = [];
    const fallos = [];
    resultados.forEach((r, i) => {
      if (r.status === 'fulfilled') for (const x of r.value) lista.push({ ...x, fuente: elegidas[i].nombre });
      else fallos.push(`${elegidas[i].nombre}: ${r.reason?.message || 'sin respuesta'}`);
    });
    const vistos = new Set();
    const unicos = lista.filter(x => x.url && !vistos.has(x.url) && vistos.add(x.url)).slice(0, 24);
    // La misma búsqueda en la web de cada base, para repetirla y revisarla a mano.
    const consultas = elegidas.map(f => ({ fuente: f.nombre, termino: termino(f), url: f.consulta(termino(f)) }));
    consultas.push({ fuente: 'Google Scholar', termino: plan.en, url: scholar(plan.en) });
    return { fuentes: unicos.map((x, i) => ({ n: i + 1, ...x })), fallos, plan, consultas };
  }

  const bloqueFuentes = fuentes => fuentes.map(f => `[${f.n}] ${f.titulo}\n${f.fuente}${f.detalle ? ' · ' + f.detalle : ''}\n${f.url}\n${f.resumen}${f.texto ? `\nTexto leído de la página:\n${f.texto}` : ''}`).join('\n\n');

  // Lee las páginas de los mejores resultados (las de la web primero, que no traen resumen útil).
  async function leerFuentes(fuentes, emitir, n = 5) {
    const elegidas = [...fuentes].sort((a, b) => (a.fuente === 'Web' ? -1 : 0) - (b.fuente === 'Web' ? -1 : 0) || a.n - b.n).slice(0, n);
    emitir('estado', { texto: `Leyendo ${elegidas.length} páginas…` });
    const textos = await Promise.all(elegidas.map(f => leerPagina(f.url)));
    elegidas.forEach((f, i) => { if (textos[i]) { f.texto = textos[i]; f.leida = true; } });
  }

  // ── Memoria del chat ─────────────────────────────────────────────────────
  function textoParaContexto(m) {
    const meta = metaDe(m);
    if (m.rol === 'assistant' && meta.imagenes) return `[Imagen generada con el prompt: ${meta.prompt}]`;
    let t = m.contenido;
    if (m.rol === 'assistant' && meta.fuentes?.length) {
      const citadas = new Set(citasDe(t));
      const refs = meta.fuentes.filter(f => citadas.has(f.n)).slice(0, 12).map(f => `[${f.n}] ${f.titulo} — ${f.url}`);
      if (refs.length) t += `\n\n(Referencias de esta respuesta:\n${refs.join('\n')})`;
    }
    return t;
  }

  /** Todas las fuentes citadas en la conversación, por respuesta: no depende del resumen. */
  function registroDeReferencias(historial) {
    const lineas = [];
    let k = 0;
    for (const m of historial) {
      if (m.rol !== 'assistant') continue;
      k++;
      const meta = metaDe(m);
      if (!meta.fuentes?.length) continue;
      const citadas = new Set(citasDe(m.contenido));
      const refs = meta.fuentes.filter(f => citadas.has(f.n));
      if (refs.length) lineas.push(`Respuesta ${k} del asistente:\n${refs.map(f => `  [${f.n}] ${f.titulo} — ${f.url}`).join('\n')}`);
    }
    return lineas.join('\n').slice(-12_000);
  }

  /** Mensajes que caben literalmente + memoria resumida de los anteriores (se actualiza si hace falta). */
  async function contextoConversacion(conv, historial, emitir) {
    const textos = historial.map(textoParaContexto);
    let desde = historial.length;
    let usado = 0;
    while (desde > 0 && usado + textos[desde - 1].length <= presupuesto) { desde--; usado += textos[desde].length; }
    if (desde === historial.length && desde > 0) desde--; // el último mensaje va siempre, aunque sea enorme
    let { memoria, memoria_hasta: hasta } = await almacen.memoria(conv);
    if (desde > hasta) {
      emitir('estado', { texto: 'Actualizando la memoria del chat…' });
      const nuevos = historial.slice(hasta, desde).map((m, i) => `${m.rol === 'user' ? 'USUARIO' : 'ASISTENTE'}: ${textos[hasta + i].slice(0, 6000)}`).join('\n\n');
      try {
        const { texto } = await gateway.completar([
          { role: 'system', content: 'Mantienes la memoria de una conversación. Combina la memoria previa con los mensajes nuevos en una memoria actualizada, en español, de hasta 700 palabras: objetivo del usuario, datos y decisiones clave, preguntas hechas y respuestas dadas (con cifras), fuentes citadas (título y URL), preferencias del usuario y temas pendientes. Solo hechos de la conversación; nada inventado. Devuelve solo la memoria.' },
          { role: 'user', content: `MEMORIA PREVIA:\n${memoria || '(vacía)'}\n\nMENSAJES NUEVOS:\n${nuevos}` },
        ], { modelo: await modeloTarea('rapido'), max: 3000, temperatura: 0.1, tiempo: 120_000 });
        if (texto.trim()) { memoria = texto.trim(); hasta = desde; await almacen.guardarMemoria(conv, memoria, hasta); }
      } catch { /* sin memoria nueva: se usan los mensajes que caben */ }
    }
    return {
      memoria,
      referencias: registroDeReferencias(historial),
      mensajes: historial.slice(desde).map((m, i) => ({ role: m.rol, content: textos[desde + i] })).filter(m => m.content),
      resumidos: hasta,
      literales: historial.length - desde,
    };
  }

  // ── Combinación de modelos ───────────────────────────────────────────────
  /**
   * Varios modelos responden a la vez (eventos «parcial») y un integrador une lo mejor de cada uno
   * en la respuesta final (eventos «texto», como una respuesta normal).
   */
  async function combinarRespuestas(mensajes, modelos, ajustes, opciones, emitir, señal) {
    emitir('combinacion', { modelos, mostrar: ajustes.mostrar !== false });
    emitir('estado', { texto: `Consultando ${modelos.length} modelos a la vez…` });
    const textos = modelos.map(() => '');
    const respuestas = await Promise.all(modelos.map(async (m, i) => {
      try {
        const usado = await gateway.conversar(mensajes, { modelo: m, señal, alTexto: t => { textos[i] += t; emitir('parcial', { i, t }); } });
        emitir('parcial_fin', { i, modelo: usado });
        return { modelo: usado, texto: textos[i] };
      } catch (e) {
        const error = explicarError(e);
        emitir('parcial_fin', { i, modelo: m, error });
        return { modelo: m, texto: textos[i], error };
      }
    }));
    const validas = respuestas.filter(r => r.texto.trim());
    if (señal?.aborted) throw new Error('aborted');
    if (!validas.length) throw new Error(`Ninguno de los modelos respondió (${respuestas.map(r => r.error).filter(Boolean).join(' · ')})`);
    let usado;
    if (validas.length === 1) {
      // Solo uno respondió: se usa tal cual, sin integrar.
      opciones.alTexto(validas[0].texto);
      usado = validas[0].modelo;
    } else {
      const integrador = ajustes.integrador && ajustes.integrador !== 'auto' ? ajustes.integrador : await modeloTarea('razonamiento');
      emitir('estado', { texto: `Integrando ${validas.length} respuestas${integrador !== 'auto' ? ` con ${integrador}` : ''}…` });
      const borradores = validas.map((r, k) => `### Respuesta ${String.fromCharCode(65 + k)}\n${r.texto.slice(0, 12_000)}`).join('\n\n');
      const mensajesInt = mensajes.map(m => ({ ...m }));
      mensajesInt[0].content += `\n\n${INTEGRAR}`;
      const ultimo = mensajesInt[mensajesInt.length - 1];
      ultimo.content += `\n\n---\nRespuestas de ${validas.length} modelos a esta misma pregunta:\n\n${borradores}`;
      try {
        usado = await gateway.conversar(mensajesInt, { ...opciones, modelo: integrador });
      } catch (e) {
        if (integrador === 'auto' || señal?.aborted) throw e;
        emitir('estado', { texto: `El integrador no respondió (${explicarError(e)}). Integrando con automático…` });
        usado = await gateway.conversar(mensajesInt, { ...opciones, modelo: 'auto' });
      }
    }
    return { usado, combinacion: { respuestas: respuestas.map(r => ({ ...r, texto: r.texto.slice(0, 20_000) })), integrador: usado, mostrar: ajustes.mostrar !== false } };
  }

  /** Modelos recomendados para lo que el usuario está escribiendo. */
  async function recomendarModelos({ texto, modo, skill: idSkill }) {
    const skill = idSkill ? await skills.obtener(idSkill) : null;
    const lista = (await gateway.modelosTexto()).filter(m => m.id !== 'auto');
    const r = recomendarPara(lista, texto, { skill, modo });
    const tarea = TAREAS.find(t => t.id === r.tarea);
    return { ...r, nombreTarea: tarea?.nombre, icono: tarea?.icono, modeloTarea: await modeloTarea(r.tarea) };
  }

  // ── Chat ─────────────────────────────────────────────────────────────────
  /** Valida la petición y crea o actualiza la conversación. Devuelve null si no hay mensaje. */
  async function prepararChat(p) {
    const skill = p.skill ? await skills.obtener(p.skill) : null;
    const modo = ['chat', 'investigar', 'imagen'].includes(p.modo) ? p.modo : (skill?.modo || 'chat');
    let conv = p.conversacion && (await almacen.conversacion(p.conversacion)) ? p.conversacion : null;
    const texto = String(p.texto || '').trim();
    let descartadas = [];
    let idUsuario = null;
    if (p.regenerar && conv) {
      // La respuesta que se regenera se conserva en la nueva: es una señal de preferencia para entrenar.
      const ultimo = (await almacen.mensajes(conv)).at(-1);
      if (ultimo?.rol === 'assistant') {
        const meta = metaDe(ultimo);
        if (ultimo.contenido?.trim()) descartadas = [...(meta.descartadas || []), { texto: ultimo.contenido.slice(0, 20_000), modelo: meta.modelo || null, valoracion: meta.valoracion || 0 }].slice(-5);
      }
      await almacen.quitarUltimaRespuesta(conv);
    } else if (p.editar && conv) {
      // Editar una pregunta anterior: se borra desde ella hasta el final y se envía la nueva versión.
      if (!texto) return null;
      const r = await almacen.truncarDesde(conv, String(p.editar));
      if (!r) return null;
      const [antes, respuesta] = r.borrados;
      const edicion = antes?.rol === 'user' && antes.contenido !== texto
        ? { antes: antes.contenido.slice(0, 20_000), respuesta: respuesta?.rol === 'assistant' ? respuesta.contenido.slice(0, 20_000) : null, modelo: respuesta?.meta?.modelo || null, fecha: Date.now() }
        : null;
      idUsuario = await almacen.agregar(conv, 'user', texto, { modo, skill: skill?.id || null, ...(edicion ? { edicion } : {}) });
    } else {
      if (!texto) return null;
      if (!conv) conv = await almacen.crearConversacion(texto.replace(/\s+/g, ' ').slice(0, 60), skill?.id);
      idUsuario = await almacen.agregar(conv, 'user', texto, { modo, skill: skill?.id || null });
    }
    return { p, skill, modo, conv, texto, descartadas, idUsuario };
  }

  async function chat({ p, skill, modo, conv, texto, descartadas = [], idUsuario }, emitir, señal) {
    // Prioridad: el modelo elegido en el chat > el de la skill > el de la tarea > auto.
    const elegido = p.modelo && p.modelo !== 'auto' ? p.modelo : '';
    const modelo = elegido || skill?.modelo || await modeloTarea(tareaDe(skill, modo));
    const rapido = await modeloTarea('rapido');
    const historial = await almacen.mensajes(conv);
    const pregunta = [...historial].reverse().find(m => m.rol === 'user')?.contenido || texto;
    emitir('inicio', { conversacion: conv, modo, mensajeUsuario: idUsuario });

    try {
      await antesDeResponder?.(emitir, señal);
      if (modo === 'imagen') {
        const [ancho, alto] = TAMANOS[p.tamano] || TAMANOS.cuadrado;
        const estilo = ESTILOS[p.estilo] ? p.estilo : skill?.id === 'ilustracion-cientifica' ? 'cientifica' : skill?.id === 'imagen-creativa' ? 'arte' : 'fotorrealista';
        const calidad = CALIDADES[p.calidad] ? p.calidad : 'rapida';
        emitir('estado', { texto: `Preparando el prompt (${ESTILOS[estilo].nombre.toLowerCase()})…` });
        let prompt = pregunta;
        try {
          const { texto: mejorado = '' } = await gateway.completar([
            { role: 'system', content: `${skill ? skills.sistema(skill) + '\n\n' : ''}You are an expert prompt writer for FLUX and Leonardo image models.
Turn the user's request into ONE English prompt of 60-120 words written as natural descriptive sentences (not a list of tags):
the main subject with precise, accurate details; the setting; composition and framing; lighting; colors; materials and textures.
Style: ${ESTILOS[estilo].guia}
Keep any scientific content accurate. Never ask for text, letters, captions, watermarks or logos in the image.
Return ONLY the prompt.` },
            { role: 'user', content: pregunta },
          ], { modelo: rapido, max: 1500, temperatura: 0.6 });
          const limpio = mejorado.replace(/<think>[\s\S]*?<\/think>/g, '').trim().replace(/^["']|["']$/g, '');
          if (limpio && limpio.length < 2000) prompt = limpio;
        } catch { /* sin LLM se usa la petición tal cual */ }
        emitir('estado', { texto: `Generando la imagen (calidad ${CALIDADES[calidad].toLowerCase()})…`, prompt });
        // «De pago» usa Nano Banana o GPT Image con la clave del usuario; nunca se elige solo.
        const modeloImagen = calidad === 'premium' ? 'premium' : p.modeloImagen && p.modeloImagen !== 'auto' ? p.modeloImagen : await modeloTarea('imagen');
        const img = await gateway.imagen(prompt, { modelo: modeloImagen, ancho, alto, estilo, calidad });
        const url = await guardarImagen(img.datos, img.tipo);
        const meta = { modo, imagenes: [url], prompt, modelo: img.modelo, estilo, calidad, skill: skill?.id || null };
        const id = await almacen.agregar(conv, 'assistant', '', meta);
        emitir('fin', { id, ...meta });
        return;
      }

      let fuentes = [];
      let fallos = [];
      let consultas = [];
      if (modo === 'investigar') {
        const ids = p.fuentes?.length ? p.fuentes : (skill?.fuentes?.length ? skill.fuentes : FUENTES_POR_DEFECTO);
        const previo = historial.filter(m => m.rol === 'user').slice(-3, -1).map(m => m.contenido).join(' | ').slice(0, 500);
        const r = await investigar(pregunta, previo, ids, rapido, emitir);
        fuentes = r.fuentes || [];
        fallos = r.fallos || [];
        consultas = r.consultas || [];
        if (fuentes.length && (p.leer ?? skill?.leer)) await leerFuentes(fuentes, emitir);
        emitir('fuentes', { fuentes: fuentes.map(({ texto: _t, ...f }) => f), fallos, consultas });
      }

      const sistema = [SISTEMA_BASE, skill ? `## Skill activa: ${skill.nombre}\n\n${skills.sistema(skill)}` : '', fuentes.length ? REGLAS_FUENTES : '']
        .filter(Boolean).join('\n\n');
      const ctx = await contextoConversacion(conv, historial, emitir);
      let sistemaFinal = sistema;
      if (ctx.memoria) sistemaFinal += `\n\n## Memoria de esta conversación (mensajes anteriores resumidos)\n${ctx.memoria}`;
      if (ctx.referencias) sistemaFinal += `\n\n## Referencias citadas antes en esta conversación (exactas; úsalas si el usuario pregunta por ellas)\n${ctx.referencias}`;
      const mensajes = [{ role: 'system', content: sistemaFinal }, ...ctx.mensajes];
      if (fuentes.length) {
        const ultimo = mensajes[mensajes.length - 1];
        ultimo.content = `${ultimo.content}\n\n---\nResultados de búsqueda:\n\n${bloqueFuentes(fuentes)}`;
      } else if (modo === 'investigar') {
        mensajes[0].content += '\n\nLa búsqueda no devolvió resultados: dilo al usuario antes de responder con tu conocimiento general, y marca esa respuesta como no verificada.';
      }
      depurar?.(mensajes);

      let respuesta = '';
      let razonamiento = '';
      const opciones = {
        señal,
        alTexto: t => { respuesta += t; emitir('texto', { t }); },
        alRazonamiento: t => { razonamiento += t; emitir('razonamiento', { t }); },
      };
      let usado;
      let combinacion = null;
      const variosModelos = Array.isArray(p.combinar?.modelos) ? [...new Set(p.combinar.modelos.filter(Boolean))].slice(0, 4) : [];
      if (variosModelos.length >= 2) {
        ({ usado, combinacion } = await combinarRespuestas(mensajes, variosModelos, p.combinar, opciones, emitir, señal));
      } else try {
        emitir('estado', { texto: modelo === 'auto' ? 'Pensando…' : `Pensando con ${modelo}…` });
        usado = await gateway.conversar(mensajes, { ...opciones, modelo });
      } catch (e) {
        // Si el modelo elegido falla antes de escribir nada, se reintenta con el router automático.
        if (modelo === 'auto' || respuesta || señal?.aborted) throw e;
        emitir('estado', { texto: `${modelo} no respondió (${explicarError(e)}). Probando con automático…` });
        razonamiento = '';
        usado = await gateway.conversar(mensajes, { ...opciones, modelo: 'auto' });
      }
      const meta = {
        modo, modelo: usado, skill: skill?.id || null,
        memoria: { resumidos: ctx.resumidos, literales: ctx.literales },
        ...(fuentes.length ? { fuentes: fuentes.map(({ texto: _t, ...f }) => f) } : {}), ...(fallos.length ? { fallos } : {}),
        ...(consultas.length ? { consultas } : {}), ...(razonamiento ? { razonamiento } : {}),
        ...(combinacion ? { combinacion } : {}), ...(descartadas.length ? { descartadas } : {}),
      };
      const id = await almacen.agregar(conv, 'assistant', respuesta, meta);
      emitir('fin', { id, ...meta });

      // Verificación automática de citas, enlaces y DOI (y de afirmaciones si la skill lo pide).
      if (fuentes.length && respuesta && !señal?.aborted) {
        const completa = (p.verificacion || skill?.verificacion) === 'completa';
        if (verificacionAparte) { emitir('verificar', { id, completa }); return; }
        emitir('estado', { texto: completa ? 'Verificando citas, enlaces y afirmaciones…' : 'Verificando citas y enlaces…' });
        const verificacion = await verificar({ respuesta, fuentes, completa, gateway, modelo: await modeloTarea('razonamiento') }).catch(e => ({ error: e.message }));
        await almacen.actualizarMeta(id, { verificacion });
        emitir('verificacion', { id, verificacion });
      }
    } catch (e) {
      if (señal?.aborted) return;
      emitir('error', { mensaje: explicarError(e) });
    }
  }

  // ── Skills con IA ────────────────────────────────────────────────────────
  async function generarSkill(descripcion) {
    const fuentes = FUENTES.map(f => `${f.id} (${f.area})`).join(', ');
    const { texto } = await gateway.completar([
      { role: 'system', content: `Diseñas "skills" para un asistente de IA: instrucciones de sistema expertas y reutilizables.
Devuelve SOLO JSON con esta forma:
{"nombre":"nombre corto en español","icono":"un símbolo unicode monocromo (no emoji), p. ej. ◎ ⌬ ✦ ∿ ⧉ ◈ ⟁ ⌘","descripcion":"una frase: cuándo usarla","modo":"chat|investigar|imagen","fuentes":["ids"],"categoria":"Ciencias de la vida|Ciencia|Creatividad|Productividad|Código|General","instrucciones":"Markdown: rol, objetivos, proceso paso a paso, formato de respuesta, límites y buenas prácticas (300-700 palabras)"}
Usa modo "investigar" si la skill necesita evidencia publicada; "imagen" si genera imágenes. Fuentes válidas: ${fuentes}.` },
      { role: 'user', content: descripcion },
    ], { modelo: await modeloTarea('rapido'), max: 6000, temperatura: 0.5, tiempo: 240_000 }); // los modelos que razonan gastan tokens antes de responder
    return jsonDe(texto);
  }

  // ── Modelos por tarea ────────────────────────────────────────────────────
  async function listarTareas() {
    const [texto, imagen] = await Promise.allSettled([gateway.modelosTexto(), gateway.modelosImagen()]);
    const lista = texto.status === 'fulfilled' ? texto.value : [];
    const asignados = await tareas.todas();
    return {
      tareas: TAREAS.map(t => ({ ...t, modelo: asignados[t.id] || 'auto', recomendados: t.id === 'imagen' ? [] : recomendados(lista, t.id) })),
      texto: lista,
      imagen: imagen.status === 'fulfilled' ? imagen.value : [{ id: 'auto', nombre: 'Automático' }],
      error: texto.status === 'rejected' ? explicarError(texto.reason) : undefined,
    };
  }

  /** Prueba los 3 mejores de cada tarea y se queda con el primero (en orden) que responde. */
  async function recomendarTareas() {
    const lista = await gateway.modelosTexto();
    const responde = async id => {
      try { return Boolean((await gateway.completar([{ role: 'user', content: 'Di: ok' }], { modelo: id, max: 200, tiempo: 60_000, estricto: true })).texto); } catch { return false; }
    };
    const elegidos = await Promise.all(TAREAS.filter(t => t.id !== 'imagen').map(async t => {
      const candidatos = recomendados(lista, t.id, 3);
      const vivos = await Promise.all(candidatos.map(m => responde(m.id)));
      return [t.id, candidatos.find((_, i) => vivos[i])?.id];
    }));
    for (const [id, modelo] of elegidos) await tareas.poner(id, modelo || 'auto');
    return { tareas: await tareas.todas() };
  }

  async function probarModelo({ modelo, tipo }) {
    const inicio = Date.now();
    try {
      if (tipo === 'imagen') {
        const img = await gateway.imagen('a small red dot on a black background, minimal', { modelo: modelo || 'auto', ancho: 512, alto: 512 });
        return { ok: true, ms: Date.now() - inicio, modelo: img.modelo, respuesta: `${Math.round(img.datos.length / 1024)} KB` };
      }
      const r = await gateway.completar([{ role: 'user', content: 'Responde solo con la palabra: listo' }], { modelo: modelo || 'auto', max: 300, tiempo: 120_000, estricto: true });
      return { ok: true, ms: Date.now() - inicio, modelo: r.modelo, respuesta: r.texto.trim().slice(0, 80) };
    } catch (e) {
      return { ok: false, ms: Date.now() - inicio, error: explicarError(e) };
    }
  }

  // ── Verificación y revisión de mensajes ─────────────────────────────────
  async function verificarMensaje(m, completa) {
    const meta = metaDe(m);
    const verificacion = await verificar({ respuesta: m.contenido, fuentes: meta.fuentes, completa, gateway, modelo: await modeloTarea('razonamiento') });
    await almacen.actualizarMeta(m.id, { verificacion });
    return verificacion;
  }

  /** Revisión manual: el usuario marca qué fuentes comprobó él mismo. */
  async function revisarMensaje(m, datos) {
    const meta = metaDe(m);
    const revision = { ...(meta.revision || {}) };
    const marcar = n => { if (datos.revisado) revision[n] = { revisado: true, fecha: Date.now(), ...(datos.nota ? { nota: String(datos.nota).slice(0, 500) } : {}) }; else delete revision[n]; };
    if (datos.todas) (meta.fuentes || []).forEach(f => marcar(f.n)); else marcar(Number(datos.n));
    await almacen.actualizarMeta(m.id, { revision });
    return revision;
  }

  // ── Señales para entrenar un modelo propio ──────────────────────────────
  /** 👍/👎 de una respuesta y, en una combinación, qué modelo respondió mejor. */
  async function valorarMensaje(m, { valor, preferido }) {
    const cambios = {};
    if (valor !== undefined) cambios.valoracion = [1, -1].includes(Number(valor)) ? Number(valor) : 0;
    if (preferido !== undefined) cambios.preferido = Number.isInteger(preferido) && preferido >= 0 && preferido < (metaDe(m).combinacion?.respuestas?.length || 0) ? preferido : null;
    const meta = await almacen.actualizarMeta(m.id, cambios);
    return { valoracion: meta.valoracion || 0, preferido: meta.preferido ?? null };
  }

  async function datosEntrenamiento(opciones) {
    const sinteticos = (await almacen.sinteticos?.()) || [];
    return construirDatos([...(await almacen.exportable()), ...sinteticos], opciones);
  }

  return {
    FUENTES, TAREAS, ESTILOS, explicarError, metaDe, publica, valorarMensaje, datosEntrenamiento,
    prepararChat, chat, generarSkill, recomendarModelos, listarTareas, recomendarTareas, probarModelo, verificarMensaje, revisarMensaje,
  };
}
