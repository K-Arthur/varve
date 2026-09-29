# Presentation workflow implementation ownership — 2026-09-29

## Goal

Implement local presentation authoring over ordinary editable Varve frames, in
reviewable commits on the shared `master` branch. Follow the staged plan in the
implementation prompt. Do not reset, stash, clean, or broad-stage the shared
working tree.

## Baseline

- Branch: `master`.
- Baseline commit when this ownership note was created: `5313237652060fb73eb8f27cb8a24326f21db99b`.
- The index was empty. Hundreds of tracked and untracked paths already belonged
  to concurrent work; the presentation task must stage only its own clean files
  or exact hunks.
- Existing presentation-adjacent shared files are already modified by other
  work. In particular, `packages/editor/src/Shell.tsx`, export controls, website
  workspace feature pages, `docs/README.md`, and several architecture pages
  were not claimed by this task at baseline.
- Later narrow presentation hunks were added to the dirty website feature index,
  workspace feature/docs pages, export feature page, and product showcase. Their
  pre-existing changes remain untouched; inspect and stage only the presentation
  hunks when the shared index is available.
- A tablet E2E session owned by another task was running at baseline. Do not
  stop its Playwright, Vite, or browser processes.

## Presentation-owned paths

The task owns new, uniquely named files under:

- `docs/agents/presentation-workflow-2026-09-29-ownership.md`
- `docs/research/presentation-workflow-2026-09-29.md`
- `docs/audits/presentation-workflow-defects-2026-09-29.md`
- `docs/adr/0240-presentation-decks.md`
- `docs/architecture/presentation-system.md`
- New `packages/scene/src/presentation/**` implementation and tests.
- New presentation-specific editor adapters/components and tests, after checking
  their parent directories and integration files immediately before editing.
- New presentation-specific E2E specs and approved screenshots/manifests only
  after acquiring the relevant ownership window.

Shared integration paths are **not** exclusively owned. Before any such edit,
re-read its current diff and coordinate a narrow hunk/window with the active
owner. This includes schema registries (`document.ts`, `types.ts`, `version.ts`,
`canonical.ts`), operation bootstrap/barrels, editor shell/action/menu/command
registries, export model/service/save adapters, docs and ADR indexes, website
navigation/feature discovery, screenshot manifests, and app creation flows.
Record any newly discovered overlapping edits here before modifying them.

## Commit protocol

1. Recheck `git status`, the exact file diff, and the index before each commit.
2. Do not commit unless the index contains only the presentation milestone.
3. For an already-dirty shared file, stage only the presentation hunk and inspect
   the complete staged patch. Never use `git add <path>` when that would stage
   another task's edits in the same file.
4. Run the affected validation plan and required audits before committing each
   implementation slice. Record exact commands and skipped unrelated work in
   the final Agent Validation Report.
5. Keep this ledger current when shared ownership or validation plans change.

## Milestone log

- Baseline: repo and running-app audit, dated research ledger, and reproduced-
  defect matrix complete. `pnpm verify:plan --staged` selected only format,
  lint, emoji, and docs audits with no full-suite escalation; `pnpm verify:affected
  --staged` passed. The default worktree planner saw 488 shared changes from
  concurrent work and escalated broadly, so validation was scoped to this
  milestone rather than running unrelated suites.
- Foundations: implemented in the worktree; commit is waiting for the shared
  index to become available. The visible Slides navigator now supports adding
  frames to an existing deck after order review and duplicating artwork through
  the deep-clone ID map.
- Authoring: partial. Geometry-only reusable layout sources and
  preview-before-apply reapplication are implemented with stable role maps,
  source geometry revisions, and inherited-property baselines. Built-in layout
  collections, a dedicated layout canvas, formatting inheritance/reset,
  linked themes, and cross-document presentation-resource mapping remain open.
- Delivery: populated three-slide browser export passed. `pdfinfo` reports
  three 960×540pt raster pages; `unzip -l` reports three correctly ordered
  slide PNGs. All three exported slides were inspected at full size in both
  PDF rasterization and the archive, alongside the audience preview. The
  fixture contains text and shapes but no images, masks, or effects, and the
  PDF reports `Tagged: no`; broader fidelity and accessibility claims remain
  unverified.
- Hardening and marketing site: source-build feature/docs pages, help content,
  crosslinks, and a reproducible three-slide screenshot fixture are present.
  Reviewed production screenshots and both-base-path site E2E remain pending.

## Execution checkpoint — 2026-09-29

- Shared index currently contains unrelated illustration, tablet, and
  workspace-review paths; this task has not staged anything. Do not commit
  until that index is released and rechecked.
- The presentation foundation is implemented in the worktree: schema 2.31 and
  additive migration, normalized deck metadata, resolver, typed operations,
  16:9/4:3/vertical/custom creation, and the Design Slides tab with order
  review, multi-selection, reorder alternatives, titles, sections, skip,
  notes, reference removal, and focused editing.
- The worktree planner sees 749 shared changes and reports
  `FULL-SUITE ESCALATION: YES` because shared changes touch workspace/toolchain
  and validation contracts. It selects all touched packages and broad E2E;
  run the affected closure and one migration-justified final gate only after
  the shared tree stabilizes.
- Focused scene/layout tests passed (9 tests) and focused Presentation editor
  tests passed (13 tests). `pnpm typecheck:e2e` passed. Editor typecheck still
  reports unrelated errors in `CurveEditor.test.tsx` and `exportService.test.ts`.
- `pnpm audit:docs` passed (1121 documents, 729 links, 178 ADRs indexed);
  `pnpm audit:tokens` passed all 303 contrast pairs in three themes and the
  token-usage scan. `pnpm audit:emoji` reports two unrelated Codegen test
  literals. `node scripts/audit-architecture.mjs --ci` reports 14 cycles,
  instability, and import-budget failures in shared paths, with no layer
  violations; comparison to the baseline shows the workspace is concurrently
  changing.
- Browser run: initial navigator, preview, and empty PDF/PNG writes passed;
  the 12-slide save/reopen flow passed but exposed cloned frames absent from
  the scene tree. Duplication now reparents cloned frames beside their source;
  the retest passed with no orphan warning. The high-contrast 1200×750 touch
  reorder passed. The 100-slide deck took 120.7s to build; opening its last
  slide in audience preview took 3.1s, with two thumbnails loaded and 286MB
  Chromium-reported JS heap at capture. This is a single Linux Chromium sample,
  not a platform-wide performance result. The populated export journey also
  passed after tightening the test locators.
- Marketing pages are linked from feature and documentation discovery. The
  product screenshot runner has a presentation navigator, slide, layout
  revision (tablet/dark), audience preview, and export-dialog scene. Only
  reviewed candidates may be synchronized; the local runner is queued behind
  other leased browser tasks.

## Current validation and commit checkpoint — 2026-09-29

- The branch remains `master`; no new branch or worktree was created. The
  shared index had 37 unrelated staged paths earlier in the run, but they were
  released. Only the five presentation research/architecture/ADR files are
  staged for the documentation milestone; inspect that index before committing.
- The fresh `pnpm verify:plan` reports 742 shared changed paths and
  `FULL-SUITE ESCALATION: YES` due workspace/toolchain and validation
  infrastructure changes. `pnpm verify:affected` stopped at the mandated
  escalation. The one `pnpm verify:triage` attempt stopped in its first
  formatter lane with 37 Biome errors across shared worktree changes. Direct
  Biome checks for presentation implementation, website, screenshots, and E2E
  files passed; do not reformat other owners' paths.
- Targeted presentation scene/layout and editor suites passed: 52 tests across
  12 files. `pnpm typecheck:e2e` passed after the tablet-row geometry assertion.
  The 1200×750 high-contrast touch reorder E2E passed. The migration-justified
  `pnpm verify:full` exited before test lanes: repository-wide Biome found the
  shared-tree errors; architecture audit hit the built-in `ts-prune` timeout;
  workspace typecheck then stopped on `ByRoleOptions.exact` type errors in the
  untouched `CurveEditor.test.tsx`. Rust, browser, and full unit lanes did not
  start. Do not rerun this full gate while those blockers remain.
- `pnpm audit:docs` is clean (1121 docs, 732 links, 178 ADRs); all 303 token
  contrast pairs pass across three themes and token usage is clean; the emoji
  audit is clean. The health audit passed with hub imports within current
  baselines. An earlier standalone architecture audit passed; the final-gate
  rerun timed out in `ts-prune` under shared load.
- Both website builds completed (114 routes each, no Astro diagnostics). Five
  reviewed product captures were promoted to the manifest and website assets.
  The validator checked the manifest but exited on unrelated missing/orphan
  Effect Studio and diagnostics screenshots from the shared tree; it also
  warned that the full capture set is 7.19 MB. The isolated two-base-path
  presentation feature E2E is queued behind an active heavy-task lease.
- Export evidence is limited to the inspected three-slide fixture: a
  three-page 960×540pt raster PDF and an ordered three-entry PNG archive,
  visually consistent for text, solid shapes, and backgrounds. Images, masks,
  effects, tagged-PDF accessibility, cancellation/write-error cases, and
  office/PPTX interoperability remain unverified. Built-in layout collections,
  linked themes, formatting/reset, and cross-document layout/theme clipboard
  mapping are still open work.
