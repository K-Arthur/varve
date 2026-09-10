# Font inspector and website evidence — 2026-09-10

This continues the [toolbar evidence](./font-toolbar-evidence-2026-09-10.md)
and [24-scenario acceptance matrix](./font-acceptance-matrix-2026-09-09.md).
It records a bounded improvement, not completion of the font program.

## Changes and evidence ownership

The toolbar density and overlay repair landed in `e4508d4e7`. Rich-run style
preservation and stale current-schema test expectations landed in `747d120d4`.
Validation used the shared working tree based on `40f330b26`, with concurrent
commits advancing HEAD through `11b00e1e6`. Captures are working-tree observations,
not certification of a frozen commit. Their original paths and byte hashes are
in the [capture manifest](../screenshots/fonts/2026-09-10-integration/manifest.json).

The typography inspector previously nested a labelled family picker inside a
second Font label, squeezed the Browse button onto another line, clipped paired
spacing labels, and inherited a grid rule that could split alignment options
into two rows. It now uses one full-width family field and a matching 32px Browse
button, separate numeric rows for line height and letter spacing, and a scoped
single-row alignment group. Long labels wrap at the 240px panel minimum. Shared
inspector styles and concurrently edited sections were preserved.

The new real-browser test resizes the inspector using its actual separator,
checks field width, vertical alignment, label overflow and segmented-control
rows, and captures both the family and alignment portions in Light, Dark and
High Contrast. All 12 final inspector captures were inspected. The adjacent
Layer Effects heading overlaps its controls at minimum width in concurrent
work; these captures do not certify that unrelated section.

| Evidence | Before | After |
| --- | --- | --- |
| Product inspector | [previous committed asset](../screenshots/fonts/2026-09-10-integration/before-inspector-product.png) | [current product capture](../screenshots/product/typography-panel-light.png) |
| Minimum inspector | Historical asset above is not a fresh same-viewport baseline | [Light](../screenshots/fonts/2026-09-10-integration/inspector-light-minimum.png), [Dark](../screenshots/fonts/2026-09-10-integration/inspector-dark-minimum.png), [High Contrast](../screenshots/fonts/2026-09-10-integration/inspector-high-contrast-minimum.png) |
| Alignment row | Previous two-row layout found during capture | [minimum width](../screenshots/fonts/2026-09-10-integration/inspector-light-minimum-alignment.png) |
| Toolbar | See the prior toolbar evidence log | [open picker](../screenshots/product/font-toolbar-light.png) |
| Browser | No prior product scene | [family specimen and details](../screenshots/product/font-browser-light.png) |
| Website guide | Prior implementation-heavy introduction | [Light](../screenshots/fonts/2026-09-10-integration/guide-light-intro.png), [Dark](../screenshots/fonts/2026-09-10-integration/guide-dark-intro.png), [narrow](../screenshots/fonts/2026-09-10-integration/guide-narrow-intro.png) |
| Website scenes | No previous toolbar/browser figures | [desktop](../screenshots/fonts/2026-09-10-integration/feature-light-browser-scene.png), [dark](../screenshots/fonts/2026-09-10-integration/feature-dark-toolbar-scene.png), [narrow](../screenshots/fonts/2026-09-10-integration/feature-narrow-browser-scene.png) |

## Website and capture corrections

Typography help and FAQ structured data now distinguish matching family/style
metadata from exact file identity. They describe the current object-level
controls, Rich Text range editing, explicit desktop installation, unknown
license metadata, and pending browser-permission, collection-member, Document
Fonts, Select by Font and image-crop workflows. They no longer promise hover
preview restoration, exact specimens or guaranteed restoration on restart.

The capture pipeline adds `font-toolbar` and `font-browser` scenes. Its new
review directory keeps trial captures out of the published manifest. Explicit
reviewed sync verifies SHA-256 before copying only named scenes; a before/after
comparison confirmed all unrelated manifest entries were unchanged. The
specimen's unsupported 800 weight was corrected to 700, and deterministic
fixtures now serialize the current document version. No unrelated visual
baseline was updated.

The first capture attempts exposed a closed toolbar menu, clipped unit labels,
and a lingering onboarding hint. Those were rejected and repaired. Four final
product captures were inspected before sync. Website captures cover both `/`
and `/varve`, desktop Light/Dark and a 390px Dark viewport. Sixteen of 18 paired
website captures are byte-identical across base paths; the two different pairs
show an adjacent lazy image before/after decode, not different text or layout.
Both variants were inspected and retained. Dedicated scene captures wait for
image decoding and show both images successfully rendered.

## Commands and outcomes

Commands run from the repository root (temporary indexes contain only named
font paths and never replace the shared index):

```sh
GIT_INDEX_FILE=/tmp/varve-font-range-v2.index pnpm verify:plan --staged
GIT_INDEX_FILE=/tmp/varve-font-range-v2.index pnpm verify:affected --staged
GIT_INDEX_FILE=/tmp/varve-font-inspector.index pnpm verify:plan --staged
GIT_INDEX_FILE=/tmp/varve-font-inspector.index VARVE_E2E_PORT=1613 VARVE_TEST_WORKERS=2 pnpm verify:affected --staged
GIT_INDEX_FILE=/tmp/varve-font-website.index pnpm verify:plan --staged
GIT_INDEX_FILE=/tmp/varve-font-website.index VARVE_WEBSITE_E2E_PORT=4351 VARVE_WEBSITE_E2E_PORT_ROOT=4352 pnpm verify:affected --staged
GIT_INDEX_FILE=/tmp/varve-font-range-v3.index pnpm verify:plan --staged
GIT_INDEX_FILE=/tmp/varve-font-range-v3.index pnpm verify:quick --staged
TMPDIR="$PWD/reports/font-browser-tmp" VARVE_E2E_PORT=1618 pnpm exec playwright test tests/e2e/inspector/typography-layout.spec.ts tests/e2e/canvas/typography-editing.spec.ts --project=chromium --workers=1 --reporter=list
TMPDIR="$PWD/reports/font-browser-tmp" VARVE_E2E_PORT=1619 pnpm exec playwright test tests/e2e/inspector/typography-layout.spec.ts --project=chromium --workers=1 --reporter=list
TMPDIR="$PWD/reports/font-browser-tmp" VARVE_SHOT_PORT=1615 pnpm screenshots:product -- --scenes typography,typography-panel,font-toolbar,font-browser --strict --review-dir reports/font-capture-review
pnpm screenshots:product -- --scenes typography,typography-panel,font-toolbar,font-browser --review-dir reports/font-capture-review --sync-reviewed
pnpm --filter @varve/website build
pnpm --filter @varve/website build:pages
TMPDIR="$PWD/reports/font-browser-tmp" VARVE_WEBSITE_E2E_PORT=4355 VARVE_WEBSITE_E2E_PORT_ROOT=4356 pnpm exec playwright test -c playwright.website.config.ts apps/website/tests/e2e/typography-workflow.spec.ts apps/website/tests/e2e/font-provider-marketing.spec.ts --workers=2 --output=reports/font-website-final
TMPDIR="$PWD/reports/font-browser-tmp" VARVE_WEBSITE_E2E_PORT=4357 VARVE_WEBSITE_E2E_PORT_ROOT=4358 pnpm exec playwright test -c playwright.website.config.ts --workers=2 --max-failures=5 --output=reports/font-website-triage
VARVE_TEST_WORKERS=2 pnpm exec vitest run apps/website
GIT_INDEX_FILE=/tmp/varve-font-ui-website-final.index pnpm verify:plan --staged
GIT_INDEX_FILE=/tmp/varve-font-ui-website-final.index pnpm verify:quick --staged
TMPDIR="$PWD/reports/font-browser-tmp" VARVE_WEBSITE_E2E_PORT=4363 VARVE_WEBSITE_E2E_PORT_ROOT=4364 pnpm exec playwright test -c playwright.website.config.ts apps/website/tests/e2e/visual.spec.ts --project=ghpages --grep "typography" --workers=1 --output=reports/font-website-typography-final
pnpm audit:docs
pnpm audit:emoji
pnpm audit:tokens
node scripts/audit-architecture.mjs --ci
```

The range dependency run passed 2,873 scene tests and the scene type check;
AI, CLI, codegen and collaboration checks passed. The editor lane passed 6,638
tests with one existing skip and one ShortcutPalette timeout. That exact file
passed all 18 tests on rerun. Remaining editor/history/home/import/layout/print/
prototype/UI/desktop type checks and tests passed. The exact resumed commands
are listed below; green broad lanes were retained rather than restarted.

Initial inspector runs failed in server startup/global setup, before test
execution. The final combined quick check passed touched checks, docs/emoji,
E2E typechecking and five inspector component tests, then found port 1420
occupied; the independent passing run on 1619 supplies that browser lane. The focused run on 1618 passed all three tests; the final capture run
on 1619 passed its one test. Initial website focused tests passed 16 and timed
out twice while decoding lazy offscreen images; setting those images eager in
the test fixed the wait. The final focused website run passed 18/18. Both website
builds produced 84 routes. The final capture command passed four scenes with
zero skips. The schema fixture and screenshot-manifest regressions were repaired.

Website unit results are 190 passed, two failed: raw illustration colors in
`features/canvas.astro` and `docs/tools/grids.astro`, and undefined `--font-ui` /
`--surface-raised` tokens in those pages and `features/auto-layout.astro`. All
three files matched HEAD byte-for-byte when classified. They remain open
website baseline failures, not typography regressions. The bounded broad website run finished with 215 passed, five failed, one
interrupted and 235 not run after the five-failure stop. Four failures are
unrelated image baselines (background removal, two generative-editing pages,
and home); the fifth is the existing `/releases` robots policy (`noindex,
nofollow` versus a test expecting `index, follow`). Typography focused checks
passed independently. No unrelated snapshot was accepted to hide those
failures. The remaining broad website lane remains incomplete. The task-owned typography
visual test was then run separately: it first timed out on below-fold lazy
images, which its test now explicitly loads. The resulting full-page diff was
inspected, and only its typography baseline was accepted; its exact rerun passed. The shared snapshot
already had typography changes at the start of this continuation; its pre-sync
bytes were retained locally in `/tmp/varve-font-typography-snapshot-before.png`.
No other baseline was changed.

## Remaining acceptance and budgets

This scope verifies inspector layout and the documented compact toolbar, not
real-face selection, range/caret command routing, hover preview, migration,
worker shaping parity, image identification or the original 24 scenarios.
The manager's 1k/10k warm p95 budgets (open 150ms, search 100ms, preview 150ms)
have not been measured. No render-dispatch code changed. The toolbar's measured
32px controls and 46.796875px outer height remain recorded in its separate log.

Linux Tauri/WebKitGTK font workflow evidence is pending the font-specific WDIO
implementation. Windows WebView2 and macOS WKWebView remain owned by their native
CI/manual environments; their next check is the same permission/import,
restart and exact-face recovery workflow after the native integration lands.
The full gate for the earlier schema/foundational work remains required.

## Agent Validation Report

```text
Changed scope: scene rich-run operations and current-version test expectations; editor typography inspector; typography website/help/FAQ; product captures and capture review workflow; font docs and evidence.
Validation plan: affected scene consumer closure, editor/desktop checks, direct typography E2E, website unit/type/E2E, touched-file checks and docs/emoji audits. No new full-suite escalation for this slice.
Commands actually run: exact commands above and resumed dependency commands below.
Passed: scene and affected consumer tests/types through desktop; focused editor 3/3 plus final inspector 1/1; focused website 18/18; both 84-route builds; four reviewed product scenes; docs/emoji/token/architecture audits.
Skipped as unrelated: full Cargo workspace, full app Playwright, global rendering benchmarks; this slice changes no native or render-dispatch code.
Escalations: local server/browser execution required sandbox network permission; website baseline failures remain recorded; earlier font schema integration still requires a full final gate.
Full suite run: no
If yes, reason: not applicable
```

## Resumed dependency commands

Run with `VARVE_TEST_WORKERS=2`:

```sh
pnpm exec vitest run packages/editor/src/shortcuts/ShortcutPalette.test.tsx
pnpm --filter @varve/editor typecheck
pnpm exec vitest run packages/history
pnpm --filter @varve/history typecheck
pnpm exec vitest run packages/home
pnpm --filter @varve/home typecheck
pnpm exec vitest run packages/import
pnpm --filter @varve/import typecheck
pnpm exec vitest run packages/layout
pnpm --filter @varve/layout typecheck
pnpm exec vitest run packages/print
pnpm --filter @varve/print typecheck
pnpm exec vitest run packages/prototype
pnpm --filter @varve/prototype typecheck
pnpm exec vitest run packages/ui
pnpm --filter @varve/ui typecheck
pnpm exec vitest run apps/desktop
pnpm --filter @varve/desktop typecheck
pnpm exec vitest run apps/website
pnpm --filter @varve/website typecheck
```
