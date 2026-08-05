# Alpha-Aware Shadows and Effects Pipeline

**Date:** 2026-08-02 | **Status:** Implemented

Companion to [`effect-rendering.md`](effect-rendering.md) (pass structure and
canonical schema). This document covers how drop/inner shadows and glows are
derived from an item's **rendered alpha silhouette** rather than its bounding
rectangle, the coordinate/bounds semantics, the backend matrix, and the
extension path.

## Why silhouette-based shadows

The fast geometric shadow path casts a shadow from `traceOutline(primitive)`
— the item's outline. That is wrong whenever the visible alpha differs from
the outline:

| Content | Outline problem |
|---|---|
| Transparent PNG / cut-out subject | Rectangular shadow, filled internal holes |
| Background-removal (alpha-mask) image | Shadow of the full image rectangle |
| Cropped / rotated / flipped image | Shadow of the un-cropped, un-transformed image |
| Text | Shadow of the text box, not the glyphs |
| Stroke-only line / arrow | Zero-area fill casts no shadow at all |

## The canonical shadow source: `renderShadowSource`

`packages/engine/src/shadowSource.ts` exports `renderShadowSource(target,
item, ops)`, which rasterizes the item's visible alpha silhouette into a
target context in opaque black:

- **Image fills** draw their true alpha via the same `paintImageFill` path as
  the main fill pass, so transparent pixels, internal holes, feathered edges,
  crop, rotation, flips, and the background-removal `alphaMask` all carry
  into the shadow.
- **Solid / gradient / pattern fills** contribute the shape outline at full
  alpha. (Uniform internal fill alpha is carried by item opacity during
  compositing, so flattening it here matches the fast path.)
- **Text** contributes glyph alpha (antialiased edges, counters,
  decorations) via `paintShapeFill` → `paintText`.
- **Visible strokes** contribute their stroked silhouette, so stroke-only
  objects still cast shadows.

`ShadowOps` injects the rendering primitives (`traceOutline`, `paintShapeFill`,
`paintImageFill`, `paintStroke`, `primitiveBounds`, `rgba`,
`createEffectBuffer`) from `replay.ts`. This keeps `shadowSource.ts` a leaf
module (no import cycle) and keeps `replay.ts` under its cyclomatic-complexity
ceiling.

### Drop shadow / outer glow: shadow-only compositing

`paintAlphaAwareDropShadow`:

1. Rasterizes the silhouette into a padded buffer.
2. Draws that buffer with the Canvas shadow API onto a scratch canvas.
3. Erases the source pixels (`destination-out`) leaving only the shadow.
4. Composites the shadow-only canvas behind the item (`destination-over`).

Compositing a *shadow-only* canvas (rather than drawing the silhouette with a
shadow directly) keeps semi-transparent items correct: the silhouette is never
re-drawn over the item's already-composited pixels.

### Inner shadow / inner glow: silhouette difference

`paintAlphaAwareInsetEffect`:

- **Inner shadow**: rasterize the silhouette, cut a hole where the *offset*
  silhouette falls (`destination-out`), blur, tint, composite clipped to the
  shape.
- **Inner glow**: `blurred(silhouette) − silhouette`, kept only inside the
  silhouette — a ring hugging the inner contour of arbitrary alpha (glyph
  counters, holes, feathered masks) instead of a shrunk bounding rectangle.

Opacity: shadow alpha = `item.opacity × effect.opacity`, applied once at the
final composite (the previous implementation multiplied it a second time in
the tint).

## Effect input mode per node type (default selection)

`itemNeedsAlphaShadow` chooses the silhouette path (alpha-based) for:

- text primitives → glyph alpha
- any visible image fill → raster alpha
- stroke-only items → stroke silhouette

Everything else (solid/gradient/pattern fill on a shape) uses the **fast
geometric path** (`paintGeometricDropShadow`), which now also strokes the
outline so fill+stroke unions cast a shadow. The geometric path is the
geometry-based input mode; raster/text are alpha-based. Luminance-based and
explicit bounds-based modes are future extension points, not silent fallbacks.

## Group-level effects

The live canvas (`CanvasArea.tsx`) flattens a group subtree and applies
effects to the composited silhouette. `replayStructuredScene`
(`packages/editor/src/render/replayScene.ts`) — the shared path behind raster
exports and SpecPanel previews — now does the same:

- Flattens children into a bounded `CompositeCanvas` (world bounds + subtree
  effect padding).
- `compositeGroupOuterEffect`: dropShadow/outerGlow via the shadow-only
  technique, composited ahead of the group content with the effect's blend
  mode (parity with the live canvas).
- `applyGroupInsetEffect`: innerShadow/innerGlow via silhouette-difference +
  `gaussianBlurSeparable` (ported from `renderGroupInsetEffect`).
- Layer blur composites through `applyLayerBlur`.
- Group opacity and non-pass-through blend modes are applied at the final
  composite.

## Effect ordering

Per-item pass order (see `effect-rendering.md`):

1. Source content (fills + strokes)
2. Backdrop effects (`backgroundBlur`, `glassMaterial` backdrop)
3. Content effects (`layerBlur`, `chromaticAberration`, `glitch`)
4. Outer effects (`dropShadow`, `outerGlow`) — behind content
5. Inner effects (`innerShadow`, `innerGlow`) — on top, clipped to shape
6. Edge highlight, post-render filters

Multiple shadows of the same type execute in array order, each in its own
`save/restore`. Effects are keyed by stable `id` in the inspector so reorder
does not corrupt row state.

## Alpha and premultiplication

The Canvas shadow API and `drawImage`/`destination-out` compositing run in the
browser's straight-alpha compositing model (gamma space), matching the
existing replay pipeline (see `.effects_system_memory.md` decision: composite
in gamma, blur in linear-light where implemented). Image fills are drawn
through `paintImageFill`, which handles the background-removal mask via
`renderMaskedImageSample` (`destination-in`), so the shadow inherits the same
masked silhouette as the visible content — no dark fringes or leaked RGB from
transparent pixels.

## Effect bounds and invalidation

`packages/scene/src/flatten/bounds.ts::effectPadding` now matches the
renderer's blur extent:

- `dropShadow`: `blur*3 + max(0, spread)/2` per side + directional offset.
- `outerGlow`: `blur*3 + max(0, spread)/2` symmetric.
- `layerBlur`/`backgroundBlur`: `radius*3`.
- `innerShadow`/`innerGlow`: `0` (clipped to the shape; never expand bounds).
- Unknown types: `0`.

These feed export "visual" bounds, flatten bounds, and dirty-region padding.
The canvas's own `appearancePaddingLocal` was already `blur*3`-based.

Malformed parameters (NaN, Infinity, negative, huge values) are clamped by
`normalizeEffectParams` in `packages/scene/src/effects.ts` at document load,
and shadow renderers additionally guard via `finiteOr` with a 2048px pad cap,
so a corrupt document cannot allocate NaN or gigantic buffers.

## Backend capability matrix

| Backend | Path | Shadows | Notes |
|---|---|---|---|
| Canvas2D replay (live + export) | `shadowSource.ts` via `replay.ts` | Full (silhouette) | Canonical renderer |
| Canvas2D structured replay (export, SpecPanel) | `replayScene.ts` | Full for leaf + group effects | Canonical for exports |
| WebGPU compositor | `Canvas2DBackend.drawVectorItems` → `replayIr` | Full | Falls through to replay |
| WASM / native Rust `build_ir_json` | IR build only | N/A | Rust mirrors the schema; pixels are produced by Canvas2D replay |
| CSS `filter` | not used for shadows | — | Not authoritative for shadows |

The canonical, deterministic renderer is the Canvas2D replay; raster export
and thumbnails reuse it, so live canvas and exported pixels agree. CSS
`box-shadow` / `filter: drop-shadow()` are never used for canvas objects.

## Export behavior

- **Raster (PNG/JPEG/WebP)**: uses the same `flattenSceneToEngine` →
  `buildIr` → `replayStructuredScene` pipeline, so alpha-aware shadows are
  pixel-identical to the live canvas. "Visual" export bounds include effect
  padding so the blur fringe is not clipped.
- **SVG / HTML codegen**: `buildEffectSpec` maps scene `x/y/blur` → codegen
  `offsetX/offsetY/radius` (previously read non-existent `offsetX` fields,
  emitting zero-size shadows). SVG does not emit native filters for shadow
  blur spread; unsupported cases are flagged as flatten/warning paths.
- **PDF / print**: preserves vector output where the target backend supports
  it; otherwise flatten at export resolution.

## Cache and invalidation rules

There is no per-effect bitmap cache in this pipeline yet: the silhouette
buffers are allocated per frame (bounded by the 2048px pad cap). The existing
image and masked-image caches (`imageCache`, `maskedImageCache`) already key
on image identity + placement + crop, so the per-frame cost is the buffer
compositing, not image re-decoding. Adding a silhouette/effect cache keyed by
(node revision, effect params, transform scale, dpr) is the recommended next
step; correctness must not depend on it (document semantics are
cache-independent).

## Known limitations

- Per-effect `blendMode` on shadows is applied for group-level shadows; at the
  leaf level the shadow composites with `destination-over` (blend modes on
  leaf shadows are not composited into an isolated group). Same as before this
  work; tracked as a follow-up.
- Fast-path geometric shadows follow the outline (plus strokes), not a
  per-pixel silhouette of gradient alpha.
- Leaf inner glow on alpha content uses the blur-ring approximation; spread
  erosion is honored for groups, not per-leaf.
- Pattern fills contribute shape geometry (tile alpha is not carried into the
  shadow silhouette).
- `normalizeEffectParams` clamps extreme values rather than warning the user;
  the inspector does not surface the clamp.

## How to add a new effect

1. Add the variant to the `Effect` union in `packages/scene/src/types.ts`.
2. Add the mirror to `packages/engine/src/types.ts` (and `varve-core` if the
   native IR must transport it).
3. Add the `defaultEffect` entry and parameter controls in
   `packages/editor/src/components/Inspector/sections/EffectsSection.tsx`.
4. Add a render branch in the appropriate pass in `replay.ts` (leaf) and
   `replayScene.ts` (group), reusing `renderShadowSource` where the effect is
   alpha-derived.
5. Add `effectPadding` coverage in `packages/scene/src/flatten/bounds.ts`.
6. Add regression tests (see next section).

## How to create visual-regression fixtures

Engine-level tests use the `recorder()` pattern (see
`packages/engine/src/effects-shadow.test.ts`): a `ReplayTarget` records call
sequences so tests assert *what was drawn* (no rect-fill over transparent
holes, drawImage silhouette compositing, glyph `fillText`, stroke shadows,
opacity scaling) without a real rasterizer. Pixel-level parity is covered by
Playwright E2E against the live canvas and by exporting through the same
`replayStructuredScene` path.

## Performance budgets

- Buffer allocations are bounded by content size + `blur*3 + spread/2`
  (≤ 2048px pad). Malformed documents cannot grow allocations.
- The silhouette path is only taken for raster, text, and stroke-only items;
  solid/gradient shapes keep the fast geometric path.
- The engine benchmark suite (`packages/engine/src/bench/`) and the canvas
  perf harnesses (see `docs/perf/`) measure replay cost; per-item effect
  compositing is covered by `replay-fill.test.ts` timing expectations.

## Troubleshooting

- **Shadow looks rectangular around a PNG**: confirm the item is an image fill
  (not a solid fill) and the image is loaded in `imageCache`; the silhouette
  path requires the image bitmap.
- **Shadow wrong after background removal**: the `alphaMask` on the image fill
  must be resolvable in `getImageCache`; check `renderMaskedImageSample`.
- **Export differs from canvas**: both use `replayStructuredScene`; differences
  are a bug — file with the document state and exported pixels.
- **NaN / crash on load**: `normalizeDocumentEffects` should have clamped
  parameters; if a crash persists, capture the document JSON and the effect
  that triggered it.
