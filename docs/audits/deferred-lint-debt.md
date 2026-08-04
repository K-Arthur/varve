# Deferred Lint Debt

These warnings require genuine component redesign or are legitimate use cases
of ARIA/HTML patterns that Biome's rules cannot express without a data-model
change.

Last updated: 2026-08-03 (inventory refreshed during validation-repair pass)

## Current count: 41 warnings — all `noArrayIndexKey`

Previous inventories in this file (2026-07-25: 21 warnings incl. 14
`useSemanticElements`) are obsolete: the `useSemanticElements` batch was fixed
in later sessions, and `noArrayIndexKey` sites grew with new code. The lint
baseline for `master` (2026-08-02) is 41 `noArrayIndexKey` warnings and
nothing else.

### Why these remain

`key={i}` is used because array position *is* the identity for these lists:

1. **Reorderable model lists** — gradient stops, fills, strokes, keyframes,
   palette entries. Rows must keep their identity when the list is
   re-sorted (e.g. `stops.sort(by position)`), so index keys would cause
   state/position mismatches on reorder. Fixing requires stable IDs in the
   document model (cross-cutting change to `@varve/scene` types, ops,
   serialization, and migration).
2. **Non-reorderable derived lists** — line-number-indexed code lines,
   static grids, zoom ticks. Position is immutable here, so `key={i}` is
   correct; the warning is noise.
3. **Grouped findings** — intelligence/layout/preflight issue lists. Items
   have no unique id; keys are composite (`nodeId`-prefixed) with index to
   disambiguate duplicates.

### Inventory (41 sites, 2026-08-03)

| Category | File | Lines |
|----------|------|-------|
| Reorderable (needs model IDs) | `Inspector/color/GradientEditor.tsx` | 289 |
| Reorderable (needs model IDs) | `Inspector/controls/GradientMapEditor.tsx` | 241, 400, 630 |
| Reorderable (needs model IDs) | `Inspector/controls/GradientImportDialog.tsx` | 73 |
| Reorderable (needs model IDs) | `Inspector/sections/FillSection.tsx` | 192 |
| Reorderable (needs model IDs) | `Inspector/sections/StrokeSection.tsx` | 181 |
| Reorderable (needs model IDs) | `Inspector/sections/OcrSection.tsx` | 368 |
| Reorderable (needs model IDs) | `Inspector/sections/PaletteSection.tsx` | 184 |
| Reorderable (needs model IDs) | `PalettePreviewDialog.tsx` | 108, 137, 226 |
| Reorderable (needs model IDs) | `GradientHandleOverlay.tsx` | 204, 224 |
| Reorderable (needs model IDs) | `timeline/GraphEditor.tsx` | 334 |
| Positional (index is identity) | `Inspector/controls/CurveEditor.tsx` | 405, 417, 440 |
| Positional (index is identity) | `timeline/TimelineRuler.tsx` | 178 |
| Positional (index is identity) | `NodeEditOverlay.tsx` | 68 |
| Positional (index is identity) | `SelectionOverlay.tsx` | 856 |
| Line-numbered (index is identity) | `CodePanel/CodePanel.tsx` | 232, 303, 409, 442 |
| Line-numbered (index is identity) | `SpecPanel/CodeGenView.tsx` | 116 |
| Grouped findings (composite key) | `Inspector/sections/LayoutScoreSection.tsx` | 38 |
| Grouped findings (composite key) | `Inspector/sections/StateMachineSection.tsx` | 130 |
| Grouped findings (composite key) | `PreflightWarnings.tsx` | 214 |
| Grouped findings (composite key) | `panels/IntelligencePanel.tsx` | 370, 1007, 1147, 1327, 1418, 1572, 1638, 2294 |
| Grouped findings (composite key) | `ImportPreview.tsx` | 91, 101 |
| Grouped findings (composite key) | `ImportResults.tsx` | 99, 139 |

### Resolution options

- **Short-term (recommended, ~1 session):** add stable `id` fields to
  gradient stops / fills / strokes / keyframes in `@varve/scene`, thread
  them through ops and serialization, and key rows on the id. For line-
  numbered and grouped-finding lists, add a `suppress` comment with the
  positional rationale or switch `noArrayIndexKey` from warning to off for
  those files.
- **Policy change:** promote the rule to error (with the above inventory
  fixed first) so new index-keyed lists are caught in review.
