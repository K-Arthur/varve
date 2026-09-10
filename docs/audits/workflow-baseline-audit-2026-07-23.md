# Workflow Baseline Audit
**Date**: 2026-07-23  
**Purpose**: Establish baseline measurements for 13 representative creative workflows before implementing efficiency improvements.

## Audit Methodology

For each workflow, we measure:
- **Click/command count**: Number of user actions required
- **Panel switches**: Number of panel tab changes required
- **Pointer travel**: Estimated mouse/pen distance (qualitative)
- **Repeated property changes**: Actions that could be batched
- **Modal interruptions**: Dialogs that block workflow
- **Undo operations**: Mistakes requiring undo
- **Time to complete**: Estimated completion time
- **Keyboard-only completion**: Whether task can be done without mouse
- **Discoverability**: How obvious the workflow is
- **Failure/recovery points**: Where users commonly get stuck

---

## Workflow 1: Create a Document and Frame

### Current Steps
1. Launch Strata → Home screen
2. Click "New Document" (or Ctrl+N)
3. Select preset or enter dimensions
4. Click "Create"
5. Press F (Frame tool) or click Frame tool in toolbar
6. Drag on canvas to create frame
7. Optionally: Resize frame via handles or inspector

### Baseline Measurements
- **Clicks**: 5-7
- **Panel switches**: 0-1 (if using inspector for precise dimensions)
- **Pointer travel**: Medium (home → dialog → canvas → toolbar)
- **Modal interruptions**: 1 (New Document dialog)
- **Keyboard-only**: Partial (Ctrl+N works, but frame creation requires pointer)
- **Time**: 8-12 seconds
- **Discoverability**: High (New Document is prominent)
- **Friction points**:
  - Dialog blocks canvas work
  - No quick-create preset on canvas
  - Frame tool must be selected explicitly

### Improvement Opportunities
- Add canvas-based "Create Frame" quick action
- Remember last-used document preset
- Allow keyboard-only frame creation with default size
- Add frame preset dropdown on toolbar

---

## Workflow 2: Import, Crop, Resize, and Position an Image

### Current Steps
1. File → Import (Ctrl+Shift+I) or drag-and-drop
2. Select image file
3. Image appears on canvas
4. Press C (Crop tool) or select Crop tool
5. Adjust crop handles
6. Press Enter to commit crop
7. Press V (Select tool)
8. Drag image to position
9. Drag corner handles to resize (or use inspector)
10. Optionally: Hold Shift to constrain aspect ratio

### Baseline Measurements
- **Clicks**: 8-12
- **Panel switches**: 0-2 (inspector for precise sizing)
- **Pointer travel**: High (menu → file dialog → canvas → toolbar → handles)
- **Modal interruptions**: 1 (file dialog)
- **Keyboard-only**: Low (file dialog and crop require pointer)
- **Time**: 15-25 seconds
- **Discoverability**: Medium (drag-drop works, but crop tool discovery)
- **Friction points**:
  - Crop tool is separate from select
  - No visual cue for aspect ratio constraint
  - Resize vs crop distinction unclear
  - No smart resize to fit frame

### Improvement Opportunities
- Add "Fit to Frame" option on image drop
- Combine crop and resize in unified image tool
- Add aspect ratio lock indicator
- Add smart guides for common image sizes
- Remember last crop settings

---

## Workflow 3: Create and Style Vector Objects

### Current Steps
1. Press R (Rectangle) or O (Ellipse) or select shape tool
2. Drag on canvas to create shape
3. Shape appears with default fill/stroke
4. Open Inspector → Properties tab (if not already open)
5. Adjust fill color via color picker
6. Adjust stroke width/color
7. Adjust corner radius (if rectangle)
8. Optionally: Add effects via Appearance tab
9. Optionally: Adjust position/size via transform section

### Baseline Measurements
- **Clicks**: 10-20
- **Panel switches**: 1-3 (Properties → Appearance → back)
- **Pointer travel**: Medium (canvas → inspector → color picker)
- **Modal interruptions**: 0
- **Keyboard-only**: Low (color picker requires pointer)
- **Time**: 20-40 seconds
- **Discoverability**: High (tools are visible)
- **Friction points**:
  - Default styles may not match intent
  - Fill/stroke controls are separate sections
  - No quick style presets
  - Color picker opens modal
  - Corner radius hidden in subsection

### Improvement Opportunities
- Add quick style presets on shape creation
- Add inline color picker (non-modal)
- Group fill/stroke in single section
- Add "remember last style" option
- Add shape-specific tool options bar

---

## Workflow 4: Edit Text and Typography

### Current Steps
1. Press T (Text tool) or select Text tool
2. Click on canvas or drag to create text box
3. Type text
4. Double-click text to edit (or select + type)
5. Open Inspector → Properties tab
6. Select font family from dropdown
7. Adjust font size
8. Adjust font weight
9. Adjust line height/letter spacing (in Typography section)
10. Adjust color (in Fill section)
11. Optionally: Add text effects in Appearance tab

### Baseline Measurements
- **Clicks**: 12-25
- **Panel switches**: 2-4 (Properties → Typography → Fill → Appearance)
- **Pointer travel**: Medium-High (canvas → inspector → multiple sections)
- **Modal interruptions**: 0
- **Keyboard-only**: Low (font selection requires pointer)
- **Time**: 25-45 seconds
- **Discoverability**: Medium (text editing is intuitive, but typography controls scattered)
- **Friction points**:
  - Typography controls separate from basic text properties
  - Font dropdown is long and unsearchable
  - No visual font preview
  - Line height/letter spacing hidden in subsection
  - No quick text style presets

### Improvement Opportunities
- Add inline text formatting toolbar (like word processors)
- Add font search with preview
- Group text properties in single section
- Add text style presets (heading, body, caption)
- Add font favorites/recent fonts

---

## Workflow 5: Create Reusable Styles or Components

### Current Steps
1. Create and style object(s)
2. Select object(s)
3. Right-click → "Create Component" (or Ctrl+Alt+K)
4. Name component in dialog
5. Component appears in Library panel
6. To use: Drag from Library panel to canvas
7. To edit: Double-click component instance
8. To create variant: Edit instance → "Add Variant" in Properties

### Baseline Measurements
- **Clicks**: 8-15
- **Panel switches**: 1-2 (Library panel)
- **Pointer travel**: Medium (canvas → context menu → Library)
- **Modal interruptions**: 1 (naming dialog)
- **Keyboard-only**: Partial (Ctrl+Alt+K works, but naming requires pointer)
- **Time**: 15-30 seconds
- **Discoverability**: Low-Medium (component concept not obvious)
- **Friction points**:
  - Component creation requires menu/context action
  - No visual indication of what can be componentized
  - Variant creation hidden in Properties
  - Library panel may not be visible
  - No component preview in Library

### Improvement Opportunities
- Add "Create Component" button in inspector
- Add visual indicator for component-eligible selections
- Add component creation to Quick Actions
- Show component thumbnails in Library
- Add "Save as Style" for non-component properties

---

## Workflow 6: Apply Effects and Adjustment Layers

### Current Steps
1. Select object or layer
2. Open Inspector → Appearance & Effects tab
3. Click "Add Effect" dropdown
4. Select effect type (blur, shadow, etc.)
5. Adjust effect parameters
6. For adjustment layers: Layer menu → New Adjustment Layer
7. Select adjustment type (curves, levels, etc.)
8. Adjust parameters in Adjustments panel
9. Mask adjustment to specific layer if needed

### Baseline Measurements
- **Clicks**: 10-20
- **Panel switches**: 2-3 (Appearance → Adjustments → Layers)
- **Pointer travel**: Medium (inspector → menu → panels)
- **Modal interruptions**: 0
- **Keyboard-only**: Low (all UI-based)
- **Time**: 20-35 seconds
- **Discoverability**: Low (effects hidden in tab, adjustment layers separate)
- **Friction points**:
  - Effects and adjustments in different places
  - No visual preview of effects
  - Adjustment layer creation requires menu navigation
  - Masking adjustments is multi-step
  - No effect presets

### Improvement Opportunities
- Add effects panel with visual presets
- Unify effects and adjustments in one location
- Add drag-and-drop effect application
- Add "Adjustment Layer" button in Layers panel
- Add effect presets (drop shadows, glows, etc.)

---

## Workflow 7: Organize Layers and Nested Frames

### Current Steps
1. Create multiple objects
2. Open Layers panel (if not visible)
3. Drag layers to reorder
4. Select multiple layers (Shift+click)
5. Right-click → Group (Ctrl+G)
6. Double-click group to enter
7. Drag layers within group
8. Click breadcrumb or press Escape to exit
9. Rename layers via double-click or context menu
10. Lock/hide layers via layer panel icons
11. Color-code layers via layer panel dropdown

### Baseline Measurements
- **Clicks**: 15-30
- **Panel switches**: 1 (Layers panel)
- **Pointer travel**: High (canvas → layers panel → drag operations)
- **Modal interruptions**: 0
- **Keyboard-only**: Partial (grouping works, but reordering requires pointer)
- **Time**: 30-60 seconds
- **Discoverability**: Medium (layers panel is standard)
- **Friction points**:
  - Layer panel may be collapsed
  - Drag-reorder can be finicky
  - No bulk rename
  - No select-all-in-group
  - Color coding requires dropdown
  - No layer search/filter

### Improvement Opportunities
- Add bulk rename dialog
- Add layer search/filter
- Add "Select Children" option
- Add color coding quick swatches
- Add layer sorting options
- Improve drag-drop feedback

---

## Workflow 8: Duplicate and Align Repeated Content

### Current Steps
1. Select object(s)
2. Duplicate (Ctrl+D) or Alt+drag
3. Move duplicate to position
4. Repeat for additional copies
5. Select all copies
6. Open Inspector → Properties tab
7. Use align buttons (left, center, right, top, middle, bottom)
8. Use distribute buttons (horizontal, vertical)
9. Adjust spacing manually if needed

### Baseline Measurements
- **Clicks**: 12-25
- **Panel switches**: 1 (Properties tab)
- **Pointer travel**: Medium (canvas → inspector)
- **Modal interruptions**: 0
- **Keyboard-only**: Partial (Ctrl+D works, but align requires pointer)
- **Time**: 20-40 seconds
- **Discoverability**: Medium (align/distribute in inspector)
- **Friction points**:
  - No "repeat last transform" command
  - No "duplicate with offset" (remember spacing)
  - Align/distribute hidden in subsection
  - No visual spacing guides
  - No grid/snap-to-grid for repeated items

### Improvement Opportunities
- Add "Repeat Duplicate" (Cmd/Ctrl+D after initial)
- Add "Duplicate with Offset" (Cmd/Ctrl+Option+D)
- Add align/distribute to Quick Actions
- Add spacing guides during distribute
- Add grid snap for repeated items
- Add "Create Grid" from selection

---

## Workflow 9: Create Multiple Pages or Artboards

### Current Steps
1. Create initial frame/artboard
2. Open Page Nav panel (bottom)
3. Click "+" to add new page
4. New page appears blank
5. Copy content from first page
6. Navigate to new page
7. Paste content
8. Adjust for new page
9. Repeat for additional pages
10. Reorder pages via drag in Page Nav

### Baseline Measurements
- **Clicks**: 10-20
- **Panel switches**: 0-1 (Page Nav)
- **Pointer travel**: Low-Medium (Page Nav at bottom)
- **Modal interruptions**: 0
- **Keyboard-only**: Low (page creation requires pointer)
- **Time**: 20-40 seconds
- **Discoverability**: Medium (Page Nav is visible)
- **Friction points**:
  - No "Duplicate Page" command
  - Copy-paste between pages is manual
  - No page templates
  - No page master/inheritance
  - Page reordering can be finicky

### Improvement Opportunities
- Add "Duplicate Page" in Page Nav context menu
- Add page templates/presets
- Add master pages for shared content
- Add keyboard shortcut for new page
- Add page thumbnails in Page Nav

---

## Workflow 10: Prototype or Animate an Interaction

### Current Steps
1. Create frames for each screen
2. Switch to Motion workspace (Ctrl+Shift+M)
3. Open Timeline panel
4. Select object to animate
5. Add keyframe via Timeline or Inspector
6. Move playhead to new time
7. Adjust property (position, opacity, etc.)
8. Keyframe auto-created if auto-keyframe enabled
9. Add interaction via Prototype panel
10. Set trigger (tap, drag, etc.)
11. Set destination frame
12. Set transition type/duration
13. Play prototype (Ctrl+Shift+P)

### Baseline Measurements
- **Clicks**: 20-40
- **Panel switches**: 3-4 (Timeline, Prototype, Inspector)
- **Pointer travel**: High (multiple panels)
- **Modal interruptions**: 0
- **Keyboard-only**: Low (timeline interaction requires pointer)
- **Time**: 45-90 seconds
- **Discoverability**: Low (motion/prototyping is advanced)
- **Friction points**:
  - Motion workspace separate from design
  - Timeline panel may be hidden
  - Keyframe creation not obvious
  - Prototype interactions separate from animation
  - No visual connection between screens
  - Easing curves hidden in Graph Editor

### Improvement Opportunities
- Add simple animation mode in Design workspace
- Add "Smart Animate" auto-transition
- Add visual connection lines between prototype screens
- Add interaction presets (tap, swipe, scroll)
- Simplify keyframe creation (click-to-add)
- Add easing presets in inline UI

---

## Workflow 11: Prepare a Print Document

### Current Steps
1. Switch to Print workspace (Ctrl+Shift+P)
2. Open Document Settings
3. Set document size (e.g., A4, Letter)
4. Set color mode (CMYK)
5. Set bleed/margin values
6. Enable facing pages if needed
7. Create master page for shared elements
8. Add page numbers, headers, footers
9. Check Preflight warnings in status bar
10. Fix any warnings
11. Export via File → Export
12. Select PDF/X preset
13. Verify output

### Baseline Measurements
- **Clicks**: 15-30
- **Panel switches**: 2-3 (Document Settings, Preflight)
- **Pointer travel**: Medium (menus → dialogs)
- **Modal interruptions**: 2 (Document Settings, Export)
- **Keyboard-only**: Low (print setup is UI-heavy)
- **Time**: 60-120 seconds
- **Discoverability**: Low (print workflow is specialized)
- **Friction points**:
  - Print workspace separate from design
  - CMYK conversion not automatic
  - Bleed/margin setup manual
  - Master pages hidden in menu
  - Preflight warnings reactive not proactive
  - Export presets not obvious

### Improvement Opportunities
- Add print setup wizard
- Add automatic CMYK preview
- Add bleed/margin guides on canvas
- Add master page panel
- Add proactive preflight checks
- Add print export presets

---

## Workflow 12: Export Raster, SVG, and PDF Output

### Current Steps
1. Select objects to export (or none for all)
2. File → Export (Ctrl+Shift+E)
3. Export dialog opens
4. Select format (PNG, SVG, PDF)
5. Select scale/resolution
6. Select destination folder
7. Click Export
8. For multiple formats: repeat steps 2-7
9. For batch export: use Export panel
10. Configure export settings per layer/selection

### Baseline Measurements
- **Clicks**: 8-20
- **Panel switches**: 1 (Export panel for batch)
- **Pointer travel**: Medium (menu → dialog)
- **Modal interruptions**: 1 (Export dialog)
- **Keyboard-only**: Low (export requires dialog)
- **Time**: 15-45 seconds
- **Discoverability**: Medium (Export in File menu)
- **Friction points**:
  - No quick export (1-click)
  - No export history/recent exports
  - No export presets
  - Batch export requires panel
  - No preview before export
  - Multi-format export is repetitive

### Improvement Opportunities
- Add quick export (Cmd/Ctrl+E) with last settings
- Add export presets (web, print, icons)
- Add export history panel
- Add export preview
- Add multi-format batch export
- Add slice-based export (like web design tools)

---

## Workflow 13: Save, Reopen, Recover, and Version a Project

### Current Steps
1. File → Save (Ctrl+S) or Save As (Ctrl+Shift+S)
2. Select location and filename
3. Click Save
4. To reopen: File → Open (Ctrl+O)
5. Select file
6. Click Open
7. Auto-save runs periodically
8. Recovery: Strata detects crash and offers recovery
9. Version history: View → Version History
10. Select previous version
11. Restore version

### Baseline Measurements
- **Clicks**: 5-15
- **Panel switches**: 0-1 (Version History panel)
- **Pointer travel**: Low (menu → file dialog)
- **Modal interruptions**: 1-2 (Save/Open dialogs)
- **Keyboard-only**: High (Ctrl+S/Ctrl+O work)
- **Time**: 5-15 seconds
- **Discoverability**: High (standard file operations)
- **Friction points**:
  - No auto-save indicator
  - No cloud sync options
  - Version history hidden in menu
  - No branching/version comments
  - Recovery not obvious until crash
  - No collaborative versioning

### Improvement Opportunities
- Add auto-save status indicator
- Add cloud save options
- Add version history panel with visual timeline
- Add version comments/branching
- Add manual snapshot (save point)
- Add collaborative versioning indicators

---

## Summary of High-Frequency Friction Points

### Top 10 Friction Points (by estimated impact)

1. **Panel switching overhead** - Users switch panels 3-5 times per complex task
2. **Modal interruptions** - Dialogs block canvas work (new doc, export, settings)
3. **Scattered properties** - Related controls in different inspector sections
4. **No quick presets** - Users manually repeat common configurations
5. **Hidden advanced features** - Components, variants, effects not discoverable
6. **No repeat operations** - Duplicate with offset, repeat transform missing
7. **Export is repetitive** - Multi-format export requires repeating workflow
8. **Typography controls scattered** - Font, size, spacing in different sections
9. **No visual previews** - Fonts, effects, components lack thumbnails
10. **Keyboard incomplete** - Many workflows require mouse despite shortcuts existing

### Cross-Cutting Issues

- **Context switching**: Moving between canvas, inspector, panels, menus
- **Discovery**: Advanced features hidden in menus or specialized panels
- **Repetition**: No "repeat last action" or "remember settings"
- **Feedback**: No visual cues for available actions (e.g., aspect ratio lock)
- **Presets**: Lack of style/effect/export presets forces manual configuration

### Positive Findings

- **Strong command architecture**: ActionRegistry provides solid foundation
- **Good shortcut coverage**: 90+ shortcuts, collision detection
- **Workspace system**: 5 workspaces provide task-appropriate layouts
- **Selection model**: Depth cycling, multi-select, modifiers work well
- **Tool system**: Spring-loaded tools, lifecycle management solid

---

## Next Steps

1. Prioritize improvements by frequency × impact × implementation risk
2. Implement high-impact, low-risk improvements first
3. Add workflow-specific E2E tests to measure before/after
4. Iterate based on user testing
5. Document improvements in this audit

---

## Implementation Priority Matrix

| Improvement | Frequency | Impact | Risk | Priority |
|-------------|----------|--------|------|----------|
| Quick export with last settings | High | High | Low | **P0** |
| Inline color picker (non-modal) | High | High | Low | **P0** |
| Group fill/stroke in single section | High | Medium | Low | **P0** |
| Add "Repeat Duplicate" command | High | High | Low | **P0** |
| Component creation button in inspector | Medium | High | Low | **P1** |
| Text style presets | Medium | High | Medium | **P1** |
| Effect presets | Medium | High | Medium | **P1** |
| Export presets | Medium | High | Low | **P1** |
| Visual font preview | Medium | Medium | Medium | **P2** |
| Bulk rename layers | Low | Medium | Low | **P2** |
| Layer search/filter | Low | Medium | Low | **P2** |
| Print setup wizard | Low | High | High | **P2** |
| Master page panel | Low | High | High | **P3** |
| Cloud save options | Low | High | High | **P3** |
