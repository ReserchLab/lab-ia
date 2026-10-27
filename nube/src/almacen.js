// Conversaciones y mensajes en D1, siempre filtrados por el usuario de la sesión.
// Misma interfaz que servidor/lib/almacen.mjs (aquí asíncrona).
export class AlmacenD1 {
  constructor(db, usuario) { this.db = db; this.u = usuario; }

  async crearConversacion(titulo, skill) {
    const id = crypto.randomUUID();
    const ahora = Date.now();
    await this.db.prepare('INSERT INTO conversaciones (id, usuario, titulo, skill, creada, actualizada) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, this.u, titulo, skill || null, ahora, ahora).run();
    return id;
  }

  async conversaciones() {
    const r = await this.db.prepare('SELECT id, titulo, skill, actualizada FROM conversaciones WHERE usuario = ? ORDER BY actualizada DESC LIMIT 200').bind(this.u).all();
    return r.results;
  }

  async propia(id) {
    return this.db.prepare('SELECT id, titulo, skill, memoria, memoria_hasta, creada, actualizada FROM conversaciones WHERE id = ? AND usuario = ?').bind(id, this.u).first();
  }

  async conversacion(id) {
    const c = await this.propia(id);
    if (!c) return null;
    c.mensajes = (await this.mensajes(id)).map(m => ({ ...m, meta: JSON.parse(m.meta) }));
    return c;
  }

  async mensajes(id) {
    const r = await this.db.prepare('SELECT m.id, m.rol, m.contenido, m.meta, m.creado FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion WHERE m.conversacion = ? AND c.usuario = ? ORDER BY m.creado, m.rowid')
      .bind(id, this.u).all();
    return r.results;
  }

  async agregar(conversacion, rol, contenido, meta = {}) {
    const id = crypto.randomUUID();
    const ahora = Date.now();
    await this.db.batch([
      this.db.prepare('INSERT INTO mensajes (id, conversacion, rol, contenido, meta, creado) SELECT ?, id, ?, ?, ?, ? FROM conversaciones WHERE id = ? AND usuario = ?')
        .bind(id, rol, contenido, JSON.stringify(meta), ahora, conversacion, this.u),
      this.db.prepare('UPDATE conversaciones SET actualizada = ? WHERE id = ? AND usuario = ?').bind(ahora, conversacion, this.u),
    ]);
    return id;
  }

  async quitarUltimaRespuesta(conversacion) {
    const ultimo = await this.db.prepare('SELECT m.id, m.rol FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion WHERE m.conversacion = ? AND c.usuario = ? ORDER BY m.creado DESC, m.rowid DESC LIMIT 1')
      .bind(conversacion, this.u).first();
    if (ultimo?.rol === 'assistant') await this.db.prepare('DELETE FROM mensajes WHERE id = ?').bind(ultimo.id).run();
  }

  /** Borra un mensaje y todos los que le siguen (editar una pregunta anterior). Devuelve los borrados. */
  async truncarDesde(conversacion, mensaje) {
    const lista = await this.mensajes(conversacion);
    const i = lista.findIndex(m => m.id === mensaje);
    if (i < 0) return null;
    const borrados = lista.slice(i);
    await this.db.batch(borrados.map(m => this.db.prepare('DELETE FROM mensajes WHERE id = ? AND conversacion = ?').bind(m.id, conversacion)));
    const { memoria_hasta: hasta } = await this.memoria(conversacion);
    if (hasta > i) await this.guardarMemoria(conversacion, '', 0); // la memoria resumía mensajes que ya no existen
    return { indice: i, borrados: borrados.map(m => ({ ...m, meta: JSON.parse(m.meta) })) };
  }

  /** Todas las conversaciones con sus mensajes (exportar datos de entrenamiento), en una consulta. */
  async exportable() {
    const r = await this.db.prepare('SELECT m.conversacion, m.id, m.rol, m.contenido, m.meta FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion WHERE c.usuario = ? ORDER BY c.creada, m.conversacion, m.creado, m.rowid LIMIT 50000')
      .bind(this.u).all();
    const convs = new Map();
    for (const m of r.results) {
      if (!convs.has(m.conversacion)) convs.set(m.conversacion, { id: m.conversacion, mensajes: [] });
      convs.get(m.conversacion).mensajes.push(m);
    }
    return [...convs.values()];
  }

  /** Ejemplos generados para entrenar (destilación), con la misma forma que una conversación. */
  async sinteticos() {
    const r = await this.db.prepare('SELECT id, datos FROM sinteticos WHERE usuario = ? ORDER BY creado LIMIT 5000').bind(this.u).all();
    return r.results.map(f => ({ id: f.id, sintetica: true, ...JSON.parse(f.datos) }));
  }

  async borrarSinteticos() {
    await this.db.prepare('DELETE FROM sinteticos WHERE usuario = ?').bind(this.u).run();
  }

  async renombrar(id, titulo) {
    await this.db.prepare('UPDATE conversaciones SET titulo = ? WHERE id = ? AND usuario = ?').bind(titulo, id, this.u).run();
  }

  async borrar(id) {
    if (!(await this.propia(id))) return;
    await this.db.batch([
      this.db.prepare('DELETE FROM mensajes WHERE conversacion = ?').bind(id),
      this.db.prepare('DELETE FROM conversaciones WHERE id = ? AND usuario = ?').bind(id, this.u),
    ]);
  }

  async memoria(id) {
    return (await this.db.prepare('SELECT memoria, memoria_hasta FROM conversaciones WHERE id = ? AND usuario = ?').bind(id, this.u).first()) || { memoria: '', memoria_hasta: 0 };
  }

  async guardarMemoria(id, memoria, hasta) {
    await this.db.prepare('UPDATE conversaciones SET memoria = ?, memoria_hasta = ? WHERE id = ? AND usuario = ?').bind(memoria, hasta, id, this.u).run();
  }

  async mensaje(id) {
    const m = await this.db.prepare('SELECT m.* FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion WHERE m.id = ? AND c.usuario = ?').bind(id, this.u).first();
    return m ? { ...m, meta: JSON.parse(m.meta) } : null;
  }

  async actualizarMeta(id, cambios) {
    const m = await this.mensaje(id);
    if (!m) return null;
    const meta = { ...m.meta, ...cambios };
    await this.db.prepare('UPDATE mensajes SET meta = ? WHERE id = ?').bind(JSON.stringify(meta), id).run();
    return meta;
  }
}

const POR_DEFECTO = { rapido: 'workersai/@cf/meta/llama-3.3-70b-instruct-fp8-fast' };

/** Ajustes por usuario (modelos por tarea, etc.) en la tabla ajustes. */
export function tareasD1(db, usuario) {
  let cache = null;
  const todas = async () => {
    if (!cache) {
      const fila = await db.prepare("SELECT valor FROM ajustes WHERE usuario = ? AND clave = 'tareas'").bind(usuario).first();
      cache = fila ? JSON.parse(fila.valor) : {};
    }
    return cache;
  };
  return {
    todas: async () => ({ ...POR_DEFECTO, ...(await todas()) }),
    // Sin elección del usuario, las tareas internas van a un modelo rápido que no razona (el «auto»
    // puede caer en uno que gasta los tokens pensando y no llega a escribir el JSON pedido).
    obtener: async id => (await todas())[id] || POR_DEFECTO[id] || 'auto',
    poner: async (id, modelo) => {
      const t = await todas();
      if (!modelo || modelo === 'auto') delete t[id]; else t[id] = modelo;
      await db.prepare("INSERT OR REPLACE INTO ajustes (usuario, clave, valor) VALUES (?, 'tareas', ?)").bind(usuario, JSON.stringify(t)).run();
    },
  };
}
