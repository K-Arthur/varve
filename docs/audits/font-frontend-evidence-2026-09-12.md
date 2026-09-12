# Font frontend continuation — 2026-09-12

This checkpoint continues the original font program on `master`. Source and
captures include concurrent application changes around `1b8ffefe9` through
`268c65408`; they are working-tree observations, not a frozen release or native
platform certificate. The [remaining-work plan](../plans/font-system-remaining-2026-09-10.md)
now explicitly pairs every backend slice with its controls and visible states.

## Long-text responsiveness

The glyph inspector segmented the entire paragraph for every cluster label
and both sides of every pair label. With 5,000 characters this repeated the
same full-text operation roughly 15,000 times. The retained before profile
attributes about 30 seconds to grapheme segmentation; the subsequent profile
after deriving labels from existing graphemes attributes about 372 milliseconds.
These profiles cover different durations and are diagnostic samples, not p95
benchmarks. Closed Select controls also built all their option elements before
the portal discarded them. They now construct those elements only while open.

The regression tests bound segmentation work by processed character count and
retain combined-grapheme/whitespace labels. The complete shared UI collection
plus these two regressions passes **616 tests in 66 files**. The real browser
workflow inserts 5,000 characters, leaves editing through the Select tool,
reopens the text on the canvas, applies Bold and retains all characters. Its
edit-exit click has a ten-second regression deadline; this does not establish
the separate 150/100/150 ms font-picker performance budgets.

## Editing surface clipping

Visual inspection of the passing long-text workflow found its transparent
textarea and border extending into the inspector. A browser hit-test reproduced
the defect: `elementFromPoint` eight pixels outside the canvas returned the
editing surface. A viewport clipping wrapper now contains both painting and
hit testing while retaining the textarea's full transformed geometry. The
same hit-test passes after repair. The toolbar remains independently positioned.

The focused overlay, glyph-inspector and Select collection passes **34 tests**.
The final Chromium run passes long-text editing/clipping and the immediate
typing → Bold → Undo → Redo case. All four captures in the
[frontend manifest](../screenshots/fonts/2026-09-12-frontend/manifest.json) were
inspected before acceptance: before/after clipping and final Undo/Redo. These
are Light, DPR 1 observations; rotated/zoomed clipping and native webviews still
need their platform and geometry checks.

## PDF and test interaction repairs

The inspector now moves Export into its responsive More menu when necessary.
The PDF test helper follows either the visible tab or that real menu. The
5,000-character PDF case passes; the other three PDF cases pass in a subsequent
run. These existing cases assert PDF output, not exact font embedding, rich-run
font identity or actual underline preservation. Their historical test names
must not be taken as proof of those stronger contracts.

The first long-text test incorrectly double-clicked a layer, which starts
renaming. It now double-clicks the text on the canvas. One subsequent run failed
to reach Home while a concurrent clipboard edit was syntactically incomplete;
the later targeted run passed. No assertions were weakened to hide either issue.

## Validation and outstanding work

The UI compiler, E2E compiler, docs and emoji audits pass. All **153 token pairs**
pass across Light, Dark and High Contrast. The editor compiler identified a
missing `this` annotation in the new spy, which was repaired. The final rerun
after clipping reports unrelated Menubar portal props, old contextual shortcut
tool IDs, AI status state and a frame-test shape. Earlier import-test and SVG
viewBox errors no longer appear after concurrent repairs. The editor package
is therefore not reported green.

The original affected collection remains partly unfinished. Its remaining
AI (24), CLI (23), and history (176) unit tests pass, as do their compilers
and the collaboration compiler. Website units retain the two previously
recorded token failures (190 pass). This checkpoint also finishes the shared
UI lane. A fresh private-index `pnpm verify:affected --staged` for the 14
frontend files passes its format/lint, docs/emoji, E2E compiler, three direct
unit files and both browser specs (five cases). Its editor-package collection
has exposed concurrent native-menu snapshot and clipboard action failures;
the final package summary is not yet available. These failures do not replace
the passing scoped browser evidence or establish a passing integration gate.
The standalone frontend changes do not close any of the 24 complete acceptance
scenarios. Real face controls, range/caret commands, missing-font recovery,
permission UI, document usage/repair, identification, marketing captures and
platform proof remain required under the original plan.

```text
Changed scope: TextEditOverlay clipping; GlyphTypographySection label cost and regressions; shared Select closed-option allocation; long-text and PDF browser tests; text architecture, frontend delivery plan and four inspected captures.
Validation plan: pnpm verify:plan selects touched format/lint, direct unit/browser checks, editor/UI and reverse dependency lanes. Broad failures were already collected; targeted repairs and the remaining UI lane are recorded here. No full-suite escalation for this local frontend slice.
Commands actually run: see exact commands below and reports/font-lifecycle-2026-09-11/frontend-*.log. The fresh affected run uses the pinned private index recorded in frontend-validation-index.txt; package completion is pending.
Passed: shared UI plus glyph regressions 616 tests; final focused overlay/glyph/Select 34 tests; UI compiler; E2E compiler; long-text toolbar/clipping and history Chromium cases; four PDF output cases; docs/emoji; 153 token checks; four inspected captures.
Skipped as unrelated: Rust workspace and full visual suite for this slice; no native implementation or renderer dispatch change. Native font proof and the earlier schema/foundational full gate remain pending rather than waived.
Escalations: sandboxed browser launch; concurrent clipboard syntax failure; editor compiler failures outside these changes; commit attempts guarded against advancing master; one unrelated brush-test hook timed out under memory pressure. No integration certification claimed.
Full suite run: no
If yes, reason: not applicable; original schema/foundational final gate remains required.
```

```sh
pnpm verify:plan
pnpm verify:plan --staged
node reports/font-lifecycle-2026-09-11/run-frontend-affected.mjs # pnpm verify:affected --staged, scoped private index
node reports/font-lifecycle-2026-09-11/resume-selected-frontend.mjs
pnpm typecheck:e2e
pnpm --filter @varve/editor typecheck
pnpm --filter @varve/ui typecheck
VARVE_TEST_WORKERS=1 pnpm exec vitest run packages/ui packages/editor/src/components/Typography/GlyphTypographySection.test.tsx
VARVE_TEST_WORKERS=1 pnpm exec vitest run packages/editor/src/components/TextEditOverlay.test.tsx packages/editor/src/components/Typography/GlyphTypographySection.test.tsx packages/ui/src/components/Select.test.tsx
VARVE_DISABLE_HMR=1 VARVE_E2E_PORT=1485 VARVE_E2E_OUTPUT_DIR=font-frontend-long-text VARVE_E2E_WORKERS=1 pnpm exec playwright test tests/e2e/canvas/font-long-text.spec.ts tests/e2e/export/pdf-text.spec.ts --grep 'long text remains|Export large text' --project=chromium --reporter=list
VARVE_DISABLE_HMR=1 VARVE_E2E_PORT=1486 VARVE_E2E_OUTPUT_DIR=font-frontend-long-text-current VARVE_E2E_WORKERS=1 pnpm exec playwright test tests/e2e/canvas/font-long-text.spec.ts tests/e2e/export/pdf-text.spec.ts --grep 'long text remains|Export large text' --project=chromium --reporter=list
VARVE_DISABLE_HMR=1 VARVE_E2E_PORT=1487 VARVE_E2E_OUTPUT_DIR=font-frontend-long-text-final VARVE_E2E_WORKERS=1 pnpm exec playwright test tests/e2e/canvas/font-long-text.spec.ts tests/e2e/export/pdf-text.spec.ts --grep-invert 'Export large text' --project=chromium --reporter=list
VARVE_DISABLE_HMR=1 VARVE_E2E_PORT=1488 VARVE_E2E_OUTPUT_DIR=font-frontend-clip-before VARVE_E2E_WORKERS=1 pnpm exec playwright test tests/e2e/canvas/font-long-text.spec.ts --project=chromium --reporter=list
VARVE_DISABLE_HMR=1 VARVE_E2E_PORT=1489 VARVE_E2E_OUTPUT_DIR=font-frontend-clip-after VARVE_E2E_WORKERS=1 pnpm exec playwright test tests/e2e/canvas/font-long-text.spec.ts tests/e2e/canvas/font-toolbar-history.spec.ts --project=chromium --reporter=list
pnpm audit:docs
pnpm audit:emoji
pnpm audit:tokens
```
