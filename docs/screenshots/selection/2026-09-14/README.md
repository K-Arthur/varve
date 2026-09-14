# Smart selection evidence — 2026-09-14

Frozen-build Playwright captures inspected for the smart-selection task.
Source run: `playwright.selection-verify.local.config.ts` (local, not
committed) against a private production build; specs
`tests/e2e/canvas/object-selection.spec.ts` and
`tests/e2e/canvas/select-subject.spec.ts`. Full record:
`docs/audits/smart-selection-2026-09-13.md`.

| File | What it shows |
| --- | --- |
| `select-subject-contour.png` | Model-free subject proposal applied as a pixel selection. The 1 px selection contour traces the red circle boundary exactly; the subject interior and the surrounding background are unmodified. |
| `one-prompt-after-removal.png` | After tapping the first of two include markers, exactly one prompt marker remains (the small white dot above it is the node transform handle). The Inspector prompt count read `1 prompt`. |
| `low-memory-refusal.png` | A real photo on a simulated 2 GB device: the typed out-of-memory refusal is shown and the canvas stays usable; no partial inference state is committed. |
| `real-model-preview.png` | Real SAM2.1 Hiera Tiny preview on the portrait fixture (cold path 27 s): the candidate overlay covers the prompted person while the wall stays unselected. |
| `real-model-applied.png` | Apply as mask with the real model: the person is cut out (hair and crossed arms kept) and the wall removed; provenance recorded `Mask score 88%` and undo/redo restored it. |
| `real-model-selection.png` | Use as selection from the reviewed candidate: the selection contour traces the same silhouette and committed in 1 s with no second encode/decode. |
