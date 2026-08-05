# Deferred Lint Debt

Status of lint warnings that were previously deferred, and the narrow
suppressions that remain after the 2026-08-04 validation-repair pass.

Last updated: 2026-08-04

## Current state

`pnpm lint` (biome check .) passes with **zero warnings** and zero errors.

The 2026-08-02/03 baseline of 41 `noArrayIndexKey` warnings was resolved in
the 2026-08-04 pass:

- **18 sites** were converted to stable keys already present in the data
  (finding fingerprints, rule/check/issue codes + node ids, handle keys,
  gradient handle `nodeId`+`fillIndex`, tick positions, bin start values,
  grid/label coordinates, OCR word bounding boxes, mapping
  `nodeId`+`fillIndex`, duplicate-group member sets, audit finding
  `nodeId`+`category`+`message` composites).
- **23 sites** kept index keys behind a per-line `// biome-ignore
  lint/suspicious/noArrayIndexKey` comment with a written rationale. These
  fall into two groups, each with a genuine reason:

### Why the 23 suppressions remain

1. **Model lists without stable IDs** — gradient stops, fills, strokes,
   keyframes, path points. The `@varve/scene` document model has no `id` on
   `GradientStop` / `Fill` / `Stroke` / `AnimationKeyframe`, and adding one is
   a cross-cutting serialization change (types, ops, document codec,
   version migration). The rows are stateless and fully derived from props, so
   index keys cause no state loss; content keys would change identity
   mid-interaction (stops/points/keyframes move while dragging, which would
   remount the row mid-gesture and break pointer capture).
2. **Positional or content-colliding derived lists** — line-numbered code
   spans (index is the line number), stateless warning/issue string lists
   (duplicate strings would collide as content keys), extracted swatch colors
   and palette entries (duplicate colors/names), and naming suggestions
   (duplicate names across nodes). These lists never reorder, so position is
   the correct identity.

### Suppression inventory (23 sites, 2026-08-04)

| File | Lines | Reason category |
|------|-------|-----------------|
| `components/CodePanel/CodePanel.tsx` | 232 (code lines), 409 (strings), 442 (gaps) | Positional / colliding |
| `components/SpecPanel/CodeGenView.tsx` | 116 (code lines) | Positional |
| `components/Inspector/controls/CurveEditor.tsx` | 440 (control points) | Model list, moves mid-drag |
| `components/Inspector/sections/FillSection.tsx` | 192 (fills) | Model list, no id |
| `components/Inspector/sections/StrokeSection.tsx` | 181 (strokes) | Model list, no id |
| `components/Inspector/color/GradientEditor.tsx` | 289 (stops) | Model list, no id |
| `components/GradientHandleOverlay.tsx` | 224 (stops) | Model list, no id |
| `components/Inspector/controls/GradientMapEditor.tsx` | 241, 400, 630 (stops) | Model list, no id |
| `timeline/GraphEditor.tsx` | 334 (keyframes) | Model list, no id |
| `components/NodeEditOverlay.tsx` | 68 (path points) | Model list, no id |
| `components/ImportPreview.tsx` | 91, 101 (strings) | Colliding |
| `components/ImportResults.tsx` | 99 (file rows), 139 (strings) | Colliding |
| `components/Inspector/controls/GradientImportDialog.tsx` | 73 (strings) | Colliding |
| `components/Inspector/sections/PaletteSection.tsx` | 184 (swatches) | Colliding |
| `components/PalettePreviewDialog.tsx` | 108, 137 (palette entries) | Colliding |
| `panels/IntelligencePanel.tsx` | 1327 (naming suggestions) | Colliding |

### Resolution options for the remaining suppressions

- **Add stable `id` fields to `GradientStop` / `Fill` / `Stroke` /
  `AnimationKeyframe` in `@varve/scene`** and thread them through ops,
  serialization, and version migration. This is the only way to remove the
  9 model-list suppressions. Estimated scope: cross-cutting data-model change
  (1-2 sessions with migration tests).
- The positional/colliding suppressions (14 sites) are permanent by design —
  they would need content-unique keys that the data does not guarantee.
