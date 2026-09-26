# Object Selection — subject-selection audit (2026-09-26)

Scope: audit the live Object Selection / subject-selection surface against the
claims in `docs/architecture/object-selection-system.md`, reproduce the
reported symptoms (missing drag rectangle, tool that does nothing, trim
timeouts), repair what is actually broken, and produce real-model evidence
that the mask the application commits matches a certified reference.

Starting point: `master` (local checkout ahead of `origin/master`), working
tree also carrying unrelated in-progress work (token sync, GPU rendering) that
was preserved untouched.

## Summary

Most of the September repairs held up. Of the reported symptoms, the drag
rectangle and "tool does nothing" classes are already fixed in code and covered
by tests; the trim class contained three real defects, all in the explicit
**trim source** handling. Two documentation/verification drifts were real: the
`SegmentationBackend` contract is not integrated, and the Python validator
reconstructed masks differently from production. Both are now corrected
(one by honest documentation, one by certifying both reconstructions and
adding a cross-language gate).

## Finding table

| # | Reproduction | Source location | Evidence | Cause (status) | Severity | Platforms | Repair | Acceptance check |
|---|---|---|---|---|---|---|---|---|
| 1 | Select an image with a raster mask → Inspector → Crop & Bounds → Trim to Subject → choose **Alpha** → Trim. Expected: bounds tighten to the source image's transparency. Actual: an existing crop is *reset to the full source* (the image un-crops). | `packages/editor/src/imageCrop.ts` `trimToSubject`; `packages/editor/src/imageBounds.ts` `computeVisibleContentBounds` | `source: 'alpha'` skipped the raster-mask asset, `computeVisibleContentBounds` returned its `source-alpha` fallback (the node's full shape bounds), the caller rejected that method, and control fell through to `resetToSourceBounds`. | **Confirmed** — the Alpha option was a UI label with no source-alpha implementation | High (silent document mutation) | All (browser + Tauri) | `source: 'alpha'` now performs a real pixel scan of the source alpha and maps it through `sourceAlphaBoundsToLocal`; failure/empty results throw `TrimBoundsUnavailableError` and leave the document untouched. | `packages/editor/src/imageCrop.test.ts` → `trimToSubject — explicit sources` (4 new tests); `tests/e2e/canvas/trim-sources.spec.ts` |
| 2 | Import a transparent PNG with **no** selection mask → Crop & Bounds → Trim to Subject. Expected: alpha trim available without a model. Actual: the Source control was not rendered and the Trim button was disabled; the only offered action was DETR "Detect Object Bounds" (downloads ~41 MB). | `packages/editor/src/components/Inspector/sections/ImageCropSection.tsx` (`hasMask && …`, `disabled={trimming \|\| !hasMask}`) | Existing comment in `tests/e2e/canvas/crop-workflow.spec.ts:88` claimed "even without mask, Trim shows alpha fallback" — the code did not do that. | **Confirmed** — promise/implementation gap; also violates "transparent PNGs must not require an unrelated AI mask" | High for transparent assets | All | Source control now always renders, defaults to Alpha when there is no mask, the Trim action is enabled for Alpha without a mask, and per-source hints state what each source needs. | `tests/e2e/canvas/trim-sources.spec.ts` (fails on pre-fix build: control absent + button disabled) |
| 3 | Choose **Combined** on a masked image whose source also has transparency. Expected: intersection of mask coverage and image transparency. Actual: mask bounds only — transparency ignored. | `imageCrop.ts` (`options.source !== 'alpha'` was the only branch) | Doc comment claimed "or let the bounds engine pick the best available" without ever reading source pixels. | **Confirmed** — under-implemented option | Medium | All | `combined` now intersects mask/vector/clip bounds with a source-alpha scan; if the source cannot be decoded, the mask result is still used (never a reset). | `imageCrop.test.ts` → "Combined source intersects mask bounds with source transparency" |
| 4 | A source that never fires `load` *or* error parks `decodeImageData` forever → the Trim button shows "Trimming…" with no error and no timeout. | `imageBounds.ts` `decodeImageData` | No deadline existed on the awaited `new Image()` promise (jsdom, detached blob, stripped asset payload). | **Confirmed** (hang risk; not observed to fire in production) | Medium | All, worst where image loading can silently stall | 15 s deadline + capability probe + per-source failure cache (60 s TTL, bounded at 64 entries) so a hanging source costs one attempt, not one per call. | `imageCrop.test.ts` "Alpha source with unreadable pixels rejects instead of resetting an existing crop" |
| 5 | Preview reaches `ready`; the announcer says "Press Enter to apply as a mask". Pressing Enter refuses with "Review the highlighted target first" because Apply/Enter require an explicit review confirmation. | `context/useSam2Segmentation.ts` preview announcement vs. the `reviewedCandidateKey` gate | Code-verified contradiction. | **Confirmed** — stale copy from before the review gate | Low (misleading guidance) | All | Announcement now names the review step. | `useSam2Segmentation.test.tsx` (announcement path); manual read |
| 6 | Documentation audit: is `SegmentationBackend` the integrated seam the architecture doc describes? | `packages/engine/src/segmentation/types.ts:93`; `docs/architecture/object-selection-system.md` | `grep -rn SegmentationBackend` → interface definition + re-export only: **zero implementers, zero call sites**. Live path is `promptedSegmentationProvider.runPromptedSegmentation`. | **Confirmed** — documentation drift (no code defect) | Medium (misleads future work into a non-existent layer) | All | Architecture doc now states the interface is a declared seam with no runtime implementation, and names the live path. | `pnpm audit:docs` clean; grep still shows definition + export only |
| 7 | Can the Python validator certify what the app commits? Its `mask_to_full_res` thresholds at the model input size and resamples NEAREST; production crops the low-res logits, resamples bilinearly, and thresholds once. | `scripts/validate-pipelines/validate_sam2_pipeline.py`; `packages/engine/src/inference/models/sam2.ts` `decodeSam2DecoderOutput` | Measured on identical real logits (below): agreement 0.907–0.993 IoU; production closer to ground truth on every non-square fixture. | **Confirmed** — real ordering drift, but production was the *more* accurate side | Medium (verification gap, not a product defect) | All | Validator now also certifies `mask_to_full_res_production` (line-for-line mirror of `sam2.ts`) against ground truth; `dump_sam2_fixture.py` + `sam2RealReconstructionParity.test.ts` decode the frozen real logits in TypeScript and assert both GT and cross-path agreement. | `validate_sam2_pipeline.py --synthetic` → 4 PASS (both IoUs); `SAM2_REAL_PARITY_DIR=… vitest run sam2RealReconstructionParity.test.ts` → 5 pass |
| 8 | Reported symptom: "missing drag rectangle". | `tools/Sam2SegmentationTool.ts` `onPointerDown`/`onDragMove`; `canvas/overlayManager.tsx:444-473` | Tool publishes `draftPoint`/`draftBox` synchronously on pointer-down; overlay renders drafts with a dashed stroke even with no model frame. Box is normalized from the gesture (not forced square), 3 CSS-px threshold, no positive point injected at drag origin. | **Not reproduced — already fixed** | — | — | None; now guarded by `tests/e2e/canvas/object-selection-draft-overlay.spec.ts` (pixel evidence captured mid-drag) | that spec |
| 9 | Reported symptom: "tool appears to do nothing". | `context/useSam2Segmentation.ts`; `components/Inspector/sections/BackgroundRemovalSection.tsx` | Stage states `preparing → encoding → decoding → ready` (or retryable `error`) are written to the session and rendered as `Preview ready · … / Drawing prompt… / taking longer…`; failures map to distinct codes (`model_not_installed`, `out_of_memory`, `prompt_out_of_bounds`, `source_changed`, …) rather than a generic timeout. | **Not reproduced** (on the code path; live run below) | — | — | None | live run |
| 10 | Reported symptom: "timeouts while trimming image bounds". | `imageBounds.ts` / `imageCrop.ts` | The only unbounded await on that path was the decode (finding 4); the DETR detection path already has a slow-state + cancel. | **Partially reproduced** — hang risk confirmed, deadline added | Medium | All | deadline + failure cache | finding 4 |
| 11 | Fast-Apply against a replaced image on the *same node* (same locator, changed bytes). | `useSam2Segmentation.ts` commit path | Commit re-reads the source (`readImageSourceIdentity`, cache evicted first) and compares width/height/fingerprint; also re-verifies node identity, mapping fingerprint, review key, mask geometry, coverage, and prompt containment before committing. | **Already guarded** — unit-tested | — | — | none needed | `useSam2Segmentation.test.tsx` → "refuses to commit when the source pixels changed after the preview", "…when the selected image changes after the preview" |
| 12 | Do the `selection` / `layer` operations do what their names imply? | `useSam2Segmentation.ts` (`operation: 'preview' \| 'mask' \| 'selection'`) | `selection` builds a real `AreaSelection` from mask coverage via `areaSelectionFromMaskCoverage` (with replace/add/subtract/intersect combination from the Inspector); `mask` writes a `RasterMaskAsset` through `commitRasterMask`. There is **no** `layer` operation and no extract-to-layer output anywhere in this surface. | **Verified** — names match behavior; the `layer` suspicion does not apply to the current code | — | — | none; extract-to-layer remains an unimplemented (and unadvertised) capability | `useSam2Segmentation.test.tsx` selection tests |
| 13 | Do refinement paths treat RGB or alpha as coverage? | `tools/RefineMaskTool.ts` `normalizeMaskImageData`, `packages/engine/src/segmentation/maskAlgebra.ts` | Mask writers emit white RGB + alpha coverage; every reader normalizes *from alpha*; `combineAlphaMasks` subtract is `round(a·(255−b)/255)` (never increases coverage), add is `max`, intersect is `min`. The algebra was correct but, until finding 16, unused in production. | **Verified correct**, incl. partial-alpha cases | — | — | none | `RefineMaskTool.test.ts` (subtract/restore against 128-alpha masks, snapshot restore), `maskAlgebra.test.ts` |
| 14 | Does "Object Selection model ready" appear when only part of a model exists? | `BackgroundRemovalSection.tsx:634-656`, `inference/backgroundRemoval/modelLoader.ts` `isModelAvailable` | Readiness is per-provider over **all** of its component ids (`availability.every(Boolean)`), partial installs report `partial` (button becomes "Retry …"), and split graphs with external weights require the data blob. Runtime capability (memory/provider) is enforced at inference with a specific message. | **Verified** — component-level, not parent-manifest-level | — | — | none | code review; live status line |
| 15 | Preview modes over busy artwork. | `tools/types.ts` `MaskPreviewMode` | `checkerboard`, `overlay`, `black`, `white`, `mask-only`, `edge` all exist. | **Verified** | — | — | none | code review |
| 16 | Apply as mask on a node that already carries a user-painted or AI mask. Expected: the existing coverage is not discarded without a say. Actual: `commitRasterMask` replaced the asset unconditionally, while `combineAlphaMasks` — the documented shared combination service — had **zero production callers**. | `backgroundRemoval/commitRasterMask.ts`; `packages/engine/src/segmentation/maskAlgebra.ts`; `BackgroundRemovalSection.tsx` | `grep -rn combineAlphaMasks packages apps` → definition + export + tests only. | **Confirmed** — silent overwrite + doc/implementation drift | Medium-High (loses manual refinement) | All | `applySam2Segmentation` takes `combination`; `buildMaskPayload` decodes the existing mask (alpha = coverage), combines, and refuses impossible combinations before any mutation. The Inspector offers Mask combination only when a mask exists, defaulting to Replace; the hint now says so. Exported at the engine root as `AlphaMaskCombineMode` (the depth-map module already owns `MaskCombineMode`). | 7 new tests in `useSam2Segmentation.test.tsx` (`Apply as mask combination`) + pre-existing `maskAlgebra.test.ts` |

## Measured reconstruction parity (real model)

Linux x86_64, onnxruntime 1.27 CPU, repaired encoder `b4cfd6c8…`, decoder
`f5a4bd65…` (matches `apps/desktop/public/models/manifest.json`):

| Fixture | production vs GT | reference vs GT | production vs reference | model IoU |
| --- | --- | --- | --- | --- |
| square 1024×1024 | 0.987 | 0.994 | 0.993 | 0.996 |
| wide 1920×1080 | 0.969 | 0.967 | 0.955 | 0.988 |
| tall 1080×1920 | 0.971 | 0.963 | 0.939 | 0.985 |
| panoramic 4000×800 | 0.939 | 0.918 | 0.907 | 0.971 |

Production and the independent reference differ by at most about one mask
pixel (bounding boxes within 16 px on the panoramic case, where one mask pixel
spans 15.6 source pixels), and production is closer to ground truth on every
non-square fixture. Method and gates:
`docs/quality/object-selection-parity.md` → "Mask reconstruction parity".

## Reconciliation with the 2026-09-02/03 repair record

`docs/audits/object-selection-repair-validation-2026-09-02.md` recorded five
symptoms and their fixes. Checked against the current checkout:

| Recorded symptom | Still fixed in this checkout? | Evidence here |
| --- | --- | --- |
| Drag box "appeared to do nothing" (tool kept the draft private) | Yes | `Sam2SegmentationTool.onPointerDown` publishes `draftPoint`/`draftBox` into `EditorState.objectSelectionSession`; `overlayManager` renders drafts with a dashed stroke before any model frame exists. Re-verified live by `object-selection-draft-overlay.spec.ts` (pixel evidence captured mid-drag). |
| Adding a point could discard a box | Yes | `onDragEnd`/`onPointerDown` keep `box` and `draftBox` separate; prompts append. Covered by `Sam2SegmentationTool.test.ts`. |
| Raw 30-second trim timeout | Yes | No caller-side `timeoutMs` remains on that path; deadlines live in `inferenceWorkerHost.ts` (`sam2-encoder` 180 s, `sam2-decoder` 60 s, `detr` 120 s, release 30 s) plus the documented soft deadline. |
| A timeout could poison retries | Yes | Hard timeout terminates the worker and rejects every other pending job with `worker_crash` ("Inference worker restarted after a timeout"), so unrelated jobs fail loudly instead of hanging. |
| Detector output silently treated as the subject | Yes | `ImageCropSection` ranks detections, requires review, and maps through the canonical placement; DETR remains bounds-only. |

The 2026-09-03 follow-up closed the missing model-install evidence (cold 22 s /
warm 2 s / 88% / undo-redo) and documented the misleading `cat.jpg` bytes. This
pass did not re-run that gate; those numbers are historical context, not fresh
measurements — the fresh real-model measurements in this document are the
reconstruction-parity table above.

What that record did not cover, and what this pass found: the explicit trim
sources (findings 1-4), silent mask replacement (16), the `SegmentationBackend`
documentation drift (6), and the production/reference reconstruction
divergence (7).

## Changes in this pass

- `packages/editor/src/imageCrop.ts` — explicit `alpha`/`combined` trim
  sources, `TrimBoundsUnavailableError`, `sourceImageData` injection.
- `packages/editor/src/imageBounds.ts` — exported `sourceAlphaBoundsToLocal`,
  bounded + cached decode.
- `packages/editor/src/components/Inspector/sections/ImageCropSection.tsx` —
  always-visible Source control, Alpha default without a mask, enabled trim
  action, error surface, truthful hints.
- `packages/editor/src/context/useSam2Segmentation.ts` — preview announcement
  names the review step; `combination` support with `buildMaskPayload`
  (fail-closed mask combination before commit).
- `packages/editor/src/components/Inspector/sections/BackgroundRemovalSection.tsx`
  — Mask combination control (only when a mask exists, default Replace).
- `packages/editor/src/tools/types.ts`, `context/types.ts`, `context.tsx`,
  `packages/engine/src/index.ts` — plumbing for `AlphaMaskCombineMode` and the
  root export of `combineAlphaMasks`.
- `packages/editor/src/context/useSam2Segmentation.test.tsx` — 7 combination
  tests (replace/arith/refusals/hook fail-closed).
- `scripts/validate-pipelines/validate_sam2_pipeline.py` — certifies the
  production reconstruction too, plus a panoramic case.
- `scripts/validate-pipelines/dump_sam2_fixture.py` — freezes one real run for
  cross-language comparison.
- `packages/engine/src/inference/models/sam2MaskReconstruction.test.ts` —
  model-free geometry gates (forward/inverse, padding isolation, independent
  official-order reference).
- `packages/engine/src/inference/models/sam2RealReconstructionParity.test.ts` —
  real-logit parity gate (skips without `SAM2_REAL_PARITY_DIR`).
- `tests/e2e/canvas/trim-sources.spec.ts`, `tests/e2e/canvas/object-selection-draft-overlay.spec.ts`
  — live regressions.
- Docs: `docs/architecture/object-selection-system.md` (backend seam + trim
  sources), `docs/quality/object-selection-parity.md` (parity method + numbers),
  `scripts/validate-pipelines/README.md`.

## Verification status (2026-09-26)

Deterministic and real-model work is complete; browser E2E is queued behind
the cross-worktree heavy lease, which other sessions held continuously for
over two hours (a single `fluidity final control-all` slice plus six other
waiters). Nothing below is claimed as run that was not run.

Run and passing:

- `npx vitest run` over the 16 selection/trim/inference suites — **289 passed,
  1 skipped** (the skip is `sam2RealReconstructionParity.test.ts` reporting
  *skipped*, not passed, when `SAM2_REAL_PARITY_DIR` is unset).
- `python3 scripts/validate-pipelines/validate_sam2_pipeline.py --synthetic`
  with the real repaired weights — 4/4 PASS for **both** reconstructions
  (table above).
- `npx tsc --noEmit -p packages/engine` — clean.
- `npx tsc --noEmit -p packages/editor` — one error, in another session's
  in-flight `tokenSync/importWorkflow.test.ts`; nothing in this change set.
- Tier 0 audits: `audit:docs`, `audit:emoji`, `audit:tokens` (+usage),
  `audit:spacing`, `audit:sizing`, `audit:inspector-css` — all clean.
- `pnpm typecheck:e2e` — clean (covers the two new specs).
- Every commit went through `pnpm verify:commit` (biome, emoji, health,
  impact-config, secret scan, contacts, docs, import boundaries,
  typecheck:e2e, and the selection unit slice).

Blocked by lease contention — exact remaining command:

```bash
node scripts/quality/heavy-lease.mjs "e2e: object selection live" -- \
  npx playwright test tests/e2e/canvas/object-selection-draft-overlay.spec.ts \
    tests/e2e/canvas/trim-sources.spec.ts --project=chromium --workers=1 --reporter=list

VARVE_SAM2_REAL_MODEL=1 node scripts/quality/heavy-lease.mjs "e2e: selection real model" -- \
  npx playwright test tests/e2e/canvas/object-selection-real-model.spec.ts \
    --project=chromium --workers=1 --reporter=list -g "clicks an object"
```

The two new specs are written and typecheck; they have not been executed, so
their assertions are unverified evidence until one of the commands above runs.
Tauri/WebKitGTK and Windows/macOS were not exercised by this pass at all.

## Known limitations / not covered here

- Extract-to-new-layer from a subject selection is not offered anywhere in the
  product surface; no UI promises it, so nothing is broken — but it remains a
  genuine workflow gap (see the capability matrix in the task).
- The catalog advertises `supportedProviders: ["wasm", "webgpu"]` for SAM2
  while the prompted path deliberately routes WASM only until a
  graph-specific WebGPU gate exists (`promptedExecutionProvider`). Cosmetic
  metadata drift; routing behavior is correct.
- `scripts/validate-pipelines/README.md` quotes the *upstream* encoder hash
  (`4cc015ee…`); the in-app manifest pins the *repaired* graph (`b4cfd6c8…`).
  Both are correct for their consumers (the Python validator reads upstream
  bytes; the app loader repairs then verifies), but the distinction is easy to
  misread — now stated in the README section added above.
