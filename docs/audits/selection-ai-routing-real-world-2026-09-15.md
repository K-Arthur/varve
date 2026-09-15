# Selection AI routing, portrait matting, and text discovery — real-world record (2026-09-15)

Status: **implemented and real-model verified at the engine/adapter level;
browser E2E and the full in-app text-query screenshot review remain
unverified.** This document is the evidence ledger for the three routes added
on top of the existing Object Selection and Background Removal systems.

## Changed scope

| Area | Files (primary) |
|---|---|
| MODNet portrait route | `packages/engine/src/backgroundRemoval/modnetPortrait.ts` (+ tests), `worker.ts`, `types.ts`, `modelSpec.ts`, `modelContract.ts`, `modelSelection.ts`, `modelInfo.ts`, `modelLoader.ts`, `providers/dispatch.ts`, `BackgroundRemovalSection.tsx` |
| EfficientSAM routing | `packages/engine/src/inference/inferenceWorker.ts`, `packages/engine/src/segmentation/promptedRouting.ts`, `providerValidation.ts`, `packages/editor/src/context/promptedSegmentationProvider.ts` (+ test), `useSam2Segmentation.ts` |
| Grounding DINO discovery | `packages/engine/src/discovery/groundingDino.ts` (+ tests), `inferenceWorker.ts`, `packages/editor/src/components/Inspector/sections/TextDiscoveryPanel.tsx`, `BackgroundRemovalSection.tsx` |
| Shared contracts | `packages/scene/src/types.ts`, `masks.ts`, `masks-types.ts`, `packages/editor/src/backgroundRemoval/commitRasterMask.ts`, model catalog/manifest entries |

Commit: `feat(ai): portrait matting, EfficientSAM routing, and text object
discovery` (implementation), plus the docs/website commit that carries this
record.

## Research inputs (accessed 2026-09-15)

Primary upstream contracts were inspected directly; the user-facing failure
modes below are from public practitioner reports, used to shape copy and
review gates rather than to change model behaviour.

### Hair, fur, and translucency

- `remove.bg` review (saascrmreview.com, 2026-01-11): "fine hair flyaways,
  glass/transparent items, shadow realism" are the weakest areas; roughly
  60-70% of flyaway detail preserved versus manual masking. Manual refinement
  remains the finishing step.
- Community report (community.adobe.com, 2026-08-25): the root cause of "mush"
  is resolution — engines segment at 1024x1024 (or 320x320) and stretch the
  mask over the full image, so thin stems vanish and pine needles become mush;
  holes inside a wreath retain background haze.
- DEV community analysis (2025-12-19): stray hairs are sacrificed for clean
  edges; dark-on-dark, backlighting, and motion blur are the failure triggers.
- Consequence for Varve: MODNet runs at the public checkpoint's 512-edge
  reference, and the existing refinement path re-estimates alpha at source
  resolution over a spatial unknown band. The UI copy explicitly does not
  promise recovered strands from a global blur, and the four-background
  composite evidence below is how a halo is checked.

### Click ambiguity

- `facebookresearch/segment-anything` issues #95 and #168, and SAM2 issue #252:
  additional points do not monotonically improve masks; multiple positive
  points are often interpreted as one union; multi-mask output encodes a
  part/whole scale hierarchy rather than separate object identities; results
  are sensitive to prompt placement.
- Practitioner analysis (abhik.ai, 2025-12-27): the three masks are
  subpart/part/whole readings; IoU ranking is weak, so user choice matters.
- Consequence for Varve: candidate cycling is preserved for every provider,
  candidate identity is pinned at Apply, and the UI copy now says a click is
  ambiguous between part/whole/group instead of implying a single correct
  interpretation. Near-duplicate suppression is conservative and only merges
  same-phrase boxes.

### Open-vocabulary detection

- Grounding DINO issues #84 and the ICLR 2026 "Fantastic tractor-dogs" paper:
  early-fusion open-vocabulary detectors produce confident false positives on
  background-only images; standard benchmarks hide this because they always
  contain the target class. Threshold tuning on a single image is unreliable.
- Practitioner guides (theneuralbase.com, msightflow.ai): concrete visual
  phrases work; abstract, negated, counting, or relational prompts do not;
  `box_threshold` and `text_threshold` filter different signals.
- Consequence for Varve: measured absent-object control is recorded below; the
  panel says scores are not proof, requires explicit review, and shows an
  honest empty state. The default threshold stays at the published 0.3 with a
  visible loose/balanced/strict control.

### MODNet domain limits

- MODNet paper (AAAI 2022) and repository issue #24: semantic estimation is the
  weaker branch; clothing may be mistaken for background, similar foreground
  and background colours blur the boundary, and the online demo uses an
  unpublished larger model. PPM-100 awards MODNet on hair/hollow structures
  but records failures on challenging poses/costumes. Motion-blurred video is
  an explicit non-goal.
- Consequence for Varve: only the public checkpoint is used and documented; the
  mode is never a general fallback; portrait video matting is out of scope.

## Real-model evidence

All numbers are Node CPU (`onnxruntime-node` 1.27.0, Linux x86_64) against
repository fixtures, which are rights-cleared real photographs (see
`tests/e2e/fixtures/PROVENANCE.md`). Evidence PNGs are written to `/tmp` and
are not repository assets.

### MODNet (26 MB public checkpoint, Xenova/modnet @ fa2fa546)

| Case | Source | Model input | Coverage | Fractional pixels | Inference |
|---|---|---|---|---|---|
| portrait (full-length) | 5171x6402 | 512x608 | 7.4% | 0.73% | 630 ms |
| braided portrait | 1920x2383 | 512x608 | 33.9% | 2.31% | 690 ms |
| bearded man | 1280x1600 | 512x640 | 75.3% | 7.96% | 557 ms |
| Katharine Hepburn portrait | 1280x1696 | 512x672 | 73.8% | 7.33% | 625 ms |
| elephant (out-of-domain control) | 1280x853 | 768x512 | 19.7% | 5.72% | 653 ms |
| beech forest (out-of-domain control) | 1280x853 | 768x512 | 2.3% | 4.05% | 543 ms |

Visual review: the Katharine Hepburn composite (black / white / saturated red /
checkerboard quadrants) shows soft hair edges with individual strands and no
visible halo at fit. The out-of-domain elephant produced a plausible and
clean animal matte including tusks; this is recorded honestly in the
architecture doc — the model is *presented* as a portrait route, not claimed to
be incapable elsewhere, and it is never used as a fallback. Reproduce with
`VARVE_MODNET_MODEL=/path/to/model.onnx pnpm exec vitest run
packages/engine/src/backgroundRemoval/modnetPortraitRealModel.test.ts`
(writes `/tmp/varve-modnet-results.json` and per-case evidence).

### Grounding DINO Tiny (INT8, 204 MB, onnx-community @ ff690b0a)

| Case | Prompt | Detections | Top score | Note |
|---|---|---|---|---|
| elephant | `elephant.` | 1 | 0.979 | box covers the whole animal |
| still life | `sunflower.` | 5 | 0.715 | multiple flowers preserved, same phrase |
| full-length portrait | `person.` | 1 | 0.907 | full-body box |
| Katharine Hepburn | `person.` | 1 | 0.845 | full-frame box |
| multi-phrase | `elephant. tree.` | 1 | 0.971 | phrase index 0 attributed |
| glass reflection | `glass.` | 1 | 0.302 | weak, above threshold |
| absent control | `dog.` on elephant photo | 1 | **0.708** | confident false positive; documented |

Tokenizer ids were parity-checked against the reference transformers.js
tokenizer (`a cat.` -> 101,1037,4937,1012,102; `café table.` -> 101,7668,2795,1012,102;
`person. dog.` -> 101,2711,1012,3899,1012,102). Peak process RSS for the
seven-case run was ~3.9 GB (memory is not returned between runs); the catalog
budget is 3.2 GB for admission. Reproduce with `VARVE_GROUNDING_DINO_MODEL` and
`VARVE_GROUNDING_DINO_VOCAB`; results land in
`/tmp/varve-grounding-dino-results.json` with overlay evidence per case.

### EfficientSAM-Ti (41 MB split, yunyangx/EfficientSAM @ 1cf49585)

The existing A/B decision stands: quality-equivalent to MobileSAM on the shared
corpus, larger measured peak working set, no mask-prompt input. What changed is
reachability: the production adapter now routes to the split graphs and the
real-photo gate still passes with zero split-vs-combined score and mask-logit
differences. The production-dispatch unit test asserts the exact worker graph
names, the pre-packed 1024-longest-edge `batched_images` tensor, int64 prompt
feeds, three-candidate decode, and the absence of a mask input. It remains
explicit-only and Auto never selects it.

## Six-gate ledger

| Gate | State | Evidence | Remaining |
|---|---|---|---|
| G1 ambiguous clicks | Implemented; verified at unit/real-model level | Candidate cycling/commit identity tests, MobileSAM real-photo gate, part/whole copy | In-app browser screenshot of cycling on a boundary click |
| G2 difficult boundaries | Implemented; real-model verified | Closed-form matting with spatial unknown band at source resolution; four-background composites | Numeric ground-truth alpha metrics on a licensed matting set |
| G3 multiple subjects | Implemented for proposals; unchanged promptable session | Existing subject-proposal picker + candidate ownership | Detector-assisted instance separation in the text path is proposal-only |
| G4 Grounding DINO | Engine + real-model verified; **in-app browser gate unverified** | Phrase-attributed detections on real photographs; absent-object control; UI panel presence E2E | Browser WASM did not finish in 15 min on the reference machine (no console error); see below |
| G5 EfficientSAM production | Implemented; adapter + real-model verified | Production dispatch test + split-vs-combined parity | Browser worker run on a real photo |
| G6 MODNet portrait | Implemented; engine + **browser E2E verified** | Contract tests + four-background composites + constraint fusion + in-app apply/undo gate | Save/reopen screenshot pass |

## Browser validation (headless Chromium, real photographs)

`tests/e2e/canvas/portrait-matting.spec.ts` passed twice (25.5 s and earlier
15-26 s runs) with the real 26 MB MODNet artifact served from
`/models/modnet-portrait/model.onnx`:

- Importing `real-life-katharine-hepburn.jpg`, selecting the Portrait method,
  and running the model in the browser worker produced a review, and
  `Apply result` committed an ordinary raster alpha mask on the layer
  (accessibility tree: "raster alpha mask"; panel provenance: `mask score 97%`,
  `portrait`). Show Original comparison was available, and Ctrl+Z removed the
  mask with no further model run.
- The Find-by-description panel renders its honest caveat and either its
  install affordance or query controls depending on whether the detector is
  mounted.
- `tests/e2e/canvas/text-discovery.spec.ts` is env-gated
  (`VARVE_TEXT_DISCOVERY_REAL_MODEL=1`). On the reference Linux machine the
  INT8 browser WASM run did not produce a reviewable region within 15 minutes,
  with no browser console error and no panel error — a real performance
  limitation for this graph on CPU WASM. As a result the panel now has a soft
  eight-minute deadline that aborts with an actionable message and a visible
  stage/elapsed status ("Preparing image" / "Loading detector model (first run
  can take minutes)" / "Detecting regions"). The engine Node gate remains the
  authoritative G4 verification; the in-app gate stays open.

Evidence screenshots are written under `test-results/run-*/canvas-portrait-*`
for each Playwright run and are not repository assets.

## Resource and performance measurements

- MODNet: ~0.5-0.7 s per 1-2K/5K photo at Node CPU; catalog budget 400 MB
  (estimated WASM working set, not measured).
- Grounding DINO: 16-31 s per 800x800 case at Node CPU INT8; ~3.9 GB peak RSS;
  catalog budget 3.2 GB, so low-memory sessions are refused before allocation.
- EfficientSAM: unchanged from the 2026-09-14 audit (548 ms cold load,
  2.9 s encode+decode at 1280x853, 731 MB peak).

## Validation performed

```bash
pnpm exec vitest run \
  packages/engine/src/backgroundRemoval/modnetPortrait.test.ts \
  packages/engine/src/backgroundRemoval/modnetPortraitRealModel.test.ts \
  packages/engine/src/discovery/groundingDino.test.ts \
  packages/engine/src/discovery/groundingDinoRealModel.test.ts \
  packages/engine/src/segmentation/promptedRouting.test.ts \
  packages/engine/src/segmentation/quality/efficientSamRealModel.test.ts \
  packages/editor/src/context/promptedSegmentationProvider.test.ts
```

- 45 focused unit tests and 4 gated real-model gates passed.
- `packages/engine` and `packages/editor` typecheck show no new errors versus
  the known baseline (LUT, content-aware-fill, geometry pre-existing failures).
- Biome (`check`, `format`) clean on changed files; repo `audit:emoji` clean.
- Engine background-removal suite: 530 passed, 8 failed — all 8 are the
  pre-existing `modelLoader`/`storedBlobIntegrity` failures reproduced on a
  pristine HEAD checkout.

## Explicit non-claims

- No "pixel-perfect", "instant", or "universal matting" claims.
- Text discovery is not OCR and not semantic understanding.
- MODNet is not the general-purpose default and not a video matting solution.
- EfficientSAM is not an automatic-routing win and not a mask-refinement
  provider.
