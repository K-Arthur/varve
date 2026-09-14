# Font recovery status evidence — 2026-09-14

This entry records the resolver and Missing Fonts dialog slice that separates
same-family recovery failures. It is evidence for row 12 of the font
acceptance matrix; it does not certify the complete capability/preflight
contract.

## Implementation

`FontResolver.detectMissing` now reports these deterministic states when the
catalog cannot satisfy an authored request:

- `missing-family` when no catalog face has the requested family;
- `missing-face` when the family exists but the requested weight/style or
  collection member is unavailable;
- `version-mismatch` when the requested PostScript name exists but the
  artifact hash differs;
- `conflicting` when multiple local artifacts claim the requested variant;
- `missing-glyph` when a validated cmap excludes characters in the run.

Every result includes a recovery reason and a next action. Family-only
resolution refuses to choose between duplicate regular artifacts. The dialog
renders the reason and action before offering install, browse, or replacement
controls, so a same-family match cannot be mistaken for an exact-face match.

## Validation

Command:

```text
pnpm exec vitest run packages/engine/src/font/fontResolver.test.ts packages/editor/src/components/FontBrowser/MissingFontDialog.test.tsx --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
```

Result: **2 test files passed, 48 tests passed**.

Assertions cover a missing family, an unavailable face, a same-PostScript
version mismatch, duplicate same-variant artifacts, missing cmap glyphs, dialog
status/reason copy, exact install, replacement, keyboard dismissal, and the
existing recovery flows.

## Remaining evidence

Parser/storage corruption, unsupported formats, operation permissions, offline
retry, restricted embedding preflight, and native restart behavior still need
their own capability results and platform captures. Those gaps remain partial
in the matrix and are not inferred from this unit/UI run.
