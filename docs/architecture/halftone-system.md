# Halftone System

Halftone is a **non-destructive adjustment** in Varve's adjustment stack
(`AdjustmentNode.adjustments`), rendered by the engine's CPU screening engine
and exported through the same filter-compositing path used for canvas preview.

This document defines the canonical semantics: coordinate system, tone
mapping, pattern units, color behavior, effect-stack behavior, and export
parity. It is the contract renderers, the UI, and tests must agree on.

## 1. Where halftone lives in the architecture

```
UI (HalftoneEditor in AdjustmentEditor.tsx)
  → Adjustment[] (HalftoneAdjustment) on AdjustmentNode
  → adjustmentToFilter() → FilterIR { kind: 'halftone' }
  → replay.ts → applyFilterWithCompositing() → applySoftwareFilter()
  → halftone.ts applyHalftone() / applyAMScreening() / applyBayerDithering()
    / applyFMStochastic()
```

- The **Adjustment[] stack** is the persisted, serialized document model.
- **FilterIR** is the portable render IR; it is never persisted.
- `filterCompositor.ts` maps the UI-level `pattern` to the engine `dotShape`
  (`dot→round`, `line→line`, `cross→cross`, `circle→circle`).

## 2. Canonical parameter model

| Parameter | Type | Default | Range | Units | Notes |
|---|---|---|---|---|---|
| `pattern` | `'dot' \| 'line' \| 'cross' \| 'circle'` | `'dot'` | — | — | High-level screen type; maps to `dotShape` |
| `frequency` | number | `45` | 5–150 (UI), clamped ≥1 (engine) | LPI (lines/inch) | Cell size = `72 / (frequency × pixelScale)` px |
| `angle` | number | `45` | 0–179 (UI); engine accepts any | degrees | Mono channels use `params.angle` directly |
| `dotShape` | `'round' \| 'elliptical' \| 'square' \| 'diamond' \| 'line'` | `'round'` | — | — | Engine primitive used by the AM matrix |
| `channel` | `'k' \| 'c' \| 'm' \| 'y' \| 'cmyk'` | `'k'` | — | — | Ink channel; `cmyk` locks angles to standard press angles |
| `method` | `'am' \| 'fm'` | `'am'` | — | — | AM clustered dot vs FM stochastic |
| `threshold` | number | `128` | 0–255 | 8-bit tone | Higher = less ink. Shift applied as `gray − (threshold − 128)` |
| `intensity` | number | `1` | 0–1 (clamped) | mix 0–1 | Linear blend between original and halftoned output |
| `softness` | number | `0` | 0–1 (clamped) | — | Dot edge anti-aliasing range; 0 = hard binary |
| `invert` | boolean | `false` | — | — | Swaps ink and paper coverage |
| `foregroundColor` | `[r,g,b]` | `[0,0,0]` | 0–255 per byte | sRGB bytes | Ink color (mono channels only) |
| `backgroundColor` | `[r,g,b]` | `[255,255,255]` | 0–255 per byte | sRGB bytes | Paper color (mono channels only) |

Print-oriented fields (`channelAngles`, `registrationOffset`, `tacLimit`,
`blackGeneration`, `gcrStrength`, `previewChannel`, `dotGain`) are part of
the persisted model and passed through the IR but are **not yet consumed by
the screening engine** (fixed standard angles are used for `cmyk`).

### Parameter discipline

- Every UI control maps 1:1 to a persisted parameter; there are no
  decorative controls.
- Validation/clamping happens at the renderer (`intensity`, `softness` are
  clamped; `frequency` is floored at 1; `cellSize` is floored at 2 px).
- Unknown/missing optional fields fall back to defaults at render time, so
  malformed persisted values degrade to the default look instead of crashing
  document load.

## 3. Coordinate system and phase stability

- **The screen is anchored in document (world) coordinates.**
  AM screening indexes the threshold matrix by absolute pixel position
  within the processed surface; FM preview (Bayer) indexes by
  `(pixel + offsetX, pixel + offsetY)` where the offsets are the
  document-space origin of the rendered region.
- **Panning and zooming never change the pattern phase.** The preview
  renderer passes the region's document-space offset into
  `applyHalftone(data, params, offsetX, offsetY)`; the Bayer path uses the
  document-absolute coordinates for matrix lookup.
- **Zoom changes dot geometry correctly** because the effect is computed on
  the surface at the current zoom resolution — dot density is defined in
  LPI (document units), not viewport pixels. At higher zoom, dots occupy
  more screen pixels; the pattern's document-space frequency is unchanged.
- **Export uses the same contract**: frequency is LPI at the export
  resolution (`pixelScale` = export scale / 72 DPI baseline), so a 2x
  export renders a 2x-denser screen in output pixels while preserving the
  same document-space LPI.

## 4. Tone mapping

For a mono channel, per pixel:

1. Luminance is computed from the selected channel (`k` uses Rec.709
   luma of the RGB bytes; `c/m/y` use the complementary channel).
2. The threshold shift is applied: `gray' = gray − (threshold − 128)`.
3. AM: ink coverage = `gray' >= matrixValue(x,y)` (softness adds a linear
   ramp around the boundary). FM: Floyd–Steinberg error diffusion
   (export) or Bayer ordered thresholding (position-stable preview).
4. Output = `bg + (fg − bg) × coverage` (mono), or the CMYK overprint
   approximation for `channel: 'cmyk'`.
5. `invert` flips coverage: `coverage' = 1 − coverage`.
6. `intensity` blends: `out = src + (screened − src) × intensity`.

### Threshold matrix construction (AM)

The clustered-dot matrix is built by **area-proportional (CDF-uniform)
thresholding**: for each dot shape a coverage function `f(dist)` gives the
fraction of the cell already covered when the growing dot reaches that
pixel, and the threshold is `255 × f` mapped into `[1, 255]`. This makes
ink coverage proportional to source tone (a mid-gray renders ~50% ink, a
light gray renders proportionally less). Coverage functions are normalized
to the `[-1, 1]²` cell area:

| Shape | Coverage f |
|---|---|
| round / elliptical | `min(1, π·d²/4)` (stretched for elliptical) |
| square | `min(1, max(\|dx\|,\|dy\|)²)` |
| diamond | `min(1, (abs(dx)+abs(dy))²/2)` |
| line | `min(1, \|dy\|)` |
| cross / circle | decorative normalizations |

Matrix values live in `[1, 255]` and the comparison is `>=`, so a
0-luminance source never inks (`0 >= 1` false) and 255-luminance always
inks (`255 >= 255` true) — no corner holes at the tone extremes. The
matrix size is clamped to ≥ 4 (a 2×2 matrix degenerates to a single
threshold). At 72 dpi, LPI above ~36 yields sub-2px cells and the screen
frequency degrades — a physical resolution limit.

**Color space notes (documented, intentional):**
- Luminance for screening is computed from sRGB-encoded bytes (Rec.709
  weights) for AM and from linearized sRGB for the FM/Bayer paths. AM
  thresholds are calibrated in encoded space, which matches how the
  threshold matrix values are defined (the area-proportional CDF is
  defined over the encoded-space 0..255 range).
- `foregroundColor`/`backgroundColor` are sRGB bytes interpolated in
  encoded space.
- Alpha is **never touched** by any screening path; partially transparent
  pixels keep their alpha and only RGB is screened.

## 5. Pattern types

- **AM** supports round, elliptical, square, diamond, line, cross, and
  circle (bullseye) dot shapes via the clustered threshold matrix.
- **FM** (stochastic) produces binary error-diffused output (export) or
  Bayer ordered dithering (preview).
- Pattern identifiers are stable strings (`dot`, `line`, `cross`,
  `circle`); the persisted model never depends on UI labels, so new
  patterns can be added without document-format migration.

## 6. Color modes

- **Mono (k/c/m/y)**: single ink screened against the paper; honors
  `angle`, `foregroundColor`, `backgroundColor`, `invert`.
- **CMYK**: each ink is screened independently at its standard press angle
  (C 15°, M 75°, Y 0°, K 45°) and recombined via an uncalibrated
  subtractive overprint approximation into an RGB preview pixel. This is a
  **preview approximation**, not a production RIP separation workflow;
  the UI labels it accordingly and no CMYK profile/ICC math is implied.
- **RGB screening** is not a separate mode of this adjustment; the
  separate `colorHalftone` adjustment provides RGB/CMYK/mono creative
  screening with its own presets (`COLOR_HALFTONE_PRESETS`).

## 7. Effect-stack behavior

Halftone is an ordinary entry in the `Adjustment[]` stack. It composes with
every other adjustment (blur, curves, gradient map, ...) in stack order,
with per-adjustment opacity and blend mode handled by
`applyFilterWithCompositing` (offscreen surface → filter → composite).
There are no halftone-specific bypasses in the pipeline.

## 8. Masks, clipping, and bounds

- Adjustment scope (`AdjustmentScope`) determines which nodes the stack
  affects; halftone leaks nothing outside the scoped subtree because the
  filter is applied to the subtree's rasterized surface, which is already
  clipped to the scope bounds.
- `effectPixelExpansion` in `adjustmentPipeline.ts` reports halftone's
  expansion (cell radius) so export bounds are computed correctly.

## 9. Preview vs export parity

- **Both paths call the same function**: `applySoftwareFilter` →
  `applyHalftone`. The only intentional difference is the FM method:
  preview uses position-stable Bayer dithering (with region offsets),
  export uses full-frame Floyd–Steinberg. Both preserve tone; the E2E
  parity smoke test exports PNG with halftone present.
- SVG/PDF codegen cannot encode a halftone structurally; the export
  pipeline rasterizes the scoped subtree (with the full filter stack)
  and embeds the bitmap, so the effect is never silently dropped.
- The WebGPU compositor backend does not yet apply adjustment filters
  (documented limitation; halftone is CPU-only today).

## 10. Presets

`HALFTONE_PRESETS` (engine) contains 9 curated starting points
(Newspaper, Fine Print, Comic Dots, Coarse Dots, Lines, Vintage Screen,
Stochastic Fine, Cross Hatch, Diamond Dots). Presets only initialize
canonical parameters; after selection they behave like any manually
edited values. `HalftoneEditor` highlights the matching preset when the
current parameter set equals a preset's values.

## 11. Performance characteristics

- The AM threshold matrix is memoized by `{size, dotShape}` (bounded at
  64 entries) — never regenerated per frame.
- The Bayer 8x8 matrix is precomputed once at module scope.
- Processing is a per-pixel CPU loop (O(width × height)); it runs on the
  main thread today. Large surfaces or high LPI are the cost drivers;
  the preview passes the region offset so only the visible area is
  processed.

## 12. Verification

- Unit: `packages/engine/src/halftone.test.ts` (71 tests: matrix
  generation, AM/Bayer/FM screening, CMYK alpha safety, threshold/
  intensity/softness, invert, foreground/background colors, presets).
- Integration: `filters.test.ts` (adjustmentToFilter round-trip),
  `replay-filter.test.ts` (halftone routed to pixel compositing).
- E2E visual: `tests/e2e/canvas/halftone-visual.spec.ts` — 10 tests
  driving the real app, asserting DOM controls and canvas pixel behavior
  (dot presence, frequency/angle pattern change, invert flip, intensity 0
  identity, threshold ink shift, preset parameter application, PNG export
  parity). Screenshots land in `test-results/halftone-visual/`.

## 13. Known limitations (honest)

- CPU-only, main-thread processing; no worker/WASM/GPU backend for the
  screening loops.
- CMYK halftone is an uncalibrated preview approximation, not ICC
  separation.
- `channelAngles`/`registrationOffset`/`tacLimit`/GCR fields are
  persisted but not yet consumed by the engine.
- FM preview (Bayer) and FM export (Floyd–Steinberg) are deliberately
  different algorithms; parity is tonal, not pixel-identical.
- Vector/text objects are affected via the adjustment stack's scoped
  subtree rasterization, never as geometry-level dot objects.
