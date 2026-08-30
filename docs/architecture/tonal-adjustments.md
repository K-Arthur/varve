# Tonal Adjustments Architecture

**Status:** current · **Scope:** Threshold, Gradient Map, and Color Balance

This document records the current implementation boundary for the three
tonal adjustments. They use one adjustment/filter pipeline and separate scalar
kernels. The shared pipeline owns validation, scope, history, opacity, blend,
masking, persistence, and export; the kernels own only pixel mathematics.

## Executive diagnosis

| Adjustment | Current maturity | Canonical implementation | Main limitation |
| --- | --- | --- | --- |
| Threshold | Vertical slice | `threshold.ts` + Adjustment Panel editor | RGBA8/Canvas2D reference path; no GPU kernel |
| Gradient Map | Vertical slice with preset/import support | `gradientMap.ts` + `GradientMapEditor` | Wide-gamut/HDR/ICC-accurate effect math is deferred |
| Color Balance | Vertical slice | `colorBalance.ts` + tonal-range editor | CPU reference path; native/WebGPU acceleration is not claimed |

The catalogue is centralized in `packages/engine/src/filters.ts`:
`ADJUSTMENT_KINDS`, the `Adjustment` union, defaults, and
`adjustmentToFilter`. `packages/scene/src/adjustmentNormalization.ts` is the
untrusted-document boundary. There is no second mathematical implementation
in the editor: the editor emits adjustment patches and the compositor invokes
the engine kernel.

## End-to-end map

```text
Add Adjustment / Inspector
          │ typed patch + transaction
          ▼
AdjustmentNode.adjustments or node.smartFilters
          │ normalize on document decode
          ▼
adjustmentsToFilters → FilterIR
          │ resolve scope, render backdrop, apply mask
          ▼
Canvas2D/software reference compositor
          │ optional provider; CPU fallback is authoritative
          ▼
RGBA surface → canvas / thumbnail / raster export
          │
          ├── DocumentCodec save/reload
          └── SVG/PDF preflight → affected subtree rasterization
```

Object Filters remain node-local; Adjustment Layers resolve a target scope.
Both lower to the same `FilterIR` and apply per-entry opacity/blend exactly
once in the compositor. Adjustment masks are applied after the filtered scoped
backdrop and do not change target selection. The complete attachment and mask
contract is in [non-destructive effects](non-destructive-effects.md).

## Shared pixel contract

At the current kernel boundary, input and output are straight-alpha RGBA8
`ImageData`. Colour-only kernels preserve source alpha and preserve hidden RGB
under fully transparent pixels. Spatial sampling uses premultiplied-safe
intermediates where required. The display-byte boundary is explicit; the
document’s `ManagedColor` model is richer than this current effect surface.

This means the following are implemented and tested:

| Contract | Evidence |
| --- | --- |
| One canonical schema and defaults | `filters.ts`, `adjustmentNormalization.ts` |
| Versioned scalar semantics | `algorithmVersion: 1` on all three adjustments |
| Shared opacity/blend ownership | `filterCompositor.ts` and compositing tests |
| Scope and mask separation | `non-destructive-effects.md`, adjustment-scope tests |
| Save/reload normalization | `adjustmentNormalization.test.ts`, `DocumentCodec` |
| Unsupported runtime visibility | `FilterDiagnostic` in `filterCompositor.ts` |

## Threshold

`ThresholdAdjustment.level` is normalized to `[0, 255]`. Version 1 supports
`relative-luminance`, `average-rgb`, and `max-channel` source modes. The
default relative luminance is the Rec.709 weighted sum of straight RGB
channels. A pixel is white when `luminance >= level`; otherwise it is black.
The comparison includes a small boundary tolerance so a pure-white pixel
remains white at level 255 despite decimal coefficient rounding. Alpha and
fully transparent hidden RGB are retained.

The Adjustment Panel’s histogram is a source diagnostic, not a second renderer:
it draws the source luminance distribution and a threshold marker, while the
same scalar parameters are sent to the engine. Empty/unavailable histogram
data has an explicit state rather than inventing a distribution.

## Gradient Map

Gradient Map reduces each pixel to a tonal scalar, samples a bounded LUT, and
mixes the mapped colour by `intensity`. Version 1 provides:

- stable ids on colour and opacity stops, preserved through presets, embedded
  snapshots, normalization, FilterIR, and editor additions;
- per-stop midpoint values and deterministic duplicate-position hard-stop
  behavior in the engine;
- honest interpolation names backed by shared primitives: sRGB, linear RGB,
  OKLab, OKLCH, and HSL;
- reverse, independent opacity stops, optional source-alpha preservation, and
  deterministic Bayer 4×4/8×8 dithering;
- a LUT bounded to a safe size, with separate colour and alpha channels.

The adjustment editor is keyboard-operable: stops expose slider semantics,
arrow/Home/End movement, numeric position/opacity fields, deletion guards,
and pointer drag transactions. Preset conversion retains stable ids; the
preset library deliberately deduplicates equal-position preset stops, while
the adjustment/engine representation retains duplicate positions for hard
stops authored directly in an adjustment.

## Color Balance

Version 1 exposes nine independent values: cyan/red, magenta/green, and
yellow/blue for shadows, midtones, and highlights. The kernel uses overlapping
smooth tonal weights derived from luminance, normalized so the three weights
sum to one. Each axis is signed and applies only its selected channel pair.
`preserveLuminosity` measures the source Rec.709 luminance and restores that
value after the channel adjustment with a bounded scale, retaining hue intent
as far as the RGBA8 gamut permits. An all-zero adjustment is an identity path.

The inspector renders one tonal range at a time, provides three bipolar axis
controls, exposes Preserve Luminosity, and offers current-range/all reset
actions. Range changes are sent through the existing panel transaction layer,
so a drag is one undoable edit rather than one history item per pointer move.

## Backend, colour, and export matrix

| Surface | Status | Policy |
| --- | --- | --- |
| Canvas2D/software | Implemented | Reference semantics and fallback |
| WASM/native optimized kernel | Not claimed for these three | Must agree with the reference before being enabled |
| WebGPU | Not claimed | CPU fallback remains available on WebKitGTK/Linux |
| Raster export | Implemented through the filter pipeline | Same adjustment parameters as preview |
| SVG/PDF live vector form | Not representable | Rasterize only the affected subtree and surface preflight |
| ICC/CMYK/HDR/float working space | Partially supported elsewhere in the app | Not silently implied by these RGBA8 kernels |

The last row is an intentional non-claim: the current implementation does not
pretend that an RGBA8 Canvas2D path is an ICC-accurate HDR or CMYK effect
engine. The colour-management boundary and print limitations are documented in
[Colour Management](colour-management.md).

## Verification and residual risks

Focused unit tests cover scalar behavior, alpha/identity boundaries, LUT and
hard-stop semantics, IR lowering, normalization, preset persistence, and the
three editor surfaces. Existing E2E suites cover adjustment insertion,
Gradient Map workflows, raster/vector application, and front-facing
adjustments. The repository’s affected validation plan remains the final gate
for cross-package regressions.

Remaining work is explicit: native/WASM/WebGPU parity, ICC-accurate wide-gamut
and HDR effect math, independent PDF/raster artifact review, and destructive
apply wrappers require follow-up slices. None is represented as complete by
the current CPU reference implementation.
