# Rich-range font preview — 2026-09-14

The focused Chromium workflow exercises the native text surface and the
portaled quick font picker rather than only a component harness. It verifies
that a family preview and commit are scoped to the active rich-text range.

```text
CI=1 VARVE_E2E_PORT=1827 VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 \
npx playwright test tests/e2e/canvas/typography-editing.spec.ts \
  --project=chromium --reporter=list --timeout=120000 --retries=0 \
  -g "font preview and commit stay scoped"
```

Result: **1 passed**. The test selects the first five characters in the native
editing textarea, previews `Fraunces Variable` through the portaled picker,
verifies that only that run changes, presses Escape to restore the exact
serialized runs, commits the same choice, and uses one undo to restore the
original. The existing typography workflow also passes its three Chromium
scenarios covering toolbar handoff, empty-text cancellation, and OpenType
redraw.

The proof is browser-local and does not certify native WebKitGTK, Windows
WebView2, or macOS WKWebView behavior. Those platform lanes remain tracked in
the acceptance matrix.
