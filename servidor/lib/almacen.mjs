// Conversaciones y mensajes en SQLite (node:sqlite, sin dependencias).
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export class Almacen {
  constructor(archivo) {
    this.db = new DatabaseSync(archivo);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS conversaciones (
        id TEXT PRIMARY KEY, titulo TEXT NOT NULL, skill TEXT, creada INTEGER NOT NULL, actualizada INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mensajes (
        id TEXT PRIMARY KEY, conversacion TEXT NOT NULL REFERENCES conversaciones(id) ON DELETE CASCADE,
        rol TEXT NOT NULL, contenido TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}', creado INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS mensajes_conv ON mensajes(conversacion, creado);
    `);
    // Memoria del chat: resumen acumulado de los mensajes que ya no caben en el contexto.
    const columnas = this.db.prepare('PRAGMA table_info(conversaciones)').all().map(c => c.name);
    if (!columnas.includes('memoria')) this.db.exec("ALTER TABLE conversaciones ADD COLUMN memoria TEXT NOT NULL DEFAULT ''");
    if (!columnas.includes('memoria_hasta')) this.db.exec('ALTER TABLE conversaciones ADD COLUMN memoria_hasta INTEGER NOT NULL DEFAULT 0');
  }

  /** memoria_hasta = cuántos mensajes (desde el principio) ya están resumidos en `memoria`. */
  memoria(id) {
    return this.db.prepare('SELECT memoria, memoria_hasta FROM conversaciones WHERE id = ?').get(id) || { memoria: '', memoria_hasta: 0 };
  }

  guardarMemoria(id, memoria, hasta) {
    this.db.prepare('UPDATE conversaciones SET memoria = ?, memoria_hasta = ? WHERE id = ?').run(memoria, hasta, id);
  }

  mensaje(id) {
    const m = this.db.prepare('SELECT * FROM mensajes WHERE id = ?').get(id);
    return m ? { ...m, meta: JSON.parse(m.meta) } : null;
  }

  /** Mezcla campos en el meta de un mensaje (verificación, revisión manual). */
  actualizarMeta(id, cambios) {
    const m = this.mensaje(id);
    if (!m) return null;
    const meta = { ...m.meta, ...cambios };
    this.db.prepare('UPDATE mensajes SET meta = ? WHERE id = ?').run(JSON.stringify(meta), id);
    return meta;
  }

  crearConversacion(titulo, skill) {
    const id = randomUUID();
    const ahora = Date.now();
    this.db.prepare('INSERT INTO conversaciones (id, titulo, skill, creada, actualizada) VALUES (?, ?, ?, ?, ?)').run(id, titulo, skill || null, ahora, ahora);
    return id;
  }

  conversaciones() {
    return this.db.prepare('SELECT id, titulo, skill, actualizada FROM conversaciones ORDER BY actualizada DESC LIMIT 200').all();
  }

  conversacion(id) {
    const c = this.db.prepare('SELECT * FROM conversaciones WHERE id = ?').get(id);
    if (!c) return null;
    c.mensajes = this.mensajes(id).map(m => ({ ...m, meta: JSON.parse(m.meta) }));
    return c;
  }

  mensajes(id) {
    return this.db.prepare('SELECT id, rol, contenido, meta, creado FROM mensajes WHERE conversacion = ? ORDER BY creado, rowid').all(id);
  }

  agregar(conversacion, rol, contenido, meta = {}) {
    const id = randomUUID();
    const ahora = Date.now();
    this.db.prepare('INSERT INTO mensajes (id, conversacion, rol, contenido, meta, creado) VALUES (?, ?, ?, ?, ?, ?)').run(id, conversacion, rol, contenido, JSON.stringify(meta), ahora);
    this.db.prepare('UPDATE conversaciones SET actualizada = ? WHERE id = ?').run(ahora, conversacion);
    return id;
  }

  /** Borra la última respuesta del asistente para regenerarla. */
  quitarUltimaRespuesta(conversacion) {
    const ultimo = this.db.prepare('SELECT id, rol FROM mensajes WHERE conversacion = ? ORDER BY creado DESC, rowid DESC LIMIT 1').get(conversacion);
    if (ultimo?.rol === 'assistant') this.db.prepare('DELETE FROM mensajes WHERE id = ?').run(ultimo.id);
  }

  renombrar(id, titulo) {
    this.db.prepare('UPDATE conversaciones SET titulo = ? WHERE id = ?').run(titulo, id);
  }

  borrar(id) {
    this.db.prepare('DELETE FROM mensajes WHERE conversacion = ?').run(id);
    this.db.prepare('DELETE FROM conversaciones WHERE id = ?').run(id);
  }
}
