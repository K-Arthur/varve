# Mixed-range font-toolbar evidence — 2026-09-14

This is a bounded frontend proof for the quick toolbar and contextual text bar.
It addresses the capability decision that was previously made from only the
first run in a mixed rich-text selection.

## Change

Commit `cf05b5e1b7087e2e7c96c2457544ef710e17b4d0` adds an effective typography
display projection for every run addressed by the active range. Weight options
now intersect the supported weights of those faces, and the Italic action is
enabled only when every selected face exposes a real italic sibling or a
declared `ital` axis. Existing run formatting and the shared one-transaction
command adapter are unchanged.

The projection preserves inherited family, exact artifact/member reference,
weight, style, and variation axes. A collapsed caret with pending insertion
formatting is represented by that pending face, so capability checks do not
read stale run data.

## Validation

Commands:

```text
pnpm exec biome check packages/editor/src/components/Typography/typographyCommand.ts packages/editor/src/components/Typography/typographyCommand.test.ts packages/editor/src/components/Typography/fontWeight.ts packages/editor/src/components/Typography/fontWeight.test.ts packages/editor/src/components/FloatingTextBar/FloatingTextBar.tsx packages/editor/src/components/ContextControlBar/ContextControlBar.tsx
pnpm exec vitest run packages/editor/src/components/Typography/typographyCommand.test.ts packages/editor/src/components/Typography/fontWeight.test.ts packages/editor/src/components/FloatingTextBar/FloatingTextBar.test.tsx packages/editor/src/components/ContextControlBar/ContextControlBar.test.tsx --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
```

Result: **6 files passed Biome; 4 test files and 77 tests passed.** The test
matrix covers inherited run data, pending caret formatting, shared weight
intersection, real italic availability across multiple faces, and the two
toolbar surfaces.

The existing Chromium visual toolbar run remains the visual proof for spacing,
control sizing, menu readability, DPR 1/2/3, dark mode, and narrow layout. This
slice does not claim native WebKitGTK proof or main/worker glyph parity.
