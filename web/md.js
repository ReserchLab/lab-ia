// Markdown → HTML seguro: todo el texto se escapa antes de aplicar formato.
// Soporta títulos, párrafos, listas (anidadas por sangría), citas, código, tablas,
// enlaces, negrita/cursiva/tachado y citas de fuentes [n].
(function () {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function enLinea(texto, fuentes) {
    const codigos = [];
    let s = esc(texto).replace(/`([^`\n]+)`/g, (_, c) => `\u0000${codigos.push(c) - 1}\u0000`);
    s = s
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`)
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, (_, a, u) => `${a}<a href="${u}" target="_blank" rel="noopener">${u}</a>`)
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
      .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    if (fuentes && fuentes.length) {
      s = s.replace(/\[(\d{1,2}(?:\s*[,–-]\s*\d{1,2})*)\]/g, (todo, grupo) => grupo.split(/\s*,\s*/).map(parte => {
        const [a, b] = parte.split(/\s*[–-]\s*/).map(Number);
        const nums = b && b > a && b - a < 12 ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a];
        return nums.map(n => {
          const f = fuentes.find(x => x.n === n);
          return f ? `<a class="cita" href="${esc(f.url)}" target="_blank" rel="noopener" data-n="${n}" title="${esc(f.titulo)}">${n}</a>` : `[${n}]`;
        }).join('');
      }).join(''));
    }
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codigos[i]}</code>`);
  }

  function tabla(lineas, fuentes) {
    const celdas = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const cab = celdas(lineas[0]);
    const filas = lineas.slice(2).map(celdas);
    return `<div class="tabla"><table><thead><tr>${cab.map(c => `<th>${enLinea(c, fuentes)}</th>`).join('')}</tr></thead><tbody>${
      filas.map(f => `<tr>${cab.map((_, i) => `<td>${enLinea(f[i] || '', fuentes)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function lista(lineas, fuentes) {
    // lineas: [{ sangria, ordenada, texto }]
    let html = '';
    const pila = [];
    for (const l of lineas) {
      while (pila.length && l.sangria < pila[pila.length - 1].sangria) html += `</li></${pila.pop().tipo}>`;
      const tope = pila[pila.length - 1];
      if (!tope || l.sangria > tope.sangria) {
        const tipo = l.ordenada ? 'ol' : 'ul';
        html += `<${tipo}${l.ordenada && l.inicio !== 1 ? ` start="${l.inicio}"` : ''}><li>`;
        pila.push({ tipo, sangria: l.sangria });
      } else {
        html += '</li><li>';
      }
      html += enLinea(l.texto, fuentes);
    }
    while (pila.length) html += `</li></${pila.pop().tipo}>`;
    return html;
  }

  function md(fuente, fuentes) {
    const lineas = String(fuente || '').replace(/\r\n?/g, '\n').split('\n');
    const salida = [];
    let i = 0;
    while (i < lineas.length) {
      const l = lineas[i];
      const valla = l.match(/^\s*(```|~~~)\s*([\w+#.-]*)/);
      if (valla) {
        const codigo = [];
        i++;
        while (i < lineas.length && !lineas[i].trim().startsWith(valla[1])) codigo.push(lineas[i++]);
        i++;
        const leng = valla[2] ? `<span class="lenguaje">${esc(valla[2])}</span>` : '';
        salida.push(`<pre>${leng}<button class="copiar" type="button">copiar</button><code>${esc(codigo.join('\n'))}</code></pre>`);
        continue;
      }
      if (!l.trim()) { i++; continue; }
      const titulo = l.match(/^(#{1,6})\s+(.*)$/);
      if (titulo) {
        const n = Math.min(titulo[1].length, 4);
        salida.push(`<h${n}>${enLinea(titulo[2].replace(/#+\s*$/, ''), fuentes)}</h${n}>`);
        i++;
        continue;
      }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { salida.push('<hr>'); i++; continue; }
      if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lineas[i + 1] || '')) {
        const bloque = [];
        while (i < lineas.length && /^\s*\|.*\|?\s*$/.test(lineas[i]) && lineas[i].trim()) bloque.push(lineas[i++]);
        salida.push(tabla(bloque, fuentes));
        continue;
      }
      if (/^\s*>/.test(l)) {
        const bloque = [];
        while (i < lineas.length && /^\s*>/.test(lineas[i])) bloque.push(lineas[i++].replace(/^\s*>\s?/, ''));
        salida.push(`<blockquote>${md(bloque.join('\n'), fuentes)}</blockquote>`);
        continue;
      }
      const item = /^(\s*)([-*+•]|(\d+)[.)])\s+(.*)$/;
      if (item.test(l)) {
        const bloque = [];
        while (i < lineas.length) {
          const m = lineas[i].match(item);
          if (m) {
            bloque.push({ sangria: m[1].replace(/\t/g, '    ').length, ordenada: Boolean(m[3]), inicio: Number(m[3]) || 1, texto: m[4] });
            i++;
          } else if (lineas[i].trim() && /^\s{2,}/.test(lineas[i]) && bloque.length) {
            bloque[bloque.length - 1].texto += ' ' + lineas[i++].trim();
          } else break;
        }
        salida.push(lista(bloque, fuentes));
        continue;
      }
      const parrafo = [];
      while (i < lineas.length && lineas[i].trim() && !/^(#{1,6}\s|\s*```|\s*~~~|\s*>|\s*([-*+•]|\d+[.)])\s+|\s*\|.*\|\s*$)/.test(lineas[i])) {
        parrafo.push(lineas[i++]);
      }
      if (!parrafo.length) parrafo.push(lineas[i++]);
      salida.push(`<p>${parrafo.map(p => enLinea(p, fuentes)).join('<br>')}</p>`);
    }
    return salida.join('\n');
  }

  window.renderMd = md;
  window.escaparHtml = esc;
})();
