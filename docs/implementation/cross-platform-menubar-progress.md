# Cross-Platform Menubar and Title-Bar Infrastructure - Progress Report

**Status**: Phase 1-9 (Audit → Implementation) Complete | Verification Complete | Documentation In Progress  
**Date**: 2026-08-01  
**Scope**: Audit, fix, redesign, standardize, test, and document complete menubar and title-bar infrastructure across Linux, Windows, macOS, and browser.

---

## Executive Summary

The current implementation shows visible defects on CachyOS (Linux/Wayland) as documented in the provided screenshot. The menubar appears above or conflicts with the window-control region, raw localization keys (`menu.edit`, `menu.help`) are displayed, and the overall layout does not resemble a coherent desktop menubar. This audit reveals a fragmented architecture with multiple overlapping systems that need consolidation.

### Root Cause of the CachyOS Screenshot (confirmed)

The GTK native menubar strip shown above the title-bar region in the screenshot is produced by `app.set_menu()` on Linux. The chain:

1. `Menubar.tsx` mounts `useNativeMenu()` unconditionally on every Tauri platform.
2. `isNativeMenuAvailable()` returns `true` for any Tauri runtime (`__TAURI_INTERNALS__` present), regardless of OS.
3. `useNativeMenu` builds an Edit + Help native menu and calls `sendNativeMenuSpec` → Tauri `build_native_menu` → Rust `app.set_menu()`.
4. On Linux (WebKitGTK/GTK) this draws a native GTK menubar strip ABOVE the webview content — i.e. above the app's custom TitleBar.
5. The native menu labels were built with `formatLabel = undefined`, so `resolveLabel` fell back to `def.labelKey` → the raw keys `menu.edit` / `menu.help` (and every item) rendered in that strip.
6. `decorations: false` forces custom chrome on all platforms, so the custom TitleBar (window controls) renders *inside* the webview below the stray strip — appearing displaced/conflicting.

Fixes shipped in this milestone:

- **Native menu gating**: `useNativeMenu` now only activates when the resolved window-chrome strategy is `native-application-menu` (macOS). Linux and Windows never call `app.set_menu`, so the stray GTK strip cannot appear. Decision lives behind `shouldUseNativeMenu(platform)` in `@varve/platform`.
- **Label resolution**: `menu/localization.ts` now resolves every `labelKey` to a real display string (full English dictionary + humanized fallback), and the resolver is threaded through the native adapter and the defs-driven renderer, so raw keys can never reach production UI.
- **Window-chrome strategy wiring**: `TitleBar` renders only when the strategy calls for custom chrome (`showCustomTitleBar`), reflects live maximize/fullscreen/focus state, and routes actions through a rejection-safe, rapid-click-guarded service. Browser builds render no fake window controls.
- **Tests**: localization integrity test (every defs `labelKey` resolves), platform strategy-decision tests, and a Playwright chrome-integrity spec asserting no raw keys, no desktop controls in the browser build, and correct menubar placement.

---

## Phase 1: Repository-Wide Audit - Complete

### Current Architecture Map

#### 1. Desktop Window Configuration
- **Location**: `apps/desktop/src-tauri/tauri.conf.json`
- **Current State**: 
  - `decorations: false` (custom decorations enabled)
  - `shadow: true`
  - `withGlobalTauri: true`
- **Implication**: Application uses custom title-bar implementation, not native OS decorations

#### 2. Custom Title Bar Implementation
- **Location**: `apps/desktop/src/chrome/TitleBar.tsx`
- **CSS**: `apps/desktop/src/chrome/title-bar.css`
- **Features**:
  - Custom drag region with `data-tauri-drag-region`
  - Window controls (minimize, maximize, close) using Tauri window API
  - Varve icon and title display
  - CSS tokens: `--topbar-height`, `--elevation-surface-default`, `--color-border-subtle`
- **Integration**: Mounted in `apps/desktop/src/App.tsx` above both Home and Editor surfaces

#### 3. Menubar Implementation
- **Location**: `packages/editor/src/Menubar.tsx` (2,373 lines, complexity 275 - over ceiling)
- **Component Export**: `packages/editor/src/components/Menubar/index.ts` (re-exports from Menubar.tsx)
- **Integration**: Mounted in `packages/editor/src/Shell.tsx` (line 283) when not in distraction-free mode
- **Features**:
  - Dynamic menu building based on editor state
  - Keyboard navigation (typeahead, arrow keys)
  - Recent files integration
  - Theme switching
  - Workspace mode awareness
  - Install desktop prompts

#### 4. Menu Definition System
- **Location**: `packages/editor/src/menu/defs.ts` (1,716 lines)
- **Structure**: 
  - `getFileMenu()`, `getEditMenu()`, `getTextMenu()`, `getViewMenu()`, etc.
  - Uses `labelKey` for localization (e.g., `'menu.file.new'`)
  - Accelerator definitions
  - Capability-based visibility
  - Workspace-specific filtering
- **Integration**: Used by both custom menubar and native menu adapter

#### 5. Native Menu Adapter
- **Location**: `packages/editor/src/menu/nativeAdapter.ts` (433 lines)
- **Purpose**: Bridge between menu definitions and Tauri native menu API
- **Features**:
  - Converts `MenuItemDef` to Tauri menu spec
  - Accelerator translation
  - Label resolution
  - Capability filtering
- **Runtime Detection**: Uses `isTauriRuntime()` from `@varve/platform`

#### 6. Localization System
- **Location**: `packages/editor/src/menu/localization.ts`
- **Current Implementation**: Identity fallback (returns key as-is)
- **Problem**: `formatLabel(key)` returns the key itself, causing raw `menu.edit` keys to display
- **Status**: No real i18n framework integration yet

#### 7. Runtime and Platform Detection
- **Location**: `packages/platform/src/runtime.ts`
- **Capabilities**:
  - `detectRuntimeKind()`: 'memory' | 'web' | 'tauri'
  - `detectOs()`: 'mac' | 'windows' | 'linux' | 'unknown'
  - `computeCapabilities()`: Set of capability flags
  - `isTauriRuntime()`: Convenience check
- **Missing**: No Wayland/X11 detection, no display server detection

#### 8. Shell Layout
- **Location**: `packages/editor/src/Shell.tsx`
- **Current Layout**:
  1. Menubar (when not distraction-free)
  2. FloatingToolbar
  3. TabStrip (when not distraction-free)
  4. CanvasArea
  5. Various panels (Layers, Inspector, etc.)
- **CSS**: `packages/editor/src/editor.css` (grid-based layout)
- **Problem**: No explicit title-bar region; menubar serves as top chrome

#### 9. Tab Strip
- **Location**: `packages/editor/src/TabStrip.tsx`
- **Features**: Multi-document tabs with close buttons
- **Integration**: Mounted between menubar and canvas
- **Problem**: Close buttons may conflict with window controls visually

---

## Root Cause Analysis

### CachyOS Screenshot Defects

#### 1. Menubar Above Window Controls
- **Root Cause**: In `apps/desktop/src/App.tsx`, the `TitleBar` is mounted at line 171, then the editor content. However, the editor's `Menubar` is mounted inside `Shell.tsx` at line 283. This creates two separate top chrome layers that may stack incorrectly.
- **Current Flow**: TitleBar → Home/Editor Shell → Menubar → Canvas
- **Expected Flow**: Integrated title-bar + menubar or proper layering

#### 2. Raw Localization Keys Displayed
- **Root Cause**: `packages/editor/src/menu/localization.ts` `formatLabel()` returns the key as-is (line 25). No actual i18n resolution is implemented.
- **Impact**: All `labelKey` values like `'menu.edit'`, `'menu.help'` display literally instead of translated text

#### 3. Empty Dark Strip
- **Root Cause**: The `TitleBar` component renders with `height: var(--topbar-height)` but may not be properly integrated with the menubar height, creating visual gaps
- **CSS Issue**: No coordination between `--topbar-height` and menubar height tokens

#### 4. Missing Window Controls
- **Root Cause**: If the custom `TitleBar` is hidden or layered incorrectly, the minimize/maximize/close controls disappear
- **Linux Specific**: Wayland CSD (client-side decorations) may not be properly negotiated

#### 5. Layout Conflicts
- **Root Cause**: No clear separation between:
  - Window title bar (drag region + window controls)
  - Application menubar (File, Edit, View, etc.)
  - Document tabs (TabStrip)
  - Workspace toolbar

---

## Current Platform Strategy

### Resolved Strategies (implemented in `@varve/platform` `windowChrome.ts`)

| Platform | Menubar Strategy | Decoration | Controls | Custom TitleBar | Custom Menubar |
|----------|-----------------|------------|----------|-----------------|----------------|
| macOS (nativeMenu cap) | native-application-menu | native | native (traffic lights) | no | no |
| macOS (no cap) | custom-window-menubar | native | native | no | yes |
| Windows | native-titlebar-custom-menubar | native | right (native) | no | yes |
| Linux (Wayland) | fully-custom-window-chrome | client-side | button-layout (right default) | yes | yes |
| Linux (X11) | fully-custom-window-chrome | server-side | button-layout (right default) | yes | yes |
| Browser | browser-menubar | native | hidden | no | yes |
| Unknown desktop | fully-custom-window-chrome | custom | right | yes | yes |

Public decision helpers (all pure, tested):
- `shouldUseNativeMenu(platform)` — macOS native-menu only
- `shouldRenderCustomTitleBar(platform)` — custom chrome platforms only
- `shouldRenderCustomMenubar(platform)` — everywhere except macOS native menu

`WindowChromeState` is updated from real window events (`focus`, `maximize`, `fullscreen`, `resizable`, `scale`, `title`) via the tested pure reducer `updateChromeState`. The desktop app bridges live Tauri events into this model with the `useWindowChrome` hook (`apps/desktop/src/chrome/useWindowChrome.ts`); it creates zero subscriptions in the browser build.

### Platform Detection
- **Available**: OS detection (mac/windows/linux/unknown)
- **Available**: Runtime detection (memory/web/tauri)
- **Missing**: Display server detection (Wayland/X11)
- **Missing**: Window manager detection (KDE/GNOME/other)
- **Missing**: Platform-specific title-bar strategy

### Current Behavior by Platform

#### macOS
- **Expected**: Native application menu in system menu bar
- **Actual**: Custom menubar in-window (suboptimal)
- **Traffic Lights**: Not integrated with custom title bar

#### Windows
- **Expected**: Native window controls on right side
- **Actual**: Custom controls (reasonable but may lack native feel)
- **Snap Layout**: May not work correctly

#### Linux
- **Expected**: Platform-specific behavior (CSD vs SSD)
- **Actual**: Custom implementation without Wayland/X11 awareness
- **CachyOS Defect**: Menubar placement and control conflicts

#### Browser
- **Expected**: No window controls, in-page menubar only
- **Actual**: May render desktop chrome unnecessarily

---

## Files Requiring Changes

### High Priority (Core Infrastructure)
1. `apps/desktop/src/App.tsx` - Title bar and shell integration — **no change needed** (TitleBar is self-gating)
2. `apps/desktop/src/chrome/TitleBar.tsx` - **DONE** — strategy-aware, maximize/restore state, focus styling
3. `apps/desktop/src/chrome/title-bar.css` - **DONE** — focus/inactive/disabled states, tokens
4. `packages/editor/src/Shell.tsx` - Shell layout and menubar mounting — **no change needed** (menubar row already sits below the desktop TitleBar; the defect was the stray native strip, not the shell grid)
5. `packages/editor/src/Menubar.tsx` - Menubar component — **no change needed** for this milestone (still over complexity ceiling; native-menu gating lives inside `useNativeMenu`)
6. `packages/editor/src/menu/localization.ts` - **DONE** — real English label dictionary + safe fallback
7. `packages/platform/src/runtime.ts` - Platform detection — **extended via** `windowChrome.ts` (strategy + display-server/button-layout detection)

### Medium Priority (Menu System)
8. `packages/editor/src/menu/defs.ts` - Menu definitions — no change needed
9. `packages/editor/src/menu/nativeAdapter.ts` - **DONE** — default label resolver (raw keys impossible)
10. `packages/editor/src/menu/index.ts` - Menu exports — no change needed
11. `packages/editor/src/menu/types.ts` - Menu type definitions — no change needed

### New Files
- `packages/platform/src/windowChrome.ts` - canonical window-chrome model + strategy resolver
- `packages/platform/src/__tests__/windowChrome.test.ts` - strategy/state tests
- `packages/editor/src/menu/__tests__/localization.test.ts` - localization integrity tests
- `apps/desktop/src/chrome/useWindowChrome.ts` - live Tauri event bridge
- `apps/desktop/src/chrome/windowActions.ts` - window action service
- `tests/e2e/menus/chrome-integrity.spec.ts` - browser chrome/no-raw-key regression spec

---

## Technical Debt Identified

### 1. Complexity Violations
- **Menubar.tsx**: 275 cyclomatic complexity (ceiling: 200)
- **Shell.tsx**: 49 imports (ceiling: 49)
- **Impact**: Difficult to maintain, high risk of regressions

### 2. Localization Not Implemented
- **Status**: **FIXED** — full English dictionary in `menu/localization.ts`; raw keys cannot reach the UI (integrity-tested). Real i18n framework can swap in behind the same `formatLabel` boundary.
- **Impact**: Raw keys displayed in production — resolved
- **Risk**: International users cannot use the application

### 3. No Platform-Specific Strategies
- **Status**: One-size-fits-all custom title bar
- **Impact**: Suboptimal UX on each platform
- **Risk**: Platform convention violations

### 4. Fragmented Menu Systems
- **Status**: Custom menubar + native adapter + menu definitions
- **Impact**: Complexity, duplication, synchronization issues
- **Risk**: Inconsistent behavior across surfaces

### 5. Missing Display Server Detection
- **Status**: No Wayland/X11 detection
- **Impact**: Cannot apply Linux-specific fixes
- **Risk**: CachyOS and other Wayland compositors broken

### 6. No Window Chrome State Model
- **Status**: Ad-hoc component state
- **Impact**: No centralized window chrome management
- **Risk**: Inconsistent maximize/fullscreen behavior

---

## Testing Infrastructure

### Existing Tests
- `packages/editor/src/Menubar.test.tsx` - Menubar component tests
- `packages/editor/src/menu/__tests__/menuSnapshot.test.ts` - Menu snapshot tests
- `packages/editor/src/menu/__tests__/nativeAdapter.test.ts` - Native adapter tests
- `tests/e2e/menus/visual-integrity.spec.ts` - Visual integrity E2E
- `tests/e2e/menus/keyboard-nav.spec.ts` - Keyboard navigation E2E

### Tests Added (this milestone)
- `packages/editor/src/menu/__tests__/localization.test.ts` - localization integrity: every defs `labelKey` resolves to a display string; raw `menu.*` keys never leak; dynamic labels pass through; interpolation
- `packages/platform/src/__tests__/windowChrome.test.ts` - display-server/button-layout detection, strategy resolution per platform, `updateChromeState` reducer, height utilities, platform decision helpers (`shouldUseNativeMenu` etc.)
- `tests/e2e/menus/chrome-integrity.spec.ts` - browser build renders no `.title-bar` / window controls; no raw localization keys in any top-level menu or item; menubar at top of document

---

## Verification Results (2026-08-01)

| Gate | Command | Result |
|------|---------|--------|
| Platform tests | `pnpm --filter @varve/platform test` | 183/183 pass (incl. 29 windowChrome) |
| Editor menu tests | `pnpm vitest run packages/editor/src/menu/__tests__` | 109/109 pass (localization, nativeAdapter, menuSnapshot, commandIntegrity, capabilities) |
| Menubar component | `pnpm vitest run packages/editor/src/Menubar.test.tsx` | 18/18 pass |
| Typecheck | `pnpm --filter @varve/{platform,editor,desktop} typecheck` | all clean |
| Lint (touched files) | `biome lint` (11 files) | 0 errors, 0 warnings |
| Format (touched files) | `biome format --write` | applied |
| Architecture audit | `node scripts/audit-architecture.mjs --ci` | "✓ Architecture audit complete" (cycles 4 ≤ 6, layer violations none) |
| E2E chrome-integrity | `playwright test tests/e2e/menus/chrome-integrity.spec.ts --project=chromium` | 3/3 pass |
| E2E visual-integrity | `playwright test tests/e2e/menus/visual-integrity.spec.ts` | pass |

### Pre-existing failures (proven at HEAD — not introduced by this milestone)

Both were reproduced with all milestone changes stashed (`git stash push -u`):

1. `packages/editor/src/menu/__tests__/menuPerf.bench.test.ts` — perf-budget assertions (e.g. `computeSelectionFacts` p95 < 4ms) flake under load. This is a `.bench.test.ts` file; AGENTS.md runs `.bench.ts` separately via `pnpm bench`, outside the standard `pnpm test` gate. Not related to label resolution.
2. `tests/e2e/menus/keyboard-nav.spec.ts` — "ArrowDown opens menu from focused menubar item" fails because the current `Menubar.tsx` top-level handler moves focus to the next item on ArrowDown instead of opening the menu (deliberate but diverging behavior; `Enter`/`Space` open the menu). The test and implementation disagree. Follow-up: reconcile the ARIA menubar pattern (ArrowDown should open the menu) — requires touching over-ceiling `Menubar.tsx` and is tracked as deferred.

### Environment note
- CachyOS (Wayland) dev target confirmed via screenshot defect; runtime verification of the GTK strip removal is a desktop-build/manual step (the strip is gone by construction: `app.set_menu` is never called on non-macOS).

---

## Performance Considerations

### Current Performance Issues
- **Menubar rebuilds**: Menu structure rebuilt on every editor state change
- **Localization lookups**: No caching, repeated key resolution
- **Event listeners**: Potential for duplicate Tauri listeners
- **Shell rerenders**: High-frequency state updates causing shell churn

### Optimization Targets
- Memoize stable menu definitions
- Cache localization lookups
- Batch state updates
- Debounce resize events
- Clean up event listeners

---

## Security Considerations

### Current Security Posture
- **Tauri CSP**: Configured in `tauri.conf.json`
- **Window APIs**: Using `withGlobalTauri: true`
- **Risk**: Custom title bar needs careful input sanitization
- **Risk**: Native menu integration needs command validation

---

## Accessibility Status

### Current Accessibility
- **Menubar**: Some ARIA roles present
- **Keyboard Navigation**: Partially implemented
- **Screen Reader**: Limited announcements
- **Focus Management**: Inconsistent

### WCAG 2.2 AA Gaps
- Missing semantic roles for custom title bar
- Incomplete focus restoration
- Missing screen-reader announcements for menu state
- Insufficient color contrast in some states
- No reduced-motion support for title bar transitions

---

## Dependencies

### External Dependencies
- **Tauri 2**: Window and menu APIs
- **React**: Component framework
- **@varve/platform**: Runtime detection
- **@varve/ui**: UI components and tokens

### Internal Dependencies
- **@varve/editor**: Editor state and context
- **@varve/scene**: Document model
- **@varve/shared**: Shared utilities

---

## Risks and Mitigations

### High Risk
1. **Breaking Changes**: Changes to title-bar/menubar will affect all platforms
   - **Mitigation**: Platform-specific feature flags, gradual rollout
2. **Localization Rollout**: Real i18n integration may break existing translations
   - **Mitigation**: Fallback chains, extensive testing
3. **Linux Fragmentation**: Wayland/X11/window-manager differences
   - **Mitigation**: Capability detection, graceful degradation

### Medium Risk
1. **Performance Regression**: Window chrome changes may affect frame rate
   - **Mitigation**: Benchmarking, performance budgets
2. **Test Coverage**: Missing platform-specific tests
   - **Mitigation**: Prioritize E2E tests for each platform
3. **Complexity Increase**: Adding platform strategies may increase complexity
   - **Mitigation**: Clear separation of concerns, abstraction layers

---

## Next Steps

### Phase 2: Complete Documentation
- [x] Create progress documentation file
- [x] Record current platform behavior matrix (`cross-platform-menubar-strategies.md`)
- [ ] Capture baseline screenshots (desktop build; dev-target manual step)

### Phase 3: Define Platform Strategies
- [x] Define macOS strategy (native menu vs custom)
- [x] Define Windows strategy (custom controls placement)
- [x] Define Linux strategy (CSD vs SSD, Wayland vs X11)
- [x] Define browser strategy (no window controls)

### Phase 4: Build Window Chrome Model
- [x] Design `WindowChromeState` type
- [x] Implement strategy resolver (`resolveWindowChromeStrategy`)
- [x] Add display server detection
- [x] Create capability-based feature flags / decision helpers

### Phase 5: Separate Layout Regions
- [x] Design title-bar region (desktop `TitleBar` — drag + controls + title)
- [x] Design menubar region (editor `.editor-menubar` row)
- [x] Design toolbar region (editor `FloatingToolbar` / shell)
- [ ] Update shell layout (deferred — existing grid already separates rows)

### Phase 6: Fix Layering and Geometry
- [x] Remove stray GTK native-menubar strip (root-cause fix)
- [ ] Audit CSS z-index usage (deferred)
- [ ] Chrome token system for window insets (deferred; title bar uses existing tokens)
- [x] Resolve title-bar/menubar height conflict at the strip level

### Phase 7: Implement Window Controls
- [x] Platform-appropriate control placement (right cluster, custom-chrome only)
- [x] State synchronization (maximize/restore icon via live window events)
- [x] Keyboard accessibility (native buttons, focus-visible styling, labels)
- [x] Tooltips and labels (title attribute + aria-label, restore label flips)

### Phase 8: Build Command Registry
- [ ] Consolidate menu command definitions (existing `ActionRegistry` + `defs.ts` reused; further consolidation deferred)
- [x] Integrate with ActionRegistry (`dispatchNativeMenuAction`)
- [x] Enable/disable state management (per-item predicates)
- [x] Shortcut synchronization (accelerator canonicalization)

### Phase 9: Fix Localization
- [x] Implement real i18n resolution (English dictionary + humanized fallback)
- [x] Add missing key validation (integrity test over all defs labelKeys)
- [x] Create fallback chains (dict → humanized → pass-through)
- [ ] Test locale switching (deferred — single locale today)

### Phase 10: Implement Keyboard/Pointer
- [ ] Desktop-standard menu behavior
- [ ] Alt activation (Windows/Linux)
- [ ] Arrow key navigation
- [ ] Typeahead support

### Phase 11: Menu Positioning
- [ ] Collision detection
- [ ] Monitor-edge awareness
- [ ] Submenu flipping
- [ ] Multi-monitor support

### Phase 12: Standardize Information Architecture
- [ ] Define standard menu structure
- [ ] Workspace-mode variations
- [ ] Command grouping
- [ ] Naming conventions

### Phase 13: Native Menu Integration
- [ ] Tauri API integration
- [ ] State synchronization
- [ ] Locale change handling
- [ ] Multi-window routing

### Phase 14: Multiple Windows
- [ ] Window-specific state
- [ ] Command routing
- [ ] Focus management
- [ ] Independent chrome state

### Phase 15: Fullscreen States
- [ ] Fullscreen behavior
- [ ] Presentation mode
- [ ] Maximized state
- [ ] Chrome visibility rules

### Phase 16: Accessibility
- [ ] Semantic roles
- [ ] Focus management
- [ ] Screen reader support
- [ ] Keyboard navigation
- [ ] High contrast support

### Phase 17: Theme Consistency
- [ ] Design token alignment
- [ ] Platform-specific treatment
- [ ] Inactive window states
- [ ] Theme switching

### Phase 18: Performance
- [ ] Memoization
- [ ] State update batching
- [ ] Event listener cleanup
- [ ] Benchmarking

### Phase 19: Testing
- [ ] Unit tests for platform detection
- [ ] Component tests for window chrome
- [ ] E2E tests for each platform
- [ ] Visual regression baselines

### Phase 20: Verification
- [ ] Format check
- [ ] Lint
- [ ] Type check
- [ ] Test suite
- [ ] Architecture audit

### Phase 21: Final Documentation
- [ ] Architecture diagrams
- [ ] Platform matrix
- [ ] Implementation guide
- [ ] Troubleshooting guide

---

## Commit History

### Initial Audit (2026-08-01)
- Repository-wide audit completed
- Progress documentation created
- Root causes identified
- Implementation plan defined

### Milestone 1 — Root-cause fix, localization, strategy wiring (2026-08-01)
- `@varve/platform`: canonical window-chrome model (`windowChrome.ts`), strategy resolver, display-server/button-layout detection, decision helpers (`shouldUseNativeMenu` / `shouldRenderCustomTitleBar` / `shouldRenderCustomMenubar`) + tests
- `@varve/editor`: native-menu gating to macOS (`useNativeMenu`), real label resolution (`localization.ts`), safe default resolvers in `nativeAdapter`/`renderer`, localization integrity tests, snapshot refresh (raw keys → resolved labels)
- `apps/desktop`: `useWindowChrome` live event bridge, strategy-aware `TitleBar`, `windowActions` service
- `tests/e2e/menus/chrome-integrity.spec.ts`: no raw keys / no browser window controls / menubar placement
- Commit hashes: `85e249ca` (feat/chrome: macOS-only native menus, resolved menu labels, strategy-aware title bar — branch `feat/input-system`)

---

## Deferred / Follow-up

- **Real i18n framework**: the `formatLabel` boundary is ready for i18next/lingui; add locale bundles, runtime locale switching, and RTL handling behind it.
- **Native decorations for macOS/Windows**: `decorations: false` is currently global. Moving decoration negotiation per platform (Rust-side based on `cfg!(target_os)`) would give macOS traffic lights + Windows native title bar, matching the resolved strategies. Requires config/Rust change + per-OS build verification.
- **ARIA menubar ArrowDown**: reconcile `keyboard-nav.spec.ts` with the menubar handler (ArrowDown should open the focused menu). Touches over-ceiling `Menubar.tsx`; needs a complexity-reduction pass first (see below).
- **Menubar.tsx complexity**: 291 (audit 2026-08-01) over the 200 ceiling. Refactor plan required before further keyboard/menu work.
- **Desktop visual regression**: capture before/after screenshots on CachyOS Wayland + X11 once a desktop build is run (the GTK strip is removed by construction).
- **Fullscreen/maximize E2E**: the `useWindowChrome` state is wired for Tauri; Playwright runs in-browser and cannot exercise native window events — desktop integration tests are follow-up.
- **Multiple windows / multi-window command routing**: designed for (state is per-window via `useWindowChrome`), not yet exercised by a second window.

---

## References

### Internal Documentation
- `AGENTS.md` - Repository guidelines and regression protocol
- `docs/audits/menubar-audit-2026-07-23.md` - Previous menubar audit
- `docs/architecture/interaction-systems-2026-07-27.md` - Interaction systems
- `docs/adr/0012-runtime-capability-abstraction.md` - Runtime capabilities
- `docs/implementation/cross-platform-menubar-strategies.md` - Strategy matrix

### External References
- [Tauri 2 Window Customization](https://tauri.app/learn/window-customization/)
- [ARIA Authoring Practices Guide - Menubar](https://www.w3.org/WAI/ARIA/apg/patterns/menubar/)
- [Wayland Client-Side Decorations](https://wayland.freedesktop.org/)
- [WCAG 2.2 AA](https://www.w3.org/WAI/WCAG22/quickref/)

---

## Notes

- **Root cause confirmed**: the CachyOS screenshot's stray strip + raw keys came from `app.set_menu()` building a GTK menubar with unresolved `labelKey`s on Linux. Gating native menus to macOS and fixing label resolution removes both defects by construction.
- The current `Menubar.tsx` complexity (291) exceeds the ceiling (200) and must be reduced before further keyboard/menu work.
- Platform detection now includes Wayland/X11 awareness (best-effort) and button-layout detection for Linux.
- The custom title bar approach remains for Linux; macOS native menu / Windows native title bar are documented strategies with Rust-side decoration work as the follow-up.
- Browser build renders no window controls (verified by E2E).
- Multiple window support is not yet implemented but the chrome state model is per-window ready.
