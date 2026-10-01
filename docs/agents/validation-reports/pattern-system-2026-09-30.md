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
- `302712c81` — record pattern validation evidence.
- `e988d6462` — periodic source overhang, scoped Make Unique, and draft guards.
- `54b9f1369` — update pattern validation report.
- `42293a033` — raster seam inspection and cyclic offset editing.
- `f26111d2b` — PDF and PDF/X preflight for missing pattern sources.
- `42d997504` — three-panel reusable-pattern browser workflow and inspected capture.

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
- Added raster seam inspection and whole-pixel cyclic offset editing for
  embedded tiles up to 16 megapixels. Applying an offset stores a new PNG with
  existing pixels repositioned; it does not synthesize seam content or enable
  wraparound painting. A real Chromium workflow verifies the preview, shared
  definition update, and exported tile pixels.

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

Raster seam-offset slice:

pnpm exec vitest run packages/editor/src/patterns/rasterPatternOffset.test.ts packages/editor/src/patterns/patternSourceDraft.test.ts packages/editor/src/patterns/compilePatternPreview.test.ts packages/editor/src/patterns/patternUsage.test.ts packages/scene/src/patternDefinitions.test.ts
  Passed: 5 files, 23 tests. Includes whole-pixel modulo placement for
  horizontal/vertical offsets and input validation.

VARVE_E2E_PORT=5306 node scripts/quality/heavy-lease.mjs "e2e: inspect final raster offset controls and prove exported tile pixels" -- npx playwright test tests/e2e/canvas/pattern-repeat.spec.ts --project=chromium --workers=1 --reporter=list --grep "replaces a definition source"
  Passed: 1 Chromium workflow in 34 seconds at the normal 1280×720 viewport.
  It checks shared-definition replacement, changed preview and swatch pixels,
  and decodes the exported SVG tile to assert that an X offset cyclically
  rotates its source texels. Captures include the preview and separately
  scrolled, full-width Cancel/Apply controls.

pnpm --filter @varve/editor typecheck
  Passed.

pnpm typecheck:e2e
  Passed.

pnpm --filter @varve/website build
  Passed: 173 Astro files checked, 116 static routes built.

pnpm exec playwright screenshot --browser chromium --viewport-size='1280,960' --full-page --wait-for-selector='h1' http://localhost:4323/docs/tools/patterns/ docs/screenshots/pattern-system-2026-09-30/guide-raster-offset-desktop.png
  Captured the rebuilt local guide for visual review.

pnpm exec playwright screenshot --browser chromium --viewport-size='390,844' --full-page --wait-for-selector='h1' http://localhost:4323/features/patterns/ docs/screenshots/pattern-system-2026-09-30/feature-raster-offset-mobile.png
  Captured the rebuilt local feature page for mobile-width review.

pnpm exec biome check packages/editor/src/components/Inspector/sections/PatternLibrarySection.css packages/editor/src/components/Inspector/sections/PatternRasterOffsetEditor.tsx packages/editor/src/patterns/rasterPatternOffset.ts packages/editor/src/patterns/rasterPatternOffset.test.ts tests/e2e/canvas/pattern-repeat.spec.ts
  Passed: 5 files, no fixes or warnings after arranging the responsive rules
  after the shared button rules.

pnpm audit:docs
  Passed: 1,124 docs, 744 links, 178 ADRs indexed.

pnpm audit:emoji
  Passed: 5,211 files.

pnpm audit:tokens
  Passed: all 324 contrast pairs across 3 themes plus token-usage scan.

pnpm audit:radius
  Passed: 2,687 active source files, zero legacy radius consumers.

pnpm audit:inspector-css
  Passed with existing non-blocking inspector debt inventory; the pattern
  stylesheet reports its pre-existing grid-column count.

pnpm audit:spacing
  Passed: 311 raw declarations tracked by 244 buckets.

pnpm audit:sizing
  Passed: 67 ratcheted interface declarations.

pnpm lint:css
  Passed. Existing inspector-css debt remains a non-blocking inventory outside
  this slice.

pnpm verify:plan
  Reported 449 shared changed files across 11 JS packages and Rust crates
  varve-print/varve-bridge; FULL-SUITE ESCALATION: YES due to unrelated shared
  workspace/toolchain/validation-infrastructure changes.

pnpm verify:affected
  Exited 2 after printing that full-suite escalation. The subsequent final
  full-gate attempts and their blockers are documented below.
```

The focused suite covers definition create/apply/unique, source persistence and
dependency rejection, clip/asset remapping, legacy fills, repeat invariants,
generator pixels, linked-paint handling, SVG/PDF resources, and print-export
warnings. The browser spec verifies real canvas periodicity, arrangement
changes, deterministic randomization, raster replacement, one-step Make
Unique undo/redo, and absence of history-bypass warnings.

### Required escalated gate

```text
VARVE_FULL_GATE_REASON="Pattern schema and cross-package scene-render-export contracts changed; final full validation requested by the implementation plan." pnpm verify:full
  On the shared checkout this reached the CI tooling tests, then seven
  `audit-contacts.test.mjs` fixture cases could not write because another
  process held the shared `.git/index.lock`. The lock and unrelated process
  were left untouched. All 20 workspace package typechecks passed in that run.

GIT_INDEX_FILE=/home/kevina/CodingProjects/varve/.git/pattern-validation-final.index pnpm verify:full
  The relative-index retry moved past the contacts test but caused
  `validation-snapshot.test.mjs` to fail in its temporary Git repository.
  That test also failed with an absolute index override because its fixture
  commit then referenced objects from the parent repository. This workaround
  was abandoned.

VARVE_FULL_GATE_REASON="Pattern definition schema and cross-package render/export contracts changed; validating committed master revision 42d997504 in an isolated detached worktree." pnpm verify:full
  The detached worktree at `42d997504` stopped at workspace typecheck:
  `packages/compositor/src/webgl2/backend.ts` uses id `"webgl2"`, which is
  absent from the committed `CompositorBackendId` type. The shared checkout
  contains an uncommitted contract update for that concurrent WebGL2 work.

PATH=/tmp/pattern-git-index-bin:$PATH VARVE_FULL_GATE_REASON="Pattern schema and cross-package scene-render-export contracts changed; final full validation for the shared master working tree, with only audit-contacts fixture Git writes isolated from the held shared index." pnpm verify:full
  The contacts test passed through a wrapper that isolates only its fixture
  index. Format checking reported an unrelated formatting error in the
  concurrent `packages/editor/src/editor.css` change. All 20 package
  typechecks passed; E2E typechecking then exited 1.

pnpm typecheck:e2e
  Reproduced the E2E typecheck failure directly:
  `tests/e2e/responsive/layers-inspector-panels.spec.ts(46,36): TS18047` —
  `n.textContent` may be null. That test file is outside the pattern scope.

PATH=/tmp/pattern-git-index-bin:$PATH node scripts/audit-contacts.test.mjs
  Passed all 8 fixture cases with only that test's Git writes routed to the
  separate index.
```

The final `pnpm verify:plan` before the packaging commit reported 456 changed
paths, 11 JS packages, Rust crates `varve-print` and `varve-bridge`, and
`FULL-SUITE ESCALATION: YES`; `pnpm verify:affected` exited 2 as required by
that escalation. `pnpm audit:docs`, `pnpm audit:emoji`, and `pnpm audit:tokens`
passed after the documentation and E2E updates.

The architecture audit completed with 14 dependency cycles, zero layer
violations, and 74–75 unstable modules depending on whether it ran in the
committed detached worktree or the dirty shared checkout. Existing
Shell/Menubar/context import-budget warnings remain. The pattern work did not
touch those hubs. Because the full workspace Vitest and Cargo suites were not
reached in the final shared-checkout attempt, the full gate is **not green**.

## Visual and output evidence

Application screenshots are real Chromium Canvas2D output at 1280×720. The first
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
- `app-raster-offset-edit.png` shows the repeated raster seam preview and
  selected one-pixel X offset. `app-raster-offset-controls.png` shows the
  scrolled inspector with full-width Cancel and Apply offset controls at the
  same viewport; this capture caught and drove the narrow-inspector sizing fix.
- `guide-raster-offset-desktop.png` and `feature-raster-offset-mobile.png` are
  screenshots of the rebuilt local marketing guide and feature page after the
  offset limitations were documented. The page content fits without horizontal
  overflow; these are local builds and were not published.
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
- No raster pixel repair or wraparound brush editing, and no finite
  Expand-to-objects command. The new raster offset inspector only cyclically
  repositions existing texels. Custom stagger fractions outside the
  conventional Grid/Half-drop/Brick geometries are rejected for rectangular
  supertile export.
- No shared page-origin alignment; phase remains object-local.
- The visual E2E documents are basic shapes and generated/raster samples. The
  new packaging case verifies one reusable pattern applied to three adjacent
  panels, but does not cover the full branded layout with masks, nested
  transforms, or alignment against differently transformed objects. The
  requested 6–12 motif botanical collection and repaired transparent-raster
  design remain unverified.
- Native Tauri output, offline save/reopen through the real app, physical
  touch/pen interaction, high-DPR device behavior, and dense-repeat performance
  were not independently validated.
- SVG source-tile export embeds vector previews as a nested SVG image, not as
  independently editable motif objects. Native applied-fill SVG is limited to
  the documented linked-grid subset; PDF support is narrower
  than editor rendering. Other generated code targets do not provide native
  editable pattern definitions.
- The full repository gate is not green. The final shared-checkout attempt
  passed workspace package typechecks but failed E2E typechecking on an
  unrelated nullability error; the detached committed-checkout attempt failed
  on the uncommitted WebGL2 type-contract dependency. The full workspace
  Vitest/Cargo suites were not reached. Earlier shared-checkout attempts also
  encountered the pre-existing `.git/index.lock` and an unrelated formatter
  error, as detailed above.

Do not describe the work as full pattern-authoring completion until these
limitations are closed and the three design workflows pass end to end.

## PDF missing-source preflight slice

The editor now refuses standard PDF and PDF/X generation when any visible
pattern fill in the flattened export subtree has no resolved tile source. The
failure names the missing pattern source and tells the user to replace or
reimport it. The lower-level Rust renderer retains its warning-and-omit
fallback and does not draw a gray rectangle. This closes a misleading-success
case where an incomplete PDF/X could previously be returned as a successful
export.

Commands for this slice:

```text
pnpm exec vitest run packages/editor/src/export/printImageManifest.test.ts packages/editor/src/exportService.test.ts
  Passed: 2 files, 20 tests. The new PDF/X regression proves the native export
  command is never called for a missing visible tile source.

pnpm --filter @varve/editor typecheck
  Passed.

pnpm exec biome check packages/editor/src/export/printImageManifest.ts packages/editor/src/export/printImageManifest.test.ts packages/editor/src/components/SpecPanel/export.ts packages/editor/src/exportService.test.ts
  Passed after applying the formatter's one-line wrap.

pnpm verify:plan
  Selected 453 dirty shared-tree paths, 11 JS packages, Rust varve-print and
  varve-bridge, and FULL-SUITE ESCALATION: YES because of unrelated workspace,
  toolchain, and validation-infrastructure changes.

pnpm verify:affected
  Exited 2 after printing that plan and requiring pnpm verify:full.

pnpm audit:docs
  Passed: 1,124 docs, 744 links, 178 ADRs indexed.

pnpm audit:emoji
  Passed: 5,211 files.

pnpm audit:tokens
  Passed: all 324 contrast pairs across 3 themes and token-usage scan.

pnpm --filter @varve/website build
  Passed: Astro check found 0 errors/warnings/hints; 116 static routes built.

node scripts/quality/heavy-lease.mjs "pattern docs guide visual check" -- pnpm exec playwright screenshot --browser chromium --viewport-size='1280,960' --full-page --wait-for-selector='h1' http://localhost:4323/docs/tools/patterns/ docs/screenshots/pattern-system-2026-09-30/guide-export-missing-source-desktop.png
node scripts/quality/heavy-lease.mjs "pattern docs guide mobile visual check" -- pnpm exec playwright screenshot --browser chromium --viewport-size='390,844' --full-page --wait-for-selector='h1' http://localhost:4323/docs/tools/patterns/ docs/screenshots/pattern-system-2026-09-30/guide-export-missing-source-mobile.png
  Both captures were inspected. The updated export status wording is visible;
  no clipping was observed at either viewport. These are local website captures.
```

This slice did not rerun the full gate. The prior full-gate attempts and the
shared-tree lock/formatter blockers remain documented above; the plan requires
one final full-gate attempt on the last coherent revision.

## Three-panel packaging workflow and inspected capture

The real Chromium workflow creates three canvas rectangles, creates one
procedural checker definition, applies it separately to each selected panel,
and verifies the library reports one, two, then three uses. The final capture
shows all three repeating fills, one selected panel, and the three-use library
state. This validates a small packaging-style application, not the broader
brand-layout cases listed above.

```text
pnpm exec biome check tests/e2e/canvas/pattern-repeat.spec.ts
  Passed; no fixes applied.

VARVE_E2E_PORT=5323 node scripts/quality/heavy-lease.mjs "e2e: three-panel pattern library workflow" -- npx playwright test tests/e2e/canvas/pattern-repeat.spec.ts --project=chromium --workers=1 --reporter=list --grep "three-panel packaging"
  Passed: 1 Chromium workflow in 40.5 seconds.

Visual inspection
  Inspected docs/screenshots/pattern-system-2026-09-30/app-packaging-panels.png
  at 1280×720. The 3 panels, checker repetition, selected-fill handles, and
  “3 uses” state are visible; no panel is clipped at the captured zoom.
```
