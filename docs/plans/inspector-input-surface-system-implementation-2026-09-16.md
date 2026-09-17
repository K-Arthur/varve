# Inspector input-surface implementation plan

**Date:** 2026-09-16
**Branch:** `master`
**Prerequisite:** research gate in
[`../research/inspector-input-surface-system-audit-2026-09-16.md`](../research/inspector-input-surface-system-audit-2026-09-16.md)

## Milestone 1 — evidence and contract

Delivered in the companion audit, architecture contract, and ownership record:

- repository inventory and selection matrix;
- research ledger with standards, official design systems, product behavior, and
  failure complaints;
- token/density and Inspector grammar decisions;
- acceptance criteria and non-goals.

Exit gate: docs are internally consistent, shared architecture is reused, and
the selected-text ordering defect is backed by a rendered real-editor scenario.

## Milestone 2 — foundations

After checking current coordination state, own only the smallest required
shared changes:

- semantic Inspector aliases in `packages/ui/src/tokens/` and generated CSS;
- composable `InspectorFieldShell`/`PropertyRow` adapter;
- field state attributes, label/description/error association, stable action
  region, and density contract;
- an existing story/gallery extension for states and widths.

Tests: DOM/a11y names and descriptions, mixed/read-only/bound states, geometry
at three densities, three themes/forced colors, and narrow/wide no-overflow.

## Milestone 3 — core value families

Sequence: text/textarea; numeric/unit/draft fields; native/custom select
distinction; combobox/search/async lists; embedded actions and popup geometry;
slider-plus-precision and color triggers. Each family gets focused tests before
many consumers move. Do not mechanically replace every `input` or `select`.

## Milestone 4 — contextual Inspector composition

Coordinate edits to existing registry/composition owners. Implement a primary
band resolver and tests for text/text-on-path, image single/multi, regular and
auto-layout/component/export frames, all shape/path/group variants, tables,
adjustments, raster layers, masks, mixed selections, empty selection, and
tool-only contexts. The first ordering change puts Typography before generic
Position/Appearance for selected text while retaining hidden-section recovery.

## Milestone 5 — representative migration

Prove one section per family before broad migration:

- Typography and Text on Path;
- Image Placement and Crop & Bounds;
- Position & Size and paired dimensions;
- Appearance/Fill/Stroke;
- Frame Stack/Grid and component context;
- Table cells/rows/columns;
- Adjustment/scope;
- Mask/background removal;
- searchable select/combobox and color popup.

Run real create/select/edit/commit/cancel/undo/redo workflows, selection changes
while focused, mixed values, resize with popup open, and keyboard/touch paths.

## Milestone 6 — repository migration

For every old surface: identify consumers and semantic family; add a compatibility
adapter if event/value semantics differ; migrate owned call sites; remove local
geometry only after coverage; record exceptions and add searches/lint where
useful. Do not touch unrelated dirty files or reformat broad CSS.

## Milestone 7 — docs, marketing, and visual validation

Update truthful help/website copy explaining that Typography, Image Placement,
Layout, Table, Adjustment, and Mask controls follow selected capabilities.
Marketing copy should promise contextual precision, not unsupported automation.
Regenerate Inspector marketing scenes only after concurrent UI changes are
accounted for and the rendered images are reviewed.

Contact sheets must cover text, image, frame, shape, group, table, adjustment,
raster, mask, mixed, narrow, wide, light, dark, high zoom, keyboard focus,
popup edge, and touch-oriented scenarios.

## Validation commands

For every system-level change:

```bash
pnpm verify:plan
pnpm verify:affected
pnpm bench                 # numeric/popup/performance-sensitive changes
pnpm audit:docs
pnpm audit:emoji
pnpm audit:tokens
node scripts/audit-architecture.mjs --ci
```

Add feature-specific Vitest/Playwright commands selected by the plan. The full
gate is reserved for the already-escalated aggregate dirty-tree checkpoint or
an explicit integration decision:

```bash
VARVE_FULL_GATE_REASON="Inspector input-surface system integration across UI, editor, website, and E2E" pnpm verify:full
```

## Migration matrix

| Surface | Existing owner | First action | Verification |
| --- | --- | --- | --- |
| Text/textarea | `@varve/ui` | Align shell/state tokens | IME, paste, selection, error, zoom |
| Inspector number/unit | editor `NumberField`/`FieldRow` | Preserve transaction semantics; unify shell | Draft, mixed, units, scrub, undo |
| Select | UI + local wrappers | Classify native/custom/rich | Keyboard, popup, long labels |
| Combobox/search | UI + consumers | Separate query/selection | Async race, IME, Escape, duplicates |
| Slider | UI/editor | Pair with exact field when stored | Keyboard/precision/continuous input |
| Color | UI picker/editor popovers | Standardize trigger/state | Mixed/bound/popup collision |
| Text | `TypographySection` | Promote primary band | Real text selection/edit workflow |
| Image | image sections | Promote placement/crop; gate advanced | Imported photo workflow |
| Frames/components | layout/component sections | Promote contextual structure | Auto-layout/variant/export region |
| Shapes/groups/path | generic sections | Capability intersection | Shape-builder/boolean/path workflow |
| Tables | table sections | Scope-specific composition | Cell/row/column workflow |
| Adjustments/raster | adjustment/photo/tool sections | Separate semantic controls | Paint/adjustment workflow |
| Masks | mask/background/depth | Expose active state and scope | Mask edit/cancel/restore |
| Empty/tool context | document/tool panels | Compress rare settings, preserve recovery | Frame/brush/crop/document workflow |
| Website/help | existing docs/features | Truthful copy and reviewed imagery | Website build + visual review |

## Open coordination questions

- Is contextual primary ordering persisted per workspace or derived at render
  time? Recommendation: derive primary order; persist only within-band order.
- Which raster-layer operations are Inspector-owned versus tool-options-owned?
- Which table edit scopes are reachable in browser and Tauri today?
- Which marketing scenes can be regenerated safely while the shared tree has
  unrelated in-flight changes?
