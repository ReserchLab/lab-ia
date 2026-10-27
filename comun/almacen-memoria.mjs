// Almacén en memoria con la misma interfaz que los de D1 y SQLite. Sirve para usar el núcleo sin
// guardar nada (p. ej. generar ejemplos de entrenamiento sin llenar la lista de conversaciones).
export class AlmacenMemoria {
  constructor() { this.convs = new Map(); this.n = 0; }
  #id() { return `m${++this.n}`; }

  crearConversacion(titulo, skill) {
    const id = this.#id();
    this.convs.set(id, { id, titulo, skill, memoria: '', memoria_hasta: 0, mensajes: [] });
    return id;
  }
  conversaciones() { return [...this.convs.values()].map(({ id, titulo, skill }) => ({ id, titulo, skill })); }
  conversacion(id) { const c = this.convs.get(id); return c ? { ...c, mensajes: c.mensajes.map(m => ({ ...m })) } : null; }
  mensajes(id) { return (this.convs.get(id)?.mensajes || []).map(m => ({ ...m, meta: JSON.stringify(m.meta) })); }
  agregar(conv, rol, contenido, meta = {}) {
    const id = this.#id();
    this.convs.get(conv)?.mensajes.push({ id, rol, contenido, meta, creado: Date.now() });
    return id;
  }
  mensaje(id) {
    for (const c of this.convs.values()) { const m = c.mensajes.find(x => x.id === id); if (m) return { ...m }; }
    return null;
  }
  actualizarMeta(id, cambios) {
    for (const c of this.convs.values()) { const m = c.mensajes.find(x => x.id === id); if (m) { m.meta = { ...m.meta, ...cambios }; return m.meta; } }
    return null;
  }
  quitarUltimaRespuesta(conv) { const ms = this.convs.get(conv)?.mensajes; if (ms?.at(-1)?.rol === 'assistant') ms.pop(); }
  memoria(id) { const c = this.convs.get(id); return { memoria: c?.memoria || '', memoria_hasta: c?.memoria_hasta || 0 }; }
  guardarMemoria(id, memoria, hasta) { const c = this.convs.get(id); if (c) Object.assign(c, { memoria, memoria_hasta: hasta }); }
  renombrar() {}
  borrar(id) { this.convs.delete(id); }
}
