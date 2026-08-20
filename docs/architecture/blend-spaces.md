# Blend spaces — colour interpolation and compositing architecture

Varve uses “blend” for several different operations. They are deliberately
separate in the document model and renderer:

1. converting a managed colour between profiles or coordinate systems;
2. interpolating between authored gradient colours;
3. evaluating an artistic blend-mode formula;
4. compositing source and backdrop coverage with alpha; and
5. converting the rendered result to a display or export target.

No UI setting or serialized field named `blendSpace` is used as an umbrella
for those operations.

## Current-state matrix

| Concern | Model | CPU renderer | GPU renderer | UI | Import | Export | Tests | Status |
|---|---|---|---|---|---|---|---|---|
| Working colour space/profile | `ColorConfig.workingSpace`, `rgbProfile`, `cmykProfile`; colours are `ManagedColor` | Analytical TS conversion for browser paths; native ICC in print/native paths | Solid upload converts to normalized render values | Document colour settings and print controls | Profile metadata is retained where parsers expose it | PDF/X output intent and raster profile paths | scene/shared/print colour tests | Partial |
| Gradient interpolation | `GradientFill.interpolationSource`, `interpolationSpace` (`srgb`, `linear-srgb`, `oklab`, `oklch`, `hsl`) | Canonical `@varve/shared` interpolation, then deterministic Canvas2D stop expansion | Gradient items use the Canvas2D semantic island; no divergent shader implementation | Gradient Editor per-gradient selector; Document Panel default | SVG `linearRGB` maps to `linear-srgb`; other source-format semantics remain bounded | SVG keeps sRGB/linear natively and bakes perceptual spaces; CSS/HTML emits modern syntax | shared, scene, editor, codegen tests | Working with explicit boundaries |
| Hue interpolation | `hueInterpolation` (`shorter`, `longer`, `increasing`, `decreasing`) | `lerpHue`; achromatic colours use rectangular fallback | Inherited from Canvas2D path | Shown only for OKLCH/HSL | SVG/CSS mapping is format-dependent | Preserved in CSS/HTML; used while SVG baking | hue and editor tests | Working |
| Layer blend mode | `BlendMode` on nodes/fills | CPU blend formulas and Canvas2D normal path | Non-normal items fall back to semantic Canvas2D/CPU islands | Existing layer/fill blend controls | PSD and supported design imports preserve modes | CSS/PDF support is target-dependent | engine blend-mode tests | Working with target fallbacks |
| Blend-mode evaluation space | `ColorConfig.blendEvaluationSpace`: `legacy-srgb` or `linear-srgb` | Supported separable formulas can evaluate in linear light; W3C non-separable modes retain defined encoded-RGB semantics | No claim of independent GPU parity; routes through fallback | Separate Document Panel control | Missing values resolve to legacy behaviour | Export target policy is explicit | blend evaluation tests | Partial |
| Alpha representation/compositing | Straight `ManagedColor` storage; premultiplied interpolation/compositor boundary | Porter–Duff coverage math; gradient interpolation premultiplies rectangular colour coordinates | Browser surface remains premultiplied where required | Not exposed as a colour-space choice | Alpha is preserved by import adapters | Raster flattening uses renderer semantics; vector alpha is retained where supported | interpolation/compositor/round-trip tests | Working on canonical paths |
| Compositing space | `workingSpace` is an authored/render intent, not a gradient selector | Canvas2D remains encoded-sRGB for ordinary native compositing; explicit linear blend paths use intermediate CPU composition | Same semantic fallback policy | Document working RGB is separate from blend evaluation | Profile intent is not silently rewritten | Flattening chooses an explicit output boundary | blend policy and renderer tests | Partial |
| Lab/LCH | Lab/LCH conversions exist in `colorConversion.ts` with D50 adaptation | Used by colour-management features, not exposed as gradient interpolation until the profile/white-point contract is uniform | N/A for gradients | Picker/profile UI only where supported | ICC/PDF paths can carry Lab semantics | Print export is profile-aware where native path is used | conversion round trips | Partial, intentionally not a gradient option |
| OKLab/OKLCH | Shared D65 analytical conversions and gamut mapping | Canonical gradient interpolation; OKLCH hue wrapping and achromatic safety | Canvas2D semantic island | Gradient Editor | Imported colours are converted at the managed-colour boundary | SVG bakes to an sRGB ramp when native syntax is unavailable | exact vectors, edge cases, codegen | Working |
| ICC/profile-managed conversion | Profile references in scene; native `varve-colour`/print path; browser analytical fallback | Cached/precomputed at boundaries, not per-frame gradient math | Not a GPU gradient transform | Document/print settings disclose profile limits | Format-specific preservation | PDF/X and raster export choose output intent explicitly | Rust/TS colour tests | Partial across formats |
| Wide gamut | Profiles include Display P3/Adobe RGB/ProPhoto; float colour values are representable | Some browser paths still convert through analytical sRGB adapters; no universal wide-gamut canvas target | Display target is currently RGBA8 | Profile controls exist, but no universal wide-gamut preview claim | Format support varies | Output profile is target-dependent | raster/profile tests | Partial |
| HDR | No HDR display/output contract | Float-capable buffers exist, but gradient/display values are not an HDR pipeline | No HDR shader contract | Not exposed | Not promised | Not promised | none for end-to-end HDR | Missing/scaffolded |
| Raster effects/gradient maps | Effect-specific models; no global blend-space switch | Each effect chooses its own working/display boundary; gradient maps reuse canonical stop interpolation where applicable | Effect support is target-specific | Effect-specific controls | Format-specific | Raster export follows the selected renderer path | effect/gradient-map tests | Partial |
| Export flattening | Target capability policy, not a document blend flag | Canonical replay for raster output | GPU uses semantic fallback when required | Export warnings where target cannot preserve semantics | N/A | SVG uses native/bake policy; PDF is a separate print pipeline; raster output follows render semantics | codegen/export tests | Partial |

## Canonical terminology

### Working colour space

The document’s authored RGB encoding and profile context. In Varve this is the
combination of `ColorConfig.workingSpace` (`srgb` or `linear`) and the selected
profile reference such as sRGB or Display P3. It does not determine how a
gradient travels between stops.

### Interpolation space

The coordinates used between adjacent gradient stops. Supported gradient
values are `srgb`, `linear-srgb`, `oklab`, `oklch`, and `hsl`. Lab/LCH conversion
exists, but those spaces are not exposed as gradient choices until the profile
and white-point contract is consistently available in every relevant path.

### Compositing space

The space in which source and backdrop pixels are combined. Ordinary Canvas2D
compositing remains encoded-sRGB for compatibility. A document working-space
setting is not permission to silently change every compositor or effect.

### Blend-mode evaluation space

The channels supplied to artistic formulas such as Multiply or Screen. Varve
stores this separately as `blendEvaluationSpace`. Separable formulas may use
linear-sRGB; W3C non-separable modes retain their defined encoded-RGB semantics.

### Hue interpolation method

For OKLCH/HSL, `shorter` is the default and correctly wraps 350° → 10° through
0°. `longer`, `increasing`, and `decreasing` are explicit alternatives.
Achromatic colours have no meaningful hue; the engine falls back to rectangular
coordinates rather than manufacturing a NaN or an arbitrary hue jump.

### Alpha representation

`ManagedColor` and scene serialization use straight/unassociated alpha. The
interpolation and compositor boundaries use premultiplied coverage math. Alpha
is never sent through Lab/OKLab as a fourth colour component, and transparent
stops do not contribute hidden RGB that creates halos.

## Gradient contract

New gradients created by `gradientFill()` and the Fill/Stroke inspectors carry
`interpolationSource: "document"`. They resolve the document’s
`ColorConfig.defaultGradientInterpolation` at the scene → engine boundary.
Designers can replace inheritance with a pinned `interpolationSpace`.

An old serialized gradient with neither field is historical encoded-sRGB. It is
not retroactively reinterpreted using the newer document default. This is the
backward-compatibility rule that keeps pre-feature documents visually stable.

The shared interpolation engine has one semantic implementation for byte/display
and normalized/working callers:

```text
ManagedColor
  → normalize tagged colour (without an editing-time RGBA8 round trip)
  → convert to interpolation coordinates
  → interpolate colour and alpha separately
  → apply hue policy / midpoint bias / achromatic safety
  → gamut-map when OKLCH leaves sRGB
  → convert to render RGB
  → premultiply only at the render/compositor boundary
```

Premultiplied interpolation is performed in rectangular coordinates. For a
transparent endpoint, the endpoint’s colour has zero coverage; this gives the
expected opaque-red → transparent-blue result without a dark fringe. Polar
interpolation with transparency deliberately uses its rectangular companion.

## Renderer and cache policy

Canvas2D cannot request OKLab/OKLCH interpolation consistently across browser
engines. Varve therefore samples non-native spaces through
`expandGradientStops()` and adds a deterministic ramp to the native gradient.
The gradient cache key includes stops, interpolation space, hue method, tiling,
transform, and bounds. The GPU compositor currently routes gradient and
unsupported-blend items through Canvas2D semantic islands; it must not silently
substitute sRGB shader interpolation.

The cache is a performance mechanism only. It cannot change document semantics,
and it is invalidated when any semantic dependency changes.

## Import/export policy

- SVG `color-interpolation="linearRGB"` is represented as `linear-srgb`.
- SVG sRGB gradients with no interpolation metadata retain the historical path.
- SVG can represent sRGB and linear-sRGB natively. OKLab/OKLCH/HSL are baked to
  deterministic sRGB stops and annotated with an explicit fidelity comment.
- HTML/CSS codegen carries `in oklab`, `in oklch`, `in srgb-linear`, or `in hsl`
  when the target syntax can express it. Older target policies must choose a
  fallback rather than claiming support.
- Raster export uses the canonical replay path, so the canvas and PNG-like
  output share interpolation semantics. PDF/X remains a separate native print
  pipeline with its own profile/output-intent constraints.
- CSS modern colour interpolation import, mesh/freeform gradients, full DeviceN
  preservation, HDR, and universal wide-gamut preview remain limitations.

## Frontend contract

The Gradient Editor labels the feature **Interpolation**, not Blend Mode. It
offers “Document default” plus concrete spaces, shows hue direction only for
OKLCH/HSL, keeps a live preview, and exposes a concise alpha/profile hint.
Multi-selection uses a textual “Mixed” state. The Document Panel exposes the
document default separately from Working RGB and Blend evaluation. All three
settings are undoable document state; gradient edits are one logical inspector
transaction, not a stream of per-frame undo entries.

## Key files

| File | Responsibility |
|---|---|
| `packages/scene/src/colorManagement.ts` | `ManagedColor`, profiles, document colour configuration |
| `packages/scene/src/types.ts` / `fills.ts` | Gradient schema, inheritance marker, constructors |
| `packages/shared/src/colorConversion.ts` | Transfer functions, XYZ/Lab/LCH/OKLab/OKLCH, gamut mapping |
| `packages/shared/src/colorInterpolation.ts` | Canonical interpolation, alpha, hue, midpoint, ramp expansion |
| `packages/editor/src/render/sceneToEngine.ts` | Resolve document inheritance before render IR |
| `packages/engine/src/engine.ts` / `replay.ts` | IR transport, Canvas2D gradient expansion and cache |
| `packages/editor/src/components/Inspector/color/GradientEditor.tsx` | Per-gradient UI and live preview |
| `packages/editor/src/components/Inspector/panels/DocumentPanel.tsx` | Document default/working/blend settings |
| `packages/codegen/src/svg.ts` / `html.ts` | SVG native/bake and CSS interpolation export policies |
| `docs/architecture/blend-evaluation-policy.md` | Artistic blend-mode evaluation and alpha policy |
| `docs/architecture/colour-management.md` | Profile/precision/native print boundaries |

## Deliberate limitations and priorities

- **P0 correctness:** keep legacy missing metadata on sRGB; preserve premultiplied
  alpha and hue/achromatic edge cases; never silently fall back from a selected
  perceptual space on a renderer path.
- **P1 parity:** add a native WebGPU gradient implementation only when it can
  consume the shared vectors and match Canvas2D; expand PDF/vector export
  preservation where the target supports it.
- **P2 colour management:** make browser profile conversion and effect working
  buffers fully profile-aware rather than relying on analytical sRGB adapters.
- **P3 future readiness:** HDR display transforms, wide-gamut end-to-end preview,
  mesh/freeform gradients, and spot/DeviceN interpolation policy.
