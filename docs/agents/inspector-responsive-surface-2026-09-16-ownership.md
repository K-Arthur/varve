# Inspector responsive-surface follow-up — ownership (2026-09-17)

**Branch:** `master`
**Trigger:** real image and Position & Size screenshots still show controls
stretching to the inspector rail, duplicate image-placement affordances, poor
adaptation as the rail narrows, and sticky section headers leaving clipped
content in the padded top of the Inspector scroller.

## Coordination

The shared worktree contains active changes from other Inspector and platform
passes. In particular, `NumberField.tsx`, `DocumentPanel.tsx`, and the existing
Design-tab audit are already claimed by the Inspector panel review. This pass
will not reset, overwrite, or stage those paths. It will first establish the
runtime defect matrix, then claim only clean section files and explicitly
bounded responsive CSS hunks after re-reading them immediately before edits.

## Intended scope after the evidence gate

- `PositionSizeSection.tsx` and its focused tests.
- `ImageFillControls.tsx`, `ImagePlacementSection.tsx`, and their focused
  tests, if the duplicate/placement evidence supports a change.
- `FieldRow.tsx` only if a semantic layout primitive is required.
- The smallest reviewed responsive rules in the existing Inspector stylesheet;
  no second design system or per-section arbitrary widths.
- The existing Inspector scroller/header boundary, limited to the sticky
  disclosure inset and its visual separation from preceding rows.
- A new real-editor E2E audit covering image-filled shapes, frames, ordinary
  shapes, narrow/typical/wide rails, zoom, and horizontal-overflow assertions.
- This audit and the corresponding implementation evidence document.

`NumberField.tsx`, `DocumentPanel.tsx`, `PropertiesPanel.tsx`, and the
concurrent `design-tab-audit.spec.ts` remain excluded unless their owners
explicitly reconcile the overlap in the coordination record.

## Required evidence before production edits

1. Inventory Inspector controls and inline geometry overrides breadth-first and
   depth-first.
2. Capture current real-editor measurements for Position & Size, image Fill,
   Image Placement, and representative frame/shape rows at 240/280/320/400/
   640px rails and 200% browser zoom.
3. Capture the empty-selection Document/Isometric Grid scroll case and measure
   the sticky-header inset/intersection with preceding field rows.
4. Record the responsive decision and the cases that must remain two-up.
5. Recheck official reflow, container-query, and spinbutton guidance before
   implementing the chosen contract.
