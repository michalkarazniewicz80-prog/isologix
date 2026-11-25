// Coordinates use the displayed page's top-left origin, normalized to [0, 1].
export const classifications = {
  valve: 'Valve',
  pump: 'Pump',
  vessel: 'Vessel',
  instrument: 'Instrument',
  other: 'Other'
};

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const point = (x, y) => ({ x, y });
const clamp = value => Math.min(1, Math.max(0, value));
const bounds = points => points.reduce((box, p) => ({
  left: Math.min(box.left, p.x), top: Math.min(box.top, p.y),
  right: Math.max(box.right, p.x), bottom: Math.max(box.bottom, p.y)
}), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });

function tagClass(tag) {
  const prefix = tag.match(/^[A-Z]+/)?.[0];
  if (/^(?:HV|XV|MOV|SDV|ESDV|[FPLT]CV|VLV|BV|GV)$/.test(prefix)) return 'valve';
  if (/^(?:P|PU|PMP)$/.test(prefix)) return 'pump';
  if (/^(?:V|TK|T|DR|VES)$/.test(prefix)) return 'vessel';
  if (/^[FPLTA][ITGSC][A-Z]?$/.test(prefix)) return 'instrument';
  return null;
}

export function extractTags(items, viewport) {
  const tags = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.transform || !item.str) continue;
    const [a, b, , , x, y] = item.transform;
    const length = Math.hypot(a, b) || 1;
    let str = item.str.trim();
    // CAD exporters can emit the prefix, dash and number in separate text runs.
    if (/^[A-Z]{1,6}-?$/i.test(str)) {
      let run = item;
      for (let j = i + 1; j <= i + 2 && j < items.length; j++) {
        const next = items[j];
        const suffix = next.str?.trim();
        if (!next.transform || !/^-?$|^-?\d{2,6}[A-Z]?$/i.test(suffix || '')) break;
        const dx = next.transform[4] - run.transform[4];
        const dy = next.transform[5] - run.transform[5];
        const gap = (dx * a + dy * b) / length - run.width;
        if (Math.abs((dy * a - dx * b) / length) > length * 0.35 ||
            gap < -length * 0.4 || gap > length * 0.8) break;
        str += suffix;
        run = next;
        if (/\d/.test(suffix)) break;
      }
    }
    for (const match of str.toUpperCase().matchAll(/\b[A-Z]{1,6}[- ]?\d{2,6}[A-Z]?\b/g)) {
      const value = match[0].replace(' ', '-');
      const offset = item.width * (match.index + Math.min(match[0].length, item.str.length) / 2) / str.length;
      const [px, py] = viewport.convertToViewportPoint(x + a * offset / length, y + b * offset / length);
      tags.push({ value, position: point(px, py), classification: tagClass(value) });
    }
  }
  return tags;
}

function nearestTag(position, box, tags, classification) {
  const radius = Math.max(14, Math.hypot(box.right - box.left, box.bottom - box.top) * 2);
  let best = null;
  let bestScore = Infinity;
  for (const tag of tags) {
    if (tag.classification && classification && tag.classification !== classification) continue;
    const gap = distance(position, tag.position);
    const score = gap * (tag.classification ? 1 : 1.35);
    if (gap <= radius && score < bestScore) {
      best = { ...tag, confidence: Math.round((0.88 - 0.53 * gap / radius) * 100) / 100 };
      bestScore = score;
    }
  }
  return best;
}

export function vectorCandidates(paths, tags, width, height) {
  const candidates = [];
  const cells = new Map();
  const cellSize = Math.max(1, Math.min(width, height) / 900);
  const maxValve = Math.min(width, height) * 0.055;
  const maxEquipment = Math.min(width, height) * 0.2;
  const key = (x, y) => `${x},${y}`;
  const emit = (classification, box, confidence, tag) => {
    const position = point((box.left + box.right) / 2, (box.top + box.bottom) / 2);
    candidates.push({ classification, box, position, confidence, tag: tag || nearestTag(position, box, tags, classification) });
  };

  for (const path of paths) {
    for (const segment of path) {
      if (segment.length !== 2) continue;
      const [a, b] = segment;
      const length = distance(a, b);
      if (length < cellSize * 2 || length > maxValve) continue;
      for (const [end, other] of [[a, b], [b, a]]) {
        const x = Math.floor(end.x / cellSize), y = Math.floor(end.y / cellSize);
        const bucket = cells.get(key(x, y)) || [];
        if (bucket.length < 32) bucket.push({ end, other });
        cells.set(key(x, y), bucket);
      }
    }

    const box = bounds(path.flat());
    const w = box.right - box.left, h = box.bottom - box.top;
    if (Math.min(w, h) < cellSize * 3 || Math.max(w, h) > maxEquipment) continue;
    const center = point((box.left + box.right) / 2, (box.top + box.bottom) / 2);
    const first = path[0][0], last = path.at(-1).at(-1);
    if (distance(first, last) > cellSize) continue;
    const curves = path.filter(segment => segment.length === 4).length;
    const tag = nearestTag(center, box, tags);
    if (!tag) continue;
    if (curves >= 3 && w / h > 0.7 && w / h < 1.4 &&
        ['pump', 'instrument'].includes(tag.classification)) {
      emit(tag.classification, box, 0.79, tag);
    } else if (tag.classification === 'vessel' && (path.length === 4 || curves >= 2)) {
      emit('vessel', box, 0.72, tag);
    }
  }

  const nearby = p => {
    const x = Math.floor(p.x / cellSize), y = Math.floor(p.y / cellSize);
    const hits = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const edge of cells.get(key(x + dx, y + dy)) || []) {
          if (distance(edge.end, p) <= cellSize) hits.push(edge.other);
        }
      }
    }
    return hits;
  };
  const triangles = [];
  // Each side of a bow tie is a closed triangle with its tip at the shared center.
  for (const bucket of cells.values()) {
    for (const { end: tip, other: a } of bucket) {
      for (const b of nearby(a)) {
        const base = distance(a, b);
        if (base < 2 * cellSize || !nearby(b).some(p => distance(p, tip) <= cellSize)) continue;
        const middle = midpoint(a, b);
        const depth = distance(tip, middle);
        if (depth / base < 0.35 || depth / base > 1.8 ||
            Math.abs(distance(tip, a) - distance(tip, b)) > base * 0.22) continue;
        triangles.push({ tip, a, b, middle });
      }
    }
  }
  const tips = new Map();
  for (const triangle of triangles) {
    const { tip, middle } = triangle;
    const x = Math.floor(tip.x / cellSize), y = Math.floor(tip.y / cellSize);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const other of tips.get(key(x + dx, y + dy)) || []) {
          if (distance(tip, other.tip) > cellSize ||
              distance(tip, midpoint(middle, other.middle)) > distance(tip, middle) * 0.24) continue;
          emit('valve', bounds([triangle.a, triangle.b, other.a, other.b]), 0.86);
        }
      }
    }
    const bucket = tips.get(key(x, y)) || [];
    if (bucket.length < 32) bucket.push(triangle);
    tips.set(key(x, y), bucket);
  }
  return candidates;
}

export function detectionResult(candidates, width, height, method) {
  const unique = [];
  const bins = new Map();
  for (const candidate of candidates.sort((a, b) => b.confidence - a.confidence)) {
    const { position, box, tag, classification, confidence } = candidate;
    const size = Math.min(box.right - box.left, box.bottom - box.top);
    const binSize = Math.min(width, height) * 0.012;
    const col = Math.floor(position.x / binSize), row = Math.floor(position.y / binSize);
    let duplicate = false;
    for (let y = row - 1; y <= row + 1; y++) {
      for (let x = col - 1; x <= col + 1; x++) {
        duplicate ||= (bins.get(`${x},${y}`) || []).some(item =>
          distance(item.position, position) < Math.min(binSize, Math.max(size, item.size) * 0.55));
      }
    }
    if (duplicate) continue;
    const key = `${col},${row}`;
    const bin = bins.get(key) || [];
    bin.push({ position, size });
    bins.set(key, bin);
    unique.push({
      id: `p1-${unique.length + 1}`,
      classification,
      position: point(clamp(position.x / width), clamp(position.y / height)),
      bounds: {
        left: clamp(box.left / width), top: clamp(box.top / height),
        right: clamp(box.right / width), bottom: clamp(box.bottom / height)
      },
      tag: tag && { value: tag.value, confidence: tag.confidence,
        position: point(clamp(tag.position.x / width), clamp(tag.position.y / height)) },
      confidence,
      detectedClassification: classification,
      detectedPosition: point(clamp(position.x / width), clamp(position.y / height)),
      source: candidate.source || method,
      review: 'pending'
    });
    if (unique.length === 500) break;
  }
  return { version: 1, page: 1, coordinateSpace: 'normalized-top-left', method, components: unique };
}

export function mergeScan(previous, result) {
  if (!previous?.components.length) return result;
  const components = previous.components.slice();
  const ids = new Set(components.map(component => component.id));
  let next = 1;
  for (const component of result.components) {
    if (components.length >= 500) break;
    const { position, bounds } = component;
    const sameLocation = previous.components.some(old => {
      const anchor = old.detectedPosition || old.position;
      return Math.abs(anchor.x - position.x) < (bounds.right - bounds.left) * 0.6 &&
        Math.abs(anchor.y - position.y) < (bounds.bottom - bounds.top) * 0.6;
    });
    if (sameLocation) continue;
    while (ids.has(`p1-${next}`)) next++;
    components.push({ ...component, id: `p1-${next++}` });
  }
  return { ...result, method: previous.method === result.method ? result.method : 'mixed', components };
}

export function reviewedResult(result) {
  if (!result?.components.some(component => component.review !== 'pending')) return undefined;
  return { ...result, components: result.components.filter(component => component.review !== 'pending') };
}

export function moveComponent(component, position) {
  const box = component.bounds;
  const dx = Math.max(-box.left, Math.min(1 - box.right, position.x - component.position.x));
  const dy = Math.max(-box.top, Math.min(1 - box.bottom, position.y - component.position.y));
  component.position = point(component.position.x + dx, component.position.y + dy);
  component.bounds = { left: box.left + dx, top: box.top + dy, right: box.right + dx, bottom: box.bottom + dy };
  component.review = 'pending';
}

// Sample symbol outlines against a small binary image, with one pixel of stroke tolerance.
export function rasterCandidates({ data, width, height }, tags = []) {
  const ink = new Uint8Array(width * height);
  const nearInk = new Uint8Array(ink.length);
  for (let i = 0; i < ink.length; i++) {
    const p = i * 4;
    if (data[p + 3] > 127 && data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114 < 155) ink[i] = 1;
  }
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      nearInk[i] = ink[i] || ink[i - 1] || ink[i + 1] || ink[i - width] || ink[i + width];
    }
  }
  const probe = (x, y) => nearInk[Math.round(y) * width + Math.round(x)];
  const scales = [5, 7, 10, 14, 19, 26].filter(r => r <= Math.min(width, height) * 0.05);
  const shapes = [];
  const valve = [[-1, -0.65], [0, 0], [1, -0.65], [1, 0.65], [0, 0], [-1, 0.65], [-1, -0.65]];
  for (const rotate of [false, true]) {
    const strokes = [];
    for (let i = 1; i < valve.length; i++) {
      for (let j = 0; j < 4; j++) {
        const x = (valve[i - 1][0] * (4 - j) + valve[i][0] * j) / 4;
        const y = (valve[i - 1][1] * (4 - j) + valve[i][1] * j) / 4;
        strokes.push(rotate ? [y, x] : [x, y]);
      }
    }
    const blank = [[0, -0.65], [0, 0.65], [-0.35, -0.65], [0.35, 0.65]];
    shapes.push({ classification: 'valve', w: rotate ? 0.65 : 1, h: rotate ? 1 : 0.65,
      strokes, blank: rotate ? blank.map(([x, y]) => [y, x]) : blank, radius: 0 });
  }
  const circle = Array.from({ length: 24 }, (_, i) => [Math.cos(i * Math.PI / 12), Math.sin(i * Math.PI / 12)]);
  shapes.push({
    classification: 'pump', w: 1, h: 1, radius: 7,
    strokes: [...circle, [-0.55, 0.3], [-0.25, 0.15], [0.05, 0], [-0.25, -0.15], [-0.55, -0.3], [-0.55, 0]],
    blank: [[0.44, 0], [0, 0.5], [0, -0.5], [0, -0.72], [0, 0.72]]
  });

  const matches = [];
  for (const r of scales) {
    for (const shape of shapes) {
      if (r < shape.radius) continue;
      const edge = r + 2;
      for (let y = edge; y < height - edge; y++) {
        for (let x = edge; x < width - edge; x++) {
          if (shape.classification === 'valve') {
            if (!probe(x, y) || !probe(x - shape.w * r, y - shape.h * r) ||
                !probe(x + shape.w * r, y + shape.h * r)) continue;
          } else if (!probe(x - r, y) || !probe(x + r, y) || !probe(x, y - r) || !probe(x, y + r)) {
            continue;
          }
          let filled = 0;
          for (const [dx, dy] of shape.blank) {
            if (probe(x + dx * r, y + dy * r)) filled++;
            if (filled > 1) break;
          }
          if (filled > 1) continue;
          let hits = 0;
          let misses = 0;
          const allowedMisses = shape.classification === 'pump' ? 3 : 2;
          for (const [dx, dy] of shape.strokes) {
            if (probe(x + dx * r, y + dy * r)) hits++;
            else if (++misses > allowedMisses) break;
          }
          if (misses > allowedMisses) continue;
          const position = point(x, y);
          const box = { left: x - r * shape.w, top: y - r * shape.h, right: x + r * shape.w, bottom: y + r * shape.h };
          matches.push({ position, box, classification: shape.classification, source: 'raster',
            confidence: 0.4 + 0.25 * hits / shape.strokes.length, tag: nearestTag(position, box, tags, shape.classification) });
        }
      }
    }
  }
  return matches;
}
