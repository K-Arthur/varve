# Photo retouch extensions: selection clipping, alpha lock, pressure, camera-RAW refusal, dodge and burn

Date: 2026-09-25
Branch: `master`
Status: implementation evidence record; complements
`photo-raw-hdr-capability-audit-2026-09-13.md` without replacing it.

## Scope

The 2026-09-13 delivery shipped persistent retouching, a bounded DNG
development subset, HDR bracket merging with a range-bearing OpenEXR master,
and gain-map JPEG sharing. This session re-verified that baseline (89 focused
unit tests across `@varve/engine/raw`, `@varve/engine/hdr`, `@varve/scene`
retouch persistence/sampling, and `@varve/shared` range/encoding all passed on
the untouched tree) and closed the gaps the 2026-09-13 audits recorded as
open: Spot Heal and Patch ignored area selections, the compositor's alpha lock
was unreachable from retouch, retouch strokes carried no pen pressure, and
proprietary camera RAW files died inside the TIFF normalizer with an opaque
decode error. It also adds the one missing member of the local retouch family
the task's capability list names: a dodge and burn brush.

## Complaint-derived repairs

The 2026-09-13 audit already recorded the darktable source-anchor, Lightroom
healing-tool-switch, and Lightroom SDR-drift reports. Fresh research for this
session (performed 2026-09-25) added the selection-boundary class:

- Retouch bleeding past a selection is a long-standing complaint about soft
  brushes in general-purpose editors: guidance for Photoshop explicitly tells
  users to raise brush hardness so effects stop "bleeding beyond the selection
  boundary", and forum threads collect workarounds for tools that paint
  outside a selection (searched 2026-09-25: "photoshop clone stamp outside
  selection bleeding beyond selection boundary"; sources included
  [Adobe Community](https://community.adobe.com) healing/clone threads and the
  [Nondestructive editing guide](https://helpx.adobe.com) noting option-bar
  misconfigurations that make tools "ignore" constraints). Varve's defect was
  worse than soft-edge bleed: two of the four retouch tools ignored the
  selection entirely.
- Dodge/burn being destructive-only or missing is the recurring GIMP gap that
  pushes portrait retouchers into 50%-gray-layer workarounds (long-standing
  GIMP tool-parity complaint; the Varve fix reuses the exposure kernel's
  linear-light mathematics instead of a gamma-space brightness approximation).
- The 2026-09-25 search pass was rate-limited for several queries; citations
  above reflect the queries that returned evidence. The 2026-09-13 audit's
  complaint list remains the broader record.

### Direct user reports checked on 2026-09-25

These reports are anecdotal and often describe older releases. They identify
failure classes and user expectations; they do not establish that a current
competitor release still has the defect or reveal its internal algorithm.

- A darktable 3.0.0 user reported the clone/heal source being projected far
  outside the target while editing a path. That is the failure class behind
  Varve's world-space source anchor, source marker, and transform-aware mapping:
  [darktable issue #4388](https://github.com/darktable-org/darktable/issues/4388).
- A 2024 darktable user described heal output as blur when a dominant shape
  confused the blend and used clone first, then heal to soften the seam. A
  2022 discussion separately reported smudging near a crop edge and slow
  performance on extensive scratch removal. Varve keeps exact clone, local
  mean-shift heal, and bounded Spot Heal distinct, and documents source/edge
  limitations instead of calling every repair content-aware:
  [heal blending discussion](https://discuss.pixls.us/t/retouch-module-heal-function-is-giving-me-a-blur-answered/45089),
  [crop-edge and performance discussion](https://discuss.pixls.us/t/having-issues-with-retouching-near-edges-of-cropped-image-i-found-a-solution/33357).
- A Lightroom Classic user said the healing brush was nearly unusable when the
  source guide disappeared; the accepted answer traced it to the overlay
  setting being set to Never. Varve's clone/heal source marker stays visible
  while the anchor is active, so a hidden-overlay preference cannot silently
  remove that feedback:
  [Adobe Community source-overlay report](https://community.adobe.com/questions-680/spot-healing-brush-does-not-show-source-when-healing-917538).
- Lightroom HDR merge users have reported visible deghost artifacts and
  noisy dark regions when exposure samples are selected. Varve exposes its
  reference and conservative motion exclusions, retains the master, and
  labels its rendered-input route exposure fusion; the current translation
  aligner and synthetic radiance tests do not establish a universal fix for
  foliage, parallax, highlight flicker, or noise-optimal weighting:
  [HDR merge artifact discussion](https://community.adobe.com/questions-675/lightroom-hdr-merge-issues-980223),
  [dark-region noise report](https://community.adobe.com/questions-675/lightroom-heavy-noise-after-hdr-blending-971865).

The response is deliberately bounded: visible source/target state, distinct
clone/heal semantics, selection-safe edits, explicit baked-revision warnings,
and honest merge labels are verified here. The reports do not justify claiming
that Varve eliminates every healing artifact or is equivalent to a proprietary
RAW converter.

### Primary-source refresh checked on 2026-09-25

- Adobe's [DNG specification and SDK page](https://www.adobe.com/support/downloads/dng/dng_sdk.html)
  listed DNG 1.7.1.0 (September 2023) and DNG SDK 1.7.1 Build 2724
  (September 8, 2026). This confirms the current public format reference; it
  does not expand Varve's classic, uncompressed Bayer/mono DNG subset. The SDK
  is not added as a dependency; bundled SDK redistribution and license terms
  would need a separate review.
- The [LibRaw project page](https://www.libraw.org/) listed stable 0.22.2 and
  says its retained dcraw-derived postprocessing is not intended as
  production-quality rendering. [LibRaw's API/licensing docs](https://www.libraw.org/docs)
  describe native access to sensor data and the LGPL-2.1/CDDL-1.0 alternatives.
  This supports keeping the browser-safe decoder small and explicit while a
  native provider remains unselected pending pinned camera coverage, build,
  redistribution, and resource evidence; LibRaw support is not a universal
  camera-rendering claim.
- The [OpenEXR technical introduction](https://openexr.com/en/latest/TechnicalIntroduction.html)
  defines HALF and FLOAT channels, channel sampling, data/display windows, and
  linear RGB conventions. Varve's uncompressed, one-part RGB(A) subset and
  explicit rejection of unsupported EXR structures remain a subset claim.
- Google's [Ultra HDR v1.1 format documentation](https://developer.android.com/media/platform/hdr-image-format)
  (last updated October 25, 2024) recommends carrying both Ultra HDR v1 and
  ISO 21496-1 gain-map metadata and preferring ISO metadata when both are
  present. That is the metadata behavior already implemented and independently
  checked with libultrahdr; it is not a claim about every Android viewer or
  HDR display.
- Chrome's [WebGPU 129 HDR note](https://developer.chrome.com/blog/new-in-webgpu-129)
  documents `rgba16float` and `toneMapping: { mode: "extended" }` as an API
  route. API availability is not evidence of OS composition or display
  luminance, so Varve's physical HDR presentation status remains unverified.
- The [darktable 4.6 manual](https://docs.darktable.org/usermanual/4.6/en/module-reference/processing-modules/retouch/)
  is a versioned stable manual; the [development manual](https://docs.darktable.org/usermanual/development/en/)
  explicitly tracks the current development build. The report uses the stable
  manual for user-facing clone/heal concepts and does not treat development
  documentation as proof of a released implementation.

## Changed contracts

| Change | Owner | Notes |
| --- | --- | --- |
| `selectionCoverageForRect` | `packages/editor/src/tools/selectionCoverage.ts` | Rasterises a selection over one layer-local rectangle. A non-intersecting selection or a singular transform yields an **empty** mask (paint nothing), never `null` (unrestricted) — patch had the fail-open case before this fix existed. |
| Spot Heal/Patch selection clipping | `SpotHealTool.ts`, `PatchTool.ts` | Patch rasterises coverage over the target rectangle; Spot Heal reuses the bounded per-dab mask. Non-intersection surfaces through the existing "no valid pixels" announcements and no history step. |
| Retouch alpha lock | all four tools + `RetouchToolOptions.tsx` | The compositor's `alphaLock` existed since the 2026-09-13 slice but no tool exposed it; all four now do. Dodge/burn deliberately has none — it cannot create coverage. |
| Retouch pen pressure | `CloneStampTool.ts`, `HealingBrushTool.ts`, `DodgeBurnTool.ts` | A flow dynamics mapping with the identity bezier maps pressure p to a 2p multiplier: mouse (0.5) and pressure-disabled deposits stay byte-identical; a pen at full pressure reaches full flow. Pen-only (`pointerType === 'pen'`), because mouse pressure is a constant and synthetic events report 0. |
| `camera-raw` import family | `packages/import/src/formatCapabilities.ts`, `service.ts` | New container capability (`import.level: unsupported`) covering CR2/CRW/CR3/NEF/NRW/ARW/ORF/RW2/RAF/SRW/PEF by vendor extension, RAF magic (`FUJIFILM`), CR3 ftyp brand `crx `, and TIFF signature plus vendor extension. The importer refuses with the exact recovery boundary (classic, uncompressed 2x2 Bayer or monochrome DNG) instead of failing inside UTIF; compressed DNG and unsupported sensors are named, and the raster fallback excludes camera RAW so no embedded preview is ever promoted. |
| Dodge & burn | `packages/scene/src/retouchRaster.ts`, `packages/editor/src/tools/DodgeBurnTool.ts` | Signed exposure in stops under the brush mask: sRGB byte → linear → `× 2^(±exposure × coverage × range weight)` → sRGB byte, with the same IEC 61966-2-1 transfer constants as the engine exposure kernel (`adjustmentPipeline.ts` `srgbToLinear`/`linearToSrgb`). Range focus weights are strictly positive away from the extremes so shadows/midtones/highlights adjust emphasis rather than masking pixels out. Registered in the tool registry, Photo/Draw retouch flyouts, and toolbar retention at the same priority as the other retouch brushes. |

## Verification

Numeric anchors (deterministic, asserted in `dodgeBurn.test.ts`):

- sRGB 128 with a +1 stop midtones dodge at full coverage encodes back to
  exactly 176; a −1 stop burn gives exactly 92 — hand-computed IEC round-trip
  values, matching the engine kernel's `applyExposure` at offset 0/gamma 1.
- Pure white/black are byte-identical under dodge/burn (no invented detail, no
  clipping at the encoding ceiling); zero exposure returns the same node.
- Alpha is never created or changed; empty tiles are never allocated.
- A shadows-weighted burn darkens a dark sample far more than a bright one;
  coverage (including the empty mask) gates every pixel.

Browser coverage added (Playwright, real pointer interaction; run status is
recorded in Results):

- `retouch-tools.spec.ts` gains a Dodge Burn browser test: clone-deposit onto
  the repair layer, then dodge must raise the sampled region luminance and a
  mode-switch burn must lower it, with the tool options panel asserting the
  mode/range controls.
- `photo-raw-hdr.spec.ts` gains the recorded-unverified chain test: develop a
  real DNG (Leica M8 fixture, sha256-pinned in
  `tests/fixtures/photo-raw-hdr-corpus.json`), prepare retouch layers, heal on
  the repair layer through the real canvas, change the upstream exposure,
  re-develop, and assert (a) the stale-repair warning appears, (b) repair-layer
  tile bytes and the locked `Photo pixels` snapshot remain hash-identical, (c)
  the hidden original's RAW recipe changes without silently rewriting the
  visible baked snapshot, and (d) staleness plus repair bytes survive
  save/reload/reopen. This is Varve's chosen baked-revision policy: reopening
  the original RAW recipe does not implicitly rebase the displayed retouch
  stack; the warning asks for an intentional rebase or reapply.

## Results

Recorded on 2026-09-26 (this machine, Linux, Chromium):

- Unit: 708 tests across scene retouch, dodge/burn, editor tools, and
  workspace config suites — passed.
- The final focused Dodge Burn and RAW-revision-chain browser cases were **not
  run**. Their lease-wrapped Chromium command remained queued behind the active
  shared owner `fluidity mine-slice-02`, which was running a 46-spec browser
  batch. The owner was still active after about 50 minutes; the queued command
  was stopped without bypassing the memory/lease gate. These cases have no
  pass/fail result yet.
- Earlier browser flows passed for DNG development; bracket review, EXR/SDR
  output and reopen; Healing Brush; Spot Heal/Patch; and clone target safety.
  Reviewed app captures include `reports/ui-review/retouch/01-healing-brush-painted.png`,
  `02-spot-heal-painted.png`, `05-target-safety.png`,
  `reports/ui-review/photo-raw-hdr/03-bracket-review.png`, and
  `06-hdr-master-output-transform.png`. The newly added final cases still need
  their dedicated browser run.
- Website production build passed (Astro generated 108 pages with no errors or
  warnings). Visual checks covered `/features`, `/features/retouching`,
  `/features/raw-hdr-photo`, `/docs/tools/retouching`, and
  `/docs/file-formats` at 1440px desktop and 390px mobile widths; all ten
  route/viewport checks had no horizontal overflow. Desktop and mobile
  retouching pages plus the mobile RAW/HDR feature page were visually reviewed.
- Import refusal: a TIFF-magic `.nef` is refused as `camera-raw` with the DNG
  conversion route (service-level test), and a real TIFF keeps its format.

## Remaining limits

- Retouch storage remains RGBA8; the SDR boundary statement in
  `photo-raw-hdr-system.md` is unchanged and dodge/burn inherits it (it is an
  8-bit working-surface operation by the same documented contract).
- Spot Heal's single click-to-fix dab does not scale with pressure; tilt is
  still unmapped for retouch.
- Camera-raw detection is honest refusal, not decoding; native
  LibRaw/RawSpeed/Rawler integration remains future work with the same
  license/build conclusions as 2026-09-13.
- Physical HDR display presentation remains unverified (no hardware claim).
- Large-source performance is not certified: the earlier audit records one
  local 10.3 MP DNG observation (4.04 s decode; 20.05 s development), but this
  change did not run a controlled 12/24/48 MP or multi-frame scaling matrix,
  p50/p95 interaction timing, or peak-memory capture. Constrained 4 GB-class
  behavior therefore remains unverified; the single-camera observation is not
  a general performance claim.
