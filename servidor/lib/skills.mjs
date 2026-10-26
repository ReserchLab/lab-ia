// Skills en disco: incluidas (servidor/skills) y propias del usuario (~/.cardon-lab/skills).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { aMarkdown, desdeMarkdown, normalizar, ordenar, publica, sistemaDe, slug } from '../../comun/skills.mjs';

function cargar(dir, propia) {
  const archivo = path.join(dir, 'SKILL.md');
  if (!existsSync(archivo)) return null;
  const refsDir = path.join(dir, 'references');
  const referencias = existsSync(refsDir)
    ? readdirSync(refsDir).filter(f => /\.(md|txt)$/i.test(f)).sort().map(nombre => ({ nombre, contenido: readFileSync(path.join(refsDir, nombre), 'utf8') }))
    : [];
  return { ...desdeMarkdown(readFileSync(archivo, 'utf8'), { id: path.basename(dir), propia, referencias }), dir };
}

export class Skills {
  constructor(dirIncluidas, dirPropias) {
    this.dirIncluidas = dirIncluidas;
    this.dirPropias = dirPropias;
    mkdirSync(dirPropias, { recursive: true });
  }

  todas() {
    const lista = new Map();
    for (const [base, propia] of [[this.dirIncluidas, false], [this.dirPropias, true]]) {
      if (!existsSync(base)) continue;
      for (const d of readdirSync(base, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const s = cargar(path.join(base, d.name), propia);
        if (s) lista.set(s.id, s); // una propia con el mismo id reemplaza a la incluida
      }
    }
    return ordenar(lista.values());
  }

  obtener(id) {
    return this.todas().find(s => s.id === id) || null;
  }

  guardar(datos) {
    const s = normalizar(datos);
    const dir = path.join(this.dirPropias, s.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'SKILL.md'), aMarkdown(s));
    return this.obtener(s.id);
  }

  borrar(id) {
    const dir = path.join(this.dirPropias, slug(id));
    if (!existsSync(dir)) return false;
    rmSync(dir, { recursive: true, force: true });
    return true;
  }

  sistema(skill) { return sistemaDe(skill); }
}

export { publica };
