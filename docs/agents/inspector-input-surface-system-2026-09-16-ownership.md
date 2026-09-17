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
