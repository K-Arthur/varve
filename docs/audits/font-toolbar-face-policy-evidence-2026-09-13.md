# Font toolbar face-policy evidence — 2026-09-13

The quick text toolbar and full typography inspector now treat Italic as a
real-face capability. It stays disabled for a regular-only family, moves to a
same-artifact italic sibling when one exists, and recognizes a declared
variable `ital` axis. A selected italic face remains actionable so the user
can return to regular. The change prevents an apparently successful click
from creating an unsupported synthetic style or selecting another file that
merely shares the family name. The inspector's disabled option retains its
reason in the native title affordance and skips the option during keyboard
roving focus.

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
