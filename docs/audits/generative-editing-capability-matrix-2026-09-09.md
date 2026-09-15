# Generative editing capability matrix — 2026-09-09

## Evidence-based root-cause report

At the start of this implementation slice, the repository contained a partial
Content-Aware Fill implementation rather than a general Generative Fill
system. The useful pieces were real and tested:
PatchMatch is deterministic and offline; LaMa has a verified optional model
path and native desktop adapter; context extraction is bounded; image assets,
raster masks, history, save/reopen, and export already have canonical owners.

The initial incomplete behavior came from four boundaries:

1. The modal owns a painted mask and result only in React state. It does not
   derive or persist the user's canonical selection/mask recipe.
2. The apply path inserts a new image layer outside the normal transaction
   boundary, so the runtime warns that persistent history capture was bypassed.
3. The engine contract is named Content-Aware Fill and has only `fast`/`ai`
   quality. It has no operation mode, prompt/provenance record, variation
   identity, or stale-job state machine.
4. LaMa is image-conditioned, not text-conditioned. Treating its output as
   prompt-driven Replace would be misleading; Expand has no provider at all.

## Current capability matrix

| Capability | Existing implementation | Model/provider | Engine | Frontend | Mask behavior | Undo/redo | Serialization | Offline | Browser | Tauri | Export | Tests | Risk | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Raster selection to mask | Area selection, painted selection, source-pixel mapping | None | `selectionMask`, area-selection algebra | Selection tools and quick mask | 0 preserve / 255 selected | Selection history | Saved selections; derived masks | Yes | Yes | Yes | Existing raster paths | Unit + E2E | Large masks | partial, reusable |
| Object removal | Painted, selection, or layer-mask source + bounded context | PatchMatch or LaMa | `GenerativeEdit` job + source-safe composite | Generative Edit dialog, inspector/action/menu/palette | Source-pixel mask; invert, expansion, feather, context | One transaction; accepted layer selected | Result/mask assets + provenance record | Fast yes; LaMa after download | Worker path | Native LaMa | Ordinary image asset | Unit + real-photo E2E | Mask fidelity, memory | implemented locally |
| Generative Fill | Same mask workflow; prompt visibly marked non-conditioning locally | PatchMatch or LaMa | Mode-aware generative job | Fill/Remove/Replace/Expand tabs with capability gating | Painted, pixel-selection, or layer-mask input | One transaction; source untouched | Edit record links source, mask, variations, result | Fast yes; LaMa after download | Yes | Yes | Yes | Unit + real-photo visual E2E | Semantic quality | implemented locally |
| Generative Replace | Contract and disabled UI state | No verified prompt provider | Mode is represented; Generate gated | Prompt control plus honest provider note | Shared mask contract ready | No apply until provider capability | Schema supports mode/provenance | No provider | N/A | N/A | N/A | Gating assertions | Licensing/model gap | staged |
| Generative Expand | Contract, target-frame/aspect/anchor adapter, and disabled semantic path | LaMa/PatchMatch promptless reconstruction; no verified semantic outpaint provider | Mode, bounded plan, and source-preserving acceptance are implemented | Expand controls plus honest provider note | Shared mask contract ready | Promptless apply is transactional; semantic apply remains gated | Schema supports mode/provenance | Local promptless path only | Browser provider gated | Desktop limited path | Ordinary image export | Unit + real-photo boundary/qualification evidence | Semantic quality and platform evidence | limited local; semantic staged |
| Variations | Up to four transient candidates; deterministic seed advances per generation | Current local provider returns one candidate per job | Variation identity and accepted id recorded | Gallery, active candidate, Original/Result review | Same source mask/settings | Preview does not write history; selected candidate applies once | Accepted/all generated candidates embedded on apply | Yes | Yes | Yes | Yes | E2E apply/selection checks | Asset bloat | implemented locally |
| Job orchestration | Cancellable controller with source/session freshness checks | Worker/native calls | Typed error and capability contract | Generating, progress, cancel, stale/error states | Mask/settings changes invalidate candidate | Cancel/stale leave document unchanged | Accepted result is recoverable data | Local only | Yes | Yes | N/A | Unit + E2E | Stale results | implemented locally |
| Model lifecycle | Verified manifest + IndexedDB partials | ONNX models | Background-removal model store | Download dialog | N/A | N/A | Model not document data | Explicit download | Yes | Yes | N/A | Manifest/store tests | Quota/large model | complete for existing models |
| Source preservation | Derived image insertion | N/A | Existing asset dedup | Apply creates sibling and selects it | Existing source untouched | Apply is one editor transaction | Asset + edit record survive codec | Yes | Yes | Yes | Existing image export | Image/codec + Apply E2E | Asset bloat | implemented locally |
| Color/alpha | Existing ICC and alpha pipelines | Models are sRGB-like | CAF uses ImageData | No generative-specific status | Alpha convention implicit | N/A | Source metadata persists | Yes | Yes | Yes | Existing export | Color/alpha tests | Halos/profile mismatch | partial |
| Privacy | Local-first model policy | No remote generative provider | No upload path | AI model download copy | N/A | N/A | No credentials in docs | Yes | Yes | Yes | N/A | Offline/model tests | Future provider consent | complete boundary |

## Baseline evidence before the implementation slice

- `pnpm verify:plan` — no changed files detected.
- `pnpm verify:affected` — no changed files detected.
- `pnpm exec vitest run packages/engine/src/contentAwareFill` — 3 files,
  31 tests passed.
- `pnpm --filter @varve/engine typecheck` — passed.
- `pnpm --filter @varve/editor typecheck` — passed.
- `VARVE_E2E_PORT=1421 pnpm exec playwright test
  tests/e2e/caf/caf.spec.ts --project=chromium --reporter=list` — 13 tests
  passed. The run emitted the existing `updateDoc called outside transaction`
  warning on Apply/Undo flows.

No real model-quality corpus or peak-memory measurement was claimed in that
baseline: the existing browser path exercised the deterministic Fast provider,
and no licensed prompt-conditioned Replace/Expand model was installed or
verified in that environment.

## Implementation evidence — 2026-09-09

- Three public-domain photographic fixtures are used by the focused browser
  coverage: landscape, portrait, and still life. Their source URLs, licenses,
  dimensions, and checksums are recorded in
  `tests/e2e/fixtures/PROVENANCE.md`.
- The dialog E2E checks all four modes, mask-source controls, refinement
  controls, provider honesty, and photographic screenshots.
- The Apply E2E checks that the accepted generated layer is selected, that the
  source remains present, and that no outside-transaction history warning is
  emitted.
- Unit coverage exercises mask import, resize, dilation, feathering, invert,
  action registration, and the local engine paths.

Replace and Expand remain intentionally unavailable until the provider and
quality evidence described by ADR-0232 exist. The UI exposes their contract
and explains the boundary rather than presenting a non-functional prompt or
outpainting claim as shipped capability.

## Current-state addendum — 2026-09-15

The original matrix above records the baseline implementation slice. Since
then, the Expand geometry is implemented and tested independently of provider
quality: target aspect ratios, explicit output dimensions, source anchors, and
four-sided margins resolve to one non-cropping output frame. The retained
source is never rescaled, and a working frame is reduced aspect-preservingly
only when the device budget requires it. Prompt-model input now uses an
immutable model contract (the retained SD 1.5 diagnostic profile is exactly
512 × 512 at a 64-pixel granularity); non-square contexts are uniformly scaled
and letterboxed, with the mask transformed by the same mapping and the result
restored to the original context dimensions.

The shipped capability remains intentionally conservative: browser Fill/Remove
and the measured desktop promptless reconstruction path are usable, while
prompt-conditioned Replace/Fill/Expand remain unavailable until a model and
runtime pass the real-photograph quality gate. Desktop helper availability is
not treated as model readiness; only a qualified model handle enables the
prompt route. The focused readiness and real-landscape browser tests passed on
2026-09-15; semantic diffusion qualification, cross-platform native evidence,
and the full 24-photo/32-task release gate remain outstanding.
