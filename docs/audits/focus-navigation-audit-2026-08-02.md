# Focus Navigation & Tab Ordering Audit — 2026-08-02

Status: **Phase 1 audit complete.** Baseline for milestone-driven remediation.
Scope: tab ordering, roving focus, focus containment, focus restoration, and
focus visibility across the editor, home surface, and desktop chrome.

Primary environments: Linux/CachyOS + WebKitGTK (Tauri), Chromium, Firefox;
Windows WebView2 and macOS WKWebView must remain supported.

## Summary of findings

The application already uses the correct core patterns in many places:

- Native `<dialog showModal()>` for modal dialogs (built-in trap + inert).
- Roving `tabIndex` in `ui/Tabs`, `ui/Toolbar`, `ui/Menu`, `ui/SegmentedControl`,
  `ui/ViewModeSwitcher`, editor `TabStrip`, `PageNav`, `LayersTree`, inspector tabs.
- `inert` used correctly for hidden/collapsed panels (3/3 verified call sites).
- Title bar window controls are correct (order, labels, focus ring, no drag-region
  focus swallowing).
- Canvas focus ring (`:focus-visible`-gated, ::after overlay) is a good pattern.
- Forced-colors token remapping exists in `tokens.css`.
- Global shortcut handler already ignores text fields (`shouldIgnoreShortcutTarget`).

Root-cause failures concentrate in **five shared primitives** and **two editor
composites**, listed below. Fixing these primitives repairs most consumers at once.

## Root causes

| # | Root cause | Location | Consumers affected |
|---|-----------|----------|-------------------|
| RC-1 | Menu focus-restore branch is **dead code**: `Menu`/`ContextMenu` return `null` when closed, so the close-transition effect never runs; every close path drops focus to `<body>` | `ui/Menu.tsx:200-234` | All menus, submenus, context menus (canvas, layers, page nav, inspector, timeline) |
| RC-2 | Menu `Tab` closes the menu without moving focus anywhere; all items are tab stops while open (no trap, menu stays open as focus walks out) | `ui/Menu.tsx:352-356`, items 389/417/469/518 | All menus |
| RC-3 | `Toolbar` autofocus effect runs on mount — steals focus from document flow into the first tool button on every editor mount | `ui/Toolbar.tsx:32-38` | FloatingToolbar (main tool switcher) |
| RC-4 | `Combobox` options are `tabIndex={0}` inside an `aria-activedescendant` pattern — Tab walks the option list and arrow keys die on options | `ui/Combobox.tsx:205` | Every combobox (font selectors, units, etc.) |
| RC-5 | `ShortcutPalette` (command palette): no `aria-modal`, no trap, all rows `tabIndex={0}` (up to 100+ tab stops), **no arrow-key navigation** (Enter always picks the first filtered item), no focus restore on close | `editor/shortcuts/ShortcutPalette.tsx:230,300-318,402-404` | Command palette |
| RC-6 | Editor menubar: submenu keyboard focus is broken (focus never moves into submenu; `activeSubmenuIndex` is invisible); disabled items are keyboard-activatable; container `onKeyDown` hijacks non-menuitem controls (Home, rename input, radios, undo/redo, zoom input); focus lost on action close; all dropdown items tabbable | `editor/Menubar.tsx:1797-2003,2026-2052,2087-2183` | Application menubar |
| RC-7 | `PageNav` has **no arrow-key handling** — roving `tabIndex={isActive ? 0 : -1}` makes every inactive page unreachable; keyboard users cannot switch pages | `editor/components/PageNav/PageNav.tsx:81-85` | Page navigation |
| RC-8 | `TabStrip` focus lost after closing a tab (falls to `<body>`); roving tabindex bound to selection, not focus; no `scrollIntoView` on arrow focus | `editor/TabStrip.tsx:46-48,110` + `context.tsx:8033-8085` | Document tabs |
| RC-9 | Layers tree: focus lost to `<body>` after delete/filter/collapse/rename of the focused row; context menu has no keyboard opener (Shift+F10 unwired) and never restores focus; row action buttons (visibility/lock/checkbox) are pointer-only | `editor/components/LayersPanel/{LayersTree.tsx:470-479,928-937}, LayersRow.tsx:311-599, index.tsx:445-495` | Layers panel |
| RC-10 | Canvas Tab capture cycles selection whenever the canvas has focus and the document is non-empty — hard keyboard trap with no documented exit | `editor/canvas/inputPipeline.ts:623-640` | Canvas workspace |
| RC-11 | Focus-visible gaps: zero indicator on status-bar zoom input, project/layer rename inputs; background-only indicators on menubar/menu/palette items; no custom ring on floating-toolbar buttons | `editor.css:757`, `home.css:682`, `layers.css:433`, `FloatingToolbar.css` | Focus visibility |
| RC-12 | Inspector Export sub-tabs lack roving/arrow handling/`aria-controls` | `Inspector/PropertiesPanel.tsx:257-276` | Inspector |
| RC-13 | `FocusTrap` unmount-restore is dead (checks `!activeRef.current`, true while active); no inert handling; `Popover` fallback path lacks Escape/outside-click | `ui/FocusTrap.tsx:93-95`, `ui/Popover.tsx:86-97` | Popovers, palette |
| RC-14 | Closed ContextualHelp panel is `transform: translateX(100%)` — offscreen but ~40 category buttons remain in the global Tab order (verified: `vis=true` on all of them) | `onboard/ContextualHelp/ContextualHelpPanel.css:13` | Tab order after status bar |
| RC-15 | Canvas Tab trap is **always on**: a fresh document always contains an artboard node, so `nodes.length === 0` (the pass-through branch) never occurs in practice — verified via keydown instrumentation (`defaultPrevented=true`, no `focusin` follows). The reverse trap also holds: once focus lands on the canvas, Shift+Tab cycles selection instead of moving backward | `inputPipeline.ts:623-640` | Canvas focus |

## Audit table (surface × focus model)

### Healthy — no action required

| Surface | Model | Notes |
|---|---|---|
| Title bar window controls | Native buttons, DOM order min→max→close | `apps/desktop/src/chrome/TitleBar.tsx:40-65`; drag region pointer-none |
| Native `<dialog>` modals | Native trap + inert background | `ui/Dialog.tsx:27-35` (`showModal`) |
| `ui/Tabs` | Full APG tabs (roving, arrows, Home/End, tabpanel wiring) | `ui/Tabs.tsx` |
| `ui/SegmentedControl`, `ui/ViewModeSwitcher` | Radio-group roving | `ui/SegmentedControl.tsx`, `ui/ViewModeSwitcher.tsx` |
| Inspector `DisclosureSection` | APG disclosure + fieldset/legend | `Inspector/DisclosureSection.tsx:169-188` |
| `PanelResizeHandle` | APG separator, arrows/Home/End | `components/PanelResizeHandle.tsx:113-151` |
| Minimap | `role="img"` canvas + arrow pan + fit keys | `Minimap/MinimapPanel.tsx:180-229` |
| Layers tree core | `role="tree"` + roving + arrow/Home/End/typeahead/Ctrl+[/] | `LayersTree.tsx:714-903` (lifecycle gaps: RC-9) |
| Global shortcuts vs typing | `SHORTCUT_IGNORE_SELECTOR` guard | `ShortcutManager.ts:716-733` |
| forced-colors | Token remap + 2px outline rules | `tokens.css:536-574` |

### Defects by severity

| Severity | Surface | Defect | Location |
|---|---|---|---|
| High | Menu/ContextMenu | Focus lost to body on every close (RC-1); Tab closes without destination (RC-2) | `ui/Menu.tsx` |
| High | Command palette | No trap, 100+ tab stops, no arrow nav, no restore (RC-5) | `ShortcutPalette.tsx` |
| High | Editor menubar | Submenu focus broken, disabled activatable, control hijack, no restore on action (RC-6) | `Menubar.tsx` |
| High | PageNav | Pages keyboard-unreachable (RC-7) | `PageNav.tsx` |
| High | Canvas | Tab trap with no exit (RC-10) | `inputPipeline.ts:623-640` |
| High | Layers | Focus lost on delete/filter/collapse/rename; context menu keyboard-inaccessible + no restore (RC-9) | `LayersTree.tsx`, `LayersRow.tsx` |
| Medium | TabStrip | Focus lost on close; roving bound to selection; no scroll (RC-8) | `TabStrip.tsx` |
| Medium | Toolbar | Mount-time focus theft (RC-3); disabled items not skipped; Fragment children unsupported | `ui/Toolbar.tsx` |
| Medium | Combobox | Options are tab stops (RC-4); highlight unclamped on filter change | `ui/Combobox.tsx` |
| Medium | Popover | Fallback path no Escape/outside-click; panel unlabelled; restore falls to body for non-button triggers | `ui/Popover.tsx` |
| Medium | FocusTrap | Unmount restore dead (RC-13) | `ui/FocusTrap.tsx` |
| Medium | Inspector Export tabs | No roving/arrows/aria-controls (RC-12) | `PropertiesPanel.tsx:257-276` |
| Medium | Focus visibility | Zero/weak/background-only indicators (RC-11) | css files |
| Medium | Layers row actions | Pointer-only visibility/lock/checkbox; context menu is the keyboard path, itself broken | `LayersRow.tsx` |
| Low | Layers virtual rows | Missing `aria-setsize`/`aria-posinset`; focus race when target row unmounted | `LayersRow.tsx:285-292`, `LayersTree.tsx:473` |
| Low | Menubar ARIA | Non-menuitem controls inside `role="menubar"`; no `aria-controls` on menus | `Menubar.tsx:2016-2301` |
| Low | TabStrip/PageNav ARIA | "New"/"Add" buttons inside `tablist`; no `tabpanel` wiring | `TabStrip.tsx:134`, `PageNav.tsx:191` |
| Low | Inspector unnamed region | `role="region"` without accessible name | `DisclosureSection.tsx:168` |

## Focus model decisions (Phase 2 — documented contract)

Global Tab sequence (matches visual layout; region skips when hidden/collapsed):

```
Menubar → Document tabs → Main toolbar → Layers panel → Canvas →
Inspector → Timeline/status → Menubar (wraps via Shift+Tab)
```

1. **Menubar**: one tab stop (first menuitem), roving across top-level menus.
   Dropdowns/submenus: roving tabindex (one stop), Enter/Space activate,
   Escape closes one level at a time, Tab closes and moves focus to the next
   control after the trigger. Focus restored to trigger after any close.
   Non-menuitem controls inside the menubar keep native behavior (no hijack).
2. **Document tabs / page tabs**: one tab stop; arrows + Home/End; manual
   activation (TabStrip) and automatic (PageNav per platform convention);
   closing a tab moves focus to the replacement tab; new tab receives focus.
3. **Main toolbar**: one tab stop; arrows with wrap; selected tool via
   `aria-pressed`; no mount-time focus.
4. **Layers tree**: one tab stop; APG tree keys; row action buttons remain
   context-menu-accessible, and the context menu MUST be keyboard-openable
   (Shift+F10 / Menu key) and restore focus on close. Focus retargets by
   node id, not numeric index, after delete/filter/collapse.
5. **Canvas**: single tab stop. **Tab behavior (existing, kept):** with a
   selection, Tab/Shift+Tab cycle selection through design objects (industry
   standard for design tools). **New (RC-15):** with no selection, Tab falls
   through to normal focus navigation — the canvas is never a hard trap.
   Escape clears selection and exits editing modes.
6. **Inspector**: disclosure buttons then section content in visual order;
   Export sub-tabs get full tabs pattern.
7. **Dialogs/popovers/menus/palettes**: modal surfaces trap focus
   (`aria-modal` + trap or native dialog); non-modal popovers follow their
   ARIA pattern without trapping. Every surface restores focus to its
   trigger (or nearest sensible parent) on close — including on unmount.
8. **Focus visibility**: every interactive control gets a visible
   `:focus-visible` indicator (2px ring using `--color-interactive-focus-ring`
   family), never `outline: none` without replacement, never background-only.
9. **Off-screen surfaces**: anything hidden by a transform/translate must be
   `visibility: hidden` or `inert` while closed so its controls leave the Tab
   sequence (RC-14).

## Remediation milestones

1. Audit doc + positive-tabindex gate + baseline E2E focus-order spec (this doc).
2. Shared primitives: `ui/Menu`, `ui/Toolbar`, `ui/Combobox`, `ui/Popover`,
   `ui/FocusTrap`, new `useRovingTabIndex` utility + unit tests.
3. Editor menubar (RC-6) + shell focus restoration on panel hide.
4. Canvas Tab exit (RC-10/RC-15) + ContextualHelp panel Tab-order fix (RC-14).
5. Inspector Export tabs (RC-12) + panel-disclosure focus handling.
6. `TabStrip` (RC-8) + `PageNav` (RC-7).
7. Layers tree lifecycle focus (RC-9): node-based retarget, rename return,
   context-menu keyboard open + restore.
8. Command palette (RC-5) + focus-restore verification across dialogs.
9. Focus-visible CSS (RC-11).
10. E2E focus-order suite + axe + visual regression.
11. Docs + final report.

## Evidence

- Focus-order trace: see `tests/e2e/canvas/keyboard-nav.spec.ts` (existing
  canvas Tab cycling coverage) and the new `tests/e2e/a11y/focus-order.spec.ts`
  added in milestone 1.
- Tab-order instrumentation (milestone 1): a fresh editor document contains
  169 tabbable elements. Real Tab stops start at the menubar Home button;
  the first ~37 DOM elements belong to the `display:none` home surface and
  are correctly skipped. After the status bar, the **closed** contextual
  help panel contributes ~40 visible-but-offscreen buttons to the Tab
  sequence (RC-14).
- Keydown instrumentation (milestone 1): Tab on the focused canvas is
  `defaultPrevented=true` at window bubble with no subsequent `focusin` —
  the canvas trap (RC-15) is unconditional for real documents.
- Prior architecture intent: `docs/architecture/focus-navigation.md`.
