# Tablet editing visual evidence — 2026-09-29

These captures document the tablet presentation and responsive regression work.
The `matrix-*.png` screens are browser-emulation evidence from Playwright's
Chromium 151.0.7922.34 on Linux (the emulated page reports a Windows Chrome
user agent), at DPR 1 unless a filename or JSON sidecar says otherwise. They
are not ChromeOS, Windows tablet, Android, or iPad certification.

The viewport matrix covers 960×600, both sides of the 899/900 CSS-pixel
breakpoint, 1024×640, 1025×640, both sides of the 1094/1095 header breakpoint,
1200×750, 1280×800, 600×960, 800×1280, 480×640 split view, and a 640×400
effective-viewport equivalent for 200% browser zoom. JSON sidecars record the
browser, user agent, DPR, viewport, canvas, toolbar, and hit-region geometry.
The 640×400 sample does not emulate actual browser zoom; browser zoom itself
needs separate installed-browser verification.

The matrix exercises layout reflow, canvas and toolbar bounds, panel launcher
targets, touch-modifier fit, and header collisions. The compact, fully visible
touch multi-select control is checked through the 1280 CSS-pixel tablet
breakpoint and at 480×640 split view. The workflow screenshot
`product-review/tablet-workspace-light.png` presents an actual poster document
in tablet layout, with the Inspector beside the canvas; it was visually
inspected and synced into the website product screenshot set.

Dark theme, high-contrast theme, reduced motion, keyboard/composition behavior,
storage failures, browser Back, and interruption/recovery have separate focused
regressions where available. Automated browser evidence cannot confirm stylus
pressure curves, palm rejection, physical keyboard attachment, floating OSK
behavior on every platform, pen/touch ordering in device firmware, or ARM64
Crostini performance. Those remain explicit physical-device handoff checks.
