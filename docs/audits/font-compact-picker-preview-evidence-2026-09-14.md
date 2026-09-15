# Compact font picker preview evidence — 2026-09-14

This note records the final bounded typography follow-up committed as
`b2feb237a` on `master`.

## Behavior covered

- The compact picker reports family and exact-face navigation through optional
  presentation callbacks.
- The contextual toolbar starts a `preview` transaction on the first hovered
  or keyboard-highlighted family/face.
- Subsequent previews reuse that transaction, so navigation does not create
  history entries or mark the document dirty.
- Escape, dismissal, target changes, and unmount abort the transaction and
  restore the captured document.
- A confirmed family or face applies the final value and commits one edit.
- Empty changes are ignored by the typography adapter, preventing a same-family
  selection from cloning a node or creating an empty undo step.

## Focused evidence

Commands run:

```text
pnpm exec biome check --write packages/editor/src/components/FontBrowser/FontSelector.tsx packages/editor/src/components/FontBrowser/FontSelector.test.tsx packages/editor/src/components/ContextControlBar/ContextControlBar.tsx packages/editor/src/components/ContextControlBar/ContextControlBar.test.tsx packages/editor/src/components/Typography/typographyCommand.ts packages/editor/src/components/Typography/typographyCommand.test.ts
pnpm exec vitest run packages/editor/src/components/FontBrowser/FontSelector.test.tsx packages/editor/src/components/ContextControlBar/ContextControlBar.test.tsx packages/editor/src/components/Typography/typographyCommand.test.ts --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
```

Result: 3 files passed, 31 tests passed. The new assertions cover pointer and
keyboard preview, Escape cleanup, commit-on-confirm, abort-on-dismiss, and
empty-change suppression.

The existing inspected toolbar capture remains:

`test-results/run-1408705-1493/canvas-font-toolbar-visual-76f26-adable-menus-in-every-theme-chromium/light-open.png`

That visual run passed 6/6 across the compact toolbar themes, narrow layout,
and DPR 1/2/3. A fresh rerun was started after this commit but the shared
Playwright harness stalled before reporting a result and was terminated when
this bounded checkpoint closed; no fresh pass is claimed for that rerun.

## Scope and remaining limits

The change is limited to the compact picker and shared typography command
adapter. It does not claim completion of the open native WebKit driver,
offline/reopen, render-oracle, export, collaboration, image-identification,
or Windows/macOS acceptance rows. Those remain tracked in
`docs/audits/font-acceptance-matrix-2026-09-09.md`.
