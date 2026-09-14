# Photo/image editing visual evidence — 2026-09-14

These captures are evidence for the first photo-editing vertical slice. They
were produced from the real application and inspected visually; they are not
generated mockups.

## Application flow

The three `image-resize-*` captures are the Chromium workflow on Linux:

```text
VARVE_E2E_PORT=1475 VARVE_E2E_OUTPUT_DIR=photo-resize-working-space-20260914-wide \
  npx playwright test tests/e2e/canvas/image-resize.spec.ts \
  --project=chromium --reporter=list
```

The passing run opened a local fixture through the UI, opened Object → Resize
Image, changed dimensions, resampling method, and working space, applied the
operation, and checked the resulting source-pixel dimensions. The dialog
capture also shows the new working-space control and the explanatory boundary
text. A follow-up run after widening the dialog confirmed that the full
working-space label remains visible in the configured state.

## Website flow

The website captures were taken after:

```text
pnpm --filter @varve/website build
```

The changed Image Enhance and Image Conversion pages were reviewed at 1280px
desktop width and the feature page was also reviewed at 390px narrow width.
The build produced 102 static routes, including both changed pages.

| Capture | State |
| --- | --- |
| `image-resize-open.png` | Resize dialog opened from Object |
| `image-resize-configured.png` | Dimensions and resampling configured |
| `image-resize-applied.png` | Source-pixel resize applied in the document |
| `website-image-enhancement.png` | Feature page, desktop |
| `website-image-enhancement-mobile.png` | Feature page, narrow mobile |
| `website-image-conversion.png` | Documentation page, desktop |

The website visual review used a Chromium preview of the locally built static
output and did not upload artwork or documents.
