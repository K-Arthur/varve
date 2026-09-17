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
- `LayoutSection.tsx` and its focused tests, limited to the Frame
  Stack/Grid wrapper, sizing subsection rhythm, and paired numeric rails.
- `ImageFillControls.tsx`, `ImagePlacementSection.tsx`, and their focused
  tests, if the duplicate/placement evidence supports a change.
- `sectionRegistry.ts` and its focused order test, after the clean-tree
  recheck below; the change is limited to the image contextual order so the
  canonical per-paint Fit editor is reachable before advanced image panels.
- `FieldRow.tsx` only if a semantic layout primitive is required.
- The smallest reviewed responsive rules in the existing Inspector stylesheet;
  no second design system or per-section arbitrary widths.
- The existing Inspector scroller/header boundary, limited to the sticky
  disclosure inset and its visual separation from preceding rows.
- A new real-editor E2E audit covering image-filled shapes, frames, ordinary
  shapes, narrow/typical/wide rails, zoom, and horizontal-overflow assertions.
- This audit and the corresponding implementation evidence document.

## 2026-09-17 implementation update

The Frame follow-up is now included in this ownership slice because the live
rail measurements showed that the same shared geometry defect affected
Position & Size and Stack/Grid. The owned CSS changes are limited to the
existing Inspector grammar: stable position/size action columns, a narrow
two-up fallback with a centered proportion lock, the compact field-height
contract for per-side layout inputs, and tokenized Stack/Grid subsection
spacing. No `NumberField` implementation or document semantics were changed.

Real-editor validation covered a drawn shape, an imported photograph, and a
real Frame at 240/280/320/400/640px rails. Position and size value right edges
matched within 1px at every rail; Stack/Grid had zero horizontal overflow and
32px field shells; the full four-test responsive audit passed. Focused Vitest
passed 100 tests in 5 files. The affected planner escalated because the shared
worktree contains 152 dirty files; those concurrent paths remain outside this
ownership claim.

`NumberField.tsx`, `DocumentPanel.tsx`, `PropertiesPanel.tsx`, and the
concurrent `design-tab-audit.spec.ts` remain excluded unless their owners
explicitly reconcile the overlap in the coordination record.

At the 2026-09-17 implementation handoff, `sectionRegistry.ts` and
`sectionRegistry.test.ts` were re-read with no working-tree diff. This pass
claims only the `IMAGE_SELECTION_ORDER` values and the corresponding focused
expectations; no other registry availability or saved-order behavior will be
changed.

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
