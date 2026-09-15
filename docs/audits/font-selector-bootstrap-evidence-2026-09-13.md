# Font selector bootstrap evidence — 2026-09-13

This checkpoint records the Chromium visual validation after bounding the
portaled compact font selector before its viewport has a measured range. The
selector now mounts at most 120 estimated rows, retains the keyboard-active
option, and positions a retained option at its estimated list offset instead
of packing it after the first page.

## Reproducible run

```text
VARVE_E2E_PORT=1678 VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 VARVE_E2E_OUTPUT_DIR=font-toolbar-selector-20260913 npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts --project=chromium -g 'DPR 1' --reporter=list --timeout=180000
```

Result: **1 passed**. The run exercised the compact toolbar and contextual
bar at 1920, 1280, and 640 CSS pixels, light/dark/high-contrast themes, an
open family menu, keyboard filtering, Escape dismissal, and active-descendant
mounting. The existing geometry assertions measured a 32px control height,
2.88px gap, 5.76px vertical/9.44px horizontal padding, and a 46.796875px
desktop text surface.

## Inspected captures

The captures were opened and inspected for menu anchoring, readable family
names, viewport containment, control alignment, and contrast:

- [light open](../screenshots/fonts/2026-09-13-font-selector-bootstrap/light-open.png) — SHA-256 `d9f55f3f87e2080a1da5880085a1d2374113b7de9e0448df3f0c7ed13fb6a625`
- [dark narrow](../screenshots/fonts/2026-09-13-font-selector-bootstrap/dark-narrow.png) — SHA-256 `050d0e535c94a2932e157b99c718eeb86a8dc9a5e260b3b77fc39ea100ba1b26`
- [high contrast closed](../screenshots/fonts/2026-09-13-font-selector-bootstrap/high-contrast-closed.png) — SHA-256 `956e6b5663a8256b894500aa770fe9a281d62b02db98a235cb43460b325c81a3`

The narrow capture keeps the toolbar inside the viewport and exposes the
horizontal overflow affordance. The open capture keeps the list attached to
the family field without clipping the first or last visible row.
