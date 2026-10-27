// Datos para entrenar un modelo propio con las conversaciones (común a nube y teléfono).
// Señales que se guardan al usar laboratorio.ia:
//   · valoración 👍/👎 de cada respuesta (meta.valoracion = 1 | -1)
//   · respuestas descartadas al regenerar (meta.descartadas, en la respuesta nueva)
//   · preguntas editadas (meta.edicion, en la pregunta nueva: texto y respuesta anteriores)
//   · ejemplos generados (destilación en la nube): preguntas respondidas investigando, frente a una respuesta sin fuentes
//   · combinación de modelos: respuestas de cada modelo, la integrada y la que eligió el usuario (meta.preferido)
// Formatos de salida (JSONL, uno por línea):
//   sft  → {"messages":[system, …turnos, assistant]}                       (ajuste fino supervisado)
//   dpo  → {"prompt":[…], "chosen":[assistant], "rejected":[assistant]}    (preferencias; TRL/Unsloth)
//   senales → todo lo anterior en crudo, para analizarlo o entrenar con otra herramienta

export const SISTEMA_ENTRENAMIENTO = 'Eres laboratorio.ia, un asistente de investigación científica. Responde en el idioma del usuario con Markdown claro, sé preciso, cita las fuentes con [n] cuando las tengas y nunca inventes datos ni referencias.';

const TURNOS = 6; // mensajes previos que acompañan a cada ejemplo
const metaDe = m => (typeof m.meta === 'string' ? JSON.parse(m.meta || '{}') : m.meta || {});

function bloqueFuentes(fuentes) {
  return fuentes.map(f => `[${f.n}] ${f.titulo}\n${f.fuente}${f.detalle ? ' · ' + f.detalle : ''}\n${f.url}\n${f.resumen || ''}`).join('\n\n');
}

/** El texto de una respuesta para entrenar: sin imágenes ni respuestas vacías o con error. */
const util = m => m.rol === 'assistant' && m.contenido?.trim() && !metaDe(m).imagenes;

/**
 * Turnos que preceden a la respuesta `i`: hasta TURNOS mensajes, y la última pregunta con los
 * resultados de búsqueda que tuvo el modelo (así aprende a citar solo lo que tiene delante).
 */
function prompt(mensajes, i) {
  const previos = mensajes.slice(Math.max(0, i - TURNOS), i).filter(m => m.contenido?.trim() && !metaDe(m).imagenes);
  const salida = [{ role: 'system', content: SISTEMA_ENTRENAMIENTO }, ...previos.map(m => ({ role: m.rol, content: m.contenido.trim() }))];
  const fuentes = metaDe(mensajes[i]).fuentes;
  const ultimo = salida[salida.length - 1];
  if (fuentes?.length && ultimo?.role === 'user') ultimo.content += `\n\n---\nResultados de búsqueda:\n\n${bloqueFuentes(fuentes)}`;
  return ultimo?.role === 'user' ? salida : null;
}

/** Recorre todas las conversaciones ({id, mensajes:[…]}) y arma los tres conjuntos. */
export function construirDatos(conversaciones, { soloValoradas = false } = {}) {
  const sft = [];
  const dpo = [];
  const senales = [];
  const cuenta = { conversaciones: conversaciones.filter(c => !c.sintetica).length, sinteticos: 0, respuestas: 0, buenas: 0, malas: 0, descartadas: 0, ediciones: 0, combinaciones: 0 };

  for (const c of conversaciones) {
    const ms = c.mensajes;
    ms.forEach((m, i) => {
      const meta = metaDe(m);
      if (m.rol === 'user' && meta.edicion) {
        cuenta.ediciones++;
        senales.push({ tipo: 'edicion', conversacion: c.id, antes: meta.edicion.antes, despues: m.contenido, respuestaAnterior: meta.edicion.respuesta || null, modeloAnterior: meta.edicion.modelo || null });
      }
      if (!util(m)) return;
      if (c.sintetica) cuenta.sinteticos++; else cuenta.respuestas++;
      const v = meta.valoracion || 0;
      if (v > 0) cuenta.buenas++;
      if (v < 0) cuenta.malas++;
      const p = prompt(ms, i);
      if (!p) return;
      const yo = { role: 'assistant', content: m.contenido.trim() };

      if (v >= 0 && (!soloValoradas || v > 0)) sft.push({ messages: [...p, yo] });

      // Regenerar = la respuesta anterior gustó menos que la nueva (salvo que la nueva tenga 👎).
      for (const d of meta.descartadas || []) {
        if (!d.texto?.trim()) continue;
        if (!c.sintetica) cuenta.descartadas++;
        if (v >= 0) dpo.push({ prompt: p, chosen: [yo], rejected: [{ role: 'assistant', content: d.texto.trim() }], origen: d.origen || 'regenerar', modelos: [m.modelo || meta.modelo, d.modelo] });
        else dpo.push({ prompt: p, chosen: [{ role: 'assistant', content: d.texto.trim() }], rejected: [yo], origen: 'regenerar-peor', modelos: [d.modelo, meta.modelo] });
      }

      // Combinación: la elegida por el usuario (o la integrada) frente a cada respuesta individual.
      const comb = meta.combinacion;
      if (comb?.respuestas?.length) {
        cuenta.combinaciones++;
        const validas = comb.respuestas.map((r, k) => ({ ...r, k })).filter(r => r.texto?.trim() && !r.error);
        const pref = Number.isInteger(meta.preferido) ? validas.find(r => r.k === meta.preferido) : null;
        const ganadora = pref ? { texto: pref.texto, modelo: pref.modelo } : v >= 0 ? { texto: m.contenido, modelo: comb.integrador } : null;
        if (ganadora) {
          for (const r of validas) {
            if (r.texto === ganadora.texto) continue;
            dpo.push({ prompt: p, chosen: [{ role: 'assistant', content: ganadora.texto.trim() }], rejected: [{ role: 'assistant', content: r.texto.trim() }], origen: pref ? 'combinacion-elegida' : 'combinacion-integrada', modelos: [ganadora.modelo, r.modelo] });
          }
          if (pref && v < 0) dpo.push({ prompt: p, chosen: [{ role: 'assistant', content: pref.texto.trim() }], rejected: [yo], origen: 'integrada-peor', modelos: [pref.modelo, comb.integrador] });
        }
      }

      if (!c.sintetica && (v || meta.descartadas?.length || comb || meta.revision)) {
        senales.push({
          tipo: 'respuesta', conversacion: c.id, mensaje: m.id, modelo: meta.modelo, modo: meta.modo, skill: meta.skill, valoracion: v,
          pregunta: p[p.length - 1].content.slice(0, 4000), respuesta: m.contenido,
          descartadas: meta.descartadas || [], preferido: meta.preferido ?? null,
          combinacion: comb ? comb.respuestas.map(r => ({ modelo: r.modelo, texto: r.texto, error: r.error || null })) : null,
          verificacion: meta.verificacion?.estado || null,
          fuentesRevisadas: Object.values(meta.revision || {}).filter(r => r.revisado).length,
        });
      }
    });
  }
  return { sft, dpo, senales, cuenta };
}

export const aJsonl = filas => filas.map(f => JSON.stringify(f)).join('\n') + (filas.length ? '\n' : '');

/** Modelos de Workers AI que aceptan un adaptador LoRA, con su modelo base en Hugging Face. */
export const BASES_LORA = [
  { id: '@cf/meta/llama-3.2-3b-instruct', nombre: 'Llama 3.2 3B Instruct', hf: 'unsloth/Llama-3.2-3B-Instruct', tipo: 'llama', nota: 'recomendado: se entrena en Colab gratis en ~20 min' },
  { id: '@cf/mistral/mistral-7b-instruct-v0.2-lora', nombre: 'Mistral 7B Instruct v0.2', hf: 'unsloth/mistral-7b-instruct-v0.2', tipo: 'mistral', nota: 'más capaz; Colab gratis, más lento' },
  { id: '@cf/google/gemma-7b-it-lora', nombre: 'Gemma 7B it', hf: 'unsloth/gemma-7b-it', tipo: 'gemma', nota: 'beta en Workers AI' },
  { id: '@cf/google/gemma-2b-it-lora', nombre: 'Gemma 2B it', hf: 'unsloth/gemma-2b-it', tipo: 'gemma', nota: 'el más ligero; beta' },
];
