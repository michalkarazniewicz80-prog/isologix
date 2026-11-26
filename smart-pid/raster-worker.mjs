import { rasterCandidates } from './detect.mjs';
import { calibratedCandidates } from './calibration.mjs';

self.onmessage = ({ data: { image, templates, generic, useValve } }) => {
  const calibrated = calibratedCandidates(image, templates);
  self.postMessage(generic ? [...calibrated, ...rasterCandidates(image, { useValve })] : calibrated);
};
