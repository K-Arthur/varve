# Font system agent validation report — 2026-09-14

This report records the task-owned work completed on `master` and the limits of
this validation pass. The working tree contained concurrent editor, desktop,
Rust, website, and documentation changes; task commits were created with an
isolated index so those staged entries were preserved.

## Task-owned commits

- `67afbd871` — preserve inherited exact faces across rich-layout, usage,
  Select by Font, export, and package projections.
- `eabd0c0d4` — record inherited-face evidence and update the acceptance matrix.
- `bec9ca36f` — record the fresh toolbar and typography E2E reruns.

The quick-toolbar geometry work is covered by the existing frontend changes and
is rechecked by `tests/e2e/canvas/font-toolbar-visual.spec.ts`.

## Acceptance matrix state

The authoritative [24-scenario acceptance matrix](./font-acceptance-matrix-2026-09-09.md)
contains **8 open** scenarios and **16 partial** scenarios. No scenario is
called fully closed because native restart, exact-byte, worker/main-thread,
multilingual, color-font, performance, and cross-platform evidence is still
incomplete.

## Agent Validation Report

Changed scope: `packages/engine/src/font/**`, `packages/engine/src/richTextLayout.ts`, `packages/editor/src/commands/selectionCommands.ts`, `packages/editor/src/components/FontBrowser/documentFontUsage.ts`, `packages/editor/src/components/SpecPanel/export.ts`, `packages/editor/src/packageExport.ts`, font acceptance/evidence documentation, and the existing quick-toolbar/browser typography E2E surfaces.

Validation plan: `pnpm verify:plan` selected 324 changed files because the shared
worktree also contains concurrent desktop, website, editor, engine, scene,
shared, and Rust changes. It selected Tiers 0–4 and reported
`FULL-SUITE ESCALATION: YES` because workspace/toolchain/validation-infrastructure
selection logic may affect every package contract.

Commands actually run:

```text
pnpm verify:plan
pnpm verify:affected
VARVE_FULL_GATE_REASON='font identity projection milestone; verify planner escalated because concurrent workspace and validation-infrastructure changes' pnpm verify:full
pnpm exec biome check <task-owned changed TypeScript files>
pnpm exec vitest run packages/engine/src/font/fontFaceInheritance.test.ts packages/engine/src/font/fontResolver.test.ts packages/engine/src/text/paragraphLayout.test.ts packages/engine/src/textLayoutSnapshot.test.ts packages/editor/src/components/FontBrowser/documentFontUsage.test.ts packages/editor/src/packageExport.test.ts packages/editor/src/commands/__tests__/selectionCommands.test.ts packages/editor/src/components/SpecPanel/export.test.ts --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
CI=1 TMPDIR=/home/kevina/varve-tmp VARVE_E2E_PORT=1744 VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 VARVE_E2E_OUTPUT_DIR=font-toolbar-final-20260914-rerun npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts --project=chromium --reporter=list --timeout=180000
CI=1 TMPDIR=/home/kevina/varve-tmp VARVE_E2E_PORT=1745 VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 VARVE_E2E_OUTPUT_DIR=font-typography-editing-20260914-rerun npx playwright test tests/e2e/canvas/typography-editing.spec.ts --project=chromium --reporter=list --timeout=180000
pnpm audit:docs
pnpm audit:emoji
pnpm audit:tokens
pnpm --filter @varve/website typecheck
```

Passed:

- Focused identity/projection suite: **126 tests in 8 files**.
- Toolbar E2E: **3 passed** at DPR 1, 2, and 3 in 1.9 minutes.
- Typography editing E2E: **3 passed** in 1.2 minutes, including empty-text
  cancellation and OpenType redraw.
- `audit:docs`: clean, 873 docs / 471 links / 174 ADRs.
- `audit:emoji`: clean, 4,655 files.
- `audit:tokens`: all 153 WCAG pairs pass across light, dark, and high
  contrast themes.
- Astro diagnostics inside the website typecheck: 0 errors and 0 warnings
  (5 hints).
- Fresh visual captures were inspected for light open-menu, high-contrast
  expanded faces, dark narrow menu, and typography before/after states.

Measured toolbar budget:

- palette and quick-toolbar height: `46.796875px`
- every toolbar control: `32px` high and vertically aligned
- shared gap: `2.88px`
- shared padding: `5.76px 9.44px`
- field text: `14.72px`
- layout: `overflow-x: auto`, `flex-wrap: nowrap`
- narrow menu remained within the 640 CSS-pixel viewport

Skipped as unrelated or platform-owned: native Linux Tauri/WebKitGTK font
restart and WDIO proof, Windows WebView2, macOS WKWebView, 1,000/10,000-family
latency benchmarks, real multilingual/color-font render oracles, durable
native uninstall/two-document restart proof, live collaboration transport,
and full website base-path/browser E2E certification.

Escalations and failures:

- `pnpm verify:affected` exited 2 because the planner required the full gate.
- `pnpm verify:full` ran with the stated reason but did not certify the tree.
  The architecture audit reported concurrent engine/scene/editor cycles and a
  new `contentAwareFill/index.ts → quickCleanup.ts → generativeEdit/types.ts`
  cycle. Engine typecheck also stopped on unrelated `quickCleanup.test.ts`
  generic-arity errors and `lut*.test.ts` references to a missing `size`
  property.
- `pnpm --filter @varve/website typecheck` reached a clean Astro check but
  exited 2 on the unrelated `tests/e2e/generative-editing.visual.spec.ts`
  `naturalWidth` type error.

Full suite run: yes — `pnpm verify:full` was required by the planner escalation.

If yes, reason: the planner classified the dirty shared worktree as a
workspace/toolchain/validation-infrastructure change whose package-selection
contract could affect every package.

## Evidence links

- [Acceptance matrix](./font-acceptance-matrix-2026-09-09.md)
- [Fresh toolbar visual evidence](./font-toolbar-visual-evidence-2026-09-14.md)
- [Fresh typography/OpenType evidence](./font-opentype-redraw-evidence-2026-09-14.md)
- [Inherited exact-face evidence](./font-face-inheritance-evidence-2026-09-14.md)
- [Typography product research](../research/font-typography-ux-research-2026-09-12.md)
- Browser artifacts: `test-results/font-toolbar-final-20260914-rerun/` and
  `test-results/font-typography-editing-20260914-rerun/`.

## Remaining implementation and proof

The next executable work is the native embedded WDIO run and exact-byte restart
matrix on Linux, followed by the same checks on Windows and macOS. In code, the
remaining high-risk slices are exact capability/status recovery (missing face,
corrupt, version mismatch, glyph and permission states), durable native/browser
migration and uninstall recovery, the real-byte main/worker glyph and geometry
oracle, linked-story replacement/restore preview, multilingual and color-font
parity, 1k/10k picker budgets, and native image-identification/OCR overlays.
The collaboration dependency payload is prepared; live transport remains
outside this project.
