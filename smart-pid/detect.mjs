import { associateTags, tagObservations, valveFormats } from './association.mjs';
import { suppressDuplicates } from './suppress.mjs';

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
const angle = (a, b) => (Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + 360) % 180;
const clamp = value => Math.min(1, Math.max(0, value));
const bounds = points => points.reduce((box, p) => ({
  left: Math.min(box.left, p.x), top: Math.min(box.top, p.y),
  right: Math.max(box.right, p.x), bottom: Math.max(box.bottom, p.y)
}), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });

export function extractText(items, viewport) {
  const runs = [];
  for (const item of items) {
    if (!item.transform || !item.str?.trim()) continue;
    const [a, b, , , x, y] = item.transform;
    const length = Math.hypot(a, b) || 1;
    const axis = point(a / length, b / length);
    const start = point(x, y);
    const previous = runs.at(-1);
    const dx = x - (previous?.end.x || 0), dy = y - (previous?.end.y || 0);
    const gap = axis.x * dx + axis.y * dy;
    const joined = previous && !previous.eol && axis.x * previous.axis.x + axis.y * previous.axis.y > 0.99 &&
      Math.abs(axis.x * dy - axis.y * dx) < length * 0.22 &&
      gap >= -length * 0.25 && gap <= length * 0.38;
    const end = point(x + axis.x * item.width, y + axis.y * item.width);
    if (joined) {
      previous.value += (gap > length * 0.15 ? ' ' : '') + item.str;
      previous.end = end;
      previous.eol = item.hasEOL;
    } else {
      runs.push({ value: item.str, start, end, axis, size: length, eol: item.hasEOL });
    }
  }
  return runs.map(run => {
    const center = midpoint(run.start, run.end);
    const [x, y] = viewport.convertToViewportPoint(center.x, center.y);
    const [a, b] = viewport.convertToViewportPoint(run.start.x, run.start.y);
    const [c, d] = viewport.convertToViewportPoint(run.end.x, run.end.y);
    return { value: run.value, position: point(x, y), size: run.size, source: 'native', quality: 1,
      orientation: Math.atan2(d - b, c - a) * 180 / Math.PI };
  });
}

export function vectorCandidates(paths, width, height) {
  const candidates = [];
  const cells = new Map();
  const straight = [];
  const cellSize = Math.max(0.65, Math.min(width, height) / 1700);
  const maxValve = Math.min(width, height) * 0.055;
  const maxEquipment = Math.min(width, height) * 0.2;
  const key = (x, y) => `${x},${y}`;
  const emit = (classification, box, confidence, orientation) => {
    const position = point((box.left + box.right) / 2, (box.top + box.bottom) / 2);
    candidates.push({ classification, box, position, confidence, orientation, source: 'vector' });
  };
  const circular = [];

  for (const path of paths) {
    for (const segment of path) {
      if (segment.length !== 2) continue;
      const [a, b] = segment;
      const length = distance(a, b);
      if (length < cellSize * 2 || length > maxValve) continue;
      straight.push(segment);
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
    const lines = path.filter(segment => segment.length === 2);
    if (curves >= 3 && w / h > 0.82 && w / h < 1.22) {
      circular.push({ box, center, diameter: (w + h) / 2 });
    } else if (curves >= 2 && lines.length === 2 && Math.max(w / h, h / w) >= 1.45) {
      const [first, second] = lines;
      const axis = w > h ? 'x' : 'y';
      const across = w > h ? 'y' : 'x';
      const [a, b] = first;
      const [c, d] = second;
      if (Math.abs(a[across] - b[across]) < cellSize && Math.abs(c[across] - d[across]) < cellSize &&
          Math.abs(a[across] - c[across]) >= Math.min(w, h) * 0.77 &&
          Math.abs(a[axis] - b[axis]) >= Math.max(w, h) * 0.45 &&
          Math.abs(c[axis] - d[axis]) >= Math.max(w, h) * 0.45) {
        emit('vessel', box, 0.77, w > h ? 0 : 90);
      }
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
  for (const circle of circular) {
    // A nearby label cannot turn a circle into a pump. Require an internal impeller.
    const impeller = triangles.find(({ tip, a, b }) => [tip, a, b].every(p =>
      distance(p, circle.center) < circle.diameter * 0.4) &&
      distance(a, b) >= circle.diameter * 0.23 && distance(tip, midpoint(a, b)) >= circle.diameter * 0.23);
    if (impeller) emit('pump', circle.box, 0.83, angle(impeller.middle, impeller.tip));
  }
  const tips = new Map();
  const emitted = new Set();
  for (const triangle of triangles) {
    const { tip, middle } = triangle;
    const x = Math.floor(tip.x / cellSize), y = Math.floor(tip.y / cellSize);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const other of tips.get(key(x + dx, y + dy)) || []) {
          if (distance(tip, other.tip) > cellSize ||
              distance(tip, midpoint(middle, other.middle)) > distance(tip, middle) * 0.24) continue;
          const box = bounds([triangle.a, triangle.b, other.a, other.b]);
          const signature = [box.left, box.top, box.right, box.bottom].join(',');
          if (emitted.has(signature)) continue;
          emitted.add(signature);
          emit('valve', box, 0.87, angle(middle, other.middle));
        }
      }
    }
    const bucket = tips.get(key(x, y)) || [];
    if (bucket.length < 32) bucket.push(triangle);
    tips.set(key(x, y), bucket);
  }
  // CAD often paints the X as two uninterrupted diagonals. Recover the
  // shared center from their intersection and require both closing end caps.
  for (const [a, b] of straight) {
    const base = distance(a, b);
    for (const c of nearby(a)) {
      for (const d of nearby(b)) {
        if (distance(c, b) <= cellSize || distance(d, a) <= cellSize ||
            Math.abs(distance(c, d) - base) > base * 0.23 ||
            !nearby(c).some(p => distance(p, d) <= cellSize)) continue;
        const u = point(c.x - a.x, c.y - a.y), v = point(d.x - b.x, d.y - b.y);
        const cross = u.x * v.y - u.y * v.x;
        if (Math.abs(cross) < base * base * 0.6) continue;
        const t = ((b.x - a.x) * v.y - (b.y - a.y) * v.x) / cross;
        const q = ((b.x - a.x) * u.y - (b.y - a.y) * u.x) / cross;
        if (t < 0.37 || t > 0.63 || q < 0.37 || q > 0.63) continue;
        const start = midpoint(a, b), end = midpoint(c, d);
        const axis = point(end.x - start.x, end.y - start.y);
        const span = Math.hypot(axis.x, axis.y);
        if (span / base < 0.7 || span / base > 3.6 ||
            Math.abs(axis.x * (b.x - a.x) + axis.y * (b.y - a.y)) > span * base * 0.23) continue;
        const box = bounds([a, b, c, d]);
        const signature = [box.left, box.top, box.right, box.bottom].join(',');
        if (emitted.has(signature)) continue;
        emitted.add(signature);
        emit('valve', box, 0.87, angle(start, end));
      }
    }
  }
  return candidates;
}

export function detectionResult(candidates, width, height, method, text = [], formatInput = '', diagnostic = false) {
  const { kept, rejected } = suppressDuplicates(candidates);
  const tags = tagObservations(text, valveFormats(formatInput));
  const normalize = ({ x, y }) => point(clamp(x / width), clamp(y / height));
  const normalizeBox = box => ({
    left: clamp(box.left / width), top: clamp(box.top / height),
    right: clamp(box.right / width), bottom: clamp(box.bottom / height)
  });
  const tagRecord = tag => ({ ...tag, position: normalize(tag.position) });
  const associated = associateTags(kept, tags);
  const components = associated.map(({ classification, position, box, tag, confidence, orientation, source, association }, i) => ({
    id: `p1-${i + 1}`,
    classification,
    position: normalize(position),
    bounds: normalizeBox(box),
    tag: tag ? tagRecord(tag) : null,
    association: { status: association.status, options: association.options.map(tagRecord) },
    confidence,
    orientation,
    detectedClassification: classification,
    detectedPosition: normalize(position),
    source: source || method,
    review: 'pending'
  }));
  const result = { version: 1, page: 1, coordinateSpace: 'normalized-top-left', method, components };
  if (diagnostic) {
    const candidateRecord = candidate => ({
      ...candidate, position: normalize(candidate.position), box: normalizeBox(candidate.box),
      duplicateOf: candidate.duplicateOf && normalize(candidate.duplicateOf)
    });
    result.diagnostics = {
      text: text.map(tagRecord), raw: candidates.map(candidateRecord), rejected: rejected.map(candidateRecord)
    };
  }
  return result;
}

export function mergeScan(previous, result) {
  const reviewed = previous?.components.filter(component => component.review !== 'pending') || [];
  if (!reviewed.length) return result;
  const components = reviewed.slice();
  const ids = new Set(components.map(component => component.id));
  const reviewedTags = new Set(reviewed.filter(component => component.review === 'confirmed' && component.tag)
    .map(component => component.tag.value.toUpperCase().trim()));
  let next = 1;
  for (const component of result.components) {
    const { position, bounds } = component;
    const sameLocation = reviewed.some(old => {
      const anchor = old.detectedPosition || old.position;
      return Math.abs(anchor.x - position.x) < (bounds.right - bounds.left) * 0.45 &&
        Math.abs(anchor.y - position.y) < (bounds.bottom - bounds.top) * 0.45;
    });
    if (sameLocation) continue;
    while (ids.has(`p1-${next}`)) next++;
    if (component.tag && reviewedTags.has(component.tag.value)) {
      component.tag = null;
      component.association.status = 'repeated';
    }
    const id = `p1-${next++}`;
    ids.add(id);
    components.push({ ...component, id });
  }
  return { ...result, method: previous.method === result.method ? result.method : 'mixed', components };
}

export function reviewedResult(result) {
  if (!result?.components.some(component => component.review !== 'pending')) return undefined;
  const { diagnostics, ...saved } = result;
  return { ...saved, components: result.components.filter(component => component.review !== 'pending') };
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
export function rasterCandidates({ data, width, height }, { useValve = true } = {}) {
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
  // At large image sizes, very small outlines are dominated by letters and
  // arrowheads. A drawing sample can still search for those sizes explicitly.
  const minimum = Math.min(width, height) >= 450 ? 10 : 5;
  const scales = [5, 7, 10, 12, 14, 16, 19, 22, 26, 30, 35, 40, 47, 54, 63]
    .filter(r => r >= minimum && r + 3 < Math.min(width, height) / 2);
  const shapes = [];
  for (const ratio of useValve ? [0.48, 0.65] : []) {
    const valve = [[-1, -ratio], [0, 0], [1, -ratio], [1, ratio], [0, 0], [-1, ratio], [-1, -ratio]];
    const strokes = [];
    for (let i = 1; i < valve.length; i++) {
      for (let j = 0; j < 4; j++) {
        const x = (valve[i - 1][0] * (4 - j) + valve[i][0] * j) / 4;
        const y = (valve[i - 1][1] * (4 - j) + valve[i][1] * j) / 4;
        // The center can be a join, a small ball or an actuator stem.
        if (x || y) strokes.push([x, y]);
      }
    }
    const blank = [[-0.35, -ratio], [0.35, ratio]];
    for (const x of [-0.78, -0.56, -0.32, 0.32, 0.56, 0.78]) {
      for (const height of [-0.85, -0.54, -0.26, 0.26, 0.54, 0.85]) {
        if (Math.abs(Math.abs(height) - Math.abs(x)) >= 0.33) blank.push([x, height * ratio]);
      }
    }
    for (const rotate of [false, true]) {
      const orient = points => rotate ? points.map(([x, y]) => [y, x]) : points;
      shapes.push({ classification: 'valve', w: rotate ? ratio : 1, h: rotate ? 1 : ratio,
        orientation: rotate ? 90 : 0, strokes: orient(strokes), blank: orient(blank), radius: 0 });
    }
  }
  const circle = Array.from({ length: 24 }, (_, i) => [Math.cos(i * Math.PI / 12), Math.sin(i * Math.PI / 12)]);
  shapes.push({
    classification: 'pump', w: 1, h: 1, radius: 7,
    strokes: [...circle, [-0.55, 0.3], [-0.25, 0.15], [0.05, 0], [-0.25, -0.15], [-0.55, -0.3], [-0.55, 0]],
    blank: [[0.44, 0], [0, 0.5], [0, -0.5], [0, -0.72], [0, 0.72],
      [0.54, 0.4], [0.54, -0.4], [-0.51, 0.5], [-0.51, -0.5], [0.3, -0.66], [0.3, 0.66]]
  });

  const matches = [];
  for (const r of scales) {
    for (const shape of shapes) {
      if (r < shape.radius) continue;
      const edge = Math.ceil(r * 1.42) + 2;
      for (let y = edge; y < height - edge; y++) {
        for (let x = edge; x < width - edge; x++) {
          if (shape.classification === 'valve') {
            if (!probe(x - shape.w * r, y - shape.h * r) ||
                !probe(x + shape.w * r, y + shape.h * r)) continue;
            if (!probe(x, y)) {
              const offset = Math.max(1, r * 0.17);
              const ring = [probe(x - offset, y), probe(x + offset, y), probe(x, y - offset), probe(x, y + offset)];
              if (ring.filter(Boolean).length < 3) continue;
            }
            const port1 = r * 1.2, port2 = r * 1.4;
            const horizontal = shape.orientation === 0;
            const axial = offset => probe(x + (horizontal ? offset : 0), y + (horizontal ? 0 : offset));
            if (!(axial(port1) && axial(-port1) && (axial(port2) || axial(-port2)))) continue;
          } else {
            if (!probe(x - r, y) || !probe(x + r, y) || !probe(x, y - r) || !probe(x, y + r)) continue;
            const nearPort = r * 1.19, farPort = r * 1.4;
            if (!(probe(x + nearPort, y) && probe(x + farPort, y) ||
                  probe(x - nearPort, y) && probe(x - farPort, y))) continue;
          }
          let filled = 0;
          const maxFilled = shape.classification === 'valve' ? Math.floor(shape.blank.length * 0.11) : 0;
          for (const [dx, dy] of shape.blank) {
            if (ink[Math.round(y + dy * r) * width + Math.round(x + dx * r)]) filled++;
            if (filled > maxFilled) break;
          }
          if (filled > maxFilled) continue;
          if (shape.strokes.some(([dx, dy]) => !probe(x + dx * r, y + dy * r))) continue;
          const position = point(x, y);
          const box = { left: x - r * shape.w, top: y - r * shape.h, right: x + r * shape.w, bottom: y + r * shape.h };
          matches.push({ position, box, classification: shape.classification, source: 'raster',
            confidence: 0.74, orientation: shape.orientation });
        }
      }
    }
  }
  return matches;
}
