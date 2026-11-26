// All documents and OCR results stay in the browser. These URLs serve code/model assets.
const cdn = 'https://cdn.jsdelivr.net/npm';
let loading;

function loadTesseract() {
  if (!loading) loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${cdn}/tesseract.js@6.0.1/dist/tesseract.min.js`;
    const timer = setTimeout(() => script.onerror(), 30_000);
    script.onload = () => {
      clearTimeout(timer);
      if (window.Tesseract) resolve(window.Tesseract);
      else script.onerror();
    };
    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      reject(new Error('Could not load OCR'));
    };
    document.head.append(script);
  }).catch(error => { loading = undefined; throw error; });
  return loading;
}

export async function openOcr() {
  const tesseract = await loadTesseract();
  let timer, fail;
  const initializationError = new Promise((_, reject) => {
    fail = reject;
    timer = setTimeout(() => reject(new Error('OCR initialization timed out')), 45_000);
  });
  const initialization = tesseract.createWorker('eng', 1, {
    workerPath: `${cdn}/tesseract.js@6.0.1/dist/worker.min.js`,
    corePath: `${cdn}/tesseract.js-core@6.0.0`,
    langPath: `${cdn}/@tesseract.js-data/eng@1.0.0/4.0.0_best_int`,
    errorHandler: error => fail(new Error(String(error)))
  });
  let worker;
  try {
    worker = await Promise.race([initialization, initializationError]);
  } catch (error) {
    initialization.then(lateWorker => lateWorker.terminate()).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
  }
  try {
    await worker.setParameters({ tessedit_pageseg_mode: tesseract.PSM.SPARSE_TEXT });
  } catch (error) {
    await worker.terminate();
    throw error;
  }
  return worker;
}

export function wordPosition(box, tile, rotation) {
  const x = (box.x0 + box.x1) / 2, y = (box.y0 + box.y1) / 2;
  if (rotation === 90) return { x: tile.x + y, y: tile.y + tile.height - x };
  if (rotation === -90) return { x: tile.x + tile.width - y, y: tile.y + x };
  return { x: tile.x + x, y: tile.y + y };
}

export async function recognizeTile(worker, canvas, tile, { rotations = [0, 90, -90], scale = 1, mode } = {}) {
  const observations = [];
  for (const rotation of rotations) {
    let input = canvas;
    if (rotation || scale !== 1) {
      input = document.createElement('canvas');
      input.width = Math.ceil((rotation ? canvas.height : canvas.width) * scale);
      input.height = Math.ceil((rotation ? canvas.width : canvas.height) * scale);
      const context = input.getContext('2d');
      context.fillStyle = 'white';
      context.fillRect(0, 0, input.width, input.height);
      context.translate(rotation > 0 ? canvas.height * scale : 0, rotation < 0 ? canvas.width * scale : 0);
      context.rotate(rotation * Math.PI / 180);
      context.scale(scale, scale);
      context.drawImage(canvas, 0, 0);
    }
    const options = mode ? { tessedit_pageseg_mode: String(mode) } : {};
    const { data } = await worker.recognize(input, options, { text: false, blocks: true });
    const lines = (data.blocks || []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines));
    for (const line of lines) {
      // Use whole words. Also retain a tightly spaced split label when the line
      // contains only those fragments.
      const words = line.words || [];
      const adjacent = words.length > 1 && words.length <= 3 && words.every((word, index) =>
        index === 0 || word.bbox.x0 - words[index - 1].bbox.x1 <= (word.bbox.y1 - word.bbox.y0) * 0.45);
      for (const word of adjacent ? [line] : words) {
        const { bbox, text, confidence } = word;
        if (!text?.trim() || confidence < 65 || !bbox) continue;
        const originalBox = { x0: bbox.x0 / scale, x1: bbox.x1 / scale, y0: bbox.y0 / scale, y1: bbox.y1 / scale };
        observations.push({ value: text.trim(), position: wordPosition(originalBox, tile, rotation),
          orientation: -rotation, quality: confidence / 100, size: originalBox.y1 - originalBox.y0, source: 'ocr' });
      }
    }
  }
  return observations;
}
