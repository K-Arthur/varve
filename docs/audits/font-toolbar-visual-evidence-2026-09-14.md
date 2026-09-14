# Quick font toolbar visual evidence — 2026-09-14

The typography toolbar was re-run after the exact-face/render-boundary work.
This is a fresh browser capture and supersedes neither the earlier diagnosis
nor the platform-pending claims in the acceptance matrix.

## Command

```text
CI=1 TMPDIR=/home/kevina/varve-tmp VARVE_E2E_PORT=1727 VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 VARVE_E2E_OUTPUT_DIR=font-toolbar-final-20260914 npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts --project=chromium --reporter=list --timeout=180000
```

Result: **3 passed** (DPR 1, 2, and 3) in 2.5 minutes.

## Measurements

The run measured the quick bar against the shared floating palette in light,
dark, and high-contrast themes:

- palette and toolbar height: `46.796875px`
- control height: `32px` for every family, weight, style, size, colour, and
  overflow control
- vertical centres: identical for all controls
- gap: `2.88px`
- padding: `5.76px 9.44px`
- field text: `14.72px` in all measured fields
- layout: `overflow-x: auto`, `flex-wrap: nowrap`
- menu and toolbar bounds stayed inside the viewport at the narrow capture

## Inspected states

I inspected the generated light open-menu, dark closed, high-contrast expanded
variable-face, and dark narrow screenshots. The menu remains attached to the
family control, expanded variable weights remain readable, high-contrast focus
and selection states remain visible, and the narrow menu is clipped to the
viewport rather than the page. The generated artifacts are under
`test-results/font-toolbar-final-20260914/` for the run above.

The run proves the browser geometry and interaction contract. It does not prove
native WebKitGTK, Windows WebView2, or macOS WKWebView rendering.
