import { scanDrawing } from '../scan.mjs';

export async function benchmarkDrawing(id, firstPagePdf, pdfjs, onProgress = console.log) {
  const fixtures = await fetch(new URL('./fixtures.json', import.meta.url)).then(response => response.json());
  const fixture = fixtures.find(item => item.id === id);
  if (!fixture) throw new Error('Unknown benchmark sheet: ' + id);
  const { width, height, formats, samples } = fixture;
  const calibration = samples.map(([left, top, right, bottom]) => ({
    left: left / width, top: top / height, right: right / width, bottom: bottom / height
  }));
  const textCache = {};
  const options = { pdfjs, file: firstPagePdf, diagnostic: true, textCache, onProgress };
  return {
    uncalibrated: await scanDrawing({ ...options, settings: { formats } }),
    calibrated: await scanDrawing({ ...options, settings: { formats, calibration } })
  };
}
