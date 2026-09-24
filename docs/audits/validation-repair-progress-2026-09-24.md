# Validation repair checkpoint — 2026-09-24

Branch: `master`. Product and validation-code checkpoint: `4f93cb47f` (pushed).
The final browser lanes are still running at this checkpoint; the results
below distinguish completed checks from pending ones.

## Repair and validation ledger

| Area | Baseline/root cause | Repair and current evidence |
|---|---|---|
| Full JavaScript suite | The previous full gate had one failure in 20,596 tests: a single 19.21 ms scheduler-delayed cache-pan sample against a 15 ms limit. | The test now measures five fresh 500-entry caches and requires the median to stay below the same 15 ms limit. The exact spec passed 5/5 in isolation and the full suite passed 20,580 tests at `4f93cb47f` (16 conditionally skipped). |
| Affected selection | A change confined to `cacheSystem.bench.test.ts` queued all 784 canvas browser tests because a source-domain glob also matched colocated tests. | The planner now runs the changed test directly without source-domain E2E or benchmark fanout; renderer source changes still select canvas E2E. Planner regression and policy tests passed. |
| Formatting and lint | The pushed full gate found no errors and 16 `noDescendingSpecificity` CSS warnings. | The 16 warnings are classified below. No lint rule was disabled and no broad stylesheet reorder was made solely to suppress diagnostics. |
| Type safety | Full workspace and E2E TypeScript checks completed at `4f93cb47f`. | Both passed. |
| Native code | Full Rust workspace tests and Clippy completed at `4f93cb47f`. | Both passed; GPU versus CPU resampling and effect tests ran in the native suite. |
| Accessibility and docs | Token contrast, undefined token use, documentation links, and emoji audits were required by affected validation. | All passed; the token audit checked 315 pairs across light, dark, and high-contrast themes. Automated checks do not establish complete screen-reader conformance. |
| Browser and visual | The full-gate browser launch first stopped because a Vite process from this task's interrupted affected run still owned port 1420. | That orphan was identified by process tree and stopped. Chromium is rerunning on isolated port 1422 under the heavy-task lease, one worker; visual lane remains pending. This was a port conflict, not a test assertion failure. |

The website's footer CTA, 200% text reflow, and reviewed visual baselines were
committed earlier in this repair sequence (`3083b77cc`, `9d3d9b23d`,
`9e18c5912`, `c6eca8e7a`). The push checkpoint at `4f93cb47f` also passed
the website unit corpus (239 tests).

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
