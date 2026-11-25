// Drafters sometimes plot tag letters as outlines inside dashed callouts.
// Reconstruct circular callouts from their short polyline fragments for OCR.
export function circularTextRegions(paths, pageWidth, pageHeight) {
  const hypotheses = [];
  const grid = new Map();
  const max = Math.min(pageWidth, pageHeight) * 0.038;
  const cell = 32;
  const key = (x, y) => `${x},${y}`;
  for (const path of paths) {
    if (path.length < 3 || path.length > 24 || path.some(segment => segment.length !== 2)) continue;
    const a = path[0][0], b = path[Math.floor(path.length / 2)][0], c = path.at(-1)[1];
    const bx = b.x - a.x, by = b.y - a.y, cx = c.x - a.x, cy = c.y - a.y;
    const determinant = 2 * (bx * cy - by * cx);
    if (Math.abs(determinant) < 1) continue;
    const bb = bx * bx + by * by, cc = cx * cx + cy * cy;
    const x = a.x + (bb * cy - cc * by) / determinant;
    const y = a.y + (bx * cc - cx * bb) / determinant;
    const radius = Math.hypot(x - a.x, y - a.y);
    if (radius < 5 || radius > max) continue;
    if (path.some(([, p]) => Math.abs(Math.hypot(p.x - x, p.y - y) - radius) > radius * 0.045)) continue;
    hypotheses.push({ x, y, radius });
    for (const [p, q] of path) {
      for (const point of [p, q, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }]) {
        const address = key(Math.floor(point.x / cell), Math.floor(point.y / cell));
        const bucket = grid.get(address) || [];
        bucket.push(point);
        grid.set(address, bucket);
      }
    }
  }
  const supported = [];
  for (const circle of hypotheses) {
    const { x, y, radius } = circle;
    const sectors = new Set();
    const tolerance = Math.max(0.8, radius * 0.062);
    const reach = radius + tolerance;
    for (let row = Math.floor((y - reach) / cell); row <= Math.floor((y + reach) / cell); row++) {
      for (let col = Math.floor((x - reach) / cell); col <= Math.floor((x + reach) / cell); col++) {
        for (const p of grid.get(key(col, row)) || []) {
          const dx = p.x - x, dy = p.y - y;
          if (Math.abs(Math.hypot(dx, dy) - radius) > tolerance) continue;
          sectors.add(Math.floor((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 12)) % 24);
        }
      }
    }
    if (sectors.size >= 17) supported.push({ ...circle, support: sectors.size });
  }
  const regions = [];
  for (const circle of supported.sort((a, b) => b.support - a.support)) {
    if (!regions.some(region => Math.hypot(circle.x - region.x, circle.y - region.y) < circle.radius * 0.25)) {
      regions.push(circle);
    }
  }
  return regions;
}
