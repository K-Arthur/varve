# Layers panel visual design audit — 2026-09-09

Status: implemented on `master`

This is a focused visual-design follow-up to the Layers organization audit.
It covers the editor Layers rail and the matching marketing page only. It does
not change the scene model, layer commands, hierarchy semantics, or specialist
Inspector ownership.

## Baseline diagnosis

The real Chromium baseline was captured with five seeded layers and a two-row
selection at the default desktop viewport. The Layers section showed three
presentation problems:

1. The nested `.layers-panel` declared `height: 100%` while it lived below the
   minimap, Design Canvas navigator, and other left-rail surfaces. Its tree and
   bulk toolbar therefore extended below the containing rail. The toolbar was
   technically rendered but clipped from the visible panel.
2. The title, search field, count, and header actions read as separate pieces.
   The title was an all-caps strip with a strong teal top rule, while the count
   sat below the search field and consumed tree space even when no filter was
   active.
3. Rows combined selection, type, color, and action affordances in a narrow
   line. The underlying semantics were sound, but the visual treatment used
   several competing boxes and made the bulk action state easy to miss.

Baseline artifact:
`test-results/run-67914-1466/layers-layers-panel-visual-bfd3d-lated-multi-selection-panel-chromium/layers-panel-populated.png`.

## Direction

The implementation keeps Varve's work-first density and uses a quiet structure
with stronger current-state signals:

- the Layers section is a flex remainder of its owning rail;
- the header is a compact title/count group with action controls in a single
  consistent slot;
- the filter is a bordered, opaque control surface, and its advanced-filter
  control is visibly active only when opened or filtering;
- the tree remains the primary content surface, with a bounded minimum that
  yields space to contextual actions;
- selection remains teal and theme-aware, while type icons lose their extra
  resting box so the type rail and row state do not compete;
- the bulk toolbar owns the bottom edge of the tree and wraps into a count row
  plus horizontally scrollable action row in narrow rails.

## Delivered changes

| Area | Implementation | Result |
|---|---|---|
| Panel sizing | `LayersPanel` now uses `flex: 1 1 0` and `min-height: 0` instead of claiming `height: 100%`. | Nested Layers content stays inside the left rail. |
| Header | Added a title/count group; removed the decorative top strip; standardized header and detach control sizing. | The document context is readable before the actions. |
| Filter | Added an active visual state and removed the inactive duplicate count line; shortened the placeholder to `Filter layers…`. | Search reads as one control and only reports `n of m` when filtering. |
| Tree and rows | Added a bounded tree floor, quiet tree surface, small row separation, transparent resting type-button surface, and slightly clearer action hit areas. | Hierarchy remains dense without every affordance becoming a card. |
| Bulk actions | Added an opaque raised surface, explicit top boundary, and narrow-container wrap/scroll behavior. | Multi-selection actions remain visible and attached to the tree. |
| Marketing | Updated `/features/layers` with the same “quiet structure, strong state” explanation and a matching filter/count treatment in its illustration. | Product claims and product UI use the same visual vocabulary. |

## Access and behavior retained

The tree remains an APG `tree`/`treeitem` surface. Existing selection,
keyboard focus, disclosure, visibility, lock, solo, rename, effect-stack,
context-menu, drag-and-drop, filter, and Inspector deep-link behavior are
unchanged. The added count is presentation-only; the existing semantic
searchbox and live filtered result count remain the source of truth.

## Visual evidence

The deterministic scenario is
`tests/e2e/layers/layers-panel-visual.spec.ts`. It seeds five real layers,
selects two through the real pointer path, checks that the bulk toolbar's
bounding box ends inside the owning left rail, and captures three theme states:

- `test-results/run-75462-1469/layers-layers-panel-visual-bfd3d-lated-multi-selection-panel-chromium/layers-panel-populated-light.png`
- `test-results/run-75462-1469/layers-layers-panel-visual-bfd3d-lated-multi-selection-panel-chromium/layers-panel-populated-dark.png`
- `test-results/run-75462-1469/layers-layers-panel-visual-bfd3d-lated-multi-selection-panel-chromium/layers-panel-populated-high-contrast.png`

Those three images were opened and reviewed directly. The light and dark
states keep the selected rows prominent without a saturated full-row card; the
high-contrast state retains its stronger system yellow selection treatment.
The bulk bar is visible in all three states. The first post-change run failed
the new geometry assertion as expected, proving the baseline clipping defect;
the rerun passed after the flex sizing correction.

## Remaining design debt

- The outer left rail still contains minimap and surface-navigation owners
  above Layers. Their shared composition is intentionally outside this slice.
- Rows with many specialist badges can still become information-dense at very
  narrow widths. A future progressive-disclosure pass should preserve all
  current labels while moving lower-frequency detail into a row popover or
  Inspector deep link.
- The visual evidence is Linux Chromium only. Tauri/WebKitGTK, physical touch
  hardware, and native assistive-technology walkthroughs remain separate
  validation work.

## Validation record

Commands for this slice are recorded in the session handoff. The repository
planner still sees concurrent unrelated changes in the worktree; no full-suite
escalation was warranted for these CSS/markup changes.
