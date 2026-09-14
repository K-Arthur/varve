# Font readiness and geometry oracle — 2026-09-14

## Command

```text
CI=1 VARVE_E2E_PORT=1831 VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 \
npx playwright test tests/e2e/canvas/font-geometry-oracle.spec.ts \
  --project=chromium --reporter=list --timeout=180000 --retries=0
```

## Result

The run passed **5/5** tests in 2.4 minutes:

- a newly usable face schedules an authoritative `font-load` redraw without
  pointer or keyboard input, and selecting the text afterwards does not change
  glyph pixels;
- a multi-line selection rectangle encloses every painted line;
- the last line remains clickable;
- the selection box grows while a newline is entered; and
- resizing area text changes the container while preserving the authored type
  size.

The inspected captures were `01-before-font-event.png`, `03-after-selection.png`,
`multiline-ink.png`, and `multiline-selection.png` under
`test-results/run-1825841-1831/`. The readiness pair has identical content
pixels before and after selection, and the multi-line capture shows all three
lines inside the selection bounds. The compact toolbar remains aligned with
the existing editor controls in the same captures.

This proves browser readiness notifications and main-thread geometry behavior.
It does not certify real-byte main/worker pixel identity, collection-member
selection, native WebKitGTK, Windows WebView2, or macOS WKWebView behavior.
