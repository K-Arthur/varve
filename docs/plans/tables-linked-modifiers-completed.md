# Native Responsive Tables + Linked Color Modifiers — Implementation Report

- **Branch:** `feat/tables-modifiers` (worktree `.worktrees/tables-modifiers`)
- **Base:** `67d94621` — the last fully-buildable master commit
- **Date:** 2026-08-06

## 1. Executive summary

Two first-class document capabilities were implemented, tested, and verified
end-to-end:

1. **Native responsive tables** — a semantic `TableNode` whose content is a
   data-backed `TableModel` (stable row/column/cell ids, spans, header/frozen
   roles, responsive rules). Insert via a dedicated Table tool, edit cells
   inline, merge/split, navigate with the keyboard, resize columns, and let a
   deterministic layout engine keep every row's cells aligned. Tables survive
   save/reload, undo/redo, copy/paste (id remapping), and export (SVG, CSV/TSV).
2. **Linked variable color modifiers** — a typed, non-destructive alpha
   modifier stack (multiply/set/offset) on `PropertyBinding`, applied after
   variable resolution (aliases, collection modes) and preserved through
   serialization, migration, save/reload, and export. The inspector shows the
   variable link and modifier badge, with reset preserving the binding.

Both were driven by evidence: an ADR (0016), a capability audit, property-based
invariant tests, 12 E2E workflows, and performance benches. A 10,000-cell table
replays at ~25 ms per frame as a single render item.

## 2. Verified current-state audit

The capability matrix with evidence lives in
`docs/audits/tables-color-modifiers-capability-audit-2026-08-05.md`. Key
findings: no table abstraction existed anywhere; grid layout was single-pass
and position-only (spans were a lower-level primitive, insufficient for tables);
`PropertyBinding` was `{variableId, expression?}` with numeric-only expressions;
paint binding was flat property keys only (no index paths); missing variables
failed silently; `@varve/layout` was a stub.

## 3. Root causes

- Tables were simulated with frames because there was no table model.
- Colors could not be modified while staying linked because bindings had no
  modifier concept and expressions were numeric-only.
- Grid auto-layout could not express synchronized row heights or bounded
  two-pass intrinsic sizing.

## 4–7. Architecture decisions (ADR-0016)

| Decision | Choice |
| --- | --- |
| Table persistence | Dedicated `TableNode` with embedded data-backed `TableModel` (option 5, hybrid) |
| Large-table representation | Data-backed cells; one scene node; viewport culling; 10k cells ≈ 25 ms/frame |
| Table rendering | Compile to a single engine `table` primitive per node (1 node ↔ 1 IR item); Rust pass-through keeps native IR on desktop |
| Table layout | Dedicated deterministic multi-pass `computeTableLayout` (monotonic, capped) in `@varve/scene` (shared by editor + codegen) |
| Modifiers | Typed `VariableModifier` union (alpha first); deterministic order; migratable; never free-form strings |

Package ownership follows the brief's map; structured parsing lives in
`@varve/import` (deterministic, never AI).

## 8–9. Scene schema + migration

- New `kind: 'table'` node; `PropertyBinding.modifiers?: VariableModifier[]`.
- `formatVersion` bumped 2.14 → 2.15 (`modifiersMigration.ts`); serialized
  modifier data is validated on load; table models are repaired defensively by
  the codec (span clamping, overlap drop, id dedupe, counter repair).
- Clipboard closure: `deepCloneSubtree` remaps table row/column/cell ids.

## 10–12. Layout, rendering, frontend

- `computeTableLayout`: fixed/content/fraction/percentage tracks, min/max,
  hidden-column collapse, responsive rules (hidden columns, density), span
  expansion, row-height synchronization, content-row floor.
- Engine: `TableShape` IR + `paintTable`; WebGPU routes non-GPU primitives
  through Canvas2D automatically; export flattening shares the same geometry.
- Frontend: TableTool, edit session (double-click, keyboard, inline editor,
  resize handles, frozen markers), Inspector sections, modifier badge +
  popover, Create-Table-From-Data dialog, `=`/toolbar entries.

## 13–14. Multimodal pipeline

Deterministic Stage A–F shipped (TSV/CSV/Markdown/JSON parsing, typed plan via
the dialog, one undoable commit). Image/OCR analysis is explicitly deferred
(ADR-0016 §17); manual table creation is fully functional offline.

## 15–17. Import/export

CSV/TSV/Markdown import with RFC-4180 quoting, bounds, and a 50 MB cap;
formula-safe export (`= + - @` triggers quoted); SVG export with geometry
parity; CSV/TSV download action. XLSX and semantic HTML `<table>` codegen are
documented follow-ups.

## 18–20. Collaboration, copy/paste, components

Stable ids throughout; copy/paste remaps ids via clone; undo/redo is one
undoable transaction per command (document snapshots). Components/instances:
tables are first-class nodes; structured cell overrides are a documented
follow-up.

## 21–25. Performance (measured)

| Scenario | Result |
| --- | --- |
| Table replay 100 / 1k / 10k cells | 0.44 / 2.11 / 24.5 ms p50 (single IR item) |
| Layout 10k cells | 28 ms, 1 pass |
| Layout 1k cells + long wrapped text | 8.5 ms |
| Existing replay bench (100/1k rects) | unchanged (2.79 / 7.26 ms p95) |

## 26. Color management

Alpha modifiers preserve the token's color space (no RGB conversion for alpha
math), respect bit depth (uint8/uint16/float), clamp to [0,1], and are applied
before node-level opacity at compositing (never twice). Non-finite inputs mark
the stack invalid without detaching the binding.

## 27–29. Accessibility, security, privacy

Keyboard navigation (arrows/tab/shift-range/enter/escape/delete), aria-labels
on all new controls, APG-style disclosure sections, and 123/123 token-gate
(3 themes). Import parsing bounds all inputs, never evaluates content, and
formula-trigger escaping prevents spreadsheet injection. No uploads; parsing
and layout are local.

## 30–31. Edge cases

Covered by 68+ unit/property tests (spans, insert/delete, merge/split,
reordering, serialization, non-finite geometry, hidden columns, RTL-free
deterministic reflow, alias chains, mode switching, missing variables, type
changes, NaN/Infinity, corrupt serialized data) and 12 E2E workflows.

## 32–33. Testing + benchmarks

Commands and exact results in §"Verification" below.

## 34. Files added/changed

- Scene: `modifiers.ts`, `modifiersMigration.ts`, `table.ts`, `tableOps.ts`,
  `tableLayout.ts` (new); `types.ts`, `bindings.ts`, `version.ts`,
  `documentCodec.ts`, `clone.ts`, `nodeBounds.ts`, `document.ts`, `index.ts`
- Engine: `types.ts` (TableShape), `engine.ts`, `replay.ts` (paintTable),
  `tablePrimitive.test.ts`, `bench/tableReplay.bench.ts`
- Editor: `tools/TableTool.ts`, `table/tableNav.ts`, `table/tableDocOps.ts`,
  `TableEditOverlay/`, `CreateTableFromDataDialog.tsx`, `render/tableCompile.ts`,
  Inspector sections + `VariableModifierPopover.tsx`, context/types changes,
  `actions/createActionHandlers.ts` + `registerAll.ts`, `FloatingToolbar.tsx`,
  `VariablePanel.tsx`, `autoNamer.ts`, `featureOwnership.ts`
- Import: `delimited.ts`; Codegen: `svg.ts`; Tests: 12 E2E specs
- Rust: `varve-bridge`, `varve-core`, `varve-engine`, `varve-print` (Table
  pass-through)

## 35. Commits

`67d94621` (modifiers + ADR), `1dedf62f` (table model), `dbb06041` (layout +
Rust), `69cca5d4`/`59d98fa0` (engine primitive), then on
`feat/tables-modifiers`: editor interaction layer, import/export, E2E fixes,
benches, gate fixes.

## 36. Verification (exact)

- `pnpm typecheck` — 14/15 packages; engine fails only on pre-existing
  `geometry.ts:399` (parallel-session warp code, untouched here)
- `pnpm lint` — 0 errors on touched files
- `pnpm test` — 12,268 passed / 3 skipped / 0 failed
- `pnpm audit:emoji` / `audit:docs` / `audit:tokens` — clean / clean / 123-123
- `cargo test --workspace` — 414 passed; `cargo clippy` + `cargo fmt` clean
- Playwright (Chromium) — 12/12 passed
- `pnpm bench:canvas` + `pnpm bench:table` + `pnpm bench:table-layout` — pass

## 37. Remaining limitations + follow-ups

Deferred with evidence: frozen-header scrolling viewport (freeze is
model-level with visual markers), per-cell rich content slots, XLSX import,
semantic HTML `<table>` codegen, OCR/image table recognition, structured
cell-level component overrides, and per-gradient-stop modifier bindings.
The parallel session's warp feature and master's absorbed-but-uncommitted
table hunks must be reconciled on master before this branch merges
(master `1dedf62f..a649ae04` does not build; base `67d94621` does).
