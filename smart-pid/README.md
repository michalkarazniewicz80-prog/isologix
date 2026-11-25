# Smart P&ID Detection

Enable **Smart Detection** in the Isolation Planner, choose a drawing, and select **Scan drawing**. Select a result from the canvas or the sidebar. You can edit its classification and tag, drag its outline to reposition it, and confirm or reject it. Save stores both review decisions in the existing draft. If you reopen a draft, you can scan again to recover candidates that were still awaiting review. Turning the toggle off hides the review controls and overlays.

## Detection and coverage

- The native PDF adapter reads the PDF.js operator list and text items for the same first page displayed by the planner. It applies the page viewport and drawing transforms before matching bow-tie valves, tagged circular pump and instrument symbols, and tagged vessel outlines. Tag association uses proximity and known tag prefixes.
- If native matching yields no candidates or extraction fails, the browser runs raster template matching for horizontal and vertical bow-tie valves and a circular pump variant. Raster scans can reuse available native text. Standalone images, saved drafts that contain only the rendered image, and text embedded as pixels have no native tags. Reviewers can enter tags manually.
- Confidence values are heuristic scores from 0 to 1. The matching rules cover a limited set of drafting conventions, and raster matching depends on scan quality and symbol size. Native source files are held in memory for the current session. Detection runs in the browser. Saving sends the existing draft payload, including reviewed detection records, through the existing cloud save endpoint.
- Detection records describe drawing content and review decisions. Manual annotations remain the source of isolation schedules and PDF export.

## Draft schema and future connectivity

Each optional `drawings[].smartDetection` record contains `version`, `page`, `coordinateSpace`, `method`, and `components`. Each component stores an ID, current classification, page position and bounds, source, symbol confidence, optional tag association with its own confidence and position, and review status. The original detector classification and center are retained when the reviewer changes them. A manually entered tag has no detector confidence or source position.

Coordinates use the rendered page's top-left origin and are normalized to the page width and height. Component IDs are stable within a saved drawing and page. Future graph nodes can reference a component by drawing ID, page number, and component ID. A graph can use that same coordinate space for ports, pipe segments, and junctions, and represent off-page connections as edges crossing drawing/page boundaries. Candidate boundary analysis can reference those graph nodes and edges independently of the review decisions.

## Licensing

Smart Detection adds no third-party dependencies. It uses the planner's existing PDF.js 3.8.162 under Apache License 2.0, which permits commercial use subject to its license and applicable notice requirements when redistributing. Raster matching uses the browser Canvas and Worker APIs and the implementation in this directory. [PDF.js license](https://github.com/mozilla/pdf.js/blob/v3.8.162/LICENSE)

Run the automated tests with `npm test`.
