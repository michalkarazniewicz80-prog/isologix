# Industrial drawing benchmark

The valve ground truth was hand-labeled on two publicly issued engineering drawings. Both include pipe references, equipment symbols, and dense control annotations. Their plotted lettering has no usable native text layer, so the browser runs OCR. The annotated tags are the visible primary valve identifiers for the site formats in the fixture. Drawings remain at their source URLs and are not redistributed in this repository. [North End Sewage Treatment Plant, wastewater effluent](https://legacy.winnipeg.ca/finance/findata/matmgt/documents/2015/952-2015/952-2015_Drawing_1-0101Y-A0009-001-R3.pdf) · [MacLean Pumping Station, pump P-M023, PDF page 155](https://legacy.winnipeg.ca/finance/findata/matmgt/documents/2024/54-2024/54-2024_Appendix%20C_Identification%20Standard.pdf)

## Method

Match valve predictions one-to-one by nearest ground-truth center within 0.5% of the page width, strongest prediction first. Precision is matched valves divided by valve predictions. Recall is matched valves divided by all labeled valves. Duplicate rate is additional predictions at an already matched valve divided by valve predictions. Tag accuracy is exact assignments divided by all automatic tag assignments, including assignments on false detections. Tag coverage is correct assignments divided by all labeled valves with a known tag. A dash denotes no automatic assignments and therefore undefined accuracy.

Calibration uses two examples from the wastewater sheet and three from MacLean. Example locations are part of the scored page, and no results were manually corrected. This benchmark covers valves on two sheets. It does not establish accuracy for equipment classes or other sites.

## Results

Measurements were taken in Chromium using the application scanner. The previous implementation is commit `ea498ff`. A small number of accepted tags can yield high tag accuracy even when the scanner leaves many tags blank, so tag coverage is shown separately.

| Sheet | Detector | Valve precision | Valve recall | Duplicate rate | Tag accuracy | Tag coverage |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Wastewater | Previous | 2.8% (4/142) | 26.7% (4/15) | 0.0% (0/142) | — | 0.0% (0/13) |
| Wastewater | Revised, uncalibrated | 100.0% (5/5) | 33.3% (5/15) | 0.0% (0/5) | 100.0% (1/1) | 7.7% (1/13) |
| Wastewater | Revised, calibrated | 100.0% (9/9) | 60.0% (9/15) | 0.0% (0/9) | 100.0% (5/5) | 38.5% (5/13) |
| MacLean | Previous | 100.0% (12/12) | 50.0% (12/24) | 0.0% (0/12) | — | 0.0% (0/2) |
| MacLean | Revised, uncalibrated | 100.0% (12/12) | 50.0% (12/24) | 0.0% (0/12) | — | 0.0% (0/2) |
| MacLean | Revised, calibrated | 95.0% (19/20) | 79.2% (19/24) | 0.0% (0/20) | 100.0% (2/2) | 100.0% (2/2) |
| Both | Revised, calibrated | 96.6% (28/29) | 71.8% (28/39) | 0.0% (0/29) | 100.0% (7/7) | 46.7% (7/15) |

## Reproduce

1. Download the drawings from their source URLs. Keep the wastewater sheet as `wastewater.pdf`. Use `pdfseparate -f 155 -l 155 maclean.pdf plant-%d.pdf` to save the MacLean sheet as `plant-155.pdf`.
2. Serve an evaluation copy of the repository over HTTP with the two single-page PDFs at its root. Open `planner.html` in Chromium. The benchmark uses the planner's PDF.js and the pinned browser OCR assets.
3. Run the following in the browser console. Place both downloaded JSON files in the same directory.

```js
const { benchmarkDrawing } = await import('./smart-pid/benchmark/run.mjs');
for (const id of ['wastewater', 'plant-155']) {
  const pdf = await fetch(`./${id}.pdf`).then(response => response.blob());
  const runs = await benchmarkDrawing(id, pdf, window.pdfjsLib);
  const url = URL.createObjectURL(new Blob([JSON.stringify(runs)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${id}-results.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

4. Run `node smart-pid/benchmark/score.mjs RESULTS_DIRECTORY`.
