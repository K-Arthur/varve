# OpenType canvas redraw evidence — 2026-09-14

## Finding

Chromium's Canvas2D context in the typography workflow exposes neither
`fontFeatureSettings` nor `fontVariationSettings`. A generated `FontFace`
alias can select the correct family, but its feature descriptors are not
honoured by `fillText` in that runtime. The first implementation therefore
serialized `liga: false` correctly while leaving the painted glyphs unchanged.

## Change

The replay path now keeps the authored run intact and chooses an exact,
bounded fallback when the Canvas2D extensions are absent:

1. `canvasOpenTypeRenderer.ts` parses the already-discovered source face
   (including WOFF2 when the browser decoder is available) and draws the real
   glyph paths with the requested feature map and variation coordinates.
2. `canvasSvgTextRenderer.ts` uses the browser's native SVG shaper when a
   parsed path is unavailable. It embeds the same local source bytes as a
   data URL in the SVG `@font-face`, so the image cannot silently fall back to
   a serif face. The source is the existing local/bundled CSS artifact; catalog
   search and hover never initiate a remote font download.
3. The generated alias, parsed-face cache, and SVG image cache are process
   local and bounded. A ready notification schedules an authoritative replay;
   while a source is loading the normal Canvas2D result remains the explicit
   fallback. Weight and italic style are passed separately so an `italic 700`
   run cannot be parsed as regular weight.

The worker admission boundary is unchanged: a worker bitmap is not admitted
until the exact face is adopted synchronously. This fallback is therefore a
main-thread redraw path, not a second source of stale pixels.

## Verification

Code commit: `74df576e77ff2c2c7897a189a84cc91abf20e715`.

Commands:

```text
pnpm exec biome check packages/engine/src/canvasOpenTypeRenderer.ts packages/engine/src/canvasSvgTextRenderer.ts packages/engine/src/canvasFontAliases.ts packages/engine/src/replay.ts
pnpm exec vitest run packages/engine/src/canvasFontAliases.test.ts packages/engine/src/canvasFontAliases.faceIdentity.test.ts --pool=threads --maxWorkers=1 --reporter=dot
pnpm exec vitest run packages/editor/src/components/FloatingTextBar/FloatingTextBar.test.tsx packages/editor/src/components/FloatingToolbar/FloatingToolbar.test.tsx packages/editor/src/components/ContextControlBar/ContextControlBar.test.tsx packages/editor/src/components/FontBrowser/FontSelector.test.tsx packages/editor/src/components/FontBrowser/DocumentFontsPanel.test.tsx packages/editor/src/components/FontBrowser/fontStorage.test.ts packages/editor/src/components/Typography/typographyCommand.test.ts packages/engine/src/font/fontDownloadLifecycle.test.ts packages/engine/src/font/fontDownloadManager.test.ts packages/engine/src/canvasFontAliases.test.ts packages/engine/src/canvasFontAliases.faceIdentity.test.ts --pool=threads --maxWorkers=1 --reporter=dot
CI=1 TMPDIR=/home/kevina/varve-tmp VARVE_E2E_PORT=1744 VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 VARVE_E2E_OUTPUT_DIR=font-typography-editing-20260914-final-run npx playwright test tests/e2e/canvas/typography-editing.spec.ts --project=chromium --reporter=list --timeout=180000
```

Results:

- Biome passed for all four renderer files.
- Alias and face-identity tests passed: 2 files, 5 tests.
- Focused frontend/engine suite passed: 11 files, 120 tests.
- Typography E2E passed: 3 scenarios, including point-text focus, empty-text
  cancellation, and OpenType redraw plus cluster adjustment.
- The canvas fingerprint changed from `493228816` (before) to `2133830545`
  (after `liga: false`), with `358157` non-background pixels in both frames.
  This shows a glyph-pixel change rather than a missing or empty canvas.

I inspected the before/after canvas captures at:

```text
test-results/font-typography-editing-20260914-final-run/canvas-typography-editing--da252-ent-redraw-the-real-artwork-chromium/advanced-typography-before-canvas.png
test-results/font-typography-editing-20260914-final-run/canvas-typography-editing--da252-ent-redraw-the-real-artwork-chromium/advanced-typography-after-canvas.png
```

The IBM Plex face, selection bounds, and editor chrome remain present in both
captures; the changed glyph pixels are confined to the text artwork.

## Limits and next check

This closes the Chromium Canvas2D feature-path defect. It does not certify
native WebKitGTK, Windows WebView2, or macOS WKWebView. It also does not close
the full main-thread/worker geometry oracle: line breaks, caret stops, hit
testing, overset, and exact face-revision parity still need the real-byte
forced-redraw comparison described in the acceptance matrix.
