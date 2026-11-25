import { detectionResult } from './detect.mjs';
import { detectPdf, openPdf } from './pdf.mjs';
import { compileTemplates, makeTemplate } from './calibration.mjs';
import { openOcr, recognizeTile } from './ocr.mjs';
import { drawingTiles, pageCandidate } from './tiles.mjs';
import { associateTags, tagObservations, valveFormats } from './association.mjs';
import { suppressDuplicates } from './suppress.mjs';

function canvasFor(tile) {
  const canvas = document.createElement('canvas');
  canvas.width = tile.width;
  canvas.height = tile.height;
  return canvas;
}

function imageTile(image, tile) {
  const canvas = canvasFor(tile);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = 'white';
  context.fillRect(0, 0, tile.width, tile.height);
  context.drawImage(image, -tile.x, -tile.y);
  return canvas;
}

async function pdfTile(page, viewport, tile) {
  const canvas = canvasFor(tile);
  await page.render({
    canvasContext: canvas.getContext('2d', { willReadFrequently: true }), viewport,
    transform: [1, 0, 0, 1, -tile.x, -tile.y], background: 'white'
  }).promise;
  return canvas;
}

const pixels = canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);

function runTile(worker, image, templates, generic, useValve) {
  return new Promise((resolve, reject) => {
    worker.onmessage = event => resolve(event.data);
    worker.onerror = () => reject(new Error('Raster detection failed'));
    worker.onmessageerror = () => reject(new Error('Raster detection returned invalid data'));
    worker.postMessage({ image, templates, generic, useValve }, [image.data.buffer]);
  });
}

export async function scanDrawing({ pdfjs, file, image, settings = {}, diagnostic = false, textCache = {}, onProgress = () => {} }) {
  const formats = valveFormats(settings.formats);
  let pdf, native, worker, ocr;
  let ocrFailed = false;
  try {
    if (file && pdfjs) {
      try {
        pdf = await openPdf(pdfjs, file);
        native = await detectPdf(pdf.page, pdfjs.OPS);
      } catch (error) {
        console.warn('Smart Detection could not extract PDF vectors or text', error);
      }
    }

    const calibration = settings.calibration || [];
    const hasNative = native?.candidates.length > 0;
    const needsRaster = !hasNative || calibration.length > 0;
    const needsOcr = !native?.text.some(item => /[A-Z0-9]/i.test(item.value));
    const viewport = pdf?.page.getViewport({ scale: 3 });
    const width = Math.ceil(viewport?.width || image.naturalWidth);
    const height = Math.ceil(viewport?.height || image.naturalHeight);
    const sx = width / (native?.width || width), sy = height / (native?.height || height);
    const scalePoint = ({ x, y }) => ({ x: x * sx, y: y * sy });
    const candidates = (native?.candidates || []).map(candidate => ({
        ...candidate, position: scalePoint(candidate.position),
        box: { left: candidate.box.left * sx, right: candidate.box.right * sx,
          top: candidate.box.top * sy, bottom: candidate.box.bottom * sy }
      }));
    const cachedOcr = needsOcr && textCache.width === width && textCache.height === height;
    const text = cachedOcr ? textCache.text.slice() : (native?.text || []).map(item => ({ ...item, position: scalePoint(item.position), size: item.size * sx }));
    const readTile = tile => pdf ? pdfTile(pdf.page, viewport, tile) : imageTile(image, tile);
    let method = 'vector';
    const failOcr = async error => {
      ocrFailed = true;
      console.warn('Smart Detection OCR is unavailable or incomplete', error);
      const failedWorker = ocr;
      ocr = undefined;
      await Promise.allSettled([failedWorker?.terminate()]);
    };
    const ensureOcr = async () => {
      if (ocr || ocrFailed) return;
      onProgress('Loading local OCR…');
      try { ocr = await openOcr(); }
      catch (error) { await failOcr(error); }
    };
    if (needsRaster || (needsOcr && !cachedOcr)) {
      const samples = [];
      for (const bounds of calibration) {
        const tile = { x: Math.floor(bounds.left * width), y: Math.floor(bounds.top * height),
          width: Math.ceil((bounds.right - bounds.left) * width), height: Math.ceil((bounds.bottom - bounds.top) * height) };
        samples.push({ bounds, features: makeTemplate(pixels(await readTile(tile))) });
      }
      const templates = compileTemplates(samples, width, height);
      const overlap = Math.max(160, ...templates.map(template => 2 * Math.max(template.rw, template.rh) + 12));
      if (needsRaster) {
        worker = new Worker(new URL('./raster-worker.mjs', import.meta.url), { type: 'module' });
        method = hasNative ? 'mixed' : templates.length ? 'calibrated' : 'raster';
      }
      if (needsOcr && !cachedOcr) await ensureOcr();
      const tileSize = Math.max(1024, Math.ceil(overlap) + 256);
      const tiles = [...drawingTiles(width, height, Math.ceil(overlap), tileSize)];
      for (const [i, tile] of tiles.entries()) {
        if (!worker && !ocr) break;
        onProgress(`Scanning tile ${i + 1} of ${tiles.length}…`);
        const canvas = await readTile(tile);
        if (worker) {
          const found = await runTile(worker, pixels(canvas), templates, !hasNative, !templates.length);
          for (const candidate of found) candidates.push(pageCandidate(candidate, tile));
        }
        if (ocr && !cachedOcr) {
          try { for (const observation of await recognizeTile(ocr, canvas, tile)) text.push(observation); }
          catch (error) { await failOcr(error); }
        }
      }
    }
    if (needsOcr && !ocrFailed) {
      // Full tiles find references and rotated text. Re-read small neighborhoods
      // when thin CAD lettering gets lost among the drawing strokes.
      const symbols = suppressDuplicates(candidates).kept.filter(candidate => candidate.classification === 'valve');
      const lookedAt = new Set(cachedOcr ? textCache.lookedAt : []);
      const regions = (native?.textRegions || []).map(region => ({ ...scalePoint(region), radius: region.radius * sx }));
      for (const [index, region] of regions.entries()) {
        const nearby = symbols.some(symbol => {
          const span = Math.max(symbol.box.right - symbol.box.left, symbol.box.bottom - symbol.box.top);
          const gap = Math.hypot(region.x - symbol.position.x, region.y - symbol.position.y);
          return gap >= region.radius * 0.7 && gap < Math.max(span * 2.6, region.radius * 2.6);
        });
        const key = `circle:${Math.round(region.x)},${Math.round(region.y)}`;
        if (!nearby || lookedAt.has(key)) continue;
        await ensureOcr();
        if (!ocr) break;
        onProgress(`Reading callout ${index + 1} of ${regions.length}…`);
        const radius = region.radius * 0.81;
        const x = Math.max(0, Math.floor(region.x - radius));
        const y = Math.max(0, Math.floor(region.y - radius));
        const tile = { x, y, width: Math.min(width - x, Math.ceil(radius * 2)), height: Math.min(height - y, Math.ceil(radius * 2)) };
        try {
          const canvas = await readTile(tile);
          const context = canvas.getContext('2d');
          context.fillStyle = 'white';
          context.beginPath();
          context.rect(0, 0, tile.width, tile.height);
          context.arc(region.x - x, region.y - y, region.radius * 0.87, 0, Math.PI * 2);
          context.fill('evenodd');
          for (const observation of await recognizeTile(ocr, canvas, tile, { scale: 1.4, rotations: [0], mode: 6 })) {
            text.push({ ...observation, regionRadius: region.radius });
          }
          lookedAt.add(key);
        } catch (error) { await failOcr(error); break; }
      }
      const targets = associateTags(symbols, tagObservations(text, formats)).filter(symbol => !symbol.tag);
      for (const [i, symbol] of targets.entries()) {
        const key = `${Math.round(symbol.position.x / 16)},${Math.round(symbol.position.y / 16)}`;
        if (lookedAt.has(key)) continue;
        await ensureOcr();
        if (!ocr) break;
        onProgress(`Reading labels near valve ${i + 1} of ${targets.length}…`);
        const span = Math.max(symbol.box.right - symbol.box.left, symbol.box.bottom - symbol.box.top);
        const radius = Math.min(230, Math.max(45, span * 2.3));
        const x = Math.max(0, Math.floor(symbol.position.x - radius));
        const y = Math.max(0, Math.floor(symbol.position.y - radius));
        const tile = { x, y, width: Math.min(width - x, Math.ceil(radius * 2)), height: Math.min(height - y, Math.ceil(radius * 2)) };
        try {
          const canvas = await readTile(tile);
          const { left, right, top, bottom } = symbol.box;
          const context = canvas.getContext('2d');
          context.fillStyle = 'white';
          context.fillRect(left - x, top - y, right - left, bottom - top);
          for (const observation of await recognizeTile(ocr, canvas, tile, { scale: 1.65 })) text.push(observation);
          lookedAt.add(key);
        } catch (error) { await failOcr(error); break; }
      }
      if (!ocrFailed) Object.assign(textCache, { width, height, text, lookedAt });
    }
    const result = detectionResult(candidates, width, height, method, text, settings.formats, diagnostic);
    result.textMethod = needsOcr ? ocrFailed ? 'ocr-incomplete' : 'ocr' : 'native';
    return result;
  } finally {
    worker?.terminate();
    await Promise.allSettled([ocr?.terminate(), pdf?.close()]);
  }
}
