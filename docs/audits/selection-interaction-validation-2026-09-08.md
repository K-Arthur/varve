# Selection interaction validation — 2026-09-08

## Scope

This record covers the active-surface selection interaction slice:

- canvas object marquee selection;
- release-only canvas click/commit behavior;
- screen-space marquee preview under camera rotation;
- Layers row-body range scrub with reversal and virtualizer-aware geometry;
- dedicated-grip-only structural Layers DnD;
- shared stable-ID range assembly for pointer and keyboard paths.

Pixel-area marquee selection remains a separate workflow. Cross-page selection
is not part of this delivery; the honest boundary and required migration are
recorded in [ADR-0195](../adr/0195-selection-across-pages.md).

## Root causes addressed

1. Canvas selection used the same press to mutate selection and begin a move,
   so a small pointer movement could clear or replace selection before the
   gesture was known to be a click, move, or marquee.
2. The object marquee was represented in world coordinates, so a rotated
   camera could show a rectangle that did not match the user's screen-space
   drag.
3. Marquee candidates were not consistently reduced to the active editable
   surface and canonical transform roots.
4. Layers structural DnD and row selection competed for the same row surface.
5. Range selection used render-time row indexes rather than stable IDs, which
   is unsafe when a virtualized tree scrolls or changes visibility during a
   gesture.

## Implementation contract

The Select tool previews candidate node IDs and commits the ordered result once
on release through `setSelectionRefs`. Escape, pointer cancellation, blur, tool
switching, or an editable-surface change clears the preview without changing
the committed selection. The unassigned `X` chord held with the Select tool
forces object marquee mode and does not conflict with `Ctrl/Cmd+X` Cut.

The Layers row body owns selection scrub. It uses stable anchor/extent IDs,
the authoritative virtualizer measurement cache, and a requestAnimationFrame
edge-scroll loop. The dedicated grip alone owns sortable DnD activation. Shift
click, Shift+Arrow, and scrub use `selectionRangeBetween()` plus
`applySelectionRange()`.

## Deterministic fixture

The fixture manifest is [selection-interaction-manifest.json](../../tests/fixtures/selection-interaction-manifest.json).
`seedLayers(page, 3)` creates three 80×80 rectangles at world coordinates
(100,100), (220,160), and (340,220). The E2E specs use those stable positions,
the active canvas, and the visible flattened Layers rows so the expected range
and object-marquee ownership are reproducible.

## Validation matrix

| Surface | Check | Evidence |
| --- | --- | --- |
| Selection algebra | Stable ID range, reverse direction, add/replace, one bulk commit | `selectionRange.test.ts`, `selectionOperations.test.ts` |
| Canvas tool | Deferred click, object marquee, containment, rotated projection, cancellation | `SelectTool.test.ts`, `marqueeGeometry.test.ts` |
| Canvas browser | Real pointer marquee, mid-drag preview, release commit, empty click release-only behavior | `tests/e2e/canvas/object-marquee-selection.spec.ts` |
| Layers browser | Real pointer row scrub, preview, reverse-safe commit, unchanged structure | `tests/e2e/layers/layers-dnd.spec.ts` |
| Structural DnD | Grip remains the only reorder/reparent activator | `tests/e2e/layers/layers-dnd.spec.ts` |
| Website browser | Selection-vs-structure messaging, contract link, and no horizontal overflow on both site base paths | `apps/website/tests/e2e/layers-feature.spec.ts` |

Visual screenshots are emitted by Playwright into its ignored test-results
directory with the names `canvas-object-marquee-preview.png`,
`canvas-object-marquee-committed.png`, `canvas-object-marquee-forced-preview.png`,
`layers-row-selection-scrub-preview.png`, and `layers-row-selection-scrub-committed.png`.
Review both the canvas and
Layers panel in each state; a final selection-only assertion cannot prove that
the preview was correct.

The website screenshot is emitted as `layers-feature-light.png` by the marketing
page spec and was reviewed at full-page size for hierarchy, handoff, and marquee
messaging.

## Product evidence and boundaries

Public Figma guidance supports selecting layers from the canvas or Layers
panel, while Sketch documents contiguous layer-list selection and modifier
selection. Those references informed the interaction separation, not claims
that either product exposes this exact row-scrub implementation:

- [Figma: Select layers and objects](https://help.figma.com/hc/en-us/articles/360040449873-Select-layers-and-objects)
- [Sketch: Selecting layers](https://www.sketch.com/docs/designing/layer-basics/selecting-layers/)
- [Sketch: The layer list](https://www.sketch.com/docs/interface-and-settings/the-mac-app-interface/the-layer-list/)

The implementation is intentionally active-surface-only. Page-owned selection,
cross-page marquee/range, and inherited master occurrence identity require the
discriminated selection model in ADR-0195 and remain follow-up work.

## Residual risk

The canvas preview outlines use projected world bounds for fast feedback; the
final selection uses the exact primitive geometry path. Very large documents
still require the affected render and canvas performance lanes, but this slice
does not change the per-node replay hot path.
