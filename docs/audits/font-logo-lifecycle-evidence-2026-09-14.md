# Logo typography lifecycle evidence — 2026-09-14

The Logo project command hook now routes project creation, concept creation and
duplication, concept status, variants, brief edits, and clear-space guides
through the editor's `groupCompoundOperation` adapter. This keeps Logo setup
and wordmark typography edits in the same persistent history boundary instead
of calling `updateDoc` directly.

## Focused validation

```text
./node_modules/.bin/biome check \
  packages/editor/src/context/useLogoProject.ts \
  packages/editor/src/context/useLogoProject.test.tsx

CI=1 TMPDIR=/home/kevina/varve-tmp ./node_modules/.bin/vitest run \
  --maxWorkers=1 \
  packages/editor/src/context/useLogoProject.test.tsx \
  packages/editor/src/components/LogoPanel/LogoTypographySection.test.tsx \
  --reporter=dot
```

Result: Biome passed; 2 files and 5 tests passed. The new hook test verifies
that project creation enters the compound-operation boundary before the
document mutation. The Logo typography suite continues to cover exact-face
style availability and the one-step typography operation.

## Browser boundary

The focused Chromium Logo typography workflow passed after the hook change:

```text
CI=1 TMPDIR=/home/kevina/varve-tmp VARVE_E2E_PORT=1738 \
  VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 \
  npx playwright test tests/e2e/logo/logo-panel.spec.ts \
  --project=chromium -g 'typography section' --reporter=list --timeout=180000
```

Result: 1 test passed. The browser still logs two history warnings while the
test creates a text wordmark through the Text tool; that path is separate from
Logo project setup and remains a follow-up. The Logo wordmark controls and
their visual spacing are covered by the existing inspected toolbar/panel
captures.
