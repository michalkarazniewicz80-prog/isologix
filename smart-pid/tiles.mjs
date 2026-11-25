export function* drawingTiles(width, height, overlap = 160, size = 1024) {
  const step = size - Math.min(size - 32, overlap);
  function starts(length) {
    const positions = [0];
    while (positions.at(-1) + size < length) {
      positions.push(Math.min(positions.at(-1) + step, length - size));
    }
    return positions;
  }
  for (const y of starts(height)) {
    for (const x of starts(width)) yield { x, y, width: Math.min(size, width - x), height: Math.min(size, height - y) };
  }
}

export function pageCandidate(candidate, tile) {
  const { position, box } = candidate;
  return { ...candidate, position: { x: position.x + tile.x, y: position.y + tile.y },
    box: { left: box.left + tile.x, top: box.top + tile.y, right: box.right + tile.x, bottom: box.bottom + tile.y } };
}
