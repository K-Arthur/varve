# Blend Spaces — Colour Interpolation & Compositing Architecture

## Current-State Matrix

| Concern | Model | CPU Renderer | GPU Renderer | UI | Import | Export | Tests | Status |
|---------|-------|-------------|-------------|----|----|--------|-------|--------|
| Gradient interpolation | `GradientInterpolationSpace` (5 spaces) | `expandGradientStopsForFill` pre-expands to sRGB stops | No gradient support (fallback to Canvas2D) | `GradientEditor` Select | Photoshop `.grd` parser | SVG `<linearGradient>` (stops only, no interpolation attr) | 46 tests | **Working** |
| Hue interpolation | `HueInterpolation` (4 modes) | Threaded through `lerpHue` in interpolation engine | Same fallback path | Conditional UI selector (cylindrical spaces only) | Not imported | Not exported | 12 tests | **Working** |
| Layer blending | `BlendMode` (19 variants) | `blend()` + `blendPixels()` software; `globalCompositeOperation` Canvas2D | Source-over only (normal blend) | Per-fill/per-layer blend mode | PSD preserves; SVG limited | CSS `mix-blend-mode`; PDF 16 modes | Unit tests in `blendModes.ts` | **Working** |
| Alpha compositing | Straight alpha canonical (ADR-0009) | Premultiplied at render boundary | Premultiplied vertex shader | N/A | Metadata alphaMode | PNG/JPEG alpha channels | Porter-Duff tests | **Working** |
| Linear-light evaluation | Optional `linearize` flag in `blend()` | Applied for multiply/screen/overlay when requested | N/A | N/A | N/A | N/A | Manual | **Partial** |
| Lab/LCH | `xyzToLab`/`labToXyz`/`labToLch`/`lchToLab` in `colorConversion.ts` | Used in non-separable blend LCH path | N/A | Color picker Lab/Lch tabs | ICC PCS path | PDF ICC-aware CMYK | `colorLabLch.test.ts` | **Working** |
| OKLab/OKLCH | `linearSrgbToOklab`/`oklabToLinearSrgb`/`oklabToOkLch`/`oklchToOkLab` | Default gradient interpolation space | N/A | Default selection in gradient editor | Trace quantization | Gamut mapping for export | `colorInterpolation.test.ts` | **Working** |
| ICC working space | `IccEngine` (tintbox/lcms2) + bundled profiles | Print pipeline only | N/A | N/A | JPEG/PNG/WebP/TIFF ICC extraction | PDF/X OutputIntent; PNG iCCP; JPEG APP2 | `varve-colour` tests | **Working** |
| Wide gamut | P3, AdobeRGB, Rec2020, ProPhoto primaries in `colorConversion.ts` | Rendered in sRGB; converted at export | N/A | N/A | PNG cHRM gamut matching; AVIF CICP | Analytic matrix conversion + ICC embed | `rasterColorEncoding.test.ts` | **Partial** |

## Terminology (canonical)

### Working colour space
The colour profile in which document colours are stored and interpreted.
Stored in `ColorConfig.workingSpace` (`'srgb' | 'linear'`) and
`ColorConfig.rgbProfile` (sRGB, Display P3, Adobe RGB, ProPhoto).

### Interpolation space
The coordinate system used to blend between gradient stops.
Stored in `GradientFill.interpolationSpace`.
Values: `'srgb' | 'linear-srgb' | 'oklab' | 'oklch' | 'hsl'`.
Default: `'oklab'`.

### Compositing space
The space in which source and backdrop pixels are combined.
Currently Canvas2D operates in sRGB (gamma-encoded). The `workingSpace`
config can be `'linear'` for physically-correct compositing, but the
Canvas2D renderer does not yet globally switch to linear.

### Blend-mode space
The space in which blend formulas (Multiply, Screen, etc.) are evaluated.
Separable modes operate per-channel in [0,1]. Non-separable modes use
W3C SetSat/SetLum (which operates in gamma-compressed sRGB by default)
or the alternative L\*C\*h\* path (via `blendNonSeparable(m, 'lch')`).

### Hue interpolation method
For cylindrical spaces (OKLCH, HSL):
- **shorter**: take the shorter arc (default, matches CSS Color 4)
- **longer**: take the longer arc
- **increasing**: always interpolate in the positive (CW) direction
- **decreasing**: always interpolate in the negative (CCW) direction

### Alpha representation
**Straight (unassociated) alpha** is canonical for storage (ADR-0009).
**Premultiplied (associated) alpha** is used at render boundaries:
- Canvas2D: `alphaMode: 'premultiplied'` on WebGPU canvas
- WGSL vertex shader: `out.color = vec4f(input.color.rgb * input.color.a, input.color.a)`
- Gradient interpolation: premultiplied by default (`opts.premultiplied !== false`)
- Raster layer blending: unpremultiply before blend math, re-premultiply after

## Architecture

### ManagedColor (canonical colour representation)

```typescript
type ManagedColor =
  | RgbColor      // { space: 'rgb', r, g, b, a, bitDepth?, profile? }
  | CmykColor     // { space: 'cmyk', c, m, y, k, a, ... }
  | GrayColor     // { space: 'gray', v, a, ... }
  | SpotColorRef  // { space: 'spot', name, tint, a, ... }
  | LabColor      // { space: 'lab', l, av, b, a, ... }
  | LchColor      // { space: 'lch', l, c, h, a, ... }
  | RegistrationColor | UnresolvedColor
```

All gradient stops, fill colours, and document colours use this type.
The rendering pipeline converts to RGBA via `managedColorToNormalized()`.

### Conversion pipeline

```
ManagedColor (any variant)
  ↓ managedColorToNormalized()
RGBA [0-1] (straight alpha)
  ↓ srgbToLinearUnit() / linearToSrgbUnit()
Linear sRGB [0-1]
  ↓ linearSrgbToOklab() / oklabToLinearSrgb()
OKLab [L,a,b]
  ↓ oklabToOkLch() / oklchToOkLab()
OKLCH [L,C,H]  (radians)
  ↓ gamutMapToSrgb() / gamutMapToSrgbUnit()
sRGB [0-255] or [0-1] (gamut-mapped)
```

### Interpolation engine (`colorInterpolation.ts`)

Two precision levels:
- **Byte-space (0-255)**: `interpolateManagedColor()` — display boundary
- **Normalized (0-1)**: `interpolateNormalizedColor()` — authoring path

Both support:
- Premultiplied alpha interpolation (default)
- All 5 interpolation spaces
- Configurable hue direction via `opts.hueInterpolation`
- Midpoint bias via `applyMidpointBias()`

The Canvas2D renderer cannot natively interpolate in non-sRGB spaces,
so `expandGradientStops()` pre-samples the gradient at 16 subdivisions
per segment in the requested space, producing a dense sRGB stop list
that Canvas2D can render.

### Hue interpolation (`lerpHue()`)

Generalised hue interpolation supporting CSS Color 4's four directional
modes. Operates in degrees [0, 360). Handles:
- Shortest/longer arc selection
- Monotonic increasing/decreasing paths
- Identical-hue degenerate case (returns the hue unchanged)
- Normalisation of out-of-range inputs

### CPU renderer

`replayIr()` → `paintFillsAndStops()` → `createGradientStyle()`:
1. Check `fill.interpolationSpace`
2. If `'srgb'`: pass stops directly to `CanvasGradient.addColorStop()`
3. Otherwise: call `expandGradientStopsForFill()` which invokes
   `expandGradientStops()` with `hueInterpolation` from the fill IR
4. The expanded stops are added to the native `CanvasGradient`

### GPU renderer

The WebGPU compositor currently does NOT support gradients or non-normal
blend modes. Items with fills or non-normal blend modes fall back to
Canvas2D islands via the structural render plan. All gradient rendering
goes through the Canvas2D path regardless of the active compositor backend.

### Serialization

Gradient interpolation settings are stored in the scene JSON:
```json
{
  "interpolationSpace": "oklch",
  "hueInterpolation": "shorter"
}
```

Both fields are optional. Missing `interpolationSpace` defaults to
`'oklab'` (historical default). Missing `hueInterpolation` defaults to
`'shorter'` (CSS Color 4 default).

### Document defaults

`ColorConfig.defaultGradientInterpolation` provides a document-level
default for new gradients. When a gradient's own `interpolationSpace`
is unset, this value is used instead of the hardcoded `'oklab'` default.
Existing gradients without this field resolve to `'oklab'` (backward
compatible).

## Key Files

| File | Role |
|------|------|
| `packages/shared/src/colorInterpolation.ts` | Core interpolation engine: lerpHue, interpolateManagedColor, interpolateNormalizedColor, expandGradientStops |
| `packages/shared/src/colorConversion.ts` | All colour space conversions: sRGB/linear/XYZ/Lab/LCH/OKLab/OKLCH/gamut mapping |
| `packages/scene/src/types.ts` | Scene types: GradientInterpolationSpace, HueInterpolation, GradientFill |
| `packages/scene/src/colorManagement.ts` | ColorConfig, ManagedColor, profile registry |
| `packages/engine/src/types.ts` | Engine types: FillIR, EngineGradientFill, HueInterpolation |
| `packages/engine/src/engine.ts` | buildIr: scene → render IR (passes hueInterpolation) |
| `packages/engine/src/replay.ts` | Canvas2D replay: expandGradientStopsForFill with hueInterpolation |
| `packages/editor/src/components/Inspector/color/GradientEditor.tsx` | Gradient editor UI with interpolation + hue selectors |
| `crates/varve-core/src/scene.rs` | Rust types: HueInterpolation enum, GradientFill, FillIR::Gradient |

## Decisions & Defaults

| Decision | Value | Rationale |
|----------|-------|-----------|
| Default interpolation space | `'oklab'` | Best perceptual uniformity for gradients; Figma default |
| Default hue direction | `'shorter'` | CSS Color 4 default; shortest path is most intuitive |
| Alpha convention | Straight (unassociated) | ADR-0009; premultiplied only at render boundary |
| Linear-srgb for compositing | Not yet global | Canvas2D operates in sRGB; linear compositing would require pipeline-wide change |
| Hue interpolation UI visibility | Cylindrical spaces only | OKLCH and HSL have hue; sRGB/linear-srgb/OKLab do not |
| Gamut mapping | Binary-search chroma reduction | `gamutMapToSrgb()` for OKLCH intermediates that exceed sRGB gamut |
| Backward compatibility | Old gradients resolve to `'oklab'` + `'shorter'` | No appearance change for existing documents |

## Backward Compatibility

- `GradientInterpolationSpace` gains `'linear-srgb'` — old documents never emit this value, so no migration needed
- `HueInterpolation` is a new optional field — missing defaults to `'shorter'`
- `ColorConfig.defaultGradientInterpolation` is optional — missing documents keep `'oklab'` default
- Rust `GradientFill` and `FillIR::Gradient` gain optional fields with `#[serde(default)]` — old JSON deserialises correctly
