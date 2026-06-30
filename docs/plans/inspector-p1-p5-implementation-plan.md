# Inspector Panel P1-P5 Implementation Plan

> **Status:** Planning phase. This document outlines the complete implementation strategy for P1 through P5 items from the inspector-deferred.md plan.
>
> **Estimated effort:** P1 (1-2 days), P2 (5-6 days), P3 (3-4 days), P4 (2-3 days), P5 (3-4 days)
> **Total:** ~14-19 days

---

## Current State Assessment

### Already Complete (P0)
- Model extensions (Stroke, Effect, BlendMode, opacity, rotation)
- Transaction API (begin/commit/abort)
- PropertiesPanel orchestrator
- PositionSize, Appearance, Fill, Layout, Stroke, Effects, Typography sections
- ColorPicker with full accessibility
- Proportion lock, session-persisted disclosure state
- 46 inspector tests, 11 contrast tests

### Partially Complete (P1)
- **Corner smoothing slider:** Done (CornerRadiusSection.tsx lines 154-180)
- **Binding entry points:** Partial
  - PositionSizeSection: Shift+click on x, y, width, height, rotation
  - CornerRadiusSection: Shift+click on cornerRadius
  - FillSection: Not implemented
  - Global `=` shortcut: Not implemented
  - Right-click context menu: Not implemented
- **Keyboard shortcuts for align/distribute:** Not implemented

### Scene Model Readiness
- **Fill type:** Defined in types.ts (lines 103-118) with GradientFill support
- **LayoutStyle:** Defined in types.ts (lines 204-216) with flex support
- **ComponentDefinition:** Defined with Slot[] support
- **Rust LayoutStyle:** Defined in strata-layout with Taffy integration

### Infrastructure Readiness
- **Playwright:** Installed and configured (playwright.config.ts)
- **axe-core:** Installed and configured (@axe-core/playwright)
- **E2E tests:** 21 tests exist for home/layers panels
- **Yjs:** Not installed (Phase 2 task 2.1 dependency)

---

## P1 — Complete Token Binding Entry Points & Align/Distribute Shortcuts

### 1.1 Keyboard Shortcuts for Align/Distribute

**Files to modify:**
- `packages/editor/src/shortcuts/ShortcutManager.ts`
- `packages/editor/src/shortcuts/useShortcuts.ts`

**Implementation:**

Add 8 shortcut definitions to `SHORTCUT_DEFS`:
```typescript
alignLeft: { binding: { key: 'ArrowLeft', ctrl: true, shift: true }, label: 'Align left', category: 'Object' },
alignCenterH: { binding: { key: 'Home', ctrl: true, shift: true }, label: 'Align horizontal center', category: 'Object' },
alignRight: { binding: { key: 'ArrowRight', ctrl: true, shift: true }, label: 'Align right', category: 'Object' },
alignTop: { binding: { key: 'ArrowUp', ctrl: true, shift: true }, label: 'Align top', category: 'Object' },
alignCenterV: { binding: { key: 'PageUp', ctrl: true, shift: true }, label: 'Align vertical center', category: 'Object' },
alignBottom: { binding: { key: 'ArrowDown', ctrl: true, shift: true }, label: 'Align bottom', category: 'Object' },
distributeHorizontal: { binding: { key: 'h', ctrl: true, alt: true }, label: 'Distribute horizontally', category: 'Object' },
distributeVertical: { binding: { key: 'v', ctrl: true, alt: true }, label: 'Distribute vertically', category: 'Object' },
```

Add handlers in `useShortcuts.ts` `getHandler` switch:
```typescript
case 'alignLeft':
  return () => e.alignSelected('left');
case 'alignCenterH':
  return () => e.alignSelected('centerH');
case 'alignRight':
  return () => e.alignSelected('right');
case 'alignTop':
  return () => e.alignSelected('top');
case 'alignCenterV':
  return () => e.alignSelected('centerV');
case 'alignBottom':
  return () => e.alignSelected('bottom');
case 'distributeHorizontal':
  return () => e.distributeSelected('horizontal');
case 'distributeVertical':
  return () => e.distributeSelected('vertical');
```

**Shortcut rationale:**
- Arrow keys with Ctrl+Shift align to edges (intuitive directional mapping)
- Home/PageUp for center alignment (standard text navigation keys)
- Ctrl+Alt+H/V for distribute (mnemonic: Horizontal/Vertical)
- Mac uses Cmd instead of Ctrl (handled by isMac() in ShortcutManager)

**Alternative if arrow keys conflict:**
- Use letter combinations: Ctrl+Shift+L/C/R (horizontal), Ctrl+Shift+T/M/B (vertical)
- Use function keys: F6-F9 for alignment, F10-F11 for distribute

### 1.2 FillSection Binding Entry Point

**Files to modify:**
- `packages/editor/src/components/Inspector/sections/FillSection.tsx`

**Implementation:**

Add state and ref for binding menu:
```typescript
const bindingTriggerRef = useRef<HTMLDivElement>(null);
```

Add Shift+click handler to color swatch:
```typescript
onClick={(e) => {
  if (e.shiftKey) {
    editor.setBindingField('fill');
    e.stopPropagation();
  } else {
    toggleOpen();
  }
}}
```

Add BindingMenu component:
```typescript
{editor.bindingField === 'fill' && (
  <BindingMenu
    variableStore={editor.state.variableStore}
    targetType="color"
    onBind={(variableId, expression) => {
      editor.setSelectedBinding('fill', { variableId, expression });
      editor.setBindingField(null);
    }}
    onClose={() => editor.setBindingField(null)}
    triggerRef={bindingTriggerRef}
  />
)}
```

### 1.3 Global `=` Shortcut

**Files to modify:**
- `packages/editor/src/shortcuts/useShortcuts.ts`
- `packages/editor/src/context.tsx` (add focusedField state)

**Implementation:**

Add to context state:
```typescript
const [focusedField, setFocusedField] = useState<string | null>(null);
```

Add to context interface:
```typescript
focusedField: string | null;
setFocusedField: (field: string | null) => void;
```

Add shortcut definition:
```typescript
bindField: { binding: { key: '=' }, label: 'Bind field', category: 'Object' },
```

Add handler:
```typescript
case 'bindField':
  return () => {
    if (e.focusedField) {
      e.setBindingField(e.focusedField);
    }
  };
```

Update NumberField to call `setFocusedField` on focus:
```typescript
onFocus={() => editor.setFocusedField(fieldName)}
onBlur={() => editor.setFocusedField(null)}
```

**Alternative approach:** Right-click context menu with "Apply variable" option (more discoverable, less keyboard-centric).

### 1.4 Verification

Run quality gates:
```bash
just test          # All tests pass
just lint          # 0 warnings/errors
pnpm typecheck     # Type safety
pnpm audit:emoji   # 0 emoji violations
pnpm audit:tokens  # 51/51 WCAG AA pairs
```

---

## P2 — Multi-Fill Stacks & Gradient Editor

### 2.1 Scene Model Extension

**Files to modify:**
- `packages/scene/src/types.ts`
- `crates/strata-engine/src/lib.rs` (Rust mirror)

**Implementation:**

Change `NodeBase.fill` from `Color` to `Fill[]`:
```typescript
export interface NodeBase {
  // ... existing fields
  /** F6: stacked fills (solid, gradient, image, pattern). Paint order: last = top. */
  fills: Fill[];
}
```

Add migration function for backward compatibility:
```typescript
export function migrateFillToStacks(node: NodeBase): NodeBase {
  if ('fill' in node && typeof (node as any).fill === 'object') {
    const color = (node as any).fill as Color;
    return {
      ...node,
      fills: [{ type: 'solid', color, opacity: 1, blendMode: 'normal', visible: true }],
      // @ts-expect-error - remove old field after migration
      fill: undefined,
    };
  }
  return node;
}
```

Update all document operations to use `fills` instead of `fill`.

**Rust mirror update:**
- Update NodeBase struct in strata-engine to use `Vec<Fill>` instead of `Color`
- Update serialization/deserialization
- Add migration logic in load_document

### 2.2 FillStackSection Component

**Files to create:**
- `packages/editor/src/components/Inspector/sections/FillStackSection.tsx`

**Implementation:**

Create a section that:
- Lists all fills in a stack (virtualized if > 10 fills)
- Each fill row shows: type icon, preview swatch, blend mode, opacity, visibility toggle
- Drag handles for reordering (@dnd-kit sortable)
- Add button (+) to add new fill (type selector dropdown)
- Remove button (-) on each fill
- Click on fill row to expand into detailed editor

**UI structure:**
```tsx
<DisclosureSection title="Fill">
  <FillList>
    {fills.map((fill, idx) => (
      <FillRow key={idx}>
        <DragHandle />
        <FillPreview fill={fill} />
        <BlendModeSelect value={fill.blendMode} onChange={...} />
        <OpacitySlider value={fill.opacity} onChange={...} />
        <VisibilityToggle visible={fill.visible} onChange={...} />
        <RemoveButton onClick={() => removeFill(idx)} />
      </FillRow>
    ))}
  </FillList>
  <AddFillButton onClick={showAddFillMenu} />
</DisclosureSection>
```

### 2.3 Gradient Stop Editor

**Files to create:**
- `packages/editor/src/components/Inspector/controls/GradientStopEditor.tsx`

**Implementation:**

Create an interactive gradient editor:
- Visual gradient bar showing all stops
- Draggable stop handles (mouse/touch)
- Click on bar to add new stop
- Double-click stop to remove
- Each stop has: position slider, color picker, delete button
- Gradient type selector (linear/radial/angular/diamond)
- Rotation angle control (for linear/angular)

**Interaction model:**
- Mouse down on stop handle → start drag
- Mouse move → update stop position (0-1 range)
- Mouse up → commit change (transaction)
- Click on bar → add stop at clicked position
- Right-click on stop → context menu (delete, duplicate)

**Accessibility:**
- Keyboard navigation: Tab to navigate stops, Arrow keys to adjust position
- ARIA live announcements for stop changes
- High-contrast mode support

### 2.4 Engine IR Extension

**Files to modify:**
- `packages/engine/src/engine.ts` (shapeToPrimitive)
- `packages/engine/src/replay.ts` (render gradient)

**Implementation:**

Add gradient to Primitive enum:
```typescript
export type Primitive =
  | { kind: 'rect'; ... }
  | { kind: 'ellipse'; ... }
  | { kind: 'circle'; ... }
  | { kind: 'line'; ... }
  | { kind: 'path'; ... }
  | { kind: 'gradient'; fill: GradientFill; bounds: Rect; transform: Affine };
```

Implement gradient rendering in replayIr:
- Linear gradient: canvas.createLinearGradient
- Radial gradient: canvas.createRadialGradient
- Angular/diamond: approximate with multiple radial stops or use path-based rendering
- Apply blend mode and opacity

**Rust engine:**
- Add gradient rendering to strata-engine using tiny-skia gradient API
- Ensure parity with canvas2D implementation

### 2.5 Verification

Add tests:
- FillStackSection component tests
- GradientStopEditor interaction tests
- Engine gradient rendering tests
- Multi-fill composition tests
- Backward compatibility migration tests

Run quality gates.

---

## P3 — Layout Depth (Grid Tracks & Clamp Sizing)

### 3.1 LayoutStyle Extension

**Files to modify:**
- `packages/scene/src/types.ts` (LayoutStyle interface)
- `crates/strata-layout/src/lib.rs` (LayoutStyle struct)

**Implementation:**

Add grid template properties:
```typescript
export interface LayoutStyle {
  // ... existing flex properties
  /** Grid template columns (e.g., "1fr 200px 1fr", "repeat(3, 1fr)"). */
  gridTemplateColumns?: string;
  /** Grid template rows (e.g., "auto 1fr auto"). */
  gridTemplateRows?: string;
  /** Grid column start/end for children (1-based). */
  gridColumn?: [number, number];
  /** Grid row start/end for children. */
  gridRow?: [number, number];
}
```

Add clamp sizing to NodeBase:
```typescript
export interface NodeBase {
  // ... existing fields
  /** F6: min/preferred/max width for clamp sizing. */
  minWidth?: number;
  preferredWidth?: number;  // maps to width
  maxWidth?: number;
  /** F6: min/preferred/max height for clamp sizing. */
  minHeight?: number;
  preferredHeight?: number;  // maps to height
  maxHeight?: number;
}
```

**Rust implementation:**
- Extend LayoutStyle struct with grid template fields
- Add grid support to Taffy style conversion
- Implement clamp sizing in layout computation

### 3.2 Grid Track Controls

**Files to modify:**
- `packages/editor/src/components/Inspector/sections/LayoutSection.tsx`

**Implementation:**

Add grid track editor to LayoutSection:
- Grid mode selector (flex vs grid)
- Template columns input (text field with syntax validation)
- Template rows input
- Preset buttons: "2 columns", "3 columns", "sidebar layout"
- Visual grid preview (mini representation of track structure)

**Syntax parsing:**
- Parse "1fr 200px 1fr" into array of track definitions
- Validate against Taffy grid syntax
- Show error messages for invalid syntax
- Autocomplete suggestions

### 3.3 Clamp Sizing Controls

**Files to modify:**
- `packages/editor/src/components/Inspector/sections/PositionSizeSection.tsx`

**Implementation:**

Add clamp sizing UI:
- Three NumberFields for each axis: min, preferred, max
- Link toggle to constrain min/max relationship
- Visual indicator when width/height is outside clamp range
- Breakpoint-aware controls (if breakpoints are defined)

**Interaction:**
- Drag on preferred width/height adjusts within clamp bounds
- Clamp bounds shown as subtle guides on canvas
- Warning when content overflows clamp bounds

### 3.4 Rust Taffy Grid Support

**Files to modify:**
- `crates/strata-layout/src/lib.rs`

**Implementation:**

Extend Taffy integration:
- Add grid template parsing (convert string to Taffy GridTrack)
- Implement grid placement for children
- Add grid-specific style properties (grid-area, grid-column, grid-row)
- Tests: basic 2-column layout, auto-fit, minmax

### 3.5 Verification

Add tests:
- Grid track parsing tests
- Clamp sizing layout tests
- Taffy grid integration tests
- UI component tests

Run quality gates.

---

## P4 — Component/Instance Section

### 4.1 ComponentSection Component

**Files to create:**
- `packages/editor/src/components/Inspector/sections/ComponentSection.tsx`

**Implementation:**

Create a section that shows when a FrameNode is a component instance:
- Component name and thumbnail
- "Swap component" button (opens component picker)
- "Reset overrides" button (clears all instance overrides)
- "Detach instance" button (converts to regular frame)
- Override indicator (count of overridden properties)

**Conditional rendering:**
- Only show for FrameNode with componentId
- Show different state for master frame vs instance

### 4.2 Slot Fill Controls

**Files to modify:**
- `packages/editor/src/components/Inspector/sections/ComponentSection.tsx`

**Implementation:**

Add slot fill UI:
- List all slots from ComponentDefinition
- Each slot shows: name, kind, current fill (node name or "Empty")
- Fill button: opens node picker (layers panel or selector dialog)
- Drag-and-drop from layers to slot
- Visual indicator when slot is filled

**Node picker:**
- Modal dialog showing available nodes
- Filter by type (single/multiple/text matching slot kind)
- Search/filter by name
- Preview thumbnail for each node

### 4.3 Override Tracking

**Files to modify:**
- `packages/scene/src/types.ts` (add override tracking)
- `packages/editor/src/context.tsx` (override detection logic)

**Implementation:**

Add override detection:
- Compare instance props against component master
- Track which properties are overridden
- Show visual indicator (dot or badge) on overridden fields
- "Reset overrides" clears all tracked overrides

**Override storage:**
Option 1: Store overrides as separate fields on instance
Option 2: Store diff from master in ComponentInstance metadata

### 4.4 Verification

Add tests:
- ComponentSection component tests
- Slot fill interaction tests
- Override detection/reset tests
- Instance swap/detach tests

Run quality gates.

---

## P5 — Quality & Infrastructure

### 5.1 E2E Playwright Tests

**Files to create:**
- `tests/e2e/inspector/position-size.spec.ts`
- `tests/e2e/inspector/fill.spec.ts`
- `tests/e2e/inspector/layout.spec.ts`

**Implementation:**

Create E2E tests for Inspector → Canvas flow:
```typescript
test('edit position from Inspector updates canvas', async ({ page }) => {
  await page.goto('/');
  // Create rectangle
  // Select it
  // Edit x position in Inspector
  // Verify canvas IR reflects change
  // Verify visual position on canvas
});

test('color picker changes fill', async ({ page }) => {
  // Open color picker
  // Change color
  // Verify fill updates in document
  // Verify canvas renders new color
});

test('multi-select batch edits', async ({ page }) => {
  // Create multiple shapes
  // Select all
  // Edit fill in Inspector
  // Verify all shapes updated
});
```

**Test organization:**
- Separate spec files per Inspector section
- Use test.describe for grouping
- Reusable helper functions for common actions (createShape, selectShape, etc.)

### 5.2 axe-core Scan

**Files to create:**
- `tests/e2e/inspector/axe.spec.ts`

**Implementation:**

Run axe-core scan on Inspector panel:
```typescript
test('Inspector panel has no accessibility violations', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.inspector-panel');

  const results = await new AxeBuilder({ page })
    .include('.inspector-panel')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  expect(results.violations).toEqual([]);
});
```

**Common violations to check:**
- Missing labels on inputs
- Insufficient color contrast
- Keyboard navigation issues
- ARIA role violations
- Focus management

### 5.3 Yjs Replication Hooks

**Note:** This depends on Phase 2 task 2.1 (Yjs/SQLite CRDT Sync). Mark as blocked until Phase 2 completes.

**Files to modify:**
- `packages/editor/src/context.tsx` (transaction hooks)
- `packages/collab/src/yjs-adapter.ts` (new package)

**Implementation:**

Wire transaction API to Yjs:
- Wrap beginTransaction with Yjs transaction start
- Wrap commitTransaction with Yjs transaction commit
- Wrap abortTransaction with Yjs transaction abort
- Ensure all Inspector edits flow through transaction API
- Add conflict resolution UI for concurrent edits

**Deferred until:** Phase 2 task 2.1 completes

### 5.4 Verification

Run all quality gates:
```bash
just test          # Rust + JS tests
just lint          # Cargo clippy + Biome
pnpm typecheck     # TypeScript
pnpm audit:emoji   # Zero emoji
pnpm audit:tokens  # WCAG AA
pnpm test:e2e      # Playwright E2E tests
```

---

## Execution Order & Dependencies

### Critical Path
1. **P1** (1-2 days) - No dependencies, can start immediately
2. **P2** (5-6 days) - Depends on P1 completion (scene model changes)
3. **P3** (3-4 days) - Depends on P2 (scene model stable), can parallel with P4
4. **P4** (2-3 days) - No dependencies on P2/P3, can parallel
5. **P5** (3-4 days) - Depends on P1-P4 completion, except Yjs (blocked on Phase 2)

### Parallelization Strategy
- **P1** → sequential (quick, no conflicts)
- **P2 + P4** → parallel (different areas: appearance vs components)
- **P3** → after P2 (depends on scene model changes from P2)
- **P5** → after P1-P4 (verification requires features complete)

### Risk Mitigation
- **Scene model changes (P2):** High risk - affects entire codebase. Use migration function for backward compatibility. Test thoroughly before committing.
- **Gradient rendering (P2):** Medium risk - requires engine changes. Implement in both canvas2D and Rust engine to ensure parity.
- **Grid layout (P3):** Medium risk - Taffy grid support may have limitations. Research Taffy grid capabilities in advance.
- **E2E tests (P5):** Low risk - infrastructure already exists. Follow existing test patterns.

---

## Success Criteria

### P1 Success
- [ ] All 8 align/distribute shortcuts work (keyboard triggers context methods)
- [ ] FillSection has Shift+click binding entry point
- [ ] Global `=` shortcut opens binding menu for focused field
- [ ] All quality gates pass

### P2 Success
- [ ] Scene model uses `fills: Fill[]` instead of single `fill`
- [ ] FillStackSection renders and allows add/remove/reorder
- [ ] GradientStopEditor allows interactive stop manipulation
- [ ] Engine renders gradients correctly in both canvas2D and Rust
- [ ] Backward compatibility maintained (old documents load correctly)
- [ ] All quality gates pass

### P3 Success
- [ ] LayoutStyle includes grid template properties
- [ ] LayoutSection has grid track editor with syntax validation
- [ ] PositionSizeSection has clamp sizing controls
- [ ] Rust strata-layout supports grid layout
- [ ] All quality gates pass

### P4 Success
- [ ] ComponentSection shows for component instances
- [ ] Slot fill controls allow picking nodes from layers
- [ ] Override detection and reset works correctly
- [ ] Instance swap/detach functions correctly
- [ ] All quality gates pass

### P5 Success
- [ ] E2E tests cover Inspector → Canvas flow (position, fill, multi-select)
- [ ] axe-core scan shows 0 violations on Inspector panel
- [ ] Transaction API wired to Yjs (blocked on Phase 2)
- [ ] All quality gates pass

---

## Notes & Open Questions

1. **Shortcut conflicts:** Arrow key shortcuts for align/distribute may conflict with browser text selection. Consider using function keys or letter combinations instead.

2. **Fill stack performance:** With many fills (10+), rendering may slow down. Consider:
   - Virtualization in FillStackSection
   - Caching gradient rendering
   - Lazy rendering of off-screen fills

3. **Grid syntax complexity:** CSS grid syntax is powerful but complex. Consider:
   - Simplified preset-based UI for common patterns
   - Advanced mode for custom syntax
   - Visual grid builder instead of text input

4. **Yjs dependency:** P5 Yjs replication is blocked on Phase 2. Consider:
   - Implementing transaction hooks now without Yjs (prepare infrastructure)
   - Marking as explicitly blocked in plan
   - Moving to Phase 2 plan instead

5. **Testing strategy:** E2E tests require dev server running. Consider:
   - CI/CD pipeline configuration
   - Headless mode for CI
   - Test data fixtures for consistent state

---

## Next Steps

1. **Review this plan** with the user to confirm approach and priorities
2. **Start with P1** (quick wins, no dependencies)
3. **Create git worktree** for each priority area to enable parallel work
4. **Follow AGENTS.md multi-agent coordination** protocol for parallel P2/P4
5. **Run quality gates** after each priority area completes
