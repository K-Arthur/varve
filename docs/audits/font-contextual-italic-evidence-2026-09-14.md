# Contextual typography bar italic evidence — 2026-09-14

The contextual properties bar now exposes the same real-face Italic policy as
the floating text toolbar and Typography inspector. It uses the shared
range/caret command adapter, keeps the exact face reference, and disables the
button with a native explanation when the selected face has no italic sibling
or declared `ital` axis. Existing italic text remains actionable so it can be
returned to regular.

Focused component validation:

```text
CI=1 TMPDIR=/home/kevina/varve-tmp ./node_modules/.bin/vitest run \
  packages/editor/src/components/ContextControlBar/ContextControlBar.test.tsx \
  packages/editor/src/components/Typography/fontWeight.test.ts \
  packages/editor/src/components/FloatingTextBar/FloatingTextBar.test.tsx \
  packages/editor/src/components/Inspector/controls/controls.test.tsx \
  packages/editor/src/components/Inspector/sections/__tests__/TypographySection.test.tsx \
  packages/editor/src/components/FontBrowser/FontSelector.test.tsx --reporter=dot

6 files, 89 tests passed
```

The real Chromium visual workflow was rerun after adding the control:

```text
CI=1 TMPDIR=/home/kevina/varve-tmp VARVE_E2E_PORT=1732 \
VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 \
VARVE_E2E_OUTPUT_DIR=font-toolbar-final-20260914-head \
npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts \
  --project=chromium -g 'DPR 1' --reporter=list --timeout=180000

1 passed (1.2m) at master SHA `6f4c4375ebd16e5f3349238a8180a57d1a4a209d`
```

The inspected light, dark, and high-contrast captures include closed, open,
and narrow menu states. The floating toolbar remains 46.796875 CSS px high;
all controls, including Italic, are 32px and share a 2.88px gap, 5.76px /
9.44px padding, and 14.72px control text. The contextual bar remains on the
same centerline and keeps its family field at least 180px wide. The committed
[visual evidence set](../screenshots/fonts/2026-09-14-contextual-italic/README.md)
contains the nine inspected captures and per-theme measurements.

This is Linux Chromium evidence. Embedded WebKitGTK, WebView2, and WKWebView
face-specific runs remain platform-owned follow-up checks.
