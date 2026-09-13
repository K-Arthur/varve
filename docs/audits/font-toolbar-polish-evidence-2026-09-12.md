# Font toolbar polish evidence — 2026-09-12

This entry records a follow-up visual audit of the quick typography surfaces on
`master`. It addresses the remaining density mismatch between the floating text
bar, the main canvas palette, and the contextual properties bar.

The implementation is committed as
[`f8499d236466a75396787325b310a14696abf19d`](https://github.com/K-Arthur/varve/commit/f8499d236466a75396787325b310a14696abf19d).
The validation below was run from the same working tree before that commit;
later `master` commits were concurrent, unrelated work.

## Changes

- The floating text bar now derives its minimum height from its 32px compact
  control plus the shared toolbar padding and border. It no longer grows with
  the fluid global toolbar-height token at wide desktop sizes.
- The floating text bar keeps one row and uses the same bounded horizontal
  scroll behavior as the main palette on constrained widths. Wrapping could
  split the family, weight, and size controls onto different centerlines.
- Separators no longer add margin on top of the flex gap. This removes the
  doubled spacing around groups in both the floating bar and contextual bar.
- The family field uses one responsive width rule in both compact surfaces:
  180px minimum, 220px maximum. Weight, size, button, and field typography
  continue to use the shared compact tokens.
- Main palette buttons and the contextual bar now use token-backed compact
  control dimensions, expanding to the touch target on coarse pointers.
- The visual oracle checks overflow mode, no-wrap behavior, matching control
  typography, matching gaps, wide desktop geometry, narrow containment, and
  32px control centerlines.

## Validation

Focused deterministic checks passed after the change:

```text
pnpm exec vitest run packages/editor/src/components/FloatingTextBar/FloatingTextBar.test.tsx packages/editor/src/components/ContextControlBar/ContextControlBar.test.tsx packages/editor/src/components/FontBrowser/DocumentFontsPanel.test.tsx packages/editor/src/components/FontBrowser/documentFontUsage.test.ts packages/editor/src/components/Typography/fontWeight.test.ts --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
./node_modules/.bin/biome check packages/editor/src/components/FloatingTextBar/FloatingTextBar.css packages/editor/src/components/FloatingToolbar/FloatingToolbar.css packages/editor/src/components/ContextControlBar/ContextControlBar.css packages/editor/src/components/ContextControlBar/ContextControlBar.tsx packages/editor/src/components/FontBrowser/FontSelector.css packages/editor/src/components/Inspector/PropertiesPanel.tsx tests/e2e/canvas/font-toolbar-visual.spec.ts
```

The focused component run passed **41/41**. The touched-file Biome check passed.

A Chromium run on port 1597 reached a healthy editor and produced an inspected
capture at
`test-results/font-toolbar-polish-1597/canvas-font-toolbar-visual-76f26-adable-menus-in-every-theme-chromium/test-failed-1.png`.
The image shows the new contextual text bar with the family, weight, and size
controls on one centerline and the 180px-plus family field. The run exposed a
cold-canvas state transition in the test: text creation selected the layer but
did not enter text editing, so the floating bar was not present. The visual
helper now invokes the explicit **Edit text** action before measuring it.

A retry on port 1598 was stopped by a Chromium target crash during global setup
while other local E2E jobs were consuming the host. It is retained as an
environment limitation, not a passing visual claim. The prior inspected
three-theme/DPR captures remain linked in
[`font-frontend-evidence-2026-09-12.md`](./font-frontend-evidence-2026-09-12.md)
and [`font-toolbar-evidence-2026-09-10.md`](./font-toolbar-evidence-2026-09-10.md).

The website typography workflow was then run against both supported deployment
roots. The GH Pages and custom-domain projects each passed 7/7 checks across
desktop light/dark and narrow dark layouts, including screenshot capture,
decoded image checks, overflow checks, and FAQ structured-data assertions:

```text
VARVE_WEBSITE_E2E_PORT=4325 VARVE_WEBSITE_E2E_PORT_ROOT=4326 pnpm exec playwright test -c playwright.website.config.ts apps/website/tests/e2e/typography-workflow.spec.ts --project=ghpages --reporter=list
VARVE_WEBSITE_E2E_PORT=4325 VARVE_WEBSITE_E2E_PORT_ROOT=4326 pnpm exec playwright test -c playwright.website.config.ts apps/website/tests/e2e/typography-workflow.spec.ts --project=custom-domain --reporter=list
```

Fresh Chromium attempts on ports 1610 and 1617 still could not reach the
editor-only toolbar: the first returned to the Home document grid after startup
and the second displayed the repeated-crash safe-mode screen. Their inspected
captures are retained under `test-results/font-toolbar-polish-1610/` and
`test-results/font-toolbar-polish-1617/`; neither is counted as a passing app
visual run. The canvas specs now wait for the toolbar and reopen the newest
document card when the storage hand-off briefly returns to Home, so a future
quiet run will fail quickly with a startup diagnosis rather than spending the
full test timeout on an editor-only locator.

## Open visual/platform work

A quiet Chromium run must exercise the updated floating bar through the explicit
Edit text path and inspect the resulting wide, narrow, dark, and high-contrast
captures. Linux Tauri/WebKitGTK, Windows WebView2, and macOS WKWebView still
need their platform-specific typography runs. Exact-face readiness, rich-range
commands, worker parity, export preflight, and transformed image-region
identification remain outside this polish slice.
