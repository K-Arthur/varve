# Contextual font toolbar parity evidence — 2026-09-14

The contextual text bar below the menubar now follows the same typography
capability contract as the canvas floating text bar. It exposes a Bold action
alongside family, weight, italic, and size controls. Bold is enabled only when
the selected static face has a real 700 face or the selected variable face
declares a compatible `wght` range; the action continues through the shared
range/caret typography adapter and therefore does not flatten rich-text runs.
The contextual icons use the 16px compact icon size used by the primary and
floating toolbars.

## Focused validation

```text
pnpm exec biome check packages/editor/src/components/ContextControlBar/ContextControlBar.tsx packages/editor/src/components/ContextControlBar/ContextControlBar.test.tsx
pnpm exec vitest run packages/editor/src/components/ContextControlBar/ContextControlBar.test.tsx --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
```

The focused file passed **7/7** tests. The regression covers Bold presence,
real-face application, range-aware family edits, variable-aware weight edits,
italic capability gating, and size commit validation.

## Visual validation

```text
VARVE_E2E_PORT=1494 VARVE_E2E_WORKERS=1 npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts tests/e2e/canvas/typography-editing.spec.ts --project=chromium --reporter=list
```

Chromium passed **6/6** scenarios at DPR 1, 2, and 3 in 5.3 minutes. I
inspected the latest light, dark-narrow, and high-contrast captures under
`test-results/run-1437687-1494/`. The contextual and floating bars retain the
same 32px control centerline, readable family field, bounded menu, and narrow
overflow behavior after adding Bold. The typography workflow also confirmed
that canceling an untouched text node still removes it and that an OpenType
change redraws the artwork. Native WebKitGTK, Windows WebView2, and macOS
WKWebView still require their platform-specific runs.
