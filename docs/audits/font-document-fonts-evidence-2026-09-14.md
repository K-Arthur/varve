# Document Fonts browser evidence — 2026-09-14

The current Chromium workflow was exercised against the real editor surface. It
opened the Document fonts panel, created an area-text layer, entered the
replacement flow, opened the Browse fonts dialog, and captured the replacement
chooser. The same run then returned to the panel at a narrow viewport in dark
mode and captured the page-scoped usage card.

```text
CI=1 VARVE_E2E_PORT=1833 VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 \
npx playwright test tests/e2e/canvas/document-fonts-panel.spec.ts \
  --project=chromium --reporter=list --timeout=180000 --retries=0
```

Result: **1 passed** in 1.3 minutes. The run produced these inspected captures:

- `test-results/run-1843328-1833/canvas-document-fonts-pane-5b10a--in-a-narrow-dark-inspector-chromium/document-fonts-replacement-chooser.png`
- `test-results/run-1843328-1833/canvas-document-fonts-pane-5b10a--in-a-narrow-dark-inspector-chromium/document-fonts-narrow-dark.png`

The replacement chooser showed the exact selected family, preview specimen,
variable-axis control, source/license metadata, and the `Use face` path without
clipping. The narrow dark capture showed the page/document scope tabs, family
filter, exact-face usage card, `Go to`, `Select`, and `Replace` actions within
the viewport. This validates the current browser presentation and entry point;
native restart, durable replacement recovery, and full linked-story navigation
remain platform or follow-up evidence.
