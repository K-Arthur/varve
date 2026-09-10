# Blend Evaluation Policy

## Terminology

Varve keeps these operations separate:

- **Working RGB** identifies the document's authored RGB encoding/profile.
- **Gradient interpolation** chooses coordinates used between gradient stops.
- **Blend evaluation** supplies color channels to an artistic blend formula.
- **Porter-Duff compositing** combines source and backdrop coverage using alpha.
- **Display/output conversion** maps render values to a screen or export target.

`BlendEvaluationSpace` is not a synonym for any of the other four concepts.

## Policy

The serialized values are:

| Value | Meaning |
|---|---|
| `legacy-srgb` | Evaluate artistic formulas on encoded sRGB channels. This is the compatibility default. |
| `linear-srgb` | Decode sRGB channels, evaluate supported separable formulas in linear light, then re-encode. |

The policy table is exported as `BLEND_EVALUATION_POLICIES` from
`@varve/shared` and consumed by the CPU compositor.

| Mode family | Linear evaluation | Reason |
|---|---:|---|
| Normal | No | Normal is source selection plus alpha compositing, not an artistic formula. |
| Multiply, Screen, Overlay, Darken, Lighten, Color Dodge, Color Burn, Hard Light, Soft Light, Difference, Exclusion | Yes | These are separable channel formulas and have defined linear-light variants. |
| Hue, Saturation, Color, Luminosity | No | Varve retains W3C SetSat/SetLum encoded-RGB semantics. It does not invent a linear HSL interpretation. |
| Plus Lighter / Plus Darker | No | These are composite operations, not separable blend formulas. |

Unknown persisted values resolve to `legacy-srgb`.

## Compatibility

`ColorConfig.blendEvaluationSpace` is optional on the wire. Documents without
the field resolve to `legacy-srgb`, except for documents that explicitly used
the former `workingSpace: 'linear'` opt-in. New documents use the explicit
`legacy-srgb` default. No migration rewrites authored color values.

The inspector exposes Working RGB and Blend evaluation as separate advanced
controls. Changing Blend evaluation is a settings change and is undoable; it
does not mutate gradient stops or authored colors.

## Alpha Boundary

Stored colors and compositor API inputs are straight RGBA in normalized
channels. The CPU compositor computes the source-uncovered, overlap, and
backdrop-uncovered terms using premultiplied coverage math, then returns
straight RGBA. Alpha is coverage and is never transfer-decoded.

The Canvas2D renderer uses native compositing for `legacy-srgb`. When a real
Canvas target requests `linear-srgb` for an item-level non-normal blend, the
item is rendered to an intermediate surface and passed through the canonical
CPU pixel compositor. Targets without pixel read/write access retain the
existing structural fallback behavior and do not claim linear parity.

## Gradient Contract

Gradient IR carries both `interpolationSpace` and `hueInterpolation`, including
`linear-srgb`. These fields are preserved by the TypeScript stub and the Rust
bridge. Missing fields retain the established gradient defaults. Canvas2D
pre-expansion passes the hue strategy to the shared interpolation engine and
includes it in the bounded gradient cache identity.

SVG import maps ordinary gradients to explicit sRGB interpolation, maps
`color-interpolation="linearRGB"` to `linear-srgb`, preserves stop opacity,
linear/radial geometry at the current model's fidelity, and maps repeat/reflect
spread modes. Unsupported paint resources produce warnings rather than being
silently treated as solid colors.

## Known Boundaries

- WebGPU still uses Canvas2D semantic islands for gradients and artistic blends;
  fixed-function source-over is not advertised as artistic blend support.
- PDF gradient and transparency preservation remains a separate print-path gap;
  the current implementation must not be described as full PDF color-space
  preservation.
- CSS gradient import, full modern CSS color syntax, mesh gradients, HDR display
  transforms, and profile-aware DeviceN separation remain future work.
