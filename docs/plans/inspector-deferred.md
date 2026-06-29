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
- `TokenBindIndicator` component: shows bound variable chip with name, unbindable
- Binding entry points: `=` shortcut, Shift+click on field, right-click "Apply variable"
- Requires `Binding`/`Expression` field on every node property in `@strata/scene/types.ts`
- Evaluate expressions through `VariableStore.resolve()` from `@strata/scene/variables.ts`
- Per-gradient-stop variable binding (Figma pattern)

### Align/Distribute bar
- Align left/center/right, top/middle/bottom buttons
- Distribute horizontal/vertical spacing
- Operates on multi-selection; uses existing `setSelectedX/Y` batch setters
- 6 icon buttons in a row above Position section

### Rotation dial + Flip H/V
- Rotation: NumberField with `deg` unit (0-360, wrap at boundaries)
- Flip H: negate transform[0]; Flip V: negate transform[3]
- Requires `setSelectedRotation`/`setSelectedFlip` context methods

### Per-corner radius UI + corner smoothing
- Expandable from uniform radius to per-corner (`[TL, TR, BR, BL]`)
- Inputs: 4x NumberField + link toggle (same pattern as W/H lock)
- Corner smoothing slider (Sketch-style continuous corners)

## P2 — appearance model extensions

### Multi-fill stacks + gradient stop editor
- Fill becomes `Fill[]` (stacked, reorderable)
- Types: solid, linear/radial/angular/diamond gradient, image, pattern
- Gradient stop editor: draggable stops on a slider, add/move/delete, per-stop color + position
- Requires `Fill` type from `@strata/scene/types.ts` to be wired into node model

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

| Slice | Effort | Value | Depends on |
|---|---|---|---|
| Align/Distribute bar | 2d | High | Nothing |
| Rotation + Flip | 1d | High | `setSelectedRotation` setter |
| Per-corner radius | 1d | Medium | `cornerRadius` field on ShapeNode rect |
| Token binding UI | 5d | High | `Binding` model extension |
| Fill stacks + gradient editor | 8d | High | `Fill` model extension |
| Grid tracks | 3d | Medium | Taffy grid support in strata-layout |
| Component slots | 3d | Medium | Component model (built, needs UI) |
| E2E tests | 3d | Medium | Playwright setup |
| axe-core | 1d | Low | Full feature completion |
| Yjs replication | 10d | Low | Phase 2 sync infrastructure |
