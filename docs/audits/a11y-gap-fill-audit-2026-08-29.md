# UX/A11y Gap-Fill Delta Audit — 2026-08-29

## Scope

Delta audit filling gaps left by four prior audits (Aug 2–10, 2026). Focus:
outline:none pairing, missing focus indicators, missing skip links, ContextualHelp
offscreen tab stops (RC-14), and `:focus` → `:focus-visible` upgrades.

**Environment:** Linux/CachyOS + Chromium (Tauri webview). No Firefox/Safari/iOS/Android.
No screen reader testing. No real touch hardware.

## Summary

| Severity | Found | Fixed |
|----------|-------|-------|
| Major    | 2     | 2     |
| Moderate | 5     | 5     |
| Minor    | 3     | 3     |
| **Total**| **10**| **10**|

## Issue Table

### Major

| # | Issue | WCAG | Root cause | Fix | Verification |
|---|-------|------|------------|-----|-------------|
| M1 | QuickActionsBar items have no `:focus-visible` — keyboard users cannot see which item has focus | 2.4.13 Focus Appearance | `outline:none` on `:hover` and `--active` with no `:focus-visible` replacement anywhere in file | Added `.quick-actions-bar__item:focus-visible { outline: 2px solid var(--color-interactive-focus-ring); outline-offset: -2px; }` in `QuickActionsBar.css:124` | 16 QuickActionsBar unit tests pass; Biome lint clean |
| M2 | ContextualHelp panel has ~40 offscreen tab stops when closed (RC-14 from focus nav audit) | 2.4.3 Focus Order | Panel uses `translateX(100%)` to hide but focusable elements remain in tab order | Added `inert` attribute when closed in `ContextualHelpPanel.tsx:56`; added `visibility: hidden` in `ContextualHelpPanel.css:15` | 10 ContextualHelp unit tests pass; Biome lint clean |

### Moderate

| # | Issue | WCAG | Root cause | Fix | Verification |
|---|-------|------|------------|-----|-------------|
| m1 | Templates-gallery search wrapper `:focus-within` uses border-color only — insufficient focus indicator | 2.4.13 | Wrapper only changes `border-color` on focus, no outline | Added `outline: 2px solid var(--color-interactive-focus-ring); outline-offset: -2px` to `:focus-within` in `home.css:1959` | CSS loaded via HMR (Playwright styleSheets check) |
| m2 | Asset-browser search wrapper `:focus-within` uses border-color only | 2.4.13 | Same pattern as m1 | Added outline to `:focus-within` in `home.css:2084` | CSS loaded via HMR |
| m3 | MockupsPanel search input has `outline:none` with no focus replacement at all | 2.4.13 | No `:focus-within` rule on wrapper, no `:focus-visible` on input | Added `.mockups-panel__search:focus-within` with border-color + outline in `MockupsPanel.css:51` | CSS loaded via HMR |
| m4 | ColorizeSection range input has `outline:none` with no `:focus-visible` | 2.4.13 | Range input styled with `outline:none` but no replacement | Added `:focus-visible` with outline in `ColorizeSection.css:112` | CSS file loaded (verified via styleSheets scan) |
| m5 | Home surface has no skip link (editor has one) | 2.4.1 Bypass Blocks | Skip link was never added to HomeShell | Added `<a href="#home-main" className="varve-home__skip-link">Skip to content</a>` in `HomeShell.tsx:892`; CSS in `home.css:18` | Source verified; HMR cache stale for JSX (needs dev server restart) |

### Minor

| # | Issue | WCAG | Root cause | Fix | Verification |
|---|-------|------|------------|-----|-------------|
| p1 | FileList.tsx has inline `outline: 'none'` on rename input — redundant with CSS rule | Best practice | Inline style duplicates CSS `outline:none` at `home.css:804` | Removed inline `outline: 'none'` from `FileList.tsx:329` | Biome lint clean |
| p2 | Rename inputs use `:focus` instead of `:focus-visible` — focus ring shows on mouse click | Best practice | CSS uses `:focus` pseudo-class | Upgraded to `:focus-visible` in `home.css:806` | Biome lint clean |
| p3 | Share-dialog email/role-select and version-history naming inputs use `:focus` instead of `:focus-visible` | Best practice | Same pattern as p2 | Upgraded to `:focus-visible` in `home.css:2766,3134,3152` | Biome lint clean |

## Files Changed

| File | Changes |
|------|---------|
| `packages/home/src/home.css` | Focus-visible on templates-gallery/asset-browser search wrappers; skip link CSS; `:focus` → `:focus-visible` on rename/email/role-select inputs |
| `packages/home/src/HomeShell.tsx` | Skip link element added |
| `packages/home/src/FileList.tsx` | Removed inline `outline: 'none'` |
| `packages/editor/src/components/Mockups/MockupsPanel.css` | Added `:focus-within` rule on search wrapper |
| `packages/editor/src/components/QuickActionsBar/QuickActionsBar.css` | Added `:focus-visible` rule on action items |
| `packages/editor/src/components/Inspector/sections/ColorizeSection.css` | Added `:focus-visible` rule on range input |
| `packages/editor/src/onboard/ContextualHelp/ContextualHelpPanel.tsx` | Added `inert` attribute when closed |
| `packages/editor/src/onboard/ContextualHelp/ContextualHelpPanel.css` | Added `visibility: hidden` when closed |

## Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| HomeShell.test.tsx | 8 | All pass |
| HomeShell.startup.test.tsx | 2 | All pass |
| ContextualHelpPanel.test.tsx | 10 | All pass |
| QuickActionsBar.test.tsx | 16 | All pass |
| Biome lint (changed files) | — | Clean |

## Known Limitations / Not Addressed

| Item | Reason |
|------|--------|
| Screen reader testing (NVDA/VoiceOver/TalkBack) | No SR access on Linux dev machine |
| Firefox/Safari/iOS/Android verification | Linux + Chromium only |
| Real touch hardware testing | Emulation only |
| 53 other `outline:none` instances | Already paired with `:focus-visible` or on non-focusable elements |
| `home.css` search palette input `outline:none` | Correctly handled by parent `:focus-within` with outline |
| `components.css` select option highlighted `outline:none` | Correct — highlight background IS the focus indicator in APG `aria-activedescendant` pattern |
| `adjustment.css` slider `outline:none` | Already has `:focus-visible` at line 367 |
| `IconBrowser` icon-card `outline:none` | Uses `--focused` modifier class for keyboard focus |
| Drag reorder is pointer-only | Medium priority, needs dnd-kit KeyboardSensor (deferred from focus nav audit) |
| Inspector color picker shortcut collision | Medium priority (deferred from focus nav audit) |
| E2E selector rot from FloatingToolbar refactor | Blocks E2E re-verification (deferred) |
| `apps/website/` axe scan | Not in scope (desktop editor focus) |
