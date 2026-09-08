# Stroke system

**Updated:** 2026-09-07

This document is the capability contract for live strokes. It separates the
authored document model from the Canvas2D replay path and from export
fallbacks. A field existing in the schema is not, by itself, a promise that
every target or export format supports it.

## Model and identity

`Stroke` is an ordered, independently painted entry. It owns its paint,
weight, alignment, dash pattern and phase, cap, join, miter ratio, visibility,
optional gradient, optional per-side rectangle weights, and optional endpoint
markers. The optional `id` is a stable identity within the owning node.

The document codec assigns deterministic `stroke-<node>-<index>` identities to
legacy entries and preserves valid IDs through reorder and reload. Duplicated
or copied entries receive independent IDs. This is intentionally a per-node
identity; the stack position remains the paint-order contract.

Missing, hidden, zero-width, transparent, and unsupported strokes remain
distinct states. A zero-width or hidden entry paints nothing and never causes a
fallback hairline.

## Geometry and paint rules

- Center alignment uses the native Canvas2D path stroke.
- Inside alignment clips the stroke to the closed path's fill region.
- Outside alignment renders a doubled stroke into an isolated surface, removes
  only that surface's interior coverage, and composites the result over the
  destination. It never uses `destination-out` on the document surface.
- Open paths, lines, arrows, and text have no enclosed region for inside or
  outside semantics and are rendered centered. The inspector should not imply
  otherwise for those targets.
- Compound paths replay every contour. A closing cubic segment uses the last
  anchor's outgoing handle and the first anchor's incoming handle; `closePath`
  is not allowed to replace an authored closing curve.
- Rectangles and frames may use `[top, right, bottom, left]` per-side weights.
  The current live implementation uses butt-ended edge segments for square
  corners; rounded asymmetric borders remain a known limitation.
- Miter limits are dimensionless ratios and are clamped to at least `1` before
  reaching Canvas2D.
- Pressure `0.5` is neutral base width, `0` is a deliberate taper to zero,
  and `1` is twice the base width. Uniform pressure uses the uniform path
  route; only genuine pressure variation uses the variable-width path route.

Stroke gradients use the same canonical spatial gradient evaluator as fills.
The renderer resets Canvas2D dash state for every entry, so a solid stroke
cannot inherit a previous entry's pattern. The inspector accepts comma- or
space-separated finite non-negative values; blank and all-zero patterns mean
solid, while malformed input is rejected without mutating the document.

## Capability matrix

| Capability | Shape/path | Editable text | Image/raster | Frame/rectangle | Canvas2D / WASM | Native IPC | SVG | PDF/print |
|---|---|---|---|---|---|---|---|---|
| Solid paint | live | live glyph/content-aware route | rectangular/content-aware route | live | yes | basic fields mirrored | yes, center semantics | renderer-dependent |
| Spatial gradient paint | live | live where gradient surface is available | supported on border/silhouette route | live | yes | payload preserved for webview | linear/radial direct; other types preflight | print compositor |
| Center alignment | yes | yes | content-aware | yes | yes | yes | yes | yes |
| Inside/outside | closed geometry | alpha-aware; open/text center fallback | alpha-aware silhouette | yes | yes with bounded surface | field preserved | simplified/baked when target lacks it | bake/raster fallback |
| Caps/joins/miter | yes | glyph outline route | not a centerline property | yes | yes | fields mirrored | yes where SVG supports it | yes where vector path remains |
| Dashes/phase | yes | supported for direct glyph stroke only where browser accepts it | not meaningful for alpha silhouettes | yes | yes | basic pattern/phase | yes for emitted center strokes | export path decides |
| Per-side weights | rect/path owner only | no | rectangular border only | yes | yes for square rectangles | mirrored | requires per-edge expansion | requires expansion |
| Markers | open line/path | no | no | no | direct line/arrow/path | endpoint fields mirrored | emitter-specific | expansion required |
| Pressure / variable width | open/closed paths | no | no | no | continuous bounded route | source points preserved in IR | outline required for fidelity | outline/raster fallback |
| Multiple entries / order | yes | yes | yes | yes | ordered replay | ordered vector | one direct stroke; complex stacks preflight | ordered compositor |

“Native IPC” means transport and preservation, not that every field is
evaluated inside Rust. The browser/Tauri webview replay is the current visual
authority for these fields; unsupported native or export capabilities must
remain visible as a preflight limitation rather than being silently dropped.

## Compatibility

Stroke IDs are additive and optional on the wire. Old documents without IDs
open unchanged and gain identities when normalized; no authored geometry or
paint value is reinterpreted. The Rust bridge mirrors the camelCase stroke
fields, including IDs, arrows, per-side weights, and preserved gradient data.

Clipboard style application clones stroke payloads and mints destination IDs,
so editing a pasted style cannot alias the source stack. History records the
whole ordered stroke array through the existing transaction coordinator.

## Research basis

The product contract was checked against [Figma's stroke property and layer
support matrix](https://help.figma.com/hc/en-us/articles/360049283914-Apply-and-adjust-stroke-properties),
[Figma's `strokeAlign` API reference](https://developers.figma.com/docs/plugins/api/properties/nodes-strokealign/),
[Affinity Designer's Stroke panel](https://affinity.help/designer2/en-US.lproj/pages/Panels/strokePanel.html),
and the [SVG 2 painting](https://www.w3.org/TR/SVG2/painting.html) and
[coordinate/vector-effects](https://www.w3.org/TR/SVG2/coords.html#VectorEffects)
specifications. These references inform semantics; they do not imply that
Varve's Canvas2D, native, or export routes support every feature.
