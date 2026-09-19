# Inspector Redesign and Scrollbar Overlap Resolution — Audit and Verification

**Date:** 2026-09-19  
**Branch:** `master`  
**Scope:** Inspector panel scrollbar occlusion defect, Position & Size geometry redesign, Align & Distribute visual coherence, responsive rail contracts, competitor failure analysis, and documentation updates.  

---

## 1. Problem Statement & Root Cause Analysis

### 1.1 The Scrollbar Overlap Defect
Users reported a critical UI defect where all controls along the right edge of the Inspector panel rendered above and overlapped with the vertical scrollbar.

#### Root Causes:
1. **Missing Scrollbar Gutter Reservation**: `.editor-inspector > .insp-panel` possessed `overflow-y: auto` without `scrollbar-gutter: stable`. On standard desktop environments (especially Linux/X11 and Windows), the browser renders the 8–16px scrollbar track either overlaid atop the container padding or immediately adjacent without gutter compensation.
2. **Missing Horizontal Overflow Containment**: Without `overflow-x: hidden`, content stretching 100% of the container width extended beneath the vertical scrollbar track, causing controls (such as flip buttons, orientation swap buttons, and action slots) to collide with or be obscured by the scrollbar thumb.
3. **Elevated Sticky Header Stacking Context**: `.insp-disclosure__header` and `.insp-align-section__header` had `z-index: 2`. When scrolling vertically, sticky headers crossed over the scrollbar bounding box, visually covering the scroll track.

### 1.2 Position & Size and Align & Distribute Layout Imbalances
1. **Phantom Voids & Misalignment**: The X and Y numeric fields previously rendered with unbalanced action slot gaps, pushing Y toward the scrollbar and misaligning right edges with W and H.
2. **Scattered Transform Controls ("Dials on a Stove")**: The rotation row previously declared a wide grid (`4.75rem auto auto auto`), creating disjointed whitespace gaps between the rotation input and the horizontal flip, vertical flip, and skew toggles on wider rails.
3. **Verbose Numeric Field Labels**: Displaying full labels like `X (px)` and `W (px)` in tight column tracks consumed critical horizontal real estate, forcing input values into awkward abbreviations on narrow rails.

---

## 2. Competitor Research & Industry Failure Analysis

In designing this resolution, we analyzed recent user feedback and design critiques across major design tools:

| Tool / Release | Failure Mode / Online Complaint | How Varve Resolves It |
| --- | --- | --- |
| **Figma UI3 (2024–2026)** | Designers strongly protested moving Align & Distribute into multi-click menus and floating panels that overlapped canvas content and shifted unexpectedly. | Varve preserves a persistent, single-tier Align & Distribute bar at the top of the Design tab with clear reference chips (Selection, Frame, Canvas/Page). |
| **Adobe Illustrator** | Modal popovers hiding alignment target modes ("Align to Selection" vs "Align to Artboard"), leading to destructive accidental document-wide alignments. | Alignment target modes are explicitly visible at all times with accessible descriptions and disabled state indicators ("Unavailable with one layer"). |
| **Sketch** | "Dials on a stove" anti-pattern: scattering rotation, flips, skew, and corner radiuses across disconnected toolbars and inspector regions. | Clustered segmented pill group (`.insp-flip-group`) housing Flip H, Flip V, and Skew immediately adjacent to the R field. |
| **Web Applications (General)** | Failure to specify `scrollbar-gutter: stable` causes horizontal reflows and control occlusion whenever disclosures expand. | Standardized `scrollbar-gutter: stable` + `overflow-x: hidden` with a custom 8px themed WebKit scrollbar track. |

---

## 3. Implementation Details

### 3.1 Inspector CSS Architecture (`packages/editor/src/components/Inspector/inspector.css`)
- Added `scrollbar-gutter: stable;` and `overflow-x: hidden;` to `.editor-inspector > .insp-panel`.
- Created slim 8px themed scrollbars (`::-webkit-scrollbar`, `::-webkit-scrollbar-thumb`) matching `@varve/ui` tokens.
- Lowered sticky header `z-index` to `1` so scrollbar tracking is never occluded.
- Standardized synchronized 4-track grid for both Position and Size:
  ```css
  .insp-field-group--position,
  .insp-field-group--size {
    gap: var(--space-2);
    grid-template-columns:
      minmax(0, 1fr) var(--component-compact-height) minmax(0, 1fr)
      var(--component-compact-height);
  }
  ```
- Implemented `.insp-flip-group`: a compact segmented pill (`border: 1px solid var(--color-border-subtle); background: var(--color-surface-sunken)`) containing 24×24px WCAG 2.2 compliant icon buttons for Flip H, Flip V, and Skew.
- Enforced `flex-direction: row` on `.insp-field-group--rotation` so rotation angle `R` and the flip/skew pill sit on the exact same row without wrapping or centering.
- Fixed numeric field label-to-input gap by setting fixed 14px label tracks (`grid-template-columns: 14px minmax(0, 1fr)`) with `justify-self: start` specifically scoped to `.insp-field-group--position` and `.insp-field-group--size`.
- Restored `grid-template-columns: max-content minmax(0, 1fr)` on generic `.insp-field-group--columns-2` and `.insp-field-group--columns-3`, resolving the label truncation bug in the Sizing section (`Min W`, `Max W`, `Min H`, `Max H`) which previously rendered clipped as `MI` and `MA`.
- Centered the swap orientation button (`.insp-orientation-btn`) directly between Width (`W`) and Height (`H`) in track 2 of the size row, moving the proportion lock (`.insp-proportion-lock`) to track 4, cleanly matching the user's mental model that the swap action sits between the dimensions it operates on.
- Preserved clean, unbordered text on `.insp-align-section__summary` to maintain clean single-line section headers without wrapping.

### 3.2 Component Enhancements (`PositionSizeSection.tsx` & `LayoutSection.tsx`)
- Added `displayLabel="X"`, `displayLabel="Y"`, `displayLabel="W"`, `displayLabel="H"`, and `displayLabel="R"` to `<NumberField>`. Visible labels display clean single letters, while the underlying DOM preserves full accessible names (`X (px)`, `W (px)`) and APG spinbutton roles.
- Added `displayLabel="Min W"`, `displayLabel="Max W"`, `displayLabel="Min H"`, `displayLabel="Max H"` to `LayoutSection.tsx`.
- Positioned `.insp-orientation-btn` between W and H in Track 2, while preserving `.insp-field-group__action-slot` in Track 4 to maintain pixel-perfect 4-track alignment with X and Y.
- Enclosed Flip H, Flip V, and Skew within `<div className="insp-flip-group" role="group" aria-label="Transform controls">`.

### 3.3 Documentation & Marketing Updates
- **Interface Overview Docs** (`apps/website/src/pages/docs/getting-started/interface.astro`):
  - Documented balanced Position & Size numeric rails and single-letter display labels.
  - Documented `scrollbar-gutter: stable` architecture and elimination of scrollbar occlusion.
  - Documented clustered transform controls and orientation toggle.
- **Precision Editing Marketing Page** (`apps/website/src/pages/features/precision-editing.astro`):
  - Added feature card on "Geometry that adapts" with stable scrollbar gutters.
  - Added feature card on "Balanced transforms" detailing grouped controls and centered proportion locks.

---

## 4. Verification & Validation Evidence

### 4.1 Unit Tests
- `packages/editor/src/components/Inspector/sections/PositionSizeSection.test.tsx`:
  - 3/3 passed (orientation swap, preset dropdown, layout-computed axes).
- `packages/editor/src/components/Inspector/sections/AlignDistributeBar.test.tsx`:
  - 12/12 passed (shared capability rules, single/multi-selection targets, gap distribution, tidy up).

### 4.2 Playwright E2E & Responsive Surface Verification
Executed under heavy-task lease (`scripts/quality/heavy-lease.mjs`) on isolated dev server port:
- `tests/e2e/inspector/inspector-responsive-surface-audit.spec.ts`:
  - **5/5 passed**:
    1. Position & Size keeps bounded numeric rails across Inspector widths (240px, 280px, 320px, 400px, 640px) with `overflow <= 1px`.
    2. Image Fill and placement controls compose without duplicate Fit or overflow.
    3. Frame geometry and Stack / Grid keep stable inspector rails (right-edge delta <= 1px between X/W and Y/H).
    4. Frame inspector keeps its geometry contract at 200% text scale.
    5. Sticky section headers own the Inspector scroller inset without occluding scrollbars.
- `tests/e2e/inspector/inspector-redesign-baseline.spec.ts`:
  - **8/8 passed**: Captured fresh baseline and post-redesign screenshots across no-selection, rectangle, frame, text, image, multi-same, and multi-mixed selections under `docs/screenshots/2026-09-17-inspector-review/`.

### 4.3 Audits
- `pnpm audit:docs`: 0 violations (1011 docs, 569 links, 174 ADRs indexed).
- `pnpm audit:emoji`: 0 violations (4883 files scanned).
- `pnpm audit:tokens`: 213/213 WCAG 2.2 AA color contrast pairs pass across light, dark, and high-contrast themes.

### 4.4 Layout Integrity & Swap Orientation Geometry
- Centered the swap orientation button (`[ ⇄ ]`) directly in the middle between Width and Height (`Track 1: W`, `Track 2: [ ⇄ ]`, `Track 3: H`, `Track 4: [ 🔗 ]`).
- Removed the legacy `@container inspector (max-width: 20rem)` query that previously suppressed the orientation button and forced the proportion lock to center at rails under 320px.
- Restored unclipped sizing labels (`Min W`, `Max W`, `Min H`, `Max H`) by scoping 14px fixed label widths strictly to single-letter field groups (`.insp-field-group--position`, `.insp-field-group--size`).


