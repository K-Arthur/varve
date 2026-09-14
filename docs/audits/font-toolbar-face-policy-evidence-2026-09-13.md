# Font toolbar face-policy evidence — 2026-09-13

The quick text toolbar and full typography inspector now treat Italic as a
real-face capability. It stays disabled for a regular-only family, moves to a
same-artifact italic sibling when one exists, and recognizes a declared
variable `ital` axis only on the selected face/member. A selected italic face
remains actionable so the user can return to regular. Exact static faces also
ignore stale authored `wght`/`ital` values, so old metadata cannot make a
non-variable face appear variable. The change prevents an apparently
successful click from creating an unsupported synthetic style or selecting
another file that merely shares the family name. Both surfaces retain the
recovery reason in a native title affordance; the inspector also skips the
unavailable option during keyboard roving focus.

Focused tests:

```text
./node_modules/.bin/vitest run packages/editor/src/components/Typography/fontWeight.test.ts --config vitest.config.ts --reporter=dot
  1 file, 24 tests passed

./node_modules/.bin/vitest run packages/editor/src/components/FloatingTextBar/FloatingTextBar.test.tsx --config vitest.config.ts --reporter=dot
  1 file, 34 tests passed

./node_modules/.bin/vitest run packages/editor/src/components/Inspector/controls/controls.test.tsx packages/editor/src/components/Inspector/sections/__tests__/TypographySection.test.tsx --config vitest.config.ts --reporter=dot
  2 files, 15 tests passed
```

The follow-up identity audit adds six collision and stale-metadata regressions:
a variable axis from a different same-family artifact or collection member,
or stale authored axis values on an exact static face, cannot affect the
selected face's weight or style controls. The font-policy suite now passes 24
assertions in total.

The test environment was space constrained under `/tmp`; the successful runs
used `TMPDIR=/home/kevina/varve-tmp`. The first combined attempt failed while
Vite wrote a transform cache (`ENOSPC`) before any assertion ran.

The fresh Chromium run now passes against the current `master` tree with the
task-local temporary directory:

```text
CI=1 TMPDIR=/home/kevina/varve-tmp VARVE_E2E_PORT=1701 VARVE_E2E_WORKERS=1 \
  VARVE_DISABLE_HMR=1 VARVE_E2E_OUTPUT_DIR=font-toolbar-final-20260913 \
  npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts \
  --project=chromium -g 'DPR 1' --reporter=list --timeout=180000

1 passed (3.0m)
```

The inspected light, dark, high-contrast, closed/open, and narrow captures are
archived in the [final toolbar evidence set](../screenshots/fonts/2026-09-13-toolbar-final/README.md).
The browser assertion verifies 32px controls, one centerline, shared palette
spacing and typography, and viewport-contained menus. Native WebKitGTK,
WebView2, and WKWebView face-specific runs remain platform work.
