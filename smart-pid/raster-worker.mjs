import { rasterCandidates, detectionResult } from './detect.mjs';

self.onmessage = ({ data: { image, tags } }) => {
  self.postMessage(detectionResult(rasterCandidates(image, tags), image.width, image.height, 'raster'));
};
