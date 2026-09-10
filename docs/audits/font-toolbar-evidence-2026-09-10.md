# Font toolbar evidence — 2026-09-10

This is a working-tree observation on `master`, with concurrent inspector work
present. The captured font implementation is part of the toolbar repair commit;
these images do not certify an exact release tree or the complete font system.
All 30 linked PNGs were opened and inspected, rather than approved solely by
passing screenshot assertions. The [capture manifest](../screenshots/fonts/2026-09-10-toolbar/manifest.json)
records original paths, dimensions and SHA-256 digests.

## Defects found through visual inspection

- [Overflowing toolbar](../screenshots/fonts/2026-09-10-toolbar/before-toolbar-overflow.png):
  alignment/list controls and color extended beyond the toolbar background.
- [Empty menu](../screenshots/fonts/2026-09-10-toolbar/before-empty-menu.png):
  after portaling, the virtualizer had not observed the late-mounted scroll
  element. A visibility assertion on the listbox alone missed this.

The repair uses explicit field widths, stable placement inputs, a separate
viewport-aware font menu and a More panel for alignment/list controls. The
virtualizer observes the mounted portal viewport. Escape dismisses the open
picker before a separate Escape exits editing. A size input is a draft until
blur/Enter, rather than mutating the document for each typed digit.

The [density baseline](../screenshots/fonts/2026-09-10-toolbar/before-density.png)
shows the additional user-reported mismatch: 40px family/weight fields beside
32px buttons, inconsistent field text sizes, and compressed outer spacing. The
repair uses the main palette's compact control and spacing tokens. The placement
layer owns the shadow so viewport scrolling cannot clip it into square corners.

## Inspected theme and density matrix

| DPR | Light | Dark | High Contrast |
| --- | --- | --- | --- |
| 1 | [Wide](../screenshots/fonts/2026-09-10-toolbar/dpr-1-light-open.png), [narrow](../screenshots/fonts/2026-09-10-toolbar/dpr-1-light-narrow.png) | [Wide](../screenshots/fonts/2026-09-10-toolbar/dpr-1-dark-open.png), [narrow](../screenshots/fonts/2026-09-10-toolbar/dpr-1-dark-narrow.png) | [Wide](../screenshots/fonts/2026-09-10-toolbar/dpr-1-high-contrast-open.png), [narrow](../screenshots/fonts/2026-09-10-toolbar/dpr-1-high-contrast-narrow.png) |
| 2 | [Wide](../screenshots/fonts/2026-09-10-toolbar/dpr-2-light-open.png), [narrow](../screenshots/fonts/2026-09-10-toolbar/dpr-2-light-narrow.png) | [Wide](../screenshots/fonts/2026-09-10-toolbar/dpr-2-dark-open.png), [narrow](../screenshots/fonts/2026-09-10-toolbar/dpr-2-dark-narrow.png) | [Wide](../screenshots/fonts/2026-09-10-toolbar/dpr-2-high-contrast-open.png), [narrow](../screenshots/fonts/2026-09-10-toolbar/dpr-2-high-contrast-narrow.png) |
| 3 | [Wide](../screenshots/fonts/2026-09-10-toolbar/dpr-3-light-open.png), [narrow](../screenshots/fonts/2026-09-10-toolbar/dpr-3-light-narrow.png) | [Wide](../screenshots/fonts/2026-09-10-toolbar/dpr-3-dark-open.png), [narrow](../screenshots/fonts/2026-09-10-toolbar/dpr-3-dark-narrow.png) | [Wide](../screenshots/fonts/2026-09-10-toolbar/dpr-3-high-contrast-open.png), [narrow](../screenshots/fonts/2026-09-10-toolbar/dpr-3-high-contrast-narrow.png) |

The family field, weight, size, toggles, color and More remain visible; menu
content is legible and inside the viewport. The 640 CSS-pixel viewport models constrained
width; it is not proof of native 200% browser zoom. High Contrast captures use
Varve's theme, not OS forced colors. The canvas background is the document's
existing surface and does not change with the UI theme.

## Commands and scope

```sh
pnpm exec vitest run packages/editor/src/components/FloatingTextBar/FloatingTextBar.test.tsx packages/editor/src/components/FontBrowser/FontSelector.test.tsx
VARVE_E2E_PORT=1598 pnpm exec playwright test tests/e2e/canvas/typography-editing.spec.ts --project=chromium --reporter=list
VARVE_E2E_PORT=1599 pnpm exec playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts --project=chromium --reporter=list
```

The original runs above passed 31 component tests, two editing tests and three
DPR/theme tests. They exposed further density defects and have been superseded
by run 1608: all five browser tests passed and produced 27 inspected final
captures (closed, open and narrow for each theme/DPR). Run 1609 verified the
final typed test helper and archived the measurements.

At a 1280px viewport both floating toolbars measure **46.796875px** high, with
**2.88px** gaps and **5.76px / 9.44px** vertical/horizontal padding. All seven
text controls are **32px** high and share the same vertical center; all three
fields use **14.72px** text. Background, 14px radius and shadow match the palette
in all three themes. These are computed measurements of fluid tokens, not
new hardcoded spacing values. See the
[Light](../screenshots/fonts/2026-09-10-toolbar/light-toolbar-metrics.json),
[Dark](../screenshots/fonts/2026-09-10-toolbar/dark-toolbar-metrics.json) and
[High Contrast](../screenshots/fonts/2026-09-10-toolbar/high-contrast-toolbar-metrics.json)
reports and [closed toolbar](../screenshots/fonts/2026-09-10-toolbar/dpr-1-light-closed.png).

```sh
GIT_INDEX_FILE=/tmp/varve-font-toolbar.index pnpm verify:plan --staged
GIT_INDEX_FILE=/tmp/varve-font-toolbar.index VARVE_E2E_PORT=1601 pnpm verify:affected --staged
pnpm typecheck:e2e
pnpm exec vitest run packages/editor/src/components/FloatingTextBar/FloatingTextBar.test.tsx packages/editor/src/components/FontBrowser/FontSelector.test.tsx
VARVE_E2E_PORT=1608 pnpm exec playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts tests/e2e/canvas/typography-editing.spec.ts --project=chromium --reporter=list
VARVE_E2E_PORT=1609 pnpm exec playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts --project=chromium --grep 'DPR 1' --reporter=list
pnpm audit:docs
pnpm audit:emoji
pnpm audit:tokens
```

The isolated index contains the explicit font-task paths, preserving unrelated
shared staging. The affected gate passed editor units (6,639 tests; one existing
skip), desktop units (67), their type checks, direct component tests, E2E type
checking, both browser specs, touched format/lint and docs/emoji audits. After
the density and shadow repairs, the direct component, E2E type and browser
checks were rerun; the unaffected package lanes were retained. The token audit
passed 153 contrast pairs across three themes.

The density test first failed on the old gap; the next iteration caught the
palette's minimum-height difference. Run 1606's first browser crashed in
Chromium's font-data service with temporary storage exhaustion; DPR 2/3 passed.
DPR 1 passed in 1607, and the final five-test run 1608 passed without a retry.
An initial optional-index TypeScript error in the measurement helper was fixed
and its compiler check rerun. This record does not hide intermediate failures.

Earlier failed runs 1494, 1594, 1595 and 1596 drove repairs to the empty list,
More icon, nested dismissal and intrinsic width. Run 1494's assertions passed
but its pixels were rejected. The existing VariableAxesSection missing-key
warning remains an identified typography follow-up.

These checks do not prove exact-face availability, rich-range targeting,
HarfBuzz/worker parity, font storage, export or native behavior. Those remain in
the [original acceptance matrix](./font-acceptance-matrix-2026-09-09.md).

## Agent Validation Report — toolbar milestone

```text
Changed scope: editor FontSelector/FloatingTextBar; two focused canvas specs; font architecture/audit/plan/evidence docs
Validation plan: Tiers 0–3; direct component/E2E checks, editor and desktop dependency closure; no full escalation
Commands actually run: exact commands above, with task-owned paths in a separate validation index
Passed: touched format/lint; 31 direct tests; 6,639 editor tests; 67 desktop tests; editor/desktop/E2E types; five final browser tests; docs, emoji and 153 token checks
Skipped as unrelated: Rust workspace, global visual suite and website E2E for this editor-only commit; website copy is a separate pending milestone
Escalations: focused Chromium requires process launch outside sandbox; shared Git staging preserved
Full suite run: no
If yes, reason: not applicable; foundational font milestones still require their final full gate
```
