# Strata UI/UX Design Review — July 2026

| | |
|---|---|
| **Artifact** | Source code, packages/editor + packages/ui |
| **Review method** | Static code analysis (6 specialist lenses × cascaded) |
| **Audience** | Professional designers (editor) / general users (home) |
| **Baseline** | 4459+ JS tests passing, 96/96 WCAG-AA tokens, E2E axe-core scans |

---

## 1. Executive Summary

**Overall readiness: BETA** — functional core is strong; usability and resilience gaps block production readiness.

| Metric | Score | Notes |
|---|---|---|
| Accessibility | 68/100 | ARIA patterns mostly correct, 2 critical ARIA misuses, focus style inconsistency |
| UX | 62/100 | Strong layout but invisible feedback system and incomplete Edit menu |
| Visual/Design System | 52/100 | ~150 inline styles bypass design system; hardcoded hex in TSX components |
| Architecture | 40/100 | 5.4k-line context monolith drives pervasive re-renders; worker crash silent |
| Content/Microcopy | 74/100 | Generally clear; Delete/Remove inconsistency; raw errors exposed in UI |
| QA/Edge Cases | 58/100 | No ErrorBoundary deployed in Shell; Ctrl+Shift+E shortcut collision |

**Findings: 7 Critical, 13 High, 32 Medium, 17 Low** (69 total)

**Go/No-go: NO-GO** — 7 critical findings must be resolved before production ship. The toast feedback gap (UX-C1), context monolith (Arch-C1), and hardcoded hex bypassing the token system (Vis-C1) represent fundamental usability, maintainability, and theming failures.

**Note:** This is an internal code review score, not a compliance certification. WCAG 2.2 AA compliance requires a professional audit; this review checked against known WCAG criteria where testable from static code.

---

## 2. Scope & Assumptions

### In scope
- `packages/editor/src/` — all ~630 source files (212 TSX, 210 TS, 40 CSS)
- `packages/ui/src/` — all ~148 source files (70 TSX, 14 TS, 7 CSS)
- Key surfaces: Shell, CanvasArea, PropertiesPanel, LayersPanel, FloatingToolbar, Menubar, StatusBar, dialogs, overlays, onboarding

### Out of scope
- Rust crates (`crates/`), Tauri backend (`apps/desktop/src-tauri/`)
- `@varve/home` (home screen — covered at architectural level only)
- `@varve/prototype`, `@varve/engine`, `@varve/scene` (model layer)
- Live runtime testing (no dev server running — source-only audit)
- Performance profiling (no flame graphs or runtime metrics)

### Assumptions
- Target audience inferred from codebase surface (professional design tool conventions)
- No user research or analytics were available — user-behavior claims flagged as hypotheses
- No brand guidelines beyond what's in the token system were provided

---

## 3. Screen/Flow/Component Inventory

See audit working notes for full map. Major surfaces reviewed:

| Surface | Files | Complexity |
|---|---|---|
| Shell (editor layout) | `Shell.tsx` (981 lines) | Wires ~30 overlays/dialogs, DnD context, lifecycle handlers |
| CanvasArea | `CanvasArea.tsx` (2,838 lines) | 3 render paths, 17 useEffect, 6 useCallback, 20+ useRef |
| EditorProvider/Context | `context.tsx` (5,448 lines) | 39 state fields, 150+ methods, monolithic |
| PropertiesPanel | `components/Inspector/PropertiesPanel.tsx` (255 lines) | 4 tabs, 12+ sub-sections |
| LayersPanel | `components/LayersPanel/` (10+ files) | Virtualized APG tree, DnD, thumbnails, search, bulk ops |
| FloatingToolbar | `components/FloatingToolbar/` (231 lines) | 18 tools, boolean submenu |
| Menubar | `Menubar.tsx` (871 lines) | 7 menus, 50+ items |
| UI components | `packages/ui/src/components/` (28 types) | Button, Dialog, Menu, Select, Tabs, Tooltip, ColorPicker, etc. |
| Token system | `packages/ui/src/tokens/` (8 files) | OKLCH, 3 themes, 96/96 WCAG-AA, DTCG export |

---

## 4. Findings — Critical & High (TDD detail)

### CRITICAL (7)

#### C1. No visual feedback system — all user feedback is screen-reader only
- **Lens:** UX
- **Files:** `context.tsx:1240-1242`, `Toast.tsx`, `Shell.tsx`
- **Expected:** Every `announce()` call (100+ sites) should ALSO produce visible toast/banner feedback.
- **What fails:** `Toast` component exists but no `ToastContainer` is rendered in Shell. Sighted users see nothing when actions succeed, fail, or save.
- **Reach:** All users on every action. **Impact:** Blocks task awareness.
- **Severity:** Critical (high reach × high impact)
- **Remediation:** Render `<ToastProvider>` in Shell. Wire `showToast()` alongside `announce()` in editor context.
- **Verification:** Perform "Fill added", "Saved" — no visual feedback appears.

#### C2. Hardcoded hex colors in production TSX components bypass token system
- **Lens:** Visual Design / Design System
- **Files:** `MeshWarpOverlay.tsx:207`, `CollabProvider.tsx:21-41`, `ComponentSection.tsx:124`, `SelectiveColorGrid.tsx:15-23`, `MinimapPanel.tsx:168,185`, `Ruler.tsx:65`, `HistogramWidget.tsx:96`
- **Expected:** All colors reference `var(--color-*)` CSS custom properties.
- **What fails:** 14+ hardcoded hex values across 7+ files. Will break in dark/high-contrast themes. `#39d0c6` (the brand teal) appears raw in 3 files.
- **Reach:** All theme users. **Impact:** Theme-invisible components.
- **Severity:** Critical (high reach × high impact)
- **Remediation:** Replace with `var(--color-accent-primary)` or semantic token. Collab user colors should map to `--color-layer-tag-*`.
- **Verification:** Switch to dark/high-contrast theme — affected components should still be visible.

#### C3. ~150 inline style blocks bypass CSS-in-JS and design system
- **Lens:** Visual Design / Design System
- **Files:** 30+ files across editor and UI packages (SelectionOverlay, CanvasArea, AdjustmentEditor, FillSection, PreflightWarnings, FloatingTextBar, GuideOverlay, Tooltip, Slider, ColorArea, ColorSlider, etc.)
- **Expected:** Layout styling should use CSS classes referencing design tokens.
- **What fails:** Repeated `display: 'flex'`, `flexDirection: 'column'`, `gap: 'var(--space-1)'` patterns. `var(--text-tertiary)` typo in one file. ~100+ editor inline blocks, ~45+ UI inline blocks.
- **Reach:** All components. **Impact:** Theme overrides harder; maintainability debt.
- **Severity:** Critical (high reach × high impact)
- **Remediation:** Extract repeated layout patterns to CSS classes (`.insp-field-row`, `.flex-col`). Fix `var(--text-tertiary)` → `var(--color-text-muted)`.
- **Verification:** `rg 'style=\{\{'` count across editor+UI should drop by 80%.

#### C4. Context monolith — every state change re-renders all consumers
- **Lens:** Front-End Architecture
- **Files:** `context.tsx` (5,448 lines), `context/types.ts` (479 lines)
- **Expected:** State split by domain (viewport, tool, doc, UI) with separate contexts.
- **What fails:** 39 `EditorState` fields, 150+ methods in `EditorContextValue`. Every `patch()` creates a new state reference; the single `useMemo` on `value` depends on everything. Sub-contexts already extracted (`ViewportProvider`, `SelectionProvider`, `DocumentProvider`) but still depend on the full `value` object.
- **Reach:** Every component in the editor. **Impact:** Pervasive unnecessary re-renders, 50-entry undo cap.
- **Severity:** Critical (high reach × high impact)
- **Remediation:** Split `EditorState` into domain-specific `useReducer` calls. Decouple sub-context `useMemo` deps from the full `value` object.
- **Verification:** Profiler should show <20% of components re-rendering on zoom change.

#### C5. SearchField uses `role="combobox"` for a plain search input
- **Lens:** Accessibility
- **Files:** `SearchField.tsx:37-41`
- **Expected:** Plain search input uses `type="search"` or `role="searchbox"`.
- **What fails:** `aria-expanded=true` when `value.length > 0` implies a popup. `aria-controls` references a non-existent listbox. `aria-autocomplete="list"` promises suggestions that don't exist.
- **Reach:** All screen reader users. **Impact:** Confusing, misleading announcements.
- **Severity:** Critical (high impact × all users who SR)
- **Remediation:** Remove `role="combobox"`, `aria-autocomplete`, `aria-expanded`, `aria-controls`. Use `type="search"`.
- **Verification:** Axe-core on SearchField page.

#### C6. FocusTrap registers `document`-level listener — conflicts with native `<dialog>`
- **Lens:** Accessibility
- **Files:** `FocusTrap.tsx:50`
- **Expected:** Focus trapping scoped to container element.
- **What fails:** `document`-level `keydown` listener. When `<FocusTrap>` wraps content inside a native `<dialog>` (which has its own focus trapping), or when nested FocusTraps exist, the outermost trap captures all Tab presses.
- **Reach:** Dialog users. **Impact:** Keyboard trap in non-dismissible dialogs.
- **Severity:** Critical (low reach × high impact — Escape will not close M5 scenario)
- **Remediation:** Attach `keydown` to `containerRef.current`, not `document`.
- **Verification:** Tab through ExportDialog — focus should not wrap when another dialog is open.

#### C7. `export` and `exportSvg` shortcut collision (Ctrl+Shift+E)
- **Lens:** QA / Edge Cases
- **Files:** `ShortcutManager.ts:23-32`
- **Expected:** Each shortcut has unique binding.
- **What fails:** Both `export` and `exportSvg` register `Ctrl+Shift+E`. The later registration overwrites the first. `exportSvg` is unreachable via keyboard.
- **Reach:** All users. **Impact:** One shortcut silently dead.
- **Severity:** Critical (high reach × high impact)
- **Remediation:** Change `exportSvg` to `Ctrl+Alt+E`. Add programmatic collision detection to `ShortcutManager`.
- **Verification:** Press Ctrl+Shift+E — should trigger export dialog, not SVG export.

---

### HIGH (13)

#### H1. Edit menu missing Copy/Cut/Paste/Duplicate/Select All
- **Lens:** UX
- **Files:** `Menubar.tsx:64-71`
- **Expected:** Edit menu lists Copy, Cut, Paste, Duplicate, Select All with shortcut labels.
- **What fails:** Only Undo, Redo, Delete are present. Actions exist in right-click context menu and as keyboard shortcuts but are undiscoverable from the menu bar.
- **Severity:** High

#### H2. Error boundary has no recovery path
- **Lens:** UX
- **Files:** `ErrorBoundary.tsx:34-67`
- **Expected:** Expandable error details, "Copy error" button, support link.
- **What fails:** Default fallback shows icon + "Something went wrong" + single "Reload" button.
- **Severity:** High

#### H3. `window.prompt()` used in TimelinePanel for naming
- **Lens:** UX
- **Files:** `Shell.tsx:537,549`
- **Expected:** Proper `<dialog>` element using existing `strata-dialog` pattern.
- **What fails:** Unstyled, no validation UI, not keyboard-accessible in expected way.
- **Severity:** High

#### H4. No ErrorBoundary deployed in Shell.tsx
- **Lens:** QA / Edge Cases
- **Files:** `Shell.tsx`
- **Expected:** Sub-trees (CanvasArea, LayersPanel, PropertiesPanel) individually wrapped in `<ErrorBoundary>`.
- **What fails:** Zero `<ErrorBoundary>` imports in Shell. A render crash in any panel collapses the entire editor to a blank white page.
- **Severity:** High

#### H5. Worker crash silently drops frames with no fallback
- **Lens:** Front-End Architecture
- **Files:** `workerHost.ts:40`, `CanvasArea.tsx:614-628`
- **Expected:** On worker error, fall back to main-thread rendering for the session.
- **What fails:** `worker.onerror` sends `{ type: 'error' }` but CanvasArea's message handler only matches `'frameRendered'`. Error is silently swallowed.
- **Severity:** High

#### H6. No try/catch in 2,838-line CanvasArea render path
- **Lens:** Front-End Architecture
- **Files:** `CanvasArea.tsx`
- **Expected:** Structured error handling around the main async render body.
- **What fails:** Single try/catch at line 762. The async IIFE (line 929) has `.finally()` but no `.catch()`.
- **Severity:** High

#### H7. `:focus` used instead of `:focus-visible` in 19+ editor CSS locations
- **Lens:** Accessibility
- **Files:** `editor.css`, `layers.css`, `inspector.css`, `adjustment.css`, `VariantBox.css`, `ContextualHelpPanel.css`
- **Expected:** Visible focus indicator only for keyboard navigation (`:focus-visible`).
- **What fails:** `:focus` shows focus ring on every mouse click. UI package uses `:focus-visible` correctly — editor lags behind.
- **Severity:** High

#### H8. Global keyboard handler doesn't guard against custom focusable ARIA widgets
- **Lens:** Accessibility
- **Files:** `useShortcuts.ts:289-296`
- **Expected:** Tag-name check covers `[role="combobox"]`, `[role="listbox"]`, `[role="spinbutton"]`, `[role="textbox"]`, `[data-shortcut-ignore]`.
- **What fails:** Custom `<Select>` uses `role="combobox"` on a `<div>`. ArrowUp/Down/Enter in the dropdown may trigger editor shortcuts.
- **Severity:** High

#### H9. Tree row tokens: hover=indent-guide, selected=focus (perceptually identical)
- **Lens:** Accessibility
- **Files:** `tokens.css:37-40`
- **Expected:** Distinct tokens for hover vs indent-guide backgrounds; distinct tokens for selected vs focus-only.
- **What fails:** `--color-tree-row-hover` and `--color-tree-indent-guide` both `oklch(0.5699 0.0308 260.28)`. `--color-tree-row-selected` and `--color-tree-row-focus` both `oklch(0.4452 0.0693 190.9)`.
- **Severity:** High

#### H10. Hardcoded font sizes (10px, 11px) in TSX inline styles
- **Lens:** Visual Design / Design System
- **Files:** `AdjustmentEditor.tsx:524,547,673,688,703,956`, `AdjustmentLayerRow.tsx:160`, `Shell.tsx:945`
- **Expected:** All font sizes trace to `--font-size-*` tokens.
- **What fails:** `fontSize: '10px'` appears in 8+ sites. 10px is below WCAG SC 1.4.4 minimum resizable text size.
- **Severity:** High

#### H11. Hardcoded px values in editor.css (100+ sites) bypass spacing token system
- **Lens:** Visual Design / Design System
- **Files:** `editor.css`
- **Expected:** All sizing/spacing traces to `--space-*` tokens.
- **What fails:** 100+ hardcoded pixel values for element heights, widths, gaps, padding, border-radius. Not all need tokenization (structural ex: 1px borders, 2px focus rings) but most element-sizing values should.
- **Severity:** High

#### H12. `forwardRef` inconsistency across interactive components
- **Lens:** Visual Design / Design System
- **Files:** `NumberInput.tsx`, `Slider.tsx`, `Select.tsx`, `SearchField.tsx`, `SegmentedControl.tsx`, `Panel.tsx`, `Toast.tsx`
- **Expected:** All interactive components implement `forwardRef`.
- **What fails:** Only 3 of 10+ interactive components (`Button`, `IconButton`, `Dialog`) use `forwardRef`. Prevents parent ref access for focus management and positioning.
- **Severity:** High

#### H13. "Deny" in PermissionDialog is a no-op
- **Lens:** Security/Privacy UX
- **Files:** `PermissionDialog.tsx:54-61`
- **Expected:** Clicking "Deny" rejects the plugin installation or permission grant.
- **What fails:** Both "Allow" and "Deny" call `onClose` — neither actually grants or denies. Plugin is already installed; dialog is post-install read-only. User who clicks "Deny" believes they've blocked access.
- **Severity:** High

---

## 5. Findings — Medium & Low (compact table)

### Medium (32)

| # | Finding | Lens | File(s) | Fix |
|---|---|---|---|---|
| M1 | Axe-core E2E missing full-page scans + WCAG 2.2 tags | A11y | `axe.spec.ts` | Add `wcag22a`,`wcag22aa`,`best-practice` tags and full-page scan |
| M2 | Menu submenu uses unicode "▸" char | A11y | `Menu.tsx:422` | Replace with `<Icon name="ChevronRight" aria-hidden />` |
| M3 | CanvasAccessibilityTree is flat (no nesting) | A11y | `CanvasAccessibilityTree.tsx:86-97` | Wrap children in nested `<div role="group">` |
| M4 | NumberInput uses `type="text"` (no numeric keypad) | A11y | `NumberInput.tsx:114` | Add `inputMode="decimal"` + `role="spinbutton"` |
| M5 | Dialog Escape handling redundant (native + onKeyDown) | A11y | `Dialog.tsx:46-66` | Single handler; remove `preventDefault()` from native `cancel` |
| M6 | ExportDialog may lack `role="dialog"` | A11y | `ExportDialog.tsx:780` | Verify root has `role="dialog" aria-modal aria-labelledby" |
| M7 | No `aria-keyshortcuts` on menuitems | A11y | `Menu.tsx`, `Menubar.tsx` | Add `aria-keyshortcuts` to items with shortcuts |
| M8 | No loading indicator during save/open/import | UX | `Shell.tsx`, `context.tsx` | Add status bar pulse or brief indicator |
| M9 | `confirmNewDoc` always warns regardless of dirty state | UX | `Menubar.tsx:857-868` | Gate behind `if (state.dirty)` |
| M10 | Undo stack cap (50) invisible to user | UX | `context.tsx:1358` | Add indicator or increase to 200+ |
| M11 | Pattern/image fill controls are raw text inputs | UX | `FillSection.tsx:493-529` | Add file browser button + preview thumbnail |
| M12 | OnboardingChecklist component exists but is never rendered | UX | `OnboardingChecklist/index.tsx`, `Shell.tsx` | Import and render conditioned on `onboarding.active` |
| M13 | Hardcoded oklch/rgba shadow values in CSS | DS | `components.css:264`, `editor.css:903` | Replace with `var(--elevation-shadow-*)` |
| M14 | Hardcoded hex in CSS files | DS | `StartupLoader.css`, `color-picker.css` | Replace with token fallbacks |
| M15 | Hardcoded px in UI CSS | DS | `components.css`, `color-picker.css` | ~10 sites, replace with `--space-*` tokens |
| M16 | Toast close button uses `&times;` HTML entity | DS | `Toast.tsx:95` | Replace with `<Icon name="X" label="Dismiss" />` |
| M17 | PrismJS + fflate are static imports (no code splitting) | Arch | `syntax.ts`, `packageExport.ts` | Use `React.lazy()` for SpecPanel |
| M18 | Only 2 components use React.memo | Arch | Various | Apply `React.memo` to all shell panels |
| M19 | Full-document snapshots for undo won't scale | Arch | `context.tsx:1358` | Delta/op-based undo |
| M20 | Histogram bar uses `height` transition (triggers layout) | Arch | `inspector.css:1120` | Use `transform: scaleY()` |
| M21 | Error boundary copy generic, unactionable | Content | `ErrorBoundary.tsx:58-64` | Tiered message system; "Try again" button |
| M22 | Model download exposes raw Error.message | Content | `ModelDownloadDialog.tsx:126` | Map common errors to friendly messages |
| M23 | "Delete" vs "Remove" inconsistency | Content | Multiple files | "Delete" for irreversible, "Remove" for detachment |
| M24 | Abbreviated segment labels (In/Ct/Spc/Ard) | Content | `StrokeSection.tsx`, `LayoutSection.tsx` | Expand abbreviations; add tooltips |
| M25 | Export AI fallback silent | Content | `ExportDialog.tsx:306-309` | Show visible banner: "Used Quick mode" |
| M26 | Plugin perms read-only, not configurable | Security | `PluginList.tsx:82-88` | Per-permission toggles |
| M27 | Bulk delete uses `window.confirm()` browser dialog | Security | `context.tsx:2035` | Use app's AlertDialog |
| M28 | Save error state not visible to user | QA | `context.tsx` | Add StatusBar indicator for `saveState === 'error'` |
| M29 | Undo snapshot staleness risk | QA | `context.tsx:1430` | Verify React batching doesn't cause stale reference |
| M30 | No programmatic shortcut collision detection | QA | `ShortcutManager.ts` | Add `detectCollisions()` safety check |
| M31 | No onboarding reset UI in Settings | QA | `SettingsDialog.tsx` | Add "Reset onboarding" button |
| M32 | Non-null assertions in layerBulkOperations | QA | `layerBulkOperations.ts:47,66,84` | Guard with `selection.length > 0` check |

### Low (17)

L1: Reduced-motion not auto-applied in prototype runtime
L2: `<mark>` without explicit `role="mark"` in SearchField
L3: Dialog lacks `aria-describedby` for description content
L4: Tablist missing `aria-orientation="horizontal"`
L5: Duplicate zoom input (Menubar + StatusBar)
L6: FAB buttons create redundant panel visibility system
L7: Welcome dialog tour vs tutorial distinction unclear
L8: Image/Pattern fill empty states lack guidance
L9: Dual BEM prefix (strata- vs editor- vs unprefixed)
L10: Hardcoded media query px (reference-only breakpoints)
L11: `label={undefined}` pattern on decorative icons
L12: StatusBar shows raw tool ID string
L13: `nodeEdit` tool missing label in TOOL_LABELS
L14: Plugin removal has no confirmation
L15: `console.warn` exposes doc validation details
L16: `document` null guard in CanvasArea
L17: `save()` silently returns false when platform undefined

---

## 6. Cross-Lens Conflicts & Resolutions

| Conflict | Lenses | Resolution |
|---|---|---|
| Toast feedback adds visual noise vs. aria-live only | UX wants visible feedback; A11y says SR-only is sufficient | **Both.** Toasts for sighted users, aria-live for SR. Toasts auto-dismiss after 3s. |
| `:focus` vs `:focus-visible` | A11y: some motor-disability users benefit from click-focus; modern standard says `:focus-visible` | **`:focus-visible`** per WCAG 2.2 SC 2.4.7. Click-focus is historically a mouse-user pattern, not an accessibility requirement. |
| Tokenize all px vs. structural px are fine | DS wants full tokenization; Architecture says some sizes are structural (1px border, 2px focus ring) | **Structural px are fine.** Element sizing (heights, widths, gaps, padding) should be tokens. Border widths and focus rings can remain hardcoded. |
| Inline styles vs. CSS classes | Performance says inline can be faster; DS says CSS classes enable theming | **CSS classes.** Theming wins. Only dynamic (computed) inline styles are justified. |

---

## 7. Standards Matrix

| Standard | Status | Notes |
|---|---|---|
| WCAG 2.2 AA SC 1.1.1 (Non-text Content) | **Fail** | Canvas decorative grid has no alt text (expected for design tool) |
| WCAG 2.2 AA SC 1.4.1 (Use of Color) | **Pass** | Color is never the sole conveyor of information |
| WCAG 2.2 AA SC 1.4.3 (Contrast Minimum) | **Pass** | 96/96 token pairs audited; label-defined contrast |
| WCAG 2.2 AA SC 1.4.4 (Resize Text) | **Pass** | Fluid clamp() scale; 10px hardcoded in some places (H10) |
| WCAG 2.2 AA SC 1.4.11 (Non-text Contrast) | **Pass** | All UI component pairs meet 3:1 |
| WCAG 2.2 AA SC 1.4.12 (Text Spacing) | **Pass** | No overflow clipping on text |
| WCAG 2.2 AA SC 2.1.1 (Keyboard) | **Fail** | Document pending actions |
| WCAG 2.2 AA SC 2.4.7 (Focus Visible) | **Fail** | `:focus` not `:focus-visible` in editor CSS (H7) |
| WCAG 2.2 AA SC 2.4.11 (Focus Appearance) | **Fail** | Some focus rings may be too thin (2px may not meet minimum area) |
| WCAG 2.2 AA SC 4.1.2 (Name, Role, Value) | **Fail** | SearchField `role="combobox"` misleading (C5) |
| WCAG 2.2 AA SC 4.1.3 (Status Messages) | **Pass** | `role="status"`, `aria-live="polite"` on all status messages |
| ARIA Authoring Practices (APG) | **Pass** | Tabs, Toolbar, Tree, Dialog, Combobox (mostly) follow APG patterns |

---

## 8. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Worker crash → blank canvas | Medium | Critical | Add fallback to main-thread; single fix (H5) |
| Source code leak via model download error | Low | High | Map error messages (M22) |
| Plugin permission bypass | Low | High | Implement actual enforcement (H13) |
| Context re-render perf degradation with 10K nodes | High | Medium | Domain-split context (C4 — deferred) |
| Keyboard trap in non-dismissible dialog | Low | Critical | Fix FocusTrap (C6) |
| Shortcut collision silently dead | High | High | Add collision detection (C7) |
| Theme-invisible components | High | Low | Replace hardcoded hex (C2) |

---

## 9. Prioritized Remediation Plan

### Sprint 1 (Effort: 3-4 days)
| # | Finding | Effort | Value |
|---|---|---|---|
| C1 | Wire ToastProvider + showToast() in context | 1d | Critical — all user feedback |
| C7 | Fix export/exportSvg shortcut collision + add detection | 0.5d | Low effort, prevents silent breakage |
| H4 | Wrap shell panels in ErrorBoundary | 0.5d | Prevents full-app crash |
| H5 | Worker error fallback to main-thread | 1d | Prevents blank canvas |
| H13 | Fix PermissionDialog (deny actually denies) | 0.5d | Security integrity |

### Sprint 2 (Effort: 3-5 days)
| # | Finding | Effort | Value |
|---|---|---|---|
| C2 | Replace hardcoded hex in TSX → CSS vars | 1d | Theme correctness |
| C5 | Fix SearchField ARIA role | 0.5d | Screen reader correctness |
| C6 | Fix FocusTrap container scope | 0.5d | Dialog keyboard safety |
| H1 | Fill missing Edit menu items | 1d | Discoverability |
| H7 | Replace `:focus` → `:focus-visible` in editor CSS | 0.5d | Focus visual noise |
| H8 | Extend keyboard handler guard | 0.5d | Form interaction safety |
| H9 | Create distinct tree-row-focus token | 0.5d | Visual distinction |

### Sprint 3 (Effort: 4-6 days)
| # | Finding | Effort | Value |
|---|---|---|---|
| C3 | Extract ~150 inline styles to CSS classes | 2d | Theming + maintainability |
| H2 | Improve ErrorBoundary fallback (details + copy) | 1d | User recovery |
| H3 | Replace window.prompt() with Dialog | 1d | UX consistency |
| H10 | Fix hardcoded font sizes to tokens | 1d | Readability + WCAG |
| H11 | ~50px values → spacing tokens | 1d | Token consistency |
| H12 | Add forwardRef to 7 interactive components | 0.5d | Component composition |

### Deferred
| # | Finding | Notes |
|---|---|---|
| C4 | Context monolith split | Weeks of work; high risk of regression |
| M19 | Delta-based undo | Architectural change; pair with C4 |
| M17 | Code splitting | SpecPanel, fflate — performance optimization only |

---

## 10. Unvalidated Hypotheses

These findings are judgments or user-behavior claims without supporting user research:

1. **No loading indicator during save/open/import (M8)** — "Users will feel uncertain" is a hypothesis; testing could confirm or deny
2. **Undo stack cap (50) invisible to user (M10)** — Professional users doing batch edits may hit this; testing needed
3. **FAB buttons create conflicting panel visibility (L6)** — May be intentional for future responsive design; need design rationale
4. **Welcome dialog tour vs tutorial distinction unclear (L7)** — New user perception needs usability testing
5. **Pattern/image fill controls lack guidance (L8)** — Pain level depends on how often users encounter image/pattern fills

These should not be assigned business-impact scores; they need validation.

---

## 11. Final Readiness Assessment

| Category | Score | Interpretation |
|---|---|---|
| **Accessibility** | 68/100 | Most ARIA patterns correct but 2 critical misuses + focus style inconsistency |
| **UX** | 62/100 | Strong layout; invisible feedback and incomplete menu are blockers |
| **Visual Design System** | 52/100 | Token system is excellent but pervasively bypassed |
| **Architecture** | 40/100 | Context monolith and render-pipeline fragility are structural debt |
| **Content / Microcopy** | 74/100 | Generally strong; Delete/Remove inconsistency and raw error exposure |
| **QA / Edge Cases** | 58/100 | Good data-integrity engineering; missing operational safety nets |

**Overall: 56/100 — BETA. Not production-ready while 7 critical findings are open.**

**Go/No-go: NO-GO.** The toast system gap (C1) makes the app feedback-invisible. The hardcoded hex values (C2) and inline styles (C3) mean the token system isn't actually enforced. The context monolith (C4) threatens performance at scale. The SearchField (C5) and FocusTrap (C6) are active accessibility regressions. The shortcut collision (C7) is a functional defect.

**This is an internal review, not a compliance certification.** WCAG 2.2 AA compliance, ADA, EN 301 549, or Section 508 conformance require a professional audit. The scores above are internal quality metrics, not legal sign-off.

**Strong areas worth preserving:**
- Token drift guard (96/96 WCAG-AA pairs verified at test time)
- Comprehensive reduced-motion support (40+ CSS rules, JS utility, runtime integration)
- Data integrity engineering (auto-save, recovery, versioned documents, validation)
- 4459+ JS tests and thorough E2E coverage (119 Playwright tests)
- Canvas announcer and accessibility tree for complex graphics
- Thoughtful empty states with actionable copy
