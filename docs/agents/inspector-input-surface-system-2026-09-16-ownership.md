# Inspector input-surface system — ownership and handoff

**Task:** repository-wide audit, redesign, implementation, and validation of
Inspector fields, comboboxes, property controls, selection-aware section
composition, and related website/help copy.
**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve`
**Research:** `docs/research/inspector-input-surface-system-audit-2026-09-16.md`
**Contract:** `docs/architecture/inspector-input-surface-system.md`
**Plan:** `docs/plans/inspector-input-surface-system-implementation-2026-09-16.md`

## Scope

This pass covers text, text-on-path, images, rectangles/ellipses/polygons/
stars/lines/arrows/paths, groups/live booleans, frames/auto-layout/component/
export regions, tables/edit scopes, adjustment/raster layers,
masks/background-removal/depth masks, mixed selections, empty/document context,
and tool-only contexts. It covers text, numeric/unit/scrubbing, select,
combobox/search, sliders, color, segmented controls, toggles, disclosures,
menus, popovers, and dialogs.

## Owned files for the evidence gate

- `docs/research/inspector-input-surface-system-audit-2026-09-16.md`
- `docs/architecture/inspector-input-surface-system.md`
- `docs/plans/inspector-input-surface-system-implementation-2026-09-16.md`
- this ownership record

Production and test files are claimed milestone-by-milestone after checking the
shared working tree. Existing Inspector composition, disclosure, popover,
website, and Design-tab owners remain authoritative for their paths.

## Milestone 4 claim — contextual ordering

At 2026-09-16 18:50 local time, the working tree was rechecked: the registry
and `PropertiesPanel.tsx` had no uncommitted diff and no other agent process was
running. This milestone therefore claims only:

- `packages/editor/src/components/Inspector/sectionRegistry.ts`
- `packages/editor/src/components/Inspector/PropertiesPanel.tsx`
- `packages/editor/src/components/Inspector/__tests__/sectionRegistry.test.ts`
- a new selection-order E2E spec under `tests/e2e/inspector/`

The change is limited to contextual primary-band ordering and its tests. Dirty
`DocumentPanel.tsx`, `NumberField.tsx`, `FillSection.tsx`, existing Design-tab
specs, and other owners' paths remain excluded.

## Invariants

1. Work remains on `master`; no branch is created for this task.
2. Do not stage unrelated dirty files.
3. Do not replace `@varve/ui` with another primitive library.
4. Do not change scene semantics, serialization, selection, or history merely
   to alter presentation.
5. Do not conflate native select, custom select, combobox, menu, popover, and
   dialog.
6. A new node/capability requires a matrix row and a real interaction scenario.
7. Re-read shared files immediately before editing and stop if an active owner
   overlaps the exact hunk.
8. Every milestone records tests, visual evidence, accessibility behavior,
   performance observations, remaining risks, and commit SHA.

## Evidence-gate outcome

The baseline real-editor Design-tab audit passed 22/22 scenarios. The visible
remaining architectural defect is selected-text ordering:

```text
Align & Distribute → Position & Size → Appearance → Typography
```

The accepted target is Typography in the primary band immediately after the
contextual action band, with advanced typography still progressively disclosed.

## Handoff rule

Before touching `PropertiesPanel.tsx`, `sectionRegistry.ts`, `DocumentPanel.tsx`,
`NumberField.tsx`, shared disclosure/popover files, or website files already
listed in another ownership record, coordinate with that record and split the
change into a separately reviewable commit. The new contract and matrix are
independent so foundation work can proceed without overwriting concurrent work.

## Milestone 3 claim — editable combobox contract

At 2026-09-17 20:30 local time, `packages/ui/src/components/Combobox.tsx`,
its focused test, and its story were clean and had no active owner. This
milestone claims only those shared combobox files plus the existing UI export
surface if an export change is required. It does not replace `Select`, change
editor call sites, or touch the concurrently modified Inspector number/fill/
document files.

The implementation kept query text separate from the committed option value,
preserved native text-editing keys, exposed loading/empty/error states, and
verified duplicate labels, disabled options, Escape cancellation, and a
persisted value whose label differs from its ID. The popup was visually checked
against helper/error text and anchored to the complete field block. Delivered
in `0d2d8224b`; the existing real editor combobox/select workflows remain
integration evidence for later migration.

## Milestone 5 claim — contextual compression and field geometry

At 2026-09-17 21:00 local time, the working tree was rechecked. The targeted
LayoutSection and TypographySection files were clean, while the shared
NumberField and generic inspector CSS remain owned by concurrent inspector
passes. This follow-up therefore claims only the smallest integration surface
needed to repair the observed screenshots:

- `packages/editor/src/components/Inspector/sections/LayoutSection.tsx`
- `packages/editor/src/components/Inspector/sections/LayoutChildSection.tsx`
- `packages/editor/src/components/Inspector/sections/TypographySection.tsx`
- `packages/editor/src/components/Inspector/sections/TypographySection.css`
- `packages/editor/src/components/Inspector/PropertiesPanel.tsx` only if a
  frame child must expose the child-owned layout section
- focused section tests and the existing contextual-order E2E spec

The geometry contract is additive and scoped: grid-placement controls move to
the child-owned layout surface and render only when a shared parent is a grid;
their labels use stacked-label two-up cells. Typography keeps its semantic
section and advanced disclosures, but its common spine uses two-up pairs for
weight/style and size/line-height. No generic field primitive, NumberField
semantics, scene model, serialization, or history behavior is changed by this
milestone. If an owned file becomes dirty or an active process claims the same
hunk, stop and split the work rather than folding it into this change.
