// Empaqueta las skills incluidas (servidor/skills/*/SKILL.md + references/) en un JSON
// que el Worker importa: en Cloudflare no hay sistema de archivos.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(raiz, 'servidor', 'skills');
const skills = [];
for (const d of readdirSync(dir, { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  const archivo = path.join(dir, d.name, 'SKILL.md');
  if (!existsSync(archivo)) continue;
  const refs = path.join(dir, d.name, 'references');
  skills.push({
    carpeta: d.name,
    md: readFileSync(archivo, 'utf8'),
    referencias: existsSync(refs)
      ? readdirSync(refs).filter(f => /\.(md|txt)$/i.test(f)).sort().map(nombre => ({ nombre, contenido: readFileSync(path.join(refs, nombre), 'utf8') }))
      : [],
  });
}
writeFileSync(path.join(raiz, 'nube', 'src', 'skills-incluidas.json'), JSON.stringify(skills));
console.log(`skills empaquetadas: ${skills.length}`);
