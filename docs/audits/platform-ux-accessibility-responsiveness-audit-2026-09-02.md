# Platform UX, Interaction, Accessibility, and Responsiveness Audit

**Date:** 2026-09-02  
**Status:** Phase 1 audit complete; prioritized editor and website fixes implemented
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

The remaining verification record will be extended with the final affected
validation, axe, visual, audit, and architecture-check results before the
platform pass is closed.
