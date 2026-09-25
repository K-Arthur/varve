# Design-system completion — baseline and coverage ledger (2026-09-24)

This is the active evidence ledger for the completion pass on `master`.
Starting HEAD: `c8d3b3dd1` (two local commits ahead of `origin/master`).
The checkout already contains another workstream's staged E2E files,
unstaged documentation and website edits, and untracked diagnostics. This
pass owns only explicitly listed files in its commits and does not push.

## Inventory denominator and status

The inventory is **eight editor workspace modes**, Home, shared settings,
menus/overlays, detached-window chrome, and **105 Astro page files** in the
website source. A page-file count is not a count of unique deployed URLs;
the website route families below are reviewed by their actual built URLs.
The denominator is a coverage inventory, not a claim that every control in
every route received an individual browser assertion.

| Surface | Current status | Evidence or next check |
|---|---|---|
| Design, Print, Draw, Photo, Motion, Logo, Email, Codegen | Visually verified | One document survived switching through all eight modes. Each mode's panel and toolbar capture was opened and inspected; 200% text and a narrow forced-colors layout were also reviewed. |
| Home search | Repaired and browser verified | Results route to file opening, project navigation, or persisted template creation. The template gallery receives the loaded inventory. Focused unit and Chromium checks pass. |
| Shared settings and theme/density lifecycle | Visually and browser verified | Light/dark/high-contrast settings and three repeated theme/density/dialog/document cycles passed; token contrast remains 315/315. |
| Menus, overlays, Guide Layouts | Repaired and browser verified | The settled nested select, menu, selected layer, and 1×/2× canvas overlays were inspected. Modal, focus, no-target, and Escape checks pass. |
| Detached-window chrome | Reviewed fallback; native smoke inapplicable | The high-contrast invalid-route state passed; this pass changed no native window integration. |
| Website home/product/features/docs/support/learn/download/legal | Reviewed; changed home and product scenes verified | Both base paths build 105 pages. Eight reviewed homepage captures cover desktop/mobile light/dark. The latest full E2E run passed 578/580; its two screenshot-wait failures had pixel-identical artifacts and passed on exact rerun after the assertion budget was corrected. |

## Findings and acceptance

| ID | Severity | Evidence and cause | Acceptance |
|---|---|---|---|
| DS-01 | High | `pnpm audit:radius` fails on nine raw radii: five in Guide Layouts, four in Inspector preset controls. Token audit passes 315 pairs and usage. | Replace only with intent-matched semantic radius roles; radius and affected validation pass; inspect changed surfaces before/after. |
| DS-02 | High | Guide Layouts uses a non-modal `<dialog open>` with a `::backdrop` rule that cannot paint a modal backdrop. Existing full-window captures are stored with this audit. | `:modal` is true, foreground controls are unobscured and actionable at 1280/390px, focus is contained and restored, Escape/Cancel abort preview, Apply remains one undo step. |
| DS-03 | High | Home search renders project and template matches but sends their IDs to `onOpenFile`; HomeShell only resolves file IDs. | Pointer and keyboard results open the selected project or create from the selected template; close returns focus appropriately; no silent action. |
| DS-04 | Medium | Quick Actions changes `aria-selected` while focus stays in search input, without `aria-activedescendant`. | Arrow navigation exposes the active option to assistive technology; Enter invokes it and empty results remain stable. |
| DS-05 | Medium | Homepage snapshot contains pre-correction competitor copy; `visual.spec.ts` allows a 2% pixel difference that can miss a small text change. | Inspect and approve current desktop/mobile light/dark captures; assert critical product copy semantically and update only changed baselines. |
| DS-06 | Medium | Screenshot validator allows a captured website PNG without its canonical docs copy; `comic-lettering-light.png` is one such case. | Validator checks both copies and matching content hashes for captured scenes; repair the missing copy through the review/sync pipeline. |
| DS-07 | Medium | Real Home capture: a `Brand Starter` template query initially highlighted the shorter `Brand` project above it; Enter would navigate away from the requested template. | An exact name match is active ahead of earlier partial matches; ARIA state and Enter agree. |
| DS-08 | High | `Quick Actions` is bound to Ctrl+Shift+semicolon with `key: ';'`, but the browser reports `key: ':'` for that keystroke; the onboarding tip also omits Shift and conflicts with the guide-visibility shortcut. | The physical shortcut opens the command surface; arrow movement updates the exposed active option; empty results and Escape remain stable. |
| DS-09 | High | A real editor contrast probe caught the Light/Logo active workspace pill at **3.81:1** (label `rgb(248,245,239)` on `rgb(150,121,46)`) 120ms after switching. The final semantic token pair passes at 4.78:1, but the base `.workspace-dock__item` color/background transition lasts 150ms and also applies to the active pill. | The active foreground/background pair changes atomically; rendered contrast stays at least 4.5:1 through every workspace and theme switch, and the active pill has no color transition. |
| DS-10 | Medium | Resources LibraryPanel renders an Uninstall button inside a row button. The nested interactive markup has an invalid focus tree and gives selection and removal overlapping keyboard targets. | Selection and Uninstall are separately named sibling buttons; Enter/Space invoke only the chosen action, and focus moves to the next surviving control when a library is removed. |
| DS-11 | High | At 1280×720 the floating tool palette begins at x=295 while the open Resources panel ends at x=588, covering selected library details. The palette's z-index is one layer above the panel. | Details remain visible and hit-testable; the palette begins beyond the panel edge at its default and keyboard-resized widths, without hiding essential tools. |
| DS-12 | High | The real import → uninstall → Ctrl+Z path leaves the library removed. Both actions bypass an owned transaction; an empty import materializes an absent optional `styles` map, producing an unreplayable history hash; and the docked Resources panel falsely declares `aria-modal="true"`, so the global shortcut handler suppresses Ctrl+Z within it. | Install and uninstall are transaction-captured; an empty import retains the absent styles field; Resources has non-modal semantics; the history round-trip passes and one Ctrl+Z restores the library. |
| DS-13 | Medium | Chromium alternates the stitched document height of long website screenshots by 2–15px; the Workspaces capture even failed with pixel-identical expected and actual images. Homepage, Download, and Workspaces visual tests depend on this unstable full-page height. | Capture the intended main content region, retain separate header/footer coverage, inspect replacement baselines, and pass no-update visual checks. |
| DS-14 | Low | The corner-radius corpus visits all static routes and the reflow corpus visits 54 route/viewport pairs. Their default 45-second test budget expires under shared load before an assertion fails. | Give only those route-wide cases bounded 180/120-second budgets and pass both base paths without reducing their route or viewport denominator. |

## Foundation repair evidence

The Guide Layouts host now uses the shared `Dialog`, `Button`, and `Select`
components. This puts the dialog in the browser top layer, gives its footer
the shared action sizing, and keeps the two choice controls consistent with
other editor forms. The five raw radii in that host and four in Inspector
frame presets now use their semantic control or pill tokens. The small
Inspector preset actions use the shared extra-small control height. No token
palette or authored artwork colors changed.

The focused Chromium grid-system run passed **2/2** after the repair. A later
two-spec run passed **2/2**, covering `:modal`, internal focus, a nested select
choice, 390px geometry, no-target and invalid-input gating, Escape cancellation,
focus return, and the Inspector preset filter. The four Guide Layouts
before/after screenshots and the Inspector screenshot below were opened and
inspected. The repaired dialog has a backdrop, centered placement, visible
labels, and no clipped fields at either width. The Inspector category and
favorite hit areas settle at 24 CSS pixels. The first geometry assertion
sampled 23.67px during the shared floating layer's `scale(0.97)` entrance;
the winning `min-height` declaration resolves to the 24px token after that
animation. This was a transient measurement, so the regression test polls
for the settled state.

- `docs/screenshots/2026-09-24-design-system/guide-layouts-after-desktop.png`
- `docs/screenshots/2026-09-24-design-system/guide-layouts-after-narrow.png`
- `docs/screenshots/2026-09-24-design-system/frame-presets-after.png`

## Home workflow repair evidence

The command palette previously sent every result ID to a file-only callback;
project and template selections closed the palette without an action. It now
dispatches each result kind to its owning HomeShell path. Project navigation
uses the existing persisted view state, while both template entry points await
`platform.upsertFile` before opening the new document and report storage
failure. The gallery now receives the already loaded template inventory and
shows its count. The Home heading follows the selected project, and dismissing
search returns focus to its invoker or Home main content. The active result
now prefers an exact name match; a screenshot exposed the `Brand Starter`
template versus `Brand` project ambiguity before that repair. The matching
option is also exposed through `aria-activedescendant` while focus stays in
the search field. Focused Home units passed **20/20**, the exact-match unit
rerun passed **12/12**, and the lease-wrapped Chromium workflow passed **2/2**
after the final change. Both retained Home screenshots were opened and
inspected: the project result is visibly active, and the exact template is
active below the partial project match. Project navigation moves focus to
Home main content; Escape returns it to the invoker.

- `docs/screenshots/2026-09-24-design-system/home-search-project.png`
- `docs/screenshots/2026-09-24-design-system/home-search-template.png`

## Quick Actions workflow repair evidence

The shortcut registry now matches the browser's shifted semicolon key and the
onboarding tip names the physical keys. The search field exposes its listbox
and active option with `aria-controls` and `aria-activedescendant`; empty
results have no active descendant. A strict browser scenario replaces the
former optional visibility check and passes in Chromium. Playwright synthesizes
`key=';'` for Shift+semicolon, unlike the printed `':'` from a physical US
keyboard, so the browser test sends the printed character explicitly. The
focused Quick Actions and shortcut units pass **49/49**. The retained editor
screenshot was opened and inspected: the search field, active result, and
remaining command rows are visible within the viewport.

- `docs/screenshots/2026-09-24-design-system/quick-actions-open.png`

`pnpm audit:spacing:report` reports 333 raw declarations in 259 buckets,
and `pnpm audit:sizing:report` reports 69 ratcheted declarations in 54
buckets. They are debt inventories, not evidence that all consumers should be
rewritten. The Inspector CSS audit passes its enforced rules and reports
remaining warning-only debt.

## Visual baseline

The existing Chromium Guide Layouts interaction spec passed **1/1** on the
starting code state. Its 1280px and 390px screenshots were opened and
inspected. The dialog has no dimmed or inert background; its header sits at
the top viewport edge, and the narrow layout remains inside the viewport.
The website's committed Guide Layouts product image shows an editor strip
crossing the dialog's upper controls, which requires a fresh frame-based
reproduction before claiming that exact overlap is current.

- `docs/screenshots/2026-09-24-design-system/guide-layouts-before-desktop.png`
- `docs/screenshots/2026-09-24-design-system/guide-layouts-before-narrow.png`

## Marketing site and screenshot evidence

Six current product scenes (Guide Layouts, vector, motion, layout, layers,
and enhancement) were captured from the real editor, opened for visual
review, then synced to the website and canonical documentation copies. The
Guide Layouts frame now shows the modal backdrop and clear controls; the
vector capture backs the camera off enough that the shape and handles are
visible above the floating tool tray. The comic-lettering documentation copy
was restored from the already captured public PNG after its manifest SHA-256
matched. `node scripts/screenshots/validate.mjs` now requires both copies
and the manifest hash for every captured scene: **24 captured, 0 skipped,
0 violations**. The matching website unit tests pass **5/5**.

Both static builds completed with **105 pages** each, for `/` and `/varve`.
The base-path review passed **8/8** light/dark desktop/mobile cases. All
eight full-page images were opened and inspected; each matching viewport
pair has identical SHA-256 bytes across the two base paths. The page has no
horizontal overflow in those cases. The older homepage golden retained a
pre-correction Figma/Illustrator claim because the visual assertion tolerates
2% changed pixels. Four current-copy homepage baselines were force-regenerated
after the review and then opened and inspected at their 1280px desktop and
375px mobile test widths. The visual test also asserts the current hero copy
semantically, so a small future text change cannot hide within the pixel
tolerance. The four focused homepage visual cases pass **4/4**.

The Workspaces documentation now names the verified Resources Library
controls and desktop panel placement. Both base-path builds still produce
**105 pages**. Its 1280px rendered page was opened and inspected after the
copy change; the new paragraph is readable, with no clipped content or
horizontal overflow. The initial 4925px full-page baseline replaced the older
4828px capture. A later browser run exposed alternating stitched document
heights on this and three other long pages, including cases where the actual
and expected pixels were identical. The four affected desktop baselines now
capture `#main-content`; the header and footer retain separate snapshots and
the full-page route screenshots above remain in the review set. All four new
baselines were opened and inspected. The exact failure set passes **8/8**
without update flags: both route-wide geometry/reflow cases under bounded
per-test timeouts and the four stabilized visual comparisons. The website
unit suite passes **239/239** and typecheck reports zero diagnostics. The
planner-selected full E2E rerun passed **578/580**; the two homepage failures
were screenshot-wait timeouts with **zero differing pixels** in their saved
actual and expected images. After assigning those two long-element assertions
a 30-second budget, their exact no-update rerun passed **2/2**. The other
578 cases were already green, so the broad gate was not restarted again.

- `docs/screenshots/2026-09-24-design-system/website/` — both base paths,
  both themes, desktop and mobile.
- `apps/website/tests/e2e/visual.spec.ts-snapshots/home-light-ghpages-linux.png`
  and its dark/mobile peers — accepted current-copy baselines.
- `apps/website/tests/e2e/visual.spec.ts-snapshots/workspaces-docs-light-ghpages-linux.png`
  — accepted Resources documentation baseline.

## Application visual release matrix

The browser review inspected editor settings in light, dark, and
high-contrast themes; selected artwork, layers, collapsed panels, and an
open menu in each theme; and the high-contrast detached-window invalid-route
state. The theme matrix passed **8/8**. The same selected-artwork/menu cases
passed at **2× DPR, 3/3**; their native-resolution captures show visible
selection strokes and handles. No render pixel-reuse code changed in this
pass, so the full-redraw hash oracle is inapplicable.

The workspace sweep passed with one document retained across **all eight**
modes. Each mode capture was opened and inspected: the mode-specific panels,
tools, and empty-state entry points remain visible. A separate 200% UI-text
case passed and its Codegen capture was inspected. The 480px forced-colors
case passed on an exact rerun after an unrelated queued browser process ended
the first three-case invocation before its third test; the narrow capture
shows the workspace control, drawing actions, and canvas still reachable.

Default and Compact Pro density captures of a scrolled, selected layer tree
were inspected. The focused density run passed **2/2**, including three
successive theme, density, dialog, and document lifecycles; controls stayed
responsive and preferences remained visible on reopening settings. The
Guide Layouts nested-select case passed **1/1** after waiting for its
entrance animation before capture. Its settled menu is opaque, legible, and
on top of the modal. The first immediate capture was translucent because it
caught that animation; it was not used as acceptance evidence. Reduced
motion was emulated for the theme and site captures. Modal focus restoration
and narrow Guide Layouts geometry passed the earlier focused interactions.

- `docs/screenshots/2026-09-24-design-system/app-themes/` — theme settings,
  selected overlays, collapsed panels, menus, and detached fallback.
- `docs/screenshots/2026-09-24-design-system/app-2x/` — 2× selected overlays.
- `docs/screenshots/2026-09-24-design-system/workspaces/` — eight modes,
  200% text, and 480px forced colors.
- `docs/screenshots/2026-09-24-design-system/density/` — both densities.
- `docs/screenshots/2026-09-24-design-system/guide-layout-nested-select.png`.

## Rendered workspace contrast

The final wide triage found DS-09 even though `pnpm audit:tokens` passed all
315 resolved pairs. At the 120ms post-switch sample, Light/Logo rendered a
3.81:1 label while the inherited 150ms color and background transition was
still running. The active pill now disables that transition so its audited
foreground and background arrive together. No token values or artwork colors
changed. The real-browser contrast case passed **1/1** across eight modes and
three themes, and the full workspace review passed **11/11**. That review
also covers overflow, APG radio keys, 200% text, 480px forced colors, stable
hit targets, and the one-document invariant. Its early Light/Logo capture was
opened and inspected:
`docs/screenshots/2026-09-24-design-system/workspace-logo-contrast-after.png`.

## Resources library workflow

At 1280×720, the open Resources panel ended at x=588 while the floating
palette began at x=295 and painted above selected library details. The
before capture records the occlusion. The panel resize edge now publishes its
current width to the editor shell; at desktop widths the palette occupies the
remaining canvas area and yields the panel's stacking layer. In the inspected
after capture, the palette begins at x=604, and the version and installation
details are legible. The browser case also checks hit testing and repeats the
geometry assertion after a keyboard resize. Below 900px, the existing
Resources drawer keeps its overlay priority.

The installed-library row had a nested Uninstall button inside its selection
button. It now has separately named sibling controls: Enter selects and
expands details, Space removes only the targeted library, and focus moves to
Import File before the removed row disappears. The docked Resources panel no
longer claims to be modal because focus can reach other editor controls. This
also allows the existing global Ctrl+Z handler to run from a focused library
control.

The first import → uninstall → undo browser run exposed a deeper history
failure. Install and uninstall now enter the existing owned document
transaction, and an empty library import no longer creates an optional empty
`styles` field that changed the history hash. The focused history and scene
tests pass **23/23**. The final lease-wrapped Chromium case passes **1/1**
through import, independent keyboard controls, default and resized panel
placement, uninstall focus, and one-step Ctrl+Z restoration. Both images
below were opened and inspected.

- `docs/screenshots/2026-09-24-design-system/library-panel-before-overlay.png`
- `docs/screenshots/2026-09-24-design-system/library-panel-after.png`

## Dispositions and limits

| Item | Disposition | Evidence |
|---|---|---|
| DS-01 to DS-08 | **Fixed** | The repairs and focused acceptance checks above cover the radius roles, modal Guide Layouts workflow, Home routing and exact match, Quick Actions keyboard and ARIA state, current-copy homepage baselines, and screenshot manifest integrity. |
| DS-09 | **Fixed** | The active pill's foreground/background pair snaps atomically; the rendered contrast and zero-duration transition assertions pass in Chromium. |
| DS-10 to DS-12 | **Fixed** | The library controls, palette placement, and history round-trip pass focused units and the real-browser workflow; inspected captures show the covered details before and their readable state after. |
| DS-13 and DS-14 | **Fixed** | The four inspected main-content baselines and both complete route corpora pass the eight-case exact rerun; 578 other site cases passed the latest full run, and the two screenshot-wait cases passed their final exact rerun. |
| Raw spacing and sizing inventory | **Deferred debt** | The starting count was 333 spacing declarations; the current audit reports 332 in 258 buckets after a separate Token Sync token-substitution commit. Sizing remains at 69 declarations in 54 buckets. Their audits pass, and the reviewed consumers show no defect calling for a bulk substitution; mechanical replacement could change expert density without improving a verified workflow. |
| Adobe-style contextual bar loss on another monitor | **Untested hardware** | The in-browser selection-bar regression checks the canvas edge and click path. Physical multi-monitor movement, Windows display scaling, and a 4K panel were unavailable; the 1×/2× selection-overlay captures cover the available DPR comparison. |
| Full-redraw pixel oracle | **Inapplicable** | None of this pass's owned product changes touch pixel reuse or frame admission. Concurrent renderer changes belong to another workstream and are validated separately. |
| Linux Tauri native smoke | **Inapplicable** | This pass changed the browser E2E bootstrap, not Tauri window integration or native code. The detached-window fallback was exercised in Chromium. |

No verified in-scope defect remains blocked. Browser checks cannot establish
screen-reader announcements or native platform behavior. **Untested
combinations** are Windows and macOS desktop builds; physical fractional or
4K display scaling and multi-monitor placement; and NVDA/Windows, JAWS/Windows,
VoiceOver/macOS, and Orca/Linux. Forced colors and reduced motion were
emulated in Chromium. The theme/density lifecycle run produced existing React
`flushSync` console warnings, and some visual cases logged a Vite
`ResizeObserver` loop warning; the exercised controls still passed. These
warnings require a separate reproduction tied to failed behavior before they
can be classified as design-system defects.

Research-to-decision details are appended to
`docs/research/design-system-overhaul-2026-09-17.md`.

## Agent Validation Report

**Changed scope:** Design-system audit/research and architecture docs; radius
and shared Guide Layouts/Inspector controls; Home search and template workflow;
Quick Actions; workspace dock; Resources library controls, placement, and
history; website copy, screenshot contract, inspected captures, and visual
baselines. The Resources repair is `c1adf5dd9`; its staged diff contained only
the 15 owned paths, with no new `Shell.tsx` or `context.tsx` imports.

**Validation plan:** `pnpm verify:plan` was run at each milestone. The final
Resources plan selected touched-file format/lint, docs/emoji/spacing/sizing,
E2E typecheck, four exact unit files, one exact Chromium workflow, editor and
scene unit/typecheck lanes, and downstream package unit/typecheck lanes.
`FULL-SUITE ESCALATION: NO`. Rust/native tests, the unrelated website E2E
lane for that product commit, and the global visual suite were excluded by
the planner; changed site and editor visuals were exercised separately.

**Commands actually run, with results:**

| Command | Result |
|---|---|
| `pnpm verify:plan` / `pnpm verify:plan --staged` | Milestone and final plans inspected; no final full-gate escalation. |
| `pnpm verify:affected` / `pnpm verify:affected --staged` | Milestone affected checks passed except the final broad editor unit lane described below. Its Tier 0 and Tier 1 checks, including the exact Resources Chromium test, passed. |
| `pnpm audit:docs`, `pnpm audit:emoji`, `pnpm audit:tokens`, `pnpm audit:radius`, `pnpm audit:spacing`, `pnpm audit:sizing` | Docs and emoji clean; token audit 315/315 contrast pairs and usage clean; radius zero violations; spacing and sizing within their ratcheted baselines. |
| `node scripts/audit-architecture.mjs --ci`, `node scripts/audit-health.mjs --staged` | Passed. Existing hub import warnings remain; the Resources commit adds zero imports to the guarded hubs. |
| `pnpm exec vitest run packages/editor/src/backgroundRemoval/maskRenderCache.test.ts packages/editor/src/canvas/__tests__/renderPipelineBaseline.test.ts --maxWorkers=1` | 2 files, 8 tests passed on the settled tree. |
| `pnpm -r --filter @varve/editor --filter @varve/scene --filter @varve/desktop --filter @varve/ai --filter @varve/cli --filter @varve/codegen --filter @varve/collab --filter @varve/history --filter @varve/home --filter @varve/import --filter @varve/layout --filter @varve/print --filter @varve/prototype --filter @varve/ui --filter @varve/website typecheck` | Fourteen selected packages reported `Done`; the aggregate process ended with code 143 while desktop was running. `pnpm --filter @varve/desktop typecheck` then passed directly. |
| `pnpm exec vitest run apps/desktop packages/ai packages/cli packages/codegen packages/history packages/home packages/import packages/layout packages/print packages/prototype packages/scene packages/ui apps/website --maxWorkers=3` | 430 files and 5,596 tests passed; one existing skip. |
| `pnpm test:website`; both static website builds; website Playwright E2E | 239/239 units, 105 pages at each base path. E2E passed 578/580; the two homepage screenshot-wait failures had zero differing pixels and passed 2/2 after their bounded assertion timeout was corrected. The eight-case failure set also passed 8/8 without baseline updates. |
| Lease-wrapped single-worker Chromium scenarios for changed editor interactions and visual surfaces | Resources 1/1; Guide Layouts 2/2; Home 2/2; theme matrix 8/8; 2× overlays 3/3; density 2/2; workspace review 11/11; other focused cases are recorded above. Captures were opened and inspected. |

The broad editor unit lane ran **807 files**: 803 passed, two skipped, and two
failed with three assertions while another workstream was changing
`maskRenderCache.ts` and `renderPipeline.ts` in the shared checkout. Those
files are outside this pass's staged diff. Their exact two specs passed
**8/8** immediately afterward; the remaining selected downstream unit and
typecheck closure passed as above. The broad affected command therefore
exited nonzero, and this report preserves that fact rather than presenting
it as a clean single-command gate.

**Skipped as unrelated:** Rust workspace tests and native release/package
checks had no owned Rust or desktop integration change. The full Playwright
suite and full repository Vitest suite were not selected. The website's own
full E2E run and focused editor/browser visual matrices covered the changed
surfaces. **Escalations:** none; `pnpm verify:full` was not run. **Full suite
run:** no. Hardware, operating-system, and screen-reader limits are listed
in the dispositions above. Commits remain local on `master`; no push or
deployment was performed.

**Local milestone commits from this pass:** `984650c79` (baseline and
complaint evidence), `cb38cc770` (Guide Layouts), `a2c81646c` (Home),
`2a804436b` (Quick Actions), `579e9ed62` (product captures and screenshot
contract), `c918fea58` (homepage captures), `a8cbd090c` (editor visual
matrix), `6818d1f8d` (tool name), `bcb1d6160` (workspace contrast),
`e4c830c40` (typography baseline), `ad340aab8` (Resources website copy),
`a9cecf898` (long-page visual checks), and `c1adf5dd9` (Resources controls
and history). The final audit ledger is a separate documentation commit.

**Remaining repository state:** this pass leaves no owned product or site
change uncommitted. The checkout still has another workstream's modified
workspace-switcher captures, validation-repair documentation, and menu E2E
spec, plus its untracked diagnostics/reference files and `install-arch.sh`.
Those files were neither staged nor modified by this pass.
