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

## Resolver and color-face continuation — 2026-09-14

The resolver boundary follow-up is committed at `af8016aad` and
`922df0dec`. Resolver text nodes now carry node-level style overrides, and the
scoped replacement adapter narrows opaque resolver nodes after checking the
text discriminant. The focused replacement, resolver, and native-font tests
passed **48/48**. The desktop typecheck no longer reports a font-related
error; the remaining failures are concurrent shared editor errors in the menu,
canvas input/wheel, layout, geometry, snapping, and workspace modules.

The color-face UI continuation is committed at `fda36f1c1`. Installed-font
details now show detected color formats and palette count and explicitly state
that color glyphs must stay live or be rasterized when outline export cannot
preserve them. The focused details/browser slice passed **15/15**; this is a
user-facing fallback boundary, not proof of native color output parity.

Additional commands actually run:

```text
pnpm exec biome check packages/editor/src/components/FontBrowser/applyFontReplacement.ts packages/engine/src/font/index.ts
pnpm --dir apps/desktop typecheck
pnpm exec biome check packages/editor/src/components/FontBrowser/FontLicenseDetails.tsx packages/editor/src/components/FontBrowser/FontLicenseDetails.test.tsx
pnpm exec vitest run packages/editor/src/components/FontBrowser/FontLicenseDetails.test.tsx packages/editor/src/components/FontBrowser/FontBrowser.test.tsx --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
```

The native WDIO command remains blocked before Tauri launch by those unrelated
desktop type errors; no native pass is claimed.

The post-continuation full gate was also run with
`VARVE_FULL_GATE_REASON='font typography continuation: resolver boundary and color-face UI; planner escalated due shared workspace and validation-infrastructure changes'`.
It reached the architecture audit and package typecheck, then exited before
downstream suites. The recorded failures were the shared website/editor lint
diagnostics, 14 existing architecture cycles/instability budget reports, and
engine type errors in `contentAwareFill/quickCleanup.test.ts` and `lut*.test.ts`.
No failure was reported from the resolver or color-face UI tests.

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

## Mixed-range toolbar continuation — 2026-09-14

The frontend follow-up is committed at
`cf05b5e1b7087e2e7c96c2457544ef710e17b4d0`. The quick toolbar and contextual
text bar now receive effective typography data for every selected rich-text
run. Weight options and Italic availability are intersected across those real
faces; a mixed range can no longer borrow a capability from only its first run.
Pending caret formatting remains the source for the next insertion, and the
existing range command remains one grouped transaction.

Additional commands actually run:

```text
pnpm exec biome check packages/editor/src/components/Typography/typographyCommand.ts packages/editor/src/components/Typography/typographyCommand.test.ts packages/editor/src/components/Typography/fontWeight.ts packages/editor/src/components/Typography/fontWeight.test.ts packages/editor/src/components/FloatingTextBar/FloatingTextBar.tsx packages/editor/src/components/ContextControlBar/ContextControlBar.tsx
pnpm exec vitest run packages/editor/src/components/Typography/typographyCommand.test.ts packages/editor/src/components/Typography/fontWeight.test.ts packages/editor/src/components/FloatingTextBar/FloatingTextBar.test.tsx packages/editor/src/components/ContextControlBar/ContextControlBar.test.tsx --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
pnpm verify:plan
pnpm verify:affected
```

Passed: Biome and all 77 focused tests. `verify:plan` selected the shared
worktree full-gate escalation; `verify:affected` exited 2 at that required
escalation boundary without running the broad closure. Existing Chromium
toolbar screenshots remain the visual evidence for geometry and readability.

## Native WDIO continuation — 2026-09-14

Added `tests/wdio/font-native.e2e.ts` to exercise native enumeration, nested
family filtering, stable de-duplication, and exact artifact-byte hashing through
the actual Tauri bridge. `pnpm typecheck:e2e` passed before this addition, and
the new WDIO file passed Biome.

The requested native command was:

```text
VARVE_WDIO_SPECS=./tests/wdio/font-native.e2e.ts pnpm test:desktop:native
```

It stopped in `apps/desktop`'s `build:wdio` TypeScript step before launching
Tauri. After the linked-story type fixes in `be0fe69d47c12998b312c0d9f9595082a1800d27`,
the remaining diagnostics are confined to concurrent/shared editor files
(`Menubar.tsx`, `inputPipeline.ts`, `wheelClassifier.ts`,
`ManageLayoutsDialog.tsx`, `geometry/vectorOps.ts`, `snapping.ts`, and
`workspace/layoutVariants.ts`). No font file or font-recovery diagnostic
remains in this build lane, but no native WDIO pass is claimed. The executable
next check is to rerun this exact spec after that shared build lane is repaired.

## Website visual continuation — 2026-09-14

The typography and provider marketing surfaces received a final narrow-layout
polish: inline axis code tokens no longer split inside the token. The current
Astro build and both base-path outputs were rebuilt successfully.

Commands actually run:

```text
pnpm --filter @varve/website build
pnpm build:website:pages
CI=1 VARVE_WEBSITE_E2E_PORT=1753 VARVE_WEBSITE_E2E_PORT_ROOT=1754 npx playwright test apps/website/tests/e2e/typography-workflow.spec.ts -c playwright.website.config.ts --project=ghpages --project=custom-domain --reporter=list
```

Passed: both builds (0 errors, five existing Astro hints) and **14/14**
typography/FAQ cases across `/varve` and `/`. Desktop light/dark and narrow
dark captures were inspected. The broader website suite and unrelated global
visual snapshots remain outside this focused proof.

## Linked-story replacement continuation — 2026-09-14

Commits `61b4a27e364066d52f1e9c90d702c6a3873d8519`,
`44ff38f9b39e5e03b89483e4dcdd173e542f03e0` route authoritative text
stories through the same resolver used by ordinary text nodes, styles, and rich
runs. Missing-font detection now retains every frame in a story thread as an
affected location, while replacement updates the story's rich runs once. The
editor adapter scopes the story projection to the selected frame set and merges
the updated story back into the document without changing unrelated stories or
the thread order. The controller now passes stories into its resolver projection
so fonts used only by linked content reach the recovery dialog.

Commands actually run:

```text
pnpm exec biome check packages/engine/src/font/fontResolver.ts packages/engine/src/font/index.ts packages/engine/src/font/fontResolver.test.ts packages/editor/src/components/FontBrowser/applyFontReplacement.ts packages/editor/src/components/FontBrowser/applyFontReplacement.test.ts
pnpm exec vitest run packages/engine/src/font/fontResolver.test.ts packages/editor/src/components/FontBrowser/applyFontReplacement.test.ts --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
pnpm exec biome check packages/editor/src/components/FontBrowser/MissingFontController.tsx packages/editor/src/components/FontBrowser/MissingFontController.test.tsx
pnpm exec vitest run packages/editor/src/components/FontBrowser/MissingFontController.test.tsx --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
```

Passed: Biome and **50 focused tests**. This closes the linked-story
detection/replacement component proof and moves acceptance scenario 13 to
Partial. The editor test now also restores the authoritative story and removes
its manifest entry. A one-step editor-history assertion, preview/cancel UI
flow, durable save/reopen proof, and native restart evidence remain open. The
follow-up test commit is `ea1e3fa246d9ce63ae19a521d5971134f755a9bc`.

## Visual recheck — 2026-09-14

The focused Chromium visual run was repeated on an isolated Vite port after the
linked-story changes. It covers the quick font toolbar at DPR 1, 2, and 3 and
the typography editing workflow, including empty-text cancellation and
OpenType/cluster redraw.

```text
VARVE_E2E_PORT=1492 VARVE_E2E_WORKERS=1 npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts tests/e2e/canvas/typography-editing.spec.ts --project=chromium --reporter=list
```

Passed: **6 tests** in 2.3 minutes. I inspected the light-open, dark-narrow,
and high-contrast-open captures from
`test-results/run-1396279-1492/`; the family field, weight, style, size, and
swatch controls share the 32 px compact control token, the menu remains
readable at all three DPRs, and the narrow menu scrolls without clipping the
active row. The run also confirms the existing empty-text cleanup behavior and
real OpenType redraw path. This is browser visual evidence; native WebKit,
Windows WebView2, and macOS WKWebView proof remain platform dependencies.

## Full-gate continuation — 2026-09-14

Because `pnpm verify:plan` selected the required Tier 5 escalation for the
shared workspace and validation-infrastructure changes, I reran the full gate
after the linked-story and research commits:

```text
VARVE_FULL_GATE_REASON='font typography continuation: linked-story resolver/controller, primary-source UX research, and fresh quick-toolbar visual validation; planner escalated due shared workspace and validation-infrastructure changes' pnpm verify:full
```

The gate did not certify the repository. The full lint pass stopped on existing
diagnostics in shared website/editor files, the architecture audit reported 14
cycles and the current unstable-module/hub-budget baseline, and the affected
engine typecheck stopped on `contentAwareFill/quickCleanup.test.ts` generic
arity plus missing `LutTransform.size` in `lut*.test.ts`. The linked-story
files are absent from the failure list; the earlier native WDIO build boundary
has the same shared editor diagnostics. No unrelated files were changed to
silence this gate.

## Native test-overlay repair — 2026-09-14

The final native investigation isolated an asset-root defect in the Tauri test
overlay. `tauri.test.conf.json` now declares `build.frontendDist: "../dist"`,
and `scripts/desktop/compatibility.test.mjs` parses the overlay and asserts the
same value so a future merge cannot silently produce an `about:blank` WDIO
window. The focused compatibility suite passed **16/16**. A feature-enabled
Rust binary was rebuilt from the existing WDIO Vite bundle; native WebKit
session certification remains pending because this host does not provide
`WebKitWebDriver` or `tauri-driver` and the embedded probe still cannot be
certified here.

```text
node --test scripts/desktop/compatibility.test.mjs
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --features wdio
```

The browser toolbar evidence remains the authoritative visual proof: the
focused Chromium run passed 6/6 at DPR 1/2/3 with light, dark, high-contrast,
and narrow captures inspected. No native pass is claimed from this host.

## Final full-gate checkpoint — 2026-09-14

The required Tier-5 checkpoint was run after the overlay repair:

```text
VARVE_FULL_GATE_REASON='font system final checkpoint: native WDIO test-overlay asset root and documented frontend/website/toolbar validation; planner escalated because shared workspace/toolchain/validation infrastructure is dirty' pnpm verify:full
```

The gate stopped in the workspace typecheck after the architecture audit. The
reported failures are outside the font scope: `contentAwareFill/quickCleanup.test.ts`
generic arguments, the concurrent `inference/models/mobileSam.test.ts`
nullability assertions, and the existing `lut*.test.ts` `LutTransform.size`
diagnostics. The audit also reported the existing 14 dependency cycles,
unstable-module ceiling/budget reports, and hub-budget warnings. No font
diagnostic was emitted. This is the final repository-wide validation result for
this shared worktree; focused font and toolbar checks remain green above.

## Rich-range preview continuation — 2026-09-14

The shared presentation-only preview controller now has a direct browser proof
for the quick toolbar's most failure-prone case: a selected substring in a rich
text node. The new test commits `fa7e450a3` and the evidence record
[`font-rich-range-browser-evidence-2026-09-14.md`](./font-rich-range-browser-evidence-2026-09-14.md)
verify that hovering an exact face changes only the active run, Escape restores
the exact serialized runs, choosing the face commits only that range, and Undo
restores the original runs. The rerun against the current checkout passed.

```text
CI=1 VARVE_E2E_PORT=1827 VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 \
npx playwright test tests/e2e/canvas/typography-editing.spec.ts \
  --project=chromium --reporter=list --timeout=120000 --retries=0 \
  -g "font preview and commit stay scoped"
```

Passed: **1 Chromium test** in 1.0 minute. The acceptance matrix row is recorded
as Partial by `95f171aa0`; native WebKit, Windows WebView2, and macOS WKWebView
captures remain platform dependencies. The compact toolbar geometry and
light/dark/high-contrast visual evidence remain covered by the existing
DPR 1/2/3 capture set.

## Readiness and geometry oracle continuation — 2026-09-14

The existing font-specific Chromium oracle was rerun against the current
checkout. It passed the independent readiness and geometry assertions described
in [`font-geometry-oracle-evidence-2026-09-14.md`](./font-geometry-oracle-evidence-2026-09-14.md):
font-load redraw without interaction, unchanged glyph pixels after selection,
three-line selection bounds, later-line hit testing, live newline growth, and
area-text resize semantics.

```text
CI=1 VARVE_E2E_PORT=1831 VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 \
npx playwright test tests/e2e/canvas/font-geometry-oracle.spec.ts \
  --project=chromium --reporter=list --timeout=180000 --retries=0
```

Passed: **5 Chromium tests** in 2.4 minutes. Captures were inspected from
`test-results/run-1825841-1831/`. The desktop typecheck was also retried, but
it still stops on unrelated Menubar, canvas input/wheel, segmentation,
geometry, snapping, and workspace diagnostics, so the native WDIO build cannot
be launched from this shared checkout. Real-byte worker pixel identity and
native WebKit/Windows/macOS proof remain open.
