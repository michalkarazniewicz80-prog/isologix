import { extractTags, vectorCandidates } from './detect.mjs';

// PDF.js 3.x supplies path operations and operands in parallel arrays.
export function extractPaths({ fnArray, argsArray }, ops, viewport) {
  const paths = [];
  const stack = [];
  let pending = [];
  let path = [];
  let first, current;
  let matrix = [1, 0, 0, 1, 0, 0];
  const transform = ([a, b, c, d, e, f]) => {
    const [g, h, i, j, k, l] = matrix;
    matrix = [g * a + i * b, h * a + j * b, g * c + i * d, h * c + j * d,
      g * e + i * f + k, h * e + j * f + l];
  };
  const point = (x, y) => {
    const [a, b, c, d, e, f] = matrix;
    const [px, py] = viewport.convertToViewportPoint(a * x + c * y + e, b * x + d * y + f);
    return { x: px, y: py };
  };
  const finish = () => {
    if (path.length) pending.push(path);
    path = [];
    first = current = null;
  };
  const line = end => {
    if (current && (current.x !== end.x || current.y !== end.y)) path.push([current, end]);
    current = end;
  };
  const close = () => { if (first) line(first); };
  const paint = new Set([ops.stroke, ops.closeStroke, ops.fill, ops.eoFill, ops.fillStroke,
    ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke]);
  for (let index = 0; index < fnArray.length; index++) {
    const op = fnArray[index], args = argsArray[index];
    if (op === ops.save || op === ops.paintFormXObjectBegin) {
      stack.push(matrix);
      if (op === ops.paintFormXObjectBegin && args[0]) transform(args[0]);
    } else if (op === ops.restore || op === ops.paintFormXObjectEnd) {
      matrix = stack.pop() || matrix;
    } else if (op === ops.transform) {
      transform(args);
    } else if (op === ops.constructPath) {
      const [commands, values] = args;
      let i = 0;
      const next = () => point(values[i++], values[i++]);
      for (const command of commands) {
        switch (command) {
          case ops.moveTo: finish(); first = current = next(); break;
          case ops.lineTo: line(next()); break;
          case ops.closePath: close(); break;
          case ops.rectangle: {
            finish();
            const [x, y, w, h] = values.slice(i, i + 4);
            i += 4;
            first = current = point(x, y);
            line(point(x + w, y));
            line(point(x + w, y + h));
            line(point(x, y + h));
            close();
            finish();
            break;
          }
          case ops.curveTo:
          case ops.curveTo2:
          case ops.curveTo3: {
            const a = command === ops.curveTo2 ? current : next();
            const b = command === ops.curveTo3 ? null : next();
            const end = next();
            if (current) path.push([current, a, b || end, end]);
            current = end;
            break;
          }
        }
      }
    } else if (paint.has(op) || op === ops.endPath) {
      if ([ops.closeStroke, ops.closeFillStroke, ops.closeEOFillStroke].includes(op)) close();
      finish();
      if (paint.has(op)) for (const subpath of pending) paths.push(subpath);
      pending = [];
    }
  }
  return paths;
}

export async function detectPdf(pdfjs, file) {
  const task = pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const [operators, text] = await Promise.all([page.getOperatorList(), page.getTextContent()]);
    const tags = extractTags(text.items, viewport);
    const { width, height } = viewport;
    return { candidates: vectorCandidates(extractPaths(operators, pdfjs.OPS, viewport), tags, width, height),
      tags, width, height };
  } finally {
    await task.destroy();
  }
}
