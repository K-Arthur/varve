# Inspector Design Tab — Implementation Plan (2026-09-15)

## 1. Overview & Objectives
Review, modernize, and polish the 7 core sections of the Inspector Design Tab:
1. **Align & Distribute** (`AlignDistributeBar.tsx`)
2. **Position & Size** (`PositionSizeSection.tsx`)
3. **Corner Radius** (`CornerRadiusSection.tsx`)
4. **Image Placement** (`ImagePlacementSection.tsx`)
5. **Crops & Bounds** (`ImageCropSection.tsx`)
6. **Masks** (`MaskSection.tsx`)
7. **Selection Colors** (`SelectionColorsSection.tsx`)

Each section must follow:
- **Progressive Disclosure**: Reveal high-frequency controls upfront; tuck secondary/advanced controls into expandable drawers, popovers, or smart contextual visibility.
- **Contextual Adaptation**: Show controls only when relevant to the selection (single vs multi-select, node kinds, primitive vs multi-color).
- **Accessibility & Tokens**: WCAG 2.2 AA compliant, minimum 24×24px targets, clear focus rings, semantic labels and ARIA live regions.
- **Visual Elegance**: Flat Gestalt hierarchy, uniform 38% label track, tabular numbers, aligned inputs, and token-based surface/border colors.

---

## 2. Step-by-Step Implementation

### Step 1: Align & Distribute (`AlignDistributeBar.tsx` + `inspector.css`)
- Streamline primary toolbar: 6 align buttons + 2 distribute buttons + Gap/Options trigger.
- Add intelligent contextual alignment: When 1 node is selected, align buttons target its container/frame (or page) smoothly.
- Polish `TidyUpPopover` and `DistributionPopover` with tokens, clear field layouts, and keyboard focus management.
- Consolidate secondary controls (Key Object, Reference target picker, Fixed Gap, Tidy Up, OBB) into an accessible options tray/popover.

### Step 2: Position & Size (`PositionSizeSection.tsx` + `inspector.css`)
- Keep W, H, X, Y, R, Flip H, Flip V front and center.
- Proportion lock: High-contrast link icon with clear toggle state and 24×24px hit area.
- Skew X / Skew Y: Progressively disclose via an "Advanced transforms" disclosure button. Automatically surface if skew is non-zero.
- Line/arrow shapes: Maintain length (L) and angle (A) clarity.

### Step 3: Corner Radius (`CornerRadiusSection.tsx` + `PropertiesPanel.tsx`)
- Bug fix: Auto-detect existing independent corners (`Array.isArray(radius)` with differing values) so `perCorner` initializes correctly and never displays 0 for asymmetric shapes.
- High-density layout: Single Radius field + "Independent corners" icon toggle on the right. When activated, reveals 4 clockwise corners: Top-Left (TL), Top-Right (TR), Bottom-Right (BR), Bottom-Left (BL).
- Corner smoothing: Squircle curve slider with 60% iOS squircle guidance, shown only when radius > 0 or smoothing > 0.
- Multi-selection: Expose `corner-radius` in `MultiSelectionPanel` when selected nodes contain rects or frames.

### Step 4: Image Placement (`ImagePlacementSection.tsx`)
- Multi-selection support: Allow batch setting fit mode (Fill, Fit, Crop, Stretch, Tile) and batch resetting placement for multiple selected image shapes.
- Compact segmented control with icon/label tooltips to avoid clipping in narrow panels.
- Contextual scale & offset controls with focal point alignment helpers.
- Quick actions: Edit Crop (C) and Reset Placement with clean icons.

### Step 5: Crops & Bounds (`ImageCropSection.tsx`)
- Quick Aspect Ratio Presets popover: Freeform, 1:1, 4:3, 16:9, 9:16, 3:2.
- Subsection disclosures: Trim to Subject, Protect Faces, Expand Bounds.
- Clear Reset Bounds action button with source dimension tooltip.

### Step 6: Masks (`MaskSection.tsx` + `inspector.css`)
- Redesign Mask Card:
  - Header: Mask Type badge/picker, Eye toggle, Invert toggle, Link transform toggle, Hide source toggle, Trash remove button.
  - Feather and Density sliders with tabular inputs.
  - Fill Rule segmented toggle (Nonzero vs Even-Odd).
  - Vector mask path trigger ("Edit path" with point count badge).
  - Brush mask trigger ("Paint mask..." with brush icon).
- When no mask is present: Compact, appealing "Add Mask" segmented action with explanatory tooltips for Clip, Alpha, Luminance, Vector, and Brush modes.

### Step 7: Selection Colors (`SelectionColorsSection.tsx` + `inspector.css`)
- Visibility rule: Suppress Selection Colors on single-color simple shapes (where Fills already edits the color directly). Show when 2+ colors are present or multiple nodes are selected.
- Modern List View:
  - Swatch (rounded, checkerboard alpha).
  - Uppercase hex value (`#4A90E2`) or token name, plus opacity if < 100%.
  - Role pill (`Fill · 3 uses`).
  - Target / Crosshair icon button: "Select matching layers" — clicking selects all nodes using this color!
  - Quick copy hex code button.
  - Click swatch opens `InspectorColorPopover`.

### Step 8: Documentation & Marketing Website Updates
- Update `apps/website/src/pages/docs/getting-started/interface.astro` with the modernized inspector sections and capabilities.
- Update companion docs and audit logs.

### Step 9: Verification & Validation
- Unit tests: `AlignDistributeBar.test.tsx`, `PositionSizeSection.test.tsx`, `CornerRadiusSection.test.tsx`, `SelectionColorsSection.test.tsx`, `ImagePlacementSection.test.tsx`, `MaskSection.test.tsx`.
- Playwright E2E audit: `tests/e2e/inspector/design-tab-audit.spec.ts`.
- Audits: `pnpm audit:tokens`, `pnpm audit:emoji`, `pnpm audit:docs`.
