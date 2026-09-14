# Font toolbar face-policy evidence — 2026-09-13

The quick text toolbar and full typography inspector now treat Italic as a
real-face capability. It stays disabled for a regular-only family, moves to a
same-artifact italic sibling when one exists, and recognizes a declared
variable `ital` axis. A selected italic face remains actionable so the user
can return to regular. The change prevents an apparently successful click
from creating an unsupported synthetic style or selecting another file that
merely shares the family name. Both surfaces retain the recovery reason in a
native title affordance; the inspector also skips the unavailable option
during keyboard roving focus.

Focused tests:

```text
./node_modules/.bin/vitest run packages/editor/src/components/Typography/fontWeight.test.ts --config vitest.config.ts --reporter=dot
  1 file, 16 tests passed

./node_modules/.bin/vitest run packages/editor/src/components/FloatingTextBar/FloatingTextBar.test.tsx --config vitest.config.ts --reporter=dot
  1 file, 33 tests passed

./node_modules/.bin/vitest run packages/editor/src/components/Inspector/controls/controls.test.tsx packages/editor/src/components/Inspector/sections/__tests__/TypographySection.test.tsx --config vitest.config.ts --reporter=dot
  2 files, 15 tests passed
```

The test environment was space constrained under `/tmp`; the successful runs
used `TMPDIR=/home/kevina/varve-tmp`. The first combined attempt failed while
Vite wrote a transform cache (`ENOSPC`) before any assertion ran.

The visual toolbar captures in the [size-consistency evidence](./font-toolbar-size-consistency-evidence-2026-09-13.md)
remain the geometry evidence for this control. A fresh browser capture of the
new disabled-state pixel treatment is still required before calling the visual
portion of this face-policy check complete.

I attempted that fresh Chromium run in a clean detached worktree with the
task-local temporary directory:

```text
CI=1 TMPDIR=/home/kevina/varve-tmp VARVE_E2E_PORT=1698 VARVE_E2E_WORKERS=1 \
  VARVE_DISABLE_HMR=1 VARVE_E2E_OUTPUT_DIR=font-toolbar-face-policy-20260913 \
  npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts \
  --project=chromium -g 'DPR 1' --reporter=list --timeout=180000
```

The run did not reach the spec: the shared master graph was in the middle of
concurrent changes and the detached tree reported missing exports from
`@varve/scene`/`@varve/shared`; global setup then timed out waiting for the
Home button. This is recorded as an environment-blocked visual check rather
than a passing capture. The previously inspected light, dark, high-contrast,
narrow, and DPR 2/3 captures remain valid geometry evidence; a disabled-Italic
pixel capture should be collected once the shared app graph is buildable.
