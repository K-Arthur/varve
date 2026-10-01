# Pattern system — implementation and validation report

**Date:** 2026-09-30
**Branch:** `master`
**State:** usable pattern authoring and export slices implemented; full requested
scope is not complete. Shared checkout preserved.

Task-owned commits on `master`:

- `f25e58786` — repeat regression test and visual output evidence.
- `72598a6a4` — supported SVG/PDF pattern export and resource handling.
- `4d9dd0aed` — Pattern Library inspector settings layout.
- `2d0d466f3` — marketing feature page and pattern workflow guide.
- `184fd433b` — cancelable copied-vector source motif editing.
- `e988d6462` — periodic source overhang, scoped Make Unique, and draft guards.

## Delivered

- Added document-level definitions for copied vector mini-scenes, embedded
  raster tiles, and procedural recipes, with stable IDs, revisions, logical
  cell bounds, repeat settings, dependency validation, preview caches, and
  legacy inline-tile compatibility.
- Added create-from-selection, procedural creation, raster import/replacement,
  apply, Make Unique, usage count, settings, source-tile and rectangular
  supertile SVG export, and searchable Pattern Library UI. The original
  selected art remains in the document.
- Added grid, column-offset half-drop, and row-offset brick evaluation with
  fractional and negative phase, mirror parity, bounded instance walks, and
  deterministic generator seeds including zero.
- Compiled vector source tiles now include root-motif overhang using the
  authored lattice and mirror parity. Vector repeat edits invalidate and
  rebuild that derived preview; raster source previews keep their cache when
  only the arrangement changes.
- Added per-fill pattern placement and linked-paint scope checks; grouped
  Pattern Library document mutations into labeled history transactions.
- Made Make Unique target exactly one matching fill, including objects with
  multiple fills that reference the same definition. Usage counts now count a
  nested pattern edge once even when both vector source fills and dependency
  metadata describe it.
- Added a revision-checked vector source draft editor with repeated preview,
  canonical top-level motif selection, translation and rotation controls,
  keyboard nudges, Done/Cancel, and one shared-source history commit. Cancel
  leaves the stored definition untouched.
- Added rectangular supertile SVG output for Grid and conventional Half-drop
  or Brick repeats, including mirror parity and clipped edge copies. Custom
  stagger fractions that do not match a supported finite period are refused.
- Added native SVG `<pattern>` output for the supported linked-grid subset,
  raster fallback with warnings for unsupported editor-export cases, and
  resource-backed PDF pattern images for the supported axis-aligned grid
  subset. PDF/X-1a discloses transparent/non-opaque omissions.
- Added a Patterns feature page and tool guide, linked from the feature/docs
  indexes, and corrected the export support claims. The site was built and
  previewed locally; it was not published.

The research-to-decision ledger is
[`pattern-authoring-research-2026-09-30.md`](../../research/pattern-authoring-research-2026-09-30.md).
The current product contract and export limitations are in
[`fill-system.md`](../../architecture/fill-system.md).

## Validation plan

The latest `pnpm verify:plan` reported 443 changed files, all 11 JS packages,
and Rust crates `varve-bridge` and `varve-print`; it selected
`FULL-SUITE ESCALATION: YES` because the shared checkout includes workspace,
toolchain, and validation-infrastructure changes. Earlier snapshots ranged
from 427 to 504 changed paths as unrelated work continued. `pnpm
verify:affected` returned its documented exit 2 and required the full gate.

## Commands and results

### Passing

```text
pnpm exec biome check packages/editor/src/components/Inspector/sections/PatternLibrarySection.tsx packages/editor/src/components/Inspector/inspector.css tests/e2e/canvas/pattern-repeat.spec.ts
  Passed; 10 existing descending-specificity warnings remain in the large shared inspector stylesheet.

pnpm exec biome check tests/e2e/canvas/pattern-repeat.spec.ts
  Passed after correcting the custom combobox interaction in the test.

pnpm exec biome check packages/engine/src/replay.ts packages/engine/src/replay-fill.test.ts tests/e2e/canvas/pattern-repeat.spec.ts
  Passed after connecting the live replay path to the shared evaluator.

pnpm exec vitest run packages/engine/src/replay-fill.test.ts packages/engine/src/replay-pattern-repeat.test.ts
  Passed: 2 files, 94 tests, including an active replay assertion for the
  half-drop shear matrix.

pnpm audit:docs
  Passed: 1,137 docs, 744 links, 178 ADRs.

pnpm audit:emoji
  Passed: 5,272 files.

pnpm audit:tokens
  Passed: all 324 token pairs across 3 themes; token usage clean.

pnpm audit:inspector-css
  Passed. It printed its existing non-blocking debt inventory, including raw line-height and grid-column counts.

pnpm exec vitest run packages/scene/src/patternDefinitions.test.ts packages/scene/src/documentCodec.test.ts packages/scene/src/__tests__/clone.test.ts packages/shared/src/patternRepeat.test.ts packages/engine/src/patterns/patternGenerators.field.test.ts packages/engine/src/replay-pattern-repeat.test.ts packages/editor/src/patterns packages/editor/src/export/patternTileSvg.test.ts packages/editor/src/export/printImageManifest.test.ts packages/editor/src/export/compositor.test.ts packages/editor/src/exportService.test.ts packages/codegen/src/svg-pattern.test.ts packages/editor/src/components/Inspector/sections/PatternFillControls.test.tsx packages/editor/src/components/Inspector/sections/__tests__/FillSection.test.tsx packages/editor/src/import/mergeImportedResources.test.ts packages/editor/src/canvas/engineNodeMemo.test.ts
  Passed: 17 files, 300 tests.

VARVE_E2E_PORT=5243 node scripts/quality/heavy-lease.mjs "e2e: complete pattern authoring, arrangement, and raster replacement workflow" -- npx playwright test tests/e2e/canvas/pattern-repeat.spec.ts --project=chromium --workers=1 --reporter=list
  Passed: all 5 Chromium workflows in 1.9 minutes. This run first reproduced
  that a dirty, uncommitted grid-only painter in the shared checkout shadowed
  the committed shared-evaluator route; the actual canvas showed no half-drop
  phase change. Removing that stale override restored the committed route. The
  seeded-dot region assertion and visible half-drop screenshot now pass. A
  separate one-test capture refreshed the source and supertile evidence after
  dismissing the onboarding hint.

pnpm exec vitest run packages/editor/src/export/patternTileSvg.test.ts
  Passed: 5 tests, including exact half-drop supertile bounds, clipped copies,
  mirror parity, and refusal of unsupported custom stagger fractions.

pnpm exec vitest run packages/editor/src/patterns/patternSourceDraft.test.ts
  Passed: 3 tests for immutable source translation, root identity, rotation,
  and rejection of non-finite transforms. The new test first failed because
  the source draft helper did not yet exist.

pnpm --filter @varve/editor typecheck
  Passed after the source editor integration.

pnpm typecheck:e2e
  Passed after adding the source-edit regression workflow.

VARVE_E2E_PORT=5267 node scripts/quality/heavy-lease.mjs "e2e: edit copied pattern motif and verify cancel, commit, preview, undo" -- npx playwright test tests/e2e/canvas/pattern-repeat.spec.ts --project=chromium --workers=1 --reporter=list --grep "edits a copied vector motif"
  Passed: 1 Chromium workflow in 35 seconds. It verifies preview changes,
  Cancel restores the saved transform, Done persists a shared-source edit,
  and one Undo restores the original value.

GIT_INDEX_FILE=.git/pattern-task.index git commit -m "feat(patterns): edit copied vector source motifs"
  Passed the staged commit checkpoint on master. Biome checked 6 files;
  emoji/docs/security/interface-size/import-boundary audits passed;
  `typecheck:e2e` passed; the focused source-draft suite passed (3 tests).
  Commit: `184fd433b`.

pnpm verify:plan
  Latest follow-up: 434 changed paths, 11 JS packages, and Rust crates
  `varve-print` and `varve-bridge`; `FULL-SUITE ESCALATION: YES` for shared
  workspace/toolchain/validation-infrastructure and dependency changes.

pnpm --filter @varve/editor typecheck
  Passed after typing the clipboard fixture as a PatternDefinition.

VARVE_E2E_PORT=5222 node scripts/quality/heavy-lease.mjs "e2e: capture pattern supertile artifact" -- npx playwright test tests/e2e/canvas/pattern-repeat.spec.ts --project=chromium --workers=1 --reporter=list --grep "creates a reusable vector source"
  Passed: 1 Chromium workflow in 44 seconds. It changes the definition to
  Brick, asserts the authored row offset is 0.5, downloads a 300 by 400 SVG
  supertile, applies the source, and verifies Make Unique undo/redo.

pnpm typecheck:e2e
  Passed when rerun alone after a silent exit 1 inside the full-gate run.

pnpm --filter @varve/codegen build
  Passed.

pnpm --filter @varve/website build
  Passed: 173 Astro files, 116 routes, no diagnostics.

cargo test -p varve-print
  Passed: 168 tests.

pnpm verify:plan
  Latest continuation: 443 changed paths, 11 JS packages, and Rust
  varve-print/varve-bridge. FULL-SUITE ESCALATION: YES for shared
  workspace/toolchain/validation-infrastructure changes.

pnpm verify:affected
  Exited 2 after printing the plan and required pnpm verify:full because the
  shared working tree triggers the full-suite escalation.

pnpm exec vitest run packages/scene/src/patternDefinitions.test.ts packages/editor/src/patterns/compilePatternPreview.test.ts packages/editor/src/patterns/patternSourceDraft.test.ts packages/editor/src/patterns/patternUsage.test.ts
  Passed: 4 files, 20 tests, including vector-repeat cache invalidation,
  lattice-based overhang copies, document collision rejection, translation
  overflow, one-fill usage and dependency counts.

pnpm --filter @varve/editor typecheck
  Passed after tightening tuple typing for the translated source-image corners.

pnpm typecheck:e2e
  Passed.

pnpm exec biome check packages/scene/src/patternDefinitions.ts packages/scene/src/patternDefinitions.test.ts packages/editor/src/components/Inspector/sections/PatternLibrarySection.tsx packages/editor/src/patterns/compilePatternPreview.ts packages/editor/src/patterns/compilePatternPreview.test.ts packages/editor/src/patterns/patternPeriodicSource.ts packages/editor/src/patterns/patternSourceDraft.ts packages/editor/src/patterns/patternSourceDraft.test.ts packages/editor/src/patterns/patternUsage.ts packages/editor/src/patterns/patternUsage.test.ts tests/e2e/canvas/pattern-repeat.spec.ts
  Passed: 11 files; no fixes applied.

VARVE_E2E_PORT=5294 node scripts/quality/heavy-lease.mjs "e2e: verify copied vector pattern source editing, repeat cache refresh, and unique fills" -- npx playwright test tests/e2e/canvas/pattern-repeat.spec.ts --project=chromium --workers=1 --reporter=list --grep "edits a copied vector motif|creates a reusable vector source"
  Passed: 2 Chromium workflows in 1.1 minutes. The source-edit test checks
  draft preview, Cancel, shared commit and Undo; the reuse test checks export,
  one-fill Make Unique, usage counts and Undo/Redo. It refreshed
  app-source-edit.png, which was inspected at 1280×720; there was no horizontal
  overflow, while lower inspector controls require vertical scrolling.

pnpm audit:docs
  Passed: 1,123 docs, 744 links, 178 ADRs indexed.

pnpm audit:emoji
  Passed: 5,211 files.

pnpm audit:tokens
  Passed: all 324 contrast pairs across 3 themes and usage scan (597 custom
  properties, 9 documented override hooks).

node scripts/audit-architecture.mjs --ci
  Exited 0. It reported 14 existing dependency cycles, 75 unstable modules,
  zero layer violations, and existing Shell/Menubar/context import-budget
  warnings in the shared dirty checkout. The pattern slice does not touch those
  hubs; no architecture baseline was updated.

pnpm audit:radius
  Passed: 2,684 source files; no legacy radius consumers.

pnpm audit:inspector-css
  Passed. It printed the existing non-blocking inspector debt inventory,
  including 3 grid-template-columns declarations in PatternLibrarySection.css.

pnpm audit:spacing
  Passed: 311 raw declarations are tracked by 244 buckets.

pnpm audit:sizing
  Passed: 67 ratcheted interface declarations.

pnpm lint:css
  Passed.

VARVE_FULL_GATE_REASON="Pattern definition schema, scene/editor repeat evaluation, SVG/PDF export paths, and cross-package contracts require the mandated final gate." pnpm verify:full
  Exited 1 after whole-worktree format/lint reported 3 pre-existing format
  errors in untracked E2E probes: _probe-hit-confirm.spec.ts,
  _probe-rail.spec.ts, and _probe-topchrome.spec.ts. The architecture audit
  completed with the same 14 shared-workspace cycles and no layer violations.
  Workspace package typechecks completed; the combined gate stopped before
  Vitest and Cargo suites because of the earlier whole-worktree errors.

pnpm typecheck:e2e
  Passed when run alone immediately after the full-gate exit.
```

The focused suite covers definition create/apply/unique, source persistence and
dependency rejection, clip/asset remapping, legacy fills, repeat invariants,
generator pixels, linked-paint handling, SVG/PDF resources, and print-export
warnings. The browser spec verifies real canvas periodicity, arrangement
changes, deterministic randomization, raster replacement, one-step Make
Unique undo/redo, and absence of history-bypass warnings.

### Required escalated gate

```text
VARVE_FULL_GATE_REASON="Pattern definition schema, engine wire, SVG/PDF export paths, and marketing docs are integrated; required final gate for persisted format and cross-package contracts." pnpm verify:full
  Latest rerun exited 1 in scripts/audit-contacts.test.mjs. Six fixture cases
  could not add temporary files because a pre-existing .git/index.lock blocked
  Git; the lock was not removed or modified in this shared checkout. The
  standalone E2E typecheck passed in this run. The full Vitest and Cargo
  workspace suites were not reached.
```

All 20 workspace package typechecks and `typecheck:e2e` passed in the latest
gate run. Its maintenance-script tests progressed through `audit-contacts`,
where six Git-fixture cases failed because `.git/index.lock` already existed;
the failure output identifies lock contention rather than pattern code. The
full Vitest and Cargo workspace suites were not reached, so the full gate is
**not green**. The formatter also reported one unrelated existing error in
`native-webgl2-2026-09-28T10-16-25-630Z.json` (missing final newline); it was
left untouched.

The architecture audit found 14 dependency cycles, no layer violations, and
75 unstable modules. The supplied AGENTS guidance says 49; the checked-in
`.architecture-baseline.json` currently says 55. The 75-module result exceeds
both readings. Existing Shell/Menubar/context import-budget warnings also
remain. No hub files were modified for the pattern work; these metrics include
the concurrent dirty workspace and cannot be attributed to this feature alone.

## Visual and output evidence

All browser captures are real Chromium Canvas2D output, 1280×720. The first
review caught the full repeat preview's explanatory text escaping the 20px
library swatch. The swatch is now clipped to its own bounds, the hint is hidden
inside the compact swatch, and the browser test asserts those layout bounds.
The corrected screenshots are in
[`docs/screenshots/pattern-system-2026-09-30/`](../../screenshots/pattern-system-2026-09-30/):

- `app-vector-source.png`, `app-definition-settings.png`, and
  `app-unique-use.png` show the source library, compact swatch, settings, and
  unique fill flow.
- `app-half-drop.png` and `app-replaced-raster.png` show the in-app repeat and
  embedded raster workflows.
- `app-source-edit.png` shows the real application with the copied source
  motif editor open after a translation change. The 1280×720 view fits the
  canvas and inspector without horizontal overflow; the inspector scrolls to
  reach the remaining transform fields.
- `feature-desktop.png` and `feature-mobile.png` are local marketing-site
  captures. They were inspected for layout and mobile overflow; the long mobile
  page is naturally scaled down in the contact view. `guide-desktop.png` is an
  fresh capture of the built guide at 1280×960 after the supertile export copy
  was added. It was visually inspected for layout, current export and scope
  wording, and horizontal overflow. The capture used the built site, not a
  production deployment.
- `applied-pattern.svg` was rendered independently with librsvg to
  `applied-pattern-svg.png`. ImageMagick pixel comparisons found **0 differing
  pixels** after shifting the 1200×750 render by the expected 60px repeat
  period on both axes.
- `pattern-supertile.svg` was downloaded from the real editor workflow and
  rendered with librsvg to `pattern-supertile-render.png` at 600 by 800 pixels;
  its authored SVG viewBox is 300 by 400 logical pixels.
- `pattern-standard.pdf`, `pattern-pdfx1a.pdf`, and `pattern-pdfx4.pdf` were
  inspected with `pdfinfo`, `pdfimages -list`, and rendered page images. They
  are one-page PDFs at 480×360pt. The PDF/X samples contain tile images and
  soft masks; the X-1a path is separately tested for opaque CMYK conversion.

Evidence validates the delivered slices, not the full requested workflows.
The repeated preview was pixel-hash checked before and after translation,
Cancel, Done, and Undo. No before/after performance measurements were
collected.

## Not implemented or not verified

- No full canvas authoring session for vector motifs, nested child/path/text
  edits, resize/recolor controls, neighbor-ghost hit mapping, or drag-based
  wraparound editing. The inspector source editor currently supports top-level
  motif translation/rotation with numeric, keyboard, and repeated-preview
  feedback controls.
- No raster seam-inspection or offset-repair UI, wraparound brush editing,
  or finite Expand-to-objects command. Custom stagger fractions outside the
  conventional Grid/Half-drop/Brick geometries are rejected for rectangular
  supertile export.
- No shared page-origin alignment; phase remains object-local.
- The visual E2E documents are basic shapes and generated/raster samples, not
  the requested 6–12 motif botanical collection, multi-panel packaging
  document, or repaired transparent-raster design.
- Native Tauri output, offline save/reopen through the real app, physical
  touch/pen interaction, high-DPR device behavior, and dense-repeat performance
  were not independently validated.
- SVG source-tile export embeds vector previews as a nested SVG image, not as
  independently editable motif objects. Native applied-fill SVG is limited to
  the documented linked-grid subset; PDF support is narrower
  than editor rendering. Other generated code targets do not provide native
  editable pattern definitions.
- The full repository gate remains red because six Git-fixture cases could not
  acquire the pre-existing shared `.git/index.lock`; the full workspace
  Vitest/Cargo suites were not reached. The latest workspace and E2E typechecks
  passed.

Do not describe the work as full pattern-authoring completion until these
limitations are closed and the three design workflows pass end to end.
