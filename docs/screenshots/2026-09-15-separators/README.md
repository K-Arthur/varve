# Separator system evidence — 2026-09-15

Reviewed render captures from `tests/e2e/theme/separators.spec.ts`
(`npx playwright test tests/e2e/theme/separators.spec.ts --project=chromium`).

| File | What it shows | Judgment |
|---|---|---|
| `forced-colors-gallery-light.png` | Shared `Separator` variants, menu separator, and a border-token rule under `forced-colors: active` (light system palette) | All six channels paint a visible rule against the canvas; the gradient `fade` variant falls back to a solid system-color line |
| `forced-colors-gallery-dark.png` | Same gallery, dark system palette | Visible; the `accent` tone maps to the `Highlight` system color |
| `forced-colors-gallery-high-contrast-theme.png` | Same gallery with the app's own `data-theme="high-contrast"` under `forced-colors: active` | Visible; the app high-contrast palette can no longer swallow separator backgrounds |
| `file-menu-light.png`, `file-menu-dark.png`, `file-menu-high-contrast.png` | Real editor, File menu open, normal rendering | Menu separators present and legible in all three shipped themes |
| `file-menu-light-forced-colors.png` | Real editor, File menu open, `forced-colors: active` | Separators remain visible (previously they computed to the canvas color and disappeared) |

Reproduce the captures into the Playwright output directory with the spec's
screenshot assertions; the reviewed copies above were copied from
`test-results/<run>/`.

Limitation: Playwright's `forcedColors` emulation uses the browser's forced
palette pair (light/dark via `colorScheme`); it does not reproduce every
Windows Contrast Theme variant. The assertions compare each painted channel
against the mode's canvas color, so a theme that maps `CanvasText` and
`Canvas` differently still fails the spec if the rule becomes invisible.
