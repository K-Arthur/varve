# Object Selection subject-selection pass — 2026-09-26

This record covers the 2026-09-26 subject-selection diagnosis and repair
pass: a fresh audit of the live Object Selection workflow (tool, inference,
mask/trim layer, docs/tests), repairs for the confirmed findings, and the
validation actually run. It complements the repair-validation record of
2026-09-02 and the real-model quality gate in
`docs/quality/object-selection-parity.md`. A companion record,
`docs/audits/object-selection-subject-audit-2026-09-26.md`, documents the
parallel reconciliation of this pass with the September 2/3 measurements;
the two records share the same working tree and commit history.

## Baseline

Master in a shared multi-session tree; the pass starts after
`25d761cb4` (docs(mockup)) and runs alongside unrelated parallel work in
the same working tree. The historically reported symptoms — a missing drag
rectangle, a tool that "does nothing", and trim timeouts — were rechecked
against the current checkout and are already repaired by earlier records
(draft-box publication, prompt persistence, cancellable deadlines). They
were not re-fixed here. No SAM2 model files were downloaded during this
pass, so nothing below claims new model-quality or latency measurements.

## Method

Four parallel read-only audits mapped the current state with file:line
evidence (tool/overlay frontend; inference pipeline; mask/trim/refinement
layer; docs/tests/validator), cross-checked against a web survey of
recurring user complaints about Select Subject / one-click cutout features
in Photoshop, Affinity Photo, GIMP, Photopea, Canva, remove.bg, and public
SAM/SAM2 demos. Each complaint class was triaged into (a) fixable by
design decisions, (b) inherent model-quality limits, and (c) pricing or
privacy complaints that a local-first app avoids by construction. The
repairs below are all class (a): trust design, not model quality.

## Confirmed findings and repairs

| Finding | Source location | Evidence | Severity | Repair | Acceptance |
| --- | --- | --- | --- | --- | --- |
| Multi-selection reached the mid-flight guards only after the encode ran; those guards return silently, leaving the session stuck on "encoding" with no error | `useSam2Segmentation.ts` entry checks | Entry checked node kind/image/src but not `selection.length`; mid-flight check (post-encode) returns `null` without `markFailure` | High | Entry gate refuses `selection.length !== 1` before any model work with an actionable announcement; unit test + E2E announcement assertion | `useSam2Segmentation.test.tsx` "refuses to run against a multi-selection before any model work" |
| A hidden or locked image could be segmented and its mask committed | `useSam2Segmentation.ts` entry checks | No `visible`/`locked` check anywhere in the pipeline | Medium | Entry gates refuse hidden and locked images with specific announcements | unit test "refuses a hidden or locked image before any model work" |
| Iterative refinement was dead code: `previousMask`/`mask_input` plumbed end to end but never sent, so every added prompt re-decoded from scratch and the mask could jump between whole-object and part readings | `promptedSegmentationProvider.ts` (`buildDecoderParams` sent only points/box/letterbox); `sam2.ts` returned one best-candidate logits set with swapped width/height | Grep: no production caller passed `previousMask`; decoder contract comment "Keep the full raw logits for future refinement" | High | Per-candidate low-res logits exported and published on session candidates; next decode conditions on the selected candidate's logits, strictly bound to the same ready session + source fingerprint + provider identity; dims swap fixed | `sam2.test.ts` per-candidate alignment; `promptedSegmentationProvider.test.ts` prior-mask round trip |
| Mask-source trim silently executed `resetToSourceBounds` on an empty/undecodable mask, un-cropping the image and clearing fit/rotation/flip as a "trim" side effect | `imageCrop.ts` `trimToSubject` final fallback | Alpha route threw `TrimBoundsUnavailableError`; mask route fell through to reset | High | Mask and combined routes throw `TrimBoundsUnavailableError`; UI already surfaces it inline; document untouched | `imageCrop.test.ts` rejection + crop-preserved tests |
| `decodeMaskDataUrl` read only the red channel, so white-RGB masks (depth workflow) re-decoded as fully opaque; "Refine edges" and trimap warm start silently destroyed committed depth masks | `maskOps.ts` `maskFromImageData`; `maskDecode.ts` | Depth workflow writes white RGB + alpha coverage (`depthMaskWorkflow.ts`); reader sampled byte 0 | High | Coverage resolves as `min(red, alpha)` — correct for all three encodings in use (all-channel, white-RGB + alpha, legacy RGB-only); shared by both readers | `maskCoverage.test.ts` mixed-encoding decode |
| An accelerated session that resolved after its creation deadline leaked its device heap inside the surviving worker | `inferenceWorker.ts` `getSession` | `withTimeout` abandoned the `InferenceSession.create` promise; a late session was dropped without `release()` and outside byte accounting | Medium | Late-arriving sessions are released (`withTimeoutReleasingSession`) on both accelerated and WASM creation paths | Type-level; hard to unit-drive a real late ORT session — reviewed against the timeout contract in `sessionRegistry.ts` |
| MobileSAM decoder fallback URL was missing `780` in the pinned revision — a 404 whenever the unified manifest was unreachable | `modelLoader.ts` `EXTENDED_MODEL_META` | Catalog pinned `0d3b4033…78089ddc8`; the loader fallback omitted it | Medium | Revision pin corrected to match the catalog | string-level; checksum verification at install remains the backstop |
| The preview was a blue tint over the marked region; nothing predicted what applying the mask would look like (recurring one-click-cutout complaint) | `overlayManager.tsx` object-selection renderer | Only tint mode existed; `maskPreviewMode` plumbing ignored by this renderer | Medium | Object-selection presentation modes: Overlay, Cutout (checkerboard fills the removed region, screen-constant tiles, cached composite per mask/tile), Off; panel `SegmentedControl`; mode lives on the transient session and survives re-runs | E2E spec (playwright run recorded in this pass's evidence); unit coverage of the session field |
| "Extract subject to a new layer" was promised by no surface and existed nowhere | repo-wide grep | No extract/copy-to-layer capability; the only mask-aware duplication was generic node duplicate | Medium | `operation: 'layer'` commit: deep-clone via `deepCloneSubtree`, insert directly above the source with a fractional order key between the source and its upper sibling, commit the reviewed mask on the copy, single `updateDoc` (one undo entry), copy becomes the selection; refuses without a reviewed preview | `extractSubjectLayer.test.ts` (root, group, no-inheritance, unknown-node cases); `useSam2Segmentation.test.tsx` layer commit |
| Refine brush never recovered after the target node object was replaced: every stroke refused with "Mask target changed" until the tool was reactivated | `RefineMaskTool.onPointerDown` | `loadMask` skipped when `maskData` existed; `targetStillValid` compares object identity | Medium | Pointer-down reloads the mask from the live node when the id is still selected; keyboard brush-size ceiling aligned with the inspector (100) | `RefineMaskTool.test.ts` suite passes |
| Feather was a generation-time parameter that provenance never recorded; the panel restored a stale default through an unchecked cast | `commitRasterMask.ts` `makeProvenance`; `BackgroundRemovalSection.tsx` seed | Cast `(maskProvenance as { feather?: number })` always read `undefined` post-commit | Low | `feather` added to `BackgroundRemovalProvenance`, persisted by the apply path, seeded through the typed field | `commitRasterMask.test.ts` suite passes |

## Doc/test repairs

- `docs/architecture/object-selection-system.md`: corrected the stale
  embedding-cache description; documented the extract output, iterative
  refinement binding, eligibility gates, and preview presentation modes.
- `docs/quality/object-selection-parity.md`: fixed the displaced
  `## Graph repair` heading; recorded the 2026-09-26 iterative-refinement
  and decode-convention follow-ups with their unit coverage.
- New E2E coverage for previously untested interaction-contract promises:
  reverse-direction box drag through the real pointer path, the 3 CSS px
  click-vs-drag threshold, and the multi-selection refusal announcement.
  Final spec state: **7/7 passing** in
  `tests/e2e/canvas/object-selection.spec.ts` (Chromium, 1 worker,
  lease-wrapped). Two authoring errors found by the run were fixed in the
  tests themselves (a drag starting on a marker is the move gesture; canvas
  clicks are prompts while the tool is active), and the run pinned two
  honest product behaviors: the Adjustments panel swaps to a multi-edit
  surface for two selected images (no Object Selection section there), and
  the low-memory refusal may report either the measured budget or the
  not-installed smaller provider.

## Website

`apps/website/src/pages/features/object-selection.astro` and the
`features.astro` index card now describe the cutout preview, candidate-
conditioned refinement, the three outputs including extraction, and trim's
fail-safe contract; `astro check` passes with 0 errors.

## Real-model browser verification (this pass)

The dev environment serves the repaired SAM2 Tiny artifacts locally, so this
pass could run the full workflow in Chromium on a synthetic still-life
(image: red apple with leaf and stem, blue cup, sky/table; 640×480 PNG
imported through the editor's file input). Captured evidence lives in
`docs/screenshots/2026-09-26-subject-selection/`:

| Step | Result | Evidence |
| --- | --- | --- |
| Cold prompted selection (one include point on the apple) | Preview ready · predicted IoU score 0.99 · prompt match 100% · 3 candidate masks; target evidence 100% anchored; candidate 3 of 3 ranked first | `01-preview-overlay.png` |
| Cutout preview mode | Checkerboard strictly outside the kept subject; kept pixels show untouched artwork | `02-preview-cutout.png` |
| Iterative refinement (second include point on the leaf) | Warm conditioned decode included the leaf while keeping the apple — the mask refined instead of re-reading the scene; diagnostics updated to "2 connected regions · include support 94%" with the honest disconnected-region warning | `03-refined-with-leaf-cutout.png` |
| Review gate + outputs | Review checkbox gates Apply as mask / Use as selection / Extract to layer; candidate cycling (Previous/Next) inspected | `04-reviewed-ready.png` |
| Extract to layer | Announcement "extracted to a new layer (predicted IoU score 0.99)"; new layer inserted above the source with the alpha-mask badge; provenance rendered in Background Removal; one Ctrl+Z removes the whole extraction | `05-extracted-to-layer.png` |
| Isolation check (source hidden) | Canvas shows only the extracted subject — apple, leaf, kept stem — placement preserved, no leftover background | `06-extracted-isolated.png` |

The run also caught a real defect the unit suite had missed: the cutout
preview erased its checkerboard with the overlay tint canvas (coverage ×
0.42 alpha), leaving ~58% of the checker visible inside the kept subject.
Sampling the live overlay showed kept-region alpha 140/255 instead of 0;
fixed by erasing with a full-alpha coverage canvas (commit `abc197352`) and
re-verified in `02-preview-cutout.png`.

A visual acceptance pass (independent reviewer over the six PNGs) judged
four of six pass outright. Two findings were raised and resolved:

- The action-button row clipped "Extract to layer" at the panel edge —
  fixed by letting the row wrap (`flex-wrap`).
- The extracted layer's mask badge was not visible in a static screenshot —
  this is the layers panel's documented narrow-width policy: badge groups
  the workspace does not pin (`mask` is unpinned in Design) reveal on row
  hover/focus and stay in the accessible name. The extracted layer's name
  was shortened (extension stripped) so the badge gets more room; no panel
  behavior changed.

## Deliberate non-goals (recorded, not fixed)

- **Shared inference worker is a cross-feature failure domain.** A SAM2
  encoder timeout terminates the worker and rejects pending jobs of every
  other consumer (depth, OCR, line art, inpaint, search). Isolation
  (per-feature workers or a job queue) is an architecture change needing
  its own benchmark evidence; documented in the runtime-boundary section.
- **Aborted-but-running decodes still occupy the worker thread** — ONNX
  Runtime has no portable mid-graph cancel; the host detaches the caller
  and rejects stale results, which is the documented contract.
- **Embedding cache `maxEntries: 2` binds before the byte budget** on most
  hosts. Raising the entry cap is a memory-behavior tradeoff to measure
  against the budget policy rather than a bug fix.
- **The provisional quality gate (IoU mean ≥ 0.80) has never passed** —
  the 2026-09-14 corpus run measured 0.654 and the thresholds remain
  deliberately unrelaxed; that gate stays a release boundary in the parity
  doc. Nothing in this pass changes model quality claims.
- **The Python validator is an independent reference, not a certification
  of the TS decode** — see the 2026-09-26 parity follow-up and the
  production-mirror reconstruction fixtures already in place.
- **`decodeMaskDataUrl` is DOM-bound** and therefore untestable in Node;
  the shared `maskCoverageFromPixel` rule carries the unit coverage.

## Validation run in this pass

See the Agent Validation Report in the session summary; targeted unit
files, affected typechecks, and the object-selection Playwright spec under
the heavy lease. The full suite was not run: the planner did not escalate,
and the parallel work sharing this tree owns the integration gate.
