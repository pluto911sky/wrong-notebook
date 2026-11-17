const symbols = Object.freeze({
  times: '×', cdot: '·', div: '÷', pm: '±', le: '≤', leq: '≤', ge: '≥', geq: '≥',
  neq: '≠', approx: '≈', pi: 'π', alpha: 'α', beta: 'β', theta: 'θ', degree: '°',
});
const superDigits = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻' };

function mathText(formula) {
  const rendered = formula
    .replace(/\\(?:left|right)(?=[()[\]|])/g, '')
    .replace(/\\(?:dfrac|tfrac|frac)\{([^{}]+)\}\{([^{}]+)\}/g, (_, top, bottom) => `(${top})⁄(${bottom})`)
    .replace(/\\sqrt\{([^{}]+)\}/g, (_, value) => `√(${value})`)
    .replace(/\^\{(-?\d+)\}|\^(\d)/g, (_, grouped, single) => [...(grouped || single)].map((digit) => superDigits[digit]).join(''))
    .replace(/\\([a-zA-Z]+)/g, (source, name) => Object.prototype.hasOwnProperty.call(symbols, name) ? symbols[name] : source);
  return /[\\{}]/.test(rendered) ? null : rendered;
}

function formatText(text) {
  return text.replace(/\$\$([^$]+)\$\$|\$([^$\n]+)\$|\\\((.*?)\\\)|\\\[([\s\S]*?)\\\]/g,
    (source, display, inline, parens, brackets) => mathText(display || inline || parens || brackets) ?? source);
}

function tableCells(line) {
  const text = line.trim();
  if (!text.includes('|')) return null;
  return text.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
}

function formatBlocks(value) {
  const lines = String(value || '').split(/\r?\n/);
  const blocks = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'text', text: formatText(paragraph.join('\n')), id: blocks.length });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const header = tableCells(lines[i]);
    const delimiter = tableCells(lines[i + 1] || '');
    if (!header || header.length < 2 || delimiter?.length !== header.length ||
        !delimiter.every((cell) => /^:?-{3,}:?$/.test(cell))) {
      paragraph.push(lines[i]);
      continue;
    }
    flush();
    const rows = [{ id: 0, cells: header.map(formatText) }];
    i += 1;
    while (i + 1 < lines.length) {
      const row = tableCells(lines[i + 1]);
      if (!row || row.length !== header.length) break;
      rows.push({ id: rows.length, cells: row.map(formatText) });
      i += 1;
    }
    blocks.push({ type: 'table', rows, id: blocks.length });
  }
  flush();
  return blocks;
}

module.exports = { formatBlocks };
