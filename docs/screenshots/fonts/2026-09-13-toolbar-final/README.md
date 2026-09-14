# Font toolbar final visual evidence — 2026-09-13

This capture set is the post-fix browser evidence for the compact font toolbar and
contextual text controls. It covers light, dark, and high-contrast themes in closed,
open-menu, and narrow (640 CSS px) states. The Playwright run also exercised 1920 and
1280 CSS px widths, checked menu and toolbar viewport containment, and compared the
floating toolbar against the main palette and contextual bar.

The measured toolbar is 46.796875 CSS px tall with 32px controls, 2.88px item gaps,
5.76px / 9.44px vertical and horizontal padding, and 14.72px control text. All
controls share one centerline and the menu remains contained at the narrow width.
The exact command, commit, and machine-readable metrics are in `manifest.json`.
