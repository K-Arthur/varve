# Font identification OCR evidence — 2026-09-13

This entry records the local OCR text-capture slice added to the Identify Font
inspector. It is an optional aid to the existing image classifier and local
font-comparison path. Opening or searching the panel only checks whether the
model assets are already installed; it never starts a download. If the assets
are unavailable, the editable manual text field remains the supported path.

## Implementation

- `fontOcr.ts` checks the detector (`paddleocr-det-v4`) and the built-in-charset
  TrOCR recognizer (`tr-ocr-base-printed`) independently and forwards an
  `AbortSignal` and progress callback to the existing OCR pipeline.
- `FontDetectSection` bounds OCR to the same transformed crop used by font
  detection, exposes a cancel action, fills an editable recognized-text field,
  and reports region count, average recognition confidence, and model ID.
- Classifier availability is isolated from optional OCR probing with
  `Promise.allSettled`; an OCR manifest failure cannot hide the classifier.
- The existing explicit target picker and one-step candidate actions remain
  unchanged. OCR output is text input for review, never an automatic font
  application.

## Checks

Commands run from the repository root:

```text
pnpm exec biome check packages/editor/src/components/Inspector/sections/FontDetectSection.tsx packages/editor/src/components/Inspector/sections/FontDetectSection.test.tsx packages/editor/src/components/Inspector/sections/fontOcr.ts packages/editor/src/components/Inspector/sections/fontOcr.test.ts packages/editor/src/components/Inspector/sections/FontDetectSection.css
pnpm exec vitest run packages/editor/src/components/Inspector/sections/fontOcr.test.ts packages/editor/src/components/Inspector/sections/FontDetectSection.test.tsx --config vitest.config.ts --pool=threads --maxWorkers=1 --no-file-parallelism --reporter=dot
VARVE_E2E_PORT=1676 VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 VARVE_E2E_OUTPUT_DIR=font-detect-ocr-visual-rerun-20260913 npx playwright test tests/e2e/canvas/font-detect.spec.ts --project=chromium -g 'image identification controls' --reporter=list --timeout=180000
```

Results:

- Biome: 5 files clean.
- Focused unit tests: 11/11 passed across the OCR adapter and Identify Font
  component tests. Coverage includes both assets present, either asset missing,
  OCR cancellation/progress forwarding, editable text/confidence reporting,
  manual fallback, and an OCR probe failure that leaves classifier detection
  available.
- Focused Chromium E2E: 1/1 passed in 49.6 seconds. The test imported the real
  `test-image.png`, selected it, opened the Adjustments tab, expanded Identify
  Font, measured containment and overflow, and captured the panel.

## Inspected capture

[font-identification-panel.png](../screenshots/fonts/2026-09-13-font-identification-ocr/font-identification-panel.png)
was inspected at 1280×720, DPR 1, light theme. The panel remains inside the
inspector, the input and fallback explanation are legible, and action controls
remain visible without horizontal overflow. The browser fixture has no local
OCR assets, so the screenshot intentionally shows “Local OCR models are
unavailable in this runtime.” rather than implying a model download or a
server-backed recognition result.

The manifest at
[`docs/screenshots/fonts/2026-09-13-font-identification-ocr/manifest.json`](../screenshots/fonts/2026-09-13-font-identification-ocr/manifest.json)
records the viewport, assertions, and platform limitations. Native OCR loading,
model-present dark/high-contrast captures, candidate overlays, and OCR box
selection remain open acceptance work.
