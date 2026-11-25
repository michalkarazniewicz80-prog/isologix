const dark = (data, i) => data[i + 3] > 127 &&
  data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114 < 150;

function evenlySample(points, count) {
  return points.length <= count ? points : Array.from({ length: count }, (_, i) =>
    points[Math.floor((i + 0.5) * points.length / count)]);
}

export function makeTemplate({ width, height, data }) {
  const foreground = [], background = [];
  const step = Math.max(1, Math.floor(Math.max(width, height) / 64));
  const probe = (x, y) => x >= 0 && y >= 0 && x < width && y < height && dark(data, (y * width + x) * 4);
  for (let y = step; y < height - step; y += step) {
    for (let x = step; x < width - step; x += step) {
      const p = [x / width - 0.5, y / height - 0.5];
      if (probe(x, y)) foreground.push(p);
      else if (!probe(x + step, y) && !probe(x - step, y) &&
               !probe(x, y + step) && !probe(x, y - step)) background.push(p);
    }
  }
  if (foreground.length < 12 || background.length < 12) {
    throw new Error('Select a tight box around a single valve with some white space.');
  }
  // Interleave spatially separated points so wrong matches fail early.
  const samples = evenlySample(foreground, 36);
  const order = [0, 0.72, 0.32, 0.92, 0.48, 0.15];
  const probes = [...new Set(order.map(fraction => samples[Math.floor(samples.length * fraction)]))];
  return { foreground: [...probes, ...samples.filter(p => !probes.includes(p))], background: evenlySample(background, 24) };
}

export function compileTemplates(calibrations, width, height) {
  const templates = [];
  for (const { features, bounds } of calibrations) {
    const w = (bounds.right - bounds.left) * width, h = (bounds.bottom - bounds.top) * height;
    for (const scale of [0.75, 0.87, 1, 1.15, 1.32]) {
      for (let angle = 0; angle < 360; angle += 30) {
        const theta = angle * Math.PI / 180, sin = Math.sin(theta), cos = Math.cos(theta);
        const transform = ([x, y]) => [
          Math.round(scale * (w * x * cos - h * y * sin)),
          Math.round(scale * (w * x * sin + h * y * cos))
        ];
        const foreground = features.foreground.map(transform);
        const background = features.background.map(transform);
        const rw = (Math.abs(w * cos) + Math.abs(h * sin)) * scale / 2;
        const rh = (Math.abs(w * sin) + Math.abs(h * cos)) * scale / 2;
        templates.push({ foreground, background, rw, rh, angle });
      }
    }
  }
  return templates;
}

export function calibratedCandidates({ data, width, height }, templates) {
  if (!templates.length) return [];
  const ink = new Uint8Array(width * height);
  const seeds = [];
  for (let i = 0; i < ink.length; i++) {
    if (dark(data, i * 4)) { ink[i] = 1; seeds.push(i); }
  }
  const near = ink.slice();
  for (const index of seeds) {
    const x = index % width;
    if (x) near[index - 1] = 1;
    if (x + 1 < width) near[index + 1] = 1;
    if (index >= width) near[index - width] = 1;
    if (index + width < near.length) near[index + width] = 1;
  }
  const hits = [];
  for (const template of templates) {
    const { rw, rh, angle, background, foreground } = template;
    const [ax, ay] = foreground[0];
    const foregroundOffsets = foreground.map(([x, y]) => y * width + x);
    const backgroundOffsets = background.map(([x, y]) => y * width + x);
    const missingLimit = Math.floor(foreground.length * 0.09), extraLimit = Math.floor(background.length * 0.18);
    for (const seed of seeds) {
      const x = seed % width - ax, y = Math.floor(seed / width) - ay;
      if (x < rw + 1 || y < rh + 1 || x + rw + 1 >= width || y + rh + 1 >= height) continue;
      const index = y * width + x;
      let missing = 0, extra = 0;
      for (const offset of foregroundOffsets) {
        if (!near[index + offset] && ++missing > missingLimit) break;
      }
      if (missing > missingLimit) continue;
      for (const offset of backgroundOffsets) {
        if (ink[index + offset] && ++extra > extraLimit) break;
      }
      if (extra > extraLimit) continue;
      const confidence = 0.96 - 0.42 * missing / foreground.length - 0.38 * extra / background.length;
      if (confidence < 0.924) continue;
      hits.push({
        classification: 'valve', source: 'calibrated', orientation: angle,
        position: { x, y }, box: { left: x - rw, right: x + rw, top: y - rh, bottom: y + rh },
        confidence
      });
    }
  }
  return hits;
}
