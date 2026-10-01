# Design-system audit — 2026-09-27

Status: audit complete, implementation in progress (this document is the
living record; the final section is completed at the end of the session).

Method: read-only reconnaissance (source + docs + running-product harness
inventory), online research on the specific failure classes found, then
evidence-backed implementation. No pre-existing change was reverted, staged,
or committed by this session. Base: `master` at `757e507e3`.

## 1. What was audited

- Foundations: `packages/ui/src/tokens/` (color/spacing/sizing/typography
  ramps, `SEMANTIC` themes, generated `tokens.css`), `themeRuntime.ts`,
  pre-paint scripts in `apps/desktop/index.html`, generator
  `packages/ui/scripts/generate-token-css.ts`.
- Guardrails: `pnpm audit:tokens` (315 WCAG pairs x 3 themes + undefined
  reference scan), `audit:spacing`, `audit:sizing`, `audit:inspector-css`,
  `audit:emoji`, `audit:docs`, `audit-radius`, stylelint (`lint:css`),
  Biome, `button-system`/`slider-system`/`ButtonVariantParity` unit gates.
- Components: full `@varve/ui` inventory, adoption across
  `packages/editor`, `packages/home`, `packages/help`, dialogs and overlays
  (against `docs/audits/dialog-review-2026-09-15.md`), focus management,
  state coverage, dead exports.
- Surfaces: editor shell, Home, Help, website (documented parallel
  vocabulary), detached/auxiliary windows, pre-paint theme/density path.

Baseline before any edit (all pass):

```text
audit:emoji   — clean (5056 files)
audit:docs    — clean (1083 docs, 645 links, 176 ADRs)
audit:tokens  — all 315 pairs pass across 3 themes; usage scan clean
audit:spacing / audit:sizing — ratchet-clean
audit:inspector-css — clean (22 stylesheets)
```

`pnpm verify:plan` before edits: 264 changed files (all from concurrent
sessions), Tiers 0–4 selected, **no full-suite escalation**.

## 2. Findings (with evidence)

### F1 — Two div-based modals never receive focus management (High)

| Surface | Evidence |
|---|---|
| `packages/editor/src/components/ImportResults.tsx:112-146` | `role="dialog" aria-modal` on a plain `div`; the whole file contains **zero** `focus()` calls, no `FocusTrap`, no `Dialog`. Escape handled only by an `onKeyDown` on the div, i.e. only when focus already happens to be inside. Hand-rolled close button. |
| `packages/editor/src/panels/IntelligencePanel.tsx:2164-2190` | Same class for the "Promote to component set" dialog; backdrop `onClick={onClose}`, Escape on the div, no initial focus, no containment, no restoration. |

This is the Family-C/F6 class `dialog-review-2026-09-15.md` recorded as
partially fixed; these two surfaces were not in its migration set.

### F2 — `HelpBrowser` window-level Tab trap can leak focus (High)

`packages/help/src/HelpBrowser.tsx:73-97`: a `window`-level `keydown` trap
with no "is focus inside the dialog" guard, a duplicated focusable selector,
and no focus restoration on close. Tab pressed while focus is anywhere
outside the dialog is silently ignored, so the trap only works when focus
already is inside — and there is no mechanism that ever moves focus back.
(`packages/home/src/HomeSearchPalette.tsx:280-293` has the same class of
container-scoped trap.)

### F3 — `prefers-contrast: more` can never select High Contrast (Medium)

- `DESIGN.md:51` and `:85` promise: "When no explicit theme is set,
  `prefers-color-scheme: dark` and `prefers-contrast: more` provide
  automatic fallback … Activated by `prefers-contrast: more` or explicit
  user selection."
- `themeRuntime.ts:80-86` resolves System from `prefers-color-scheme` only.
- The generator's `@media (prefers-contrast: more) { :root:not([data-theme]) }`
  block (`generate-token-css.ts:320-329`) can never match, because the
  pre-paint script (`apps/desktop/index.html:32-33`) always writes
  `data-theme`.
- `ShineBorder.css:147-148` carries the same dead guard, contradicting
  `docs/architecture/shine-border-system.md:126`.

So the documented accessibility behavior exists in three places as intent
and in zero places at runtime.

### F4 — Guardrail gaps (Medium)

| Gap | Evidence |
|---|---|
| A comment that mentions `--token:` satisfies `audit-token-usage` | `scripts/quality/audit-token-usage.mjs:88-102` (`collectDefinitions`) has no comment filter while the reference scan does (`:112`). |
| Duplicate selector ships undetected | `packages/ui/src/tokens/../components/radius-system.css:35-37` declares `.varve-input__field, .varve-input__field`; `stylelint.config.mjs:43` disables `no-duplicate-selectors`. |
| `lint:css` is not selected by any validation lane | No `lint:css` entry in `scripts/quality/validation-lanes.mjs` LANES or `validation-impact.config.mjs` impact rules, while `design-token-system.md:39-41` claims CSS lint "is part of the affected closure". |
| `.varve-close[aria-disabled="true"]` sets `pointer-events: none` | `components.css:417-421` — contradicts the deliberate `.varve-btn[aria-disabled]` treatment (`components.css:355-358`, which keeps pointer events so `disabledReason`/`title` can be read). Latent: no consumer sets it today, but `CloseButton` is the canonical dismiss control and the disabledReason pattern is the documented approach. |

### F5 — Documentation drift (Low)

- `AGENTS.md` says "309 pairs"; live count is **315** (`audit:tokens`).
- `DESIGN.md:404` says "Enforced pairs (30+ in CONTRAST_PAIRS)".
- `docs/design/component-status.md:31,91` still lists `Combobox` as "not yet
  extracted" and `Spinner` as missing; both ship.
- `docs/architecture/design-token-system.md:39-41` overstates `lint:css`
  automation (fixed by F4 wiring, not by editing the claim).

### Verified non-findings (do not "fix")

- `NativeSelect`, the Menubar's own renderer, and native `<details>` in
  editor detail panes are documented deliberate choices.
- `@varve/ui` `Button` already implements the researched best practice for
  unavailable controls: `disabledReason` switches to focusable
  `aria-disabled` + `title` + `aria-describedby`
  (`Button.tsx:41-47,106-131`) — HTML-disabled buttons keep
  `pointer-events: none` (`components.css:350-354`) only when there is no
  reason to communicate.
- Website `.btn-*` vocabulary is a documented parallel system
  (`apps/website/README.md:66-68`), not raw hand-rolled markup.
- `audit:radius` reported two real debts when first run
  (`PluginManager.css:336` `999px`, one legacy `--radius-sm` consumer). Both
  were one-line mechanical fixes with unchanged computed values
  (`--radius-pill`, `--radius-control-compact`), after which the gate was
  wired into Tier 0 (`radius-discipline` impact rule) and passes.

## 3. Research (what informed the decisions)

Technical standards:

1. **WAI-ARIA APG, Dialog (Modal) Pattern** —
   <https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/> (accessed
   2026-09-27). On open, focus moves inside; Tab/Shift+Tab cycle *inside*;
   Escape closes; on close focus returns to the invoker; `aria-modal` may
   only be claimed when the app actually prevents interaction with the
   background. → Acceptance contract for F1/F2.
2. **W3C WCAG WG, "Using ARIA role=dialog to implement a modal dialog box"**
   — <https://www.w3.org/WAI/GL/wiki/Using_ARIA_role%3Ddialog_to_implement_a_modal_dialog_box>:
   script focus into the dialog on open, keep it there, return it to the
   trigger on close.
3. **Media Queries Level 5, `prefers-contrast`** (W3C Draft, 2026-02-19) —
   <https://www.w3.org/TR/mediaqueries-5/>; MDN marks the feature Baseline
   widely available since May 2022 → safe to consume in the WebView target.
4. **Microsoft Edge `prefers-contrast` explainer** —
   <https://github.com/MicrosoftEdge/MSEdgeExplainers/blob/main/Accessibility/PrefersContrast/explainer.md>
   and **Firefox HCM media-query notes** —
   <https://github.com/mozilla-firefox/firefox/blob/main/accessible/docs/HCMMediaQueries.md>:
   OS mapping of `more`/`less`/`custom` (macOS Increase Contrast and Linux
   HC → `more`; Windows HC → ratio-based `more`/`custom`). → Implementation
   semantics for F3: System preference + `more` → the app's High Contrast
   theme; an explicit Light/Dark/HC choice always wins.

Comparable-product failure reports (symptoms vs. confirmed causes noted):

| Case | Date | Reported behavior | Status | Relevance / regression test |
|---|---|---|---|---|
| twbs/bootstrap#41542 — `pointer-events:none` on disabled buttons blocks tooltip/why-disabled | 2025-06-13 | Cannot show reason for disabled control | Open discussion; maintainers recommend `aria-disabled` | Confirms the `aria-disabled`+`title` pattern Varve's `Button` already uses; guards the `.varve-close` consistency fix (F4). Test: `ButtonVariantParity`-style CSS assertion. |
| microsoft/fluentui#17606 — disabled Button hides `title` | 2021 | Hover tooltip dead on disabled buttons | **Fixed** — PR #17737 removed `pointer-events:'none'`, released in `@fluentui/react` 8.9.2 | Same class as F4 `.varve-close`. |
| Esri/calcite-design-system#5318 — tooltip on disabled button | 2023–24 | Tooltip never shows | **Fixed** — PR #6732 lets disabled elements emit pointer events without activation | Confirms "emit pointer events without activation" is the shippable fix pattern. |
| mui/material-ui#48622 — disabled tooltip triggers | 2026-06-04 | Warning + no tooltip on disabled buttons | In progress (removes warning, reworks docs) | Confirms this is a live 2026 concern, not legacy. |
| fleetdm/fleet#46974 — modal without focus trap | v4.86.1 era | Tab escapes open modal onto background controls | Open; reproduced with Playwright | Exactly F1/F2's failure mode; validates a Playwright regression spec as the proof form. |
| elastic/eui#7532 — VoiceOver escapes `EuiModal` | 2024 | AT virtual cursor reaches background | **Fixed** — PR #7564 identified parent modal properly | Reminds that keyboard containment ≠ AT containment; `aria-modal` honesty matters (F1/F2 keep `aria-modal` only because keyboard+pointer are actually blocked). |
| Atlassian JRASERVER-73482 — JAWS focus escapes modal | 8.20.1 | Background reachable while modal open | Confirmed bug | Same class. |
| whatwg/html#8339 — native `<dialog>` focus behavior | 2022-09-30 | Tab from native dialog reaches browser UI | Kept as-is by APA WG decision | Means hand-rolled traps are *not* automatically worse — but a trap with no containment guard and no focus restoration is; justifies fixing F2 in place (packages/help has no dependency channel to `@varve/ui`) instead of adding a lockfile-affecting dependency. |

Evidence gaps stated honestly: no screen reader (NVDA/JAWS/VoiceOver/Orca)
was exercised in this session; AT claims remain unverified, and the
accessibility-tree snapshot produced by axe/role queries is not a
substitute. Native Tauri/WebKitGTK runtime was not exercised — Chromium in
the web build only.

## 4. Implementation plan (slices, each lands green)

| Slice | Change | Primary consumers | Acceptance |
|---|---|---|---|
| S1 | `ImportResults` → shared `@varve/ui` `Dialog` (+`Button`), CSS pruned | Shell import/drop/paste report (2 call sites) | Repro test first (focus never enters → fails), then focus-in/contain/Escape/restore assertions pass; existing ImportResults tests pass; visual capture light/dark |
| S2 | `IntelligencePanel` PromoteDialog → shared `Dialog` | Intelligence panel promotion flow | Same focus contract; panel tests pass |
| S3 | `HelpBrowser` trap: containment guard + focus restore + shared selector | Help surface (desktop + web) | HelpBrowser tests + new focus assertions |
| S4 | `HomeSearchPalette`: focus into palette on open + containment | Home search | Home tests + new assertions |
| S5 | `prefers-contrast: more` → High Contrast under System (runtime + pre-paint + ShineBorder guard + docs) | Every application window; website deliberately excluded | Unit tests (resolve + lifecycle) pass; theme e2e extended if the harness can emulate contrast; explicit preferences unaffected |
| S6 | Guardrails: comment-blind definition scan, duplicate-selector re-enable + fix, `lint:css` lane wiring, `.varve-close` aria-disabled parity | Validation lanes (shared — recorded in ownership note) | `audit:tokens` usage scan still green with a failing repro; `lint:css` green; `verify:plan` selects `lint:css` for ui CSS edits |
| S7 | Docs: AGENTS pair count, DESIGN.md, component-status.md, theme-system.md, this record's final sections | Contributors | `audit:docs` green |

## 5. Coverage matrix (denominator: 11 audited areas)

| Area | Status |
|---|---|
| Token foundations + generated CSS provenance | verified |
| Theme runtime + persistence + pre-paint | **verified** (F3 fixed: `prefers-contrast: more` resolves System → High Contrast at runtime, pre-paint, and ShineBorder; unit + e2e) |
| Guardrails (tokens/spacing/sizing/docs/emoji) | **verified with documented gaps**: comment-parity + radius + lint:css gates wired and green; emoji `.md/.astro` scope gap deferred with quantification (§6) |
| Shared dialog primitive adoption | **verified** (F1/F2 fixed: ImportResults, PromoteDialog on shared `Dialog`; unmount-close lifecycle fix; HelpBrowser + HomeSearchPalette containment/restore) |
| Website parallel vocabulary | verified (documented exception) |
| Website typography ratchet | **verified** (red-at-HEAD fixed under user authorization: 9 declarations → roles, 107/107) |
| Workspace switcher (editor dock) | **verified** (code contracts hold; 11/11 browser contract tests incl. six-mode) |
| Workspace switcher (Home) | **verified** (new 6-test browser spec; WS1–WS3 fixed) |
| Move-panel flow (user-requested review) | **verified** (MP1–MP5 fixed; 8/8 unit + keyboard-move e2e + reviewed after-screenshot) |
| Crash-loop / safe-mode classification | **reported with probe evidence** (§7.4) — product finding, owner: lifecycle system |
| Native/AT certification (Tauri/WebKitGTK, screen readers) | blocked (environment) |

## 6. Deferred / not done (explicit)

- `MissingFontDialog` Family-C migration and the F7 capture-phase Escape
  guards for `FontBrowserDialog`/`DocumentFontsPanel` — the dialog review
  deferred these while their controller was mid-edit; this session did not
  re-verify that ownership and leaves them open rather than racing.
- ~~`audit:radius` lane wiring~~ — **completed this session**: the two
  debts were fixed (one-line each, computed values unchanged) and the gate
  is wired at Tier 0 via the `radius-discipline` impact rule.
- Website `theme.css` raw-OKLCH second layer — has its own documented
  system (`website-theme-contrast.md`) and its own test contract; brought
  under the contrast audit is a separate work item.
- **Emoji gate file-type scope.** `scripts/audit-emoji.mjs` scans only
  `.ts/.tsx/.css/.html`, so the AGENTS "No emoji anywhere" rule is unenforced
  for `.md`, `.astro`, `.sh`, `.mjs`. Measured with the script's own
  `EMOJI_RE`: **117 of 1062** `docs/**/*.md` files already contain
  emoji-class glyphs (including current-state `docs/architecture/*` and ADRs;
  `apps/website/src/components/SearchDialog.astro`, `scripts/*.sh` also carry
  them). Extending the gate without a baseline-aware policy (and a cleanup
  pass for those 117 files) would make the gate red on day one — its own
  work item, not a safe drive-by.
- Screen-reader and native-WebView verification — environment gap, not
  verifiable in this session.

## 7. Validation record

### Commands run before completion (results)

| Command | Result |
|---|---|
| `pnpm verify:plan` (baseline, pre-edit) | 264 changed files (all concurrent sessions), Tiers 0–4, **no full-suite escalation** |
| `pnpm audit:emoji` / `pnpm audit:docs` | clean (5056→5065 files, 1087 docs) |
| `pnpm audit:tokens` | 315 pairs pass × 3 themes; usage scan clean (584 properties) |
| `pnpm audit:spacing` / `audit:sizing` / `audit:inspector-css` | ratchet-clean / clean |
| `pnpm lint:css` | clean **after** re-enabling `no-duplicate-selectors` (4 duplicates merged + 1 in radius-system.css) |
| `node scripts/quality/audit-radius.mjs` | clean **after** fixing the 2 debts (999px pill, legacy `--radius-sm`) |
| `node scripts/quality/audit-token-usage.test.mjs` | 4 assertions pass (new gate test) |
| `node scripts/quality/affected-plan.test.mjs` + `validation-receipts.test.mjs` | pass (planner changes safe) |
| `vitest run packages/ui` | **701 passed** (67 files; +5 new) |
| `vitest run packages/editor/src/components/{Settings,BatchRename,Export,ContentAwareFill,ImageResizeDialog,LayersPanel}` | **626 passed** |
| `vitest run packages/editor/src/components/ImportResults.test.tsx` | 14 passed (repro-first: focus test failed pre-migration) |
| `vitest run packages/editor/src/panels/IntelligencePanel.test.tsx` | 9 passed (incl. native-dialog contract) |
| `vitest run packages/help` | 33 passed (2 new containment/restoration tests failed pre-fix) |
| `vitest run packages/home` | 195 passed (31 files; 2 new failed pre-fix) |
| `pnpm --filter @varve/{ui,home,help} typecheck` | clean |
| `pnpm --filter @varve/editor typecheck` | my files clean; 1 pre-existing error in `workspace/workspaceStore.ts` (concurrent session's unstaged edit) |
| `pnpm typecheck:e2e` | my spec clean; pre-existing errors in `liquify.spec.ts`, `webgl2-smoke.spec.ts` (concurrent sessions, one untracked) |
| `biome check` on every touched file | clean |

Reproductions captured (failing test before fix): ImportResults initial focus,
Dialog unmount-close, HelpBrowser containment + restoration,
HomeSearchPalette containment + restoration, token-usage comment fixture.

Browser-level evidence: see §7.2 (pending the leased e2e batch).

### 7.1 Leased e2e batch #1 (2026-09-27, 4 specs, `reports/ds-audit-2026-09-27/e2e-batch.log`)

```text
18 passed, 4 failed, 10 did not run (13.0m)
tests/e2e/dialogs/dialog-system.spec.ts        11/11 passed
tests/e2e/settings/theme-lifecycle.spec.ts      4/4 passed (incl. new prefers-contrast case)
tests/e2e/home/workspace-switcher.spec.ts       3/6 passed
tests/e2e/workspace/switcher-review.spec.ts     0/1 attempted (serial mode: 10 did not run)
```

Failure triage:

1. **Home switcher option count (5 ≠ 3) — diagnosed to a real bootstrap
   defect.** `createWebPlatform`'s first-boot "Personal" auto-create used a
   random uuid with a check-then-put; concurrent boots (dev StrictMode
   double-init) both saw an empty store → two rows named "Personal"
   (2 auto + 3 seeded = 5). Fixed with a stable `'personal'` key +
   `workspace-bootstrap.test.ts` (repro-first: fails with `uuid()`).
2. **Arrow/Enter did not change the label** — consequence of #1 (the second
   option was the duplicate "Personal"); spec hardened to assert option
   *names* and to clear the store before seeding.
3. **Dark-theme capture click timeout** and **dock contrast test
   `Execution context was destroyed` (navigation mid-`page.evaluate` in
   `shared.ts:43`)** — not assertions about the product; both consistent with
   concurrent-session vite HMR full reloads during the run. Re-run in batch
   #2 to classify.

### 7.2 `verify:affected` → escalation → `verify:full` (attempt 1)

`pnpm verify:affected` **refused to run** (exit 2) and escalated, which is
the documented policy for this change class (this session edited validation
infrastructure: `validation-lanes.mjs`, `validation-impact.config.mjs`,
`affected-plan.mjs`, `vitest.setup.ts`, `package.json` `test:ci:tools`):

```text
FULL-SUITE ESCALATION: YES
  reason: workspace/toolchain/validation-infrastructure change
  reason: high-risk dependency upgrade (framework/runtime/toolchain)
```

`pnpm verify:full` run 1 with a stated reason
(`reports/ds-audit-2026-09-27/verify-full.log`):

| Step | Result |
|---|---|
| `biome check .` (whole repo) | **pass** |
| `pnpm audit:emoji` | **pass** |
| `node scripts/audit-health.mjs` | **pass** |
| `node scripts/audit-architecture.mjs --ci` | **fail — environmental**: `spawnSync /bin/sh ETIMEDOUT` on `ts-prune -p packages/editor/tsconfig.json` under machine load (load avg ≈ 7, three concurrent validation sessions); every other section reported clean |
| `pnpm typecheck` | **fail — blocked by concurrent work**: `packages/ui/src/tokens/color.ts(388,7) TS6133 'R' is declared but its value is never read` — color.ts modified at 04:48 by the workspaces session's in-flight six-mode token removal (codegen/logo accents deleted, the `R` helper left behind). 16 of 20 packages typechecked Done first (incl. `platform`, `help`); my packages are clean (`ui` typechecked clean at 04:20, before their edit). |
| heavy lanes (ci-tools, wasm, full vitest, rust, chromium e2e, visual) | **not reached** |

Disposition: full-gate attempt 1 **blocked** by concurrent-session edits, not
by this session's changes. Re-attempt after the six-mode refactor lands;
heavy lanes remain unexecuted meanwhile.

### 7.3 Leased e2e batch #2 — combined rerun (`e2e-combined.log`)

```text
19 passed, 5 failed (23.4m): customization 3/6, home switcher 4/6,
dock contract 11/11
```

| Failure | Root cause | Disposition |
|---|---|---|
| Dock contract (batch #1's navigation destruction) | environmental (concurrent vite HMR reload mid-`page.evaluate`) | **passed all 11 tests on rerun** — batch-1 failure confirmed non-product |
| Home: arrow-key choose | **my test bug**: expected row 'Studio Team' but one ArrowDown from the opened panel lands on option 2 ('Labs'; IndexedDB key order) | **fixed**: test now derives the expected label from the focused option (contract = "Enter applies what has focus") |
| Home: dark-theme capture | **app crashed into `safe-mode-screen`** (aria-modal alertdialog intercepting all clicks) — reproduced on both attempts of this test | solo repro launched to classify (theme path vs concurrent home code); shared `navigateToEditor` already carries a `varve:safe-mode` recovery gate, i.e. this failure mode predates this session |
| customization: toggles a panel | **my migration × test convention**: `@varve/ui` `Checkbox` draws its visual box over a 1px clipped native input, so Playwright `.check()` never hits the input | **fixed in the spec** with `.check({ force: true })` — the repo's established convention (`gradient-map/import-workflow.spec.ts` uses it for the same reason); the primitive's structure is deliberate (focus lands on the input, ring draws on the box) and is left alone |
| customization: focus-canvas template ×2 | `.editor__layers-panel` is not mounted at all under the new "Focus canvas" template while the spec expects `data-collapsed` — spec/impl mismatch inside today's focus-canvas/dock-schema commits (`0a0181d7d`, `0e7ce6589`) | **concurrent session's feature**; not caused by (or fixable within) this session's dialog changes — reported |

**Move-flow visual evidence:** the passing keyboard-move test regenerated
`docs/screenshots/workspace-dock-layout/custom-move-controls-light.png`
(13:00, post-change); preserved copy in
`reports/ds-audit-2026-09-27/move-flow/after-custom-move-controls.png`.
The directory is untracked, so the pre-change 12:32 capture was overwritten
by the regeneration — the before-state is the image reviewed during the audit
(UA-default selects with inconsistent borders, UA `accent-color` checkboxes,
hand-rolled Move up/down buttons) and is described in §the move-flow findings
below. After-state shows: `NativeSelect` skin with visible labels matching
accessible names, canonical `Checkbox` boxes, consistent radii/heights.

### Move-panel flow findings (user-requested review)

| # | Finding | Disposition |
|---|---|---|
| MP1 | Three hand-rolled `<label>/<select>` pairs + one more in Toolbar Arrangement — banned native selects, unskinned UA rendering | migrated to `NativeSelect` (visible label = accessible name) |
| MP2 | Six raw Move up/down `<button>`s with local skin and non-canonical focus token (`--color-border-focus`) | migrated to `IconButton` (ArrowUp/ArrowDown); local chrome/focus/disabled CSS deleted |
| MP3 | ~40 raw checkboxes styled with `accent-color` | migrated to the `Checkbox` primitive (Panels, Chrome, Tools, Inspector Tabs, Status Sections, both pin controls) |
| MP4 | Duplicate panel-label maps | single `PANEL_ROWS` derived from `DOCK_PANEL_LABELS` |
| MP5 | Dead CSS (`.arrangement-select`, `.workspace-customize__search`, local button/select/focus rules, accent rules) | removed |

Unit: 8/8 `WorkspaceCustomizeDialog.test.tsx`; editor `tsc` and biome clean;
keyboard-move e2e green; contracts (combobox/checkbox/button accessible
names) preserved byte-identically.

### 7.4 Product finding: spurious crash-loop on every Home boot (probe-proven)

**Evidence** (`reports/ds-audit-2026-09-27/probe.log`, throwaway probe since
deleted):

```text
PROBE[load1]      failures=[t1]          safeMode=null  theme=light  errors=0
PROBE[load2]      failures=[t1,t2]       safeMode=null  theme=light  errors=0
PROBE[load3-dark] failures=[t1,t2,t3]    safeMode=active, safe-mode-screen visible, theme=dark  errors=0
PROBE[errors-detail]   (empty — zero pageerror, zero console error)
```

**Mechanism:** `crashController.boot` records a startup failure whenever
`localStorage['strata-clean-shutdown'] !== 'true'`
(`apps/desktop/src/App.tsx:519`), and `ShutdownMarker` arms the key to
`'false'` at every boot with `markClean()` written **only** by the graceful
finalizer — which the Home surface never runs (`LifecycleProvider` is not
mounted there). Consequences, all pre-existing and none caused by this
session's changes:

1. A **brand-new profile's first boot already records a failure** (key absent
   `!== 'true'`).
2. Every Home page load/reload records another failure — including ordinary
   reloads, with no error anywhere.
3. The third load within 10 minutes trips `CRASH_LOOP_THRESHOLD = 3` → the
   "Varve had trouble starting" safe-mode screen. Any test (or user) doing
   three loads on Home within ten minutes hits it; this session's dark-theme
   capture test was simply the only 3-load test in the suite.

**Disposition: RESOLVED (user-directed).** The classification lived in one
call site (`App.tsx` `readUncleanShutdown`) and violated the marker's own
evidence rule: only an explicitly armed, never-finalized marker (`'false'`)
proves a session was interrupted — an **absent** marker means no session
ever armed it (fresh profile, or Home, where `LifecycleProvider` never
mounts), and a storage read error proves nothing. Fix:

- `readUncleanShutdownMarker()` added to `lifecycleMarker.ts` (the marker
  authority), exported through the lifecycle barrel and `@varve/editor`,
  wired into `App.tsx` in place of the inline `!== 'true'` string check —
  which also removes the hardcoded key drift (the constant now flows from
  `CLEAN_SHUTDOWN_KEY`). Deliberately a standalone reader: calling the
  shared marker's `begin()` from the classifier would arm `'false'` on
  surfaces that never write the key, manufacturing the evidence this fix
  requires.
- Invariants preserved: `begin()` still arms `'false'` at startup,
  `markClean()` is still written ONLY after completed finalization (a
  crash mid-quit stays unclean and still counts), the dirty-session reload
  path (`shouldWarnOnUnload`) is untouched, and the threshold/window are
  unchanged.
- Tests: 6 unit cases (absent / `'false'` / `'true'` / garbage / throwing
  storage / canonical key) in `lifecycleMarker.test.ts`; the finding itself
  is now a permanent browser gate — `tests/e2e/crash/safe-mode-counter.spec.ts`
  (three plain Home loads: no safe-mode screen, zero page errors, zero
  recorded failures). The gate was run **before** the fix and failed on
  exactly the §7.4 symptom (`.safe-mode-screen` count 1 on load 3,
  `repro-safemode.log`), then verified after.
- The suite's earlier 2-load restructuring stays (it is not load-bearing
  for correctness anymore, just faster); the probe record remains the
  original evidence.

### 7.5 `verify:full` attempt 3

| Step | Result |
|---|---|
| `biome check .`, `audit:emoji`, `audit-health`, `audit-architecture --ci` (incl. the `ts-prune` step that timed out twice) | **all pass** |
| `pnpm typecheck` | **blocked by concurrent WIP**: `src/workspace/inspectorTabState.ts(26,51)/(38,79) TS2345` — the workspaces session's inspector-tab refactor mid-landing (a *new* error since attempt 2, where all 20 packages passed) |
| heavy lanes | not reached |

Three full-gate attempts, each blocked by a different piece of concurrent
in-flight work (six-mode WIP → load-induced ts-prune timeout/transient
e2e-typecheck → inspector-tab WIP); every content gate that could run, ran
green. Final disposition: **full gate blocked by repository concurrency**,
with per-step evidence above; Tier-0/Tier-1 equivalents for this session's
scope all pass individually (§7.1–7.3).

### 7.5b `verify:full` attempt 4 + direct heavy-lane substitute

Attempt 4 (`verify-full-4.log`): **the entire cheap phase passed** —
`biome check .`, `audit:emoji`, `audit-health`, `audit-architecture --ci`
(the `ts-prune` step that timed out in attempts 1–2), and all 20 package
typechecks — then `tsc -p tests/e2e/tsconfig.json` exited 1 with **no error
output** under load ≈15; the identical transient hit attempt 2, and the same
command passes standalone (exit 0, re-verified). Heavy lanes not reached.

Direct substitute for the heavy unit lanes
(`heavy-unit.log`, one leased run):

| Lane | Result |
|---|---|
| `pnpm test:ci:tools` (the chain this session edited) | **pass** — including the new `audit-token-usage.test.mjs: 4 assertions passed` |
| `pnpm exec vitest run` (whole workspace) | 21168 passed / 21 failed / 17 skipped of 21206 |

Failure attribution of the 21 (each re-run individually to classify):

| Class | Count | Owner | Status |
|---|---|---|---|
| `native-select` guard flagged this session's comment text (`<label>/<select>` literal in WorkspaceCustomizeDialog.tsx:407) | 1 | **mine** | **fixed** (comment reworded); guard 2/2 green |
| website typography ratchet 345>344 — one raw `figcaption` `0.875rem` committed by `d25393ba9` (canvas-fluidity docs) | 1 | concurrent commit | **fixed** the same way the user approved earlier: → `--type-interface-caption-size` (the site's figcaption convention, plugins.astro precedent); 107/107 green |
| `Tooltip` hover-delay timing | 1 | machine load | passes standalone |
| website screenshot manifest | 1 | website session's dirty test | theirs |
| engine benches (wall-clock bounds) ×2 + `connectedComponents` | 3 | load-sensitive benches + engine session | environmental/theirs |
| editor: `panelRegistry`/`workspaceMode`/`layersPanelConfig`/`ManageLayouts`/`navigationCoordinator` (six-mode refactor), `workerHostLedger`/`faultInjection` (render) | 14 | workspaces + render sessions | theirs |

**Conclusion:** every failure was classified; after the two fixes above, all
remaining red belongs to concurrent sessions or load-sensitive benches — the
workspace-wide unit gate cannot pass until their in-flight work settles, so
further full-gate attempts would burn hours to reach a known-blocked result.
Recorded as blocked-by-repository-concurrency with per-lane evidence.

### 7.6 Fix verification run (post-triage)

```text
e2e-verify-fixes.log: 11 passed, 0 failed (5.8m), EXIT=0
  home/workspace-switcher.spec.ts  6/6 (incl. dark-theme capture after the
    2-load restructure and the focused-option arrow contract)
  workspace/customization.spec.ts  5/5 run (incl. 'toggles a panel' with the
    force-check fix and the keyboard move flow); the two focus-canvas tests
    attributed to the workspaces session were excluded via --grep-invert
```

Unit suites for every touched package green (`packages/ui` 701, editor
dialog closure 626+9+14, `packages/home` 195+2, `packages/help` 33,
`packages/platform` 301+2); Tier-0 audits green except the three ratchet
failures attributed to the concurrent10px badge (§concurrent list).

### 7.7 Suspected popover stacking defect — disproven (capture artifact)

The first dark/light switcher captures appeared to show sidebar content
painting *over* the popover. A stacking probe
(`probe-stacking.log`, probe since deleted) measured the real paint order at
the overlap point:

```text
workspace-switcher__header   (topmost, panel's own child, transparent)
workspace-switcher__dropdown (bg oklch(0.99 …) — opaque)
varve-popover                (z=1000, position: fixed)
varve-search__input          ← below the panel, as it should be
```

**The rendering is correct** — z-index 1000 over an opaque background. The
"transparency" was the Popover's entrance fade captured mid-animation: my
screenshots fired immediately after the visibility assertion. Fixed in the
spec (`waitForPopoverSettled` polls the panel to full opacity before
capturing); captures regenerated. No product change — recorded so the
disproven hypothesis is not re-litigated.

### Pre-existing / concurrent failures observed (not mine)

- **Fixed by this session (user-authorized):** website typography ratchet
  `353 > 344` at HEAD from commit `cf77fbc32` — 9 raw `font-size`
  declarations on `features/{code,email,logo}.astro` migrated to `--type-*`
  roles (visual deltas: breadcrumb 14→13px, intro 20→21px, section h2
  24→26px; the roles are the ones `plugins.astro` already uses for the same
  elements). `tokens.test.ts` 107/107, `astro check` 0 errors; the website
  visual spec only covers `/features/typography`, so no baseline moves.
- `packages/editor/src/workspace/workspaceStore.ts(294,3)` TS2322 — the
  workspace-evolution session's unstaged `layoutVariants/workspaceTypes` edit
  (since repaired by its owner; full `pnpm typecheck` passes).
- `tests/e2e/canvas/liquify.spec.ts`, `tests/e2e/webgl2/webgl2-smoke.spec.ts`
  (untracked) — `pnpm typecheck:e2e` failures from concurrent sessions
  (since repaired; typecheck:e2e passes standalone).
- `audit:spacing` / `audit:sizing` / `audit-radius` red from a **concurrent
  addition** at `packages/editor/src/editor.css:1808-1818` (a 10px numeric
  badge: `padding: 0 2px`, `border-radius: 3px`, `font-size: 8px` — added by
  the workspaces session after this session's 04:47 green run of all three
  audits). Not in this session's edited block (`.workspace-customize*`,
  5836+); left for its owner, who must tokenise or annotate it per each
  audit's own contract.
- Editor `CanvasArea/renderPipeline/workloadCorpus` TS errors were present at
  mid-session and later repaired by their owner during this session.

## 8. Workspace switcher review (user request)

Scope added mid-session: *"please review the workspace switcher as well as it
may need some work done on it."* Two surfaces exist and both were reviewed:

1. **Editor dock** — `packages/editor/src/components/WorkspaceTabs.tsx`,
   `workspace/workspaceOverflow.ts`, the dock recipes in `editor.css`, and the
   overflow `Menu`. Previously reviewed 2026-09-15
   (`docs/audits/workspace-switcher-review-2026-09-15.md`: F1–F10 all fixed —
   HC contrast, AA pill text, radiogroup ownership, fisheye removal, roving
   focus, gap math, terminology, type step, remeasurement).
2. **Home sidebar switcher** — `packages/home/src/WorkspaceSwitcher.tsx`
   (Popover + listbox). No browser coverage existed before this session.

### What was verified this session

| Check | Result |
|---|---|
| Source re-read against its documented contracts (radiogroup contains only radios; pointer click never steals focus; keyboard activation moves focus; overflow math from one measured gap; `aria-keyshortcuts` token grammar; overflow name carries hidden count) | code matches every documented contract |
| `vitest run WorkspaceTabs.test.tsx workspaceOverflow.test.ts` | 20/20 |
| `vitest run packages/home/src/WorkspaceSwitcher.test.tsx` | 7/7 (5 pre-existing + 2 new) |
| Dock contract spec `tests/e2e/workspace/switcher-review.spec.ts` (11 tests: rendered-contrast per mode × theme, ARIA ownership, overflow reachability, keyboard traversal, hover byte-identity, endurance, 200% text, forced-colors/480px) | re-run pending (see §7 batch #2); the spec was updated to the new six-mode inventory by the workspaces session mid-run |
| New `tests/e2e/home/workspace-switcher.spec.ts` (6 tests: seeded real IndexedDB, listbox semantics by name, pointer switch, arrow-open focus-in, Escape + focus return, dark capture, 5× open/close endurance with console-error watch) | re-run pending (see §7 batch #2) |

### Findings and dispositions

| # | Finding | Disposition |
|---|---|---|
| WS1 | Home switcher had **zero** browser-level coverage | **Fixed**: `tests/e2e/home/workspace-switcher.spec.ts` (new, 6 tests) |
| WS2 | First-boot **duplicate "Personal" workspaces**: `createWebPlatform` auto-created a uuid-keyed row with check-then-put; two concurrent boots (dev StrictMode double-init) both saw an empty store → two rows named "Personal" (observed live: 5 options where 3 were seeded; the arrow-key test silently selected the duplicate). Also mismatched HomeShell's hardcoded `'personal'` fallback id, which a uuid could never equal. | **Fixed**: stable `'personal'` key in `web.ts` + `memory.ts` (idempotent under any race); repro-first `workspace-bootstrap.test.ts` fails with the old uuid code |
| WS3 | Non-option children inside `role="listbox"` (title/empty-message divs) violate the APG listbox content model | **Fixed**: `role="presentation"` on both + 2 content-model tests |
| WS4 | Product changed mid-session: **eight → six workspace modes** (commit `cf77fbc32`; Logo/Codegen are no longer tabs) | Not mine to edit; their session updated the dock contract spec, `workspaceTypes`, and AGENTS.md. My review evidence above is mode-count agnostic. |
| WS5 | Product quality observed while testing the switcher: the same commit's three new feature pages breached the website typography ratchet (§7 fixed with user authorization) | Fixed, see §7 |

### Remaining gaps (honest)

- Screen-reader runs (NVDA/VoiceOver/Orca) on either switcher: not performed.
- The dock contract spec result from batch #2 is pending the lease queue;
  batch #1 never reached its assertions (navigation destroyed mid-`evaluate`,
  consistent with concurrent vite HMR reloads).
- Inactive dock tabs remain icon-only (documented space trade-off from the
  Sep-15 review, unchanged).
