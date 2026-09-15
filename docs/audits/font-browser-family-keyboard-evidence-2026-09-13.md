# Font browser family keyboard evidence — 2026-09-13

Implementation commit: `9dc213d9da7e82d0ca5196057e1277828596e5d9`

This check covers the full font browser's virtualized family list at a narrow
540×640 CSS-pixel viewport. The list exposes one tab stop, keeps the active
family mounted while the virtualizer scrolls, and handles ArrowUp/ArrowDown,
Home, and End. Source-filter tabs and the Reset filters action remain covered
by the same browser run.

## Reproduction

```text
TMPDIR=$(mktemp -d /tmp/varve-font-browser-keyboard-XXXXXX) \
VARVE_E2E_PORT=1669 VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 \
VARVE_E2E_OUTPUT_DIR=font-browser-family-keyboard-20260913 \
npx playwright test tests/e2e/canvas/font-browser-filters.spec.ts \
  --project=chromium --reporter=list --timeout=120000
```

Result: `1 passed (54.0s)` on Linux Chromium. The web server emitted the
repository's existing ResizeObserver and React `flushSync` console warnings;
there was no test failure.

The focused unit command also passed: `pnpm exec vitest run
packages/editor/src/components/FontBrowser/FontBrowser.test.tsx --reporter=dot`
(12 tests).

## Inspected captures

- [Filtered narrow browser](../screenshots/fonts/2026-09-13-font-browser-family-keyboard/filtered-narrow.png) — combined search, Favorites, and Variable filters remain contained at 540px; the reset action is full width.
- [Reset narrow browser](../screenshots/fonts/2026-09-13-font-browser-family-keyboard/reset-narrow.png) — the local catalog is restored, source tabs are readable, and the family list has a visible keyboard focus target without clipping the details pane.

The captured workflow verified the following sequence with real DOM focus:

1. Reset search/source/semantic filters.
2. Focus the first family row and press ArrowDown; the next row became the only
   tabbable family row and received focus.
3. Press End; the final mounted/virtualized family row became active and focused.
4. Press Home; focus returned to the first family row.

The browser never starts a network request for search, hover, keyboard
navigation, or reset.
