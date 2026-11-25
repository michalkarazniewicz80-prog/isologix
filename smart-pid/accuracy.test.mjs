import test from 'node:test';
import assert from 'node:assert/strict';
import { associateTags, tagObservations, valveFormats } from './association.mjs';
import { suppressDuplicates } from './suppress.mjs';
import { makeTemplate, compileTemplates, calibratedCandidates } from './calibration.mjs';
import { drawingTiles, pageCandidate } from './tiles.mjs';
import { wordPosition } from './ocr.mjs';

const symbol = (x, y, w = 20, h = 14, orientation = 0) => ({
  classification: 'valve', confidence: 0.9, orientation,
  position: { x, y }, box: { left: x - w / 2, top: y - h / 2, right: x + w / 2, bottom: y + h / 2 }
});
const text = (value, x, y, quality = 1) => ({ value, position: { x, y }, size: 8, quality, source: 'ocr' });

test('site masks accept exact tags and stacked labels while excluding piping, dimensions and instrument references', () => {
  const tags = tagObservations([
    text('HV-M023A', 10, 10), text('600-TRW-0023', 50, 50), text('600-HV-M023A', 60, 30),
    text('20-D', 20, 40), text('PI-101', 35, 40), text('HV-M023A / 500', 75, 40),
    text('X231', 75, 50), text('XV', 75, 60)
  ], valveFormats('HV-M###@, X### XV'));
  assert.deepEqual(tags.map(({ value, classification }) => [value, classification]),
    [['HV-M023A', 'valve'], ['PI-101', 'instrument'], ['X231 XV', 'valve']]);
  assert.throws(() => valveFormats('HV-.*'), /prefixes or masks/);
});

test('one-to-one association abstains for competition, repeated references and distant text', () => {
  const symbols = [symbol(30, 30), symbol(70, 30), symbol(130, 30), symbol(190, 30), symbol(300, 30), symbol(360, 30)];
  const tags = tagObservations([
    text('HV-100', 50, 30), text('HV-101', 130, 45), text('HV-101', 600, 45),
    text('PI-101', 190, 45), text('HV-102', 300, 45, 0.92), text('HV-102', 301, 46, 0.85),
    text('HV-103', 360, 45), text('HV-104', 360, 15)
  ], valveFormats());
  const paired = associateTags(symbols, tags);
  assert.deepEqual(paired.map(s => s.association.status),
    ['ambiguous', 'ambiguous', 'repeated', 'unmatched', 'assigned', 'ambiguous']);
  assert.deepEqual(paired.filter(s => s.tag).map(s => s.tag.value), ['HV-102']);
});

test('suppression uses overlap, distance, size and orientation and retains nearby distinct valves', () => {
  const a = symbol(64, 63);
  const b = symbol(65, 64, 21, 14, 7);
  const c = symbol(77, 63);
  const different = symbol(64, 63, 7, 7, 90);
  const quarterTurn = symbol(64, 63, 9, 13, 90);
  const offsetBox = symbol(168.6, 102.7, 21, 27, 90);
  const biggerBox = symbol(163, 100, 28, 31, 0);
  const result = suppressDuplicates([a, b, c, different, quarterTurn, biggerBox, offsetBox]);
  assert.deepEqual(result.kept, [a, c, different, biggerBox]);
  assert.deepEqual(result.rejected.map(item => item.duplicateOf), [a.position, a.position, biggerBox.position]);
});

test('tiling preserves source resolution, overlap and page coordinate mapping', () => {
  const tiles = [...drawingTiles(1700, 1300, 160, 1024)];
  assert.deepEqual(tiles.at(-1), { x: 676, y: 276, width: 1024, height: 1024 });
  assert.deepEqual(pageCandidate(symbol(13, 19), tiles.at(-1)).position, { x: 689, y: 295 });
});

test('OCR maps both rotations into the original tile', () => {
  const box = { x0: 25, x1: 35, y0: 15, y1: 25 };
  const tile = { x: 100, y: 200, width: 80, height: 60 };
  assert.deepEqual(wordPosition(box, tile, 90), { x: 120, y: 230 });
  assert.deepEqual(wordPosition(box, tile, -90), { x: 160, y: 230 });
});

test('drawing-specific samples find the same shape rotated and scaled', () => {
  const canvas = (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) });
  function draw(image, cx, cy, scale, rotate) {
    const feature = [[-12, -7], [0, 0], [12, -7], [12, 7], [0, 0], [-12, 7], [-12, -7], [-12, -11], [-7, -11]];
    for (let i = 1; i < feature.length; i++) {
      const [ax, ay] = feature[i - 1], [bx, by] = feature[i];
      for (let step = 0; step <= 60; step++) {
        const x = scale * (ax + (bx - ax) * step / 60), y = scale * (ay + (by - ay) * step / 60);
        const offset = 4 * ((cy + Math.round(rotate ? x : y)) * image.width + cx + Math.round(rotate ? -y : x));
        image.data.fill(0, offset, offset + 3);
      }
    }
  }
  const sample = canvas(32, 28);
  draw(sample, 16, 14, 1, false);
  const features = makeTemplate(sample);
  const image = canvas(150, 120);
  draw(image, 80, 60, 1.15, true);
  const templates = compileTemplates([{ features, bounds: { left: 0, top: 0, right: 32 / 150, bottom: 28 / 120 } }], 150, 120);
  const found = calibratedCandidates(image, templates);
  assert.ok(found.some(hit => hit.orientation === 90 && Math.hypot(hit.position.x - 80, hit.position.y - 60) <= 2));
});

test('conflicting OCR digits at the same printed tag require review', () => {
  const tags = tagObservations([
    text('PV602', 30, 42, 0.99), text('PV620', 31, 43, 0.74)
  ], valveFormats());
  const [valve] = associateTags([symbol(30, 30)], tags);
  assert.equal(valve.tag, null);
  assert.equal(valve.association.status, 'ambiguous');
  assert.deepEqual(valve.association.options.map(option => option.value), ['PV602', 'PV620']);
  assert.ok(valve.association.options.every(option => option.conflictingReading));
});

test('automatic formats recognize common site tags without a custom mask', () => {
  const inputs = ['HV-M023A', 'X-CV-310', 'X233 XV', '01-XV-0602', 'HV-04-002', 'PV602', 'PT602', 'DN200', '600-TRW-0023'];
  const observations = inputs.map((value, i) => text(value, 200 * i, 20));
  const expected = inputs.slice(0, 6);
  for (const optionalFormat of ['', 'MYV-###']) {
    assert.deepEqual(tagObservations(observations, valveFormats(optionalFormat))
      .filter(tag => tag.classification === 'valve').map(tag => tag.value), expected);
  }
});

test('plotting uses only a unique recognized tag at the clicked point', async () => {
  const { tagAtPoint } = await import('./review.mjs');
  const bounds = { left: 0.4, top: 0.4, right: 0.6, bottom: 0.6 };
  const item = { bounds, review: 'pending', tag: { value: 'PV602' } };
  const point = { x: 0.5, y: 0.5 }, padding = { x: 0.01, y: 0.01 };
  assert.equal(tagAtPoint([item], point, padding), 'PV602');
  assert.equal(tagAtPoint([item, { ...item, tag: null }], point, padding), '');
  assert.equal(tagAtPoint([{ ...item, review: 'rejected' }], point, padding), '');
  assert.equal(tagAtPoint([item], { x: 0.8, y: 0.5 }, padding), '');
});

test('PaddleOCR discards tags cut off at an internal tile edge', async () => {
  const { readPaddleTile } = await import('./paddle.mjs');
  const page = { width: 7152, height: 5052 };
  const tile = { x: 0, y: 2860, width: 1024, height: 1024 };
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => ({
    getContext: () => ({ translate() {}, rotate() {}, drawImage() {} })
  }) };
  try {
    const ocr = { predict: async canvas => [{ items: canvas === tile ? [
      { poly: [[975, 74], [1024, 74], [1024, 106], [975, 106]], text: 'X23', score: 0.99 },
      { poly: [[300, 74], [360, 74], [360, 106], [300, 106]], text: 'PV602', score: 0.99 }
    ] : [] }] };
    assert.deepEqual((await readPaddleTile(ocr, tile, tile, [], page)).map(item => item.value), ['PV602']);
    assert.deepEqual((await readPaddleTile(ocr, tile, { ...tile, x: 6128 }, [], page))
      .map(item => item.value), ['X23', 'PV602']);
  } finally {
    globalThis.document = originalDocument;
  }
});
