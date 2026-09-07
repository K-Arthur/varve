# Effect Rendering Architecture

**Date:** 2026-09-07 | **Status:** Verified

The canonical owner and layer-type contract now lives in
[layer-effects.md](layer-effects.md). This page documents the renderer's
pass-level implementation.

## Pass structure

Every `RenderItem` with effects goes through 5 rendering passes in
`packages/engine/src/replay.ts`. The authored array is filtered by effect
stage; there is no hidden sort. Each stage preserves array order for the
effects it owns, while the stage order is explicit and deterministic.

### Effect-local masks (staged)

An effect mask belongs to an effect identity, never to an array position. The
scene contract is `Effect.mask: EffectMaskBinding`; legacy effect IDs are
materialized deterministically as `fx-<node-id>-<ordinal>`, so reordering does
not move a mask to another effect. The canonical stage operation is:

```text
I = input before the effect
E = fully evaluated effect
M = effect mask coverage
output = I × (1 − M) + E × M
```

The Canvas2D engine implements this operation for raster effect-mask sources
using premultiplied-alpha pixel compositing, including alpha/luminance,
inversion, density, and missing-source-safe behavior. Structural scene replay
uses the same operation for live scene-node and vector sources. The Effects inspector can
author a live scene-node source (including text and groups), edit alpha versus
luminance, density, feather, inversion, and coordinate space, and remove it in
one undoable document update. Scene-node and vector sources share the
serializable contract and dependency graph; the flat worker path is routed to
structural replay for these bindings. A missing source remains an unmasked
effect rather than making the owner transparent.

## Canonical schema and native interchange

The document-level `Effect` discriminated union is owned by `@varve/scene`.
Each effect may carry a stable `id`; document normalization assigns missing IDs
and repairs duplicates without changing valid IDs. The Rust `varve-core::Effect`
wire representation mirrors all nine TypeScript variants, retains optional IDs,
and uses the same camelCase field names. Older documents without IDs remain
valid and omit the field when serialized through Rust.

Rust currently stores and transports every effect, but Canvas2D/software replay
remains the authoritative renderer for chromatic aberration, glitch, blur, glow,
glass, and alpha-aware shadows. Export capability planning must rasterize an
effected subtree unless the target backend can reproduce the canonical pixels.

### Pass 1 — Backdrop effects (lines 704–713)

Processes: `backgroundBlur`, `glassMaterial` backdrop

Captures the canvas region behind the item **before any fills** are painted.
The processed surface is composited through the item's visible alpha when the
owner is text, raster, or image-backed content; a geometric clip is used only
when it is equivalent to the painted coverage. Results are composited behind
the item's content.

### Pass 2 — Outer appearance (before source content)

Processes: `dropShadow`, `outerGlow`

Outer effects are rendered from a shadow-only or outside-alpha surface after
backdrop capture and before the layer's source is painted. This keeps a
displaced shadow behind opaque source pixels and keeps transparent holes
transparent.

### Pass 3 — Fills + Strokes (lines 715–754)

Renders all fills (in array order) then all strokes (in array order).
When content-affecting effects are present (`layerBlur`,
`chromaticAberration`, `glitch`), fills and strokes are painted to an
offscreen `CompositeCanvas` and the content effects are applied in
sequence. The result is composited back to the main canvas.

### Pass 4 — Main inset effects (lines 756–804)

Processes: `dropShadow`, `innerShadow`, `outerGlow`, `innerGlow`

Each effect gets its own `save()`/`restore()` scope:

| Effect | Compositing | Visible position |
|--------|------------|------------------|
| `dropShadow` | shadow-only surface + effect blend mode | Before content |
| `outerGlow` | outside-alpha surface + effect blend mode | Before content |
| `innerShadow` | alpha-masked inset surface | On top of content |
| `innerGlow` | alpha-product ring + effect blend mode | On top of visible alpha |

### Pass 4 — Glass material edge highlight (lines 806–813)

Processes: `glassMaterial.edgeHighlight`

Thin inner stroke rendered after fills but before post-render filters.

### Pass 5 — Post-render filters (lines 815–831)

Non-CSS filters (non-normal blend mode, opacity < 1, or unsupported
by CSS `filter`) are composited over the final per-item result via
offscreen canvas. Simple CSS filters are applied earlier (line 678–689)
via `target.filter`.

## Verified invariants

1. **Array-order within each stage, no sort.** Every stage iterates
   `item.effects` in its original array order. Type filtering means this is
   not a globally ordered stack across stage categories.
2. **Cross-pass ordering is correct.** Backdrop → fills → content →
   main effects → edge highlight → post-render filters.
3. **Per-effect save/restore.** Each main effect renders independently;
   a failing effect never corrupts subsequent effects.
4. **Compositing modes are correct.** Outer effects are rendered as
   shadow-only surfaces, so effect blend modes can be honoured without
   repainting the source over an opaque backdrop. Inner effects are clipped to
   visible alpha and use their authored blend mode.
5. **Figma/Illustrator semantic parity.** dropShadow = behind content,
   innerShadow = on top. Verified 2026-07-20.

## Per-node effect array order

Users reorder effects within a node through the Effects inspector. Reordering is
honoured among effects handled by the same pass. Cross-pass ordering remains
fixed: for example, `layerBlur` always runs before `dropShadow`, regardless of
their relative array positions. The inspector therefore disables cross-stage
moves instead of offering controls that cannot change execution. Mixed selection
rows resolve by stable effect ID, then same-stage/type ordinal for legacy stacks.

The renderer never sorts the authored array behind the user's back. The array
remains the persistence and mask-identity contract; stage-aware controls are the
editing contract that makes the fixed pass order honest.

## Effect-specific controls

The inspector intentionally does not present one generic parameter group for
every effect:

- shadows expose X/Y plus synchronized angle/distance, blur, positive/negative
  spread, opacity, colour, and blend mode;
- glows expose blur, spread, choke, contour, opacity, solid or normalized
  effect-domain gradient colour treatment, and blend mode; inner glow also
  exposes edge/center origin;
- layer/background blur expose radius independently;
- depth blur exposes focus depth/range, strength, falloff, inversion, and edge
  protection, and remains neutral when no depth resource is attached;
- glass exposes blur, tint, tint opacity, saturation, brightness, noise, and
  configurable edge highlight colour/width/opacity;
- chromatic aberration exposes RGB channel offsets, Mix, intensity, opacity,
  and blend mode, or a custom contribution list with red/green/blue/luminance/
  alpha sources, independent offsets, strength, and output colours;
- glitch exposes displacement direction, deterministic seed, density, slice
  and block controls, channel shifts, noise, scanlines, opacity, and blend
  mode.

These semantics follow the effect-specific controls documented by
[Figma's layer effects guide](https://help.figma.com/hc/en-us/articles/360041488473-Apply-shadow-or-blur-effects),
[Adobe's layer-style reference](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/apply-layer-effects/layer-style-effects-and-options-overview.html),
and the alpha/compositing rules in the [W3C Filter Effects specification](https://www.w3.org/TR/filter-effects-1/)
and [W3C Compositing specification](https://www.w3.org/TR/compositing-1/).

## Summary

```
Pass 1: backgroundBlur, glassMaterial backdrop
  ↓
Pass 2: fills → strokes → [layerBlur, chromaticAberration, glitch]
  ↓
Pass 3: dropShadow (behind), outerGlow (behind),
        innerShadow (on top), innerGlow (on top)
  ↓
Pass 4: glassMaterial.edgeHighlight
  ↓
Pass 5: post-render filters (complex)
```

Each pass filters `item.effects` without sorting it. Type dispatch determines
which pass handles each effect. Cross-pass order is hardcoded by the pass
structure; it is deterministic, but it is not equivalent to a globally
reorderable effect stack.

## Live effects (2026-08-07)

The procedural effects family (dither, paletteSnap, bloom, rgbSplit, crt,
vhs, lightShafts, lensFlare, lightLeak, caustics) renders through the
existing adjustment pipeline — `Adjustment → FilterIR → applySoftwareFilter`
— with per-kind kernels in `packages/engine/src/liveEffects/`. Metadata,
bounds expansion, quality tiers, coordinate-space anchoring, determinism,
and export behaviour are documented in
[docs/architecture/live-effects-system.md](live-effects-system.md).
