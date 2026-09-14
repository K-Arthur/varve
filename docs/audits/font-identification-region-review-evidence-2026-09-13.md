# Font identification region review evidence — 2026-09-13

This continuation closes the UI gap between local OCR output and font
comparison. OCR previously filled one editable string and reported a region
count, but gave no way to exclude a false positive or inspect where that text
came from. The Identify Font panel now keeps the bounded transformed crop as a
preview, draws each OCR word as an accessible selectable box, and rebuilds the
comparison string from the selected boxes. The source image and document remain
unchanged.

Candidate cards also render a target-specific preview when an existing text
layer is selected. A low-confidence, insufficient-quality, or out-of-catalogue
candidate keeps **Apply to target** disabled until the user explicitly reviews
that preview. The new-text action remains available because it creates a
pending format rather than mutating an existing layer.

## Validation

```text
./node_modules/.bin/biome check --write packages/editor/src/components/Inspector/sections/FontDetectSection.tsx packages/editor/src/components/Inspector/sections/FontDetectSection.test.tsx packages/editor/src/components/Inspector/sections/FontDetectSection.css
CI=1 TMPDIR=/home/kevina/varve-tmp ./node_modules/.bin/vitest run --maxWorkers=1 packages/editor/src/components/Inspector/sections/FontDetectSection.test.tsx --reporter=dot
CI=1 TMPDIR=/home/kevina/varve-tmp VARVE_E2E_PORT=1744 VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 VARVE_E2E_OUTPUT_DIR=font-identification-preview-20260914 npx playwright test tests/e2e/canvas/font-detect.spec.ts --project=chromium --grep 'controls stay readable' --reporter=list --timeout=180000
```

Results:

- Biome completed with no errors after removing the array-index key warning.
- Focused Identify Font tests: **9/9 passed**, including OCR box selection and
  the low-confidence target review gate.
- Chromium inspector E2E: **1/1 passed** in 2m 35s. The test imported the real
  image fixture, opened Adjustments → Identify Font, asserted panel containment
  and no horizontal overflow, and captured
  `reports/ui-review/font-identification/font-identification-panel.png`.

The inspected capture is the model-unavailable state because the browser lane
does not ship the optional OCR assets. It confirms the surrounding panel still
fits at 1280×720, DPR 1, light theme. A model-present screenshot with the crop
image and selectable boxes remains a platform fixture follow-up; unit coverage
asserts the exact accessible box labels, selected count, editable text update,
and review gate.

The editor package typecheck was attempted but remains blocked by unrelated
shared-tree errors in `Menubar.tsx`, `inputPipeline.ts`, `wheelClassifier.ts`,
`applyFontReplacement.ts`, import capability types, layout tests, snapping, and
workspace layout types. No error was reported for the changed Identify Font
files.
