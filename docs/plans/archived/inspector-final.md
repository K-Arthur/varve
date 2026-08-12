# Inspector Panel — Final Implementation Plan

> **Goal:** Complete ALL remaining deferred inspector items in one session. No further deferrals.
> **Total estimated effort:** 22–28 days, parallelizable into 4 tracks.

---

## Completed so far (P0–P1)

| Area | Status |
|---|---|
| PositionSize, Appearance, Fill, Layout, Stroke, Effects, Typography sections | [OK] |
| ColorPicker (SV pad, hue/alpha, HEX/RGB/HSL, eyedropper, swatches, contrast) | [OK] |
| Transaction API (begin/commit/abort) | [OK] |
| Proportion lock, session-persisted disclosure | [OK] |
| Align/Distribute toolbar (8 buttons) | [OK] |
| Rotation dial + Flip H/V | [OK] |
| Per-corner radius (uniform/per-corner toggle) | [OK] |
| Token binding model (PropertyBinding, bindings on NodeBase) | [OK] |
| TokenBindIndicator + BindingMenu components | [OK] |
| Context methods: alignSelected, distributeSelected, setSelectedFlipH/V, setSelectedCornerRadius, setSelectedBinding | [OK] |
| 46 inspector tests + 11 contrast tests | [OK] |

---

## Track A — Fill stacks + gradient editor (P2)

**Effort: 8d · Depends on: nothing · Highest value**

### A1 — Model: `fills: Fill[]` on all nodes

`packages/scene/src/types.ts`:
- Add `fills?: Fill[]` to NodeBase (keep `fill: Color` for backward compat)
- Default: when `fills` is undefined/null, auto-create `[{ type:'solid', color: fill, opacity:1, blendMode:'normal', visible:true }]`
- Update `makeShapeNode`, `makeTextNode`, `makeFrameNode`, `makeGroupNode` factories

`packages/scene/src/document.ts`:
- Add `setFill(id, fills: Fill[])` mutation (replaces doc.nodes[id].fills)
- Add `addFill(id, fill: Fill)` — appends to fills array
- Add `removeFill(id, index: number)` — splices
- Add `reorderFill(id, from, to)` — moves
- Add `migrateDocument(doc)` — ensures all nodes have fills set from fill field

### A2 — Engine: multi-fill rendering

`packages/engine/src/types.ts`:
- Add `fills?: Fill[]` to `RenderItem` (optional, `fill: Color` stays as fallback)

`packages/engine/src/replay.ts`:
- In `replayIr`, when `fills` is present: iterate fills array, composite each
- For solid fills: `srcOver` compositing (alpha blending)
- For gradients: linear/radial gradient fills via `createLinearGradient`/`createRadialGradient`
- For images: existing image cache code
- Keep single `fill` path as fallback when `fills` is absent

`crates/strata-engine/src/lib.rs`:
- Add `fills: Vec<Fill>` to `RenderItem` (JSON: `#[serde(default, skip_serializing_if = "Vec::is_empty")]`)
- Update `build_render_ir` to forward fills

### A3 — UI: stacked fill list

`packages/editor/src/components/Inspector/sections/FillSection.tsx`:
- Rewrite: show horizontal swatch strip of all fills (click to select active fill)
- Add/Remove fill buttons (+ / −)
- Drag handles for reorder (simplified: up/down arrow buttons)
- Active fill shows expanded editor below:
  - Type selector: solid | linear | radial | angular | diamond
  - For **solid**: existing ColorPicker popover
  - For **gradient**: show GradientEditor inline
  - Opacity slider (0–1), Blend mode dropdown, Visibility toggle per fill
- Multi-select: show only common fills, Mixed indicator

`packages/editor/src/components/Inspector/sections/GradientEditor.tsx`:
- PREVIOUSLY NOT EXISTING. NEW component.
- Gradient type selector (linear/radial/angular/diamond)
- Rotation NumberField for linear/radial (deg)
- Gradient stop strip: CSS gradient preview bar, draggable stop handles
- Add stop: click on empty area of strip (inserts at click position)
- Remove stop: drag off strip or right-click → delete (min 2 stops)
- Per-stop editor when selected: position NumberField (0–100%) + color swatch → ColorPicker
- Multi-stop gradient interpolation preview (updates live)

`packages/editor/src/components/Inspector/controls/GradientStopSlider.tsx`:
- NEW component. Interactive canvas-based strip.
- Renders the gradient as CSS `linear-gradient(...)` background
- Draggable circular stop handles with pointer capture
- Snap to nearest 5% on release
- Accessible: ArrowLeft/Right adjust position ±1%, Tab between stops, role="slider" per stop

### A4 — Tests

`packages/editor/src/components/Inspector/sections/fillStacks.test.tsx`:
- Fill add/remove/reorder
- Fill type changes (solid <-> gradient)
- Gradient stop add/move/delete
- Per-stop color changes
- Multi-fill composite rendering
- Mixed fill indicators
- Opacity/blend per fill

---

## Track B — Grid tracks + fluid sizing (P3)

**Effort: 4d · Depends on: strata-layout Rust changes · Medium value**

### B1 — Rust: Taffy grid wiring

`crates/strata-layout/src/lib.rs`:
- In `to_taffy_style()`: when mode is Grid, set `display: Display::Grid`
- Add `grid_template_columns: Vec<TrackSize>` and `grid_template_rows: Vec<TrackSize>` to Rust `LayoutStyle`
- TrackSize enum: `Fixed(f64) | Fr(f64) | Percent(f64) | Auto | MinMax { min: TrackSize, max: TrackSize }`
- Pass tracks to Taffy's `Style::grid_template_columns`/`grid_template_rows` (Taffy 0.11 API: `Vec<NonRepeatedTrackSizingFunction>`)
- Add per-child `grid_column: (u16, u16)` and `grid_row: (u16, u16)` (start/end) — store on `SceneNode` or a separate placement map

### B2 — TS model extension

`packages/scene/src/types.ts`:
- Add `gridTemplateColumns?: GridTrack[]` and `gridTemplateRows?: GridTrack[]` to `LayoutStyle`
- Type `GridTrack = { value: number; unit: 'px' | 'fr' | '%' | 'auto' | 'minmax'; min?: number; max?: number }`
- Add `gridColumn?: { start: number; end: number }` and `gridRow?: { start: number; end: number }` to `NodeBase`

`packages/scene/src/document.ts`:
- Add `setNodeGridPlacement(id, column?, row?)` mutation

### B3 — Grid track UI

`packages/editor/src/components/Inspector/sections/LayoutSection.tsx`:
- When mode='grid': show template editors instead of flex controls
- Grid columns editor: list of track inputs. Each track: value NumberField + unit SegmentedControl (px/fr/%/auto/minmax)
- Add track button (+), remove track button (−)
- Grid rows editor: same pattern

`packages/editor/src/components/Inspector/sections/GridChildSection.tsx`:
- NEW section. Shown when a child of a grid frame is selected.
- Grid column start/end NumberField pair
- Grid row start/end NumberField pair
- Auto placement toggle

### B4 — `clamp()` fluid sizing (stretch)

`packages/scene/src/types.ts`:
- Add `minWidth?`, `maxWidth?`, `minHeight?`, `maxHeight?` to LayoutStyle (or NodeBase, depending on scope)

`packages/editor/src/components/Inspector/sections/PositionSizeSection.tsx`:
- When Layout mode is set: show min/max width/height fields below W/H
- NumberField triplets: Min / Value / Max per axis with clamp validation
- Overlap validation: warn if min > max

### B5 — Tests

- Layout section grid mode rendering
- Track add/remove/update
- Track unit switching
- Per-child grid placement
- Clamp validation (min ≤ value ≤ max)

---

## Track C — Component slots + binding UX (P1 + P4)

**Effort: 3d · Depends on: Component model already built · Medium value**

### C1 — ComponentSection UI

`packages/editor/src/components/Inspector/sections/ComponentSection.tsx`:
- NEW component. Shown when `node.kind === 'frame' && node.componentId`
- Header: component name from `doc.components[componentId].name`
- Slot list: each slot in `def.slots` rendered with:
  - Slot name + kind badge (single/multiple/text)
  - Current fill node name (resolved from `node.slots[slotId]`) or "Empty"
  - "Fill" button → opens node picker (inline tree or dropdown)
  - "Clear" button → sets slot fill to undefined
- "Detach instance" button → calls `detachSelected()`
- "Swap component" dropdown → list of all registered components
- "Reset overrides" button → calls `propagateMaster`

`packages/editor/src/context.tsx`:
- Add `swapInstanceComponent(instanceId, newComponentId)` — replaces `componentId`, re-resolves slots
- Add `resetInstanceOverrides(instanceId)` — re-applies `propagateMaster` to reset overrides

`packages/editor/src/components/Inspector/PropertiesPanel.tsx`:
- Import and render `<ComponentSection />` after Layout section for frame instances

### C2 — Binding entry points

`packages/editor/src/context.tsx`:
- The `setSelectedBinding` method already exists. Need to wire it to UI entry points.

`packages/editor/src/components/Inspector/sections/PositionSizeSection.tsx`:
- Each NumberField: add `onBind` prop → opens BindingMenu when triggered
- Trigger: `=` key while field is focused (KeyboardEvent listener)
- Trigger: Shift+click on field label
- Trigger: right-click → context menu with "Bind variable" option
- When bound: show TokenBindIndicator chip replacing the editable NumberField

`packages/editor/src/components/Inspector/sections/FillSection.tsx`:
- Same binding entry points on the color swatch
- Right-click fill swatch → "Bind variable" option → BindingMenu filtered by color type

`packages/editor/src/components/Inspector/controls/NumberField.tsx`:
- Add optional `bindable` prop (default false)
- When bindable and a binding is active: show value read-only with TokenBindIndicator
- `=` key listener to open BindingMenu
- Highlight bound fields with subtle accent border

`packages/editor/src/components/Inspector/controls/BindingMenu.tsx`:
- Already built. Add `=` key shortcut to focus the search input when menu opens.
- Add keyboard navigation: ↑↓ to move through list, Enter to select, Escape to close.

### C3 — Corner smoothing slider

`packages/editor/src/components/Inspector/sections/CornerRadiusSection.tsx`:
- Add corner smoothing slider below radius controls
- Slider range: 0–100 (continuous corner smoothing, Sketch-style)
- Only for rect shapes with cornerRadius > 0
- Needs `cornerSmoothing` field on ShapeNode — but this may require engine changes.
- For MVP: store as `cornerSmoothing?: number` on ShapeNode, pass to Rust later

`packages/scene/src/types.ts`:
- Add `cornerSmoothing?: number` to ShapeNode (0–100, default 0)

`packages/editor/src/context.tsx`:
- Add `setSelectedCornerSmoothing(value: number)` — batch set on shape nodes
- Implementation: same pattern as `setSelectedCornerRadius`

### C4 — Keyboard shortcuts

`packages/editor/src/shortcuts/ShortcutManager.ts`:
- Register align shortcuts (when inspector is focused):
  - `Alt+1`: Align left
  - `Alt+2`: Align center H
  - `Alt+3`: Align right
  - `Alt+4`: Align top
  - `Alt+5`: Align center V
  - `Alt+6`: Align bottom
  - `Alt+7`: Distribute H
  - `Alt+8`: Distribute V
  - `=` (when NumberField focused): Open BindingMenu

### C5 — Tests

- ComponentSection renders for frame instances
- Slot fill/clear works
- Component swap/detach
- Binding entry points (keyboard shortcuts, click handlers)
- Corner smoothing get/set
- Alignment keyboard shortcuts

---

## Track D — E2E testing + accessibility (P5)

**Effort: 3d · Depends on: everything above should be done first · Gate quality**

### D1 — Playwright inspector test suite

`tests/e2e/inspector/helpers.ts`:
- NEW helper file. Shared utilities:
  - `navigateToEditor(page)` — go to / → New File → Create
  - `createRectShape(page)` — press R, click canvas
  - `getInspectorValue(page, label)` — read NumberField value by label
  - `setInspectorValue(page, label, value)` — type into NumberField

`tests/e2e/inspector/edit.spec.ts`:
- "select shape → change X → canvas reflects new position"
- "change W → shape width changes"
- "change H → shape height changes"
- "change fill color → shape renders new color"
- "change opacity → shape renders at new opacity"
- "rotation changes → shape rotates"
- "flip H → shape flips horizontally"

`tests/e2e/inspector/multi.spec.ts`:
- "select 2 shapes → change opacity → both update"
- "Mixed indicator for differing X values"
- "align left edges → both snap to same left"
- "distribute horizontal → equal spacing"

`tests/e2e/inspector/sections.spec.ts`:
- "stroke add/remove/weight"
- "effect add/remove/blur"
- "corner radius changes"
- "layout mode change (none→flex→grid)"

`tests/e2e/inspector/color.spec.ts`:
- "ColorPicker opens on swatch click"
- "hue slider changes fill color"
- "HEX input updates RGB fields"
- "swatch click sets fill"

### D2 — axe-core scan

`tests/e2e/inspector/axe.spec.ts`:
- Follow pattern from `tests/e2e/layers/axe.spec.ts`
- Scan `.editor-inspector` with `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`
- Assert `results.violations` is empty
- Test both empty state and populated state

`packages/editor/src/components/Inspector/PropertiesPanel.tsx` (and all section files):
- Fix any violations found:
  - Form control labels properly associated (already done for NumberField)
  - Color contrast on Mixed indicators
  - ARIA roles on tab list (already `role="tablist"`)
  - Disclosure section button states (`aria-expanded`/`aria-controls`)
  - Slider keyboard operability (hue/alpha already have keyboard handlers)
  - Any focus management issues

### D3 — Fix pre-existing violations

If axe-core scan fails on pre-existing patterns:
- SwatchPalette: add button `type="button"` to all buttons
- SegmentedControl: add `role="radiogroup"` semantics
- ColorFields: ensure labels reference controls via `htmlFor`/`id`
- FillSection color swatch: ensure proper `aria-haspopup` + `aria-expanded` pattern

### D4 — Documentation update

`AGENTS.md`:
- Update test counts to reflect new tests
- Update "Current test counts" section
- Update Session 7 entry if needed
- Mark inspector as fully complete

`docs/plans/inspector-deferred.md`:
- Mark ALL items as [OK] Done
- Archive the document

---

## Delivery order (parallel tracks)

```
Week 1:
  Track A: Fill stacks + gradient editor (A1→A2→A3→A4)  ─────────────────── 8d
  Track B: Grid tracks + fluid sizing (B1→B2→B3→B4→B5)  ─────────────────── 4d

Week 2:
  Track C: Component slots + binding UX (C1→C2→C3→C4→C5) ────────────────── 3d
  Track D: E2E + axe-core (D1→D2→D3→D4) ──────────────────────────────────── 3d

Parallel: A runs independently from B/C/D
Sequential within each track: each step depends on the previous
Optional super-stretch: Yjs CRDT (10d, Phase 2 infra needed)

Total: 18d for core tracks, +Yjs = 28d
```

### Parallelism strategy

| Track | Isolation | Can run with |
|---|---|---|
| A (Fill) | packages/scene + engine + editor/FillSection | B, C, D |
| B (Grid) | crates/strata-layout + packages/scene + editor/LayoutSection | A, C, D |
| C (Slots) | packages/editor + context | A, B, D |
| D (Tests) | tests/e2e/ + editor fix-ups | A, B, C (ideally after) |

### File creation summary

| File | Track | Action |
|---|---|---|
| `packages/editor/src/components/Inspector/sections/GradientEditor.tsx` | A3 | NEW |
| `packages/editor/src/components/Inspector/controls/GradientStopSlider.tsx` | A3 | NEW |
| `packages/editor/src/components/Inspector/sections/ComponentSection.tsx` | C1 | NEW |
| `tests/e2e/inspector/helpers.ts` | D1 | NEW |
| `tests/e2e/inspector/edit.spec.ts` | D1 | NEW |
| `tests/e2e/inspector/multi.spec.ts` | D1 | NEW |
| `tests/e2e/inspector/sections.spec.ts` | D1 | NEW |
| `tests/e2e/inspector/color.spec.ts` | D1 | NEW |
| `tests/e2e/inspector/axe.spec.ts` | D2 | NEW |

### File modification summary

| File | Track | Changes |
|---|---|---|
| `packages/scene/src/types.ts` | A1, B2, C3 | `fills`, `GridTrack`, `cornerSmoothing` |
| `packages/scene/src/document.ts` | A1, B2 | `setFill`, `addFill`, `removeFill`, `reorderFill`, `setNodeGridPlacement`, `migrateDocument` |
| `packages/scene/src/index.ts` | A1 | Re-export new types |
| `packages/engine/src/types.ts` | A2 | `fills` on RenderItem |
| `packages/engine/src/replay.ts` | A2 | Multi-fill compositing, gradient rendering |
| `crates/strata-engine/src/lib.rs` | A2 | `fills` on RenderItem (Rust) |
| `crates/strata-layout/src/lib.rs` | B1 | Grid display, track sizing |
| `crates/strata-core/src/scene.rs` | B1 | Grid placement fields |
| `packages/editor/src/context.tsx` | C1, C3, C4 | `swapInstanceComponent`, `resetInstanceOverrides`, `setSelectedCornerSmoothing`, align shortcuts |
| `packages/editor/src/PropertiesPanel.tsx` | C1 | ComponentSection import + render |
| `packages/editor/src/sections/FillSection.tsx` | A3, C2 | Rewrite to stacked fills, binding entry points |
| `packages/editor/src/sections/LayoutSection.tsx` | B3 | Grid track editors |
| `packages/editor/src/sections/CornerRadiusSection.tsx` | C3 | Smoothing slider |
| `packages/editor/src/controls/NumberField.tsx` | C2 | `bindable` prop, `=` shortcut, right-click |
| `packages/editor/src/controls/BindingMenu.tsx` | C2 | Keyboard nav improvements |
| `AGENTS.md` | D4 | Test counts, completion status |
| `docs/plans/inspector-deferred.md` | D4 | Archive (mark all done) |

### Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Taffy 0.11 grid API differs from expected | Medium | Pin exact Taffy version, check API before wiring |
| Gradient rendering perf on canvas | Low | Test with 10+ gradient fills, optimize with offscreen cache if needed |
| Fill migration breaks existing documents | Low | `migrateDocument()` + backward compat fallback path |
| axe-core finds pre-existing violations in controls | Medium | Fix as found; controls are already APG-compliant in structure |
| E2E tests flaky with async rendering | Medium | `waitForSelector` + `toPass()` retry on assertions |
