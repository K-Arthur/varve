# Component-instance font usage evidence — 2026-09-14

Document Fonts now resolves component instance children through the same
effective variant projection used by the scene renderer. A text layer hidden by
a boolean variant is omitted from usage rows. A visible instance keeps the
authored child id, effective text, and page/canvas location, so Select, Go to,
and scoped replacement can still address the editable instance.

## Focused checks

The implementation and scene projection checks passed:

```text
./node_modules/.bin/biome check \
  packages/editor/src/components/FontBrowser/documentFontUsage.ts \
  packages/editor/src/components/FontBrowser/documentFontUsage.test.ts

CI=1 TMPDIR=/home/kevina/varve-tmp ./node_modules/.bin/vitest run \
  --maxWorkers=1 \
  packages/editor/src/components/FontBrowser/documentFontUsage.test.ts \
  packages/scene/src/variant-apply.test.ts --reporter=dot
```

Result: Biome passed; 2 files and 6 tests passed. The editor test covers a
hidden component variant and the visible effective instance projection. The
scene test covers the underlying variant cache behavior.

## Browser and visual evidence

The real Document Fonts workflow passed in Linux Chromium:

```text
CI=1 TMPDIR=/home/kevina/varve-tmp VARVE_E2E_PORT=1737 \
VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 \
VARVE_E2E_OUTPUT_DIR=font-document-fonts-component-20260914 \
npx playwright test tests/e2e/canvas/document-fonts-panel.spec.ts \
  --project=chromium --reporter=list --timeout=180000
```

Result: 1 test passed. I inspected both generated captures:

- `test-results/font-document-fonts-component-20260914/` — the narrow dark
  560×760 panel keeps the page/document scope tabs, usage row, and action
  buttons inside the viewport;
- the replacement chooser capture at 1280×720 keeps the search field,
  virtualized family list, selected-family preview, and variable-axis controls
  readable without clipping.

The browser run does not certify native component projection, linked-story
splitting, or cross-page navigation. Those remain separate acceptance checks.
