#!/usr/bin/env node
// Importa skills de Claude (carpetas con SKILL.md) a laboratorio.ia.
// Uso: node importar-skills.mjs <destino> <carpeta-skill> [más carpetas…] [--modo investigar] [--fuentes a,b] [--categoria X]
// Copia SKILL.md, references/ y la licencia; añade los campos de laboratorio.ia al frontmatter
// sin tocar `name` ni `description`, así la skill sigue siendo válida para Claude.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Ajustes conocidos para las skills de bio-research.
const CONOCIDAS = {
  'scientific-problem-selection': { tarea: 'razonamiento', nombre: 'Elegir problema científico', resumen: 'Elegir, evaluar y replantear proyectos de investigación (marco de Fischbach y Walsh, Cell 2024).', icono: '⟁', modo: 'chat', fuentes: 'openalex, europepmc', categoria: 'Ciencia' },
  'single-cell-rna-qc': { tarea: 'codigo', nombre: 'Control de calidad scRNA-seq', resumen: 'Control de calidad de single-cell RNA-seq con scanpy: filtrado por MAD, mitocondriales, dobletes.', icono: '⁘', modo: 'chat', fuentes: 'europepmc, gene', categoria: 'Ciencias de la vida' },
  'scvi-tools': { tarea: 'codigo', nombre: 'scvi-tools (single-cell)', resumen: 'Integración y corrección de lotes, multimodal (CITE-seq, multiome), espacial y velocidad de ARN con scvi-tools.', icono: '∿', modo: 'chat', fuentes: 'europepmc', categoria: 'Ciencias de la vida' },
  'nextflow-development': { tarea: 'codigo', nombre: 'Pipelines nf-core', resumen: 'Ejecutar rnaseq, sarek y atacseq de nf-core con FASTQ locales o datos de GEO/SRA.', icono: '⇶', modo: 'chat', fuentes: 'europepmc, web', categoria: 'Ciencias de la vida' },
  'instrument-data-to-allotrope': { tarea: 'codigo', nombre: 'Datos de instrumentos → Allotrope', resumen: 'Convertir datos de instrumentos de laboratorio (PDF, CSV, Excel) a Allotrope ASM o CSV plano.', icono: '⧉', modo: 'chat', fuentes: 'web', categoria: 'Ciencias de la vida' },
};

const NOTA = '> Nota de laboratorio.ia: aquí no puedes ejecutar los scripts ni leer archivos que mencione esta skill. Cuando haga falta, entrega el código completo para que el usuario lo ejecute (por ejemplo en Termux o Notebook Studio) y explica qué resultado esperar.';

const args = process.argv.slice(2);
const opcion = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const forzado = { modo: opcion('modo'), fuentes: opcion('fuentes'), categoria: opcion('categoria') };
const [destino, ...origenes] = args;
if (!destino || !origenes.length) {
  console.error('Uso: importar-skills.mjs <destino> <carpeta-skill>…');
  process.exit(1);
}

for (const origen of origenes) {
  const archivo = path.join(origen, 'SKILL.md');
  if (!existsSync(archivo)) { console.error(`  ✗ ${origen}: sin SKILL.md`); continue; }
  const texto = readFileSync(archivo, 'utf8');
  const m = texto.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) { console.error(`  ✗ ${origen}: SKILL.md sin frontmatter`); continue; }
  const nombre = (m[1].match(/^name:\s*(.+)$/m)?.[1] || path.basename(origen)).trim();
  const extra = { ...(CONOCIDAS[nombre] || { nombre, icono: '◇', modo: 'chat', fuentes: '', categoria: 'Importadas' }) };
  for (const [k, v] of Object.entries(forzado)) if (v) extra[k] = v;
  const frontmatter = m[1].split(/\r?\n/).filter(l => !/^(nombre|resumen|icono|modo|fuentes|categoria|tarea):/.test(l));
  for (const [k, v] of Object.entries(extra)) frontmatter.push(`${k}: ${v}`);
  const cuerpo = m[2].includes('Nota de laboratorio.ia') ? m[2] : `${NOTA}\n\n${m[2].trim()}`;

  const dir = path.join(destino, nombre);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), `---\n${frontmatter.join('\n')}\n---\n\n${cuerpo}\n`);
  for (const sub of ['references', 'LICENSE.txt', 'LICENSE']) {
    if (existsSync(path.join(origen, sub))) cpSync(path.join(origen, sub), path.join(dir, sub), { recursive: true });
  }
  console.log(`  ✓ ${nombre} → ${extra.nombre}`);
}
