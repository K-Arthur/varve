# Logo wordmark typography evidence — 2026-09-14

The Logo wordmark typography surface now uses the same exact-face capability
policy as the inspector and quick editing bars. Italic is offered only when a
same-artifact sibling or declared `ital` axis is available; an unavailable
choice remains visible and disabled with an explanation. Existing italic text
can still be returned to regular. Weight choices continue to use the selected
artifact and collection member rather than a family-only list.

Authored family, face, style, weight, size, and tracking changes run through
the shared `Typography` compound operation. Each choice therefore produces one
undo entry and does not emit the persistent-history bypass warning used to
detect direct Logo mutations. The component regression covers the disabled
Italic state and the transaction label.

Focused component validation:

```text
CI=1 TMPDIR=/home/kevina/varve-tmp ./node_modules/.bin/vitest run \
  --maxWorkers=1 \
  packages/editor/src/components/LogoPanel/LogoTypographySection.test.tsx \
  packages/editor/src/components/ContextControlBar/ContextControlBar.test.tsx \
  packages/editor/src/components/Typography/fontWeight.test.ts \
  packages/editor/src/components/FloatingTextBar/FloatingTextBar.test.tsx \
  packages/editor/src/components/Inspector/controls/controls.test.tsx \
  packages/editor/src/components/Inspector/sections/__tests__/TypographySection.test.tsx \
  packages/editor/src/components/FontBrowser/FontSelector.test.tsx --reporter=dot

7 files, 93 tests passed
```

The real Logo workflow also passes after the combobox test was scoped to its
portaled listbox:

```text
CI=1 TMPDIR=/home/kevina/varve-tmp VARVE_E2E_PORT=1736 \
VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 \
npx playwright test tests/e2e/logo/logo-panel.spec.ts \
  --project=chromium -g 'typography section' --reporter=list --timeout=180000

1 passed (59.2s)
```

The current-HEAD toolbar visual workflow remains green:

```text
CI=1 TMPDIR=/home/kevina/varve-tmp VARVE_E2E_PORT=1735 \
VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 \
VARVE_E2E_OUTPUT_DIR=font-toolbar-final-20260914-logo-head \
npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts \
  --project=chromium -g 'DPR 1' --reporter=list --timeout=180000

1 passed (1.1m)
```

The inspected light/open, dark/narrow, and high-contrast/open captures keep the
floating bar at 46.796875 CSS pixels with 32px controls, 2.88px gaps,
5.76px/9.44px padding, 14.72px field text, aligned control centerlines, and a
contained picker. The committed reference captures are in
[`2026-09-14-contextual-italic`](../screenshots/fonts/2026-09-14-contextual-italic/README.md).

This is Linux Chromium evidence. Native WebKitGTK, Windows WebView2, and macOS
WKWebView runs remain platform-owned. The repository full gate was rerun at
the release checkpoint and stopped at unrelated existing website lint findings
and `@varve/engine` LUT test type errors (`LutTransform.size`), before editor
typecheck could complete.
