# Platform UX / A11y / Responsiveness — Phase 1 Delta Audit (2026-08-10)

- **Date**: 2026-08-10
- **Builds on**: `docs/audits/platform-ux-audit-2026-08-04.md` (Phase 1 + Phase 2 landed). This document is a **delta**: verifies the Phase 2 claims, re-checks the Phase 3 backlog, and adds live-verified findings from this session.
- **Method**: live Playwright + axe-core runs against the running dev app (Chromium only), DOM/layout probes at 320–1280px viewports, live contrast computation (oklch→sRGB), and source review with file:line evidence.
- **Baseline**: WCAG 2.2 AA. AAA only where noted.
- **Severity definitions** (unchanged): **Critical** = blocks a whole input modality; **Major** = significantly degrades a core flow, workaround exists; **Moderate** = usability friction; **Minor** = polish/consistency.

## 0. Automated evidence gathered this session

| Run | Result |
|---|---|
| `tests/e2e/a11y/focus-order.spec.ts` (chromium, 2 attempts) | Tab-trace assertions + regression guards (no positive tabindex, no focus in aria-hidden, Tab never reaches body) PASS. Shift+Tab trace flaky (env). |
| `tests/e2e/menus/keyboard-nav.spec.ts` | Menubar Tab + ArrowRight/Left, Enter-opens PASS. |
| `tests/e2e/canvas/history-panel-a11y.spec.ts` | All 3 axe scans (steps/branches/compare views) PASS — zero violations. |
| `tests/e2e/layers/axe.spec.ts` | Layers panel axe scan PASS — zero violations. |
| `tests/e2e/startup/axe.spec.ts` | splashscreen.html axe PASS; status-roles test flaky (env). |
| `tests/e2e/home/a11y.spec.ts` | 1 of 4 scans completed PASS; 3 died on env startup timeouts (app's 20s boot watchdog vs slow transform under parallel load). |
| `tests/e2e/spec/axe.spec.ts` | **2 failures are test-locator bugs** (see N5), not app violations. |
| Layout probes (320/360/430/480/768/1024/1280px) | Home + editor, 3 themes, overflow + geometry + contrast. See findings. |

Environmental caveat: the working tree had uncommitted WIP and the dev server was being edited live during runs (HMR page reloads kill in-flight navigations). Failures attributed to that are marked "env" and were not treated as app findings.

## 1. Status ledger vs 2026-08-04

### Verified fixed (present in code today)

| Item | Evidence |
|---|---|
| U1/U2/U3 focus rings (Input, TextArea, inspector number) | `components.css:1606-1608, 1651-1653, 1236-1238` `:focus-visible` rings using `--color-interactive-focus-ring` |
| U4 Select focus restore | `Select.tsx` close-listbox restores focus (pattern verified in source) |
| E1/E2 skip link + `<main>` landmark | `.editor-shell__skip-link` (`editor.css:42-58`), link "Skip to canvas" is first focusable (axe snapshot confirmed) |
| E3 focus on view switch | `App.tsx` surface-switch focus management (source) |
| E5 canvas single tab stop + arrow-key model | focus-order spec + canvas `tabIndex` model verified |
| R1 `minmax(320px, 1fr)` canvas floor | `editor.css:149` |
| R3 hover-gated controls `any-hover: none` | `editor.css:553` |
| U20 `prefers-contrast: more` | token CSS generator + `tokens.css` |
| U13 NumberInput spinbutton semantics | `NumberField.tsx:247` `role="spinbutton"` |
| Layers tree APG pattern (roving tabindex, arrows, `onContextMenuKeyboard`) | `LayersTree.tsx:1423-1427` |
| Native `<dialog>` focus trap / Esc / focus restore | `Dialog.tsx` + `showModal()`; Popover: `Popover.tsx:117-196` |
| Website W1-W12 | website commit a9a217ef (verified in tree) |

### Still open from the 08-04 backlog (re-verified today)

| Item | Status today |
|---|---|
| U6 ColorSpaceSelector arrow-key nav | Open — no arrow handling (`ColorPicker/ColorSpaceSelector.tsx`) |
| U7 SpotColorBrowser arrow nav | Open — no listbox key handlers |
| U12 Checkbox `aria-checked="mixed"` | Open — `data-indeterminate` only (`Checkbox.tsx:30`) |
| U15 Popover focus trap | Open — conditional `role="dialog"`, no trap (`Popover.tsx:318`) |
| E4 no `<h1>` in editor or home | Open — zero `h1` in `packages/home/src` and `packages/editor/src` root components |
| R4 hardcoded spinner (`strata-spin 0.6s linear infinite`) | Open — `components.css:266` |
| R2 touch targets | Open — see N3/N4 below (measured live) |
| R5 fixed-width overlays (shortcut palette 420px, home search 480px) | Open |
| R8 `100vh` → `dvh` (home) | Open — `home.css:5` |
| R9 `inputmode` on numeric fields | Partially addressed; not re-audited exhaustively |
| Known axe violations (08-04 addendum) | Two confirmed still live — see C1/C2 |

## 2. New + confirmed findings (live-verified this session)

### Contrast (measured, oklch→sRGB, WCAG 2.2)

| # | Issue | Sev | WCAG | Root cause | Fix |
|---|---|---|---|---|---|
| C1 | **Active sidebar item fails 4.5:1 in Light theme** — measured **1.60:1** (`color: accent-primary` teal on `background: accent-subtle` pale teal). Dark: 6.54 PASS, HC: 5.38 PASS. | Major | 1.4.3 (AA) | `home.css:244-249` `--color-accent-primary` on `--color-accent-subtle`; the light-theme teal pair does not reach 4.5:1 | Darken light-theme `--color-accent-primary` (token change) or use `--color-text-primary` for the active item text; re-run token audit (`pnpm audit:tokens` has a 123-pair gate — the pairing may need an explicit rule) |
| C2 | **Layout-score badges fail normal-text 4.5:1** — good **3.25:1**, warn **3.42:1** (white on `oklch(0.6342 0.1283 156.2)` / `oklch(0.7158 0.1309 77.5)`); HC theme 1.37/1.64 (white on pure `#0f0`/`#ffc031`). `--bad` passes (4.76). | Major | 1.4.3 (AA) | `editor.css:1043-1060` white `--color-on-primary` on mid-chroma feedback colors, no dark variant | Darken `--color-feedback-success/warning` or use dark text on the badge; HC theme needs text color swap per pair |
| C3 | "Toggle artboard ruler origin" toggle flagged by 08-04 axe — element confirmed (`StatusBar.tsx:164`); contrast re-measured at fix time. | Moderate | 1.4.3 | `.editor-status__toggle` color on status bar | Re-scan post-fix |

### Layout / reflow (measured at 320–480px)

| # | Issue | Sev | WCAG | Root cause | Fix |
|---|---|---|---|---|---|
| L1 | **Home toolbar overflows at every narrow width** — 320px: scrollWidth 676 vs 320; 430px: 682 vs 430; 480px: 700 vs 480. New/Open/Filters pushed off right edge (New button right edge at 366 in a 320 viewport). Fails reflow at 400% zoom (320px CSS viewport). | Major | 1.4.10 (AA) | `home.css:2` grid `var(--sidebar-width) 1fr`; `.varve-home__toolbar-left/right` `flex-shrink: 0` (`home.css:60-88`) with no wrap and no narrow media query; `1fr` column min-content floor | `min-width: 0` on the grid children + container/media query ≤640px that lets the toolbar wrap or collapses less-critical controls (product call: what hides — Grid/List toggle? Filters?) |
| L2 | **Floating toolbar (19 tools, 728px wide) overflows ≤480px viewports** — measured x=-160 (left edge 160px off-screen) at 430px; edge tools unreachable, no paging/scroll, keyboard focus can land off-screen | Moderate | 2.4.11-adjacent, best practice | `FloatingToolbar.css:1-15` `width: max-content`, absolute centering, no narrow-width collapse; toolbar has no pagination state | Container query: collapse tool groups into the shape/boolean-style submenus below ~640px, or horizontal scroll with `overflow-x: auto` + `scroll-snap` |
| L3 | Workspace switcher radios measured **25×28px** (7 controls, icon-only, menubar); tab strip tab hit area **60×18px**; floating toolbar buttons **32×32px** | Moderate | 2.5.8 / touch guidance | compact chrome sizing (`editor.css` menubar/tabs; `FloatingToolbar.css:28-33`) | ≥32px with 44px hit-area via `::before` padding; product call on density |

### Error states / recovery

| # | Issue | Sev | WCAG | Root cause | Fix |
|---|---|---|---|---|---|
| E-1 | **Boot error screen has no recovery action** — "Varve could not start / Startup timed out" (`apps/desktop/index.html:36-91`) renders with a plain-text GitHub URL and no Retry/Reload button; a slow-machine user is stranded until they know to reload. Hit repeatedly in this session under dev-server load (20s watchdog at line 80 vs slow transforms). | Moderate | 3.2.x-adjacent, best practice (error-state recovery) | inline boot fallback: `showBootError` builds a static `<div>`; no retry affordance | Add a Reload button (calls `location.reload()`) + make the report URL a real link; focus it; keep `role="alert"` |

### Test-infra / governance

| # | Issue | Sev | Root cause | Fix |
|---|---|---|---|---|
| N1 | `pnpm audit:a11y` is an `echo` stub (`package.json:31`) — no mechanical CI gate on the full surface | Moderate | — | Wire a script that runs the axe specs headlessly (`playwright test` a11y corpus) |
| N2 | `spec/axe.spec.ts` locators now ambiguous — `getByRole('button', { name: 'Inspect' })` resolves to 4 elements (help-panel links "Inspect Tool (I)", "Inspector Panel", detach button), so the Spec Panel axe scan never runs | Minor | help panel content added after the spec was written | Scope the locator (`getByTestId('toolbar')` prefix or `exact: true`) |
| N3 | `AlertDialog` `aria-describedby="alert-desc"` uses a static id — collides if two alert dialogs mount simultaneously | Minor | `Dialog.tsx:152` | `useId()` |
| N4 | `Dialog` default `dismissible=true` lets Esc/backdrop dismiss confirmation dialogs unless opted out (08-04 U16, still open) | Minor | `Dialog.tsx:25` | Flip default; audit consumers |
| N5 | Boot URL is plain text, not a link | Minor | `index.html:50-51` | Anchor tag |

## 3. Summary counts (delta, this session)

| Severity | Count |
|---|---|
| Critical | 0 |
| Major | 3 (C1, C2, L1) |
| Moderate | 5 (L2, L3, E-1, N1, U6/U7/U12/U15 backlog cluster) |
| Minor | 4 (N2, N3, N4, N5) |

Prior-audit backlog still open and not re-verified live: R5 (fixed-width overlays), R8 (100vh), R9 (inputmode), R10 (200% zoom canvas crush), E4 (no h1), plus U6/U7/U12/U15.

## 4. Prioritized fix plan (severity × effort × reach) — for sign-off

1. **C1 + C2 — contrast fixes (token-level, Light + HC themes).** High reach (whole app), low effort. Re-run `pnpm audit:tokens` (123-pair gate) + axe re-scan. *(Phase 2)*
2. **L1 — Home toolbar reflow.** CSS + one product decision (what hides ≤640px). *(Phase 2)*
3. **E-1 — boot error recovery.** Add Reload button + link; test by stalling the boot watchdog. *(Phase 2)*
4. **L2 — floating toolbar narrow-width collapse.** Container query; reuse shape/boolean submenu pattern. *(Phase 3)*
5. **U6/U7 arrow-key nav + U12 mixed checkbox + U15 popover trap** (backlog). *(Phase 3)*
6. **L3 touch-target hit areas** (44px hit-boxes, visual size unchanged). *(Phase 3 — needs design sign-off on density)*
7. **N1–N5 test infra + polish.** *(Phase 4)*

## 5. Known limitations / not addressed (unchanged from 08-04 plus:)

- Screen readers (NVDA/VoiceOver/TalkBack) not run this session — code-level semantics only.
- Firefox/Safari/iOS/Android not run this session (Chromium only).
- No real touch hardware; all touch findings are emulation + geometry.
- R5/R8/R9/R10/E4 remain unverified live; scheduled for Phase 3.
- 200% zoom reflow is covered by the L1 finding (fails).

## 6. Phase 2 status (2026-08-10, same session) — all signed-off items landed

| Item | Commit | Verification evidence |
|---|---|---|
| C1 accent-on-subtle (sidebar active, drop-target outline, toolbar soft-active) | `1642e297` | `audit:tokens` 135/135 (4 new pairs × 3 themes: 13.37/6.54/5.38); home sidebar axe scan PASS; live probe matches audit ratios |
| C2 score-badge contrast (strong fills + text-on-feedback) | `1642e297` | 6.49/7.28/4.76:1 min across themes (audit + live probe); HC 12.84-15.30 |
| perf-profile 4.21:1 (opacity blending) | `1642e297` | axe home main view 0 violations |
| L1 home toolbar reflow (320-480px) + functional drawer | `00b91496` | scrollW == clientW at 320-1280; drawer open/Esc/focus-return probes; home axe 4/4; HomeShell/HomeToolbar unit 6/6 |
| E-1 boot error recovery (Reload + link) | `9c21fa67` | blocked-main.tsx probe: role=alert, auto-focused Reload, click reloads |

Gates: `pnpm audit:tokens` 135/135, `pnpm audit:docs` clean, `pnpm audit:emoji` clean, biome/tsc clean on touched files, home a11y E2E 4/4.

## 7. New findings discovered during implementation (deferred — need design input)

| # | Issue | Sev | Evidence |
|---|---|---|---|
| D1 | **`accent-primary` fills with white text fail 1.91:1 in Light** — `.floating-toolbar__btn--active`, `.editor-status__toggle--active`, and ~20 more accent-primary backgrounds (progress fills, badges, fix buttons across editor.css/inspector.css/home.css) | Major | live probe (light 1.91; dark passes via dark text-on-accent; HC passes with black) |
| D2 | Same class: `accent-primary` as *text/icon* on light surfaces ≈1.6-1.7:1 (hero-glow, brand accents) | Moderate | measured |
| D3 | Fix options for D1/D2 (design call): darken light-theme `accent-primary` (brand ripple) OR migrate fills to `interactive-default` (buttons pattern) OR per-surface tokens | — | — |

## 8. Known limitations / not addressed (this session)

- Screen readers (NVDA/VoiceOver/TalkBack) not run — code-level semantics only.
- Firefox/Safari/iOS/Android not run (Chromium only); touch via emulation only.
- Environment note: the working tree had continuous parallel development during this session; vite served stale transforms intermittently (restarts + `--force` + end-of-file CSS ordering used). E2E flakiness observed in `spec/axe.spec.ts` (locator ambiguity, N2 in §2) and env timeouts on startup-status test.
- Backlog from 08-04 still open: U6/U7 arrow-nav, U12 mixed checkbox, U15 popover trap, E4 no h1, R5/R8/R9/R10 — Phase 3.
