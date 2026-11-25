import { wordPosition } from './ocr.mjs';

const assets = new URL('./generated/paddle/', import.meta.url);
const asset = path => new URL(path, assets).href;

export async function openPaddle() {
  const { PaddleOCR } = await import(asset('sdk.mjs'));
  return PaddleOCR.create({
    textDetectionModelName: 'PP-OCRv5_mobile_det',
    textDetectionModelAsset: { url: asset('models/PP-OCRv5_mobile_det.tar') },
    textRecognitionModelName: 'en_PP-OCRv5_mobile_rec',
    textRecognitionModelAsset: { url: asset('models/en_PP-OCRv5_mobile_rec.tar') },
    worker: true,
    ortOptions: { backend: 'wasm', numThreads: 1, wasmPaths: asset('ort/') }
  });
}

export async function readPaddleTile(ocr, canvas, tile, regions) {
  const observations = [];
  for (const rotation of [0, 90, -90]) {
    let input = canvas;
    if (rotation) {
      input = document.createElement('canvas');
      input.width = canvas.height;
      input.height = canvas.width;
      const context = input.getContext('2d');
      context.translate(rotation > 0 ? input.width : 0, rotation < 0 ? input.height : 0);
      context.rotate(rotation * Math.PI / 180);
      context.drawImage(canvas, 0, 0);
    }
    const [result] = await ocr.predict(input, {
      textDetLimitSideLen: 1024, textDetLimitType: 'max', textRecScoreThresh: 0.65
    });
    for (const { poly, text, score } of result.items) {
      if (!text.trim() || poly.length !== 4) continue;
      const [x, y] = poly.reduce(([sx, sy], point) => [sx + point[0] / 4, sy + point[1] / 4], [0, 0]);
      const position = wordPosition({ x0: x, x1: x, y0: y, y1: y }, tile, rotation);
      const size = Math.hypot(poly[0][0] - poly[3][0], poly[0][1] - poly[3][1]);
      const callout = regions.find(region => Math.hypot(region.x - position.x, region.y - position.y) <= region.radius * 0.85);
      observations.push({ value: text, position, orientation: -rotation, size, quality: score, source: 'ocr',
        regionRadius: callout?.radius });
    }
  }
  return observations;
}
