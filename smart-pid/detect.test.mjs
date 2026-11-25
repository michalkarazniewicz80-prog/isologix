import test from 'node:test';
import assert from 'node:assert/strict';
import { detectionResult, extractText, mergeScan, moveComponent, rasterCandidates, reviewedResult, vectorCandidates } from './detect.mjs';
import { detectPdf, extractPaths, openPdf } from './pdf.mjs';

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

test('native paths resolve transforms, avoid tag-driven classes and join split text runs', () => {
  const paths = extractPaths(nativeFixture(), ops, viewport);
  assert.equal(paths.length, 3);
  assert.deepEqual(paths[0][0], [{ x: 100, y: 200 }, { x: 105, y: 208 }]);
  const observations = extractText([text('HV', 106, 100, 8), text('-', 114, 100, 3), text('101', 117, 100, 12),
    text('V-205', 218, 105, 19), text('P-999', 89, 100, 11)], viewport);
  const result = detectionResult(vectorCandidates(paths, 400, 300), 400, 300, 'vector', observations);
  assert.deepEqual(result.components.map(item => [item.classification, item.tag.value]), [['valve', 'HV-101']]);
  assert.deepEqual(result.components[0].position, { x: 0.25, y: 2 / 3 });
  assert.deepEqual(result.components[0].bounds, { left: 95 / 400, top: 192 / 300, right: 105 / 400, bottom: 208 / 300 });
});

test('recognizes unsplit CAD bow ties and requires an impeller for a pump', () => {
  const at = (x, y) => ({ x, y });
  const a = at(93, 96), b = at(93, 104), c = at(107, 96), d = at(107, 104);
  const paths = [[[a, b]], [[a, d]], [[b, c]], [[c, d]]];
  assert.deepEqual(vectorCandidates(paths, 400, 300).map(c => c.classification), ['valve']);
  const operators = operatorList([
    [ops.constructPath, [[ops.moveTo, ops.curveTo, ops.curveTo, ops.curveTo, ops.curveTo],
      [110, 100, 110, 105, 105, 110, 100, 110, 95, 110, 90, 105, 90, 100,
        90, 95, 95, 90, 100, 90, 105, 90, 110, 95, 110, 100]]], [ops.stroke]
  ]);
  const circle = extractPaths(operators, ops, viewport);
  assert.equal(vectorCandidates(circle, 400, 300).length, 0);
  const p = at(96, 197), q = at(96, 203), r = at(103, 200);
  assert.deepEqual(vectorCandidates([...circle, [[p, q], [q, r], [r, p]]], 400, 300)
    .map(c => c.classification), ['pump']);
});

test('PDF adapter keeps geometry when text is unavailable and closes a failed document', async () => {
  let destroyed = 0;
  let fail = false;
  const pdfjs = { OPS: ops, getDocument: options => {
    assert.equal(options.isEvalSupported, false);
    return { promise: Promise.resolve({ getPage: async page => {
      assert.equal(page, 1);
      if (fail) throw new Error('page unavailable');
      return { getViewport: () => viewport, getOperatorList: async () => nativeFixture(),
        getTextContent: async () => { throw new Error('text unavailable'); } };
    } }), destroy: async () => destroyed++ };
  } };
  const file = { arrayBuffer: async () => new ArrayBuffer(0) };
  const pdf = await openPdf(pdfjs, file);
  const result = await detectPdf(pdf.page, ops);
  assert.ok(result.candidates.length);
  assert.deepEqual(result.text, []);
  await pdf.close();
  fail = true;
  await assert.rejects(openPdf(pdfjs, file), /page unavailable/);
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
    line([55, 80], [70, 80]);
    line([90, 80], [105, 80]);
    line([140, 96], [140, 110]);
    line([140, 130], [140, 145]);
    outline(Array.from({ length: 36 }, (_, i) => [220 + 10 * Math.cos(i * Math.PI / 18), 155 + 10 * Math.sin(i * Math.PI / 18)]));
    outline([[214.5, 152], [220.5, 155], [214.5, 158]]);
    line([230, 155], [249, 155]);
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
  assert.ok(result.components.every(item => item.position.y * height < 175 && item.tag === null && item.confidence < 0.8));
});

test('drafts save reviewed decisions and exclude diagnostics', () => {
  const candidates = vectorCandidates(extractPaths(nativeFixture(), ops, viewport), 400, 300);
  const result = detectionResult(candidates, 400, 300, 'vector', [], '', true);
  assert.equal(reviewedResult(undefined), undefined);
  assert.equal(reviewedResult(result), undefined);
  const [valve] = result.components;
  valve.review = 'confirmed';
  assert.deepEqual(reviewedResult(result).components, [valve]);
  assert.equal(reviewedResult(result).diagnostics, undefined);
  const original = valve.position;
  moveComponent(valve, { x: 1.5, y: -1 });
  assert.equal(valve.review, 'pending');
  assert.equal(valve.bounds.right, 1);
  assert.equal(valve.bounds.top, 0);
  assert.deepEqual(valve.detectedPosition, original);
  valve.review = 'rejected';
  const newScan = detectionResult(candidates, 400, 300, 'raster');
  const saved = JSON.parse(JSON.stringify(reviewedResult(result)));
  const merged = mergeScan(saved, newScan);
  assert.equal(merged.method, 'mixed');
  assert.deepEqual(merged.components, [valve]);
});

test('recognizes PV602 as a valve tag with the default formats', () => {
  const candidates = vectorCandidates(extractPaths(nativeFixture(), ops, viewport), 400, 300);
  for (const label of ['PV602', 'PV-602', 'PV 602']) {
    const observations = extractText([
      text(label, 103, 100, 20),
      text('PT602', 88, 109, 18),
      text('50-PV602-A', 82, 83, 26)
    ], viewport);
    const [valve] = detectionResult(candidates, 400, 300, 'vector', observations).components;
    assert.equal(valve.tag?.value, label);
    assert.equal(valve.association.status, 'assigned');
    assert.deepEqual(valve.association.options.map(option => option.value), [label]);
  }
});
