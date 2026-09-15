# Isometric verification evidence — 2026-09-15

Real-editor captures from the independent verification pass. See
`docs/audits/isometric-grid-audit-2026-09-15.md` for findings and commands.

## Environment

| Field | Value |
| --- | --- |
| OS | Linux (CachyOS), Chromium via Playwright `--project=chromium` |
| Viewport | 1280 × 800 CSS px, device scale 1 |
| Build | Vite dev server (`@varve/desktop`), commit `master` working tree |
| Grid | True isometric preset, spacing 24, origin 0,0, rotation 0, Top/Front/Side planes |
| Commands | `VARVE_E2E_PORT=… npx playwright test tests/e2e/canvas/isometric-construction-workflow.spec.ts --project=chromium` |
| Platform caveat | Chromium only; Tauri/WebKitGTK and Chromebook hardware not available in this pass |

## Artifacts

| File | Scenario |
| --- | --- |
| `cube-face-front.png` | Front-plane face of the three-face cube (exact affine plane rectangle) |
| `cube-face-side.png` | Side-plane face sharing the vertical edge with the front face |
| `cube-face-top.png` | Top-plane face closing the cube; shared vertices coincide with the other two |
| `07-multi-move.png` | Two-object marquee selection moved by one common translation |
| `08-hidden-grid-roundtrip.png` | Grid hidden via its own switch, then restored; artwork unchanged through hide/undo/redo |
| `09-export-with-grid.png` | SVG export taken while the construction grid is on screen |
| `canvas-isometric-construction.png` | Website Canvas feature page, new isometric construction section (added after this pass; captured by the website E2E) |

The captures are not retouched. Assertions were made against the committed
document through the read-only `?isoTest=1` hook, not against pixels; the images
exist so a human can judge the projected geometry.
