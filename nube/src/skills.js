// Skills en la nube: las incluidas (empaquetadas al desplegar) + las propias de cada usuario en D1.
import incluidas from './skills-incluidas.json';
import { aMarkdown, desdeMarkdown, normalizar, ordenar, sistemaDe, slug } from '../../comun/skills.mjs';

const BASE = incluidas.map(s => desdeMarkdown(s.md, { id: s.carpeta, referencias: s.referencias }));

export class SkillsD1 {
  constructor(db, usuario) { this.db = db; this.u = usuario; this.cache = null; }

  async propias() {
    if (!this.cache) {
      const r = await this.db.prepare('SELECT id, md FROM skills WHERE usuario = ?').bind(this.u).all();
      this.cache = r.results.map(f => desdeMarkdown(f.md, { id: f.id, propia: true }));
    }
    return this.cache;
  }

  async todas() {
    const mapa = new Map(BASE.map(s => [s.id, s]));
    for (const s of await this.propias()) mapa.set(s.id, s); // una propia con el mismo id reemplaza a la incluida
    return ordenar(mapa.values());
  }

  async obtener(id) {
    return (await this.todas()).find(s => s.id === id) || null;
  }

  async guardar(datos) {
    const s = normalizar(datos);
    await this.db.prepare('INSERT OR REPLACE INTO skills (usuario, id, md, actualizada) VALUES (?, ?, ?, ?)').bind(this.u, s.id, aMarkdown(s), Date.now()).run();
    this.cache = null;
    return this.obtener(s.id);
  }

  async borrar(id) {
    const r = await this.db.prepare('DELETE FROM skills WHERE usuario = ? AND id = ?').bind(this.u, slug(id)).run();
    this.cache = null;
    return r.meta.changes > 0;
  }

  sistema(skill) { return sistemaDe(skill); }
}
