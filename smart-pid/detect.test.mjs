import test from 'node:test';
import assert from 'node:assert/strict';
import { detectionResult, extractTags, mergeScan, moveComponent, rasterCandidates, reviewedResult, vectorCandidates } from './detect.mjs';
import { detectPdf, extractPaths } from './pdf.mjs';

const ops = Object.fromEntries('save restore transform paintFormXObjectBegin paintFormXObjectEnd constructPath moveTo lineTo rectangle closePath curveTo curveTo2 curveTo3 stroke closeStroke fill eoFill fillStroke eoFillStroke closeFillStroke closeEOFillStroke endPath'.split(' ').map((op, i) => [op, i + 1]));
const viewport = { width: 400, height: 300, convertToViewportPoint: (x, y) => [x, 300 - y] };

function operatorList(entries) {
  return { fnArray: entries.map(([op]) => op), argsArray: entries.map(([, args]) => args) };
}

const triangle = [ops.moveTo, ops.lineTo, ops.lineTo, ops.closePath];
function nativeFixture() {
  return operatorList([
    [ops.paintFormXObjectBegin, [[0, 1, -1, 0, 100, 100]]],
    [ops.constructPath, [triangle, [0, 0, -8, -5, -8, 5]]], [ops.stroke],
    [ops.constructPath, [triangle, [0, 0, 8, -5, 8, 5]]], [ops.stroke],
    [ops.paintFormXObjectEnd],
    [ops.constructPath, [[ops.rectangle], [190, 90, 24, 36]]], [ops.stroke],
    [ops.constructPath, [[ops.rectangle], [275, 90, 22, 36]]], [ops.endPath]
  ]);
}

const text = (str, x, y, width) => ({ str, width, transform: [6, 0, 0, 6, x, y] });

test('native paths resolve transforms, ignore clipping-only paths and pair split tags', () => {
  const paths = extractPaths(nativeFixture(), ops, viewport);
  assert.equal(paths.length, 3);
  assert.deepEqual(paths[0][0], [{ x: 100, y: 200 }, { x: 105, y: 208 }]);
  const tags = extractTags([text('HV', 111, 100, 8), text('-', 119, 100, 3), text('101', 122, 100, 12),
    text('V-205', 218, 105, 19), text('P-999', 89, 100, 11)], viewport);
  const result = detectionResult(vectorCandidates(paths, tags, 400, 300), 400, 300, 'vector');
  assert.deepEqual(result.components.map(item => [item.classification, item.tag.value]),
    [['valve', 'HV-101'], ['vessel', 'V-205']]);
  assert.deepEqual(result.components[0].position, { x: 0.25, y: 2 / 3 });
  assert.deepEqual(result.components[0].bounds, { left: 95 / 400, top: 192 / 300, right: 105 / 400, bottom: 208 / 300 });
});

test('closed circular vector paths use nearby equipment tags for classification', () => {
  const operators = operatorList([
    [ops.constructPath, [[ops.moveTo, ops.curveTo, ops.curveTo, ops.curveTo, ops.curveTo],
      [110, 100, 110, 105, 105, 110, 100, 110, 95, 110, 90, 105, 90, 100,
        90, 95, 95, 90, 100, 90, 105, 90, 110, 95, 110, 100]]],
    [ops.stroke]
  ]);
  const paths = extractPaths(operators, ops, viewport);
  assert.equal(vectorCandidates(paths, [], 400, 300).length, 0);
  for (const [tag, expected] of [['P-101', 'pump'], ['PI-101', 'instrument']]) {
    const tags = extractTags([text(tag, 113, 99, 16)], viewport);
    assert.equal(vectorCandidates(paths, tags, 400, 300)[0].classification, expected);
  }
});

test('PDF adapter extracts page one and releases PDF.js resources on success and failure', async () => {
  let destroyed = 0;
  let fail = false;
  const pdfjs = { ops, OPS: ops, getDocument: options => {
    assert.equal(options.isEvalSupported, false);
    return { promise: Promise.resolve({ getPage: async page => {
      assert.equal(page, 1);
      return { getViewport: () => viewport, getOperatorList: async () => nativeFixture(),
        getTextContent: async () => {
          if (fail) throw new Error('text unavailable');
          return { items: [] };
        } };
    } }), destroy: async () => destroyed++ };
  } };
  const file = { arrayBuffer: async () => new ArrayBuffer(0) };
  assert.ok((await detectPdf(pdfjs, file)).candidates.length);
  fail = true;
  await assert.rejects(detectPdf(pdfjs, file), /text unavailable/);
  assert.equal(destroyed, 2);
});

function rasterFixture() {
  const width = 330, height = 250;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const line = ([x1, y1], [x2, y2]) => {
    const length = Math.ceil(Math.hypot(x2 - x1, y2 - y1)) * 2;
    for (let i = 0; i <= length; i++) {
      const x = Math.round(x1 + (x2 - x1) * i / length);
      const y = Math.round(y1 + (y2 - y1) * i / length);
      const p = (y * width + x) * 4;
      data.fill(0, p, p + 3);
    }
  };
  const outline = points => points.forEach((p, i) => line(p, points[(i + 1) % points.length]));
  const valve = [[-10, -6.5], [0, 0], [10, -6.5], [10, 6.5], [0, 0], [-10, 6.5]];
  return { image: { width, height, data }, draw() {
    outline(valve.map(([x, y]) => [x + 80, y + 80]));
    outline(valve.map(([x, y]) => [y + 140, x + 120]));
    outline(Array.from({ length: 36 }, (_, i) => [220 + 10 * Math.cos(i * Math.PI / 18), 155 + 10 * Math.sin(i * Math.PI / 18)]));
    outline([[214.5, 152], [220.5, 155], [214.5, 158]]);
    line([30, 190], [290, 190]);
    line([120, 170], [120, 215]);
  } };
}

test('raster fallback detects both valve orientations and a pump, and rejects plain pipe crossings', () => {
  const { image, draw } = rasterFixture();
  assert.deepEqual(rasterCandidates(image), []);
  draw();
  const { width, height } = image;
  const result = detectionResult(rasterCandidates(image), width, height, 'raster');
  for (const [classification, x, y] of [['valve', 80, 80], ['valve', 140, 120], ['pump', 220, 155]]) {
    assert.ok(result.components.some(item => item.classification === classification && item.source === 'raster' &&
      Math.hypot(item.position.x * width - x, item.position.y * height - y) <= 2), classification + ' at ' + x);
  }
  assert.ok(result.components.every(item => item.position.y * height < 175 && item.tag === null && item.confidence < 0.7));
});

test('drafts save decisions, reposition within page bounds and retain reviews across scans', () => {
  const result = detectionResult(vectorCandidates(extractPaths(nativeFixture(), ops, viewport),
    extractTags([text('V-205', 218, 105, 19)], viewport), 400, 300), 400, 300, 'vector');
  assert.equal(reviewedResult(undefined), undefined);
  assert.equal(reviewedResult(result), undefined);
  const [valve, vessel] = result.components;
  valve.review = 'confirmed';
  assert.deepEqual(reviewedResult(result).components, [valve]);
  const original = valve.position;
  moveComponent(valve, { x: 1.5, y: -1 });
  assert.equal(valve.review, 'pending');
  assert.equal(valve.bounds.right, 1);
  assert.equal(valve.bounds.top, 0);
  assert.deepEqual(valve.detectedPosition, original);
  valve.review = 'rejected';
  const newScan = structuredClone(result);
  newScan.method = 'raster';
  newScan.components[0].position = original;
  newScan.components[0].bounds = { left: original.x - 0.01, right: original.x + 0.01, top: original.y - 0.01, bottom: original.y + 0.01 };
  const saved = JSON.parse(JSON.stringify(reviewedResult(result)));
  const merged = mergeScan(saved, newScan);
  assert.equal(merged.method, 'mixed');
  assert.deepEqual(merged.components, [valve, vessel]);
});
