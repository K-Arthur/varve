# Platform UX / Interaction / Accessibility / Responsiveness Audit — Phase 1 Report

- **Date**: 2026-08-04
- **Branch**: master (audit artifacts committed progressively; fixes to land as reviewable commits)
- **Baseline**: WCAG 2.2 AA. AAA is *not* targeted except where noted per-criterion.
- **Browser support assumption**: no analytics available — defaulting to "last 2 major versions" of Chrome, Edge, Firefox, Safari (desktop) plus iOS Safari and Android Chrome. App targets are primarily desktop (Tauri window), web is a supported secondary surface.
- **Method**: static source audit with file:line evidence; existing automated gates re-run (`audit:tokens` 123/123 pass, `audit:emoji` clean); claims spot-verified at the file level. Live axe-core runs, real-device touch testing, and screen-reader passes are scheduled for Phase 2+ (not performed this phase — no claims of coverage beyond what is stated here).

## 0. Existing automation status (verified this session)

| Gate | Status |
|---|---|
| `pnpm audit:tokens` — 123/123 pairs across 3 themes | PASS |
| `pnpm audit:emoji` — zero emoji, 2617 files | PASS |
| axe-core e2e specs (`tests/e2e/**/axe.spec.ts`, home a11y, menus, layers, inspector, spec, startup splash) | Exist in suite; re-verify live in Phase 2 |
| Forced-colors support (tokens → system colors, incl. focus ring → Highlight) | PASS (app + website) |
| `prefers-reduced-motion` | Global token zeroing + JS manager in app; global guard on website |

## 0a. Platform context model (which findings matter where)

The audit covers three distinct surfaces with different input profiles. Severity and fix order are weighted per surface, not uniformly:

| Surface | Where it runs | Input profile | Weighted issues |
|---|---|---|---|
| **Desktop app** (Tauri, `apps/desktop`) | Native window, `minWidth: 900` | Mouse + keyboard first; hybrid touch on touchscreen laptops; SRs (NVDA/VoiceOver) | U1-U4, E1-E3 (keyboard/focus); R1 (window min vs breakpoint); R3/R2 only as hybrid-device items |
| **App on web** | Same Vite frontend served in browsers | Mouse/keyboard + touch; tablets/phones reach the ≤899px drawer layout | U-series + R2/R3 (touch now real), R8, R9, R10 |
| **Marketing website** (`apps/website`) | GitHub Pages, all browser sizes | Touch/mobile-first (most traffic), keyboard secondary, SRs | W1-W10 (touch targets, 320px reflow, menu semantics), W11/W12 |

Cross-cutting consequence: the responsive editor layout is **unreachable in the desktop window** (window cannot shrink below 900px, drawer breakpoint is 899px), so every touch/mobile finding in the editor applies to the web surface, not the desktop binary. Nothing in the website audit applies to the app and vice versa (no shared components — website is hand-written CSS + Astro).

## 1. Issue inventory

Severity definitions: **Critical** = blocks task completion for a whole input modality. **Major** = significantly degrades a core flow, workaround exists. **Moderate** = usability friction. **Minor** = polish/consistency.

### 1.1 Shared UI library (`packages/ui`)

| # | Issue | Sev | WCAG | Input | Root cause | Fix | Verify |
|---|---|---|---|---|---|---|---|
| U1 | Text `Input` focus indicator is a 1px border-color change only | Major | 2.4.7, 2.4.13 | keyboard, all | `outline: none` at `components.css:1591`; no `:focus-visible` ring; only `.varve-input--focused` border at `1559-1561` | Add `:focus-visible` ring on `.varve-input__field` (mirror `.varve-btn` ring at `178-180`); keep border change | Tab through a form; confirm ring ≥3:1 vs adjacent |
| U2 | `TextArea` focus indicator identical gap | Major | 2.4.7, 2.4.13 | keyboard, all | `components.css:1631, 1634-1636` | Same ring fix | Tab through multiline field |
| U3 | Inspector number input (`insp-num__input`) has no focus ring outside ColorPicker scope | Major | 2.4.7, 2.4.13 | keyboard, all | `components.css:1225-1230` border-color only; ring exists only inside `.color-picker` scope (`color-picker.css:260-266`) | Move/add `:focus-visible` ring on `.insp-num__input` in `components.css` | Tab across inspector fields; confirm ring |
| U4 | Searchable `Select` drops focus to `<body>` when closed via Enter/Esc | Major | 2.4.3 | keyboard | `Select.tsx:94-96` unmounts search input with portal; no focus restore to trigger | Capture `document.activeElement` on open; restore in `closeListbox` (pattern exists in `Menu.tsx:248-311`) | Open searchable select, type, Esc; confirm focus returns to trigger |
| U5 | `ViewModeSwitcher` radios have no accessible name below 640px | Major | 1.3.1, 4.1.2 | SR | label span `display:none` at `components.css:902-903` removes the only name | Keep label in a11y tree (`position:absolute` clip, not `display:none`) or add `aria-label` per input | VoiceOver at 375px width; inspect name |
| U6 | `ColorSpaceSelector` `role="radio"` buttons lack arrow-key nav + roving tabindex | Moderate | 4.1.2 (APG radiogroup) | keyboard | `ColorSpaceSelector.tsx:22-31` — buttons with role radio, Tab-only | Implement ArrowLeft/Right + roving `tabIndex` | Arrow keys switch modes in color picker |
| U7 | `SpotColorBrowser` listbox options Tab-only (no arrow nav) | Moderate | 4.1.2 | keyboard | `SpotColorBrowser.tsx:54-81` — role=option buttons without listbox key handlers | Add ArrowUp/Down/Home/End handling; or make it a `role="listbox"` with `aria-activedescendant` | Arrow through spot colors |
| U8 | `ToggleButton` touch targets 11–30px (all sizes) | Moderate | 2.5.8 | touch | `components.css:1826-1837` — no min-width/min-height; sizes = space-4/5/6 | Add 44px min target (padding, not visual size) | Touch test / devtools hitbox |
| U9 | Pill buttons 32px | Moderate | 2.5.8 | touch | `components.css:212-238` overrides min-height to 32px | Add hit-area padding while keeping visual 32px | Hitbox check |
| U10 | Menu items ~21–24px tall | Moderate | 2.5.8 | touch | `components.css:443-457` padding-only rows | Increase row min-height or hit-area | Touch test |
| U11 | Tabs ~28px | Moderate | 2.5.8 | touch | `components.css:999` | Add min-height 44px | Hitbox check |
| U12 | `Checkbox` indeterminate never sets `aria-checked="mixed"` | Moderate | 4.1.2 | SR | `Checkbox.tsx:30` — data-indeterminate only | Set `aria-checked` from indeterminate prop | NVDA/VoiceOver reads "mixed" |
| U13 | `NumberInput` lacks spinbutton semantics (`type="text"`, no role/valuenow) | Moderate | 4.1.2 | SR | `NumberInput.tsx:116-129` | Add `role="spinbutton"` + `aria-valuenow/min/max` (pattern: `SpinbuttonRow.tsx:87-101`) | SR reads value and step changes |
| U14 | `SwatchPalette` hardcodes `aria-selected={false}` — never tracks selection | Minor | 4.1.2 | SR | `SwatchPalette.tsx:100` | Wire real selection state | SR announces selection |
| U15 | `Popover` renders unnamed dialog surface when `label` omitted; no Tab trap | Moderate | 4.1.2, best practice | keyboard, SR | `Popover.tsx:318`; native popover API doesn't trap | Require/derive label; wrap in FocusTrap when open (component exists) | Tab test in popover |
| U16 | `Dialog` defaults `dismissible=true` — Esc/backdrop closes confirmation dialogs unless consumer opts out | Minor | best practice | all | `Dialog.tsx:25` | Flip default to false or require explicit opt-in | Review dialogs |
| U17 | `.varve-tabpanel:focus { outline: none }` is a trap for future focusable panels | Minor | 2.4.13 | keyboard | `components.css:1027-1030` | Remove outline:none; add `:focus-visible` ring | — |
| U18 | Dialog close / search clear / progress cancel buttons rely on UA default ring (unthemed) | Minor | 2.4.13 | keyboard | `components.css:397-399, 585-587`; `DeterminateProgress.css` | Add themed `:focus-visible` | Tab to each |
| U19 | Main `Slider` thumb has no explicit focus-visible rule (UA default only) | Minor | 2.4.13 | keyboard | `components.css:1332-1344` | Add ring rule | Tab + arrows |
| U20 | App ignores `prefers-contrast` (website supports it; app tokens are three fixed themes) | Minor | best practice | all | zero matches in `packages/` | Design decision — see §3 | — |

### 1.2 Editor shell + Home (`packages/editor`, `packages/home`, `apps/desktop`)

| # | Issue | Sev | WCAG | Input | Root cause | Fix | Verify |
|---|---|---|---|---|---|---|---|
| E1 | **No skip link** in editor — keyboard users tab through menubar + toolbar before canvas | Major | 2.4.1 (Level A) | keyboard, SR | No skip link anywhere in editor/home; editor has no `<main>` to target | Add skip link as first focusable in `Shell.tsx` → canvas section (`CanvasArea.tsx:3138`); reuse `.sr-only` (`components.css:1176`) | Tab from load; link appears, jumps to canvas |
| E2 | Editor has no `<main>`/landmark structure (no main, nav, header, footer roles) | Major | 1.3.1 | SR | `Shell.tsx:280-285` flat CSS-grid div | Wrap canvas region in `<main>`; landmark-navigate | SR landmark nav |
| E3 | No focus management on view switch (home ↔ editor) — focus falls to `<body>` | Major | 2.4.3 | keyboard, SR | `apps/desktop/src/App.tsx:157-164`; inactive surface `display:none`, active element loses focus | On mount of each surface, move focus (canvas for editor, heading for home); add `aria-hidden`/`inert` on hidden surface | Switch views; check activeElement |
| E4 | No `<h1>` anywhere in editor or home | Moderate | 1.3.1 | SR | zero h1 matches; home top heading is `ProjectsView.tsx:126` h2 | Add document-level h1 per surface (sr-only or visible) | SR heading nav |
| E5 | No initial editor focus on document open (canvas only gets focus via pointerdown) | Moderate | 2.4.3 | keyboard | `context.tsx` has zero `.focus(` calls | On doc open, focus canvas (or menubar per product call) | Open doc; check activeElement |
| E6 | Home surface `<section aria-label="File drop zone">` wraps entire app — misleading landmark name | Minor | 1.3.1 | SR | `HomeShell.tsx:742-744` | Rename to reflect app content | SR landmark nav |
| E7 | TabStrip close button `tabIndex={-1}` — unreachable by Tab (Delete works as compensation) | Minor | best practice | keyboard | `TabStrip.tsx:178` | Keep as-is (documented pattern) or add key-based close on active tab | Tab into tab strip |
| E8 | Home views grid/list row actions hover-gated (`opacity: 0`) | Major | 2.5.8/best practice | touch, SR | `home.css:266-269, 315-318, 2303-2306` | Reveal on `:focus-within` (has it) + make permanently visible on coarse-pointer/media or card focus | Touch device test |

*(Positives: menus are full APG with focus restore; Dialog uses native `showModal` trap+restore; canvas is focusable with Tab-selection cycling, arrow nudge, live announcements, hidden per-node a11y tree; layers tree + toolbar roving tabindex; hidden panels use `inert`.)*

### 1.3 Responsive / touch / viewport

| # | Issue | Sev | WCAG | Input | Root cause | Fix | Verify |
|---|---|---|---|---|---|---|---|
| R1 | Tauri `minWidth: 900` (`tauri.conf.json:20`) sits 1px above the 899px drawer breakpoint — responsive layout dead on desktop; at 900px floor canvas ≈356px, and with both panels at max (480+600) canvas collapses to 0px with no guard | Major | 1.4.10 | all | `editor.css:101-116` grid `--sidebar-width 1fr --inspector-width`; no `min-width` on `1fr` column | Add `min-width` floor to canvas column (e.g. `minmax(320px, 1fr)`); product decision on desktop minWidth vs breakpoint | Resize window to 900px; drag panels to max |
| R2 | ~30 interactive controls under 44px: tab close 8–10px, contrast dot 8px, layer visibility toggles 12–14px, floating toolbar 32px, pill buttons 32px, inspector inline buttons 16–21px, home row actions 24px, title-bar buttons 36px | Major | 2.5.8 | touch | see 1.1 U8-U11 + `editor.css:473-480, 980-1013`, `layers.css:593-600`, `FloatingToolbar.css:28-81`, `inspector.css:654-747`, `home.css:251-259`, `title-bar.css:44-49` | Add hit-area (padding/`::before` inset) to ≥44px without visual change | Devtools hitbox scan per control |
| R3 | Six hover-gated controls (`opacity:0` until hover) with no touch equivalent: tab close, layers drag handle, home row actions/group-add, asset-card insert, adjustment remove | Major | 2.5.8/best practice | touch | `editor.css:474, 491-497`; `layers.css:831-839`; `home.css:266-269, 315-318, 2303-2306`; `adjustment.css:163-168` | Reveal on `:focus-within` (most have) + `@media (any-hover: none)` always-visible, or pinned row actions | Touch device walkthrough |
| R4 | Two unguarded infinite spinners (`varve-btn__spinner` `components.css:266`, asset browser `home.css:2149`) + ~20 hardcoded transitions bypass the global reduced-motion zeroing | Moderate | 2.3.3 (AAA), best practice | all | hardcoded durations in ~15 CSS files | Route through `--duration-*` tokens or add local `prefers-reduced-motion` guards | `emulateMedia({ reducedMotion: 'reduce' })` audit |
| R5 | Fixed-width overlays overflow narrow viewports: shortcut palette 420px (`ShortcutPalette.css:15`), home search palette 480px (`home.css:1741`), bulk-import `min-width: 28rem` (`home.css:1308`) | Minor | 1.4.10 | all | fixed px widths, no media fallback | `max-width: calc(100vw - 2rem)` | 320px viewport test |
| R6 | Breakpoint scale is ad-hoc: `--bp-*` tokens (640/768/1024/1280/1536) never used in any media query; real queries use 640/768/899/900px/48rem | Minor | process | all | `tokens.css:204-208` dead; `editor.css` 899/900 | Standardize on token scale (process fix) | — |
| R7 | `-webkit-tap-highlight-color: transparent` (`apps/desktop/src/global.css:19`) removes all tap feedback | Minor | best practice | touch | global.css:19 | Keep (visual design) but ensure :active states exist on touch controls | Touch test |
| R8 | `100vh` in home (`home.css:5-6`) instead of `dvh` — mobile URL-bar quirk | Minor | best practice | touch | home.css:5-6 | `100dvh` fallback | iPhone Safari |
| R9 | 20+ `type="number"` inputs without `inputmode`; ShareDialog email input lacks `inputmode="email"` | Minor | best practice | touch | e.g. `StatusBar.tsx:215`, `ShareDialog.tsx:132` | Add `inputmode="decimal"/"email"` | Virtual keyboard check |
| R10 | At 200% zoom on short viewports the canvas `1fr` row can be crushed toward 0 (fixed topbar+timeline+status rows ≈440px) | Moderate | 1.4.10 | all | `editor.css:116` grid rows with non-shrinking auto rows | Give canvas row `min-height` and let panels scroll | 200% zoom audit |

### 1.4 Website (`apps/website`)

| # | Issue | Sev | WCAG | Input | Root cause | Fix | Verify |
|---|---|---|---|---|---|---|---|
| W1 | License table: 10 rows of bare `<td>`, no `<th scope>`, no `<caption>` | Major | 1.3.1 (Level A) | SR | `about/license.astro:60-101` | First cell per row → `<th scope="row">`; add caption/aria-labelledby to h2 | SR table-nav |
| W2 | Mobile menu toggle lacks `aria-expanded`/`aria-controls`; no Esc close; no focus management | Moderate | 1.3.1, 4.1.2 | keyboard, SR | `Layout.astro:114, 179-188` — class toggle only | Add aria-expanded/controls, Esc handler, focus return | VoiceOver + keyboard |
| W3 | Download platform tabs: buttons without `role="tablist"/"tab"`/`aria-selected`; selection = `.active` class only | Moderate | 1.3.1, 4.1.2 | SR | `download.astro:142-145, 246-249` | Add tab semantics + aria-selected (or radiogroup/aria-pressed) | SR reads selection |
| W4 | Heading level skips on 3 pages | Moderate | 1.3.1 | SR | `download.astro:110` (h3 before first h2); `learn/examples.astro:19-75`; `learn/tutorials.astro:19-80` | h3 → h2 for "not code-signed"; card h3 → h2 on learn pages | Heading-order scan |
| W5 | Two unnamed `<nav>` landmarks on all breadcrumb pages | Minor | 1.3.1 | SR | `Layout.astro:93` + breadcrumb navs | `aria-label="Primary"` on site nav; `aria-label="Breadcrumb"` + `aria-current="page"` on breadcrumbs | SR landmarks |
| W6 | 12 `target="_blank"` links not announced as new-tab | Minor | 2.4.4 (G201) | SR | `download.astro:87,127,131,191`; `about/*.astro` | Add new-tab icon or sr-only "(opens in new tab)"; `rel` already correct | SR link list |
| W7 | OS-detection banner injects via `innerHTML` into `display:none` div — never announced | Minor | 4.1.3 | SR | `download.astro:138-139, 442-448` | Add `aria-live="polite"` region | SR on load |
| W8 | SHA-256 `.code-block` has no `overflow-x` — 64-char hex strings force page-level horizontal scroll on mobile | Moderate | 1.4.10 | all | `download.astro:327-336` (global `pre` rule `global.css:99` doesn't apply — these are `<code>`) | Add `overflow-x: auto` + `word-break` to that rule | 320px viewport |
| W9 | `minmax(300px, 1fr)` grids overflow below ~348px viewport | Moderate | 1.4.10 | all | `features.astro:94`, `docs.astro:95`, `tutorials.astro:118`, `examples.astro:113`, `contribute.astro:147` | `minmax(min(300px, 100%), 1fr)` | 320px check |
| W10 | Sub-44px touch targets: mobile toggle ~40px, mobile nav links ~25px, footer links ~22px, SHA-256 `<summary>` ~20px | Moderate | 2.5.8 | touch | `Layout.astro:260, 264-277, 324-328`; `download.astro:168` | Add padding/min-height to links + summary | Touch test |
| W11 | `og-image.png` is CSV text masquerading as PNG — social cards broken | Major | N/A (quality) | all | `public/og-image.png` (165 bytes) | Regenerate real PNG | Social-card check |
| W12 | `/favicon-32x32.png` referenced (`Layout.astro:40`) but not in `public/` — 404 on every page | Minor | N/A | all | missing file | Remove link or add file | Devtools console |
| W13 | No `@media print` styles | Minor | best practice | all | — | Optional print stylesheet | Print preview |
| W14 | No `:active` states on buttons | Minor | best practice | touch | `global.css:180-254` hover only | Add `:active` color shift | Touch test |
| W15 | 38/42 pages share default meta description | Minor | N/A (SEO) | all | `Layout.astro:12` | Per-page descriptions | — |
| W16 | Dead CSS: `.btn-pill`/`.btn-pill-outline` defined, unused | Minor | N/A | — | `global.css:215-254` | Remove | — |

*(Positives: skip link present + styled at `Layout.astro:91`/`global.css:286-306`; single h1 per page on all 42; global theme-aware `:focus-visible` ring `global.css:77-80` with zero `outline:none`; full dark/high-contrast/forced-colors themes with no-JS fallbacks; global reduced-motion guard; unrestricted viewport; zero images/iframes/forms/embeds; `lang="en"`; unique titles everywhere; `rel="noopener noreferrer"` on all `_blank` links; no hover-revealed content.)*

## 2. Summary counts

| Severity | App (ui+editor+home+responsive) | Website | Total |
|---|---|---|---|
| Critical | 0 | 0 | **0** |
| Major | 10 (U1-U5, E1-E3, E8, R1, R2, R3) | 2 (W1, W11) | **12** |
| Moderate | 10 (U6-U13, U15, E4, E5, R4, R10) | 7 (W2, W3, W4, W8, W9, W10) | **17** |
| Minor | ~15 (U14, U16-U20, E6, E7, R5-R9) | 8 (W5-W7, W12-W16) | **~23** |
| **Total** | **~35** | **17** | **~52** |

Key message: **no Critical findings** — no single flow is fully blocked for any input modality. The top risk clusters are (1) focus-indicator gaps on text fields, (2) keyboard focus loss/landmark gaps in the shell, (3) small touch targets + hover-gated controls, (4) website semantics.

## 3. Prioritized fix plan (severity × effort × reach)

**Phase 2 — Critical + Major (proposed order):**

1. **U1/U2/U3 — focus rings on Input/TextArea/inspector numbers.** Small, zero-risk CSS; affects every form in the app. *(Effort: S)*
2. **U4 — Select focus restore.** Small JS change following the existing `Menu.tsx` pattern. *(S)*
3. **E1 + E2 — skip link + `<main>` landmark in editor.** Small, high reach. *(S–M)*
4. **E3 — focus management on view switch.** Small; needs `inert` on hidden surface. *(M)*
5. **R3 — hover-gated controls: `any-hover: none` always-visible.** Small CSS. *(S)*
6. **R2 — 44px hit areas on the worst offenders** (tab close, layer toggles, floating toolbar). *(M)* — part needs design input (product call: see below).
7. **W1 — license table `<th scope>`.** Trivial. *(S)*
8. **W11 — og-image.png regeneration.** Trivial (needs asset). *(S)*
9. **R1 — canvas `minmax(320px, 1fr)` floor + minWidth/breakpoint decision.** Product call. *(M)*
10. **U5 — ViewModeSwitcher naming.** Small. *(S)*

**Phase 3 — Moderate:** U6-U13, U15, E4/E5, R4/R10, W2-W4, W8-W10.
**Phase 4 — Minor:** everything else, batched.

## 4. Testing tooling for Phase 2+ (commit-time evidence)

- **Automated**: `@axe-core/playwright` on existing specs + extend to home/editor dialogs; Lighthouse a11y+perf on website build (`pnpm --filter @varve/website build` then serve); website scan script via `npx playwright` against `astro preview`.
- **Manual keyboard**: full tab-pass per flow (menubar → canvas → panels), focus-order trace via `document.activeElement`.
- **Screen readers**: NVDA/Firefox available in this environment for verification; VoiceOver/TalkBack explicitly **not** tested this session.
- **Devices**: no real mobile hardware used; touch checks via Playwright touch emulation. iPad split-view untested. Stated honestly rather than assumed.
- **Visual**: existing Playwright `tests/e2e/visual/` baseline to catch layout drift.

## 5. Known limitations / not addressed

- Third-party embeds: none exist (website has zero embeds; app has none in scope) — CSP `frame-ancestors 'none'`.
- Browser coverage: last 2 major versions assumed; no analytics.
- `prefers-contrast` in-app (U20) and desktop-min-width (R1) are **product/design decisions** — flagged, not guessed.
- Website W11 asset, W12 favicon need asset generation.
- iPad split-view, real iOS/Android hardware, TalkBack/VoiceOver untested.
- Motion/Prototype player, timeline playback and Print/Export flows were sampled, not exhaustively walked this phase.

## 6. Phase 2 status (2026-08-04, same session)

All Phase 2 items landed on master with verification evidence:

### Website (commit a9a217ef + user commits 1f561bab, 61c5c6c5, 079fb4e0)
- W1 license table `<th scope="row">` + caption; W2 mobile menu `aria-expanded`/`aria-controls` + Esc + focus return; W4 heading hierarchy (3 pages); W8 SHA-256 code-block overflow; W11/W12 real `og-image.png` (1200x630) + `favicon-32x32.png`; `.code-block` contrast fix on 14 pages.
- **Evidence**: `pnpm --filter @varve/website build` clean (42 pages); axe-core (wcag2a/aa/21/22 tags) on all 41 sitemap pages against the local build → **0 non-minor violations**. (Note: the live `k-arthur.github.io` build still shows contrast violations — it predates the theme-token work; resolves on next deploy.)

### App — keyboard/focus (commit pending)
- U1/U2/U3 focus rings on `.varve-input__field`, `.varve-textarea__field`, `.insp-num__input` (`components.css`).
- U4 `Select` restores focus to trigger when the searchable listbox unmounts (`Select.tsx`).
- E1/E2 skip link + `<main>` landmark in editor (`Shell.tsx`, `CanvasArea.tsx`, `editor.css`); canvas `:focus-visible` ring.
- E3 focus moved to the visible surface on home↔editor view switch (`App.tsx`, `HomeShell.tsx`).
- R1 viewport-aware panel clamps (`clampPanelWidthToViewport`, `PANEL_LIMITS` unchanged) + `minmax(320px, 1fr)` canvas floor (`PanelResizeHandle.tsx`, `editor.css`).
- R3 six hover-gated controls revealed on `@media (any-hover: none)` (`editor.css`, `layers.css`, `adjustment.css`, `home.css`).
- U20 `prefers-contrast: more` high-contrast block in the token CSS generator + regenerated `tokens.css` (System theme mode only; explicit in-app theme still wins).

### Verification evidence (app)
- `pnpm typecheck` 15/15 packages PASS (one transient failure was a user mid-save state).
- `pnpm lint`: 0 errors in any file touched by this audit (pre-existing errors on master unchanged: CodePanel, GradientHandleOverlay, ImportPreview, ImportResults, SelectionOverlay + user WIP website test files).
- `pnpm test`: 12038 passed; the 19 failures are 14 user-WIP crash tests (untracked `packages/editor/src/crash/`) and 5 load-flakes — FloatingToolbar 5/5, layers10k 10/10, menuPerf 18/18 all pass in isolation.
- `pnpm audit:tokens` 123/123, `pnpm audit:emoji` clean, architecture audit PASS (no layer violations; hub-file budget warnings come from the user's crash-recovery commit, which added imports, not from this audit's changes).
- Not yet performed: live Playwright axe scans against the running app, keyboard-only walkthrough, screen-reader passes, real-device touch (no hardware in environment).
