# Effect Rendering Architecture

**Date:** 2026-07-20 | **Status:** Verified

## Pass structure

Every `RenderItem` with effects goes through 5 rendering passes in
`packages/engine/src/replay.ts`. All passes iterate `item.effects` in
**array order** — there is no sorting or reordering. Each pass handles
a specific subset of effect types via `if/else if` dispatch and
`continue` for already-processed types.

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

1. **Array-order within each pass, no sort.** Every pass iterates
   `item.effects` in its original array order. Type filtering means this is
   not a globally ordered stack across pass categories.
2. **Cross-pass ordering is correct.** Backdrop → fills → content →
   main effects → edge highlight → post-render filters.
3. **Per-effect save/restore.** Each main effect renders independently;
   a failing effect never corrupts subsequent effects.
4. **Compositing modes are correct.** `destination-over` places shadows
   behind content; `source-over` places inner shadows on top.
5. **Figma/Illustrator semantic parity.** dropShadow = behind content,
   innerShadow = on top. Verified 2026-07-20.

## Per-node effect array order

Users reorder effects within a node through the Effects inspector. Reordering is
honoured among effects handled by the same pass. Cross-pass ordering remains
fixed: for example, `layerBlur` always runs before `dropShadow`, regardless of
their relative array positions. The model and UI currently present one list even
though the renderer executes type categories. This is tracked as an architecture
gap in `docs/audits/adjustment-effects-lut-hardening-2026-07-25.md`.

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

Each pass iterates `item.effects` in array order. Type dispatch determines which
pass handles each effect. Cross-pass order is hardcoded by the pass structure; it
is deterministic, but it is not equivalent to a globally reorderable effect
stack.

## Live effects (2026-08-07)

The procedural effects family (dither, paletteSnap, bloom, rgbSplit, crt,
vhs, lightShafts, lensFlare, lightLeak, caustics) renders through the
existing adjustment pipeline — `Adjustment → FilterIR → applySoftwareFilter`
— with per-kind kernels in `packages/engine/src/liveEffects/`. Metadata,
bounds expansion, quality tiers, coordinate-space anchoring, determinism,
and export behaviour are documented in
[docs/architecture/live-effects-system.md](live-effects-system.md).
