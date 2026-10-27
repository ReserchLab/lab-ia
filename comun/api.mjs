// Rutas de la API comunes al teléfono y a la nube. Cada plataforma resuelve antes las suyas
// (acceso, estado, proveedores, medios) y llama a esta función con el núcleo ya creado.
//   pet = { metodo, ruta, cuerpo: async () => objeto }
// Devuelve { estado, datos }, { sse: async (emitir, señal) => … }, { archivo: { nombre, tipo, texto } }
// o null si la ruta no es común.
import { TAREAS } from './tareas.mjs';
import { aJsonl, BASES_LORA } from './entrenamiento.mjs';

export async function rutasComunes(nucleo, { almacen, skills, tareas }, pet) {
  const { metodo, ruta } = pet;
  const ok = datos => ({ estado: 200, datos });
  const error = (estado, mensaje) => ({ estado, datos: { error: mensaje } });

  if (ruta === '/api/chat' && metodo === 'POST') {
    const preparado = await nucleo.prepararChat(await pet.cuerpo());
    if (!preparado) return error(400, 'Escribe un mensaje');
    return { sse: (emitir, señal) => nucleo.chat(preparado, emitir, señal) };
  }

  if (ruta === '/api/modelos' && metodo === 'GET') {
    const t = await nucleo.listarTareas();
    return ok({ texto: t.texto, imagen: t.imagen, error: t.error });
  }
  if (ruta === '/api/tareas' && metodo === 'GET') return ok(await nucleo.listarTareas());
  if (ruta === '/api/tareas' && metodo === 'PUT') {
    const { id, modelo } = await pet.cuerpo();
    if (!TAREAS.some(t => t.id === id)) return error(400, 'Tarea desconocida');
    await tareas.poner(id, modelo && modelo !== 'auto' ? String(modelo).slice(0, 200) : 'auto');
    return ok({ id, modelo: await tareas.obtener(id) });
  }
  if (ruta === '/api/tareas/recomendar' && metodo === 'POST') return ok(await nucleo.recomendarTareas());
  if (ruta === '/api/tareas/probar' && metodo === 'POST') return ok(await nucleo.probarModelo(await pet.cuerpo()));

  if (ruta === '/api/recomendar' && metodo === 'POST') return ok(await nucleo.recomendarModelos(await pet.cuerpo()));

  if (ruta === '/api/fuentes' && metodo === 'GET') return ok(nucleo.FUENTES.map(({ id, nombre, area }) => ({ id, nombre, area })));

  if (ruta === '/api/skills' && metodo === 'GET') return ok((await skills.todas()).map(nucleo.publica));
  if (ruta === '/api/skills' && metodo === 'POST') {
    const datos = await pet.cuerpo();
    if (!datos.nombre?.trim() || !datos.instrucciones?.trim()) return error(400, 'La skill necesita nombre e instrucciones');
    return ok(nucleo.publica(await skills.guardar(datos)));
  }
  if (ruta === '/api/skills/generar' && metodo === 'POST') {
    const { descripcion } = await pet.cuerpo();
    if (!descripcion?.trim()) return error(400, 'Describe la skill');
    const skill = await nucleo.generarSkill(descripcion);
    return skill?.instrucciones ? ok({ skill }) : error(502, 'La IA no devolvió una skill válida. Intenta describirla con más detalle.');
  }
  const sk = ruta.match(/^\/api\/skills\/([\w-]+)$/);
  if (sk && metodo === 'DELETE') return (await skills.borrar(sk[1])) ? ok({ ok: true }) : error(404, 'No existe');

  // ── Entrenamiento: estadísticas y descarga de los datos en JSONL ──
  if (ruta === '/api/entrenamiento' && metodo === 'GET') {
    const { sft, dpo, senales, cuenta } = await nucleo.datosEntrenamiento();
    const { sft: valoradas } = await nucleo.datosEntrenamiento({ soloValoradas: true });
    return ok({ ...cuenta, sft: sft.length, sftValoradas: valoradas.length, dpo: dpo.length, senales: senales.length, bases: BASES_LORA });
  }
  const ex = ruta.match(/^\/api\/entrenamiento\/(sft|sft-valoradas|dpo|senales)\.jsonl$/);
  if (ex && metodo === 'GET') {
    const datos = await nucleo.datosEntrenamiento({ soloValoradas: ex[1] === 'sft-valoradas' });
    const filas = ex[1] === 'dpo' ? datos.dpo : ex[1] === 'senales' ? datos.senales : datos.sft;
    return { archivo: { nombre: `laboratorio-ia-${ex[1]}-${new Date().toISOString().slice(0, 10)}.jsonl`, tipo: 'application/x-ndjson; charset=utf-8', texto: aJsonl(filas) } };
  }

  const mv = ruta.match(/^\/api\/mensajes\/([\w-]+)\/(verificar|revision|valoracion)$/);
  if (mv) {
    const m = await almacen.mensaje(mv[1]);
    if (!m) return error(404, 'No existe el mensaje');
    const datos = await pet.cuerpo();
    if (mv[2] === 'verificar' && metodo === 'POST') {
      if (!nucleo.metaDe(m).fuentes?.length) return error(400, 'Esta respuesta no tiene fuentes');
      return ok({ verificacion: await nucleo.verificarMensaje(m, datos.completa === true) });
    }
    if (mv[2] === 'revision' && metodo === 'PATCH') return ok({ revision: await nucleo.revisarMensaje(m, datos) });
    if (mv[2] === 'valoracion' && metodo === 'PATCH') return ok(await nucleo.valorarMensaje(m, datos));
  }

  if (ruta === '/api/conversaciones' && metodo === 'GET') return ok(await almacen.conversaciones());
  const cv = ruta.match(/^\/api\/conversaciones\/([\w-]+)$/);
  if (cv && metodo === 'GET') {
    const c = await almacen.conversacion(cv[1]);
    return c ? ok(c) : error(404, 'No existe');
  }
  if (cv && metodo === 'PATCH') {
    const { titulo, memoria } = await pet.cuerpo();
    if (titulo?.trim()) await almacen.renombrar(cv[1], titulo.trim().slice(0, 120));
    if (typeof memoria === 'string') {
      const actual = await almacen.memoria(cv[1]);
      // Borrar la memoria hace que se rehaga desde el principio en el próximo mensaje.
      await almacen.guardarMemoria(cv[1], memoria.trim().slice(0, 20_000), memoria.trim() ? actual.memoria_hasta : 0);
    }
    return ok({ ok: true });
  }
  if (cv && metodo === 'DELETE') { await almacen.borrar(cv[1]); return ok({ ok: true }); }

  return null;
}
