const width = box => box.right - box.left;
const height = box => box.bottom - box.top;
const area = box => width(box) * height(box);

export function overlap(a, b) {
  const intersection = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return intersection / (area(a) + area(b) - intersection || 1);
}

function sameSymbol(a, b) {
  const iou = overlap(a.box, b.box);
  const dx = Math.abs(a.position.x - b.position.x);
  const dy = Math.abs(a.position.y - b.position.y);
  const w = Math.min(width(a.box), width(b.box));
  const h = Math.min(height(a.box), height(b.box));
  if (w <= 0 || h <= 0 || dx > w * 0.33 || dy > h * 0.33) return false;
  const angle = a.orientation == null || b.orientation == null ? 0 :
    Math.abs(a.orientation - b.orientation) % 180;
  const aligned = Math.min(angle, 180 - angle) <= 25;
  const similarlySized = w / Math.max(width(a.box), width(b.box)) >= 0.59 &&
    h / Math.max(height(a.box), height(b.box)) >= 0.59;
  // Near-identical boxes may reflect competing classes or orientations.
  const centered = dx < w * 0.12 && dy < h * 0.12;
  const sameClass = a.classification === b.classification;
  const quarterTurn = angle >= 65 && angle <= 115;
  const swapWidths = Math.min(width(a.box), height(b.box)) / Math.max(width(a.box), height(b.box));
  const swapHeights = Math.min(height(a.box), width(b.box)) / Math.max(height(a.box), width(b.box));
  // A multi-port symbol may produce two overlapping, perpendicular patterns.
  const swapped = swapWidths >= 0.72 && swapHeights >= 0.72;
  const sameCenterAcrossScales = centered && swapWidths >= 0.60 && swapHeights >= 0.60 && iou >= 0.20;
  if (sameClass && quarterTurn && (sameCenterAcrossScales || (swapped || similarlySized) && iou >= 0.50)) return true;
  const intersection = iou * (area(a.box) + area(b.box)) / (1 + iou);
  const centeredOverlap = sameClass &&
    intersection / Math.min(area(a.box), area(b.box)) > 0.75 &&
    Math.min(area(a.box), area(b.box)) / Math.max(area(a.box), area(b.box)) > 0.34;
  return iou > 0.74 || (aligned && similarlySized && iou >= 0.43) ||
    (centered && centeredOverlap);
}

export function suppressDuplicates(candidates) {
  const kept = [];
  const rejected = [];
  const bins = new Map();
  const cell = 64;
  const key = (x, y) => `${x},${y}`;
  for (const candidate of [...candidates].sort((a, b) => b.confidence - a.confidence)) {
    const { box, position } = candidate;
    const x = Math.floor(position.x / cell), y = Math.floor(position.y / cell);
    const rx = Math.ceil(width(box) * 0.33 / cell), ry = Math.ceil(height(box) * 0.33 / cell);
    let duplicate;
    for (let row = y - ry; row <= y + ry && !duplicate; row++) {
      for (let col = x - rx; col <= x + rx && !duplicate; col++) {
        duplicate = (bins.get(key(col, row)) || []).find(other => sameSymbol(candidate, other));
      }
    }
    if (duplicate) rejected.push({ ...candidate, duplicateOf: duplicate.position });
    else {
      kept.push(candidate);
      const bucket = bins.get(key(x, y)) || [];
      bucket.push(candidate);
      bins.set(key(x, y), bucket);
    }
  }
  return { kept, rejected };
}
