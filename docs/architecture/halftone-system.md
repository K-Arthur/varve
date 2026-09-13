# Halftone System

Halftone is a **non-destructive adjustment** in Varve's adjustment stack
(`AdjustmentNode.adjustments`), rendered by the engine's CPU screening engine
and exported through the same filter-compositing path used for canvas preview.

This document defines the canonical semantics: document units, screen
geometry, tone mapping, channel behavior, algorithm selection, alpha
handling, compatibility versioning, and export parity. It is the contract the
renderer, the UI, and tests must agree on.

## 1. Where halftone lives in the architecture

```
UI (HalftoneEditor in AdjustmentEditor.tsx)
  → Adjustment[] (HalftoneAdjustment) on AdjustmentNode
  → adjustmentToFilter() → FilterIR { kind: 'halftone' }
  → replay.ts → applyFilterWithCompositing() → applySoftwareFilter()
  → halftone.ts  applyAMScreeningV2 / applyOrderedDitherV2 / applyErrorDiffusionV2
       └─ halftoneScreen.ts (shared threshold matrices, sampling, blue noise)
```

`colorHalftone` is a separate **object filter** for creative RGB/CMYK/mono
screening. It shares `halftoneScreen.ts` geometry and tone helpers so the two
cannot drift.

- The **Adjustment[] stack** is the persisted, serialized document model.
- **FilterIR** is the portable render IR; it is never persisted.
- Scene persistence normalizes adjustments at the boundary
  (`packages/scene/src/adjustmentNormalization.ts`) and decides the
  compatibility version of pre-version documents.

### Algorithm versions

| Version | Semantics |
|---|---|
| 1 (legacy) | Pre-2026 screen: one threshold per whole screen cell (period multiplied by the matrix size), 72 ppi unit assumption, cyan/yellow sampled from the wrong channels, FM algorithm chosen implicitly, Bayer preview + Floyd–Steinberg export. Preserved pixel-exact for documents that predate the `algorithmVersion` field. |
| 2 (current) | Corrected contract described in this document. Newly created effects and presets use version 2. |

Documents without an `algorithmVersion` value are pinned to version 1 by the
scene boundary. The Inspector shows a **Legacy screen / Update to corrected
screening** affordance; updating keeps every other parameter and switches the
effect to version 2 as one discrete edit.

## 2. Canonical parameter model

| Parameter | Type | Default | Range | Units | Consumed by |
|---|---|---|---|---|---|
| `pattern` | `'dot' \| 'line' \| 'cross' \| 'circle'` | `'dot'` | — | — | Legacy shape alias (v1 effective shape; v2 keeps it in sync with `dotShape`) |
| `frequency` | number | `45` | engine 1–1000, UI 5–150 | LPI (lines/inch) | Cell period = `96 / frequency` document px |
| `angle` | number | `45` | 0–360 (normalized) | degrees | Mono screens only; CMYK uses per-ink angles |
| `dotShape` | `'round' \| 'elliptical' \| 'square' \| 'diamond' \| 'line' \| 'cross' \| 'circle'` | `'round'` | — | — | Canonical v2 shape |
| `channel` | `'k' \| 'c' \| 'm' \| 'y' \| 'cmyk'` | `'k'` | — | — | Ink selection / process separation |
| `method` | `'am' \| 'fm'` | `'am'` | — | — | Clustered-dot vs stochastic family |
| `algorithmVersion` | `1 \| 2` | `2` (new), `1` (pre-version docs) | — | — | Screen semantics |
| `fmAlgorithm` | `'blue-noise' \| 'bayer' \| 'error-diffusion'` | `'blue-noise'` | — | — | FM threshold source |
| `threshold` | number | `128` | 0–255 | 8-bit tone | Higher = less ink (`density − (threshold − 128)`) |
| `intensity` | number | `1` | 0–1 | mix | Linear blend between source and screened output |
| `softness` | number | `0` | 0–1 | — | Edge anti-aliasing range (threshold units ×64); endpoints never leak |
| `invert` | boolean | `false` | — | — | Swaps ink and paper coverage |
| `foregroundColor` | `[r,g,b]` | `[0,0,0]` | 0–255 | sRGB bytes | Mono ink color; separation preview ink |
| `backgroundColor` | `[r,g,b]` | `[255,255,255]` | 0–255 | sRGB bytes | Mono paper color |
| `alphaMode` | `'preserve' \| 'screen'` | `'preserve'` | — | — | Mono v2: `screen` writes ink with alpha = source alpha × coverage |
| `channelAngles` | `{c?,m?,y?,k?}` | standard press angles | 0–360 | degrees | Absolute v2 angle overrides per ink |
| `registrationOffset` | `{c?,m?,y?,k?}` pairs | `[0,0]` | doc px | doc px | Per-ink screen offset |
| `tacLimit` | number | `1` | 0–1 (1 = 400%) | scale | Total area coverage cap for CMYK |
| `blackGeneration` | `'none' \| 'gcr' \| 'ucr'` | `'none'` | — | — | K plate generation from min(C,M,Y) |
| `gcrStrength` | number | `0.5` | 0–1 | — | Amount of gray component moved to K |
| `previewChannel` | `'composite' \| 'c' \| 'm' \| 'y' \| 'k'` | `'composite'` | — | — | Show one separation instead of the composite |
| `dotGain` | number | `0` | 0–1 | — | Midtone coverage expansion `c + s·4c(1−c)` |

### Parameter discipline

- Every UI control maps 1:1 to a persisted parameter that the renderer
  consumes; there are no decorative controls.
- Validation happens at both boundaries: the scene normalizer clamps
  numeric ranges and enum values for imported documents, and the screening
  engine sanitizes at render time (non-finite → safe default), so malformed
  input degrades to the default look instead of blank output or a crash.
- `intensity`, `softness`, `dotGain`, `gcrStrength`, `tacLimit` are clamped
  to [0,1]; `frequency` to [1,1000]; `angle` wraps to [0,360).

## 3. Document units, geometry, and anchoring

- **Varve document units are CSS px at 96 ppi** (`@varve/shared` `units.ts`).
  A requested line screen of `F` LPI therefore has a cell period of
  **`96 / F` document px** (10 LPI = 9.6 px, 45 LPI = 2.13 px). The old
  hardcoded 72 ppi assumption was wrong by a factor of 1.333.
- The threshold matrix covers **exactly one cell** and is sampled per output
  pixel inside it. Fractional periods are retained; frequency settings are
  not snapped to integer cell sizes, so adjacent LPI values produce different
  screens instead of collapsing to the same output.
- **Screen phase is anchored in document coordinates.** Callers convert
  output pixels to document coordinates (`x / pixelScale + regionOrigin`) and
  pass the region's document origin. Panning, zooming, dirty-rect tiling, and
  export therefore never shift the pattern phase or change its physical
  frequency.
- **Export resolution**: the number of output pixels is
  `periodDoc × pixelScale`, where `pixelScale` is output pixels per document
  px. A 2x export resolves twice as many samples per cell but keeps the same
  document-space LPI. When the requested period is below ~3 output pixels the
  screen is beyond what the pixel grid can represent; the Inspector reports
  the document period and tells the user to raise export resolution rather
  than silently substituting a different frequency.
- `effectPixelExpansion` returns zero expansion for both filters: screening is
  strictly per-pixel (a pixel's threshold depends on its own tone and
  position, not on neighbors), so export bounds are not padded by a fake cell
  radius.

## 4. Tone domain and matrix construction

All version-2 paths screen **encoded sRGB values** (Rec.709 luma for the K
channel), so AM, ordered FM, and error diffusion agree on what "50% gray"
means. Legacy version-1 paths keep their original mixed encoded/linear
behavior for fidelity.

For a mono channel, per pixel:

1. Ink density is derived from the channel: `c = 1 − R`, `m = 1 − G`,
   `y = 1 − B`, `k = 1 − luma` (all 0–255, 255 = full ink).
2. Dot gain is folded in when enabled.
3. The threshold shift is applied: `density − (threshold − 128)`.
4. The threshold is sampled from the equalized matrix at the pixel's position
   in the rotated cell.
5. Coverage is binary, or a linear ramp of width `softness × 64` around the
   boundary. Endpoint guards guarantee that zero effective density stays
   clean paper and full density stays solid at any softness.
6. `invert` flips coverage.
7. Output is `bg + (fg − bg) × coverage`, blended with the source by
   `intensity`; `alphaMode: 'screen'` instead writes ink with
   `alpha = sourceAlpha × coverage`.

### Threshold matrix construction

Matrix values are **rank-equalized over the cell samples**: the spot field is
evaluated on an S×S lattice (S chosen from the device cell size), samples are
sorted, and thresholds are assigned `round(255·(rank+0.5)/S²)`. This is the
Krita-documented "template based equalization" approach: the inked pixel
fraction of a flat tone equals that tone to within `1/S²`, all seven shapes
share the same tone calibration, and both endpoints are exact
(`0 ≥ 1` false, `255 ≥ 255` true). The previous analytic spot function
assigned each pixel its own coverage value, which over-inked light tones by up
to 10% at small cells and gave cross/circle shapes visibly wrong coverage.

Matrix size follows the rendered cell (`round(cellDevicePx)`, clamped to
4–128) and is memoized by `(size, shape)`. A float-epsilon correction keeps
exact ratios such as `x/6` on the intended lattice point, which otherwise
drops one row/column per cell and causes per-cell tone drift.

### CMYK process screening

Version 2 treats CMYK as a documented **uncalibrated process preview**:

- Densities are `c = 1 − R`, `m = 1 − G`, `y = 1 − B` (encoded).
- Black generation moves the gray component `min(c,m,y)` to K according to
  `blackGeneration`/`gcrStrength`: `gcr` uses the full gray component, `ucr`
  only the shadow end, `none` leaves K empty.
- `tacLimit` caps total ink (`c+m+y+k` scaled proportionally).
- Each ink is screened at its own angle (standard C 15° / M 75° / Y 0° /
  K 45°, overridable per channel) with optional registration offsets.
- Four sub-pixel taps per channel estimate the channel's area coverage rather
  than point-sampling a rotated lattice; this removes the angle-dependent
  tone bias that tinted neutral patches. A one-sample edge blend is applied
  when the user's softness is 0 so hard process screens stay angle-neutral.
- `previewChannel` renders a single separation with the mono fg/bg colors.
- The composite is the standard subtractive overprint approximation
  `R = (1−C)(1−K)`, `G = (1−M)(1−K)`, `B = (1−Y)(1−K)`.

This is **not** an ICC separation, CMYK profile conversion, or RIP-ready
output. No profile or calibration math is implied. The Inspector says so.

## 5. FM algorithms and preview/export parity

`method: 'fm'` uses an explicit, persisted `fmAlgorithm`:

| Value | Behavior |
|---|---|
| `blue-noise` | 64×64 void-and-cluster threshold matrix (Ulichney), deterministic seed, indexed by document pixel. Default for new effects. |
| `bayer` | 8×8 Bayer ordered matrix, document-indexed. Legacy documents are pinned here so they keep their authored preview appearance. |
| `error-diffusion` | Serpentine Floyd–Steinberg on a single scalar density plane with exact error conservation and row-bounded kernels. Runs only when the caller declares a **full-frame** render (`fullFrame: true`, set by export paths). In region-tiled preview, the position-stable blue-noise screen is shown; the Inspector labels this so the substitution is explicit, and new effects default to blue-noise precisely to avoid the mismatch. |

The legacy implicit switch (offsets present → Bayer; absent → Floyd–Steinberg)
is gone for version 2: the presence of region offsets is not an algorithm
selector.

## 6. Alpha conventions

- Screening never invents alpha. Transparent pixels are skipped; partially
  transparent pixels keep their alpha and are screened in RGB.
- `alphaMode: 'preserve'` (default) is **alpha preservation**: source alpha in,
  source alpha out.
- `alphaMode: 'screen'` is a distinct, explicit **ink-on-transparency**
  operation: RGB becomes the ink color and alpha becomes
  `sourceAlpha × coverage`. It is available for mono screens and is not the
  same as preserving alpha or compositing on paper.
- Error diffusion processes a scalar density plane; transparent pixels are
  skipped without emitting error that could leak into opaque neighbours.

## 7. Effect-stack behavior, masks, and bounds

- Halftone is an ordinary entry in the `Adjustment[]` stack. It composes with
  every other adjustment (blur, curves, gradient map, ...) in stack order,
  with per-adjustment opacity and blend mode handled by
  `applyFilterWithCompositing` (offscreen surface → filter → composite).
  There are no halftone-specific bypasses.
- Adjustment scope (`AdjustmentScope`) determines which nodes the stack
  affects; the filter is applied to the scoped subtree's rasterized surface,
  which is already clipped to the scope bounds.
- Masking, clipping, and group isolation apply to the rasterized surface
  before screening, exactly like any other pixel filter.
- `colorHalftone` receives the same `coordSpace` anchoring as `halftone`; its
  version-2 screen is document-anchored and zoom-stable.

## 8. Preview and export parity

- Preview and export call the same functions (`applyHalftone` →
  `applyHalftoneV2` paths) with the same document-space coordinates and
  `pixelScale`. For AM and ordered FM, a given document coordinate renders the
  same threshold decision at any region origin; export also matches when the
  export surface's document origin is passed through `coordSpace`.
- Error diffusion is full-frame only, as described above.
- SVG/PDF codegen cannot encode a halftone structurally; the export pipeline
  rasterizes the affected subtree (with the full filter stack) and embeds the
  bitmap, so the effect is never silently dropped. Exported vectors elsewhere
  on the page remain vectors.
- The WebGPU compositor backend does not apply adjustment filters (documented
  limitation; halftone is CPU-only today). The standalone
  `colorHalftoneGpu` helper is not wired into the canonical compositor and is
  not advertised as a rendering path.

## 9. Presets

`HALFTONE_PRESETS` (engine) contains curated starting points (Newspaper,
Fine Print, Comic Dots, Coarse Dots, Lines, Vintage Screen, Stochastic Fine,
Zine Stochastic, Cross Hatch, Diamond Dots, Process CMYK). Presets initialize
canonical parameters and always set version 2; after selection they behave
like manually edited values. `HalftoneEditor` highlights a preset only when
the current parameter set (including FM algorithm and black generation)
equals that preset.

`COLOR_HALFTONE_PRESETS` follows the same rule for the object filter.

## 10. Performance

- Threshold matrices are memoized by `(size, shape)` (bounded at 48 entries).
- The blue-noise matrix is generated once per session (void-and-cluster with
  incremental Gaussian updates, well under the interactive budget) and
  memoized.
- AM processing is a per-pixel CPU loop (O(width × height)); CMYK performs
  four-tap coverage per ink. It runs on the main thread today; the cost
  drivers are surface area, LPI, and the CMYK tap count.
- The preview passes the visible region and its document origin, so only the
  visible area is processed.

## 11. Verification

- Unit: `packages/engine/src/halftone.test.ts` (legacy behavior and matrix
  APIs), `halftone.correctness.test.ts` (36 corrected-contract tests:
  measurable period, tone and endpoints for all shapes, channel mapping,
  GCR/UCR/TAC/preview/angles/offsets/dot gain, alpha screening, FM parity and
  error-diffusion edges, version-1 preservation), `colorHalftone.test.ts`.
- Integration: `filters.test.ts` (adjustmentToFilter round-trip),
  `replay-filter.test.ts` (routing to pixel compositing),
  `filterCompositor.test.ts`, scene `halftonePersistence.test.ts` and
  `adjustmentNormalization.test.ts` (version pinning and malformed input).
- E2E visual: `tests/e2e/canvas/halftone-visual.spec.ts` drives the real app
  (default render, frequency/angle change, invert, intensity identity,
  threshold shift, presets, pan/zoom phase, PNG/SVG/JPEG export, CMYK and
  color-halftone chroma, measured 12 LPI period, FM algorithm selection).
  Screenshots land in `test-results/halftone-visual/`.

## 12. Compatibility and migration

- Version 1 is **preserved, not migrated**: pre-version documents render
  exactly as authored until the user chooses Update in the Inspector.
- Version 2 is the only version new effects can be created with; presets set
  it explicitly.
- Adding new optional parameters does not bump any document schema: missing
  fields fall back to defaults at the scene boundary, and unknown future
  fields survive a round trip.

## 13. Known limitations (honest)

- CPU-only, main-thread processing; previews re-screen the affected region on
  each interaction rather than caching screened tiles.
- CMYK screening is an uncalibrated preview approximation, not ICC
  separation. No CMYK profile, dot-gain compensation curve, or press
  calibration is applied.
- Standard press angles are conventional defaults, not a universal
  moiré-free guarantee.
- Error diffusion is not available in tiled preview; new effects use
  blue-noise for full preview/export parity.
- Rotation of a discrete threshold lattice at very small cell sizes carries a
  small angle-dependent area bias; the four-tap CMYK sampling and edge blend
  reduce it, and export at higher resolution shrinks it further.
- Vector/text objects are affected through the adjustment stack's scoped
  subtree rasterization, never as geometry-level dot objects. There is no
  vector dot/line conversion export.
