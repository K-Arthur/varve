# Inspector paint-stack follow-up ownership

**Branch:** `master`
**Scope:** bounded opacity geometry and fill-stack actions prompted by the
2026-09-16 screenshots.

## Coordination

The shared worktree already contains uncommitted changes in
`NumberField.tsx`, `FillSection.tsx`, their focused tests, and
`DocumentPanel.tsx` from the prior Inspector panel review. Those changes are
preserved; this pass builds on them and will not reset, reformat, or stage
unrelated paths. The existing owner’s documented numeric-width and fill-menu
changes are directly relevant, so the final handoff will either leave their
uncommitted hunks untouched or commit only after the scope is explicitly
reviewed and separated.

## Owned new paths

- `docs/audits/inspector-paint-stack-followup-2026-09-16.md`
- `tests/e2e/inspector/fill-surface-followup.spec.ts`
- any new shared stack-reorder primitive and focused tests

Production edits to the dirty Fill/NumberField files require a fresh diff
review immediately before editing and a separate commit containing no
unrelated work.

## Implementation handoff — paint geometry and stack actions

This follow-up now owns the reviewed paint-stack slice in these paths:

- `packages/editor/src/components/Inspector/sections/FillSection.tsx`
- `packages/editor/src/components/Inspector/sections/StrokeSection.tsx`
- `packages/editor/src/components/Inspector/sections/EffectsSection.tsx`
- `packages/editor/src/components/Inspector/sections/effects/EffectRow.tsx`
- `packages/editor/src/components/Inspector/inspector.css`
- `packages/ui/src/components/Sortable.tsx`
- `packages/ui/src/components/Sortable.test.ts`
- the focused FillSection/paint-row tests and
  `tests/e2e/inspector/fill-surface-followup.spec.ts`

The existing dirty `design-tab-audit.spec.ts` remains owned by the concurrent
Inspector panel review. Its uncommitted assertions still expect a visible
`.insp-paint-blend-select` row control, which conflicts with the researched
decision here: per-fill blend mode is visible in the colour editor and the
labelled row menu, not duplicated as a second full Appearance control. It was
not edited or staged by this pass; the owner needs to reconcile that test
before the broader Design-tab audit is considered green.

Evidence after implementation:

- Real Chromium geometry at 240/320/480/640px rails: two opacity inputs held
  the same 39px × 32px intrinsic value box and stayed within a 2px trailing
  alignment tolerance; the Fill-type column absorbed remaining width.
- Real Chromium stack workflow: add a gradient, pointer-drag it, reorder with
  the labelled menu, remove it through the destructive menu item, and repeat
  the reorder with Space/ArrowUp/Space keyboard dragging. All passed.
- The shared vertical sortable primitive now falls back from `pointerWithin`
  to `closestCenter` when keyboard dragging supplies no pointer coordinates;
  this fixes keyboard reordering for fills, strokes, and effects together.
- Touch/stylus pointers retain the compact desktop row while receiving the
  `--touch-target-min` drag target through the coarse-pointer media rule.

## Initial evidence

The baseline Vitest run for `NumberField` and fill rows passed 60/60, but that
does not prove rendered geometry or pointer interaction. The new real-editor
Playwright scenario records the actual computed boxes before the repair.
