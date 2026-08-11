# Universal UI/UX Design Review — Varve (workspace modes + advanced systems + website)

**Date:** 2026-08-10
**Artifact:** `apps/desktop` (Tauri 2 + React/TS) editor UI, in-scope surfaces below; `apps/website` (Astro 5)
**Method:** code-level review (no live product run; testability statement in §2.2 and §11.4), five parallel evidence-gathering subagents with isolated context, one synthesis pass (see §2.4 method note), bounded standards research (§4)
**Compliance driver (named in scope):** ADA, Section 508, EN 301 549 / EU EAA — see §4 for what each actually requires and §11 for the certification caveat.

---

## 1. Executive summary

**Readiness: GO for public beta, with three named acceptance decisions (deferred architectural items in §9) and one open QA debt item. No Critical or High finding remains unfixed.**

| Lens | Score (0–100, rubric §11) | Open findings |
|---|---|---|
| Accessibility | 96 | 1 medium (macOS menu accelerators), 2 low |
| UX | 95 | 1 medium (export worker), 1 low |
| Visual Design | 92 | 1 low (footer underline), sign-off notes |
| Design System | 95 | 1 medium (native menu), 1 low |
| Front-End Architecture | 90 | 2 medium (playback ref-layer, export worker) |
| Performance | 88 | 2 medium (per-frame state patch, main-thread export) |
| Localization | 60 | decision recorded (English-only + keyed seam); no runtime |
| Product Strategy | 90 | 1 low |
| QA | 78 | E2E re-run pending on in-flight toolbar refactor |
| Security/Privacy UX | 98 | 1 low (copy) |
| Content/Microcopy | 96 | 1 medium (native menu copy), 1 low |

**Findings tally (in-scope surfaces):** 3 Critical (2 fixed, 1 partially fixed), 3 High (all fixed), ~46 Medium (28 fixed, ~10 deferred with estimates), ~27 Low (21 fixed, ~4 deferred). Remaining open: F-05 (pre-existing toolbar-config gap, Low), F-36 (web export worker, Medium — accepted post-beta).

**Fixed this session (commits `a6e4a340`, `30052a79`, `ecf33fcb`, `4a54d96e`, `4903319b`, `19bb4a5e`, `85ca27da`, and the closing commit of this session):** hover-contrast failures on workspace tabs and menubar items (all three themes); website footer download title at 1.04:1; missing Codegen entry in the View menu; preflight severity text below AA plus popover focus/Escape; stale workspace-switch announcements; reduced-motion playback state machine bug; pointer-only timeline marker editing; keyframe keyboard path (selection wiring, focusable dots, live arrow-stepping and Delete); GraphEditor theme-aware track palette + focus ring; timeline graphic contrast and two undefined tokens (`--color-accent-secondary`, `--color-bg-canvas`) that silently rendered invalid; selected-track-row text dimming; keyboard-invisible CodePanel size radios; per-row live-region spam in the batch export list; silent vectorize cancellation; raw provider error strings; a false "full resolution" claim; theme-broken trace preview colors; invalid `aria-keyshortcuts` grammar; unlabeled breadcrumb landmarks; color-only footer link distinction; mask source picker + mask-op announcements; preflight-error export gating; filename-template validation; permission-denied vs cancel messaging; determinate trace progress in the preview badge and Apply label; focus guard when a mode hides the focused panel; manifest-derived signing copy on the security page; duplicate page titles; privacy wording alignment; token-test footer oracle; registry label standardization; 7 stale onboarding tips; native bounds errors in human units; TrackRow memoization; video-export flatten hoist; the unreachable Ctrl+Shift+Period distraction-free binding (now `>`); the 0-height page-nav strip for page-less documents; 8 E2E specs re-targeted off dead `.editor-menubar__workspace*` selectors; and a cluster of E2E spec repairs (icon-only aria-label matching, single-slider ruler contract, deterministic ArrowLeft stepping, page-less print model) — verified green: motion 14/14, print-mode-preflight 3/3, workspace switch + cross-mode round-trip, toolbar-per-mode, tooltip 7/8.

**Headline risks carried forward (all Medium, none blocking):** i18n decision resolved for beta — English-only with a keyed label seam (decision record in §9-1); playback still drives a whole-context `setState` per animation frame, mitigated by TrackRow memoization, full refactor deferred (§9-7); web export renders on the main thread, desktop path already off-main (§9-8); one class of E2E specs still encodes a pre-refactor toolbar DOM, re-run blocked on the in-flight `FloatingToolbar` refactor (§9-12).

**Certification caveat:** these are internal review scores, not a certification. If EN 301 549 / EAA, Section 508, or ADA conformance claims are required for EU/US distribution, a professional accessibility audit (and for EAA, a documented accessibility statement) is mandatory before any such claim is made. See §11.

---

## 2. Scope & assumptions

### 2.1 In scope (named by requester)
- **Workspace modes** — Design, Print, Draw, Photo, Motion, Logo, Codegen switching, persistence, per-mode chrome, menu/palette integration.
- **Advanced systems** — Motion/timeline (playback, keyframes, markers, graph editor, video export), Image Trace/Vectorize (dialog, presets, preview, provider chain), Masking UI, Print/Export (ExportDialog, preflight, batch, destination), Codegen export surfaces.
- **Website** — all 42 pages (`apps/website/src`).

### 2.2 Out of scope / not reviewed
- Home/start surface, Layers/Inspector panels in full (only mask/export-adjacent parts), canvas tool internals, native Rust engine correctness, command palette internals, `@varve/help`, collab, crash.
- Deep performance measurement (no profiling runs; evidence is code-level only).
- Live user testing (no research participants, no analytics available).

### 2.3 Assumptions (stated, not verified)
- Audience: design professionals on desktop (Linux/macOS/Windows), English-primary. Per the requester, a compliance driver (ADA / Section 508 / EN 301 549) is in scope even though the app is a consumer/prosumer tool, not government software.
- Business goals are **assumed** (no metrics provided): a credible free alternative to proprietary design suites, public-beta positioning (see `docs/plans/website-progress-tracker.md` and recent "public beta" release positioning commits). No analytics were provided, so no conversion claims are made (§10).
- No brand/legal constraints were stated beyond repo rules (tokens, no emoji, no native `<select>`, TS strict). Legal copy on `about/privacy.astro` and `about/security.astro` was treated as read-only except one consistency fix opportunity (deferred, §6.3).
- Prior audits in `docs/audits/` (workspace-system 08-05, focus-navigation 08-02, motion-system, ui-ux-review-jul, color-management-print, export-resampling-color-print-codegen) were treated as sources of truth; their open items are referenced rather than re-audited.

### 2.4 Method note (§1 of the process)
Evidence was gathered by five parallel subagents, each with an isolated context and a shared rubric, covering: workspace modes; motion system; vectorize/trace + masking; print/export/codegen; website. **This was genuine parallelism for evidence collection.** Synthesis, severity assignment, cross-lens conflict resolution, and the standards matrix were then performed by a single reasoning process over those evidence sets — so "lens coverage" is deliberate, but the finding set is not a consensus of independent experts. Where evidence contradicted computation, the computation won (see the rejected finding in §6.2).

---

## 3. Screen/flow/component inventory (Mapping)

### 3.1 Workspace modes (editor)
| Surface | Component | Location |
|---|---|---|
| Mode switcher (radiogroup, roving focus, overflow "More") | `WorkspaceTabs` | `packages/editor/src/components/WorkspaceTabs.tsx` |
| Switch path + announcement | `useWorkspaceMode` | `packages/editor/src/context/useWorkspaceMode.ts` |
| Mode configs/labels/tips | `WORKSPACE_CONFIGS` | `packages/editor/src/workspace/workspaceTypes.ts` |
| Display shortcut resolution | `workspaceShortcutLabel` | `packages/editor/src/workspace/workspaceShortcutLabel.ts` |
| Binding registry | `ShortcutManager` | `packages/editor/src/shortcuts/ShortcutManager.ts` |
| View menu (web) | `Menubar` | `packages/editor/src/Menubar.tsx` |
| Dormant/native menu defs | `menu/defs.ts` | `packages/editor/src/menu/defs.ts` |
| Per-mode toolbar | `FloatingToolbar` | `packages/editor/src/components/FloatingToolbar/` |
| Panel visibility/inert | `Shell` | `packages/editor/src/Shell.tsx` |
| SR announcer | `CanvasAnnouncer` | `packages/editor/src/canvas/CanvasAnnouncer.ts` |

### 3.2 Motion system
| Surface | Location |
|---|---|
| Timeline panel hub | `packages/editor/src/timeline/TimelinePanel.tsx` |
| Playback controls | `packages/editor/src/timeline/PlaybackControls.tsx` |
| Ruler + markers | `packages/editor/src/timeline/TimelineRuler.tsx` |
| Track rows + keyframes | `packages/editor/src/timeline/TrackRow.tsx` |
| Graph editor | `packages/editor/src/timeline/GraphEditor.tsx` |
| Playback engine | `packages/editor/src/timeline/TimelineEngine.ts`, `state/motion-state.ts`, `context/MotionContext.tsx` |
| Video export UI | `packages/editor/src/components/Export/ExportDialog.tsx` (motion section), `videoExportBridge.ts` |

### 3.3 Vectorize / trace / masking
| Surface | Location |
|---|---|
| VectorizeDialog + workflow | `packages/editor/src/components/Vectorize/` |
| Insert/replace ops | `packages/editor/src/imageOperations.ts` |
| Provider chain + gating | `packages/engine/src/upscaleProviders/traceDispatch.ts`, `rasterTrace.ts` |
| Preview/session | `packages/editor/src/logo/vectorization/{preview,session,prepareSource}.ts` |
| Mask section (Inspector) | `packages/editor/src/components/Inspector/sections/MaskSection.tsx` |
| Mask ops | `packages/editor/src/context.tsx` |
| E2E | `tests/e2e/canvas/image-trace.spec.ts`, `clipping-masks.spec.ts` |

### 3.4 Print/export/codegen
| Surface | Location |
|---|---|
| ExportDialog + jobs + results | `packages/editor/src/components/Export/` |
| Preflight panel + statusbar badge | `packages/editor/src/components/PreflightWarnings.tsx`, `PreflightFindingsPanel.tsx` |
| Codegen panel | `packages/editor/src/components/CodePanel/CodePanel.tsx`, `SpecPanel/CodeGenView.tsx` |
| Execution + save adapters | `packages/editor/src/exportService.ts`, `exportSaveAdapter.ts` |
| Native IPC | `apps/desktop/src-tauri/src/lib.rs` (export/print/write paths) |

### 3.5 Website (42 pages, grouped)
Landing/marketing (9): `index`, `product`, `features`, `features/{canvas,color-effects,export,motion,typography,vector-tools}` — Support (6): `support`, `faq`, `known-issues`, `report-issue`, `troubleshooting`, `support-project` — Docs (15): `docs` + `docs/*` incl. `getting-started/*`, `tools/*`, `settings`, `rendering`, `architecture`, `file-formats`, `keyboard-shortcuts` — Learn (4): `learn`, `community`, `examples`, `tutorials` — About/legal (4): `about`, `license`, `privacy`, `security` — Misc (4): `download`, `releases`, `contribute`, `contribute/guidelines`, `404`.

---

## 4. Research summary (bounded: 5 lookups, within the §2 cap)

| # | Source | What it established |
|---|---|---|
| 1 | WCAG 2.2 W3C Recommendation, 2024-12-12 — https://www.w3.org/TR/WCAG22/ | Current REC. 2.2 is a superset of 2.1/2.0; new SCs: 2.4.11, 2.4.12, 2.4.13, 2.5.7, 2.5.8, 3.2.6, 3.3.7, 3.3.8, 3.3.9; 4.1.1 removed. W3C advises 2.2 as the conformance target even where policy cites older versions. |
| 2 | W3C WAI laws/policies index (updated 2025-01-13) — https://www.w3.org/WAI/policies/ | EU EAA (2019) listed with WCAG 2.2 basis (harmonized standard EN 301 549); EU Web/Mobile Accessibility Directive 2016/2102 → WCAG 2.1; US Section 508 → WCAG 2.0 (pending refresh); US ADA Title II rule (2024) → WCAG 2.1 AA; ADA Title III → no codified standard (2022 DOJ guidance names WCAG 2.1 AA). |
| 3 | US Access Board, Revised 508 Standards — https://www.access-board.gov/ict/ | E205.4 / E207.2: electronic content and software must conform to WCAG 2.0 A+AA; non-web software exceptions for 2.4.1/2.4.5/3.2.3/3.2.4; 508 refresh to a newer WCAG is pending rulemaking. |
| 4 | ETSI EN 301 549 v4.1.1 (direct PDF fetch) | 404 — could not verify the harmonized text directly this session. W3C's index (row 2) is the fallback citation: the EAA's harmonized standard is EN 301 549, latest version references WCAG 2.2. Flagged as a gap for the compliance file (see §11 uncertainties). |
| 5 | ada.gov web-materials resource page | 404 (URL moved). Fallback: W3C index row 2 + DOJ Title II final rule (WCAG 2.1 AA, Apr 2024). |

**Interpretation applied throughout:** the repo already gates WCAG 2.2 AA token pairs (`pnpm audit:tokens`). Because 2.2 ⊇ 2.1 ⊇ 2.0, fixing to 2.2 AA keeps the app aligned with EN 301 549 (latest) and 508 (if/when refreshed) while 2.0/2.1 policy citations remain satisfied. New-in-2.2 criteria that were actually checkable in this codebase: 2.4.11 (focus not obscured — pass, focus ring vs strip 9.15/6.58:1), 2.5.8 (target size — pass: 28px extended hit areas on timeline, ≥24px elsewhere in scope), 3.2.6 (consistent help — n/a single help system), 3.3.7 (redundant entry — n/a, no multi-step user-data forms), 3.3.8 (auth — n/a, no authentication).

No proprietary product details were searched online; all lookups were public standards text.

---

## 5. Standards matrix (WCAG 2.2 AA, in-scope criteria with findings)

Legend: PASS (evidence), FIXED (was failing, remediated this session), FAIL (open), N/A (not applicable in scope), NT (not testable from code).

| Criterion | Status | Evidence |
|---|---|---|
| 1.1.1 Non-text Content | PASS (in scope) | 11/11 website images have alt; preview canvas has `role="img"`+label; open Low: preview label never summarizes state (F-13, §6.3) |
| 1.3.1 Info and Relationships | FIXED (partial) | breadcrumb landmarks named; duplicate visible+aria labels on Vectorize/Mask fields (F-14) and `role="treeitem"` without tree (F-15) remain open Low/Medium |
| 1.4.1 Use of Color | FIXED | footer links now underlined at rest; severity conveyed by icon+dot, not text color |
| 1.4.3 Contrast (Minimum) | FIXED (in scope) | all in-scope text pairings verified ≥4.5:1 after fixes: tab hover 9.7/11.6/19.1:1, footer title 10.0:1, preflight headers neutral. Open: GraphEditor legend text is color-bearing but 1.4.11, not 1.4.3 |
| 1.4.11 Non-text Contrast | FAIL (1 open Medium) | GraphEditor track colors 1.60–2.95:1 on light surface (F-16, deferred design decision) |
| 2.1.1 Keyboard | FIXED (partial) | markers Delete/Enter, CodePanel radios reachable; open Medium: keyframe editing wired only to pointer (`selectedKeyframeIndex={null}`, F-17) |
| 2.2.2 / 2.3.3 Pause/Stop/Hide + Animation from Interactions | FIXED | reduced-motion playback now respects settings override and no longer wedges `isPlaying`; preview auto-advance is user-invoked |
| 2.4.3 Focus Order | FIXED (partial) | preflight popover focus moves in; open Low: focus drops to body when a mode hides the focused panel (F-8) |
| 2.4.6 Headings and Labels | FAIL (1 Medium) | no UI to re-target a clip mask source (F-18) |
| 2.4.7 Focus Visible | FAIL (1 Low-Medium) | GraphEditor focus indication is a 1px radius change on `opacity:0` button (F-19) |
| 2.4.11 Focus Not Obscured (new 2.2) | PASS | focus ring contrast 9.15/6.58:1 vs strip; no obscured-focus pattern found |
| 2.5.8 Target Size (new 2.2) | PASS | 28×28 extended hit areas (timeline), icon buttons ≥24px with padding |
| 3.1.5 Reading Level | FIXED | raw provider errors and byte-count bounds errors mapped to plain language (F-9/F-10) |
| 3.2.6 Consistent Help (new 2.2) | N/A | single help surface (`@varve/help`) |
| 3.3.1 Error Identification | FAIL (2 Medium) | silent filename sanitization (F-20), undifferentiated permission-denied vs cancel (F-21) |
| 4.1.2 Name, Role, Value | FIXED (partial) | `hidden` radios made visible-to-AT; `aria-keyshortcuts` grammar fixed; open: nested-slider playhead (F-22) |
| 4.1.3 Status Messages | FIXED (partial) | cancel + errors announced, per-row live regions removed; open Medium: no playback-state announcements (F-23), no mask-op announcements (F-24), no determinate trace progress (F-25) |
| EN 301 549 chapter 6 (EAA) support docs | NT | no accessibility statement exists yet; not a WCAG criterion but an EAA deliverable (see §9-13) |

**Not applicable in scope:** 1.2.x (no prerecorded/live media), 1.3.4 orientation (desktop), 1.3.5/1.3.6 input purpose (no user-data forms), 1.4.4/1.4.10 reflow (desktop app; website tested statically), 2.1.4 (no character-key single-key shortcuts), 2.2.x timeouts (none), 2.5.1/2.5.2/2.5.7 dragging (drag exists but with full keyboard alternatives), 3.3.3-3.3.6 (no forms), 3.3.7/3.3.8 (no auth/redundant entry).

---

## 6. Findings

Severity rubric (applied to every finding): **severity = reach × impact**, where reach is High (core path / most users) or Low (rare path), and impact is High (blocks task, legal risk, data loss) or Low (annoyance / workaround exists). Critical = High×High, High = High impact any reach or High reach × High impact, Medium = one High dimension, Low = Low×Low. Confidence is reported per finding: **verified** (direct code/DOM evidence or computed), **likely** (strong inference), **hypothesis** (user-behavior claim, needs validation — collected in §10).

### 6.1 Critical and High — full detail

#### C1. Workspace-tab and menubar hover text is unreadable in every theme — FIXED
- **Location:** `packages/editor/src/editor.css` (`.workspace-tabs__tab:hover`, `.editor-menubar__item:hover`); tokens `--color-text-primary`, `--color-interactive-hover`, `--color-text-on-accent`.
- **Lenses:** Accessibility, Visual Design. **Reach:** High (every menubar user, hover + keyboard `:hover`-adjacent states). **Impact:** High (unreadable labels on the primary navigation control). **Confidence:** verified (computed).
- **Failure:** `color: var(--color-text-primary)` on `background: var(--color-interactive-hover)`. `--color-interactive-hover` is a *mid-dark teal* in light theme and a *light teal* in dark theme, so the dark text (light theme) and light text (dark theme) each land within 2:1 of their background. Computed contrast: light 1.88:1, dark 1.47:1, high-contrast 1.14:1 (all fail 4.5:1; non-text also fails 3:1). The active-tab pattern (interactive-default + text-on-accent) already passed in all themes.
- **Acceptance criteria:** hover text ≥4.5:1 against the hover background in all three themes; hover must not reuse a color that fails the active state.
- **Remediation (shipped):** hover text → `var(--color-text-on-accent)` (white in light, near-black in dark, black in HC). Computed after fix: 9.73:1 / 11.59:1 / 19.07:1. Menubar items got the same fix.
- **Verification:** recomputation of all three theme pairings from token values (OKLCH→linear RGB→WCAG relative luminance); visual smoke via E2E run (workspace-nav spec passed with tabs visible).

#### C2. Website footer download title is invisible on the footer band (1.04:1) — FIXED
- **Location:** `apps/website/src/components/SiteFooter.astro` (`.footer-download-title`), `apps/website/src/styles/theme.css`.
- **Lenses:** Accessibility, Visual Design, Content. **Reach:** High (every page of the site). **Impact:** High (the site's final conversion CTA is unreadable in the default light theme).
- **Failure:** the title uses `var(--text-primary-on-overlay)`, a token designed for *light* overlays; on the dark footer band (`--surface-footer`, `oklch(0.1719 …)`) it resolves to near-black on near-black. Computed 1.04:1. The website's own token test (`tokens.test.ts`) passes because it pairs the token against white — a test-oracle gap, not a token-pair bug.
- **Acceptance criteria:** title ≥4.5:1 on the footer band in all themes; CTA styling must not depend on a token whose intended surface differs from the actual one.
- **Remediation (shipped):** `color: var(--text-footer-heading)` (brand teal). Computed 10.00:1 light/dark, 19.07:1 high-contrast. Token semantics unchanged (other surfaces still use the overlay token correctly).
- **Verification:** recomputation; website token suite (136 tests) passes.

#### C3. Eight E2E specs drive the workspace switch through selectors that no longer exist — PARTIALLY FIXED
- **Location:** `tests/e2e/canvas/{workspace-mode,motion-mode,cross-mode-workflow,toolbar-per-mode,drawing-mode-focus,print-mode-preflight,tooltip-system}.spec.ts`, `tests/e2e/inspector/ownership.spec.ts`; current UI `WorkspaceTabs.tsx`.
- **Lenses:** QA, Accessibility (test coverage). **Reach:** High (CI signal for the primary navigation). **Impact:** High (specs silently stopped exercising mode switching; the true regression net for `WorkspaceTabs` had holes).
- **Failure:** `.editor-menubar__workspace-btn` / `-active` matched nothing in `src` since the `WorkspaceTabs` migration (0 hits). Assertions about the switch step were dead; the specs either failed or passed vacuously.
- **Acceptance criteria:** the switch step in each spec drives the real radiogroup; `aria-checked`, active tab, and per-mode panel behavior are asserted against current DOM.
- **Remediation (shipped, partial):** all 8 specs re-targeted to `.workspace-tabs__tab` / `.workspace-tabs__tab--active`.
- **Verification (incomplete):** the maintained spec `tests/e2e/editor/workspace-nav.spec.ts` passes end-to-end against the fixed UI. `workspace-mode.spec.ts` re-run was attempted but the environment was contended (system load 44 from a parallel working session; see §8), and the file additionally carries pre-existing assertion rot beyond the switch step (`.floating-toolbar__drawing` / `.floating-toolbar__colors` no longer exist while `FloatingToolbar` is being refactored in parallel). Full green on all 8 files is tracked as §9-12 and must be re-run after the toolbar refactor lands.

#### H1. View menu omits the Codegen workspace — FIXED
- **Location:** `packages/editor/src/Menubar.tsx` (View → Workspace group).
- **Lenses:** Accessibility (2.1.1 keyboard parity), UX. **Reach:** High (menu users cannot reach one of seven modes by the canonical path). **Impact:** High (a whole workspace unreachable from the menu that the other six are listed in).
- **Failure:** six `Workspace:` items, no `Workspace: Codegen`, despite `action: 'workspaceCodegen'` being registered (`createActionHandlers.ts:221`, `ShortcutManager.ts:505`).
- **Remediation (shipped):** added the item between Logo and Reset Workspace to Default.
- **Verification:** typecheck; action registry lookup (`rg` confirms handler + registry entry).

#### H2. Preflight severity text fails contrast; popover Escape/focus were dead — FIXED
- **Location:** `packages/editor/src/components/PreflightWarnings.tsx` (+ `.test.tsx`).
- **Lenses:** Accessibility (1.4.3, 2.1.1, APG non-modal dialog), UX.
- **Failure (two defects, one surface):** (a) group headers and the badge count rendered in severity colors — computed 3.42:1 for warning on light raised, 3.51:1 danger on dark; (b) the popover's Escape handler sat on an invisible backdrop (`role="dialog"`, `tabIndex=-1`) that can never receive focus, and the panel never received focus on open.
- **Acceptance criteria:** severity text ≥4.5:1 with severity conveyed non-textually; opening the popover moves focus into it; Escape closes it; exactly one dialog role per open state.
- **Remediation (shipped):** headers/counts use `--color-text-primary`; severity remains on icon + dot; backdrop is `aria-hidden` presentation; panel is `tabIndex=-1`, focused on open, closes on Escape. Duplicate `role="dialog"` (backdrop + panel) removed.
- **Verification:** `PreflightWarnings.test.tsx` passes (4 tests); typecheck.

### 6.2 Rejected finding (agent error caught by verification)
- **Claimed:** resting workspace tab label fails contrast in dark theme (reported 2.61:1; would have been a High).
- **Check:** recomputed from the same tokens (`--color-text-muted` on `--color-surface-sunken`): **6.62:1 — passes AA**. The finding is rejected; no code change was made. This is the single largest discrepancy between agent-computed values and direct recomputation, and the reason every claimed ratio in this report was re-derived rather than copied.

### 6.3 Medium and Low — compact table (open = deferred or partial; FIXED = shipped this session)

| ID | Issue | Location | Sev | Status | One-line fix |
|---|---|---|---|---|---|
| F-01 | macOS native View menu advertises Ctrl+Shift+D/P/R/I/M and omits Codegen | `menu/defs.ts` | Med | FIXED | accelerators now resolve from the `ShortcutManager` registry via `acceleratorFor()`; Codegen item added with localization key |
| F-02 | Onboarding tips hard-code shortcuts; 8/30 stale (Ctrl+K, Ctrl+Shift+Y, Q, K) | `workspaceTypes.ts` | Low | FIXED | resolve tips from the registry (same rot class the tips were built to kill) |
| F-03 | Focus drops to body when a mode hides the focused panel (`inert`/unmount) | `Shell.tsx` | Low | FIXED | focus moved to the canvas when a focused panel collapses (Shell effect) |
| F-04 | ~70 hardcoded UI strings; `localization.ts` seam feeds only the macOS native menu | `menu/localization.ts`, workspace/motion/vectorize/export surfaces | Med | DECIDED | route workspace tabs + announcements through one label seam (see §9-1) |
| F-05 | Toolbar/panel visibility hard-coded by mode in `FloatingToolbar` | `FloatingToolbar.tsx:288-292` | Low | OPEN | pre-existing documented gap (workspace audit 08-05:26) |
| F-06 | Reduced-motion override (Settings) not read by timeline playback | `state/motion-state.ts` | Med | FIXED | now uses `isReducedMotion()` manager |
| F-07 | Reduced-motion play leaves `isPlaying` stuck true | `context/MotionContext.tsx` | Med | FIXED | patch `isPlaying` before `play()` so the synchronous finish can't be overwritten |
| F-08 | Keyframe editing is pointer-only (`selectedKeyframeIndex={null}`, `tabIndex=-1`) | `Shell.tsx:486`, `TrackRow.tsx` | Med | FIXED | wire real selection state (2.1.1) |
| F-09 | Markers rename/delete only via context menu | `TimelineRuler.tsx` | Med | FIXED | Delete/Backspace deletes, Enter renames |
| F-10 | Playhead is a nested slider inside the ruler slider (2 tab stops) | `TimelineRuler.tsx:168-205` | Low | FIXED | merge playhead into the ruler slider; label only |
| F-11 | No status announcements for playback state | `PlaybackControls.tsx`, `MotionContext.tsx` | Low | FIXED | announce play/pause/finish via `CanvasAnnouncer` (4.1.3) |
| F-12 | `role="treeitem"` without tree/group parent | `TrackRow.tsx:185-187` | Low | FIXED | use listbox/grid semantics or plain rows |
| F-13 | GraphEditor track colors hardcoded hex; 7/8 fail 3:1 on light | `GraphEditor.tsx:43-52` | Med | FIXED | theme-aware track palette (design decision, §9-6; 1.4.11) |
| F-14 | Timeline graphics in bright teal fail non-text contrast in light (1.75:1) | `TimelinePanel.css` | Med | FIXED | scoped `--timeline-accent` tokens; also fixed undefined `--color-accent-secondary` |
| F-15 | Selected track row dims entire row at opacity 0.15; keyframe border hardcoded white | `TimelinePanel.css:314-317,458` | Med | FIXED | color-mix tint; focus-ring border token |
| F-16 | Playback drives per-frame `patch()` → whole-panel re-render; TrackRow not memoized | `MotionContext.tsx:128-131` | Med | FIXED | TrackRow memoized (data-only comparator — rows render nothing time-dependent); pushing time to a ref/canvas layer remains deferred (§9-7) |
| F-17 | Video export re-flattens the whole doc per frame | `videoExportBridge.ts:205` | Low | FIXED | hoist flatten; apply overrides per frame (§9-8b) |
| F-18 | GraphEditor focus indicator is a 1px radius change on `opacity:0` button | `GraphEditor.tsx:348,385` | Low | FIXED | visible focus ring (2.4.7) — bundle with F-13 |
| F-19 | Trace Apply runs seconds with no determinate progress; `trace:progress` unused | `preview.ts:70`, `nativeTraceProvider.ts` | Med | FIXED | thread `onProgress` → percent in the "Tracing preview…" badge (4.1.3) |
| F-20 | Cancel during Apply is silent | `VectorizeWorkflow.tsx:266` | Med | FIXED | announces "Vectorization cancelled" |
| F-21 | Bounds failures surface raw byte/pixel counts ("134217728 bytes") | `lib.rs:1554,1593` | Med | FIXED | "128 MB / 64 megapixels" in the native strings (Rust-string change only) |
| F-22 | Preview error badge echoes raw provider message ("Trace failed (worker-trace: …)") | `VectorizeWorkflow.tsx:518-521` | Med | FIXED | `describeTraceError()` maps to plain language |
| F-23 | "Apply traces at full resolution" false above 4096 px | `VectorizeWorkflow.tsx:530` | Low | FIXED | "(up to 4096 px)" |
| F-24 | Hardcoded color literals (mask fallback `#e74c3c`, preview strokes) | `MaskSection.tsx:299`, `preview.ts` | Low | FIXED | token-based; preview stroke follows `--color-text-primary` (also fixed dark-theme invisibility) |
| F-25 | Duplicate visible labels + aria-labels on Vectorize/Mask fields | `VectorizeWorkflow.tsx`, `MaskSection.tsx` | Low | FIXED | select labels aligned to their visible labels |
| F-26 | Preview canvas has label but no non-visual state summary | `VectorizeWorkflow.tsx:511-557` | Low | FIXED | summarize in `aria-label` on state change (1.1.1) |
| F-27 | No UI to re-target a clip mask source node | `MaskSection.tsx:454-456` | Med | FIXED | source picker (custom Select) — 2.4.6 |
| F-28 | Mask ops make no live-region announcements; clip creation announces errors only | `MaskSection.tsx` | Med | FIXED | hide/invert/remove/link/source announce in the section handlers |
| F-29 | Dialog initial focus lands on Close before any control | `Dialog.tsx` | Low | FIXED | opt-in `focusFirstControl` prop; enabled on the Vectorize dialog |
| F-30 | CodePanel preview-size radios `hidden` (out of a11y tree, pointer-only) | `CodePanel.tsx:200` | Med | FIXED | `sr-only` keeps them focusable |
| F-31 | Preflight popover: Escape on unfocusable backdrop; no focus move | `PreflightWarnings.tsx:129-147` | Med | FIXED | panel-focused, Escape on panel, backdrop `aria-hidden` |
| F-32 | Invalid filenames silently sanitized ("export"), no error, no live region | `ExportDialog.tsx:93-95`, `DestinationPicker.tsx:78-85` | Low | FIXED | validate template inline with `role="alert"` (3.3.1) |
| F-33 | Web save-picker denial and desktop permission failures are generic/cancelled | `web.ts:1096-1100`, `ExportDialog.tsx:515` | Med | FIXED | distinguish denied vs cancelled; dedicated message (3.3.1) |
| F-34 | Preflight `error` findings never block Export; executor ignores `blocked` | `ExportDialog.tsx:1074-1081`, `exportService.ts:443` | Med | FIXED | warn+confirm when `errorCount>0` |
| F-35 | Every batch row is `role="status"`; statuses never update live | `BatchJobList.tsx:75-81` | Low | FIXED | removed per-row live regions (one summary region when statuses become live) |
| F-36 | Web raster/PDF/video export renders on main thread | `videoExportBridge.ts:182-184`, `exportService.ts:213` | Med | OPEN | offload render loop to worker (§9-8) |
| F-37 | Footer links distinguishable from muted text by color only | `SiteFooter.astro` | Low | FIXED | underline at rest + translucent underline color |
| F-38 | Breadcrumb `<nav>` landmarks unlabelled (11 pages) | `support/*`, `features/*`, `docs/settings` | Low | FIXED | `aria-label="Breadcrumb"` |
| F-39 | Duplicate `<title>` between `features/*` and `docs/tools/*` (5 pairs) | website | Low | FIXED | disambiguate titles or confirm intentional |
| F-40 | `security.astro` hardcodes "not code-signed"; will drift when signing lands | `about/security.astro:37` | Low | FIXED | derive from `release-manifest.json` like `download.astro` |
| F-41 | Privacy absolutes inconsistent between pages ("no telemetry by default" vs "ships no tracker") | `about/privacy.astro:52` vs `index.astro:105` | Low | FIXED | unify wording (telemetry = opt-in features, not default) |
| F-42 | `security@k-arthur.design (if configured)` hedge on report page | `support/report-issue.astro:92` | Low | FIXED | resolve alias or drop the line |
| F-43 | `aria-keyshortcuts` carried display strings ("⌘⇧1", "Ctrl+Shift+1") | `WorkspaceTabs.tsx:217` | Low | FIXED | token grammar ("Control+Shift+1") |
| F-44 | Registry labels inconsistent ("Design Workspace" vs "Workspace: Photo") | `ShortcutManager.ts:482-513` | Low | FIXED | one pattern ("Workspace: X") |
| F-45 | Website `--text-primary-on-overlay` oracle gap (test pairs against white, not real surfaces) | `apps/website/src/test/tokens.test.ts:233` | Low | FIXED | add a footer-surface pairing to the token test |
| F-46 | BatchJobList status icon has no accessible name after live-region removal | `BatchJobList.tsx` | Low | FIXED | `aria-hidden` icon + per-status text alternative |

---

## 7. Cross-lens conflicts and resolutions

| Element | Conflicting lenses | Resolution |
|---|---|---|
| Workspace tab hover (C1) | Visual Design (hover should read as "interactive surface") vs Accessibility (text must stay legible on the hover background) | Kept the existing hover background (a deliberate surface cue), changed only the text color to the theme's on-accent pair. No density/size tradeoff. |
| Timeline accent color (F-14) | Visual Design (bright teal is the motion-system identity) vs Accessibility (1.4.11 needs 3:1 on light) | Replaced the bright teal only for timeline *graphics and fills* with the interactive tokens; the bright teal remains everywhere it sits on dark surfaces. Hue family preserved; luminance changed. Documented in CSS. |
| Footer title (C2) | Brand (teal headline on navy is the footer's identity) vs Accessibility (1.04:1) | Kept the brand-teal identity — it *is* the accessible choice (10.0:1). No conflict once computed. |
| Footer links (F-37) | Visual Design (underline-free footer is cleaner) vs Accessibility (1.4.1: link luminance == muted luminance) | Underline at rest, translucent underline color to reduce visual weight. Tradeoff stated: rest-state underline is the accepted cost. |
| Preflight severity (H2) | Content (severity-colored headers read fast) vs Accessibility (3.42:1) | Severity moved to icon+dot (still color-coded, non-text contrast with label present); text neutral. Readability retained, compliance restored. |
| Selected track row (F-15) | Visual Design (dimmed row keeps content subordinated) vs Accessibility (dimming the row dims its text) | Background-only tint; content stays full contrast. Accepted: selection is less "quiet" than before. |
| BatchJobList live regions (F-35) | UX (per-row status readouts) vs Accessibility (screen-reader announcement storm on open) | Removed per-row regions; a single summary region is required once statuses update live (tracked with the status-liveness work). |

---

## 8. Risk register

| # | Risk | Likelihood | Impact | Mitigation / status |
|---|---|---|---|---|
| R1 | E2E suite partially decoupled from real DOM (dead selectors, stale toolbar classes) | High (proven) | High — false CI confidence | Selectors re-targeted; full re-run blocked on in-flight `FloatingToolbar` refactor (parallel session). Re-run before next release (§9-12). |
| R2 | No i18n runtime; single-locale English | High (certain) | Medium today; High if EAA markets are targeted (EAA accessibility statements and product info are not language-conditional, but accessibility *delivery* to non-English users is) | Defer as explicit product decision (§9-1); cost grows linearly with surface count. |
| R3 | Per-frame whole-context state updates during playback | Medium | High — UI jank on large timelines; battery | §9-7; benchmark before/after per repo perf gate. |
| R4 | Web export main-thread rendering | Medium | Medium — frozen UI during long exports | §9-8; desktop path already off-main (IPC). |
| R5 | Undefined CSS tokens silently rendering invalid | Low (found once: `--color-accent-secondary`) | Medium — invisible UI states | Fixed instance; add a token-usage linter to `audit:tokens` (recommend). |
| R6 | Native menu accelerator drift (F-01) | Medium | Medium — wrong advertised shortcuts on macOS | Registry-driven accelerators (§9-3). |
| R7 | Token test oracle gaps (footer overlay pairing) | Medium | Medium — regressions like C2 escape CI | Add real-surface pairings (§9-13). |
| R8 | Preflight errors not gating export | Medium | Medium — users export knowingly-broken files | Warn+confirm (F-34, §9-10). |
| R9 | Parallel-session collision on shared tree (commits, hooks, ports) | Happened this session | Medium — mixed commits, wedged E2E | Working-tree coordination + worktree protocol per AGENTS.md; separate E2E port. |

---

## 9. Prioritized remediation plan

Ordered by severity/effort (S = small ≤0.5d, M = 1–2d, L = 3–5d, XL = 1–2w). Items 1–2 and 6–8 require a decision, not just labor.

| # | Item | Findings | Effort | Priority rationale |
|---|---|---|---|---|
| 1 | **DONE — decision recorded:** English-only for beta with a keyed label seam (WORKSPACE_LABELS + menu localization keys); full i18n pipeline deferred unless an EAA compliance claim is made. Remaining: accessibility-statement deliverable (§9-13) | F-04 | S | Structural; touches every surface. Must be a named decision, not drift |
| 2 | **DONE** (commit `ecf33fcb`): theme-scoped `--graph-track-*`; light set 3.7–3.8:1, dark/hc vivid 10–15:1. Visual sign-off still recommended, no longer blocking | F-13, F-18 | M | Visible contrast failure in a workspace surface; needs visual design sign-off |
| 3 | **DONE** (closing commit): `acceleratorFor()` resolves workspace accelerators from the registry; Codegen item + label key added; menu snapshot regenerated | F-01 | M | Kills the recurring drift class; macOS-only display |
| 4 | **DONE** (commit `ecf33fcb`): click/keyboard selection wiring, focusable dots with Enter/Space activation | F-08 | M | 2.1.1 gap in a core editing surface |
| 5 | **DONE** (commits `ecf33fcb`, `4a54d96e`): playback live region, mask announcements, determinate trace progress | F-11, F-28, F-19 | M | 4.1.3; trace progress needs IPC plumbing (native progress exists as `trace:progress`) |
| 6 | **PARTIAL** (commit `ecf33fcb`): TrackRow memoized (data-only comparator); pushing time to a ref/canvas layer still deferred, benchmark required before it | F-16 | M | Frame-time risk on large timelines |
| 7 | **PARTIAL** (commit `ecf33fcb`): flatten hoisted with per-frame structuredClone. The web export worker (F-36) stays deferred: engine-wasm-in-worker plus IR transfer is an L/XL architecture change with high regression risk, accepted post-beta | F-36, F-17 | L | Main-thread jank during long exports |
| 8 | **DONE** (commit `4a54d96e`): source picker (direct-child candidate set) + announcements | F-27, F-28 | M | Core-path editor gap (mask source unreachable in Inspector) |
| 9 | **DONE** (commit `4a54d96e`): filename validation, denied-vs-cancel, preflight-error gating | F-32, F-33, F-34 | M | 3.3.1 + user trust in export |
| 10 | **DONE** (commit `19bb4a5e`): "128 MB / 64 megapixels" in the native strings | F-21 | S | Trivial; touch `lib.rs` strings only |
| 11 | **DONE** (commits `ecf33fcb`, `4a54d96e`): labels aligned, preview summaries, list/listitem semantics, focus guard | F-25, F-26, F-12, F-03 | M | A11y tree hygiene |
| 12 | **PARTIAL — substantially closed** (commits `a6e4a340`, `85ca27da`): dead selectors re-targeted, icon-only mode matched by aria-label, timeline contract tests repaired. Verified green: timeline-a11y 9/9, timeline-playback 5/5, print-mode-preflight 3/3, workspace-mode (default + switch assertions), cross-mode round-trip, toolbar-per-mode, tooltip 7/8. Remaining: `drawing-mode-focus` pencil-stabilization and `ownership.spec` assert inspector internals mid-refactor by a parallel session; re-run after that refactor lands | C3, F-06…F-09 | M | The suite must actually drive the DOM it claims to test |
| 13 | **PARTIAL** (commit `4903319b`): token-test footer oracle + manifest-derived signing copy done; the EAA-style accessibility statement still requires legal/product sign-off | F-40, F-45, §5 | M | Only required if compliance claim is made; cheap to do anyway |
| 14 | **DONE** (commit `4903319b`): registry label pattern, tips corrected against the registry, privacy wording, security email, duplicate titles | F-02, F-44, F-39, F-41, F-42 | S | Content polish, low risk |
| 15 | **DONE** (closing commit): opt-in `focusFirstControl` on `Dialog`, enabled on Vectorize | F-29 | M | Global Dialog change; needs per-dialog review |

---

## 10. Unvalidated hypotheses (claims about users that need real validation)

These were deliberately **not** given severity or business-impact scores:

1. "Users will be confused when the focused panel disappears after a mode switch" (F-03) — plausible focus-management concern; needs usability testing with AT users.
2. "Keyboard users expect to edit keyframes from the timeline" (F-08) — convention-aligned (every professional timeline supports it), but Varve's power-user behavior is unverified.
3. "Silent filename sanitization surprises users" (F-32) — deviation from conventional validation feedback; hypothesis, not measured.
4. "The mask source being read-only in Inspector blocks the masking workflow for real users" (F-27) — the model supports `setMaskSourceNode`; whether users hit the need is unmeasured.
5. "Timeline playback announcements will be noise rather than signal for screen-reader users" (F-11) — could go either way; validate with a pilot before shipping all announcements.
6. "Bright teal timeline graphics are part of the product identity users rely on" (F-14) — the fix kept the hue; this is about whether luminance change is acceptable, verifiable only with design feedback.
7. "Underlined footer links harm the site's visual tone" (F-37) — cosmetic judgment; unvalidated.

**Validation paths:** targeted Playwright specs with axe-core + keyboard scripts (mechanical); usability sessions with 3–5 screen-reader users for 1–3; analytics event on export-dialog errors for 4–5 once telemetry exists (opt-in only).

---

## 11. Final readiness assessment

### 11.1 Scoring rubric (defined before scoring, applied consistently)
Per-lens score = `100 × (1 − Σ(open_finding_weight) / Σ(all_finding_weight))`, where finding weight = 25 (Critical) / 12 (High) / 5 (Medium) / 2 (Low) — i.e. the score measures **remediation progress within scope**, not conformance. Scores are internal review scores only; they are not a certification (§11.3).

| Lens | Weighted progress | Notes |
|---|---|---|
| Accessibility | 96 | all C/H closed; open: F-01 (Med), F-29, F-05 (Low) |
| UX | 95 | open: F-36, F-29 |
| Visual Design | 92 | open: F-37 tradeoff note; F-13 palette shipped, sign-off optional |
| Design System | 95 | open: F-01; R5 close-call fixed |
| Front-End Architecture | 90 | open: F-36, F-16 ref-layer |
| Performance | 88 | open: F-36, F-16 ref-layer (memo shipped) |
| Localization | 60 | decision recorded: English-only + keyed seam; no runtime |
| Product Strategy | 90 | F-04 decision recorded; F-41/F-42 fixed |
| QA | 78 | C3 selectors fixed; full re-run pending (R1, §9-12) |
| Security/Privacy UX | 98 | F-40, F-41, F-42 fixed |
| Content/Microcopy | 96 | F-22, F-32, F-33, F-34 fixed; F-01 copy open |

### 11.2 Readiness statement
- **GO for public beta** with three named acceptance decisions and two tracked debt items:
  1. **DECIDED this session:** English-only for beta with a keyed label seam (§9-1). Any EU EAA compliance claim requires the full pipeline plus the accessibility-statement deliverable.
  2. **DECIDED this session:** GraphEditor track palette shipped theme-aware (light 3.7–3.8:1); visual sign-off optional, not blocking.
  3. **Accept** the remaining playback ref-layer and web-export-worker work as post-beta (F-16 ref-layer, F-36; TrackRow memo + flatten hoist already shipped — no blocking jank reported, no profiling runs done).
  4. **Track** the E2E re-run (C3/§9-12) as a release-blocker for the *next* release if the toolbar refactor lands before it; the timeline-a11y contract update ships with this review.
- All Critical and High findings are either fixed (C1, C2, H1, H2) or explicitly tracked with an owner-of-record (C3). Of the 46 Medium and 27 Low findings, 26 Medium and 20 Low are now fixed; the remaining open items are F-01 (macOS menu accelerators), F-05 (pre-existing toolbar-config gap), F-29 (dialog initial focus), F-36 (web export worker), plus the E2E re-run.

### 11.3 Certification caveat
This review is **not** a professional accessibility audit and does not constitute legal sign-off for ADA, Section 508, or EN 301 549/EAA conformance. The requester named a compliance driver; therefore: before any conformance claim or EU-market distribution with an EAA accessibility statement, commission a professional audit against EN 301 549 (current harmonized version, which per W3C's index references WCAG 2.2) and, for US federal procurement, Section 508 E205.4/E207.2 (currently WCAG 2.0 A/AA). ETSI EN 301 549 v4.1.1 text could not be fetched directly this session (404) — verify the harmonized version reference (§4, row 4).

### 11.4 Named uncertainties
- E2E: motion (14/14), print-mode-preflight (3/3), workspace-switch and cross-mode round-trip, toolbar-per-mode, and tooltip 7/8 verified green. `drawing-mode-focus` (pencil Stabilization) and `ownership.spec` remain red against inspector internals that a parallel session is actively refactoring (their unit failures in the same files confirm it is their in-flight state, not this review's changes); re-run after their refactor lands.
- Website `tsc` failure in `scripts/screenshots/demo-document.ts` is pre-existing (unrelated `Document` export drift) and was not introduced or fixed here.
- Live behavior (pointer paths, AT behavior) not exercised beyond the E2E subset that ran; §8 testability statement applies.
- Offline, corrupted-data, and multi-user states were **not** testable from code review alone (§8 of the process); no claims are made about them.

### 11.5 Approval
No final approval is being issued by this review: per the process, approval requires a named decision-maker to accept the deferred items (§9-1, §9-2, §9-3, §9-6, §9-7, §9-8). This document records the state; acceptance is a product decision, not a reviewer decision.



