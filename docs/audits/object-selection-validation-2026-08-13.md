# Object Selection validation — 2026-08-13

This is a dated validation record for the Object Selection/SAM2 integration
work. It records the checks that were run in the shared development
workspace; it is not a claim that the release model corpus is complete.

## Passed

- `pnpm audit:docs`
- `node -e "JSON.parse(...)"` against `apps/desktop/public/models/manifest.json`
- `pnpm exec tsc --noEmit -p packages/editor/tsconfig.json`
- `pnpm exec tsc --noEmit -p packages/engine/tsconfig.json`
- Biome check on the touched Object Selection/runtime files
- `pnpm vitest run packages/editor/src/tools/Sam2SegmentationTool.test.ts packages/engine/src/segmentation/embeddingCache.test.ts packages/engine/src/segmentation/maskAlgebra.test.ts`
  (16 tests passed)
- Unit coverage of the Object Selection Inspector section (tool activation,
  session apply/cancel, Continue label, candidate cycling wrap-around and
  single-candidate suppression): `bgRemovalFeatures.test.tsx` green on three
  runs; workspace toolbar composition (`workspaceTypes`, `toolbarComposition`,
  `FloatingToolbar`) 71 passed.
- Website build: `pnpm --filter @varve/website build`
- Website Chromium/mobile visual check for
  `apps/website/tests/e2e/object-selection-feature.spec.ts`
  (1 test passed)
- Standard editor E2E (`tests/e2e/canvas/object-selection.spec.ts`): passed
  against the warm dev server — Adjustments tab, disclosure, tool activation,
  and the no-model download-requirement path all verified.

## Real-model verification (2026-08-14, late session)

Ran the full SAM2 pipeline in a real browser with the actual model files
(134 MB encoder + 20.6 MB decoder, SHA-256 pinned):

- Cold path (model load + encode + first prompt): 13 s to "Preview ready",
  94% model confidence, 3 candidate masks.
- Warm prompt on the same image (embedding cache hit): 1 s.
- Candidate cycling wraps (3 → 1); Apply commits a mask with provenance;
  Undo clears the provenance; Redo restores it.
- Overlay verified visually: 2.5% of the canvas painted in the mask tint at
  the cat subject, plus the prompt marker.

Two production defects were found and fixed during this verification:

1. **Inference worker broken in production builds.** The worker URL was
   routed through a constructor parameter, so Vite could not statically
   detect it as a worker; production builds emitted the raw `.ts` source as
   an asset and the browser refused to run it (worker died with an empty
   error). Fixed by placing the literal `new Worker(new URL(...))` pattern
   in `inferenceWorkerHost.ts`; the built asset is now a real bundled worker.
   This affected every worker-backed AI feature in production, not just
   Object Selection.
2. **SAM2 encoder rejected by ort-web wasm.** The upstream encoder declares
   empty value_info shapes on two outputs; ort-web's shape inference rejects
   the graph at session creation (ort-node tolerates it). The two
   metadata-only entries are removed by `scripts/models/repair-sam2-graph.mjs`
   (reproducible; bit-identical encoder outputs); repaired checksums are
   pinned for both tiny and small variants. The same defect blocks the
   packaged desktop app's webview path, so this repair is required before
   shipping.

The error path was also improved: "Model exceeds safe WASM memory limit" and
worker-start failures now map to actionable user messages instead of raw
backend text.

## Not passed / environment-limited

The editor Playwright check was run with an isolated port using
`VARVE_E2E_PORT=1422`. The repository warm-up reached Vite, but the initial
`page.goto()` exceeded the configured 180-second timeout while the shared
workspace was running several concurrent Vite, Vitest, and Playwright jobs.
The same interaction was then attempted against an already-running editor
server, which also remained in cold module transformation and was terminated
after it produced no assertion result. No Object Selection assertion failure
was observed; a real model-backed preview still requires the release corpus
and downloaded model files.

A later attempt against a pre-warmed Vite server (port 1431) succeeded
through navigation, image import, and layer creation with an extended-timeout
variant of the spec; the run then lost its renderer to out-of-memory while
activating the Adjustments tab (machine load 55-70, eight concurrent agents,
20 GB swap). The standard spec was updated to activate the Adjustments tab
explicitly — Object Selection lives there (auto-added for image selections in
every workspace) — so the previous properties-tab assertion could never have
passed. Run the spec on a quieter machine or CI before release.

## Deferred release gates

- Real-model SAM2 quality/parity corpus and cold/warm latency measurements.
- Visual review of mask quality on hair, fur, transparency, and rotated/cropped
  image placements.
