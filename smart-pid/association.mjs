// Site masks use # for one digit, @ for one letter, and literal separators.
const defaultValvePrefixes = 'HV, XV, MOV, SDV, ESDV, BDV, FCV, PCV, PV, LCV, TCV, FV, LV, TV, CV, PSV, PRV, ZV, VLV, BV, GV';
const prefixes = defaultValvePrefixes.split(', ');
const valveCode = `(?:${prefixes.join('|')})`;
const defaultFormats = [
  new RegExp(`^${valveCode}[- ]?[0-9]{2,6}[A-Z]?$`),
  new RegExp(`^${valveCode}-[A-Z][0-9]{2,6}[A-Z]?$`),
  new RegExp(`^(?:[A-Z]{1,2}|[0-9]{1,3})-${valveCode}-[0-9]{2,6}[A-Z]?$`),
  new RegExp(`^${valveCode}-[0-9]{1,3}-[0-9]{2,6}[A-Z]?$`),
  new RegExp(`^[A-Z][0-9]{2,6} ${valveCode}$`)
];

export function valveFormats(input = '') {
  if (typeof input !== 'string') throw new Error('Valve tag formats must be text.');
  const masks = input.split(/[,\n]+/).map(mask => mask.trim().toUpperCase()).filter(Boolean);
  if (masks.length > 24 || masks.some(mask => !/^[A-Z0-9#@ _.-]{2,32}$/.test(mask) ||
      !/[A-Z]/.test(mask) || (/[#@]/.test(mask) && !mask.includes('#')))) {
    throw new Error('Use prefixes or masks such as HV, XV-#### or ##-XV-###.');
  }
  return [...defaultFormats, ...masks.map(mask => new RegExp(/[#@]/.test(mask)
    ? '^' + mask.replaceAll('.', '\\.').replaceAll('#', '[0-9]').replaceAll('@', '[A-Z]') + '$'
    : '^' + mask.replaceAll('.', '\\.') + '[- ]?[0-9]{2,6}[A-Z]?$'))];
}

function tagClass(value, formats) {
  // Parse the whole observation. A token embedded in a pipe code or dimension
  // must never produce a partial match.
  if (/^(?:P|PU|PMP)[- ]?\d{2,6}[A-Z]?$/.test(value)) return 'pump';
  if (/^(?:V|TK|T|DR|VES)[- ]?\d{2,6}[A-Z]?$/.test(value)) return 'vessel';
  if (defaultFormats.some(format => format.test(value))) return 'valve';
  if (!/^[FPLT]CV/.test(value) && /^[FPLTA][ITGSC][A-Z]?[- ]?\d{2,6}[A-Z]?$/.test(value)) return 'instrument';
  if (formats.some(format => format.test(value))) return 'valve';
  return null;
}

function normalizeText(value) {
  return value.toUpperCase().trim().replace(/[‐‑–−]/g, '-').replace(/\s+/g, ' ').replace(/\s*-\s*/g, '-');
}

export function tagObservations(text, formats) {
  const tags = [];
  const fragments = text.map(item => ({ ...item, value: normalizeText(item.value) }))
    .filter(item => /^[A-Z0-9-]{2,15}$/.test(item.value) && !tagClass(item.value, formats));
  const stacked = [];
  for (const top of fragments) {
    if (!/\d/.test(top.value)) continue;
    for (const bottom of fragments) {
      if (top.source !== bottom.source || /\d/.test(bottom.value)) continue;
      const height = Math.max(top.size, bottom.size);
      const dx = bottom.position.x - top.position.x, dy = bottom.position.y - top.position.y;
      if (dy < height * 0.63 || dy > height * 2.15 || Math.abs(dx) > height * 0.7) continue;
      const value = top.value + ' ' + bottom.value;
      if (!tagClass(value, formats)) continue;
      stacked.push({ ...top, value, quality: Math.min(top.quality, bottom.quality),
        position: { x: top.position.x + dx / 2, y: top.position.y + dy / 2 } });
    }
  }
  for (const observation of [...text, ...stacked]) {
    const value = normalizeText(observation.value);
    const classification = tagClass(value, formats);
    if (!classification) continue;
    const duplicate = tags.find(tag => tag.value === value &&
      Math.hypot(tag.position.x - observation.position.x, tag.position.y - observation.position.y) <=
      Math.max(3, Math.min(tag.size, observation.size) * 0.7));
    if (!duplicate) tags.push({ ...observation, value, classification });
    else if (observation.quality > duplicate.quality) Object.assign(duplicate, observation, { value, classification });
  }
  // Overlapping OCR passes can read different digits at the same printed label.
  // An OCR confidence difference alone cannot resolve that disagreement.
  for (const [i, tag] of tags.entries()) {
    if (tag.source !== 'ocr') continue;
    for (let j = i + 1; j < tags.length; j++) {
      const other = tags[j];
      if (other.source !== 'ocr' || other.classification !== tag.classification || other.value === tag.value) continue;
      const gap = Math.hypot(tag.position.x - other.position.x, tag.position.y - other.position.y);
      if (gap > Math.max(3, Math.min(tag.size, other.size) * 0.7)) continue;
      tag.conflictingReading = true;
      other.conflictingReading = true;
    }
  }
  return tags;
}

export function associateTags(symbols, tags) {
  const occurrences = new Map();
  for (const tag of tags) occurrences.set(tag.value, (occurrences.get(tag.value) || 0) + 1);
  const bySymbol = symbols.map(() => []);
  const byTag = tags.map(() => []);
  for (const [i, symbol] of symbols.entries()) {
    const { box } = symbol;
    const span = Math.max(box.right - box.left, box.bottom - box.top);
    for (const [j, tag] of tags.entries()) {
      if (symbol.classification !== tag.classification) continue;
      const { x, y } = tag.position;
      const dx = Math.max(box.left - x, x - box.right, 0);
      const dy = Math.max(box.top - y, y - box.bottom, 0);
      const radius = Math.max(span * 1.95, tag.size * 3, (tag.regionRadius || 0) * 3.45);
      const distance = Math.hypot(dx, dy);
      if (distance > radius || Math.min(dx, dy) > Math.max(span * 0.4, tag.size, (tag.regionRadius || 0) * 1.85)) continue;
      const gap = distance / radius;
      const offset = Math.hypot(x - symbol.position.x, y - symbol.position.y) / radius;
      const score = (1 - 0.40 * gap - 0.12 * offset) * (0.45 + 0.55 * tag.quality);
      if (score < 0.49) continue;
      const edge = { i, j, score };
      bySymbol[i].push(edge);
      byTag[j].push(edge);
    }
  }
  const highest = (a, b) => b.score - a.score;
  byTag.forEach(edges => edges.sort(highest));
  return symbols.map((symbol, i) => {
    const edges = bySymbol[i].sort(highest);
    const top = edges[0];
    if (!top) return { ...symbol, tag: null, association: { status: 'unmatched', options: [] } };
    const tag = tags[top.j];
    const competing = byTag[top.j];
    const contested = competing[0].i !== i || (competing[1] && top.score - competing[1].score < 0.13);
    const ambiguous = tag.conflictingReading || contested || (edges[1] && top.score - edges[1].score < 0.13);
    const repeated = occurrences.get(tag.value) > 1;
    const options = edges.slice(0, 5).map(({ j, score }) => ({
      value: tags[j].value, position: tags[j].position, confidence: Math.round(score * 100) / 100,
      source: tags[j].source, conflictingReading: Boolean(tags[j].conflictingReading), repeated: occurrences.get(tags[j].value) > 1
    }));
    // Mutual clear winners implement a one-to-one assignment with abstention.
    const assigned = !repeated && !ambiguous && top.score >= 0.58;
    return {
      ...symbol, tag: assigned ? options[0] : null,
      association: { status: repeated ? 'repeated' : assigned ? 'assigned' : 'ambiguous', options }
    };
  });
}
