# Hardened Master Redesign & System Overhaul — Redesign Strategy

> **Status:** Planning (pre-implementation)
> **Scope:** Full visual + structural system overhaul
> **Target:** Neo-Bento Grid + Linear-Esque precision + OKLCH perceptual color + 100% opaque surfaces + all components fully implemented, clean, and styled
> **Date:** 2026-07-01

---

## 1. Scope Summary

The system has **53 gaps** across all UI surfaces. Every component must hit three bars:

| Bar | Definition | How enforced |
|-----|-----------|--------------|
| **Functionally complete** | No stubs, no dead code, all callbacks and handlers wired, all user inputs produce correct state changes | Code review + grep for TODO/FIXME/stub |
| **Clean architecture** | No inline `style={}` objects — all styling via CSS classes + design tokens. No duplicate/redundant components. Proper TypeScript types. | `grep -n 'style={{'` must return zero across all packages |
| **Properly styled** | Every visual element uses `--color-*`, `--space-*`, `--radius-*`, `--elevation-*`, `--shadow-*` tokens. No hardcoded colors, radii, or shadows. 100% opaque surfaces (except modal scrim). | `just gate` + visual inspection |

### Problem Summary

| # | Category | Count |
|---|----------|-------|
| 1 | Zero CSS — entirely inline-styled | 13 components across 24 files |
| 2 | Partially inline + dead CSS classes | 20 components across 15 files |
| 3 | Functional defects | 5 components |
| 4 | Duplicate/redundant components to remove | 2 (FillStackSection, GradientStopEditor) |
| 5 | Components with broken interactions | 3 (Toolbar keyboard, color swatches ×2, BindingMenu arrow nav) |
| **Total** | | **53 gaps** |

---

## 2. Complete Component Inventory — All 53 Gaps

### TIER 1 — Zero CSS, Entirely Inline-Styled (13 components)

These components use `style={{}}` on every element with no CSS classes at all. They function correctly but are visually bare and violate the token-only rule.

| # | Component | File | Lines | Functional Status | Action |
|---|-----------|------|-------|-------------------|--------|
| 1 | **TitleBar** | `apps/desktop/src/chrome/TitleBar.tsx` | 44-158 | ✅ Complete — Tauri window controls wired | Create CSS classes, remove all inline style |
| 2 | **ErrorBoundary** | `packages/editor/src/components/ErrorBoundary.tsx` | 39-100 | ✅ Complete | Create CSS classes for error fallback UI |
| 3 | **ExportPresetPanel** | `packages/editor/src/components/Export/ExportPresetPanel.tsx` | 66-266 | ✅ Complete — 13 format presets + add/remove/edit | Create CSS classes, remove refs to non-existent `.export-preset-panel`/`.export-preset-row`/`.inspector-section` |
| 4 | **BindingMenu** | `packages/editor/src/components/Inspector/controls/BindingMenu.tsx` | 137-218 | ⚠️ Missing keyboard arrow navigation in list | Create CSS classes, fix arrow nav, remove 4 inline style objects |
| 5 | **TokenBindIndicator** | `packages/editor/src/components/Inspector/controls/TokenBindIndicator.tsx` | 69-120 | ✅ Complete | Create CSS classes, remove 2 inline style objects |
| 6 | **GradientEditor** | `packages/editor/src/components/Inspector/color/GradientEditor.tsx` | 153-314 | ✅ Complete (minor ARIA issue) | Create CSS classes, remove all inline style |
| 7 | **GradientStopEditor** | `packages/editor/src/components/Inspector/sections/GradientStopEditor.tsx` | 105-280 | ❌ **ELIMINATE** — duplicate of GradientEditor, uses MouseEvent, native color input | Delete file, rewire FillStackSection consumers to GradientEditor |
| 8 | **FillStackSection** | `packages/editor/src/components/Inspector/sections/FillStackSection.tsx` | 111-433 | ❌ **ELIMINATE** — duplicate of FillSection, both render simultaneously | Delete file, remove from PropertiesPanel imports |
| 9 | **ColorPicker** (6 files) | `packages/ui/src/components/ColorPicker/*.tsx` | All | ✅ Complete — fully functional with HSV, a11y, keyboard | Create `color-picker.css`, remove all inline styles |
| 10 | **NumberInput** | `packages/ui/src/components/NumberInput.tsx` | 112-143 | ✅ Complete — drag-scrub, arrow keys, shift/alt modifiers | Create CSS class, remove inline style |
| 11 | **Slider** | `packages/ui/src/components/Slider.tsx` | 99-185 | ✅ Complete — keyboard, pointer, track click, a11y | Create CSS class (`.slider` is referenced but does not exist), remove inline styles from children |
| 12 | **Toolbar** | `packages/ui/src/components/Toolbar.tsx` | 56-69 | ❌ **Broken** — roving tabindex never calls `.focus()` | Fix focus management, add CSS class, add tests |
| 13 | **TrashSection** | `packages/home/src/TrashSection.tsx` | 20-95 | ✅ Complete | Create CSS classes, remove all inline styles |

### TIER 2 — Partially Inline + Dead CSS Classes (20 components)

These components have some CSS classes but also have inline style objects or reference CSS classes that don't exist.

| # | Component | File | Issue | Action |
|---|-----------|------|-------|--------|
| 14 | **EffectsSection** | `Inspector/sections/EffectsSection.tsx` | 4 inline style objects; shadow color swatch has no onClick | Move inline → CSS; fix swatch to open color picker |
| 15 | **FillSection** | `Inspector/sections/FillSection.tsx` | 3 inline style objects (SELECT_STYLE, INLINE_BTN, ADD_BTN) | Move all to CSS classes |
| 16 | **StrokeSection** | `Inspector/sections/StrokeSection.tsx` | 6 inline style objects; stroke color swatch has no onClick | Move all to CSS classes; fix swatch to open color picker |
| 17 | **ComponentSection** | `Inspector/sections/ComponentSection.tsx` | 3 inline style objects | Move all to CSS classes |
| 18 | **AppearanceSection** | `Inspector/sections/AppearanceSection.tsx` | SELECT_STYLE inline on `<select>` | Move to CSS class |
| 19 | **ImageFillControls** | `Inspector/sections/ImageFillControls.tsx` | Inline styles on wrapper and selects | Move to CSS classes |
| 20 | **LayoutSection** | `Inspector/sections/LayoutSection.tsx` | NATIVE_SELECT inline + padding inputs inline | Move all to CSS classes |
| 21 | **PositionSizeSection** | `Inspector/sections/PositionSizeSection.tsx` | Flip buttons, lock checkbox, proportion SVG inline | Move all to CSS classes |
| 22 | **TypographySection** | `Inspector/sections/TypographySection.tsx` | SELECT_STYLE on all `<select>` elements | Move to CSS classes |
| 23 | **AlignDistributeBar** | `Inspector/sections/AlignDistributeBar.tsx` | References `insp-align-bar` class (doesn't exist) | Define the class in inspector.css or remove ref |
| 24 | **CornerRadiusSection** | `Inspector/sections/CornerRadiusSection.tsx` | References `insp-value` class (doesn't exist) | Define the class or remove ref |
| 25 | **MeasureOverlay** | `SpecPanel/MeasureOverlay.tsx` | References `measure-overlay` class (doesn't exist) | Define the class |
| 26 | **StatusBar** (`visually-hidden`) | `editor/src/StatusBar.tsx` L70 | References non-existent `visually-hidden` class — `sr-only` exists in inspector.css, `strata-visually-hidden` exists in components.css | Fix class name to `sr-only` |
| 27 | **Menubar** (`visually-hidden`) | `editor/src/Menubar.tsx` L665 | Same issue — `visually-hidden` doesn't exist | Fix class name to `sr-only` |
| 28 | **IconButton** | `ui/src/components/IconButton.tsx` | References `strata-iconbtn` class (doesn't exist) | Define the class in components.css or remove ref |
| 29 | **LayersPanel wrapper** | `editor/src/components/LayersPanel/index.tsx` L233-238 | VariablePanel separator uses inline `style={{ marginTop, paddingTop, borderTop }}` | Move to CSS class |
| 30 | **ProjectsView rename** | `home/src/ProjectsView.tsx` L73-82 | Rename input uses inline `style={{ fontFamily, fontSize, ... }}` | Move to CSS class |
| 31 | **NodeEditOverlay** | `editor/src/components/NodeEditOverlay.tsx` | SVG inline `style={{}}` for positioning | Move to CSS class |
| 32 | **EmptyStates** (home) | `home/src/EmptyStates.tsx` | Illustration `style={{ width, height }}` inline | Move to CSS class |
| 33 | **LiveCursors** | `editor/src/components/LiveCursors.tsx` | Inline style on cursor text | Move to CSS class |

---

## 3. Architectural Design System Specification

### 3.1 Perceptual Color Space: OKLCH Migration

**New type in `contrast.ts`:**

```typescript
export type Oklch = { L: number; C: number; H: number };
```

**Conversion utilities:**

```typescript
export function oklchToCss(c: Oklch): string;   // "oklch(L C H)"
export function oklchToRgb(c: Oklch): Rgb;       // WCAG math compatibility
export function rgbToOklch(c: Rgb): Oklch;        // Migration from sRGB
```

**Changes:**
- All 6 ramps × 12 steps in `color.ts` from `Rgb[]` → `Oklch[]`
- All 47 semantic tokens × 3 themes in `SEMANTIC` from `Rgb` → `Oklch`
- CSS generator from `toHex()` → `oklchToCss()`
- CSS output from `#39d0c6` → `oklch(0.75 0.16 185)`

### 3.2 Elevation Token System

New elevation hierarchy (front-lit dark mode: higher = brighter):

| Token | Light | Dark |
|-------|-------|------|
| `--elevation-surface-sunken` | `oklch(0.95 0.008 260)` | `oklch(0.12 0.008 260)` |
| `--elevation-surface-default` | `oklch(0.97 0.008 260)` | `oklch(0.18 0.008 260)` |
| `--elevation-surface-raised` | `oklch(0.99 0.006 260)` | `oklch(0.22 0.006 260)` |
| `--elevation-surface-overlay` | `oklch(1.00 0.000 0)` | `oklch(0.27 0.005 260)` |

Shadow tokens with dark-mode opacity adjustment:
- Light: `oklch(0 0 0 / 0.14)` (raised), `oklch(0 0 0 / 0.20)` (overlay)
- Dark: `oklch(0 0 0 / 0.30)` (raised), `oklch(0 0 0 / 0.45)` (overlay)

### 3.3 Neo-Bento Geometry

**Radius update:**

| Token | Old | New |
|-------|-----|-----|
| `--radius-sm` | 3px | 4px |
| `--radius-md` | 6px | 8px |
| `--radius-lg` | 10px | 16px |
| `--radius-xl` | 16px | **28px** (bento panels) |
| `--radius-2xl` | — | **40px** (NEW — hero/oversized) |
| `--radius-pill` | 9999px | 9999px |

**Micro-border system (Linear-style):**
```css
--border-micro: 1px solid oklch(0 0 0 / 0.08);
--border-micro-accent: 1px solid oklch(from var(--accent) l c h / 0.25);
```

**Bento-grid CSS primitives** in `components.css`:
```css
.bento-grid { display: grid; gap: var(--bento-gap, var(--space-4)); }
.bento-cell { border-radius: var(--radius-xl); background: var(--elevation-surface-default); box-shadow: var(--elevation-shadow-raised); border: var(--border-micro); }
```

### 3.4 100% Opaque Surface Enforcement

All translucent/blur → solid elevation tokens:
- FloatingToolbar: remove `backdrop-filter: blur(8px)` → `background: var(--elevation-surface-raised)`
- Tooltip: remove `rgba` → `background: var(--elevation-surface-overlay)`
- Toast: `--color-surface-overlay` solid value
- Hero glow: `radial-gradient` with opacity → solid `oklch()` equivalent
- All hover/pressed states: `filter: brightness()` → solid hover tokens
- **Only allowed alpha:** modal scrim backdrop `oklch(0 0 0 / 0.5)`

### 3.5 WCAG 2.1 AA Safeguard Matrix

New per-elevation text tokens (6 new):
- `text-primary-on-default`, `text-secondary-on-default`
- `text-primary-on-raised`, `text-secondary-on-raised`
- `text-primary-on-overlay`, `text-secondary-on-overlay`

Contrast pairs expanded from 24 → 30 across 3 themes (90 checks, was 72).

### 3.6 Hardware Acceleration Layer

```css
.gpu-layer {
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  contain: layout style paint;
}
```

Apply to: editor shell grid, layers panel virtualized container, canvas wrapper, bento cells.

---

## 4. Functional Defects — Repair Specifications

### F1. Toolbar — Focus Management Broken

**File:** `packages/ui/src/components/Toolbar.tsx`
**Root cause:** Roving tabindex updates `focusIdx` on ArrowRight/Left but never calls `.focus()` on the target element. Keyboard navigation is non-functional.

**Fix:**
```typescript
// After focusIdx changes in handleKeyDown
useEffect(() => {
  const container = toolbarRef.current;
  if (!container) return;
  const children = Array.from(container.children) as HTMLElement[];
  const target = children[focusIdx];
  if (target) target.focus();
}, [focusIdx]);
```

**Test:** Add 6 tests — ArrowRight moves focus, ArrowLeft wraps, Home/End, ArrowRight at end wraps to first.

### F2. EffectsSection Color Swatch — Non-Interactive

**File:** `packages/editor/src/components/Inspector/sections/EffectsSection.tsx`
**Root cause:** `ShadowColorSwatch` renders as `<button>` with `aria-label="Effect colour"` but has no `onClick`. Shadow color cannot be changed through the UI.

**Fix:**
- Wire `onClick` to open a ColorPicker popover (reuse `PickableColor` pattern from FillSection)
- Store/commit the selected color through `updateEffectProperty`

### F3. StrokeSection Color Swatch — Non-Interactive

**File:** `packages/editor/src/components/Inspector/sections/StrokeSection.tsx`
**Root cause:** Stroke color swatch renders as `<button>` with no `onClick`. Stroke color cannot be changed.

**Fix:**
- Wire `onClick` to open a ColorPicker popover
- Commit color through `updateStrokeProperty(strokeIdx, 'color', newColor)`

### F4. BindingMenu — No Keyboard List Navigation

**File:** `packages/editor/src/components/Inspector/controls/BindingMenu.tsx`
**Root cause:** Variable list responds to mouse hover for visual selection but has no ArrowUp/Down handler for keyboard navigation.

**Fix:**
- Add `onKeyDown` handler on the list container
- ArrowUp: `selectedIdx = max(0, selectedIdx - 1)`, scrollIntoView
- ArrowDown: `selectedIdx = min(items.length - 1, selectedIdx + 1)`, scrollIntoView
- Enter: select the highlighted item
- Wrap at boundaries

### F5. FillStackSection — Remove Duplicate

**File:** `packages/editor/src/components/Inspector/sections/FillStackSection.tsx` (entire file)
**Also:** `GradientStopEditor.tsx` (used only by FillStackSection)

**Action:**
1. Delete `FillStackSection.tsx`
2. Delete `GradientStopEditor.tsx`
3. Remove import of FillStackSection from `PropertiesPanel.tsx` (lines 207-208, 234-235)
4. Remove GradientStopEditor import from FillStackSection imports (already in same directory)
5. Verify `FillSection` (the full-featured version) handles all the cases FillStackSection was handling

---

## 5. Execution Plan — 8 Phases

### Phase 1: Foundation — OKLCH Perceptual Token Engine

**Sub-agent: Tokens-Agent**
**Files:** `contrast.ts`, `color.ts`, `contrast.test.ts`, `tokens.test.ts`

1. Add `Oklch` type + `oklchToCss()`, `oklchToRgb()`, `rgbToOklch()` to `contrast.ts`
   - Test: round-trip sRGB → OKLCH → sRGB preserves values ±0.5%
2. Convert all 6 ramps × 12 steps from `Rgb[]` → `Oklch[]` in `color.ts`
   - Test: each ramp is monotonic in lightness
   - Test: each value is within sRGB gamut
3. Convert `SEMANTIC` 47 tokens × 3 themes from `Rgb` → `Oklch`
   - Test: all 24 existing contrast pairs still pass
4. Add elevation semantic tokens (6 new text-per-elevation tokens)
   - Test: all 30 pairs × 3 themes = 90 pass WCAG 2.2 AA
5. Rewrite CSS generator: `toHex()` → `oklchToCss()`
   - Test: drift guard still passes (against OKLCH source)

### Phase 2: Elevation + Bento Token System

**Sub-agent: Tokens-Agent**
**Files:** `generate-token-css.ts`, `tokens.css`

1. Add elevation surface tokens (sunken/default/raised/overlay) with dark-mode variants
2. Add elevation shadow tokens with dark-mode opacity adjustment
3. Add elevation z-index tokens
4. Add interaction state tokens per elevation (hover/active variants)
5. Update radius scale: sm=4px, md=8px, lg=16px, xl=28px, 2xl=40px
6. Add micro-border tokens: `--border-micro`, `--border-micro-accent`
7. Add `.gpu-layer` class to `global.css`
8. Update all shadow and z-index references across CSS to point to elevation tokens

### Phase 3: Architecture Cleanup — Remove Redundancy

**Sub-agent: Component-Refactor-Agent**
**Files:** `FillStackSection.tsx`, `GradientStopEditor.tsx`, `PropertiesPanel.tsx`

1. **Delete** `packages/editor/src/components/Inspector/sections/FillStackSection.tsx`
2. **Delete** `packages/editor/src/components/Inspector/sections/GradientStopEditor.tsx`
3. Fix `PropertiesPanel.tsx`:
   - Remove `FillStackSection` from imports
   - Remove both `FillStackSection` JSX instances (lines 207-208 for single, 234-235 for multi)
   - Verify `FillSection` renders correctly as the only fills UI
4. Check no other files import `FillStackSection` or `GradientStopEditor` — remove those imports too

### Phase 4: Functional Repair

**Sub-agent: Component-Refactor-Agent**
**Files:** `Toolbar.tsx`, `EffectsSection.tsx`, `StrokeSection.tsx`, `BindingMenu.tsx`

1. **Fix Toolbar focus:**
   - Add `useEffect` calling `.focus()` on `focusIdx` change
   - Add `Toolbar.test.tsx` — 6 tests for keyboard navigation

2. **Fix EffectsSection color swatch:**
   - Import `ColorPicker` popover pattern
   - Wire shadow swatch `onClick` → open picker → commit color
   - Add test for color change flow

3. **Fix StrokeSection color swatch:**
   - Same pattern as EffectsSection
   - Wire stroke swatch `onClick` → open picker → `updateStrokeProperty`

4. **Fix BindingMenu arrow navigation:**
   - Add `onKeyDown` handler with ArrowUp/ArrowDown/Enter
   - Add test for keyboard list navigation

### Phase 5: Opaque Surface Conversion

**Sub-agent: Component-Refactor-Agent**
**Files:** All CSS files — find and replace patterns

1. **FloatingToolbar.css:** Remove `backdrop-filter: blur(8px)`, replace rgba bg with `var(--elevation-surface-raised)`
2. **Tooltip:** Replace rgba fallback with solid elevation token
3. **Toast/overlays:** Replace rgba with solid `--color-surface-overlay`
4. **Hero glow:** Replace `radial-gradient` + opacity with solid `oklch()` color
5. **Hover/pressed states:** Replace `filter: brightness()` with dedicated hover tokens
6. **Exception ONLY:** Modal scrim — keep `oklch(0 0 0 / 0.5)` as the single allowed alpha
7. **Verification:** `grep -rn 'rgba\(' packages/ apps/ --include='*.css'` must return zero

### Phase 6: Style All 33 Components

**Sub-agent: Component-Refactor-Agent**
**Files:** Every file from Section 2 (Tier 1 + Tier 2)

For EACH of the 33 components:

1. Read the full file — identify every `style={{}}` object
2. Create CSS classes in the component's CSS file (or the nearest shared CSS file)
3. Replace `style={{}}` with `className` (or `style` with only truly dynamic values)
4. Ensure all CSS values trace to `--color-*`, `--space-*`, `--radius-*`, `--elevation-*` tokens
5. For Tier 2 components: resolve dead class references (either define the class or remove it)

**New CSS files to create:**
| File | For |
|------|-----|
| `packages/ui/src/components/ColorPicker/color-picker.css` | ColorPicker, ColorArea, ColorSlider, ColorFields, EyeDropper, SwatchPalette |
| `packages/editor/src/components/Export/export-preset-panel.css` | ExportPresetPanel |
| `packages/editor/src/components/Inspector/controls/inspector-controls.css` | BindingMenu, TokenBindIndicator |
| `packages/editor/src/components/Inspector/color/gradient-editor.css` | GradientEditor |
| `apps/desktop/src/chrome/title-bar.css` | TitleBar |

**Existing CSS files to extend:**
| File | Add classes for |
|------|----------------|
| `packages/ui/src/components/components.css` | `.strata-iconbtn`, `.strata-toolbar`, `.strata-num-input`, `.strata-slider`, `.bento-grid`, `.bento-cell` |
| `packages/editor/src/editor.css` | ErrorBoundary fallback UI |
| `packages/editor/src/components/Inspector/inspector.css` | `.insp-align-bar`, `.insp-value`, `.insp-effects-section`, `.insp-fill-section`, `.insp-stroke-section`, `.insp-component-section`, `.insp-appearance-select`, `.insp-image-controls`, `.insp-layout-select`, `.insp-layout-padding`, `.insp-pos-flip`, `.insp-typography-select` |
| `packages/editor/src/components/SpecPanel/SpecPanel.css` | `.measure-overlay` |
| `packages/home/src/home.css` | `.trash-section`, `.trash-header`, `.trash-item`, `.trash-item__name`, `.trash-item__meta`, `.trash-item__actions`, `.project-rename-input` |

### Phase 7: Component Alignment — Shell + Panels

**Sub-agent: Component-Refactor-Agent**
**Files:** `Shell.tsx`, `editor.css`, `components.css`, `home.css`, all panel CSS

1. **Shell.tsx** — Update grid area backgrounds to use elevation tokens
2. **Menubar** — Replace hardcoded shadow `0 1px 4px rgb(0 0 0 / 0.06)` with `var(--elevation-shadow-raised)`
3. **StatusBar** — Replace hardcoded shadow `0 -1px 3px rgb(0 0 0 / 0.05)` with elevation token
4. **Layers panel** — Replace hardcoded shadow `2px 0 8px rgb(0 0 0 / 0.07)` with elevation token
5. **Inspector panel** — Replace hardcoded shadow `-2px 0 8px rgb(0 0 0 / 0.07)` with elevation token
6. **Panel backdrop** — Replace `rgba(0,0,0,0.3)` with scrim token
7. **Dialog backdrop** — Replace `rgba(0,0,0,0.4)` with scrim token
8. **Spotlight backdrop** — Replace `rgba(0,0,0,0.55)` with scrim token
9. **Home toolbar** — Replace hardcoded shadow `0 1px 4px rgb(0 0 0 / 0.04)` with elevation token
10. **Home cards** — Replace `--shadow-md` on hover with `--elevation-shadow-raised`
11. **All components** — Apply `.gpu-layer` to: editor shell, layers container, canvas wrapper

### Phase 8: Documentation & Context Sync

**Sub-agent: Docs-Sync-Agent**

1. **`AGENTS.md`** — Add OKLCH rule, elevation tokens table, radius table, removed duplicate components note
2. **`docs/adr/0002-design-tokens.md`** — Update with OKLCH decision, elevation system, 90+ WCAG pairs
3. **`docs/design/visual-direction.md`** — Add Neo-Bento geometry, opaque surface enforcement, radius changes
4. **`docs/design/elevation-system.md`** (NEW) — Document hierarchical elevation model, front-lit dark mode, shadow mapping, contrast matrix
5. **`docs/brand-guide.md`** — Add OKLCH equivalents for brand tokens (#39d0c6 → oklch(0.75 0.16 185))

---

## 6. Verification Gate

```bash
# Must all pass
just format-check
pnpm lint
pnpm typecheck
pnpm test                # 664+ JS tests + Rust
pnpm audit:tokens        # 90/90 WCAG-AA (was 72/72)
pnpm audit:emoji         # zero emoji

# Additional verification
grep -rn 'style={{' packages/ apps/ --include='*.tsx' --include='*.ts'
# Must return zero or only truly dynamic values (position calculations, etc.)

grep -rn 'rgba(' packages/ apps/ --include='*.css'
# Must return zero

grep -rn 'backdrop-filter' packages/ apps/ --include='*.css'
# Must return zero

# Verify no dead class references
# All classes in className strings must exist in CSS
```

---

## 7. Execution Order — Sequential Flow

```
Phase 1: OKLCH tokens       ─┐
Phase 2: Elevation tokens    ─┤  Tokens-Agent (serial)
                              │
Phase 3: Remove redundancy   ─┤
Phase 4: Fix 4 functional    ─┤  Component-Refactor-Agent (serial)
Phase 5: Opaque surface      ─┤
Phase 6: Style 33 components ─┤
Phase 7: Shell alignment     ─┤
                              │
Phase 8: Documentation       ─┘  Docs-Sync-Agent (final)
```

Phases run sequentially within each agent. Phases 1-2 must complete before 3-7 begin (CSS depends on tokens). Phase 8 is last.

---

## 8. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| OKLCH gamut clipping on sRGB displays | Medium | High — unexpected color shifts | Pre-validate all values against sRGB gamut; add `@media (color-gamut: p3)` enhancements |
| Radius increase (3→4, 6→8, 10→16, 16→28) causes text overflow | Medium | Medium | `overflow: hidden` on all bento cells; `contain: layout style paint` |
| Dark shadow invisibility (0.14 → 0.30 opacity) | Medium | Medium | Add micro-border accent as secondary depth cue |
| Toolbar focus fix breaks existing consumers | Low | High | Test: ToolPanel and FloatingToolbar still navigate correctly |
| FillStackSection removal breaks PropertiesPanel | Low | High | Verify FillSection handles all fill states (solid, gradient, image, pattern, multi-select) |
| Inline-to-CSS conversion misses dynamic styles | Medium | Low | Review each conversion — leave truly dynamic values (computed positions, transforms) as inline |
| Token drift between TS source and CSS | Low | Medium | Drift guard test updated to compare OKLCH values with ±0.001 tolerance |

---

## 9. Affected Files — Complete Inventory

### Deleted
- `packages/editor/src/components/Inspector/sections/FillStackSection.tsx`
- `packages/editor/src/components/Inspector/sections/GradientStopEditor.tsx`

### New Files
- `packages/ui/src/components/ColorPicker/color-picker.css`
- `packages/editor/src/components/Export/export-preset-panel.css`
- `packages/editor/src/components/Inspector/controls/inspector-controls.css`
- `packages/editor/src/components/Inspector/color/gradient-editor.css`
- `apps/desktop/src/chrome/title-bar.css`
- `docs/design/elevation-system.md`

### Modified (TypeScript/TSX — logic)
- `packages/ui/src/tokens/contrast.ts` — Oklch type + conversions
- `packages/ui/src/tokens/color.ts` — All ramps + semantic → Oklch; new elevation tokens; expanded contrast pairs
- `packages/ui/src/tokens/index.ts` — Export new types
- `packages/ui/scripts/generate-token-css.ts` — Oklch output, elevation tokens, new radii, micro-borders
- `packages/ui/scripts/audit-tokens.ts` — Support Oklch source
- `packages/ui/src/components/Toolbar.tsx` — Fix focus management + tests
- `packages/editor/src/components/Inspector/sections/EffectsSection.tsx` — Fix color swatch
- `packages/editor/src/components/Inspector/sections/StrokeSection.tsx` — Fix color swatch
- `packages/editor/src/components/Inspector/controls/BindingMenu.tsx` — Fix arrow nav
- `packages/editor/src/components/Inspector/PropertiesPanel.tsx` — Remove FillStackSection imports
- `packages/editor/src/components/LayersPanel/index.tsx` — VariablePanel wrapper inline→CSS

### Modified (CSS — styling)
- `packages/ui/src/tokens/tokens.css` — Regenerated (Oklch, elevation, radii, micro-borders)
- `packages/ui/src/components/components.css` — Add 6+ new component classes + bento primitives
- `packages/editor/src/editor.css` — Opaque surfaces, elevation shadows, .gpu-layer, ErrorBoundary
- `packages/editor/src/components/Inspector/inspector.css` — 20+ new section classes
- `packages/editor/src/components/SpecPanel/SpecPanel.css` — .measure-overlay
- `packages/editor/src/components/LayersPanel/layers.css` — Minor fixes
- `packages/editor/src/components/FloatingToolbar/FloatingToolbar.css` — Remove blur
- `packages/home/src/home.css` — TrashSection, ProjectsView classes
- `apps/desktop/src/global.css` — .gpu-layer, font-smoothing

### Modified (tests)
- `packages/ui/src/tokens/contrast.test.ts` — New Oklch conversion tests
- `packages/ui/src/tokens/tokens.test.ts` — Drift guard updated for Oklch
- `packages/ui/src/components/Toolbar.test.tsx` (NEW) — 6 focus management tests

### Modified (docs)
- `AGENTS.md`, `docs/adr/0002-design-tokens.md`, `docs/design/visual-direction.md`, `docs/brand-guide.md`
