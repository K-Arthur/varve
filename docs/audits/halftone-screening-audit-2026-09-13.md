# Halftone Screening Audit and Correction — 2026-09-13

Scope: the `halftone` adjustment and `colorHalftone` object filter across the
engine, scene persistence, editor UI, and export paths. Method: source
tracing, instrumented probes, failing regression tests, implementation,
unit/scene verification, and Playwright visual validation.

Canonical contract after this work: `docs/architecture/halftone-system.md`.

## 1. Confirmed defects and root causes

| # | Defect | Root cause | Evidence | Fix |
|---|---|---|---|---|
| A1 | Requested LPI did not match rendered period; higher frequencies collapsed to the same output | `screenChannelAt` indexed the threshold matrix once per whole screen cell (`round(rx / cellSize) % matrixSize`), multiplying the effective period by the matrix size (45 LPI rendered ≈ 9 LPI). Matrix size was `nextPowerOfTwo(cellSize*2)`. | Probe: freq 8 → 26.5 px run; freq 12 → 49.5 px run; freq 24 → no distinct dots. New tests measure 96/LPI within tolerance at 1x and 3x. | Version-2 core samples a single-cell matrix per output pixel; matrix resolution follows the device cell. |
| A2 | 72 ppi unit assumption | Cell period hardcoded `72 / frequency`; Varve document units are CSS px at 96 ppi (`packages/shared/src/units.ts`). | Source trace; 96/45 = 2.13 px vs the code's 1.6 px. | `DOC_PIXELS_PER_INCH = UNIT_TO_PX.in` in `halftoneScreen.ts`. |
| A3 | Tone not proportional to source; light tones over-inked by up to ~10 %; cross/ring shapes wrong | Analytic spot threshold assigned each pixel its own coverage value instead of an equalized distribution; small matrices quantized tone by pixel count. | Probe: gray 32 → 0.94 ink on a 0.875 target before equalization; shape table showed cross 0.375 at 0.75 darkness. | Rank-equalized matrix per cell; test asserts all seven shapes within ±0.03 of source darkness and exact endpoints. |
| A4 | Cyan and yellow sampled from the wrong channels; pure red screened as dark blue-black | `getChannelLuminance`: `c = 255 − B`, `y = 255 − R`; CMYK added a luminance-derived K on top of CMY. | Probe: `c` on red = 1.0 ink (should be 0), `y` on red = 0 (should be 1); CMYK red → (0,0,78). | `c = 1 − R`, `m = 1 − G`, `y = 1 − B`; min(CMY) black generation with optional GCR/UCR, TAC, plate preview. |
| A5 | FM algorithm switched implicitly on the presence of region offsets | `applyHalftone` chose Bayer when offsets were present and Floyd–Steinberg otherwise, so preview and export rendered different screens. | Existing test asserted the switch; E2E/preview mismatch class described in Adobe user reports. | Explicit persisted `fmAlgorithm`; ordered modes use document-anchored thresholds in both paths; error diffusion runs only for declared full-frame renders. |
| A6 | Error diffusion lost most of its error and wrapped across rows; linear-light domain made 50 % gray render ~100 % ink | RGB-weighted diffusion conserved only ~44 % of luminance error; `downLeft`/`downRight` guards were inverted for reversed rows; `srgbToLinear` + fixed 0.5 quantizer. | Probe: export ink 1.0 for gray 128; legacy guards inspected. | Scalar density plane, exact weights (7/16, 3/16, 5/16, 1/16), explicit x/y bounds, encoded tone domain. |
| A7 | Color halftone mono inverted polarity; white became black dots (mean ~72/255) | `screenPixel` used luminance directly as ink coverage and the shape field never reached cell corners. | Probe: white → mean 72; endpoints never solid. | Version-2 color halftone uses darkness coverage, min(CMY) black, document-anchored sampling, endpoint-complete matrices. |
| A8 | `dotShape` was a dead setting when `pattern` differed (Fine Print rendered round, not elliptical) | Compositor gave `pattern` precedence unconditionally. | Preset table vs probe of elliptical preset. | Version 2 treats `dotShape` as canonical with `pattern` as a legacy alias; version 1 keeps precedence exactly. |
| A9 | Print fields persisted but unused: `channelAngles`, `registrationOffset`, `tacLimit`, `blackGeneration`, `gcrStrength`, `previewChannel`, `dotGain` | Renderer never received them; compositor did not pass them. | Source trace. | All are consumed in version 2 with unit tests; UI exposes them under Advanced. |
| A10 | Angle-dependent tone bias between process screens tinted neutral patches | Point-sampling a rotated lattice estimates area with an angle-dependent error. | Neutral gray CMYK spread 8.7/255 before; <4 after. | Four sub-pixel taps per ink plus a one-sample edge blend for hard process screens. |
| A11 | Float lattice drift shifted a cell's sample set by one row/column per cell | `13/6 − 2 = 0.16666666666666652`, `× 6 = 0.9999999999999911`. | Probe per-cell ink counts alternated 32/30. | Epsilon-corrected index. |
| A12 | Fake cell-radius export expansion | `effectPixelExpansion` returned the cell size although screening is per-pixel. | Source trace. | Returns zero for both filters. |

## 2. Compatibility decision

Pre-version documents (no `algorithmVersion`) are pinned to version 1 at the
scene normalization boundary and keep their exact legacy rendering, including
the old geometry and Bayer FM preview. New effects and presets always
initialize version 2; the Inspector offers an explicit one-click upgrade for
legacy screens. Unknown enum values fall back to safe defaults; malformed
numerics are clamped at load and sanitized again at render time.

## 3. Verification

- 38 corrected-contract engine tests, updated legacy tests, compositor
  precedence tests, scene normalization/persistence tests.
- Playwright `tests/e2e/canvas/halftone-visual.spec.ts` drives the production
  UI; export tests inspect the written PNG/JPEG pixels and the SVG's embedded
  raster payload.
- Screenshots: `test-results/halftone-visual/` (run-specific output dirs under
  `test-results/run-*`).

## 3b. Export and object-filter wiring

- Export replay declares `fullFrame: true` (editor boundary rasterization,
  `exportRasterizedSubtree`), so an explicitly selected error-diffusion screen
  actually runs on export while previews stay position-stable.
- Object and group Object Filter surfaces now pass a document-space
  `coordSpace` (surface origin + capture scale) into the shared compositor, so
  pattern effects on objects are document-anchored like adjustment layers
  instead of being anchored to the object's local pixel grid.

## 4. Measured environment and limits

- Bench: `packages/engine/src/bench/halftoneScreening.bench.ts` (run
  explicitly; supersedes any numbers below once executed on a quiet host).
- Rendering remains CPU/main-thread; no worker/GPU screening backend is
  claimed. CMYK is an uncalibrated process preview, not an ICC separation.
- Dedicated procedural screentone fill generators and vector dot conversion
  remain deferred; the supported procedural workflow is screening an editable
  uniform/gradient vector fill (covered by the gradient metamorphic test).
