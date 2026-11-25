import { classifications, mergeScan, moveComponent, reviewedResult } from './detect.mjs';
import { scanDrawing } from './scan.mjs';
import { valveFormats } from './association.mjs';

export function mountReview({ stage, Konva, activeDrawing, activeImage, pdfSource }) {
  const layer = new Konva.Layer();
  stage.add(layer);
  const byId = id => document.getElementById('smart-' + id);
  const toggle = byId('toggle'), panel = byId('panel'), scan = byId('scan');
  const status = byId('status'), list = byId('components'), editor = byId('editor');
  const classification = byId('classification'), details = byId('details');
  const tagInput = byId('tag'), confirm = byId('confirm'), reject = byId('reject');
  const diagnostic = byId('diagnostic'), diagnosticLegend = byId('diagnostic-legend');
  const formats = byId('formats'), addSample = byId('add-sample'), clearSamples = byId('clear-samples');
  const calibrationInfo = byId('calibration-info'), tagOptions = byId('tag-options');
  const pending = new WeakMap();
  const errors = new WeakMap();
  const textCaches = new WeakMap();
  let capture;
  const settings = () => shownDrawing.smartSettings ||= {};
  let selection;
  let shownDrawing;

  for (const [value, label] of Object.entries(classifications)) {
    classification.add(new Option(label, value));
  }

  const components = () => activeDrawing()?.smartDetection?.components || [];
  const selected = () => components().find(component => component.id === selection);
  const label = component => classifications[component.classification] || classifications.other;

  function refresh() {
    if (activeDrawing() !== shownDrawing) {
      shownDrawing = activeDrawing();
      selection = undefined;
      capture = undefined;
    }
    const image = activeImage();
    const items = components();
    const component = selected();
    panel.hidden = !toggle.checked;
    layer.visible(toggle.checked);
    layer.destroyChildren();
    if (!toggle.checked) return;

    const busy = pending.has(shownDrawing);
    const calibrations = shownDrawing?.smartSettings?.calibration || [];
    formats.value = shownDrawing?.smartSettings?.formats || '';
    formats.disabled = !shownDrawing || busy;
    scan.disabled = !image || !shownDrawing || busy || Boolean(capture);
    addSample.disabled = !image || busy || calibrations.length >= 4 && !capture;
    clearSamples.disabled = busy || (!capture && !calibrations.length);
    addSample.textContent = capture ? 'Cancel selection' : 'Select valve sample';
    calibrationInfo.textContent = capture
      ? capture.first ? 'Select the opposite corner.' : 'Select the first corner around a valve.'
      : `${calibrations.length} of 4 samples. Scan again to use the selected samples.`;
    diagnosticLegend.hidden = !diagnostic.checked;
    if (!shownDrawing) status.textContent = 'Upload a P&ID to scan.';
    else if (busy) status.textContent = pending.get(shownDrawing);
    else if (errors.has(shownDrawing)) status.textContent = errors.get(shownDrawing);
    else if (shownDrawing.smartDetection) {
      const count = items.filter(item => item.review === 'pending').length;
      const warning = shownDrawing.smartDetection.textMethod === 'ocr-incomplete' ? ' OCR was unavailable or incomplete.' : '';
      status.textContent = (items.length ? `${count} of ${items.length} awaiting review.` : 'No symbols detected.') + warning;
    } else status.textContent = 'Scan the selected drawing for symbols.';

    list.replaceChildren(new Option('Select a symbol', ''));
    for (const item of items) {
      const tag = item.tag?.value ? ' · ' + item.tag.value : '';
      list.add(new Option(`${item.id} · ${label(item)}${tag} · ${item.review}`, item.id));
    }
    list.disabled = !items.length;
    list.value = component?.id || '';
    editor.hidden = !component;
    if (component) {
      classification.value = component.classification;
      tagInput.value = component.tag?.value || '';
      const tagConfidence = component.tag?.confidence;
      const source = { vector: 'PDF vector', raster: 'Raster', calibrated: 'Calibrated raster' }[component.source] || component.source;
      details.textContent = `${source} · ${Math.round(component.confidence * 100)}% symbol confidence` +
        (tagConfidence == null ? '' : ` · ${Math.round(tagConfidence * 100)}% tag confidence`) +
        (component.association?.status ? ` · Tag ${component.association.status}` : '');
      tagOptions.replaceChildren(new Option('Choose an observed tag', ''));
      for (const [index, option] of (component.association?.options || []).entries()) {
        tagOptions.add(new Option(`${option.value} · ${option.source} · ${Math.round(option.confidence * 100)}%${option.repeated ? ' · repeated' : ''}`, String(index)));
      }
      tagOptions.disabled = tagOptions.options.length === 1;
      confirm.disabled = component.review === 'confirmed';
      reject.disabled = component.review === 'rejected';
    }

    if (image && (diagnostic.checked || capture)) {
      drawDiagnostics(image, calibrations);
    }
    for (const item of image && !capture ? items : []) {
      if (item.review === 'rejected' && item !== component) continue;
      const { position, bounds } = item;
      const w = image.width(), h = image.height();
      const marker = new Konva.Group({
        x: image.x() + position.x * w,
        y: image.y() + position.y * h,
        draggable: item === component
      });
      const color = item === component ? '#9333ea' : item.review === 'confirmed' ? '#047857' : '#0369a1';
      marker.add(new Konva.Rect({
        x: (bounds.left - position.x) * w - 2,
        y: (bounds.top - position.y) * h - 2,
        width: (bounds.right - bounds.left) * w + 4,
        height: (bounds.bottom - bounds.top) * h + 4,
        fill: color + '24',
        stroke: color,
        strokeWidth: item === component ? 2 : 1.5,
        strokeScaleEnabled: false,
        dash: item.review === 'rejected' ? [3, 3] : undefined,
        hitStrokeWidth: 10
      }));
      marker.on('click tap', event => {
        if (event.evt.shiftKey || event.evt.button > 0) return;
        event.cancelBubble = true;
        selection = item.id;
        refresh();
      });
      marker.on('dragend', () => {
        const x = (marker.x() - image.x()) / w;
        const y = (marker.y() - image.y()) / h;
        moveComponent(item, { x, y });
        refresh();
      });
      layer.add(marker);
      if (item === component) marker.moveToTop();
    }
    layer.batchDraw();
  }

  function drawDiagnostics(image, calibration) {
    const result = shownDrawing.smartDetection;
    const data = diagnostic.checked && result?.diagnostics;
    diagnosticLegend.textContent = data
      ? `${result.method} / ${result.textMethod} · ${data.text.length} text observations · ${data.raw.length} raw candidates · ${data.rejected.length} duplicates. Blue text · amber raw · red duplicates · green assigned.`
      : result ? `${result.method} / ${result.textMethod || 'unknown'}. Scan with diagnostics enabled to show intermediate results.`
        : 'Scan to display detection diagnostics.';
    const x = value => image.x() + value * image.width();
    const y = value => image.y() + value * image.height();
    layer.add(new Konva.Shape({
      listening: false,
      sceneFunc: context => {
        const scale = stage.scaleX();
        context.setAttr('lineWidth', 1 / scale);
        const boxes = (items, color) => {
          context.setAttr('strokeStyle', color);
          for (const { box } of items) context.strokeRect(x(box.left), y(box.top),
            x(box.right) - x(box.left), y(box.bottom) - y(box.top));
        };
        if (data) {
          boxes(data.raw, '#d97706');
          boxes(data.rejected, '#dc2626');
          context.setAttr('fillStyle', '#1d4ed8');
          context.setAttr('font', `${11 / scale}px sans-serif`);
          for (const observation of data.text) {
            context.fillRect(x(observation.position.x), y(observation.position.y), 3 / scale, 3 / scale);
            if (scale > 1.25) context.fillText(observation.value, x(observation.position.x), y(observation.position.y) - 3 / scale);
          }
          for (const component of components()) {
            const tag = component.tag || component.association?.options?.[0];
            if (!tag?.position) continue;
            context.beginPath();
            context.setAttr('strokeStyle', component.tag ? '#047857' : '#dc2626');
            context.moveTo(x(component.position.x), y(component.position.y));
            context.lineTo(x(tag.position.x), y(tag.position.y));
            context.stroke();
          }
        }
        boxes(calibration.map(box => ({ box })), '#9333ea');
        if (capture?.first) {
          context.setAttr('fillStyle', '#9333ea');
          context.fillRect(x(capture.first.x), y(capture.first.y), 5 / scale, 5 / scale);
        }
      }
    }));
  }

  toggle.addEventListener('change', () => { if (!toggle.checked) capture = undefined; refresh(); });
  diagnostic.addEventListener('change', refresh);
  formats.addEventListener('change', () => {
    try {
      valveFormats(formats.value);
      settings().formats = formats.value;
      errors.delete(shownDrawing);
    } catch (error) { errors.set(shownDrawing, error.message); }
    refresh();
  });
  addSample.addEventListener('click', () => { capture = capture ? undefined : {}; refresh(); });
  clearSamples.addEventListener('click', () => {
    capture = undefined;
    settings().calibration = [];
    refresh();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && capture) { capture = undefined; refresh(); }
  });
  stage.on('click.smartCalibration tap.smartCalibration', event => {
    if (!capture || event.evt?.shiftKey || event.evt?.button > 0) return;
    const image = activeImage();
    const pointer = layer.getRelativePointerPosition();
    if (!image || !pointer) return;
    const x = (pointer.x - image.x()) / image.width();
    const y = (pointer.y - image.y()) / image.height();
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    if (!capture.first) capture.first = { x, y };
    else {
      const w = Math.abs(capture.first.x - x), h = Math.abs(capture.first.y - y);
      if (w > 0.09 || h > 0.09 || w * image.image().naturalWidth < 12 || h * image.image().naturalHeight < 12) {
        errors.set(shownDrawing, 'Select a tight box at least 12 source pixels wide and tall around one valve.');
        capture.first = undefined;
      } else {
        const samples = settings().calibration ||= [];
        samples.push({ left: Math.min(capture.first.x, x), right: Math.max(capture.first.x, x),
          top: Math.min(capture.first.y, y), bottom: Math.max(capture.first.y, y) });
        errors.delete(shownDrawing);
        capture = undefined;
      }
    }
    refresh();
  });
  list.addEventListener('change', () => { selection = list.value; refresh(); });
  classification.addEventListener('change', () => {
    const component = selected();
    component.classification = classification.value;
    if (component.tag?.source !== 'manual') component.tag = null;
    component.association = { status: component.tag ? 'manual' : 'unmatched', options: [] };
    component.review = 'pending';
    refresh();
  });
  tagInput.addEventListener('change', () => {
    const component = selected();
    const value = tagInput.value.trim();
    if (value === (component.tag?.value || '')) return;
    component.tag = value ? { value, confidence: null, position: null, source: 'manual' } : null;
    component.association = { status: value ? 'manual' : 'unmatched', options: component.association?.options || [] };
    component.review = 'pending';
    refresh();
  });
  tagOptions.addEventListener('change', () => {
    const component = selected();
    const option = tagOptions.value === '' ? null : component.association?.options[Number(tagOptions.value)];
    if (!option) return;
    component.tag = option;
    component.association.status = 'reviewed';
    component.review = 'pending';
    refresh();
  });
  confirm.addEventListener('click', () => { selected().review = 'confirmed'; refresh(); });
  reject.addEventListener('click', () => { selected().review = 'rejected'; refresh(); });
  scan.addEventListener('click', async () => {
    const drawing = activeDrawing();
    const image = activeImage()?.image();
    if (!drawing || !image || pending.has(drawing) || capture) return;
    pending.set(drawing, 'Scanning drawing…');
    errors.delete(drawing);
    refresh();
    try {
      if (!textCaches.has(drawing)) textCaches.set(drawing, {});
      const result = await scanDrawing({
        pdfjs: window.pdfjsLib, file: pdfSource(drawing), image,
        settings: structuredClone(drawing.smartSettings || {}), diagnostic: diagnostic.checked, textCache: textCaches.get(drawing),
        onProgress: message => {
          pending.set(drawing, message);
          if (drawing === shownDrawing) status.textContent = message;
        }
      });
      drawing.smartDetection = mergeScan(drawing.smartDetection, result);
    } catch (error) {
      errors.set(drawing, error.message || 'Scan failed. Try again.');
      console.warn('Smart Detection scan failed', error);
    } finally {
      pending.delete(drawing);
      refresh();
    }
  });
  refresh();
  return { refresh, serialize: reviewedResult, isCalibrating: () => Boolean(capture) };
}
