# Platform UX, Interaction, Accessibility, and Responsiveness Audit

**Date:** 2026-09-02  
**Status:** Phase 1 audit complete; prioritized editor and website fixes implemented and validated; repository-wide pre-existing failures triaged
**Baseline:** WCAG 2.2 AA. AAA is not required for this product.  
**Minimum browser assumption:** the last two major versions of Chrome, Edge,
Firefox, and Safari, including iOS Safari and Android Chrome.

## 0. Scope and access

This pass covers the shared UI package, the desktop/browser editor shell and
its responsive drawers, and the Astro marketing website including the shared
header, theme control, consent surface, download funnel, documentation, and
feature pages. It does not change document, rendering, export, or business
logic.

The repository provides Playwright + axe-core, website visual snapshots,
computed-style contrast checks, and editor E2E helpers. The available audit
environment is Linux Chromium. It does not provide NVDA/VoiceOver/TalkBack,
iOS/Android hardware, WAVE, or Lighthouse, so those combinations are recorded
as unperformed rather than claimed as covered. Mobile checks use browser
viewport emulation; they are not real-device results.

Existing safeguards confirmed during inspection include the website skip link,
route landmarks, focus-visible styles, reduced-motion styles, mobile-menu focus
restoration, editor modal focus traps, editor drawer Escape restoration, and
44px coarse-pointer controls in the shared UI primitives.

## Findings

Severity definitions: **Critical** blocks task completion for a whole input
modality; **Major** significantly degrades a core flow but has a workaround;
**Moderate** is friction that does not block completion; **Minor** is polish or
consistency.

### Critical

None found in the inspected scope.

### Major

| Issue | Severity | WCAG criterion | Affected input/device | Root cause | Fix | Verification method |
|---|---|---|---|---|---|---|
| Responsive editor drawers open without moving focus into the drawer or containing Tab focus. | Major | 2.1.2 No Keyboard Trap; 2.4.3 Focus Order; 4.1.2 Name, Role, Value | keyboard / screen reader / touch keyboard | `Shell.tsx` toggles `data-visible` and renders a backdrop, but focus remains on the FAB and the existing Escape listener is the only focus handoff. | Add a responsive focus scope that moves focus into the active drawer, wraps Tab/Shift+Tab, and restores the triggering FAB on Escape/backdrop close. | Chromium Playwright at 640px: open each drawer, assert focus enters, wrap at both ends, press Escape, assert focus returns; repeat with reduced motion. |

### Moderate

| Issue | Severity | WCAG criterion | Affected input/device | Root cause | Fix | Verification method |
|---|---|---|---|---|---|---|
| Responsive drawer triggers do not expose which panel they control. | Moderate | 4.1.2 Name, Role, Value | screen reader / keyboard | The three editor FABs expose `aria-expanded` but not `aria-controls`; the Resources drawer has no stable id. | Add stable `id`/`aria-controls` pairs for Layers, Inspector, and Resources. | DOM assertion in the responsive drawer E2E spec and axe scan of the editor surface. |
| Website theme choices and mobile menu controls are smaller than the 44px touch guidance used by Apple HIG and Material, despite WCAG 2.5.8's 24px minimum being met. | Moderate | N/A — platform touch usability; WCAG 2.5.8 Target Size (Minimum) remains met | touch / hybrid touchscreen laptop | `.theme-option` is 30px; the mobile menu toggle is 36px; the close button's visible box is below 44px. | Enlarge hit boxes only on coarse-pointer devices, preserving the compact fine-pointer layout. | Website Playwright at 320px/375px/430px with coarse pointer emulation: measure interactive boxes, assert no horizontal overflow, capture mobile visual snapshots. |
| Editor responsive FABs and workspace dock controls remain visually compact on coarse-pointer devices. | Moderate | N/A — platform touch usability; WCAG 2.5.8 Target Size (Minimum) remains met | touch / hybrid touchscreen laptop | The shared `.varve-btn` coarse-pointer rule does not cover `.editor__fab` or `.workspace-dock__item`/`__more`. | Apply the same coarse-pointer target policy to these editor-specific controls while preserving their icon scale and overflow behavior. | Chromium Playwright at 640px with `hasTouch`/coarse pointer emulation: measure controls, assert layout bounds, capture toolbar visual. |

### Minor

| Issue | Severity | WCAG criterion | Affected input/device | Root cause | Fix | Verification method |
|---|---|---|---|---|---|---|
| The audit corpus does not yet exercise all requested intermediate widths or an explicit 200% reflow assertion. | Minor | 1.4.10 Reflow; 1.4.4 Resize Text | all | Existing website coverage asserts 320px overflow and visual snapshots, but not the full width matrix or a named 200% viewport check. | Add a bounded width/reflow regression spec for 320, 375, 430, 480, 600, 768, 900, 1280, and 1920 CSS-pixel scenarios; retain large-page horizontal-scroll exceptions only where content is intentionally scrollable. | Chromium Playwright computed layout checks plus visual captures at representative narrow, tablet, and desktop widths. |

## Summary

| Severity | Findings |
|---|---:|
| Critical | 0 |
| Major | 1 |
| Moderate | 3 |
| Minor | 1 |

## Prioritized fix plan

1. Fix responsive editor focus containment and trigger relationships. This has
   the highest reach because it affects every mobile/tablet editor drawer and
   keyboard or screen-reader user.
2. Apply coarse-pointer target sizing to editor and website controls. This is a
   low-effort, cross-platform improvement, with layout checks before visual
   snapshot updates.
3. Add the width/reflow corpus and visual evidence. Keep the product decision
   explicit for dense tables: intentionally scrollable data remains scrollable;
   marketing content must reflow without page-level horizontal scrolling.
4. Defer real-device and native screen-reader certification to a hardware/OS
   test pass. No code change can substitute for those environments.

## Known limitations / not addressed

- NVDA + Firefox/Chrome, VoiceOver + Safari/iOS, and TalkBack + Android Chrome
  were not available in this environment.
- Mobile checks are browser emulation, not physical iOS or Android hardware.
- WAVE and Lighthouse were not installed; axe and Playwright are the available
  automated floor.
- Third-party embeds are not present in the reviewed website surfaces.
- AAA criteria, legacy browsers outside the last-two-major-version assumption,
  and the deferred dense-table product decision are out of scope.

## Verification record

The initial impact plan was run with `pnpm verify:plan`. It selected the existing
website/editor package closure and warned that the current pre-existing worktree
changes affect 98% of repository test files.

Implementation checkpoints completed:

- Responsive editor drawers now expose stable relationships, move focus into the
  active panel, contain Tab/Shift+Tab, and restore focus on Escape or backdrop
  close. The focused editor E2E spec passes at the responsive breakpoint.
- Website and editor controls use 44px hit boxes for coarse or hybrid pointers;
  the website retains compact fine-pointer styling.
- The website header switches to its mobile navigation sheet through 960px so
  intermediate tablet widths do not clip the persistent desktop navigation.
- A Playwright reflow corpus covers 320, 375, 430, 480, 600, 768, 900, 1280,
  and 1920px across the home, download, docs, features, and FAQ routes.

Feature-specific validation completed so far:

- `pnpm build:website && pnpm build:website:pages` — passed; 66 routes built
  for each static output.
- `VARVE_WEBSITE_E2E_PORT=4345 VARVE_WEBSITE_E2E_PORT_ROOT=4346 pnpm exec playwright test -c playwright.website.config.ts --project=ghpages apps/website/tests/e2e/reflow.spec.ts --reporter=list` — passed.
- The responsive editor drawer E2E test and the coarse-pointer website target
  E2E test passed in isolated Chromium runs.

Final validation record:

- `pnpm verify:plan` — passed; no full-suite escalation. The current worktree's
  unrelated edits select a broad JS closure, so the planner warns that 98% of
  repository test files are affected.
- `pnpm verify:affected` — blocked at touched-file formatting by the existing
  user-owned `packages/ui/src/components/ShineBorder.stories.tsx` formatting
  error; no audit-scope file was implicated.
- `pnpm audit:docs` and `pnpm audit:emoji` — passed.
- `pnpm audit:tokens` — passed all 153 pairs across the three themes.
- `node scripts/audit-architecture.mjs --ci` — completed with 15 cycles,
  below the baseline ceiling of 17, 53 unstable modules below the ceiling of
  55, no layer violations, and the known Shell/Menubar/context hub warnings.
- Website axe: all 28 light/dark route checks passed.
- Website reflow: all five representative routes passed at the nine-width
  corpus from 320px through 1920px.
- Website coarse-pointer target test passed in isolated Chromium emulation.
- Editor responsive drawer focus E2E and desktop workspace-toolbar screenshot
  validation passed in Chromium.
- The existing narrow-toolbar visual test did not reach its screenshot because
  its shared navigation helper waits for the Layers panel to be visible at
  640px, while the responsive shell intentionally keeps that drawer collapsed;
  the dedicated responsive inspector viewport test passed.
- The existing website visual snapshot suite ran 16 tests: 5 passed and 11
  mismatched existing snapshots. The mismatches include page-height/content
  drift outside this audit's header breakpoint scope; snapshots were not
  overwritten. The targeted responsive screenshots and layout assertions above
  are the new audit evidence.

Real-device and native screen-reader certification remain deferred because the
required hardware and assistive technologies are unavailable in this Linux
Chromium environment.

## Pre-existing failure triage

The investigation used one set of lenses applied by this investigation, not
independent agents: test output, implementation inspection, specification and
accessibility intent, architecture boundaries, and regression history. Git
history and blame were available. No security- or billing-sensitive failure
was found in the failing groups below.

The pre-fix full-gate checkpoint was run with
`VARVE_FULL_GATE_REASON='User-requested pre-existing failure triage baseline' pnpm verify:full`.
It stopped before heavy lanes because the shared worktree already had three
unrelated formatting errors in `ShineBorder.stories.tsx`,
`typography-editing.spec.ts`, and `settings-dialog.spec.ts`; its chained E2E
typecheck also returned exit 1 without diagnostics. The exact standalone
`pnpm typecheck:e2e` command passed immediately afterward. Thus, there is no
clean pre-fix full-unit baseline in this workspace; the gate result is retained
as the reproducible pre-fix checkpoint rather than represented as a passing
full suite.

The post-fix full unit/CI command was:

```text
VARVE_TEST_WORKERS=1 pnpm test
```

CI-tool checks passed. The Vitest phase completed with **1,435 test files
passed, 12 failed, 5 skipped; 17,040 tests passed, 37 failed, 8 skipped**.
The 37 failures are grouped as follows:

| Group | Result | Classification and confidence |
|---|---:|---|
| `PropertiesPanel.test.tsx` | 2 | Deterministic current-markup/assertion drift: isolated rerun passed 20 and failed 2; the test expects a `button` named `RGB` and a direct `checkbox` that the current metadata-driven inspector surface does not expose in that form. **Medium.** |
| `editor.test.tsx` | 1 | Deterministic query ambiguity: the current DOM contains both the inspector region and the intentionally named `Inspector context: Canvas` region, while the test uses an unscoped `/inspector/i` query. **High.** |
| `GradientEditor.test.tsx` | 1 | Current colour metadata/default handling needs feature-owner review; not changed in this audit. **Low.** |
| `LayoutSection.test.tsx` | 4 | Auto-layout fixture/interaction mismatch; isolated root cause was not completed. **Low.** |
| `AssetExportControls.test.tsx` | 10 | Export-panel test setup/semantics mismatch; deferred because it is outside the responsive/editor-toolbar blast radius. **Low.** |
| `EffectsSection.test.tsx` | 2 | Effect-stack fixture/catalog mismatch; deferred to the effects owner. **Low.** |
| `SelectionColorsSection.test.tsx` | 2 | Colour-picker interaction harness mismatch; deferred to the inspector owner. **Low.** |
| `SmartFiltersSection.test.tsx` | 1 | Current option rendering/async menu semantics mismatch; deferred to the inspector owner. **Low.** |
| `InspectorTabBar.test.tsx` | 1 | Overflow measurement/menu timing mismatch; deferred to the inspector owner. **Low.** |
| `faceCropProtect.test.tsx` | 5 | **Confirmed test-fixture defect:** isolated rerun failed all five tests with `No "Switch" export is defined on the "@varve/ui" mock`, at `ImageCropSection.tsx:437`; the production component needs the mocked control. **High.** |
| `FilterDropdown.test.tsx` | 7 | **Confirmed test-fixture/query defect:** isolated rerun failed 7/11 because the tests query `.filter-dropdown__section-*` content before opening the `Popover`; the implementation keeps that content closed until the Filters trigger is activated. **High.** |
| `demoCapabilities.test.ts` | 1 | **Confirmed stale expectation:** isolated rerun received `['inference', 'onlineFonts', 'printProduction']`; `demoCapabilities.ts` intentionally restricts all three, while the test expects only two. **High.** |

None of these failures was treated as flaky: no nondeterministic diagnosis was
claimed, and representative groups reproduced in isolation. The unresolved
groups are deferred by feature ownership and scope, not hidden with skips,
looser tolerances, removed assertions, or mocks of the behavior under test.

## Changes and regression evidence

- `FloatingToolbar` now keeps tool options and touch multi-select controls in a
  fixed action rail outside the horizontally clipped tool-group scroller. The
  original failure was reproduced with the floating-ui `referenceHidden` data:
  the clipped trigger was outside the scrollport, so its portal was correctly
  hidden. The pencil stabilization E2E now passes, including the full five-test
  drawing/focus spec. **High confidence.**
- Responsive workspace E2E selectors now target the current dock semantics and
  use radio semantics where the DOM exposes `role="radio"`/`aria-checked`.
  The responsive editor boot helper waits for `.editor-shell`, which remains
  present when drawers are intentionally collapsed at narrow widths.
- The current email/workspace visual snapshots were regenerated only after the
  current dock layout was confirmed in screenshots. The complete affected
  editor/workspace corpus then passed **66/66 Chromium tests**, including all
  **20/20** refreshed email/workspace visual cases. No screenshot tolerance or
  assertion was loosened.
- Marketing-site changes are covered by the current Astro unit/build and
  browser evidence: `pnpm test:website` passed 169 tests; both static builds
  produced 66 pages; the nine-width reflow check and coarse-pointer touch-target
  check passed. The header discovery metadata, mobile breakpoint, touch targets,
  page schema, comparison copy, and `/llms.txt` surface remain documented in
  `docs/marketing/positioning-and-discovery.md` and `docs/release/website.md`.
- The existing marketing visual corpus remains **5/16 passing and 11/16
  mismatched**. The failures are page-height/content drift (for example,
  homepage light is 5,634px versus a 5,622px baseline; product light/dark are
  5,569px versus 5,365px), so those snapshots were not silently regenerated.
  A content-owner review is required before accepting that broader visual
  change; the focused reflow and touch-target assertions remain green.

Test-weakening disclosure: **none**. Selector corrections preserve the tested
behavior and make queries match the current accessible roles; visual baseline
updates record intentional current UI output. No test was skipped, deleted, or
made less tolerant.

The post-fix full gate was also requested with
`VARVE_FULL_GATE_REASON='User-requested pre-existing failure triage after fixes and visual validation' pnpm verify:full`.
It completed the full formatting/lint, audit, architecture, and workspace
typecheck stages, but again stopped at the chained E2E typecheck wrapper without
diagnostics. The direct `pnpm typecheck:e2e` rerun passed. Because the gate did
not reach its heavy browser/native/package lanes, the full Vitest result above
was run explicitly; a clean pre-fix heavy-lane comparison is not available in
this shared worktree. The remaining full-suite risk is therefore the 37
repository-wide unit failures and the documented native/real-device gaps, not
the repaired responsive or marketing flows.
