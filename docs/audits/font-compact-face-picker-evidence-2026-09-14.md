# Compact face picker evidence — 2026-09-14

## Scope

The compact `FontSelector` previously exposed only family rows. A family-level
change could therefore clear an exact collection member or same-family artifact
even when the requested face was already registered. This checkpoint adds a
local registry-backed expansion row to the compact picker and routes the exact
selection through the floating text bar, contextual bar, inspector, and Logo
wordmark controls.

The expansion is deliberately metadata-only. It reads registered faces and
named `fvar` instances; it does not enumerate the operating system, download a
provider artifact, or make hover/search network requests.

## Implementation evidence

- `fontFaceSelection.ts` is the shared face-selection contract. It carries the
  family, weight, style, PostScript name, portable `sha256:<digest>:<member>`
  reference, named-instance label, and authored variation coordinates.
- Compact family rows show an expand/collapse control only when more than one
  registered face is available. Face rows are indented, keyboard-safe listbox
  options and are virtualized with the family rows.
- Expanding a family at the menu's lower edge scrolls the first face into the
  visible portaled viewport. Named instances are distinguished by their axes
  when marking the current exact selection.
- Selecting a face closes the picker, restores input focus, and sends one
  exact selection to each typography command surface. Family-only selection
  keeps the existing compatibility behavior and clears stale identity through
  `fontFamilyChanges`.

## Commands and results

```text
./node_modules/.bin/biome check --write \
  packages/editor/src/components/FontBrowser/fontFaceSelection.ts \
  packages/editor/src/components/FontBrowser/FontBrowser.tsx \
  packages/editor/src/components/FontBrowser/FontSelector.tsx \
  packages/editor/src/components/FontBrowser/FontSelector.css \
  packages/editor/src/components/FontBrowser/FontSelector.test.tsx \
  packages/editor/src/components/FloatingTextBar/FloatingTextBar.tsx \
  packages/editor/src/components/ContextControlBar/ContextControlBar.tsx \
  packages/editor/src/components/Inspector/sections/TypographySection.tsx \
  packages/editor/src/components/LogoPanel/LogoTypographySection.tsx \
  tests/e2e/canvas/font-toolbar-visual.spec.ts
# passed

CI=1 TMPDIR=/home/kevina/varve-tmp \
  ./node_modules/.bin/vitest run --maxWorkers=1 \
  packages/editor/src/components/FontBrowser/FontSelector.test.tsx \
  packages/editor/src/components/FloatingTextBar/FloatingTextBar.test.tsx \
  packages/editor/src/components/ContextControlBar/ContextControlBar.test.tsx \
  --reporter=dot
# 3 files, 49 tests passed

CI=1 TMPDIR=/home/kevina/varve-tmp VARVE_E2E_PORT=1740 \
  VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 \
  VARVE_E2E_OUTPUT_DIR=font-toolbar-face-picker-scroll-20260914 \
  npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts \
  --project=chromium --grep 'DPR 1' --reporter=list --timeout=180000
# 1 test passed; light, dark, and high-contrast face-expansion captures written
```

The focused editor typecheck still reports the repository's existing unrelated
diagnostics (Menubar menu state, input pipeline point mutability, wheel
classifier narrowing, import results, layout variants, snapping, and test
fixtures). It reports no error in the compact picker or its four consumers.

## Inspected visual evidence

The inspected captures are under
`test-results/font-toolbar-face-picker-scroll-20260914/`:

- `light-faces-open.png`
- `dark-faces-open.png`
- `high-contrast-faces-open.png`

At 1280×800 CSS pixels the menu remains inside the viewport after expansion;
the first registered faces (400, 500, 600, 700 for IBM Plex Sans Variable) are
visible below the selected family. The controls stay on the same 32px centerline
as the contextual bar and the main floating palette. Dark and high-contrast
captures preserve readable selected/hover states and the expansion chevron.

## Limits

This evidence covers Chromium at DPR 1. DPR 2 and DPR 3 remain part of the
existing visual matrix; headless Chromium's DPR 3 run is still a platform
crash limitation. Native WebKitGTK, WebView2, and WKWebView face rendering
remain pending platform runs. The compact face rows do not install missing
artifacts; installation remains an explicit full-browser operation.
