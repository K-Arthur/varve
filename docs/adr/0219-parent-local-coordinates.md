# ADR-0219 — Parent-Local Scene Coordinates

- Status: accepted
- Date: 2026-08-12
- Deciders: architecture session (artboard-local coordinate space task)
- Supersedes: scattered `artboard.x + child.x` arithmetic, inline
  world→parent conversions per tool, and codegen/export paths that read
  `node.transform` without folding the `rotation` field.

## Context

Varve's scene model stores a local→parent affine (`transform`) on every
node, but consumers disagreed about what the stored coordinates meant:
rendering composed ancestor chains correctly, while boolean ops clipped in
each operand's own local frame, codegen dropped the separate `rotation`
field, nudge/drag reparent decisions read `transform[4/5]` as world
coordinates, and five tools inlined their own `parent⁻¹ × world`
conversion. Cross-artboard operations (boolean, paste) either produced
wrong geometry or teleported to the world origin.

Two architectures were considered:

- **Artboard-local only** — children of artboards store artboard-relative
  coordinates; everything else stays world. Smallest change, but leaves
  groups/nested frames inconsistent and re-creates the same problem at the
  next container level.
- **Generalized parent-local scene coordinates** — every node's transform is
  relative to its immediate parent; world transforms are derived by ancestor
  composition. Matches the existing storage model (all nodes already carry
  `transform`), extends to groups/frames/components/layout, and is the model
  used by Figma/Penpot/Godot.

## Decision

Adopt **generalized parent-local scene coordinates** (Option B):

1. Every node's `transform` (with the separate `rotation` field folded as
   `transform · rotate`) is relative to its immediate parent. World
   transforms are derived, never stored.
2. `coordinateService` (scene) and `scene/world.ts` (editor, placed-world)
   are the single conversion API. Tools and commands must not inline
   `invertAffine(nodeWorldTransform(...))`.
3. Cross-space operations evaluate in world space and commit parent-local:
   dragging, snapping, marquee, boolean ops (world clipping + anchor
   rebase), group/ungroup, duplicate, paste (via the clipboard
   `worldAnchor`), imports, and exports.
4. Moving an artboard mutates only the artboard transform — descendants'
   stored coordinates are never rewritten.
5. Codegen and export fold `rotation` at every emission point
   (`nodeEffectiveTransform`).
6. Malformed parent graphs (cycles) are rejected at decode and guarded at
   runtime (visited-set + depth ceiling in the world-transform walk).

## Consequences

- Artboard children have meaningful local coordinates that survive artboard
  moves, reparenting, and serialization without coordinate rewrites; one
  undo entry moves an artboard with any number of descendants.
- Cross-artboard paste/boolean/clipboard behave like world-preserving
  operations.
- Legacy documents need no coordinate migration (the parent-local model
  predates the versioned format); v2.4→2.5 rotation baking remains.
- Future systems (components, auto-layout, nested frames, nested
  transformations) compose through the same hierarchy without new
  coordinate special cases.
- Cost: every consumer must use the canonical API — residual inline
  arithmetic is a review-rejectable defect, and the
  `packages/editor/src/scene/world.ts` helpers are the enforcement point.

Canonical contract: `docs/architecture/coordinate-system.md`.
