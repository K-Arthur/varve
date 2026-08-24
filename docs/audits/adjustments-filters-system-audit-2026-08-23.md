# Adjustments, Filters, Effects, Colour and Retouch Audit

Date: 2026-08-23
Status: implementation pass complete for the repository-backed adjustment and
filter scope; unsupported capabilities remain explicitly labelled below.

## Architecture decision

Varve keeps one image-processing path:

```text
scene Adjustment / Object Filter
        ↓
adjustmentToFilter()
        ↓
FilterIR
        ↓
CPU reference → Canvas2D preview → raster export
        ├─ native Rust provider where an effect is wired
        └─ WebGPU provider where a compositor kernel is wired
```

Adjustment layers process a resolved backdrop scope. Object Filters process a
node's own rendered result. Procedural effects remain deterministic seeded
FilterIR kernels. Retouch tools write explicit raster-layer history rather than
silently mutating an adjustment stack. Diagnostics and proofing remain read-only
or explicitly preview-only.

The relevant historical regressions were reviewed in the adjustment/filter
history, including `8697222d` (scene smart-filter model), `adf9ed25` (Canvas2D
smart-filter replay), `df95be6e` (object-filter bypass), and the adjustment
workflow audit dated 2026-07-23. Their fixes are retained; this pass adds the
missing persistence and pixel-contract checks identified during the audit.

## Capability matrix

`Fallback` means the capability is correct through the canonical CPU/Canvas2D
path when an accelerated backend is unavailable. `Staged` means the scene or
renderer has the contract, but the complete editor/export proof is not yet
claimed.

| Capability | Scene | UI | CPU | WebGPU | Native | Mask | Save | Export | Tests | Visual |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Brightness / Contrast | Complete | Complete | Complete | Fallback | Fallback | Complete | Complete | Complete | Complete | Staged |
| Exposure / Temperature / Tint | Complete | Complete | Complete | Fallback | Fallback | Complete | Complete | Complete | Complete | Staged |
| Levels + histogram | Complete | Complete | Complete | Fallback | Fallback | Complete | Complete | Complete | Complete | Staged |
| Curves + histogram background | Complete | Complete | Complete | Fallback | Fallback | Complete | Complete | Complete | Complete | Staged |
| Shadow / Highlight | Complete | Complete | Complete | Fallback | Fallback | Complete | Complete | Complete | Complete | Staged |
| Vibrance / Hue / Saturation | Complete | Complete | Complete | Fallback | Fallback | Complete | Complete | Complete | Complete | Staged |
| Colour Balance / Channel Mixer | Complete | Complete | Complete | Fallback | Fallback | Complete | Complete | Complete | Staged | Staged |
| Selective Colour / Photo Filter | Complete | Complete | Complete | Fallback | Fallback | Complete | Complete | Complete | Complete | Staged |
| Black & White / Invert | Complete | Complete | Complete | Fallback | Fallback | Complete | Complete | Complete | Complete | Staged |
| Gradient Map / Duotone / Tritone | Complete | Complete | Complete | Fallback | Fallback | Complete | Complete | Raster fallback | Complete | Complete |
| Posterize / Threshold | Complete | Complete | Complete | Fallback | Fallback | Complete | Complete | Raster fallback | Complete | Staged |
| LUT import / apply / save | Complete | Complete | Complete | Fallback | Fallback | Complete | Complete | Raster fallback | Complete | Staged |
| LUT export / stack bake | Complete | Complete | Complete | Fallback | Fallback | N/A | Complete | `.cube` | Complete | Staged |
| Blur | Complete | Complete | Complete | Canvas fallback | Fallback | Complete | Complete | Complete | Complete | Staged |
| Sharpen / Unsharp-style processing | Complete | Complete | Complete | Fallback | Fallback | Complete | Complete | Raster fallback | Complete | Staged |
| Dither / Palette Snap | Complete | Complete | Complete | Partial | Complete | Complete | Complete | Raster fallback | Complete | Complete |
| Halftone / Colour Halftone | Complete | Complete | Complete | Fallback | Fallback | Complete | Complete | Raster fallback | Complete | Complete |
| Bloom / RGB Split / CRT / VHS | Complete | Complete | Complete | Complete | Complete | Complete | Complete | Raster fallback | Complete | Complete |
| Light Shafts / Lens Flare / Leak / Caustics | Complete | Complete | Complete | Complete | Complete | Complete | Complete | Raster fallback | Complete | Staged |
| Field / Focus / Tilt-Shift / Path / Spin Blur | Deferred | Unsupported | Unsupported | Unsupported | Unsupported | N/A | N/A | N/A | N/A | N/A |
| Deblur / camera-shake restoration | Backend only | Partial | Provider chain | Provider-dependent | Provider-dependent | N/A | Explicit result | Raster result | Unit | Staged |
| Healing / Clone / Patch / Smudge | Raster layer | Complete | Raster compositor | N/A | N/A | Local selection | Complete | Complete | Complete | Staged |
| Histogram statistics / clipping | Read-only | Complete | Complete | N/A | N/A | Scope-aware | N/A | N/A | Complete | Staged |
| Pixel probe / persistent samplers | Read-only | Partial | Complete | N/A | N/A | Scope-aware | Complete | N/A | Partial | Staged |
| Soft proof / gamut warning / ink coverage | Document proof config | Partial | Analytical fallback | Unsupported | Native print partial | N/A | Complete | Print-dependent | Partial | Staged |
| HDR / float working pipeline | Metadata | Partial | Partial | Unsupported | Print-dependent | Partial | Complete | Format-dependent | Partial | Staged |

## Corrections implemented in this pass

- Added persistence-boundary normalization for adjustment and Object Filter
  stacks. Unknown entries are dropped with codec warnings; IDs, enum values,
  colours, curve points, opacity ramps, finite numbers, and bounded raster
  parameters are repaired before they reach a kernel.
- Implemented Shadow / Highlight recovery through the existing Adjustment →
  FilterIR → compositor path, including editor controls, alpha preservation,
  hidden-RGB preservation, export participation, and metadata registration.
- Preserved fully transparent RGB bytes across pointwise adjustments, Levels,
  Curves, and Selective Colour. This prevents hidden matte colours from being
  changed by a non-destructive adjustment and later becoming visible after a
  mask operation.
- Corrected histogram tonal statistics to exclude fully transparent backdrop
  pixels while retaining alpha-bin diagnostics. Auto Levels now uses visible
  sample counts.
- Made LUT export resample 1D and 3D grids through the interpolation routines,
  flatten shaper+3D transforms into a semantically equivalent 3D `.cube`, and
  made LUT baking honour per-filter opacity and reject non-normal blend
  semantics rather than baking an incorrect transform.
- Hardened the no-intermediate-surface compositor fallback so filter opacity
  and blend mode are retained through the canonical pixel blend implementation.
- Corrected the capability registry so the standalone Color Halftone GPU helper
  is not advertised as an active canonical compositor path until it is wired.

## Explicit non-claims and next architectural boundary

The current renderer already shares the structural replay compositor with raster
export; SVG/PDF preserve editable vector content where possible and rasterize
unsupported adjustment/effect boundaries with warnings. WebGPU remains an
accelerated provider, not a second source of colour truth.

The following are intentionally not represented as fake “complete” features:

- field/focus/path/spin/tilt-shift blur needs a depth/geometry-aware spatial
  model and editor interaction, not another scalar `blur` parameter;
- true HDR/float and ICC/CMYK proofing require end-to-end surface formats and
  print/export profile handling, not only metadata fields;
- per-entry Object Filter masks need a shared effect-stage mask coordinate
  contract; node masks and adjustment-layer spatial masks are already separate
  and correct;
- restoration model execution remains provider/model dependent and is explicit
  about licensing, availability, cancellation, and output blending.

No screenshot or cross-platform GPU claim is made by this document without a
successful browser run and pixel inspection. The validation record for this
implementation is maintained in the handoff response and should be appended to
this audit when the full gate is run.
