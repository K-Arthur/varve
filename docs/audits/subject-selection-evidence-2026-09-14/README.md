# Automatic subject-estimate evidence (2026-09-14)

Real-photo review of the shipped model-backed `Select subject` Fast level
(bundled U²-Net Light) through the actual browser pipeline. Produced by
`tests/e2e/canvas/subject-proposal.spec.ts` on Chromium with the Vite dev
server, worker-backed ONNX Runtime Web (WASM), no model download, and the
licensed fixtures listed in `tests/e2e/fixtures/PROVENANCE.md`. Each capture is
a canvas screenshot at fit-to-subject zoom taken from the passing run recorded
on 2026-09-14 (run directory `test-results/subject-proposal3`).

| Capture | Fixture (license) | What it shows | Review outcome |
| --- | --- | --- | --- |
| `still-life-mask.png` (SHA-256 `94416ddc…`) | `real-life-still-life.jpg` (public domain) | The active candidate applied as a document mask: the floral subject is cut out of the dark background; the sunflower, chrysanthemum, and roses keep their silhouette, and the dark surround is removed. | Pass for a 4.7 MB bundled model. A faint boundary band remains at the top of the yellow bloom; hair-thin petal edges would still go through Refine edges. |
| `portrait-hair-mask.png` (SHA-256 `0c179934…`) | `real-life-braided-portrait.jpg` (public domain, US) | The estimate found the oval portrait *inside* a rectangular scanned card and removed the card surround, keeping the girl, braided hair, and clothing. | Pass. Braid detail is retained at this zoom; no claim of alpha-matting quality — fine hair strands are not individually resolved. |
| `interior-room-outcome.png` (SHA-256 `adfb3ffb…`) | `real-life-interior-room.jpg` (public domain, US) | A cluttered interior where the foreground estimate selects the curtain/wall region and excludes the framed portraits, table, and chairs. | Honest weak case: the proposal is a plausible foreground *region*, not the user's likely intent. The panel presents it for review and the model-free/other levels remain one click away. This is why the copy never calls the result semantic subject detection. |

The E2E run also asserts, for the still life, that every candidate exposes a
coverage percentage in `1..99`, that applying a candidate produces a pixel
selection (the refine section appears), and that "Apply as mask" reports
success; the portrait and interior tests assert the provider label
(`U²-Net Light estimate`) and the review-before-applying copy. No synthetic
fixture is used for these three captures.

Limits of this evidence: one runtime (Chromium/WASM on CachyOS), one model
(U²-Net Light at its 320×320 analysis resolution), no quantitative ground
truth for real photographs (the synthetic parity corpus in
`docs/quality/object-selection-parity.md` remains the numeric gate), and the
screenshots cannot show sub-pixel hair or translucency behaviour.
