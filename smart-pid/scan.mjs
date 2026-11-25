import { detectionResult } from './detect.mjs';
import { detectPdf } from './pdf.mjs';

export async function scanDrawing({ pdfjs, file, image }) {
  let native;
  if (file && pdfjs) {
    try {
      native = await detectPdf(pdfjs, file);
      if (native.candidates.length) {
        return detectionResult(native.candidates, native.width, native.height, 'vector');
      }
    } catch (error) {
      console.warn('Smart Detection could not extract PDF vectors or text', error);
    }
  }

  const scale = Math.min(1, 1500 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const tags = (native?.tags || []).map(tag => ({ ...tag, position: {
    x: tag.position.x / native.width * canvas.width,
    y: tag.position.y / native.height * canvas.height
  }}));
  const worker = new Worker(new URL('./raster-worker.mjs', import.meta.url), { type: 'module' });
  try {
    return await new Promise((resolve, reject) => {
      worker.onmessage = event => resolve(event.data);
      worker.onerror = () => reject(new Error('Raster detection failed'));
      worker.onmessageerror = () => reject(new Error('Raster detection returned invalid data'));
      worker.postMessage({ image: pixels, tags }, [pixels.data.buffer]);
    });
  } finally {
    worker.terminate();
  }
}
