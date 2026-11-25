import { classifications, mergeScan, moveComponent, reviewedResult } from './detect.mjs';
import { scanDrawing } from './scan.mjs';

export function mountReview({ stage, Konva, activeDrawing, activeImage, pdfSource }) {
  const layer = new Konva.Layer();
  stage.add(layer);
  const byId = id => document.getElementById('smart-' + id);
  const toggle = byId('toggle'), panel = byId('panel'), scan = byId('scan');
  const status = byId('status'), list = byId('components'), editor = byId('editor');
  const classification = byId('classification'), details = byId('details');
  const tagInput = byId('tag'), confirm = byId('confirm'), reject = byId('reject');
  const pending = new WeakSet();
  const scanned = new WeakSet();
  const errors = new WeakSet();
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
    }
    const image = activeImage();
    const items = components();
    const component = selected();
    panel.hidden = !toggle.checked;
    layer.visible(toggle.checked);
    layer.destroyChildren();
    if (!toggle.checked) return;

    scan.disabled = !image || !shownDrawing || pending.has(shownDrawing) || scanned.has(shownDrawing);
    if (!shownDrawing) status.textContent = 'Upload a P&ID to scan.';
    else if (pending.has(shownDrawing)) status.textContent = 'Scanning drawing…';
    else if (errors.has(shownDrawing)) status.textContent = 'Scan failed. Try again.';
    else if (shownDrawing.smartDetection) {
      const count = items.filter(item => item.review === 'pending').length;
      status.textContent = items.length ? `${count} of ${items.length} awaiting review.` : 'No symbols detected.';
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
      details.textContent = `${component.source === 'vector' ? 'PDF vector' : 'Raster'} · ${Math.round(component.confidence * 100)}% symbol confidence` +
        (tagConfidence == null ? '' : ` · ${Math.round(tagConfidence * 100)}% tag confidence`);
      confirm.disabled = component.review === 'confirmed';
      reject.disabled = component.review === 'rejected';
    }

    for (const item of image ? items : []) {
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

  toggle.addEventListener('change', refresh);
  list.addEventListener('change', () => { selection = list.value; refresh(); });
  classification.addEventListener('change', () => {
    const component = selected();
    component.classification = classification.value;
    component.review = 'pending';
    refresh();
  });
  tagInput.addEventListener('change', () => {
    const component = selected();
    const value = tagInput.value.trim();
    if (value === (component.tag?.value || '')) return;
    component.tag = value ? { value, confidence: null, position: null } : null;
    component.review = 'pending';
    refresh();
  });
  confirm.addEventListener('click', () => { selected().review = 'confirmed'; refresh(); });
  reject.addEventListener('click', () => { selected().review = 'rejected'; refresh(); });
  scan.addEventListener('click', async () => {
    const drawing = activeDrawing();
    const image = activeImage()?.image();
    if (!drawing || !image || pending.has(drawing) || scanned.has(drawing)) return;
    pending.add(drawing);
    errors.delete(drawing);
    refresh();
    try {
      const result = await scanDrawing({ pdfjs: window.pdfjsLib, file: pdfSource(drawing), image });
      drawing.smartDetection = mergeScan(drawing.smartDetection, result);
      if (result.components.length) scanned.add(drawing);
    } catch (error) {
      errors.add(drawing);
      console.warn('Smart Detection scan failed', error);
    } finally {
      pending.delete(drawing);
      refresh();
    }
  });
  refresh();
  return { refresh, serialize: reviewedResult };
}
