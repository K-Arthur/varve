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

The chooser-only baseline run passed **1/1** in 1.3 minutes. The expanded
replacement/history workflow was then run against the existing Chromium editor
server at the same `master` HEAD:

```text
npx playwright test tests/e2e/canvas/document-fonts-panel.spec.ts \
  --config=/tmp/varve-existing-e2e.config.mjs --project=chromium \
  --reporter=list --timeout=180000 --retries=0
```

That run passed **1/1** in 34.9 seconds and performed a real bundled-face
replacement, verified one-step Undo and Redo, then confirmed the recorded
original-font Restore action. The run produced these inspected captures:

- `test-results/run-1843328-1833/canvas-document-fonts-pane-5b10a--in-a-narrow-dark-inspector-chromium/document-fonts-replacement-chooser.png`
- `test-results/run-1843328-1833/canvas-document-fonts-pane-5b10a--in-a-narrow-dark-inspector-chromium/document-fonts-narrow-dark.png`

The replacement chooser showed the exact selected family, preview specimen,
variable-axis control, source/license metadata, and the `Use face` path without
clipping. The narrow dark capture showed the page/document scope tabs, family
filter, exact-face usage card, `Go to`, `Select`, and `Replace` actions within
the viewport. The browser run now also proves the committed replacement is
history-safe and that Restore returns the original family. Native restart,
durable replacement recovery, and full linked-story navigation remain platform
or follow-up evidence.
