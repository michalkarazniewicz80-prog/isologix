import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const fixtures = JSON.parse(await readFile(new URL('./fixtures.json', import.meta.url)));
const directory = process.argv[2];
if (!directory) throw new Error('Usage: node smart-pid/benchmark/score.mjs RESULTS_DIRECTORY');

function measure({ components }, fixture) {
  const predictions = components.filter(component => component.classification === 'valve');
  const matched = new Set();
  let duplicates = 0, assigned = 0, correct = 0;
  const radius = fixture.width * 0.005;
  for (const prediction of [...predictions].sort((a, b) => b.confidence - a.confidence)) {
    if (prediction.tag) assigned++;
    const x = prediction.position.x * fixture.width, y = prediction.position.y * fixture.height;
    const nearby = fixture.valves.map(([vx, vy], index) => ({ index, gap: Math.hypot(vx - x, vy - y) }))
      .filter(({ gap }) => gap <= radius).sort((a, b) => a.gap - b.gap);
    const match = nearby.find(({ index }) => !matched.has(index));
    if (!match) {
      if (nearby.length) duplicates++;
      continue;
    }
    matched.add(match.index);
    if (prediction.tag && prediction.tag.value === fixture.valves[match.index][2]) correct++;
  }
  return {
    predictions: predictions.length, truth: fixture.valves.length, matches: matched.size,
    duplicates, assigned, correct, eligible: fixture.valves.filter(([, , tag]) => tag).length
  };
}

const ratio = (n, d) => d ? `${(100 * n / d).toFixed(1)}% (${n}/${d})` : 'N/A (no assignments or predictions)';
const rows = [];
for (const fixture of fixtures) {
  const results = JSON.parse(await readFile(join(directory, fixture.id + '-results.json')));
  for (const [mode, result] of Object.entries(results)) {
    const m = measure(result, fixture);
    rows.push({ sheet: fixture.id, mode, precision: ratio(m.matches, m.predictions), recall: ratio(m.matches, m.truth),
      duplicateRate: ratio(m.duplicates, m.predictions), tagAccuracy: ratio(m.correct, m.assigned),
      taggedRecall: ratio(m.correct, m.eligible), raw: result.diagnostics?.raw.length });
  }
}
console.table(rows);
