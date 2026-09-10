# Text on Path

**Status:** editor workflow and Canvas2D replay complete; native SVG export
complete with documented fidelity warnings; advanced outline/PDF export remains
deferred

Text on Path keeps the label and its source geometry as independent scene nodes.
The text node stores only a stable reference and normalized layout settings:

```ts
{
  pathNodeId: string,
  startOffset?: number, // normalized 0..1 along the path
  endOffset?: number,   // normalized 0..1; closed paths may cross the seam
  side?: 'top' | 'bottom',
  flip?: boolean,
  baselineShift?: number // text-space pixels
}
```

## Runtime path

The editor conversion resolves the referenced shape at render time and converts
it into the text node's space using the full world transforms. The engine then
uses the ordinary text shaping entry point to produce grapheme/ligature
clusters, measures a deterministic arc-length path, and emits one placement per
cluster. Canvas2D replays each placement with a glyph-local transform.

```text
Scene TextNode + referenced ShapeNode
  → sceneNodeToEngineNode
  → pathShape in text space
  → shapeText / browser measurement fallback
  → arc-length sampler and tangent
  → Canvas2D glyph replay
```

Supported source geometry includes circles, ellipses, rectangles, lines,
arrows, polygons, stars, and Bézier paths. Circles and basic primitives use
direct samplers; ellipses use a cached numerical arc-length table; Bézier paths
use a deterministic cumulative lookup table. Degenerate geometry returns no
placements and never emits non-finite coordinates.

The editor exposes attach and detach actions, path-side and flip controls,
start/end interval controls, and baseline shift. Slider gestures are pointer
captured and coalesced into one undo transaction. Missing or deleted paths
degrade to the text node's normal rectangular fallback, while the scene
reference is remapped when a path and its label are cloned together.

Selection, hit-testing, spatial indexing, reveal, and fit helpers use a
conservative world bound around the referenced path, padded by the text size
and baseline shift. This keeps the label discoverable after it leaves its
original text box; exact ink bounds are still derived by the engine painter.

## Export behavior

SVG export emits a native `<textPath>` and a hidden `<path>` definition in the
text node's relative coordinate space. Missing references are exported as flat
text with a `varve: path text` comment. The emitter also preserves Varve data
attributes for path identity and settings.

SVG cannot reproduce every Canvas2D detail portably. The export diagnostics
warn when `side`, `flip`, `baselineShift`, a bounded interval, or rich-text
formatting may differ; exact fidelity for those cases requires outlined or
rasterized export. The native PDF writer currently supports straight text, so
PDF routes path text through an affected-node raster boundary rather than
silently exporting it at the original rectangular text position.

## Known limits

The browser-only shaping fallback measures grapheme clusters with Canvas2D. It
does not claim HarfBuzz-level kerning, ligature, or complex-script parity when
font bytes are unavailable. Native/WASM shaping remains the authoritative route
for those cases. Path text currently flattens multiline content to one visual
line, and direct on-canvas caret/handle editing and exact path-text ink bounds
are future work. Rich text uses the renderer's documented plain-text fallback
on a path.

Relevant implementation and regression coverage:

- `packages/engine/src/pathText.ts` — geometry, arc-length, and placement
- `packages/engine/src/replay.ts` — Canvas2D replay
- `packages/editor/src/render/sceneToEngine.ts` — live path resolution
- `packages/editor/src/components/Inspector/sections/PathTextSection.tsx` — controls
- `packages/codegen/src/svg.ts` — native SVG `<textPath>` export
- `tests/e2e/canvas/text-on-path.spec.ts` — real editor workflow
