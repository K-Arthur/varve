# Presentation workflow defect matrix — 2026-09-29

This matrix distinguishes directly reproduced baseline behavior from risks
reported in other products. Recheck each row as the implementation lands; a
source report is not presented as a Varve defect.

| ID | Scope | Baseline / reported failure | Status and source date | Varve acceptance scenario |
|---|---|---|---|---|
| P-01 | Varve preview UI | Existing single-frame preview leaves Layers and Inspector dock headers over the audience slide. | Reproduced in local webview, 2026-09-29. | Fullscreen/top-layer preview hides dock chrome; Exit restores focus and editing state. |
| P-02 | Varve authoring | Frames have no persisted deck order, titles, notes, sections or skip state. | Confirmed by UI and model audit, 2026-09-29. | Save/reopen preserves a 12-slide ordered deck, notes, skip and section metadata. |
| P-03 | Varve output | Export flow has no sequence-level deck PDF or ordered PNG archive. | Confirmed by UI/source audit, 2026-09-29. | PDF page count/order and ZIP entry names/order match included slides; cancellation and write errors do not report success. |
| P-04 | Varve fidelity | Existing preview thumbnail and node export paths do not guarantee exact frame-local clipping and transform parity. | Confirmed by source audit, 2026-09-29; visual outcomes to be measured. | Per-slide comparison across editor, thumbnail, audience preview, reopened file and raster outputs, including mask/effect/crop/background fixtures. |
| P-05 | Other product: layout revision | Figma Slides user reported rebuilding 25 imported slides because layout could not be changed; support supplied a new-slide workaround and forwarded a feature request. | Report dated 2025-11-05; follow-ups through 2026-07-07. Forum “Solved” marker does not document feature delivery. | Existing populated slide accepts a previewed layout revision while preserving content, identities, notes, overrides and extras. |
| P-06 | Other product: PPTX rendering | User reported missing backgrounds/shapes; support observed a mask issue but did not reproduce rounded rectangle loss. | Report 2025-07-13; support response 2025-07-14; no resolution recorded in thread. | Rasterized core output is checked against actual rendered slide appearance; PPTX is not promised before feasibility/fidelity review. |
| P-07 | Other product: export availability | Figma Slides export was temporarily unavailable; support reported a fix and author confirmed restart restored it. A later individual-asset report was attributed to using the Slides rather than Design mode. | Incident 2026-04-01, confirmation 2026-04-02, mode clarification 2026-04-17. | In Varve, sequence export is explicit and separate from per-object export; save/cancel/error states are actionable. |
| P-08 | Accessibility | Drag-only reordering would exclude users who cannot perform precise pointer dragging. | WCAG 2.2 SC 2.5.7 guidance checked 2026-09-29. | Visible earlier/later/to-position controls work with mouse, touch and keyboard. |

Sources and research decisions: [presentation workflow research ledger](../research/presentation-workflow-2026-09-29.md).
