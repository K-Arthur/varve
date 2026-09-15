# Menubar and Application Menu Audit

**Date**: 2026-07-23  
**Auditor**: Cascade (Senior Desktop UX, Accessibility, Command-System Engineer)  
**Scope**: Cross-platform menubar experience (CachyOS/Linux/Wayland, Windows, macOS, Browser)  
**Repository**: Strata (K-Arthur/Strata)  
**Branch**: feat/properties-panel-ia-audit

---

## Executive Summary

Strata's menubar provides functional menu access but lacks workspace awareness, platform-specific adaptations, consistent command integration, and comprehensive accessibility support. The current implementation mixes direct handlers with the shared command registry, shows all items regardless of context, and does not follow platform conventions for macOS, Windows, or Linux.

**Critical Issues**:
- No workspace-mode filtering (all 80+ items shown in every workspace)
- No platform-specific menu structures (identical for macOS/Windows/Linux/browser)
- Incomplete command registry integration (many items bypass ActionRegistry)
- Missing disabled-state logic based on selection/document state
- Non-standard menu organization (missing Text, Window, Select menus)
- Hardcoded shortcut strings that don't reflect user customizations
- Plugins menu stubbed with "No plugins loaded"
- Limited keyboard navigation and screen reader support

**Recommendation**: Implement a phased standardization that:
1. Maps all menu items to the shared ActionRegistry
2. Adds workspace-aware visibility and disabled-state logic
3. Creates platform-specific menu structures
4. Standardizes menu organization per desktop conventions
5. Enhances keyboard navigation and accessibility
6. Adds comprehensive E2E and accessibility tests

---

## Current Architecture

### Menubar Component Structure

**File**: `packages/editor/src/Menubar.tsx` (1,112 lines)

**Top-level menus** (8 total):
1. **File** (13 items): New, Open, Save, Save As, Export SVG, Import, Export, Backup Archive, Restore Archive, Present, Settings
2. **Edit** (10 items): Undo, Redo, Cut, Copy, Paste, Duplicate, Select All, Delete
3. **View** (35+ items): Themes, Zoom, Inspect Mode, Shortcuts, Snap, Guides, Panels, Canvas Modes, Workspaces, Color Blindness, View Rotation, Grid Overlays
4. **Object** (21 items): Group, Ungroup, Adjustment Layer, Clipping Masks, Background Removal, Crop, Palette, Audit tools, Masks, Flatten, Rasterize, Boolean Operations
5. **Arrange** (9 items): Layer ordering, Harmonize Spacing, Nudge
6. **Page** (4 items): Master page operations, Facing Pages
7. **Plugins** (1 item): "No plugins loaded" (stub)
8. **Help** (6 items): Contextual help, Help center, What's this, Tour, About

**Implementation characteristics**:
- Hardcoded `MENUS` array with static items
- Mixed action handling: some via ActionRegistry, some via direct switch statement
- Hardcoded shortcut strings (e.g., `'\u2318I'`) instead of dynamic formatting
- Simple disabled state: `disabled={!item.action}` only
- No workspace filtering or mode awareness
- No platform-specific variants
- Keyboard navigation implemented but incomplete

### Command Registry Integration

**Files**: 
- `packages/editor/src/actions/ActionRegistry.ts` (198 lines)
- `packages/editor/src/actions/registerAll.ts` (179 lines)
- `packages/editor/src/actions/createActionHandlers.ts` (418 lines)

**ActionRegistry capabilities**:
- Centralized command registration with categories
- Fuzzy search with scoring for command palette
- Recent/frequency tracking
- Category-based filtering
- Extensible handler registration

**Current registration**:
- `registerEditorActions()` registers ~60+ commands from createActionHandlers
- `registerAllShortcuts()` registers all SHORTCUT_DEFS as no-op stubs
- Priority rule: registerEditorActions MUST run first (documented in Shell.tsx:176-189)

**Gap**: Many menu items bypass ActionRegistry entirely:
- Theme switching handled directly in handleAction switch
- Mask operations handled directly
- Master page operations handled directly
- Workspace switching handled directly
- Dialog triggers handled directly

### Shortcut System

**File**: `packages/editor/src/shortcuts/ShortcutManager.ts` (668 lines)

**Coverage**: 100+ shortcuts defined across categories:
- File: newDocument, open, save, saveAs, export, import, settings
- Edit: undo, redo, cut, copy, paste, duplicate, delete, selectAll
- View: zoom, fit, rotate, panels, canvas modes, workspaces
- Object: group, ungroup, boolean ops, masks, adjustments
- Arrange: layer ordering, harmonize spacing, nudge
- Tools: 20+ tool shortcuts
- Motion: timeline, keyframes, onion skin

**Features**:
- Platform-aware modifier display (isMac())
- Collision detection at module init
- localStorage-based override system
- Context-aware shortcuts (canvas context for nudge)

**Gap**: Menubar hardcodes shortcuts instead of using formatShortcut():
```typescript
// Menubar.tsx:52 - hardcoded
{ label: 'Import\u2026', shortcut: '\u2318I', action: 'import' },

// Should be:
{ label: 'Import\u2026', shortcut: formatShortcut(SHORTCUT_DEFS.import.binding), action: 'import' },
```

### Workspace System

**File**: `packages/editor/src/workspace/workspaceTypes.ts` (1,089 lines)

**Workspace modes** (6 total):
1. **design**: UI/UX, components, prototyping
2. **print**: Multi-page, typography, preflight
3. **drawing**: Painting, brushes, stylus
4. **image**: Photo editing, retouching, adjustments
5. **motion**: Animation, timeline, keyframes
6. **codegen**: Design-to-code, audit, spec output

**Each workspace defines**:
- Panel visibility and layout
- Toolbar composition
- Inspector tabs
- Status bar sections
- Canvas overlays
- Shortcut layers (extra/disabled)
- Performance preferences
- Onboarding tips

**Gap**: Menubar does not adapt to workspace mode:
- All 80+ items shown in every workspace
- No workspace-specific menu items
- No disabled-state logic based on workspace
- Workspace switcher in menubar doesn't filter menus

---

## Detailed Findings

### 1. Menu Organization Issues

#### 1.1 Non-Standard Menu Categories

**Current**: File, Edit, View, Object, Arrange, Page, Plugins, Help

**Standard desktop conventions** (Figma, Sketch, Adobe, VS Code):
- **File**: Document operations (new, open, save, export, print)
- **Edit**: Undo/redo, clipboard, selection, find/replace
- **Object/Layer**: Grouping, masks, boolean ops, transformations
- **Text**: Font, typography, text alignment (when text selected)
- **Image**: Image-specific operations (crop, adjustments, filters)
- **Select**: Selection tools, modify selection, isolate
- **View**: Zoom, canvas modes, panels, guides, grids
- **Arrange**: Layer ordering, alignment, distribution
- **Prototype/Motion**: Prototype interactions, timeline (when in motion workspace)
- **Window/Workspace**: Window management, workspace switching
- **Help**: Documentation, tours, about

**Issues**:
- Missing Text menu (text operations scattered in Object)
- Missing Image menu (image operations in Object)
- Missing Select menu (selection tools not in menu)
- Missing Window menu (window management absent)
- Page menu too narrow (only 4 items, could be in File or Object)
- Plugins menu stubbed (should be hidden if no plugins)
- Object menu overloaded (21 items across unrelated categories)

#### 1.2 Excessive Menu Depth

**View menu**: 35+ items in flat list
- Themes (3 items)
- Zoom/View (8 items)
- Panels (4 items)
- Canvas modes (2 items)
- Workspaces (5 items)
- Color blindness (4 items)
- View rotation (3 items)
- Grid overlays (2 items)
- Guides (3 items)
- Other (fit, rulers, home)

**Problem**: No grouping, hard to scan, violates "7±2" cognitive limit

**Recommendation**: Use submenus or separators to group:
```
View
├── Zoom
│   ├── Zoom In
│   ├── Zoom Out
│   ├── Zoom to 100%
│   └── Fit to Selection
├── Canvas Mode
│   ├── Full Render
│   ├── Outline
│   └── Preview
├── Panels
│   ├── Layers
│   ├── Inspector
│   ├── Timeline
│   └── ...
├── Workspace
│   ├── Design
│   ├── Print
│   └── ...
└── ...
```

#### 1.3 Inconsistent Separator Usage

**Current**: Uses `'---'` string as separator marker

**Issues**:
- Inconsistent spacing (some menus have 3 separators in a row)
- No semantic grouping logic
- Separators don't adapt to hidden items

**Example** (View menu):
```typescript
{ label: '---' },  // After themes
{ label: '---' },  // After zoom
{ label: '---' },  // After panels
{ label: '---' },  // After workspace
{ label: '---' },  // After distraction-free
{ label: '---' },  // After fit commands
{ label: '---' },  // After rotation
{ label: '---' },  // After color blindness
```

**Recommendation**: Implement semantic separator logic that:
- Groups related items
- Removes consecutive separators
- Hides separators when adjacent items are hidden

### 2. Command Integration Issues

#### 2.1 Mixed Action Handling

**Current pattern** (Menubar.tsx:570-729):
```typescript
const handleAction = useCallback((action: string) => {
  // Menubar-specific actions (not in registry)
  switch (action) {
    case 'new': setConfirmNewDoc(true); return;
    case 'settings': onOpenSettings?.(); return;
    case 'theme:light': setTheme('light'); return;
    // ... 20+ direct handlers
  }
  
  // Fallback to registry
  const registry = getActionRegistry();
  const registered = registry.get(action);
  if (registered) {
    (registered.handler as () => void)();
    return;
  }
  
  // Legacy fallbacks
  switch (action) {
    case 'open': document.querySelector('#file-open-input')?.click();
    // ...
  }
}, [/* deps */]);
```

**Problems**:
- Triple dispatch pattern (direct → registry → legacy)
- No clear ownership of commands
- Difficult to track which items use registry vs direct
- Registry bypass breaks command palette integration

**Recommendation**: All menu items MUST use ActionRegistry:
```typescript
const handleAction = useCallback((action: string) => {
  const registry = getActionRegistry();
  const registered = registry.get(action);
  if (registered) {
    registered.handler();
    return;
  }
  console.warn(`Menubar: unregistered action "${action}"`);
}, []);
```

#### 2.2 Unregistered Commands

**Commands not in ActionRegistry**:
- Theme switching (theme:light, theme:dark, theme:high-contrast)
- Mask operations (addAlphaMask, addClipMask, etc.) - partially registered
- Master page operations (createMaster, applyMaster, detachMaster)
- Workspace switching (workspaceDesign, etc.) - partially registered
- Dialog triggers (export, archiveBackup, archiveRestore)
- Canvas mode switching (canvasModeOutline, canvasModePreview)

**Impact**: These commands don't appear in command palette, can't be remapped, don't get usage tracking.

**Recommendation**: Register all commands in registerAll.ts with proper categories and context.

#### 2.3 Duplicate Execution Paths

**Example**: Workspace switching
- Menubar: Direct `setWorkspaceMode(mode)` call
- Shortcut: Registered in createActionHandlers
- Workspace switcher component: Direct `setWorkspaceMode(mode)` call

**Problem**: Three code paths for same action, risk of divergence.

**Recommendation**: Single execution path through ActionRegistry.

### 3. Workspace and Mode Awareness

#### 3.1 No Workspace Filtering

**Current**: All 80+ items shown in every workspace

**Example issues**:
- Print workspace: Shows motion-specific items (Timeline Panel, Graph Editor, State Machine Panel)
- Design workspace: Shows print-specific items (Facing Pages, Master page operations)
- Image workspace: Shows motion-specific items

**Recommendation**: Filter menu items by workspace:
```typescript
const getVisibleItems = (menuId: MenuId, workspace: WorkspaceMode): MenuItem[] => {
  const items = MENUS.find(m => m.id === menuId)?.items ?? [];
  return items.filter(item => {
    if (item.workspaceVisibility) {
      return item.workspaceVisibility.includes(workspace);
    }
    return true; // Default to visible
  });
};
```

#### 3.2 No Context-Aware Disabled States

**Current**: Only `disabled={!item.action}`

**Missing disabled-state logic**:
- Cut/Copy/Paste: Disabled when no selection
- Group/Ungroup: Disabled when selection doesn't support it
- Boolean ops: Disabled when < 2 vector shapes selected
- Text operations: Disabled when no text selected
- Image operations: Disabled when no image selected
- Master page ops: Disabled when not in print workspace
- Timeline ops: Disabled when not in motion workspace

**Recommendation**: Add applicability checks to ActionRegistry:
```typescript
interface ActionDef {
  id: string;
  label: string;
  category: ActionCategory;
  applicable?: (ctx: EditorContextValue) => boolean;
  // ...
}
```

#### 3.3 No Mode-Specific Menus

**Missing**: Mode-specific menu items
- Text menu: Only show when text tool active or text selected
- Image menu: Only show in image workspace or when image selected
- Motion menu: Only show in motion workspace
- Print menu: Only show in print workspace

**Recommendation**: Dynamic menu structure based on workspace and selection.

### 4. Platform-Specific Issues

#### 4.1 No Native Menu Integration (Tauri)

**Current**: Pure React menubar, no Tauri native menu API usage

**macOS expectations**:
- Application menu (Strata): About, Settings, Services, Hide, Quit
- File menu: First item should be "New" (standard)
- Edit menu: Standard undo/redo/cut/copy/paste order
- Use Command symbol (⌘) for shortcuts
- Hide/Show/Quit in application menu, not File

**Windows expectations**:
- Alt-key navigation with underlined access keys
- File menu first, then Edit, View, etc.
- Use Ctrl+ for shortcuts
- Settings in File or Tools menu

**Linux expectations**:
- Follow freedesktop.org menu spec
- No global menu dependency (Wayland)
- Keyboard navigation
- Panel integration optional

**Current gaps**:
- No Tauri menu API integration
- No platform-specific menu structures
- No access key implementation (Windows)
- No application menu (macOS)

**Recommendation**: 
- Browser: Keep current React menubar
- Tauri: Use native menu APIs where available
- Platform-specific menu structures in MENUS config

#### 4.2 Shortcut Display Issues

**Current**: Mixed hardcoded and dynamic shortcuts

**Hardcoded examples**:
```typescript
{ label: 'Import\u2026', shortcut: '\u2318I', action: 'import' },
{ label: 'Present\u2026', shortcut: '\u21E7\u2318P', action: 'present' },
{ label: 'Delete', shortcut: '\u232B', action: 'delete' },
```

**Problems**:
- Don't reflect user customizations
- Don't adapt to platform (always show ⌘ on all platforms)
- Don't update when shortcuts remapped

**Recommendation**: Always use formatShortcut():
```typescript
{ 
  label: 'Import\u2026', 
  shortcut: formatShortcut(SHORTCUT_DEFS.import.binding), 
  action: 'import' 
},
```

#### 4.3 No Platform-Specific Menu Items

**Missing platform-specific items**:
- macOS: Application menu items (About, Preferences, Hide, Quit)
- Windows: Options/Tools menu
- Linux: Help menu structure

**Recommendation**: Platform-specific menu extensions:
```typescript
const PLATFORM_MENUS: Record<Platform, MenuExtension[]> = {
  macos: [
    { id: 'app', label: 'Strata', items: [/* About, Preferences, Hide, Quit */] }
  ],
  windows: [
    { id: 'tools', label: 'Tools', items: [/* Options, Customize */] }
  ],
  linux: [],
  web: []
};
```

### 5. Accessibility Issues

#### 5.1 Keyboard Navigation

**Current implementation** (Menubar.tsx:745-851):
- Arrow keys for navigation
- Enter/Space to activate
- Escape to close
- Home/End for first/last
- Left/Right to switch menus

**Issues**:
- No type-ahead navigation
- No mnemonic access keys (Windows Alt+letter)
- No menu bar activation shortcut (Alt on Windows, Ctrl+Alt on some Linux)
- Focus restoration not tested
- No trap focus within open menu

**Recommendation**:
- Add type-ahead: type first letter to jump to item
- Add mnemonics: Alt+F for File, Alt+E for Edit (Windows)
- Add menu bar activation: Alt (Windows), Ctrl+Alt (Linux)
- Test focus restoration with screen readers
- Implement focus trap for open menus

#### 5.2 Screen Reader Support

**Current ARIA**:
- `role="menubar"` on container
- `role="menuitem"` on top-level items
- `role="menu"` on dropdown
- `role="menuitemradio"` for radio items
- `role="menuitemcheckbox"` for checkbox items
- `aria-haspopup`, `aria-expanded`, `aria-checked`

**Issues**:
- No aria-label on menu items (screen reader reads label only)
- No aria-describedby for disabled state reasons
- No aria-keyshortcuts for shortcut announcement
- No live region for menu state changes
- No aria-orientation for vertical menus

**Recommendation**:
- Add aria-keyshortcuts: `aria-keyshortcuts="Ctrl+S"`
- Add aria-describedby for disabled items with reasons
- Add live region for menu open/close announcements
- Add aria-orientation="vertical" for dropdowns
- Test with NVDA (Windows), VoiceOver (macOS), Orca (Linux)

#### 5.3 Visual Accessibility

**Current styling**: Need to audit CSS

**Potential issues**:
- Focus indicator may not meet 3:1 contrast
- Disabled state may not meet WCAG AA
- High-contrast mode not tested
- Text scaling not tested
- Reduced motion not respected for menu animations

**Recommendation**:
- Audit focus indicator contrast
- Test disabled state contrast
- Test Windows high-contrast mode
- Test 200% text scaling
- Respect prefers-reduced-motion for menu transitions

### 6. Performance Issues

#### 6.1 Menu Re-rendering

**Current**: Full menu re-render on every state change

**Issues**:
- No memoization of menu items
- No lazy loading of submenus
- No virtualization for long menus
- Theme observer triggers re-renders

**Recommendation**:
- Memoize menu item lists
- Lazy-load submenu content
- Virtualize menus with 50+ items
- Debounce theme observer

#### 6.2 Dynamic Content

**Current**: No dynamic content (recent files, open documents)

**Future concerns**:
- Recent files list could be large
- Open documents could be many
- Plugin menus could be dynamic

**Recommendation**:
- Limit recent files to 10 items
- Lazy-load dynamic content
- Cache expensive queries
- Show loading states

### 7. Testing Gaps

#### 7.1 Unit Tests

**Current**: `packages/editor/src/Menubar.test.tsx` (210 lines)

**Coverage**:
- Dropdown portal rendering
- Position fixed on portaled menu

**Missing**:
- Menu item click handlers
- Keyboard navigation
- Accessibility attributes
- Workspace filtering
- Disabled states
- Shortcut display
- Platform-specific behavior

**Recommendation**: Add comprehensive unit tests for all menubar behavior.

#### 7.2 E2E Tests

**Current**: No dedicated menubar E2E tests

**Missing**:
- Open each menu via keyboard and pointer
- Navigate submenus without mouse
- Invoke commands and verify document changes
- Test disabled actions don't execute
- Switch workspaces and verify menu changes
- Test focus restoration
- Test screen reader behavior
- Test platform-specific behavior

**Recommendation**: Add E2E test suite per completion criteria.

---

## Standardized Menu Structure

### Proposed Top-Level Menus

**Standard (all platforms)**:
1. **File** - Document operations
2. **Edit** - Undo/redo, clipboard, selection
3. **Object** - Grouping, masks, boolean ops
4. **Text** - Typography (context-aware)
5. **Image** - Image operations (context-aware)
6. **Select** - Selection tools and modify
7. **View** - Zoom, canvas, panels, workspaces
8. **Arrange** - Layer ordering, alignment
9. **Prototype** - Interactions (motion workspace)
10. **Window** - Window management (desktop)
11. **Help** - Documentation, about

**Platform-specific**:
- **macOS**: Application menu (Strata) with About, Preferences, Hide, Quit
- **Windows**: Tools menu (optional)
- **Linux**: Help menu structure per freedesktop.org

### Detailed Menu Structure

#### File Menu
```
File
├── New                    Ctrl+N
├── Open\u2026             Ctrl+O
├── Open Recent           ▶ (dynamic, max 10)
├── ──────────────────────────
├── Save                   Ctrl+S
├── Save As\u2026          Ctrl+Shift+S
├── ──────────────────────────
├── Export\u2026           Ctrl+Shift+E
├── Export SVG\u2026       Ctrl+Alt+E
├── ──────────────────────────
├── Import\u2026           Ctrl+I
├── ──────────────────────────
├── Backup Archive\u2026   Ctrl+Shift+N
├── Restore Archive\u2026  Ctrl+Shift+L
├── ──────────────────────────
├── Present\u2026          Ctrl+Shift+P
├── ──────────────────────────
├── Settings\u2026         Ctrl+, (macOS: Preferences)
└── Quit                   Ctrl+Q (macOS: in app menu)
```

#### Edit Menu
```
Edit
├── Undo                   Ctrl+Z
├── Redo                   Ctrl+Shift+Z
├── ──────────────────────────
├── Cut                    Ctrl+X
├── Copy                   Ctrl+C
├── Paste                  Ctrl+V
├── Duplicate              Ctrl+D
├── ──────────────────────────
├── Select All             Ctrl+A
├── Deselect               Ctrl+Shift+A
├── ──────────────────────────
├── Delete                 Backspace
└── Find\u2026             Ctrl+F (future)
```

#### Object Menu
```
Object
├── Group                  Ctrl+G
├── Ungroup                Ctrl+Shift+G
├── ──────────────────────────
├── New Adjustment Layer   Ctrl+Alt+N
├── Create Clipping Mask   Ctrl+7
├── Release Clipping Mask  Ctrl+Alt+7
├── ──────────────────────────
├── Boolean                ▶
│   ├── Union              Ctrl+Alt+U
│   ├── Subtract           Ctrl+Alt+S
│   ├── Intersect          Ctrl+Alt+I
│   └── Exclude            Ctrl+Alt+X
├── ──────────────────────────
├── Mask                   ▶
│   ├── Add Alpha Mask
│   ├── Add Clip Mask
│   ├── Add Luminance Mask
│   ├── Remove Mask
│   ├── Toggle Mask
│   └── Invert Mask
├── ──────────────────────────
├── Flatten Selection      Ctrl+Shift+F
├── Rasterize              (future)
├── Merge Selected         (future)
└── Remove Background\u2026  (image workspace)
```

#### Text Menu (context-aware)
```
Text (shown when text selected or text tool active)
├── Font                   ▶ (dynamic)
├── Size                   ▶ (dynamic)
├── ──────────────────────────
├── Bold                   Ctrl+B
├── Italic                 Ctrl+I
├── Underline              Ctrl+U
├── ──────────────────────────
├── Align Left             Ctrl+Shift+L
├── Align Center           Ctrl+Shift+C
├── Align Right            Ctrl+Shift+R
├── Justify                Ctrl+Shift+J
├── ──────────────────────────
├── Increase Size          Ctrl+]
├── Decrease Size          Ctrl+[
└── Convert to Outlines    Ctrl+Shift+O
```

#### Image Menu (context-aware)
```
Image (shown in image workspace or when image selected)
├── Crop                   C
├── ──────────────────────────
├── Adjustments            ▶
│   ├── Brightness/Contrast
│   ├── Hue/Saturation
│   ├── Color Balance
│   └── Curves
├── ──────────────────────────
├── Remove Background\u2026  Ctrl+Shift+B
├── Extract Palette        (future)
├── ──────────────────────────
├── Upscale\u2026           (future)
└── Color Profile          ▶
```

#### Select Menu
```
Select
├── All                    Ctrl+A
├── None                   Ctrl+Shift+A
├── ──────────────────────────
├── Inverse                Ctrl+Shift+I
├── Similar                (future)
├── ──────────────────────────
├── Layers Above           Ctrl+Alt+]
├── Layers Below           Ctrl+Alt+[
└── Lock Selection         Ctrl+Shift+L
```

#### View Menu
```
View
├── Zoom                   ▶
│   ├── Zoom In            Ctrl++
│   ├── Zoom Out           Ctrl+-
│   ├── Zoom to 100%       Ctrl+0
│   ├── Fit to Page        Ctrl+Shift+1
│   ├── Fit to Frame       Ctrl+Shift+2
│   └── Fit to Selection   Ctrl+Shift+3
├── ──────────────────────────
├── Canvas Mode            ▶
│   ├── Full Render        Escape
│   ├── Outline            Ctrl+Shift+O
│   └── Preview            Ctrl+Shift+R
├── ──────────────────────────
├── Panels                 ▶
│   ├── Layers             Ctrl+B
│   ├── Inspector          Ctrl+Shift+B
│   ├── Timeline           Ctrl+Alt+T (motion)
│   └── ...
├── ──────────────────────────
├── Workspace              ▶
│   ├── Design             Ctrl+Shift+1
│   ├── Print              Ctrl+Shift+2
│   ├── Drawing            Ctrl+Shift+3
│   ├── Photo              Ctrl+Shift+4
│   ├── Motion             Ctrl+Shift+5
│   └── Codegen            Ctrl+Shift+9
├── ──────────────────────────
├── Show Guides            Ctrl+;
├── Lock Guides            Ctrl+Alt+;
├── Clear Guides
├── ──────────────────────────
├── Snap                   ,
├── ──────────────────────────
├── Grid                   ▶
│   ├── Pixel Grid
│   ├── Baseline Grid      Ctrl+Alt+Shift+B
│   └── Isometric Grid     Ctrl+Alt+Shift+I
├── ──────────────────────────
├── Color Blindness        ▶
│   ├── None               Ctrl+Alt+0
│   ├── Protanopia         Ctrl+Alt+P
│   ├── Deuteranopia       Ctrl+Alt+D
│   └── Tritanopia         Ctrl+Alt+3
├── ──────────────────────────
├── Theme                  ▶
│   ├── Light
│   ├── Dark
│   └── High Contrast
├── ──────────────────────────
├── Distraction Free       Ctrl+Shift+F
├── Before/After          \
└── Inspect Mode           Ctrl+Shift+I
```

#### Arrange Menu
```
Arrange
├── Bring to Front         Ctrl+Shift+]
├── Bring Forward          Ctrl+]
├── Send Backward          Ctrl+[
├── Send to Back           Ctrl+Shift+[
├── ──────────────────────────
├── Align                  ▶
│   ├── Left               Ctrl+Shift+ArrowLeft
│   ├── Center H           Ctrl+Shift+Home
│   ├── Right              Ctrl+Shift+ArrowRight
│   ├── Top                Ctrl+Shift+ArrowUp
│   ├── Center V           Ctrl+Shift+PageUp
│   └── Bottom             Ctrl+Shift+ArrowDown
├── ──────────────────────────
├── Distribute             ▶
│   ├── Horizontal         Ctrl+Alt+H
│   └── Vertical           Ctrl+Alt+V
├── ──────────────────────────
├── Harmonize Spacing      Ctrl+Shift+Space
└── Nudge                  (arrow keys, canvas context)
```

#### Prototype Menu (motion workspace)
```
Prototype (shown in motion workspace)
├── Play/Pause             Space
├── Stop                   Ctrl+.
├── ──────────────────────────
├── Add Keyframe           I
├── ──────────────────────────
├── Toggle Auto-Keyframe  Alt+K
├── Toggle Onion Skin     Alt+O
├── ──────────────────────────
├── Graph Editor           G
├── State Machine          Ctrl+Alt+K
└── Present                Ctrl+Shift+P
```

#### Window Menu (desktop only)
```
Window (desktop only)
├── Minimize
├── Zoom
├── ──────────────────────────
├── Bring All to Front
└── [List of open windows]
```

#### Help Menu
```
Help
├── Contextual Help        F1
├── Help Center            Ctrl+Shift+F1
├── What's This?           Shift+F1
├── ──────────────────────────
├── Keyboard Shortcuts     Ctrl+/
├── ──────────────────────────
├── Take a Tour
├── ──────────────────────────
├── Documentation         (online)
├── Community              (online)
├── ──────────────────────────
└── About Strata
```

### Workspace-Specific Visibility

**Design workspace**: Show all except Prototype, Print-specific items
**Print workspace**: Show all except Prototype, Image-specific items; add Page menu
**Drawing workspace**: Show all except Prototype, Print-specific items
**Image workspace**: Show all except Prototype, Print-specific items; emphasize Image menu
**Motion workspace**: Show all including Prototype menu; hide Print-specific items
**Codegen workspace**: Show all except Prototype, Print-specific items

---

## Implementation Plan

### Phase 1: Command Registry Integration (Priority: Critical)

**Goal**: All menu items use ActionRegistry

**Tasks**:
1. Register all menubar actions in registerAll.ts
2. Remove direct handlers from Menubar handleAction switch
3. Update handleAction to only use registry
4. Add applicability checks to ActionDef
5. Test command palette includes all menu items

**Estimated effort**: 2-3 days

**Files to modify**:
- `packages/editor/src/actions/registerAll.ts`
- `packages/editor/src/actions/ActionRegistry.ts` (add applicability)
- `packages/editor/src/Menubar.tsx` (simplify handleAction)

### Phase 2: Workspace Awareness (Priority: High)

**Goal**: Menubar adapts to workspace mode

**Tasks**:
1. Add workspaceVisibility to MenuItem interface
2. Add workspace filtering logic to getVisibleItems
3. Update menu structure to hide workspace-specific items
4. Add workspace-specific menu items (Text, Image, Prototype)
5. Test menu changes when switching workspaces

**Estimated effort**: 2-3 days

**Files to modify**:
- `packages/editor/src/Menubar.tsx` (add filtering)
- `packages/editor/src/workspace/workspaceTypes.ts` (add menu config)

### Phase 3: Disabled State Logic (Priority: High)

**Goal**: Menu items disabled based on context

**Tasks**:
1. Implement applicability checks in ActionRegistry
2. Add context queries (hasSelection, hasText, hasImage, etc.)
3. Update Menubar to use applicability for disabled state
4. Add aria-describedby for disabled reasons
5. Test disabled states with various selections

**Estimated effort**: 3-4 days

**Files to modify**:
- `packages/editor/src/actions/ActionRegistry.ts` (add applicability)
- `packages/editor/src/Menubar.tsx` (use applicability)
- `packages/editor/src/context/types.ts` (add context queries)

### Phase 4: Shortcut Display Fix (Priority: Medium)

**Goal**: All shortcuts use formatShortcut

**Tasks**:
1. Replace hardcoded shortcuts with formatShortcut calls
2. Add shortcut change listener to update menu labels
3. Test shortcut remapping updates menu labels
4. Test platform-specific modifier display

**Estimated effort**: 1 day

**Files to modify**:
- `packages/editor/src/Menubar.tsx` (replace hardcoded shortcuts)

### Phase 5: Menu Structure Standardization (Priority: High)

**Goal**: Reorganize menus per standard conventions

**Tasks**:
1. Implement new menu structure (Text, Image, Select, Prototype)
2. Add submenu support to Menubar component
3. Reorganize View menu with submenus
4. Remove or stub Plugins menu
5. Add Window menu (desktop only)
6. Test new menu organization

**Estimated effort**: 3-4 days

**Files to modify**:
- `packages/editor/src/Menubar.tsx` (new structure)
- `packages/editor/src/Menubar.css` (submenu styling)

### Phase 6: Platform-Specific Menus (Priority: Medium)

**Goal**: Platform-specific menu structures

**Tasks**:
1. Detect platform in Menubar component
2. Add platform-specific menu extensions
3. Implement macOS application menu (Tauri)
4. Add Windows access keys (Alt+letter)
5. Test on each platform

**Estimated effort**: 3-4 days

**Files to modify**:
- `packages/editor/src/Menubar.tsx` (platform detection)
- `apps/desktop/src-tauri/src/lib.rs` (Tauri menu integration)

### Phase 7: Accessibility Enhancements (Priority: High)

**Goal**: Full keyboard navigation and screen reader support

**Tasks**:
1. Add type-ahead navigation
2. Add mnemonics (Windows Alt+letter)
3. Add menu bar activation shortcut
4. Add aria-keyshortcuts
5. Add aria-describedby for disabled items
6. Add live region for menu state
7. Test with NVDA, VoiceOver, Orca
8. Test high-contrast mode
9. Test 200% text scaling

**Estimated effort**: 4-5 days

**Files to modify**:
- `packages/editor/src/Menubar.tsx` (ARIA, keyboard)
- `packages/editor/src/Menubar.css` (focus indicators)

### Phase 8: Performance Optimization (Priority: Low)

**Goal**: Efficient menu rendering

**Tasks**:
1. Memoize menu item lists
2. Lazy-load submenu content
3. Debounce theme observer
4. Profile menu opening latency
5. Optimize re-renders

**Estimated effort**: 2-3 days

**Files to modify**:
- `packages/editor/src/Menubar.tsx` (memoization)

### Phase 9: Testing (Priority: High)

**Goal**: Comprehensive test coverage

**Tasks**:
1. Add unit tests for menu filtering
2. Add unit tests for disabled states
3. Add unit tests for keyboard navigation
4. Add E2E tests for menu interactions
5. Add E2E tests for workspace switching
6. Add accessibility tests (axe-core)
7. Add platform-specific E2E tests

**Estimated effort**: 5-6 days

**Files to create**:
- `packages/editor/src/Menubar.test.tsx` (expand)
- `tests/e2e/menubar/menubar.spec.ts` (new)
- `tests/e2e/menubar/accessibility.spec.ts` (new)

### Phase 10: Documentation (Priority: Medium)

**Goal**: Clear documentation for menu system

**Tasks**:
1. Document menu structure in AGENTS.md
2. Document command registration process
3. Document workspace-specific menus
4. Document platform-specific behavior
5. Document accessibility features

**Estimated effort**: 1-2 days

**Files to modify**:
- `AGENTS.md`
- `docs/architecture/menubar-system.md` (new)

---

## Testing Strategy

### Unit Tests

**File**: `packages/editor/src/Menubar.test.tsx`

**Test cases**:
- Menu rendering with all items
- Menu filtering by workspace
- Disabled state based on selection
- Shortcut display formatting
- Keyboard navigation (arrows, home, end, enter, escape)
- ARIA attributes
- Theme switching
- Platform-specific menu items

### E2E Tests

**File**: `tests/e2e/menubar/menubar.spec.ts`

**Test cases**:
1. Open each menu via pointer
2. Open each menu via keyboard (Alt+letter, arrow keys)
3. Navigate submenus without mouse
4. Invoke commands and verify document changes
5. Verify disabled actions do not execute
6. Switch workspaces and verify menu changes
7. Edit text and verify menu shortcuts don't break caret
8. Remap a shortcut and verify menu label updates
9. Test focus restoration after closing menus
10. Test menus at narrow window widths
11. Test menus at screen edges
12. Test recent files (missing, encrypted)

**File**: `tests/e2e/menubar/accessibility.spec.ts`

**Test cases**:
1. Screen reader announces menu structure
2. Screen reader announces shortcuts
3. Screen reader announces disabled states
4. Keyboard-only navigation complete
5. Focus indicators visible
6. High-contrast mode readable
7. 200% text scaling usable
8. Reduced motion respected

### Platform-Specific Tests

**Linux (CachyOS/Wayland)**:
- WebKitGTK menu behavior
- Keyboard activation
- Focus behavior
- Fractional scaling

**Windows**:
- Alt-key navigation
- Access keys
- WebView2 behavior

**macOS**:
- Native menu integration
- Command shortcuts
- Application menu

**Browser**:
- No browser shortcut conflicts
- Desktop-only actions hidden

---

## Success Criteria

### Functional Criteria
- [ ] All menu items use ActionRegistry
- [ ] Menubar adapts to workspace mode
- [ ] Disabled states based on context
- [ ] Shortcuts display correctly and update on remap
- [ ] Platform-specific menu structures
- [ ] No duplicate execution paths

### Accessibility Criteria
- [ ] Full keyboard navigation (no mouse required)
- [ ] Screen reader announces all menu states
- [ ] Focus indicators meet 3:1 contrast
- [ ] Disabled states meet WCAG AA
- [ ] High-contrast mode tested
- [ ] 200% text scaling tested
- [ ] Reduced motion respected

### Performance Criteria
- [ ] Menu opening latency < 50ms
- [ ] No unnecessary re-renders
- [ ] Dynamic content lazy-loaded
- [ ] Memoization where appropriate

### Testing Criteria
- [ ] Unit tests for all menu behavior
- [ ] E2E tests for 12 core scenarios
- [ ] Accessibility tests with screen readers
- [ ] Platform-specific tests for Linux/Windows/macOS/Browser
- [ ] No globally skipped tests

### Documentation Criteria
- [ ] Menu structure documented
- [ ] Command registration documented
- [ ] Workspace-specific behavior documented
- [ ] Platform-specific behavior documented
- [ ] Accessibility features documented

---

## Risks and Mitigations

### Risk 1: Breaking Existing Workflows

**Risk**: Users rely on current menu structure

**Mitigation**:
- Phase rollout with feature flags
- Provide migration guide
- Keep old structure as fallback option
- Test with power users before release

### Risk 2: Performance Regression

**Risk**: New filtering logic slows menu opening

**Mitigation**:
- Profile before and after
- Use memoization
- Lazy-load dynamic content
- Set performance budget (50ms menu open)

### Risk 3: Platform-Specific Bugs

**Risk**: Platform-specific code introduces bugs

**Mitigation**:
- Test on all platforms
- Use platform detection sparingly
- Prefer cross-platform solutions
- Add platform-specific E2E tests

### Risk 4: Accessibility Regression

**Risk**: New features break screen reader support

**Mitigation**:
- Test with NVDA, VoiceOver, Orca
- Use ARIA live regions
- Add accessibility tests
- Consult accessibility guidelines

### Risk 5: Command Registry Overload

**Risk**: Too many commands in registry

**Mitigation**:
- Use categories for organization
- Implement fuzzy search
- Add usage tracking
- Consider command aliases

---

## Remaining Limitations

### Technical Limitations

1. **Tauri Native Menu**: Not yet integrated - requires Rust-side changes
2. **Global Menu (Linux)**: Not supported on Wayland - by design
3. **Dynamic Menu Content**: Not yet implemented (recent files, plugins)
4. **Menu Customization**: Not yet supported (user can't reorder items)

### Design Limitations

1. **Menu Crowding**: Some menus still have 20+ items - may need further refinement
2. **Workspace Switching**: Menubar doesn't animate during workspace switch
3. **Context Menus**: Not in scope for this audit (separate system)

### Platform Limitations

1. **Browser**: Cannot use native menus - limited to React implementation
2. **Linux**: No global menu on Wayland - acceptable per requirements
3. **macOS**: Application menu requires Tauri integration - deferred

---

## Recommendations

### Immediate Actions (This Sprint)

1. **Fix hardcoded shortcuts** (Phase 4) - Quick win, low risk
2. **Register all commands** (Phase 1) - Foundation for other work
3. **Add basic disabled states** (Phase 3) - High impact, medium effort

### Short-Term Actions (Next Sprint)

4. **Implement workspace filtering** (Phase 2) - High impact
5. **Standardize menu structure** (Phase 5) - High impact
6. **Add keyboard navigation enhancements** (Phase 7) - High impact

### Medium-Term Actions (Next Quarter)

7. **Platform-specific menus** (Phase 6) - Medium impact
8. **Performance optimization** (Phase 8) - Medium impact
9. **Comprehensive testing** (Phase 9) - High impact

### Long-Term Actions (Future)

10. **Tauri native menu integration** - Requires Rust expertise
11. **Dynamic menu content** - Requires architecture work
12. **Menu customization** - Requires user settings

---

## Conclusion

Strata's menubar provides functional menu access but requires significant work to meet desktop application standards for workspace awareness, platform-specific behavior, accessibility, and command integration. The proposed phased approach addresses critical issues first while building toward a comprehensive, standards-compliant menu system.

The audit identified 80+ menu items across 8 menus with inconsistent command integration, no workspace filtering, incomplete disabled-state logic, and accessibility gaps. The implementation plan prioritizes command registry integration and workspace awareness as foundational work, followed by menu structure standardization and accessibility enhancements.

With systematic execution of the 10-phase plan, Strata's menubar can become a predictable, accessible, responsive, and platform-appropriate command interface that serves users across CachyOS/Linux, Windows, macOS, and browser environments.
