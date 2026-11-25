# Smart P&ID Detection

Enable **Smart Detection**, choose a drawing, and select **Scan drawing**. Select a result from the canvas or the sidebar to review its class, tag, location, and confidence. Drag its outline to reposition it. Confirm or reject the result before saving. Reviewed decisions and drawing-specific settings are saved with the draft. Rescanning replaces unreviewed suggestions and preserves reviewed decisions.

## Calibrate a drawing

Open **Scan settings**, choose **Select valve sample**, and click opposite corners of a tight box around one representative valve. Exclude nearby text and other symbols. Add up to four examples of distinct shapes or drafting conventions, then scan again. Each example is searched across the drawing at 30° rotation intervals and approximately 0.75–1.32 times the selected size. The scanner retains native vector matches and adds high-confidence sample matches. Small, irregular, or very different valve shapes may need another example.

Enter comma-separated valve prefixes or exact masks in **Valve tag formats**. Prefixes such as `HV` accept numeric IDs with an optional suffix. Masks use `#` for a digit, `@` for a letter, and literal separators. For example, `XV-@###` matches `XV-Y241`, and `X### XV` can match an explicitly configured stacked callout. A custom list replaces the defaults for that drawing.

## Recognition and review

- PDF.js reads native paths and text from the first displayed PDF page. Geometry determines class before tag association. The native recognizer covers common bow-tie valves, a circular pump variant with an internal impeller, and capsule-like vessels.
- Raster scans use overlapping source-resolution tiles for images and 3× PDF tiles when the original file is available. Generic fallback scores valve shape, surrounding blank space, and visible pipe continuation. Calibration uses the selected drawing shapes. OCR reads horizontal text and both 90° rotations when native text is unavailable. On mixed PDFs, it also searches near valves with no native tag match. Isolated crops assist with plotted callout text. OCR can still miss small letters or read them incorrectly.
- Tag association uses matching classes, spatial constraints, and a one-to-one match with a minimum score and a margin over competing matches. Whole-token format checks keep line references, dimensions, and instrument identifiers out of valve matches. Repeated references and close alternatives are flagged. An unmatched, repeated, or ambiguous result starts with a blank tag. A reviewer can choose an observed tag or supply a correction.
- Enable **Diagnostics** before scanning to see text positions, raw candidate boxes, rejected duplicates, tag associations, and recognition methods. Zoom in to read extracted text. Diagnostic data remains in memory.
- Existing manual annotations drive isolation schedules and PDF export. Smart Detection stores observations and review decisions in an optional drawing record and has no pipework graph or boundary analysis.

## Format and licensing

Drafts use the existing versioned detection record with page-normalized bounds and centers, detector class and center, source, orientation when known, separate tag and symbol confidence, and review state. A graph can reference stable component IDs using drawing ID and page, and share the same coordinate space for ports, segments, junctions, and off-page connectors. Existing drafts can open without these optional fields. Without an original PDF in the session, a saved drawing scans from its rendered image.

Browser recognition was evaluated with PDF.js native extraction, OpenCV.js template matching, and Tesseract.js. The pattern matcher uses small Canvas samples in a Worker, with scale and rotation handled explicitly. OCR uses pinned versions of Tesseract.js and Tesseract.js-core for browser-side recognition. The browser downloads the engine and English model assets when needed. Drawing pixels and text stay in the browser during scanning. The normal cloud save still sends the draft selected by the user. [OpenCV.js template matching](https://docs.opencv.org/3.4/d8/dd1/tutorial_js_template_matching.html) · [Tesseract.js](https://github.com/naptha/tesseract.js/tree/v6.0.1)

PDF.js, Tesseract.js, and Tesseract.js-core use Apache 2.0, which permits commercial use subject to license and notice requirements. The English model package wrapper lists MIT and bundles Tesseract trained data. Retain upstream licenses and bundled notices if mirroring these assets. [PDF.js license](https://github.com/mozilla/pdf.js/blob/v3.8.162/LICENSE) · [Tesseract.js license](https://github.com/naptha/tesseract.js/blob/v6.0.1/LICENSE.md) · [Tesseract model licenses](https://tesseract-ocr.github.io/tessdoc/Data-Files.html)

Run `npm test` for automated behavior tests. See [the industrial benchmark](benchmark/README.md) for field-drawing results and reproduction steps.
