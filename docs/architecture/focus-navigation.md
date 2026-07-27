# Focus Navigation Architecture

## Application Region Order

The Strata editor is organized into logical focus regions. Tab and Shift+Tab
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
| Toolbar | `@strata/ui/Toolbar.tsx` | APG toolbar, roving tabindex |
| TabStrip | `TabStrip.tsx` | APG tabs, roving tabindex |
| LayersPanel | `components/LayersPanel/` | APG tree, roving tabindex |
| PropertiesPanel | `components/Inspector/PropertiesPanel.tsx` | APG tabs, section disclosure |
| FocusTrap | `@strata/ui/FocusTrap.tsx` | Modal focus trap with initial focus |

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

## Known Limitations and Pre-existing Issues

1. **CanvasArea focus ring** — The canvas element has a `focus-visible` style
   but the ring is clipped in certain zoom states. This is a CSS `overflow`
   issue on the canvas container.

2. **Toolbar wrapping** — Current toolbar implementation wraps focus within
   the toolbar (last → first). Some users may prefer non-wrapping. The
   `useRovingTabIndex` hook supports both.

3. **Floating panel focus** — Floating panels use the native `popover` API
   which provides automatic focus management but has inconsistent behavior
   across WebView versions.

4. **Minimap focus** — The minimap is a non-interactive visual reference and
   is correctly excluded from tab order.

5. **Collab cursors** — Collaborative presence cursors are visual only and
   not focusable.

6. **WebView2 / WKWebView** — Some older WebView versions do not support
   the `inert` attribute. A polyfill would be required for comprehensive
   focus isolation on those platforms.

7. **Tauri native dialogs** — Native file dialogs opened by Tauri are outside
   the webview's control and may temporarily interrupt focus tracking.
