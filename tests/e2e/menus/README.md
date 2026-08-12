# Menu E2E Coverage

## Covered (Playwright, all browsers)

| Area | File | Tests |
|---|---|---|
| Type-ahead (single char, buffer, cycling, timeout, diacritics) | `typeahead.spec.ts` | 8 tests |
| Type-ahead (no match, arrow resets, diacritic-insensitive) | `keyboard-nav.spec.ts` | 7 tests |
| Top-level menubar arrow nav (Tab, ArrowRight/Left/Up/Down) | `keyboard-nav.spec.ts` | 2 tests |
| Enter/Space opens menu | `keyboard-nav.spec.ts` | 1 test |
| Home/End in menubar and dropdown | `keyboard-nav.spec.ts` | 2 tests |
| Escape closes, focus returns to trigger | `keyboard-nav.spec.ts` | 2 tests |
| ArrowRight/Left switches between menus | `keyboard-nav.spec.ts` | 2 tests |
| ArrowDown/ArrowUp cycles menu items | `keyboard-nav.spec.ts` | 1 test |
| Submenu open/close (ArrowRight/Left, Enter) | `keyboard-nav.spec.ts` | 2 tests |
| Submenu ArrowDown/Up cycling | `keyboard-nav.spec.ts` | 1 test |
| Disabled item not activatable | `keyboard-nav.spec.ts` | 1 test |
| Accelerators fire (undo/redo) | `keyboard-nav.spec.ts` | 1 test |
| Accelerators blocked in text fields | `keyboard-nav.spec.ts` | 1 test |
| Focus never lands on body | `keyboard-nav.spec.ts` | 1 test |
| ARIA roles (menubar, menuitem, aria-expanded) | `keyboard-nav.spec.ts` | 2 tests |
| axe-core scan of open menu | `keyboard-nav.spec.ts` | 1 test |
| Window-chrome integrity (no native title bar in browser build, no raw `menu.*` keys, menubar placement) | `chrome-integrity.spec.ts` | 3 tests |
| Menubar visual integrity (no clipping, theme contrast via axe) | `visual-integrity.spec.ts` | 5 tests |

## NOT Covered (and why)

| Gap | Reason | Alternative |
|---|---|---|
| **Tauri native menus** | Playwright cannot interact with native OS menus. | Use `tauri-driver` for a smoke test (see `playwright.config.ts` `tauri` project). |
| **F10 / Alt key to open menubar** | This is browser/OS behaviour, not app-controlled. | Manual checklist (see below). |
| **OS-level shortcut conflicts** | Playwright cannot observe native OS shortcut handling. | Manual checklist. |
| **Screen reader announcements** | Playwright cannot observe AT APIs (IAccessible2, UIA, AX). | Manual checklist. |
| **Cmd vs Ctrl platform mapping** | The test runs on the CI platform only. | Parameterized by `process.platform` in `menu-helpers.ts`; run CI on both macOS and Linux. |
| **Workspace switch mid-interaction** | Requires specific state (open menu + workspace switch trigger). | Add once the workspace switch modal is identifiable. |
| **Findings keyboard navigation** | Audit panel must be visible + findings populated; currently no E2E fixture for audit findings. | Add when findings can be seeded from test code. |

## Manual checklist for native/gap coverage

Run these manually before each release on macOS and Windows:

- [ ] **F10 / Alt** opens the app menubar (browser/webview) — verify focus lands on first menu item
- [ ] **Cmd+Q / Alt+F4** closes the app (native window manager)
- [ ] **Cmd+H / Cmd+M** (macOS) hide/minimize work correctly
- [ ] **No OS shortcut conflicts** — e.g. Cmd+Space, Cmd+Tab do not trigger app actions
- [ ] **Screen reader**: VoiceOver/NVDA announces menu open, menu items, and close
- [ ] **Cmd+key and Ctrl+key** are correct per platform (Cmd on macOS, Ctrl on Windows/Linux)
- [ ] **Tauri native menus**: all top-level items render, submenus open, accelerators fire

## Running the tests

```bash
# All menu tests
npx playwright test tests/e2e/menus --project=chromium --reporter=list

# Type-ahead only
npx playwright test tests/e2e/menus/typeahead.spec.ts --project=chromium --reporter=list

# Keyboard nav only
npx playwright test tests/e2e/menus/keyboard-nav.spec.ts --project=chromium --reporter=list

# All browsers (CI)
npx playwright test tests/e2e/menus --reporter=list
```

## Test architecture

- `../helpers/menu-helpers.ts` — shared utilities (`mod()`, `openMenu()`, `assertFocusNotOnBody()`, etc.)
- `shared.ts` — `navigateToEditor()` — canonical navigation to editor
- Type-ahead timeout is controllable via `window.__VARVE_TYPEAHEAD_MS` (set per-test via `setTypeAheadTimeout`)
