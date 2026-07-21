# Effect Rendering Architecture

**Date:** 2026-07-20 | **Status:** Verified

## Pass structure

Every `RenderItem` with effects goes through 5 rendering passes in
`packages/engine/src/replay.ts`. All passes iterate `item.effects` in
**array order** — there is no sorting or reordering. Each pass handles
a specific subset of effect types via `if/else if` dispatch and
`continue` for already-processed types.

### Pass 1 — Backdrop effects (lines 704–713)

Processes: `backgroundBlur`, `glassMaterial` backdrop

Captures the canvas region behind the item **before any fills** are
painted. Results are composited behind the item's content.

### Pass 2 — Fills + Strokes (lines 715–754)

Renders all fills (in array order) then all strokes (in array order).
When content-affecting effects are present (`layerBlur`,
`chromaticAberration`, `glitch`), fills and strokes are painted to an
offscreen `CompositeCanvas` and the content effects are applied in
sequence. The result is composited back to the main canvas.

### Pass 3 — Main effects (lines 756–804)

Processes: `dropShadow`, `innerShadow`, `outerGlow`, `innerGlow`

Each effect gets its own `save()`/`restore()` scope:

| Effect | Compositing | Visible position |
|--------|------------|------------------|
| `dropShadow` | `destination-over` | Behind content |
| `outerGlow` | `destination-over` | Behind content (zero-offset shadow) |
| `innerShadow` | `source-over` | On top, clipped to shape |
| `innerGlow` | `source-over` | On top, clipped to shape |

### Pass 4 — Glass material edge highlight (lines 806–813)

Processes: `glassMaterial.edgeHighlight`

Thin inner stroke rendered after fills but before post-render filters.

### Pass 5 — Post-render filters (lines 815–831)

Non-CSS filters (non-normal blend mode, opacity < 1, or unsupported
by CSS `filter`) are composited over the final per-item result via
offscreen canvas. Simple CSS filters are applied earlier (line 678–689)
via `target.filter`.

## Verified invariants

1. **Array-order, no sort.** Every pass iterates `item.effects` in its
   original array order. The only filtering is by effect type.
2. **Cross-pass ordering is correct.** Backdrop → fills → content →
   main effects → edge highlight → post-render filters.
3. **Per-effect save/restore.** Each main effect renders independently;
   a failing effect never corrupts subsequent effects.
4. **Compositing modes are correct.** `destination-over` places shadows
   behind content; `source-over` places inner shadows on top.
5. **Figma/Illustrator semantic parity.** dropShadow = behind content,
   innerShadow = on top. Verified 2026-07-20.

## Per-node effect array order

Users reorder effects within a node (via drag in the Effects inspector
section). The engine renders them in whatever order the array specifies.
There is no implicit sort by effect type or any other property. This
matches Figma's behavior.

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

Each pass iterates `item.effects` in array order. Type dispatch
determines which pass handles each effect. Cross-pass order is
determined by the pass structure, which is hardcoded and verified
correct.
