# Font toolbar geometry evidence — 2026-09-13

This checkpoint records the final Chromium visual check for the compact text
toolbar, contextual typography bar, and primary floating palette after the
shared spacing-token repair. It is a Linux Chromium observation; embedded
Tauri/WebKitGTK and Windows/macOS native lanes still need their platform runs.

## Reproducible run

The run was collected from `master` at `24fb3e827`:

```text
VARVE_E2E_PORT=1672 VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 VARVE_E2E_OUTPUT_DIR=font-toolbar-context-20260913 npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts --project=chromium -g 'DPR 1' --reporter=json --timeout=120000
```

Result: **1 passed**. The flow exercised light, dark, and high-contrast themes,
1920/1280/640 CSS-pixel widths, closed/open/narrow picker states, keyboard
filtering, active-descendant mounting, menu containment, and contextual-bar
geometry.

## Measured contract

At the 1280px checkpoint the contextual and floating text bars both measured
46.796875px high. Each text surface used a 2.88px gap, 5.76px vertical and
9.44px horizontal padding, 32px controls on one centerline, and 14.72px
interface text. The contextual family field measured 217.59375px wide, while
its weight and size controls measured 72px and 44px. The text bar remained
`overflow-x: auto` with `flex-wrap: nowrap`, so narrow workspaces preserve
access to every control instead of clipping or wrapping the family field.

The wider 1920px checkpoint grows fluidly to the palette's 50px surface while
preserving the same shared tokens. At 640px the row scrolls within the
viewport. The final screenshots were inspected for clipping, contrast, readable
family text, and alignment:

- [light closed](../screenshots/fonts/2026-09-13-toolbar-geometry/light-closed.png) — SHA-256 `816d87cba6ec89182a1955fe360870eaf029996e04741328d1693845c24dee0e`
- [dark narrow](../screenshots/fonts/2026-09-13-toolbar-geometry/dark-narrow.png) — SHA-256 `050d0e535c94a2932e157b99c718eeb86a8dc9a5e260b3b77fc39ea100ba1b26`
- [high contrast closed](../screenshots/fonts/2026-09-13-toolbar-geometry/high-contrast-closed.png) — SHA-256 `956e6b5663a8256b894500aa770fe9a281d62b02db98a235cb43460b325c81a3`

The repair is implemented in the shared `--space-toolbar` and
`--space-toolbar-item` contract used by the contextual bar, floating text bar,
selection quick bar, and primary floating palette. The visual test compares
surface chrome, control dimensions, type scale, viewport bounds, and active
option mounting, rather than relying on screenshot similarity alone.
