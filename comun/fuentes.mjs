// Fuentes de investigación: APIs públicas y gratuitas, sin clave (comunes al teléfono y a la nube).
// Cada fuente devuelve [{ titulo, url, resumen, detalle }] para citarla como [n].
import { red } from './red.mjs';

const q = encodeURIComponent;
const corto = (t, n = 900) => {
  const s = String(t ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
};
const xml = (bloque, etiqueta) => {
  const m = bloque.match(new RegExp(`<${etiqueta}[^>]*>([\\s\\S]*?)</${etiqueta}>`));
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
};

async function europepmc(texto, n) {
  const d = await red.pedir(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${q(texto)}&format=json&resultType=core&pageSize=${n}`);
  return (d.resultList?.result || []).map(r => ({
    titulo: corto(r.title, 300),
    url: r.doi ? `https://doi.org/${r.doi}` : `https://europepmc.org/article/${r.source}/${r.id}`,
    doi: r.doi,
    resumen: corto(r.abstractText),
    detalle: [r.authorString && corto(r.authorString, 80), r.journalInfo?.journal?.title || r.bookOrReportDetails?.publisher || (r.source === 'PPR' ? 'Preprint' : ''), r.pubYear].filter(Boolean).join(' · '),
  }));
}

async function pubmed(texto, n) {
  const busqueda = await red.pedir(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${q(texto)}&retmode=json&retmax=${n}&sort=relevance`);
  const ids = busqueda.esearchresult?.idlist || [];
  if (!ids.length) return [];
  const datos = await red.pedir(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids.join(',')}&retmode=xml`, 'text');
  return datos.split('<PubmedArticle>').slice(1).map(a => {
    const pmid = xml(a, 'PMID');
    const resumen = [...a.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)].map(m => m[1]).join(' ');
    return {
      titulo: corto(xml(a, 'ArticleTitle'), 300),
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      resumen: corto(resumen),
      detalle: [xml(a, 'Title'), xml(xml(a, 'PubDate'), 'Year'), `PMID ${pmid}`].filter(Boolean).join(' · '),
    };
  });
}

async function ensayos(texto, n) {
  const d = await red.pedir(`https://clinicaltrials.gov/api/v2/studies?query.term=${q(texto)}&pageSize=${n}`);
  return (d.studies || []).map(s => {
    const p = s.protocolSection || {};
    const id = p.identificationModule?.nctId;
    const intervenciones = (p.armsInterventionsModule?.interventions || []).map(i => i.name).slice(0, 4).join(', ');
    return {
      titulo: corto(p.identificationModule?.briefTitle, 300),
      url: `https://clinicaltrials.gov/study/${id}`,
      resumen: corto(`${p.descriptionModule?.briefSummary || ''} Condiciones: ${(p.conditionsModule?.conditions || []).join(', ')}. Intervenciones: ${intervenciones}.`),
      detalle: [id, p.statusModule?.overallStatus, (p.designModule?.phases || []).join('/'), p.sponsorCollaboratorsModule?.leadSponsor?.name].filter(Boolean).join(' · '),
    };
  });
}

async function uniprot(texto, n) {
  const campos = 'accession,protein_name,gene_names,organism_name,cc_function,length';
  const buscarU = consulta => red.pedir(`https://rest.uniprot.org/uniprotkb/search?query=${q(`(${consulta}) AND reviewed:true`)}&format=json&size=${n}&fields=${campos}`);
  // Primero como símbolo de gen exacto (prioriza humano), después como texto libre.
  let d = /^[\w-]{2,15}$/.test(texto.trim())
    ? await buscarU(`gene_exact:${texto.trim()}`).catch(() => ({ results: [] }))
    : { results: [] };
  if (d.results?.length) d.results.sort((a, b) => (b.organism?.taxonId === 9606) - (a.organism?.taxonId === 9606));
  else d = await buscarU(texto);
  return (d.results || []).map(r => {
    const funcion = (r.comments || []).filter(c => c.commentType === 'FUNCTION').flatMap(c => c.texts || []).map(t => t.value).join(' ');
    return {
      titulo: `${r.proteinDescription?.recommendedName?.fullName?.value || r.primaryAccession} (${r.genes?.[0]?.geneName?.value || '—'})`,
      url: `https://www.uniprot.org/uniprotkb/${r.primaryAccession}`,
      resumen: corto(funcion || 'Sin descripción de función.'),
      detalle: [r.primaryAccession, r.organism?.scientificName, r.sequence?.length && `${r.sequence.length} aa`].filter(Boolean).join(' · '),
    };
  });
}

async function gen(texto, n) {
  const base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=gene&retmode=json';
  let ids = [];
  if (/^[\w-]{2,15}$/.test(texto.trim())) {
    const exacta = await red.pedir(`${base}&term=${q(`${texto.trim()}[sym] AND human[orgn]`)}&retmax=1`).catch(() => null);
    ids = exacta?.esearchresult?.idlist || [];
  }
  const busqueda = await red.pedir(`${base}&term=${q(`${texto} AND alive[prop]`)}&retmax=${n}&sort=relevance`);
  ids = [...new Set([...ids, ...(busqueda.esearchresult?.idlist || [])])].slice(0, n);
  if (!ids.length) return [];
  const d = await red.pedir(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=gene&id=${ids.join(',')}&retmode=json`);
  return ids.map(id => d.result?.[id]).filter(Boolean).map(g => ({
    titulo: `${g.name} — ${g.description}`,
    url: `https://www.ncbi.nlm.nih.gov/gene/${g.uid}`,
    resumen: corto(g.summary || 'Sin resumen en NCBI Gene.'),
    detalle: [g.organism?.scientificname, g.chromosome && `cromosoma ${g.chromosome}`, `Gene ID ${g.uid}`].filter(Boolean).join(' · '),
  }));
}

async function chembl(texto, n) {
  const d = await red.pedir(`https://www.ebi.ac.uk/chembl/api/data/molecule/search.json?q=${q(texto)}&limit=${n}`);
  return (d.molecules || []).map(m => {
    const p = m.molecule_properties || {};
    return {
      titulo: m.pref_name || m.molecule_chembl_id,
      url: `https://www.ebi.ac.uk/chembl/explore/compound/${m.molecule_chembl_id}`,
      resumen: corto(`Fórmula ${p.full_molformula || '—'}, PM ${p.full_mwt || '—'}, AlogP ${p.alogp ?? '—'}, fase clínica máxima ${m.max_phase ?? '—'}. ${m.indication_class ? 'Clase: ' + m.indication_class + '.' : ''} SMILES: ${m.molecule_structures?.canonical_smiles || '—'}`),
      detalle: [m.molecule_chembl_id, m.molecule_type, m.first_approval && `aprobado ${m.first_approval}`].filter(Boolean).join(' · '),
    };
  });
}

async function pubchem(texto) {
  const nombre = q(texto.split(/[,;]/)[0].trim());
  const base = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name';
  const d = await red.pedir(`${base}/${nombre}/property/IUPACName,MolecularFormula,MolecularWeight,CanonicalSMILES,XLogP/JSON`);
  const p = d.PropertyTable?.Properties?.[0];
  if (!p) return [];
  let descripcion = '';
  try {
    const desc = await red.pedir(`${base}/${nombre}/description/JSON`);
    descripcion = (desc.InformationList?.Information || []).map(i => i.Description).filter(Boolean)[0] || '';
  } catch { /* la descripción es opcional */ }
  return [{
    titulo: `${decodeURIComponent(nombre)} (CID ${p.CID})`,
    url: `https://pubchem.ncbi.nlm.nih.gov/compound/${p.CID}`,
    resumen: corto(`${descripcion} IUPAC: ${p.IUPACName || '—'}. Fórmula ${p.MolecularFormula}, PM ${p.MolecularWeight}, XLogP ${p.XLogP ?? '—'}. SMILES ${p.CanonicalSMILES || p.ConnectivitySMILES || '—'}`),
    detalle: 'PubChem',
  }];
}

async function openalex(texto, n) {
  const d = await red.pedir(`https://api.openalex.org/works?search=${q(texto)}&per-page=${n}&mailto=lab@cardon.app`);
  return (d.results || []).map(w => {
    let resumen = '';
    if (w.abstract_inverted_index) {
      const palabras = [];
      for (const [p, pos] of Object.entries(w.abstract_inverted_index)) for (const i of pos) palabras[i] = p;
      resumen = palabras.join(' ');
    }
    return {
      titulo: corto(w.title, 300),
      url: w.doi || w.id,
      doi: w.doi ? w.doi.replace('https://doi.org/', '') : undefined,
      resumen: corto(resumen || 'Sin resumen disponible.'),
      detalle: [w.primary_location?.source?.display_name, w.publication_year, `${w.cited_by_count} citas`].filter(Boolean).join(' · '),
    };
  });
}

async function arxiv(texto, n) {
  const d = await red.pedir(`https://export.arxiv.org/api/query?search_query=all:${q(texto)}&max_results=${n}&sortBy=relevance`, 'text');
  return d.split('<entry>').slice(1).map(e => ({
    titulo: corto(xml(e, 'title'), 300),
    url: xml(e, 'id'),
    resumen: corto(xml(e, 'summary')),
    detalle: [[...e.matchAll(/<name>([^<]+)<\/name>/g)].slice(0, 3).map(m => m[1]).join(', '), xml(e, 'published').slice(0, 4), 'arXiv'].filter(Boolean).join(' · '),
  }));
}

async function crossref(texto, n) {
  const d = await red.pedir(`https://api.crossref.org/works?query=${q(texto)}&rows=${n}&select=DOI,title,author,container-title,issued,abstract,type,is-referenced-by-count&mailto=lab@cardon.app`);
  return (d.message?.items || []).map(w => ({
    titulo: corto((w.title || [])[0] || w.DOI, 300),
    url: `https://doi.org/${w.DOI}`,
    resumen: corto(w.abstract || 'Registro de Crossref sin resumen.'),
    detalle: [(w.author || []).slice(0, 3).map(a => a.family).filter(Boolean).join(', '), (w['container-title'] || [])[0], w.issued?.['date-parts']?.[0]?.[0], `${w['is-referenced-by-count'] ?? 0} citas`].filter(Boolean).join(' · '),
    doi: w.DOI,
  }));
}

async function semanticscholar(texto, n) {
  const d = await red.pedir(`https://api.semanticscholar.org/graph/v1/paper/search?query=${q(texto)}&limit=${n}&fields=title,abstract,year,venue,url,externalIds,citationCount,isOpenAccess,openAccessPdf,tldr`);
  return (d.data || []).map(p => ({
    titulo: corto(p.title, 300),
    url: p.externalIds?.DOI ? `https://doi.org/${p.externalIds.DOI}` : p.url,
    resumen: corto(p.abstract || p.tldr?.text || 'Sin resumen.'),
    detalle: [p.venue, p.year, `${p.citationCount ?? 0} citas`, p.isOpenAccess ? 'acceso abierto' : ''].filter(Boolean).join(' · '),
    doi: p.externalIds?.DOI,
    pdf: p.openAccessPdf?.url,
  }));
}

function wikipedia(idioma) {
  return async (texto, n) => {
    const d = await red.pedir(`https://${idioma}.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${q(texto)}&gsrlimit=${Math.min(n, 4)}&prop=extracts|info&exintro=1&explaintext=1&inprop=url&format=json&origin=*`);
    return Object.values(d.query?.pages || {}).sort((a, b) => a.index - b.index).map(p => ({
      titulo: p.title,
      url: p.fullurl,
      resumen: corto(p.extract),
      detalle: `Wikipedia (${idioma})`,
    }));
  };
}

// La búsqueda web va por FreeLLMAPI (Keenable/Parallel sin clave, o Tavily/Exa/Brave con clave).
function web(gateway) {
  return async (texto, n) => {
    let d;
    try {
      d = await gateway.buscar(texto, n);
    } catch (e) {
      // El catálogo gratuito de FreeLLMAPI aún no trae buscadores sin clave.
      if (/no_search_keys|No search key configured/i.test(e.message)) {
        throw new Error('sin buscador web: añade una clave gratis de Tavily en Ajustes → Modelos y proveedores');
      }
      throw e;
    }
    return (d.results || []).map(r => ({
      titulo: corto(r.title, 300),
      url: r.url,
      resumen: corto(r.content || r.snippet || r.description),
      detalle: (() => { try { return new URL(r.url).hostname.replace(/^www\./, ''); } catch { return 'web'; } })(),
    }));
  };
}

// idioma: en qué idioma conviene la consulta ('en' para bases científicas).
// entidad: la base busca mejor por el nombre de un gen, proteína o compuesto que por una frase.
// consulta(q): la misma búsqueda en la web de la base, para repetirla y revisarla a mano.
export function catalogo(gateway) {
  return [
    { id: 'web', nombre: 'Web', area: 'General', idioma: 'es', buscar: web(gateway), consulta: t => `https://duckduckgo.com/?q=${q(t)}` },
    { id: 'wikipedia', nombre: 'Wikipedia', area: 'General', idioma: 'es', buscar: wikipedia('es'), consulta: t => `https://es.wikipedia.org/w/index.php?search=${q(t)}` },
    { id: 'openalex', nombre: 'OpenAlex', area: 'Ciencia', idioma: 'en', buscar: openalex, consulta: t => `https://openalex.org/works?search=${q(t)}` },
    { id: 'semanticscholar', nombre: 'Semantic Scholar', area: 'Ciencia (citas, acceso abierto)', idioma: 'en', buscar: semanticscholar, consulta: t => `https://www.semanticscholar.org/search?q=${q(t)}` },
    { id: 'crossref', nombre: 'Crossref', area: 'Registro de DOI', idioma: 'en', buscar: crossref, consulta: t => `https://search.crossref.org/search/works?q=${q(t)}&from_ui=yes` },
    { id: 'europepmc', nombre: 'Europe PMC', area: 'Ciencias de la vida', idioma: 'en', buscar: europepmc, consulta: t => `https://europepmc.org/search?query=${q(t)}` },
    { id: 'pubmed', nombre: 'PubMed', area: 'Biomedicina', idioma: 'en', buscar: pubmed, consulta: t => `https://pubmed.ncbi.nlm.nih.gov/?term=${q(t)}` },
    { id: 'arxiv', nombre: 'arXiv', area: 'Física, matemáticas, IA', idioma: 'en', buscar: arxiv, consulta: t => `https://arxiv.org/search/?query=${q(t)}&searchtype=all` },
    { id: 'uniprot', nombre: 'UniProt', area: 'Proteínas', idioma: 'en', entidad: true, buscar: uniprot, consulta: t => `https://www.uniprot.org/uniprotkb?query=${q(t)}` },
    { id: 'gene', nombre: 'NCBI Gene', area: 'Genes', idioma: 'en', entidad: true, buscar: gen, consulta: t => `https://www.ncbi.nlm.nih.gov/gene/?term=${q(t)}` },
    { id: 'ensayos', nombre: 'ClinicalTrials.gov', area: 'Ensayos clínicos', idioma: 'en', buscar: ensayos, consulta: t => `https://clinicaltrials.gov/search?term=${q(t)}` },
    { id: 'chembl', nombre: 'ChEMBL', area: 'Fármacos y bioactividad', idioma: 'en', entidad: true, buscar: chembl, consulta: t => `https://www.ebi.ac.uk/chembl/explore/compounds/?search=${q(t)}` },
    { id: 'pubchem', nombre: 'PubChem', area: 'Química', idioma: 'en', entidad: true, buscar: pubchem, consulta: t => `https://pubchem.ncbi.nlm.nih.gov/#query=${q(t)}` },
  ];
}

// Google Scholar no tiene API, pero el enlace sirve para revisar a mano.
export const scholar = t => `https://scholar.google.com/scholar?q=${q(t)}`;
