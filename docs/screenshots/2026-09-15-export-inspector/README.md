# Export tab (Inspector) — visual evidence, 2026-09-15

Captured by `tests/e2e/inspector/export-tab.spec.ts` on the real editor with an
imported 1920×1280 CC0 photo fixture and drawn vector layers (Chromium,
1280×720 viewport unless stated).

| File | State | Notes |
| --- | --- | --- |
| `01-export-tab-default.png` | Export tab, photo selected, PNG 2x configuration added (scrolled to the configurations section) | Shows the canonical `real-life-architecture@2x.png` preview, the preflight warning, and the add-configuration controls |
| `02-multi-selection-note.png` | Two layers selected | The tab names the single object that will export and offers the batch route |
| `03-scale-error.png` | Custom scale `999999` | Primary action disabled with the bound in the message |
| `04-export-narrow-240.png` | Inspector at the 240px minimum | Label stacks above the control; the segmented group wraps; every format stays visible |
| `04b-narrow-before-container-query.png` | Same layout with the container query container disabled | Reproduces the pre-fix single-line row (the trailing formats run past the group's clipped edge). This is a CSS-equivalent reconstruction, not a screenshot of the old build |
| `05-code-tab.png` | Code sub-tab | Keyboard-focusable scroll region with the focus ring visible |
| `06-text-200.png` | 240px panel at a 200% root text size (simulated user text-size preference, not browser zoom) | Controls remain visible and operable |
| `07-svg-effects-parity.png` | SVG selected for an effect-bearing object | Saved SVG and copied markup both carry the rasterized fallback |
