# Properties/Inspector Panel — Deferred Work

> **Status:** Deferred beyond MVP. These require scene model extensions, renderer work, or Phase 2 infrastructure.

## P0 — shipped (this session)
- Model extensions (Stroke, Effect, BlendMode, opacity, rotation)
- Transaction API (begin/commit/abort)
- PropertiesPanel orchestrator (empty/single/multi)
- PositionSize, Appearance, Fill, Layout, Stroke, Effects, Typography sections
- ColorPicker (SV pad, hue/alpha sliders, HEX/RGB/HSL, eyedropper, swatches, contrast)
- Proportion lock, session-persisted disclosure state
- Tests (46 inspector tests, 11 contrast tests)

## P1 — model-gated (need scene model extensions)

### Token/variable binding on every control
- [OK] `PropertyBinding` type + `bindings` field on NodeBase — **done**
- [OK] `TokenBindIndicator` component: shows bound variable chip with name, unbindable — **done**
- [OK] `BindingMenu` component: searchable variable picker popover with expression input — **done**
- [OK] `setSelectedBinding` context method — **done**
- [OK] `resolveBinding()` in variables.ts — **done**
- [ ] Binding entry points: `=` shortcut, Shift+click on field, right-click "Apply variable"
- [ ] Per-gradient-stop variable binding (Figma pattern)

### Align/Distribute bar
- [OK] Align left/center/right, top/middle/bottom buttons — **done**
- [OK] Distribute horizontal/vertical spacing — **done**
- [OK] `alignSelected`/`distributeSelected` context methods — **done**
- [OK] 8 icon buttons in AlignDistributeBar — **done**
- [ ] Keyboard shortcuts for align/distribute actions

### Rotation dial + Flip H/V
- [OK] Rotation NumberField with `deg` unit in PositionSizeSection — **done**
- [OK] Flip H/V buttons (negate transform[0]/transform[3]) — **done**
- [OK] `setSelectedFlipH`/`setSelectedFlipV` context methods — **done**

### Per-corner radius UI + corner smoothing
- [OK] Uniform/per-corner radius with mode toggle — **done**
- [OK] 4x NumberField (TL/TR/BR/BL) + link toggle — **done**
- [OK] `setSelectedCornerRadius` context method — **done**
- [ ] Corner smoothing slider (Sketch-style continuous corners)

## P2 — appearance model extensions

### Multi-fill stacks + gradient stop editor
- Fill becomes `Fill[]` (stacked, reorderable)
- Types: solid, linear/radial/angular/diamond gradient, image, pattern
- Gradient stop editor: draggable stops on a slider, add/move/delete, per-stop color + position
- Requires `Fill` type from `@varve/scene/types.ts` to be wired into node model

### Gradient stop interaction on canvas
- On-canvas gradient annotation handles (Figma/Sketch style)
- Stop positions map live to shape bounds

## P3 — layout depth

### Grid track definitions
- `gridTemplateColumns`/`gridTemplateRows`: `fr`, fixed, `minmax`, `auto` controls
- Per-child grid placement (column/row start/end)
- Requires `LayoutStyle` extension + Taffy grid support

### `clamp()` fluid sizing + breakpoint binding
- Min/preferred/max size controls per axis
- Breakpoint-aware layout properties
- Overlap validation surfaced inline

## P4 — component/instance section

### Slot fill controls
- Expose slot content UI from `ComponentDefinition.slots` in Inspector
- Fill slot from node picker (drag from layers or selector)
- Swap instance component, reset overrides, detach
- Show which props are overridden vs inherited

## P5 — quality & infrastructure

### E2E Playwright edit→canvas tests
- Add/edit position/size from Inspector → verify canvas IR output
- Color picker → fill changes → canvas renders correctly
- Multi-select batch edits
- Requires Playwright dev server running

### axe-core scan — 0 violations
- Run `@axe-core/playwright` on the Inspector panel
- Fix any APG pattern violations discovered
- Required by AGENTS.md Cascade Review gate

### Yjs CRDT replication
- `beginTransaction`/`commitTransaction` hooks wired to Yjs awareness
- All Inspector edits replicate over Yjs
- Concurrent edit conflict indicators
- Phase 2 infra (yrs crate, collab provider)

## Delivery order (suggested)

| Slice | Effort | Value | Status |
|---|---|---|---|
| Align/Distribute bar | 2d | High | [OK] Done |
| Rotation + Flip | 1d | High | [OK] Done |
| Per-corner radius | 1d | Medium | [OK] Done |
| Token binding UI (model + components) | 5d | High | [OK] Done |
| Fill stacks + gradient editor | 6d | High | Needs `fills: Fill[]` wired to node model |
| Grid tracks | 3d | Medium | Needs Taffy grid support in strata-layout |
| Component slots UI | 2d | Medium | Component model built, needs Inspector UI |
| Clipboard/Duplicate/Z-order | 3d | Medium | Needs context methods + toolbar buttons |
| Corner smoothing slider | 0.5d | Low | Stretch from per-corner radius |
| Binding entry points (shortcuts) | 1d | Medium | UX polish for token binding |
| E2E tests | 3d | Medium | Playwright configured |
| axe-core | 1d | Low | Full feature completion |
| Yjs replication | 10d | Low | Phase 2 sync infrastructure |
