# Font lifecycle continuation — 2026-09-11

Continuation began on clean `master` at `7337ec1ab`. Work committed during the
interruption includes `c2bf35d70`, which contains the previously verified
typing-to-toolbar transaction fix and three inspected images. The fresh check
also reads the new `DESIGN.md` and revalidates the toolbar after the token and
panel changes; September 10 screenshots are not a certificate for the new UI.

## Typing and formatting history

Before repair, the native textarea's blur flushed text but left its typing
transaction open for 500 milliseconds. A toolbar click joined that transaction.
The component regression observed `begin, text, format` instead of
`begin, text, commit, format`. A real Chromium pointer/keyboard workflow then
removed the text layer on Undo rather than just undoing Bold.

`TextEditOverlay` now closes the typing burst before handing focus to a
formatting control. It keeps the text-editing session alive, preserving the
picker's nested Escape behavior and cleanup of an untouched empty text layer.
The restored `font-toolbar-history.spec.ts` pauses the idle timer while typing
and clicking Bold, then checks that one Undo retains the text at weight 400
and Redo restores weight 700. Animation frames resume before screenshots.

September 10 validation: 40 focused component tests passed; the three Chromium
history/typing/empty-layer cases passed; the final capture rerun passed one
case. The initial paused-frame captures contained stale ink and were rejected;
the resumed-frame captures were inspected before being copied into the evidence
directory. This is transaction and UI evidence, not a main/worker glyph oracle.

- [Before Undo](../screenshots/fonts/2026-09-10-history/before-undo.png)
- [After Undo](../screenshots/fonts/2026-09-10-history/after-undo.png)
- [After Redo](../screenshots/fonts/2026-09-10-history/after-redo.png)
- [Capture hashes and scope](../screenshots/fonts/2026-09-10-history/manifest.json)

## Download attempt audit

Four new regressions failed before repair: a cancelled transport could restart
validation when it resolved late; a cancelled validator could overwrite a retry
with either success or failure; and validation did not count toward the queue's
concurrency limit. A zero or non-finite configured limit could repeatedly schedule
an empty batch and starve the event loop. An initial affected run loaded that
old code and was terminated; it is not counted as a completed validation run.

The manager now counts executing attempts through validation and integrity
checking, caps the configured limit at two, and tracks invalidation generations.
Cancellation/pause makes the old generation obsolete; every asynchronous result
checks it before publishing. A retry of the same job waits for the previous
attempt to settle. Finalization releases capacity and drains queued work;
it does not continually reschedule an empty batch. Removed jobs cannot publish
late results.

The tests use the actual licensed Geist artifact and parsed metadata from the
checked-in corpus. Transport and validation scheduling are controlled in these
unit tests; they are not external-network, storage or native restart evidence.
The first focused run passed 26 tests; pause/resume and removal brought it to 28.

Four further transport regressions failed before repair: late progress after
cancellation while awaiting headers, a buffer or a streamed chunk, and no timeout
for a stalled request. The transfer now has a 30-second deadline covering both
headers and body, checks the abort signal after each await, and closes unread
bodies in cleanup. Timer and abort-controller cleanup cannot delete another
controller for the same job. The next focused run passed 33 tests, including
stalled-body timeout and retry. Fetch/stream behavior is controlled in these unit
tests; offline browser UI and native transport proof remain pending.
Operation-wide parser deadlines, storage cancellation, exact uninstall and
restart proof remain pending.

Two integrity regressions then failed: the legacy synchronous helper accepted
any expected hash, and the async verifier returned success when Web Crypto was
unavailable. The synchronous helper now declines supplied hashes and is
deprecated; production async verification reports the missing capability as a
failure. Tests verify the real artifact hash, reject a one-byte mutation and
prevent unavailable SHA-256 from becoming completed installation. The final
focused run passed **35 tests** and the engine compiler passed. The repair is
committed as `2e9664329`; its normal commit hooks passed.
See the [September 12 download checkpoint](font-download-lifecycle-evidence-2026-09-12.md).

## Current design and contrast inspection

All 27 current toolbar layout captures were inspected: Light, Dark and High
Contrast at DPR 1/2/3, closed/open at 1280 CSS pixels and open at 640 CSS pixels.
The latter approximates available width at 200% zoom; it is not native zoom
certification. Both palettes measure 46.796875 pixels high, with 32-pixel controls,
2.88-pixel gaps, 5.76/9.44-pixel padding and 14.72-pixel field text. Family fields
and menus are legible, controls align, and the menu remains inside the viewport.
The surrounding narrow status bar and high-contrast sidebar still have unrelated
truncation; these captures do not certify those surfaces.

The Undo/Redo recapture exposed a hovered active Bold button with white text on a
pale selected surface. The browser contrast regression reproduced **1.329:1**.
The quick toolbar now uses the main floating palette's active/hover token pairs.
The inspected Light captures measure **7.329:1** active and **9.730:1** hovered.
Changing the normal foreground alone would mismatch the dark checked surface;
the final repair changes the hover background and retains the foreground.
All three theme regressions pass. Measured sRGB contrast ratios:

| Theme | Active | Hovered active |
| --- | ---: | ---: |
| Light | 7.329 | 9.730 |
| Dark | 9.821 | 11.587 |
| High Contrast | 19.078 | 19.078 |

The combined run's history case was interrupted by a development-server reload
before its first toolbar click: the trace records navigation to `/` and the
inspected failure image shows Home. The unchanged case passed when rerun with
the existing `VARVE_DISABLE_HMR=1` option. The final Undo/Redo images were inspected
and preserve text, weight 400/700 and widths 232/248 respectively. This remains
working-tree browser evidence, not a frozen-release certificate.

The [capture manifest](../screenshots/fonts/2026-09-11-toolbar/manifest.json)
preserves source paths, image hashes and measured layout JSON. Before-contrast
history images remain explicitly labeled as observations of that defect.

## Affected validation repair

The affected run passed engine units (4,490 tests), engine types, the history
Chromium interaction, E2E types and codegen units (320 tests), then stopped at
duplicate `background` declarations in `packages/codegen/src/svg.ts`. The duplicate
was present in committed `dd4cc8627`, independently of the font changes. Removing
the redundant declaration preserves its existing type and behavior. The targeted
codegen compiler and 29 SVG tests passed; an initial command named a nonexistent
`svg.test.ts` and was corrected to the three actual SVG specs.
The repair is committed on `master` as `92b45d1bb`. Its normal hooks passed.
The private-index helper detected concurrent staging after committing and left
the shared index alone. A subsequent guarded refresh touched only the unchanged
SVG entry after checking its parent blob; unrelated entries were preserved.

The resumed editor lane exposed two stale accessibility assertions: the brush
popover now uses the human-readable name `Paint Brush tool options`, and the
Shell has a contextual toolbar alongside `Drawing tools`. Targeted repairs keep
the focus/Escape assertions and name the main palette explicitly; the complete
affected files pass nine and fourteen tests respectively. The 51 menu snapshot mismatches contain only the five committed clipboard
commands and their context-menu subset. Comparing each serialized snapshot after
removing those new command objects reproduces its previous value exactly.
Both complete menu files pass 95 tests after updating the snapshots, including
a separate run without update mode. These are menu structure checks, not native
platform execution.

The import/export collection passed 16 cases and failed two; two serial cases
did not run. The table case encountered a concurrent Minimap parse error at
startup, but its final failure was independently diagnosed: the Layout submenu
was present with its Table item, while the shared helper searched an obsolete
CSS class. The helper now uses the actual menu and menuitem accessible names.
The large-text PDF case stalled when leaving a 5,000-character text edit; the
unchanged focused rerun reproduced the timeout and retained a Playwright trace.
An initial table rerun hit the 120-second server startup limit. A later run
passed the repaired menu selector and created a 3×3 table, then failed because
the Layers tree contained no items. The complete table workflow remains
unverified. A CPU profile isolated repeated whole-paragraph grapheme segmentation
in the glyph inspector during the large-text timeout. Its repair and closed
Select option allocation are undergoing a separate frontend checkpoint.
These findings remain separate from the passing basic/rich/underline PDF cases.

The broad editor unit process ended with status 143 and no final summary.
Failures observed before interruption included the repaired brush and shell
assertions, the repaired menu snapshots, and an unchanged LayersRow assertion
about a redundant native title (14 pass, one fail in its focused rerun).
The editor compiler also reports existing AIStatusIndicator/ContextAwareShortcuts
state/tool mismatches and SVG import viewBox narrowing errors. This collection
is incomplete and is not a passing editor package gate. Remaining package lanes
continue separately; green lanes are not restarted. Home (179), import (346),
layout (76), print (11), prototype (245), scene (2,874), and desktop (67) unit
tests subsequently passed. Their compilers passed except import (the recorded
SVG narrowing errors); the desktop compiler was interrupted without a result.
AI, CLI, collaboration, history, UI, and website selected lanes still require
completion. These counts describe the recorded working trees, not the later
concurrent application changes.

The remaining planner-selected lanes resume at compositor, once, using the same
lane resolver. Already-green package lanes are not restarted after each repair.
Concurrent clipboard and panel implementation changes remain outside the font commit scope. The Shell test repair was included in concurrent commit `c23e6c8dc`; it is not staged again here.

## Website help and visual ownership

The help now explains that Undo reverses a toolbar formatting choice separately
from the typing that preceded it. Visual inspection also caught joined words
around Astro inline tags; explicit source whitespace fixes those boundaries.
Both website base-path builds pass with 84 generated pages. The typography
feature/help and FAQ browser suite passes 14 cases across the two base paths;
that run preceded the final whitespace-only repair. After the repair, both
builds were repeated and six final help captures were inspected: desktop Light,
desktop Dark and narrow Dark for each base path. The changed paragraph measures
800 pixels wide on desktop and 358 pixels within a 390-pixel narrow viewport,
with no horizontal clipping. The capture manifest includes all **45 inspected
images** and 16 measurement files. Product screenshot assets/manifests are
unchanged in this continuation.

- [Light hover before repair](../screenshots/fonts/2026-09-11-toolbar/before-light-hovered.png)
- [Narrow help after repair](../screenshots/fonts/2026-09-11-toolbar/help-root-narrow-dark-history.png)
- [All inspected captures and hashes](../screenshots/fonts/2026-09-11-toolbar/manifest.json)

## Budgets and remaining proof

| Contract | Evidence in this continuation | Remaining check |
| --- | --- | --- |
| At most two download attempts | Config clamped to 1–2; executing validation retains capacity; controlled concurrency assertions pass | Browser offline/restart and storage cancellation |
| Bounded network transfer | 30-second header/body timeout and retry assertions pass | Operation-wide parser worker deadline and decompression memory bound |
| Shared toolbar dimensions | 46.796875-pixel palette, 32-pixel controls; 27 inspected layout captures | Actual browser 200% zoom, embedded WebKitGTK |
| Readable active formatting | Three theme tests, minimum measured 7.329:1 after repair | Other states/surfaces outside this scoped regression |
| Catalog p95 opening/search/preview | Not measured | 1,000/10,000 families, warm p95 150/100/150 ms |
| Main/worker text parity | Not measured | Exact face/axes/glyph and pixel-reuse oracle |

Linux Chromium owns these browser measurements. Linux Tauri/WebKitGTK still
needs the new font-specific embedded WDIO workflow; Windows WebView2 and macOS
WKWebView require native CI/manual execution in those environments. The user
impact is unverified native permission, exact face discovery, restart and
rendering parity. No native certification is inferred from Chromium captures.

## Commands and validation status

```sh
pnpm verify:plan
pnpm verify:affected
VARVE_TEST_WORKERS=1 pnpm exec vitest run packages/engine/src/font/fontDownloadLifecycle.test.ts --testNamePattern 'cancellation|validator|validation in'
VARVE_TEST_WORKERS=2 pnpm exec vitest run packages/engine/src/font/fontDownloadLifecycle.test.ts packages/engine/src/font/fontDownloadManager.test.ts
VARVE_TEST_WORKERS=2 VARVE_E2E_PORT=1471 VARVE_E2E_OUTPUT_DIR=font-lifecycle-affected pnpm verify:affected
VARVE_E2E_PORT=1472 VARVE_E2E_OUTPUT_DIR=font-toolbar-sep11 VARVE_E2E_WORKERS=1 pnpm exec playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts --project=chromium --reporter=list
node reports/font-lifecycle-2026-09-11/resume.mjs
pnpm --filter @varve/codegen typecheck
VARVE_TEST_WORKERS=2 pnpm exec vitest run packages/codegen/src/svg-color-codegen.test.ts packages/codegen/src/__tests__/svg-warp-export.test.ts packages/codegen/src/__tests__/svg-adjustment-export.test.ts
VARVE_E2E_PORT=1473 VARVE_E2E_OUTPUT_DIR=font-toolbar-contrast-before VARVE_E2E_WORKERS=1 pnpm exec playwright test tests/e2e/canvas/font-toolbar-contrast.spec.ts --grep 'in light' --project=chromium --reporter=list
VARVE_E2E_PORT=1474 VARVE_E2E_OUTPUT_DIR=font-toolbar-contrast-after VARVE_E2E_WORKERS=1 pnpm exec playwright test tests/e2e/canvas/font-toolbar-contrast.spec.ts tests/e2e/canvas/font-toolbar-history.spec.ts --project=chromium --reporter=list
pnpm audit:docs
pnpm audit:tokens
pnpm audit:emoji
pnpm --filter @varve/engine typecheck
pnpm typecheck:e2e
VARVE_DISABLE_HMR=1 VARVE_E2E_PORT=1475 VARVE_E2E_OUTPUT_DIR=font-toolbar-history-final VARVE_E2E_WORKERS=1 pnpm exec playwright test tests/e2e/canvas/font-toolbar-history.spec.ts --project=chromium --reporter=list
pnpm build:website
pnpm build:website:pages
VARVE_WEBSITE_E2E_PORT=4471 VARVE_WEBSITE_E2E_PORT_ROOT=4472 pnpm exec playwright test -c playwright.website.config.ts apps/website/tests/e2e/typography-workflow.spec.ts --workers=1 --output=test-results/font-lifecycle-website
node reports/font-lifecycle-2026-09-11/capture-help.mjs
VARVE_TEST_WORKERS=1 pnpm exec vitest run packages/editor/src/menu/__tests__/menuSnapshot.test.ts packages/editor/src/menu/__tests__/nativeAdapter.test.ts --update
node_modules/.bin/vitest run packages/editor/src/menu/__tests__/menuSnapshot.test.ts packages/editor/src/menu/__tests__/nativeAdapter.test.ts --maxWorkers=1
VARVE_DISABLE_HMR=1 VARVE_E2E_PORT=1476 VARVE_E2E_OUTPUT_DIR=font-integration-import-export VARVE_E2E_WORKERS=1 pnpm exec playwright test tests/e2e/export tests/e2e/canvas/table-import.spec.ts tests/e2e/lut/lut-import.spec.ts tests/e2e/gradient-map/import-workflow.spec.ts --project=chromium --max-failures=5 --reporter=list
```

Durable command output lives under `reports/font-lifecycle-2026-09-11/`.
Current toolbar/help captures are inspected; the selected affected closure is incomplete as detailed above.
All 24 end-to-end acceptance scenarios remain open; platform runs and the earlier
schema/foundational integration's full final gate remain required.


## Agent Validation Report — continuation checkpoint

```text
Changed scope: engine font download lifecycle; quick toolbar active-hover token; focused font/history/contrast tests; typography help; font architecture, acceptance matrix and 45 inspected captures. SVG type repair committed separately as 92b45d1bb. Concurrent panel/clipboard implementation preserved.
Validation plan: isolated font scope selects touched format/lint, direct units and Chromium, engine and reverse dependency units/types, docs/emoji audits and website lanes (83% selected; no full-suite escalation). Shared table-helper repair separately selects broad E2E and remains outside this checkpoint's font index.
Commands actually run: exact command list above; local output under reports/font-lifecycle-2026-09-11/. The resumed lane script uses the affected planner's laneCommand resolver and bounded compiler/unit deadlines.
Passed: 35 final focused font download tests; engine compiler; earlier engine package 4490 tests and codegen 320 tests; repaired codegen compiler and 29 SVG tests; compositor 57 tests and compiler; brush 9 tests; Shell 14 tests; menus 95 tests; toolbar contrast 3 cases; final history 1 case; toolbar layout 3 DPR cases/27 captures; website 14 typography/FAQ cases and both 84-page builds; final help captures inspected; docs audit clean. Earlier current-token audit passed 153/153 checks across three themes.
Skipped as unrelated: Rust workspace tests and full visual suite (no native or global renderer changes in this checkpoint). Native font checks are pending platform proof, not passed or waived.
Escalations: one affected closure collected; editor unit run interrupted with no summary; existing LayersRow assertion and editor/import compiler failures recorded; 5000-character PDF edit-exit timeout reproduced and profiled; table selector reaches creation but the Layers-tree assertion still fails. Broader selected checks remain incomplete. No full integration certification.
Full suite run: no
If yes, reason: not applicable; earlier schema/foundational integration still requires its explicit final full gate.
```
