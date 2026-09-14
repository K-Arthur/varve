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
- `6fbd3da0c` — expose actionable missing-family, missing-face, version, and
  conflict recovery states.
- `8c9c845a3` — preserve readiness and renderer architecture documentation.
- `7f54ec98e` — gate export on the exact requested face identity.
- `a1d5ab9a6` — reject browser export faces that never become ready.
- `aab2dcb9b` — project exact-face capabilities through catalog, manifest,
  recovery UI, and Document Fonts status badges.
- `e0af7317` — fix highlighted quick-toolbar font-menu contrast and record the
  inspected DPR rerun.

The quick-toolbar geometry work is covered by the existing frontend changes and
is rechecked by `tests/e2e/canvas/font-toolbar-visual.spec.ts`.

## Acceptance matrix state

The authoritative [24-scenario acceptance matrix](./font-acceptance-matrix-2026-09-09.md)
contains **8 open** scenarios and **16 partial** scenarios. No scenario is
called fully closed because native restart, exact-byte, worker/main-thread,
multilingual, color-font, performance, and cross-platform evidence is still
incomplete.

## Agent Validation Report

Changed scope: `packages/engine/src/font/**`, `packages/engine/src/fontRegistry.ts`, `packages/engine/src/richTextLayout.ts`, `packages/editor/src/commands/selectionCommands.ts`, `packages/editor/src/components/FontBrowser/**`, `packages/editor/src/components/SpecPanel/export.ts`, `packages/editor/src/packageExport.ts`, font acceptance/evidence documentation, and the existing quick-toolbar/browser typography E2E surfaces.

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
pnpm exec vitest run packages/engine/src/font --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
pnpm exec vitest run packages/editor/src/components/FontBrowser --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
CI=1 TMPDIR=/home/kevina/varve-tmp VARVE_E2E_PORT=1744 VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 VARVE_E2E_OUTPUT_DIR=font-toolbar-final-20260914-rerun npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts --project=chromium --reporter=list --timeout=180000
CI=1 TMPDIR=/home/kevina/varve-tmp VARVE_E2E_PORT=1745 VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 VARVE_E2E_OUTPUT_DIR=font-typography-editing-20260914-rerun npx playwright test tests/e2e/canvas/typography-editing.spec.ts --project=chromium --reporter=list --timeout=180000
CI=1 TMPDIR=/home/kevina/varve-tmp VARVE_E2E_PORT=1746 VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 VARVE_E2E_OUTPUT_DIR=font-document-fonts-capabilities-20260914 npx playwright test tests/e2e/canvas/document-fonts-panel.spec.ts --project=chromium --reporter=list --timeout=180000
pnpm audit:docs
pnpm audit:emoji
pnpm audit:tokens
pnpm --filter @varve/website typecheck
```

Passed:

- Focused identity/projection suite: **126 tests in 8 files**.
- All engine font tests: **475 tests in 31 files**.
- All Font Browser tests: **68 tests in 11 files**.
- Capability/manifest regression slice: **79 tests in 5 files**, followed by
  **22 tests in 3 files** after the Document Fonts status badge was added.
- Toolbar E2E: **3 passed** at DPR 1, 2, and 3 in 1.9 minutes.
- Typography editing E2E: **3 passed** in 1.2 minutes, including empty-text
  cancellation and OpenType redraw.
- Document Fonts E2E: **1 passed** in 1.1 minutes; the narrow dark capture and
  replacement chooser were inspected, including the new readiness badge.
- Toolbar contrast rerun: **3 passed** at DPR 1, 2, and 3 after correcting the
  highlighted family-row foreground colour; light, dark, and high-contrast
  menu captures were inspected.
- `audit:docs`: clean, 876 docs / 472 links / 174 ADRs.
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
  generic-arity errors, `generativeEdit/nativeModel.test.ts` references to a
  missing `qualifyNativeGenerativeModel`, and `lut*.test.ts` references to a
  missing `size` property. The architecture audit was terminated after its
  concurrent madge scan remained live for nearly two minutes; its reported
  cycles are retained here and are not attributed to the font commits.
- `pnpm --filter @varve/website typecheck` reached a clean Astro check but
  exited 2 on the unrelated `tests/e2e/generative-editing.visual.spec.ts`
  `naturalWidth` type error.

Full suite run: yes — `pnpm verify:full` was required by the planner escalation.

If yes, reason: the planner classified the dirty shared worktree as a
workspace/toolchain/validation-infrastructure change whose package-selection
contract could affect every package.

After the capability and toolbar commits, the required full-gate rerun used
the same escalation reason and stopped at the same unrelated lint,
architecture-cycle, and engine typecheck failures before downstream suites.
The exact post-rerun `pnpm verify:plan` and `pnpm verify:affected` commands were
also run; the latter exited 2 solely because the planner requires that full
gate for this dirty shared workspace.

## Evidence links

- [Acceptance matrix](./font-acceptance-matrix-2026-09-09.md)
- [Fresh toolbar visual evidence](./font-toolbar-visual-evidence-2026-09-14.md)
- [Capability projection evidence](./font-capability-projection-evidence-2026-09-14.md)
- [Fresh typography/OpenType evidence](./font-opentype-redraw-evidence-2026-09-14.md)
- [Inherited exact-face evidence](./font-face-inheritance-evidence-2026-09-14.md)
- [Typography product research](../research/font-typography-ux-research-2026-09-12.md)
- Browser artifacts: `test-results/font-toolbar-final-20260914-rerun/` and
  `test-results/font-typography-editing-20260914-rerun/`.

## Remaining implementation and proof

The next executable work is the native embedded WDIO run and exact-byte restart
matrix on Linux, followed by the same checks on Windows and macOS. In code, the
remaining high-risk slices are real corrupt-file repair and permission/offline
E2E, durable native/browser migration and uninstall recovery, the real-byte
main/worker glyph and geometry oracle, linked-story replacement/restore
preview, multilingual and color-font parity, 1k/10k picker budgets, and native
image-identification/OCR overlays.
The collaboration dependency payload is prepared; live transport remains
outside this project.

## Corpus and shaping continuation — 2026-09-14

The parser corpus milestone is committed at `20753b027028d04d6dcd5c49513a34bd27d85af6`.
It adds licensed static, TTC, Arabic, Devanagari, Japanese WOFF2, and COLR/CPAL
artifacts with exact SHA-256 provenance and six parser assertions. The focused
corpus plus existing parser suite passed **3 files / 69 tests**. The follow-up
multilingual shaping proof is committed at
`550e96d0f409fe134c4dc53eeb880621460fe529`; it uses the checked-in Arabic and
Devanagari bytes and passed **2 files / 16 tests**.

Additional commands actually run:

```text
pnpm exec biome check packages/engine/src/font/fontParser.corpus.test.ts
pnpm exec vitest run packages/engine/src/font/fontParser.corpus.test.ts packages/engine/src/font/fontParser.realfont.test.ts packages/engine/src/font/fontParser.test.ts --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
pnpm exec biome check packages/engine/src/shapingOracle.test.ts
pnpm exec vitest run packages/engine/src/shapingOracle.test.ts packages/engine/src/shapingBackend.test.ts --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=verbose
pnpm audit:docs
pnpm verify:plan
pnpm verify:affected
VARVE_FULL_GATE_REASON='corpus-backed multilingual shaping oracle milestone; verify planner escalated because the shared workspace contains foundational and validation-infrastructure changes' pnpm verify:full
```

Passed: both focused suites, both touched-file Biome checks, and `audit:docs`
(878 documents, 473 links, 174 ADRs). `audit:emoji` also passed in the full
gate (4,661 files).

The affected planner again escalated because the shared worktree includes
workspace, toolchain, and validation-infrastructure changes. The full gate did
not certify the tree: it stopped on the same concurrent website/editor lint
diagnostics, engine/scene/editor architecture cycles (including the concurrent
`contentAwareFill/index.ts → quickCleanup.ts → generativeEdit/types.ts` cycle),
and existing engine type errors in `quickCleanup.test.ts` and `lut*.test.ts`.
Those failures are outside the corpus and shaping files.

This continuation closes the parser and required Arabic/Devanagari shaping
evidence only. It does not close native restart, color rendering parity,
emoji/CJK shaping, main/worker canvas identity, or platform WebView proof.
