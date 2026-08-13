# High-Precision Color Pipeline — Implementation Report

**Date:** 2026-08-13
**Branch:** `carry`
**Companion docs:** `docs/audits/color-quantization-boundary-inventory.md`,
`docs/architecture/colour-management.md`, `docs/architecture/raster-assets.md`

This report follows the structure required by the high-precision color
mission (sections A–N). It records what was found, what was implemented,
what was deliberately left, and what is explicitly not claimed.

---

## A. Root cause — where Varve quantized to RGBA8

Inventory of every former 8-bit boundary (full detail in the
quantization-boundary inventory):

1. **Effect params**: `AdjustmentEditor`/`GradientMapEditor` stored picker
   colors through `managedColorToRgba` (0-255 tuples) — float/non-RGB values
   were destroyed before storage; RGB uint16 values were stored raw at the
   wrong scale.
2. **LUT bake**: `bakeFiltersToLut` 3D path read the sampling canvas
   *before* running the filter stack — every baked 3D LUT was the identity
   input. Input sampling also rounded through CSS `rgb()`.
3. **Adaptive contrast write-back**: resolved colors were written to the
   document as uint8-scale values even in uint16/float documents.
4. **Color picker**: HSV drafts rounded to 8-bit integers; numeric fields
   were always 0-255 scale (typing 255 in a uint16 doc wrote 65535); hex
   commits re-authored at 8-bit; swatches (document + recents) were
   flattened to `Color` tuples and re-authored as fresh uint8 RGB — the
   single biggest UI fidelity loss; gradient stop insertion interpolated
   from 8-bit tuples (`interpolateManagedColor` is a byte-space function).
5. **Effects math**: `gaussianBlurLinearLight` linearized then quantized
   back to bytes before blurring (the "linear-light" contract was not
   honored; dark gradients collapsed; low-alpha `255/a` rounding amplified
   error); `exportPipeline/palette.ts` had a dead `/255 → ×255` round trip.
6. **PDF export**: native CMYK fills were converted RGB with the naive
   `(1-c)(1-k)` formula and converted *back* to CMYK — pure K became a
   four-color build; gradient stops round-tripped the same way.
7. **Browser decode / compositor / encoders** (master boundaries, still
   open): `new Image`/`createImageBitmap` decode to 8-bit RGBA with no
   signal; Canvas2D `ImageData` is the effect/mask working format; export
   encoders are 8-bit; WebGPU effect textures are `rgba8unorm`.
8. **Dedupe keys**: recent-colors identity used an 8-bit RGBA key (two
   uint16 colors differing below 8-bit collided); Lab/LCH were dropped
   from recents.

## B. Architecture

The pipeline now distinguishes five representations explicitly:

| Representation | Where | Precision |
| --- | --- | --- |
| Canonical document color | `ManagedColor` in scene model | bit-depth-tagged (uint8/uint16/float16/float32), profile-tagged |
| Raster pixel storage | `rasterColor/pixelBuffer.ts` descriptors | rgba8/16/16f/32f (implemented, not yet wired to decode) |
| Working/effect representation | normalized 0-1 floats (`managedColorToNormalized`, normalized interpolator, float blur) | float, quantized once at storage |
| Display representation | Canvas2D/CSS `managedColorToRgba` | 8-bit, explicit boundary |
| Output representation | export/PDF transforms | format-decided (8-bit encoders; native CMYK operators in PDF) |

Invariant maintained throughout: display/output boundaries never write back
into canonical state.

## C. Canonical representation

`ManagedColor` (pre-existing) is the canonical type: model (RGB/CMYK/Gray/
Lab/LCH/Spot/Registration/Unresolved), component values at the color's
declared bit depth, alpha, and profile identity are orthogonal fields —
never conflated into one `colorMode` flag. JSON serialization is exact for
doubles; integer channels are stored as integers. Chosen because it already
existed and matched the mission's model/precision/space separation.

## D. Migration

Legacy RGBA8 values default to `bitDepth: 'uint8'` without mutation
(`withDefaultBitDepth`); boundary values 0/1/127/128/254/255 migrate
exactly (regression-tested). Opening and resaving a legacy file is
lossless.

## E. CMYK

Native C/M/Y/K components with alpha and profile identity (pre-existing
model). PDF export now emits authored channels directly, bit-depth aware,
with pure K preserved and CMYK-space gradient interpolation (this report's
Slice F). The picker edits CMYK natively in CMYK-mode documents and
preserves untouched channels. Raster CMYK planes remain unimplemented
(explicit boundary).

## F. CMS

Assign (mode intent change, values kept) and Convert (values rewritten,
one undoable transaction) are separate operations; the Assign vs Convert
dialog is now reachable (File menu + command palette). Analytical browser
conversion is labeled approximate; ICC conversion is desktop/WASM.
Proofing remains display-only and nondestructive. Transform caching and
Assign/Convert ICC profile dialogs for arbitrary profiles remain open
items.

## G. Rendering

Canvas2D remains 8-bit at the surface; the picker/effects work
normalized-float before display. Linear-light blur now runs fully in
float32. WebGPU stays `rgba8unorm` preview (float capability negotiation
pending). Worker transport is unchanged (8-bit bitmaps).

## H. Import/export

| Format | Import | Export |
| --- | --- | --- |
| PNG | ICC extracted; decode 8-bit | 8-bit (16-bit needs a 16-bit composite — not claimed) |
| JPEG | ICC APP2 extracted | 8-bit, ICC APP2 embeddable |
| WebP | ICCP extracted | 8-bit, no profile embed (disclosed) |
| GIF | — | 256-color indexed (explicit limitation) |
| TIFF | metadata only (no pixel decode) | not implemented |
| PDF | — | RGB + native CMYK, spot separations, output intent (Fogra39) |
| SVG | — | 8-bit rgba or `icc-color()` preserve mode |

## I. Frontend

- Inspector → Document Color: Mode, **Precision** (8/16/16f/32f), **Blend
  space** (sRGB/Linear).
- File → Document Color Mode… + command palette: Assign vs Convert dialog.
- Picker: float HSV drafts, bit-depth-aware numeric fields (0-255 /
  0-65535 / 0-1), canonical swatch pass-through, untouched-channel
  preservation, normalized gradient-stop insertion.
- Adjustment/gradient-map editors: bit-depth-normalized param write-back.

## J. Performance

No performance regressions measured or expected: the float blur replaces a
byte blur (same asymptotic cost, float32 working buffers), picker changes
are O(1) per edit, PDF CMYK emit is less work than the previous round
trip, LUT bake cost is unchanged (the sampling order bug fix is free).
Full benchmark runs were not performed this session (no perf-sensitive
hot-path change; the render/replay hot path was untouched).

## K. Numerical validation

`packages/scene/src/highPrecisionRegression.test.ts`:
- 32768 vs 32769 stay distinct through save/reopen;
- float32 channels exact (12-digit tolerance);
- 512-level ramp: all 512 distinct levels survive;
- uint16 and float CMYK channels + bit depth survive;
- five save/reopen cycles: zero progressive quantization;
- zero-alpha RGB preserved; alpha 1e-4 survives;
- legacy boundaries exact.

`ColorPicker.test.tsx`: uint16/float channel preservation on single-channel
edits; HSV edits off the 8-bit lattice; swatch precision at doc bit depth.
`crates/varve-print`: 151 tests including pure-K emission, bit-depth
scaling, CMYK-space gradient interpolation, pure-K gradient samples.
`colorInterpolation.test.ts`: normalized interpolator endpoint exactness,
0-1 bounds, non-lattice proof.

## L. Visual validation

Not run this session (no Playwright E2E for the new UI; the picker and
document-panel changes are unit-tested in jsdom). The existing visual
corpus is unaffected by canonical-model work.

## M. Platform results

| Platform / category | Result |
| --- | --- |
| Linux unit (vitest, affected closure) | PASS |
| Rust (varve-print, 151 tests + clippy) | PASS |
| tsc (scene, editor, ui, shared — my files) | PASS |
| audit:docs / audit:emoji / audit:tokens | PASS |
| audit-health (hub import budgets) | PASS |
| audit-architecture --ci | PASS |
| Playwright / WebKitGTK / WebView2 / WKWebView | NOT RUN — native render paths unchanged |
| WebGPU capability paths | NOT RUN — no GPU change landed |

## N. Remaining limitations

- Raster decode of >8-bit sources (16-bit PNG/TIFF, 10-bit AVIF) — browser
  decode is 8-bit; needs native/WASM decode (varve-media is decode-only and
  strips 16-bit APNG today).
- Float entry/exit for the effect pipeline: curves/levels/duotone LUTs stay
  256-bin byte tables consistent with the byte-space `ImageData` contract.
- WebGPU `rgba16float` capability negotiation and GPU effect float storage.
- PNG16/TIFF/float export encoders (need a 16-bit composite path first).
- Raster CMYK planes and CMYK image embedding in PDF.
- Document-wide precision *conversion* (uint8→uint16→float value rewrite).
- Grid/guide colors stored as CSS strings in the scene model (UI chrome).
- Assign/Convert with arbitrary ICC profiles, soft-proof gamut warning,
  TAC/ink-limit preflight, Lab/LCH document storage modes, spot/DeviceN/
  overprint beyond the existing separation support, full HDR display
  pipeline, HDR metadata, 32F GPU targets, and dithering at precision
  reduction boundaries (policy exists, not surfaced in export UI).
