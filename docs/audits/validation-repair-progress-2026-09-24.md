# Validation repair checkpoint — 2026-09-24

Branch: `master`. The initial full code checkpoint was `4f93cb47f` (pushed).
Subsequent pushed repairs include browser storage and WASM validation
(`24a5a25b5`), document-scoped history capture (`729344137`), and precise
homepage/About copy (`3aa1f4425`). The final full gate on the latest pushed
code checkpoint remains pending; the results below distinguish completed
checks from pending ones.

## Repair and validation ledger

| Area | Baseline/root cause | Repair and current evidence |
|---|---|---|
| Full JavaScript suite | The previous full gate had one failure in 20,596 tests: a single 19.21 ms scheduler-delayed cache-pan sample against a 15 ms limit. | The test now measures five fresh 500-entry caches and requires the median to stay below the same 15 ms limit. The exact spec passed 5/5 in isolation and the full suite passed 20,580 tests at `4f93cb47f` (16 conditionally skipped). |
| Affected selection | A change confined to `cacheSystem.bench.test.ts` queued all 784 canvas browser tests because a source-domain glob also matched colocated tests. | The planner now runs the changed test directly without source-domain E2E or benchmark fanout; renderer source changes still select canvas E2E. Planner regression and policy tests passed. |
| Formatting and lint | The pushed full gate found no errors and 16 `noDescendingSpecificity` CSS warnings. | The 16 warnings are classified below. No lint rule was disabled and no broad stylesheet reorder was made solely to suppress diagnostics. |
| Type safety | Full workspace and E2E TypeScript checks completed at `4f93cb47f`. | Both passed. |
| Native code | Full Rust workspace tests and Clippy completed at `4f93cb47f`. | Both passed; GPU versus CPU resampling and effect tests ran in the native suite. |
| Accessibility and docs | Token contrast, undefined token use, documentation links, and emoji audits were required by affected validation. | All passed; the token audit checked 315 pairs across light, dark, and high-contrast themes. Automated checks do not establish complete screen-reader conformance. |
| Browser and visual | The full-gate browser launch first stopped because a Vite process from this task's interrupted affected run still owned port 1420. A second attempt from the clean checkout revealed repeated WASM fallback warnings: ignored binaries had not been built. | The orphan was stopped. The local full gate now builds baseline, SIMD, and colour WASM like CI, and browser readiness rejects a 200 HTML response at a `.wasm` URL. Generated artifacts passed both focused Chromium specs: 12/12 browser-readiness and 13/13 demo tests. Final broad browser and visual lanes remain pending. |
| Denied browser storage | An affected Chromium rerun exposed a startup timeout in the IndexedDB-denial case. A focused trace then found unhandled `SecurityError` rejections from raster tiles, backups, and recovery; history also disabled undo. | Session-memory fallbacks now keep raster tiles, backups, recovery, and undo/redo available. The exact Chromium case creates a rectangle and verifies undo and redo with zero page errors. The startup timeout did not reproduce in focused reruns; broad validation remains pending. |

The second broad Chromium attempt was stopped after this setup defect was
confirmed; its fallback-renderer passes were not counted as native-WASM
integration evidence. It also produced one document-accent startup timeout
before the accent action began. The focused browser suite with real WASM
completed without a startup timeout. The exact accent spec was then rerun
against generated WASM and passed 3/3 cases, including pixel equality, saved
state, and reload persistence.

The website's footer CTA, 200% text reflow, and reviewed visual baselines were
committed earlier in this repair sequence (`3083b77cc`, `9d3d9b23d`,
`9e18c5912`, `c6eca8e7a`). The push checkpoint at `4f93cb47f` also passed
the website unit corpus (239 tests).

The final homepage/About copy correction passed `pnpm verify:affected --staged`
with 572/572 website Chromium checks, 239/239 website unit tests, both site
base paths built, and `astro check` reporting zero errors, warnings, or hints.
The browser run included visual baselines, axe, keyboard use, touch layouts,
and 200% text reflow. The focused copy spec also passed 6/6 checks on the
GitHub Pages and custom-domain builds. Fresh 1280 px and 390 px screenshots
of both pages were inspected: the copy wraps cleanly and neither page has
horizontal overflow. The site build's environment guard reported unused host
variables as expected; it consumed only the three allowed client-safe values.

## Exact-SHA full-gate and remote-CI follow-up

The clean detached checkout at `3aa1f4425` passed repository Biome with zero
errors and the 16 classified CSS warnings, emoji and architecture/health
audits, workspace and E2E TypeScript, CI tooling tests, real baseline/SIMD/
colour WASM builds, and the full JavaScript suite (1,769 passed files,
20,586 passed tests; 13 files and 16 tests conditionally skipped). A jsdom
`window.open()` notice came from its deliberately unimplemented browser API;
it did not fail a test. Rust workspace tests initially stopped because a
binary compiled before this task-owned checkout moved from `/tmp` to
`/var/tmp` embedded the old `CARGO_MANIFEST_DIR`. All affected native
packages were rebuilt at the current path; the exact agreement test, full
Rust workspace tests, and workspace Clippy with `-D warnings` then passed.
The Chromium lane reached case 33 without a failure (five desktop-only cases
were skipped), including real-WASM readiness, denied IndexedDB, axe, keyboard
focus, and document accent, before this task stopped it to repair newly
visible remote CI failures. Final Chromium and
visual lanes remain pending on the new code checkpoint.

[GitHub CI at `3aa1f4425`](https://github.com/K-Arthur/varve/actions/runs/36083041078)
and its [platform build](https://github.com/K-Arthur/varve/actions/runs/36083041060)
started jobs normally and exposed four separate failures:

| Lane | Root cause | Repair and current verification |
|---|---|---|
| Pipeline validation | `release-candidate.yml` quoted a `${{ inputs.mode }}` expression inside an `if`, which actionlint evaluates as always true. | Use `inputs.mode == 'final'` directly. The pinned actionlint 1.7.7 binary validates all 11 workflows locally with no findings. |
| Windows typecheck | `PluginSections.tsx` and `pluginSections.ts` differ only by case before the extension. Windows resolved the `.ts` registry for the component import and TypeScript reported TS2305, TS1149, and TS1261. | Rename the renderer to `InspectorPluginSections.tsx` and update its two imports. A case-folded `.ts`/`.tsx` basename scan has no collisions; the affected editor and desktop unit/typecheck closure passes locally. Windows runner confirmation is pending. |
| macOS typecheck | Node 26 on arm64 gave the editor TypeScript process a 2,050 MB heap; it aborted near that limit while checking the editor. | Set a 4,096 MB heap for the build workflow's typecheck step. The configured V8 limit is 4,144 MB locally. macOS runner confirmation is pending. |
| Ubuntu JavaScript tests | One Menubar structure test queried accessible menu items during the portal's hidden measurement phase; all other 20,581 tests passed there. | Wait for the entire Object menu to become accessible, retaining every role/name assertion. The direct Menubar test and the 800-file/7,843-test affected editor corpus pass locally. Ubuntu runner confirmation is pending. |

The repair's `pnpm verify:plan --staged` selected six files, editor and desktop
checks, Inspector CSS, spacing, emoji, and 315 token pairs, and required a
full-suite escalation because workflow files changed. `pnpm verify:triage
--staged` completed every affected lane: 28 Menubar, 8 plugin renderer, and
28 PropertiesPanel direct tests; 7,843 editor tests; 80 desktop tests; both
package typechecks; and the selected audits. `pnpm verify:affected --staged`
correctly exited with the planner's escalation notice before running tests.

## CSS warning classification

The 16 warnings all flag a lower-specificity base selector written after a
more-specific selector. CSS specificity still gives the earlier contextual
selector precedence where both match. The declarations are either disjoint
or the contextual declaration deliberately wins:

| Stylesheet | Warnings | Checked relationship |
|---|---:|---|
| `Inspector/inspector.css` | 11 | Shared field, label, control, badge, and segmented-button bases follow section-specific sizing or high-contrast overrides. The contextual selectors have higher specificity; shared bases provide the other properties. |
| `Upscale/UpscaleDialog.css` | 2 | The focus selector sets a shadow; the later base sets handle geometry. The high-contrast background is inside its theme rule. |
| `editor.css` | 3 | Narrow-viewport status-bar hide rules have higher specificity than the later base display rules, so `display: none` remains effective at the declared breakpoints. |

These are documented, non-blocking diagnostics, not evidence of a failing
style gate. If these blocks are reorganized later, compare computed styles and
screenshots at the affected breakpoints and themes before changing their
order. Do not suppress `noDescendingSpecificity` globally.

`wasm-pack` also prints optional crate metadata and tool-version suggestions
while building ignored application assets. Those artifacts are bundled into
the app rather than published as standalone crates, and the build completes.
The Playwright launcher prints a `NO_COLOR`/`FORCE_COLOR` environment warning;
it does not affect browser assertions. Neither warning was hidden to obtain
a passing gate.

## Complaint-informed website check

Primary user reports describe three concrete failures in other design-tool
workflows:

1. [Figma users report that an outage or lost connection prevents opening
   existing files](https://forum.figma.com/suggest-a-feature-11/offline-mode-would-be-great-to-access-design-files-33210),
   including an office outage in a later reply. Varve's `/product/` and
   local-first pages already explain local files, offline core editing, and
   the optional network features separately.
2. [Linux Affinity users report that unofficial AppImage availability and
   version lag can block files saved by newer versions](https://github.com/ryzendew/Linux-Affinity-Installer/discussions/170).
   Varve's download and product pages describe the native Linux packages and
   use the release manifest for availability rather than implying Wine
   compatibility. This comparison does not promise cross-app format parity.
3. [Figma users report a fixed navigation rail consuming canvas space on
   smaller displays](https://forum.figma.com/share-your-feedback-26/figma-your-new-left-hand-menu-panel-is-a-disaster-7th-jan-2026-49352).
   Varve's workspace and layers pages already describe per-workspace panel
   toggles and collapsing panels; the toolbar and inspector recaptures were
   visually reviewed at desktop and compact widths.

These reports are dated user experiences, not claims about every current
competitor release. Website text remains bounded by capabilities exercised
in this repository; no unverified feature promise was added to the site.

The final source check found an existing homepage/About claim that Figma
"requires a browser." [Figma documents desktop apps for macOS and
Windows](https://help.figma.com/hc/en-us/articles/5601429983767-Guide-to-the-Figma-desktop-app),
so that claim was removed. The replacement copy describes the specific
outage-access concern in the user report and Varve's tested local-file model
without implying that Figma lacks a desktop app.

## Shared worktree inventory

All tracked edits in this repair sequence were reviewed, committed on
`master`, and pushed. The remaining untracked files are intentionally left
recoverable because they appear to be separate scratch work: six `zz-*`
Playwright diagnostic/capture specs, `visual-validate-overlap.mjs`, the
unreferenced `tests/reference/` model comparison images, and an unrelated
`install-arch.sh` application installer. Several diagnostics explicitly say
they are throwaway probes rather than assertions. None are part of the
pushed validation checkpoint or its detached full-gate checkout; deleting or
committing them would assume ownership of another investigation.
