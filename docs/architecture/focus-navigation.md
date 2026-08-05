# Focus Navigation Architecture

## Application Region Order

The Varve editor is organized into logical focus regions. Tab and Shift+Tab
traverse regions in this order:

```
Tab forward:
  Menubar → Document Tabs → Main Toolbar → Left Sidebar (Layers) →
    Canvas → Right Sidebar (Inspector) → Bottom Panel (Timeline/Status) →
    Menubar (wraps)

Shift+Tab backward (reverse order)
```

### Region entry/exit rules

| Region     | Tab stops                    | Arrow nav                    | Escape behavior                       |
|------------|------------------------------|------------------------------|---------------------------------------|
| Menubar    | 1 (first menu button)       | Left/Right between menus     | Closes open menu, returns to menubar  |
| Tabs       | 1 (active tab)              | Left/Right between tabs      | N/A                                   |
| Toolbar    | 1 (active tool)             | Left/Right between tools     | N/A                                   |
| Layers     | 1 (first/active layer row)  | Up/Down between rows         | Exit rename mode                      |
| Canvas     | 1 (canvas element)          | Canvas object navigation     | Cancel current tool / exit isolation  |
| Inspector  | 1st field/section trigger   | Within composite controls    | Close popover                         |
| Timeline   | 1st control                 | Within timeline controls     | Close timeline                        |
| Status bar | 1st control                 | Within status controls       | N/A                                   |

### Region skipping

Users can navigate directly to key regions via:

- `Ctrl+Shift+L` — Focus Layers panel
- `Ctrl+Shift+I` — Focus Inspector
- `Ctrl+Shift+C` — Focus Canvas
- `Ctrl+Shift+T` — Focus Timeline
- `Ctrl+,` — Open Settings (focus inside dialog)
- `Ctrl+P` — Command palette (focus on search)
- `Ctrl+Shift+F` — Find and replace

## Composite Widget Patterns

### Roving TabIndex (primary pattern)

Used for: Menubar, Toolbar, Document Tabs, Inspector tabs, Layers tree,
Timeline tracks, Page nav, Swatch grids, Color sliders.

```
Container role="toolbar" | role="tablist" | role="tree" | role="listbox"
  ├── Item role="button" | role="tab" | role="treeitem" | role="option"
  │     tabIndex={isCurrent ? 0 : -1}
  │
  └── Item ...
        tabIndex={isCurrent ? 0 : -1}
```

- Only one item has `tabIndex={0}` at a time
- Arrow keys move which item is current
- Tab enters/exits the composite with a single stop

### Menu pattern (APG Menu)

Used for: Context menus, Menubar dropdowns, Icon-button menus.

- `role="menu"` on container, `role="menuitem"` / `role="menuitemcheckbox"` / `role="menuitemradio"` on items
- Roving tabindex
- Arrow Up/Down navigates items
- Enter/Space activates
- Escape closes, returns focus to trigger

### Dialog Modal pattern

Used for: Settings, Export, Batch operations, Dialogs, Confirmations.

- Focus trap: Tab cycles within the dialog
- Initial focus on first required input or primary action
- Escape closes (unless destructive action confirmation)
- Focus returns to trigger on close
- Nested dialogs maintain a focus scope stack

## Canvas Focus and Keyboard Routing

### Canvas focusability

The `<canvas>` element has `tabIndex={0}` and `role="img"` with
`aria-roledescription="Design canvas"`. It is one Tab stop.

### Shortcut suppression

Global canvas shortcuts are suppressed when focus is inside:

1. `<input>`, `<textarea>`, `<select>` elements
2. `contentEditable` elements
3. Elements with ARIA roles `combobox`, `textbox`, `spinbutton`, `slider`
4. Elements with `data-shortcut-ignore` attribute
5. Elements inside a container with `data-shortcut-ignore`
6. During IME composition

This is implemented in `ShortcutManager.shouldIgnoreShortcutTarget()`.

### Focus return to canvas

Focus returns to the canvas when:

- Escape closes a transient overlay or tool
- Picker or popover is closed
- Inspector edit is committed (Enter/Tab)
- Layer is selected from Layers panel
- Context menu command completes
- "Focus canvas" shortcut is activated

## Focus Restoration

Dialogs, popovers, find-replace, and modal UIs save the active element before
opening and restore focus when closed.

The `useFocusRestore` hook provides:
- `save()` — captures `document.activeElement`
- `restore(fallback)` — restores focus to saved element or fallback

Fallback chain:
1. Closest logical surviving control
2. Parent region
3. Region entry target
4. Canvas
5. Application shell

## Key Components

| Component | File | Focus behavior |
|-----------|------|----------------|
| Shell | `Shell.tsx` | CSS Grid layout with `inert` on hidden panels |
| CanvasArea | `CanvasArea.tsx` | `tabIndex={0}` canvas element, keyboard input pipeline |
| Menubar | `components/Menubar/index.tsx` | APG menubar, roving tabindex |
| Toolbar | `@varve/ui/Toolbar.tsx` | APG toolbar, roving tabindex |
| TabStrip | `TabStrip.tsx` | APG tabs, roving tabindex |
| LayersPanel | `components/LayersPanel/` | APG tree, roving tabindex |
| PropertiesPanel | `components/Inspector/PropertiesPanel.tsx` | APG tabs, section disclosure |
| FocusTrap | `@varve/ui/FocusTrap.tsx` | Modal focus trap with initial focus |

## Shared Primitives (hooks)

Located in `packages/editor/src/hooks/`:

| Hook | File | Purpose |
|------|------|---------|
| `useRovingTabIndex` | `useRovingTabIndex.ts` | Generic roving tabindex for composites |
| `useFocusRestore` | `useFocusRestore.ts` | Save/restore active element |
| `useFocusTrap` | `useFocusTrap.ts` | Focus trapping for modal dialogs |
| `useFocusScope` | `useFocusScope.ts` | Nested focus scope stack |
| `useCompositeNavigation` | `useCompositeNavigation.ts` | Arrow-key + typeahead composite nav |
| `useFocusVisible` | `useFocusVisible.ts` | Track keyboard vs pointer focus |

## Resolved Limitations

### 1. Canvas focus ring (RESOLVED)

**Was:** The canvas's `:focus-visible` rule targeted `.editor-canvas` (the
section) but DOM focus was on the inner `<canvas tabIndex=0>`, so the ring
never appeared. Additionally, the container's `overflow: hidden` could clip
child focus indicators.

**Fix:** Added a `::after` pseudo-element on `.editor-canvas` at z-index 11
(above interactive overlays) that renders the focus ring. JS toggles
`data-canvas-focus-visible` on the section when the inner canvas receives
`:focus-visible` (keyboard only — mouse clicks don't show the ring). Because
the pseudo-element is positioned on the section itself (not a child), it is
never clipped by `overflow: hidden`. See `editor.css` `.editor-canvas::after`
and `CanvasArea.tsx` `handleCanvasFocus`/`handleCanvasBlur`.

### 2. Toolbar wrapping (RESOLVED)

**Was:** `<Toolbar>` had hardcoded wrapping navigation with no way to disable it.

**Fix:** Added a `wrap?: boolean` prop (defaults to `true` for backward
compatibility). When `wrap={false}`, arrow navigation clamps at the first/last
item instead of wrapping. See `packages/ui/src/components/Toolbar.tsx`.

### 3. Popover focus fallback (RESOLVED)

**Was:** The `Popover` component unconditionally used the native `popover` API
(`showPopover`/`hidePopover`/`popover="auto"`). Browsers without this API
(Firefox < 125, Safari < 17) would get a TypeError.

**Fix:** Added feature detection (`HAS_POPOVER_API`). When unavailable, the
component falls back to `display: none`/`display: ''` toggling and a
`[data-popover-open]` attribute that CSS uses for visibility. The `inert`
sibling behavior and focus management work identically in both modes. See
`packages/ui/src/components/Popover.tsx`.

### 4. Tauri native dialog focus (RESOLVED)

**Was:** When a native Tauri file dialog opened, the webview lost OS-level
focus. On close, no DOM focus restoration happened — focus stayed on
`document.body`.

**Fix:** Added `withFocusRestore()` wrapper in `packages/platform/src/tauri.ts`
that saves `document.activeElement` before each dialog call and restores it
when the dialog closes. All four Tauri dialog methods
(`openDocumentFromDisk`, `importDocumentFromDisk`, `saveDocumentToDisk`,
`saveBinaryFile`) are now wrapped.

### 5. Screen-reader canvas announcements (RESOLVED)

**Was:** The canvas element had no `aria-describedby` pointing to the live
region, so screen readers wouldn't announce canvas state changes (selection,
tool, zoom) in the context of the focused canvas.

**Fix:** Added stable IDs (`strata-canvas-announcer-polite`,
`strata-canvas-announcer-assertive`) to the `CanvasAnnouncer` live regions
and wired `aria-describedby="strata-canvas-announcer-polite"` on the canvas
element. Now when the canvas is focused, screen readers can access the live
region's announcements.

### 6. WebGPU offscreen canvas (NOT APPLICABLE)

**Was listed as:** Potential focus issue with OffscreenCanvas in the render worker.

**Finding:** `OffscreenCanvas` in `packages/editor/src/render/` is purely a
rendering target with no DOM presence, no `tabIndex`, and no focus semantics.
It cannot receive focus and has no accessibility implications. No fix needed.

## Remaining Platform Notes

- **WebView2 / WKWebView** — Some older WebView versions do not support
  the `inert` attribute. A polyfill would be required for comprehensive
  focus isolation on those platforms. This project targets WebKitGTK 2.52.4
  which supports `inert`.

- **Screen-reader testing** — ARIA improvements were made but physical testing
  with NVDA (Windows), VoiceOver (macOS), and Orca (Linux) has not been
  performed in this session. The live regions and `aria-describedby` wiring
  follow WAI-ARIA 1.2 patterns.

- **Collab cursors** — Collaborative presence cursors remain visual-only and
  correctly non-focusable.

- **Minimap** — The minimap is correctly excluded from tab order as a
  non-interactive visual reference.
