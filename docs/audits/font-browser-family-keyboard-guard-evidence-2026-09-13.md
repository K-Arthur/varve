# Font browser keyboard focus guard — 2026-09-13

Follow-up implementation commit: `adf90ded8146ac3c7e44525fe146b03255ba7ad5`

The virtualized family list now drops its active row whenever the search,
source, or semantic filter changes and refuses to add an out-of-range active
index to the virtualizer's mounted range. This prevents a same-length filter
result from inheriting focus for a different family and keeps the active option
contract valid during a fast filter transition.

Validation after the guard:

```text
pnpm exec biome check packages/editor/src/components/FontBrowser/FontBrowser.tsx packages/editor/src/components/FontBrowser/FontBrowser.test.tsx packages/editor/src/components/FloatingToolbar/FloatingToolbar.css tests/e2e/canvas/font-browser-filters.spec.ts
pnpm exec vitest run packages/editor/src/components/FontBrowser/FontBrowser.test.tsx --reporter=dot
TMPDIR=$(mktemp -d /tmp/varve-font-browser-keyboard-rerun-XXXXXX) VARVE_E2E_PORT=1670 VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 VARVE_E2E_OUTPUT_DIR=font-browser-family-keyboard-rerun-20260913 npx playwright test tests/e2e/canvas/font-browser-filters.spec.ts --project=chromium --reporter=list --timeout=120000
```

Biome passed. The unit file passed **12/12** tests in 87.86 seconds. The
Chromium test passed **1/1** in 43.3 seconds at the 540×640 narrow viewport.
The browser emitted the existing ResizeObserver and React `flushSync` console
warnings, with no product assertion failure.
