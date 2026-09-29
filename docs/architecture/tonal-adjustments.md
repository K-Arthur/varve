# Tonal Adjustments Architecture

**Status:** current · **Scope:** tone/color kernels and their Adjustment Layer
diagnostics

This document records the current implementation boundary for tonal and
creative adjustments. They use one adjustment/filter pipeline and separate
scalar kernels. The shared pipeline owns validation, scope, history, opacity,
blend, masking, persistence, and export; the kernels own only pixel
mathematics.

## Executive diagnosis

| Adjustment | Current maturity | Canonical implementation | Main limitation |
| --- | --- | --- | --- |
| Threshold | Vertical slice | `threshold.ts` + Adjustment Panel editor | RGBA8/Canvas2D reference path; no GPU kernel |
| Gradient Map | Implemented reference path with preset/import support | `gradientMap.ts` + `GradientMapEditor` | Wide-gamut/HDR/ICC-accurate effect math is deferred |
| Color Balance | Vertical slice | `colorBalance.ts` + tonal-range editor | CPU reference path; native/WebGPU acceleration is not claimed |
| Curves | Versioned point curves | `adjustment/curves.ts`, `tonalCurveFilter.ts`, `CurveEditor` | The renderer boundary is RGBA8; float evaluation does not imply HDR processing |
| Channel Mixer | Independent matrix rows | `tonalState.ts` + software compositor | RGB components, not print separations |
| White Balance | Relative rendered-RGB correction | `whiteBalance.ts` + source preview picker | No inferred Kelvin, camera illuminant or As Shot metadata |
| Split Toning | Photographic chroma treatment | `splitTone.ts` + shadow/highlight controls | Software Oklab/sRGB gamut boundary |
| Sharpen | Versioned editing and output operator | `unsharpMask.ts`, `SharpenEditor`, export pipeline | Gaussian v2; legacy box v1 retained; resolution-dependent resampling |

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
| Versioned scalar semantics | Threshold and Color Balance use v1; Gradient Map supports legacy v1 and corrected v2 (the new default) |
| Shared opacity/blend ownership | `filterCompositor.ts` and compositing tests |
| Scope and mask separation | `non-destructive-effects.md`, adjustment-scope tests |
| Save/reload normalization | `adjustmentNormalization.test.ts`, `DocumentCodec` |
| Unsupported runtime visibility | `FilterDiagnostic` in `filterCompositor.ts` |

## Threshold

`ThresholdAdjustment.level` is normalized to `[0, 255]`. Version 1 supports
`relative-luminance`, `average-rgb`, and `max-channel` source modes. The
legacy `relative-luminance` mode is the Rec.709 weighted sum of encoded
straight RGB channels, a luma-like signal rather than linear-light relative
luminance. A pixel is white when that signal is at least `level`; otherwise it is black.
The comparison includes a small boundary tolerance so a pure-white pixel
remains white at level 255 despite decimal coefficient rounding. Alpha and
fully transparent hidden RGB are retained.

The Adjustment Panel’s histogram is a source diagnostic, not a second renderer:
it draws the source luminance distribution and a threshold marker, while the
same scalar parameters are sent to the engine. Empty/unavailable histogram
data has an explicit state rather than inventing a distribution.

## Gradient Map

Gradient Map reduces each pixel to a tonal scalar, samples a bounded LUT, and
mixes the mapped colour and alpha by `intensity`. New adjustments use algorithm
version 2, whose default relative-luminance mode linearizes sRGB before the
W3C luminance weights. Version 1 remains available for reproducible legacy
documents and uses the prior encoded-channel luminance behavior.

The adjustment provides:

- stable ids on colour and opacity stops, preserved through presets, embedded
  snapshots, normalization, FilterIR, and editor additions;
- per-stop midpoint values and deterministic duplicate-position hard-stop
  behavior in the engine;
- honest interpolation names backed by shared primitives: sRGB, linear RGB,
  OKLab, OKLCH, and HSL;
- reverse, independent opacity stops, optional source-alpha preservation, and
  deterministic Bayer 4×4/8×8 dithering with an explicit origin;
- a LUT bounded to a safe size, with separate colour and alpha channels.

Intensity `0` is an exact RGBA identity. Fully transparent source pixels keep
their source alpha and do not develop colour fringes when source-alpha
preservation is enabled. Non-256 LUT sizes map the full tonal domain rather
than indexing the ramp with an 8-bit value. A bounded cache reuses identical
LUT treatments without making document state global.

The adjustment editor is keyboard-operable: stops expose slider semantics,
arrow/Home/End movement, numeric position/opacity fields, deletion guards,
and pointer drag transactions. Preset conversion retains stable ids; the
preset library deliberately deduplicates equal-position preset stops, while
the adjustment/engine representation retains duplicate positions for hard
stops authored directly in an adjustment. The editor also exposes source
histogram/tonal-distribution diagnostics and uses the same engine sampler for
the preview ramp and thumbnails.

## Color Balance

Version 1 exposes nine independent values: cyan/red, magenta/green, and
yellow/blue for shadows, midtones, and highlights. The kernel uses overlapping
smooth tonal weights derived from luminance, normalized so the three weights
sum to one. Each axis is signed and applies only its selected channel pair.
`preserveLuminosity` measures the source encoded-RGB Rec.709 weighted signal and restores that
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
| WASM/native optimized kernel | Not claimed for the tonal kernels documented here | Must agree with the reference before being enabled |
| WebGPU | Not claimed | CPU fallback remains available on WebKitGTK/Linux |
| Raster export | Implemented through the filter pipeline | Same adjustment parameters as preview |
| SVG/PDF live vector form | Not representable | Rasterize only the affected subtree and surface preflight |
| ICC/CMYK/HDR/float working space | Partially supported elsewhere in the app | Not silently implied by these RGBA8 kernels |

The last row is an intentional non-claim: the current implementation does not
pretend that an RGBA8 Canvas2D path is an ICC-accurate HDR or CMYK effect
engine. The colour-management boundary and print limitations are documented in
[Colour Management](colour-management.md).

## Core tone controls and diagnostic stages

The core editor also exposes Brightness/Contrast, Exposure, Levels, Curves,
Hue/Saturation, Vibrance, White Balance/Color Balance, Selective Color,
Channel Mixer, and Black & White through the same `Adjustment` union and
`FilterIR` lowering. These controls are not interchangeable aliases:

- Exposure `value` is in stops. The reference kernel converts sRGB bytes to
  linear light, multiplies by `2^value`, applies its bounded linear offset and
  gamma correction, then encodes back to sRGB.
- Levels owns input black/white, input gamma, and output black/white. Collapsed
  or reversed intervals are normalized deterministically and malformed numeric
  values cannot wrap through the byte LUT.
- Curves preserve non-monotonic output values for creative inversions while
  sorting and de-duplicating input coordinates and clamping malformed points.
  The editor and kernel share the same normalized point representation.
- Hue/Saturation range edits use circular hue distance and leave achromatic
  pixels out of targeted colour families; only the Master range can deliberately
  change neutral saturation/lightness.
- Temperature/tint controls are creative channel shifts, not calibrated Kelvin
  or ICC white-point transforms. Selective Color's CMYK-style controls are not
  native CMYK raster processing.

The Levels histogram and Curves background are labelled diagnostics. They show
the resolved scope composite before the selected adjustment; for a later stack
entry, upstream entries are rendered through the canonical compositor before
sampling. The sample is bounded to a 256-pixel maximum dimension and remains a
diagnostic of the authored RGBA8 effect boundary, not a hidden HDR or display
proof pipeline. Empty, missing, and unavailable sources remain distinct from
an invented histogram. Clipped shadows and highlights are surfaced as
percentages of the diagnostic's opaque samples with endpoint markers on the
widget; counts below 0.1 percent stay quiet so an ordinary black point is not
presented as an error. Fully transparent pixels never count toward the
percentages.

## Verification and residual risks

Focused unit tests cover scalar behavior, alpha/identity boundaries, LUT and
hard-stop semantics, IR lowering, normalization, preset persistence, and the
three editor surfaces. The Chromium Gradient Map E2E flow covers adjustment
insertion, the bounded Add Adjustment dialog, gradient editor rendering, and
the dither/preserve-luminosity controls. The repository’s affected validation
plan remains the final gate for cross-package regressions.

Remaining work is explicit: native/WASM/WebGPU parity, ICC-accurate wide-gamut
and HDR effect math, artifact review outside the tonal reference cases, and
destructive apply wrappers require follow-up slices. Tonal PNG, SVG-embedded
PNG and browser raster PDF have independent opened and numerical evidence in
the [tonal workflow review](../screenshots/tonal-workflows/README.md). None of
that certifies the remaining color/backend surfaces.


## Output sharpening

The canonical export pipeline applies optional sharpening once after its final
resize. `exportPipeline/sharpen.ts` uses the alpha-weighted floating Gaussian
operator in `unsharpMask.ts`. Source and blur are both encoded sRGB or both
linear sRGB; the linear variant decodes before blurring and encodes at the
output boundary. No intermediate blur is quantized to bytes. Radius uses the
shared Gaussian three-sigma support convention in output pixels; fractional
radii are supported. Scratch buffers are tiled and capped at 16 MiB, excluding
the required RGBA8 source/result.

Alpha and raw hidden RGB remain unchanged. Protect Alpha additionally scales
correction by source alpha. Luma-only mode applies equal component deltas and
can change hue/chroma where gamut clipping occurs. RGB mode gates on the
largest component delta, retaining isoluminant chromatic edges. Sharpening
can amplify noise and produce halos; it is opt-in and does not replace
creative sharpening earlier in the authored stack.

## Channels and versioned curves

Channel Mixer evaluates `out = matrix × original RGB + offset` in encoded
sRGB code values. Three independent rows persist; coefficients may be negative
and are not normalized. Monochrome uses the red output row for all three
components. Legacy entries without rows retain their single selected row.
Choosing another row promotes that entry to a full matrix without discarding
its previous coefficients.

New Curves use algorithm version 2, PCHIP. Files without a version use version
1's historical Catmull-Rom transfer until explicitly upgraded. Both graph and
renderer call `compileCurve`. Inputs outside [0,1] clamp. Nonfinite points are
excluded; exact duplicate X keeps the last sorted value; v2 additionally
consolidates separations at or below 1e-9 to avoid ill-conditioned slopes.
Absent endpoints extend to (0,0)/(1,1); explicit endpoint heights are retained.
Intentional inversions remain supported. Point count is bounded to 256 and
compiled transfers to 32 cached entries. Point storage order/ids remain stable
while evaluation sorts a separate copy.

Master RGB applies to each component, followed by its individual curve. V2
keeps that intermediate floating and quantizes once into RGBA8. The graph is
the continuous transfer; the displayed output surface quantizes to bytes.
Input/output numeric values retain fractional 0–255 code values. Explicit
point actions supplement pointer and keyboard editing. Reset current and Reset
all channels have distinct scopes. Source sampling adds a point on the current
transfer; RGB samples the encoded arithmetic mean, while an individual channel
samples its component after the current master curve.

Soft contrast and Invert presets replace only the currently selected channel,
retain the selected algorithm, assign stable new point ids and create one
undo transaction. They are editable bounded point arrays, not executable
expressions or proprietary preset imports.

Selection Sources contains Channels for a selected image's original source.
The 256px preview supports composite, grayscale/colorized RGB and opaque alpha
coverage. View state never changes the edit target, layer visibility or export.
Channel to selection decodes original pixels within the existing 16MP mask
budget; it does not turn the preview into a saved mask. RGB snapshots multiply
component coverage by source alpha; alpha snapshots preserve partial coverage.
The canonical source-to-local-to-world mapping handles placement, crop and
nested transforms. Replace/add/subtract/intersect and inversion use area
selection semantics. Save selection, rename, duplicate, delete, reload and
Object → Create Mask from Selection use existing durable selection/mask
resources. These are snapshots, not live dependencies. Direct RGB painting
and CMYK/spot-channel editing are not offered by this surface.

## Relative white balance and split toning

White Balance v1 operates on straight RGBA8 interpreted as rendered sRGB/D65,
decoding components before multiplying linear RGB gains and encoding once.
Warmth/tint are relative units [-100,100], not Kelvin. Gain bases are [0.25,4];
warmth multiplies R/B by opposite powers of two, tint multiplies R/B together
and G oppositely. Neutral parameters bypass exactly. Existing Temperature,
Tint and Color Balance keep their old semantics. RAW camera reference and As
Shot remain owned by RAW Develop; this adjustment does not read or reapply
camera gains.

The shared source diagnostic now retains one RGBA sample and histogram per
request, max 256px and eight cached entries (about 2MiB of pixel payload).
The preview represents the scoped composite before the selected entry, with
canonical upstream order. Its approximate bounds are suitable for diagnostic
patch selection, not a claim of full-resolution or main-canvas picking.
Sampling a 3×3 preview patch estimates gains that neutralize mean linear RGB
at its weighted luminance. Alpha below 250, any component below 12 or above
243 is excluded. Auto additionally requires low encoded chroma (spread/max
≤0.15), at least 16 samples and 1% of eligible opaque pixels. Rejection is
explicit and leaves the stack unchanged; it cannot identify neutral objects
in arbitrary artwork or perfectly balance mixed lighting.

Auto White Balance reuses the first existing WB entry and samples before it.
If none exists, it inserts at the start and samples the unadjusted scope.
Existing entries are never reordered. A document identity check rejects stale
asynchronous estimates. Repeat clicks replace gains from the same upstream
stage rather than append cumulative corrections.

Split Toning v1 decodes sRGB, adds Oklab a/b chroma at fixed source L, then uses
the existing shared gamut compressor. Smoothstep weights sum to one, with a
[0,1] shadow pivot and [0.01,1] transition width; the input lightness determines
weights once. Each chroma vector has maximum magnitude 0.15 × saturation ×
strength and a `4L(1-L)` endpoint envelope. Pure black/white remain protected;
zero strength or both saturations zero is exact identity. Quantization can
change L slightly (tested tolerance 0.004); gamut compression reduces chroma
rather than claiming unlimited saturation or perfect hue retention.

## Editing sharpening and full-scale diagnostics

New Sharpen entries use algorithm version 2, the same alpha-weighted floating
Gaussian as output sharpening. Amount is percent; threshold is a 0–255 scale
of differences in the selected encoded or linear sRGB domain. Radius is the
three-sigma support in target-local units for Object Filters or document units
for Adjustment Filters. The canonical treatment-space pixels-per-unit mapping
converts that authored radius to the current raster surface; camera zoom/DPR
never rewrites the parameter. Nonuniform transforms use the renderer's existing
geometric-mean scale convention. Sharpen occurs after the object has been
resampled to that surface, so sampling/quantization differences between preview
and final resolution remain possible.

Files without a version retain the historical encoded/premultiplied box
operator. The editor exposes an explicit Gaussian upgrade. Integer-radius
legacy appearance is retained; malformed fractional indices now floor to an
integer instead of reading undefined bytes. Legacy partial-alpha behavior is
not advertised as equivalent to v2. New entries start with zero amount; zero
amount/radius bypass before canvas readback. Luma-only correction and reduced
partial-alpha correction are explicit options, with no promise of hue preservation
under clipping. Editing and optional output sharpening can intentionally both
be present, at their separate authored and post-resize stages.

Compare document-pixel detail explicitly requests a 128px region at one
raster pixel per document unit, including upstream and selected spatial halos.
The source diagnostic refuses a halo surface above one megapixel and caps
cached pixel payloads at 2MiB across at most eight entries. It shows filter input
and filtered output before the layer mask/opacity. The approximate scope bounds
choose the region; this is not a full-resolution main-canvas eyedropper or a
claim that one document unit always equals one source-image pixel.

Channels also offers an original-source crop, one source pixel per CSS pixel,
before placement/crop/filtering. It reuses the canonical decoded image cache
and allocates only the requested 128px crop. Source detail has a 16MP inspection
limit. Canvas readback can quantize partial alpha; raw hidden-RGB preservation
is a scalar-kernel contract, not a guarantee of canvas/encoder fidelity.

## Compatibility and browser export

| Saved entry | Evaluation policy |
| --- | --- |
| Curves without an algorithm version | Historical v1 Catmull-Rom transfer; explicit upgrade to v2 |
| New Curves | v2 PCHIP, master then retained per-component curves |
| Mixer without matrix rows | Historical selected-row behavior; editing another row explicitly promotes it |
| White Balance / Split Toning | New v1 kinds; existing Temperature, Tint and Color Balance keep their own operators |
| Sharpen without a version | Historical v1 box operator; explicit Gaussian upgrade |
| New Sharpen | v2, serialized domain, luma-only and alpha-protection options |

The actual codec tests retain these versions, all channel arrays, matrix rows,
source/crop data, raster masks and saved partial-coverage selections. Transient
inspection channels and diagnostic caches are not serialized. Browser tests
reopen with empty diagnostic caches and compare the same requested region;
this does not certify a cold offline PWA boot or every native webview.

The browser PDF raster fallback packs straight RGB bytes and, when needed,
stores alpha in a separate grayscale soft mask. Stream lengths and xref
offsets are actual byte positions. Closing the image bitmap does not affect
the ImageData dimensions used by this writer. This is ordinary PDF 1.4
DeviceRGB output, not PDF/X or an ICC-managed print route. Rendered Poppler
comparisons supplement PNG/SVG pixel checks; a PDF header alone is inadequate
validation. Native print/export remains a separate boundary.
