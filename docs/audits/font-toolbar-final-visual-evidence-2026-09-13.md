# Font toolbar final visual evidence — 2026-09-13

The current `master` tree passed the focused Chromium visual spec for the quick
font toolbar after the spacing, control-height, font-selector focus, and
face-capability fixes. The run covered light, dark, and high-contrast themes,
closed/open/narrow states, 1920/1280/640 CSS-pixel widths, menu viewport
containment, keyboard search/focus restoration, and parity with the main floating
palette and contextual text bar.

Command:

```text
CI=1 TMPDIR=/home/kevina/varve-tmp VARVE_E2E_PORT=1701 VARVE_E2E_WORKERS=1 \
VARVE_DISABLE_HMR=1 VARVE_E2E_OUTPUT_DIR=font-toolbar-final-20260913 \
npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts \
--project=chromium -g 'DPR 1' --reporter=list --timeout=180000

1 passed (3.0m)
```

The inspected captures are in [`docs/screenshots/fonts/2026-09-13-toolbar-final`](../screenshots/fonts/2026-09-13-toolbar-final/README.md).
The measured surface is 46.796875 CSS px high with 32px controls, a 2.88px
item gap, 5.76px / 9.44px padding, and 14.72px control text. The floating and
contextual bars share the same centerline and field typography; the family menu
stays inside the viewport at the narrow width. The high-contrast capture keeps
focus rings and menu borders visible without clipping.

This is browser evidence for geometry and interaction. It does not certify
native WebKitGTK, WebView2, or WKWebView until those platform runs are available.
