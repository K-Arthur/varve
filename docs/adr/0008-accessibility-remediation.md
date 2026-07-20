# ADR-0008: Accessibility Remediation — Interaction & Architecture Decisions

**Date:** 2026-07-20
**Status:** Accepted
**Context:** WCAG 2.2 AA compliance, ARIA Authoring Practices, cross-platform compatibility

## Context

Systematic accessibility audit identified 30 remaining findings across Critical, Major, Moderate, and Minor severity levels. This ADR documents the reversible interaction decisions made to resolve them.

## Decisions

### 1. FocusTrap blocks mouse focus via pointerdown

**Decision:** `FocusTrap` captures `pointerdown` events on `document` and redirects focus back into the trap when a click lands outside.

**Rationale:** The APG dialog pattern requires focus containment. Keyboard-only Tab trapping is insufficient — a mouse click outside the trap moves DOM focus to a background element. The `pointerdown` capture (not `click`) prevents focus from leaving.

**Alternatives considered:**
- `focusin` event on document: rejected because it fires after focus has already moved, causing a visible flash.
- `inert` on background siblings: used by `Popover` but not applicable to `FocusTrap` consumers that don't have a sibling relationship.

### 2. Context menus use arrow-key navigation with roving tabindex

**Decision:** Layer context menus implement ArrowUp/Down/Home/End navigation with `tabIndex={0}` on the focused item and `tabIndex={-1}` on others. Focus enters the menu on open and returns to the invoking element on close.

**Rationale:** W3C APG Menu pattern. The existing `MenuInternal` in `@strata/ui` already implements this for portaled menus. The LayersPanel's custom context menu was extended with the same keyboard model for consistency.

### 3. Keyboard reparenting uses Tab/Shift+Tab indent/outdent

**Decision:** In the Layers tree, `Tab` indents a node (moves into the previous sibling container) and `Shift+Tab` outdents (moves to the parent's parent). A "Move Into..." context menu item finds the first valid non-ancestor container.

**Rationale:** This follows the pattern established by Figma, Sketch, and VS Code's tree views. Tab/Shift+Tab are discoverable shortcuts that work without a dialog. The "Move Into..." context menu provides an explicit alternative for arbitrary reparenting.

**Alternatives considered:**
- Full tree picker dialog: rejected as over-engineered for the common case (indent into sibling).
- Drag-and-drop only: rejected because it requires pointer interaction and is inaccessible to keyboard-only users.

### 4. Command palettes use FocusTrap with aria-modal

**Decision:** `ShortcutPalette` and `QuickActionsBar` are wrapped in `<FocusTrap>` with `role="dialog"` and `aria-modal="true"`. Focus returns to the previously focused element on close.

**Rationale:** Both surfaces are modal command palettes that should not allow focus leakage into the canvas. The existing `FocusTrap` component handles Tab cycling, initial focus, and focus restoration.

### 5. Popover uses Escape key + descriptive aria-label

**Decision:** Popovers now respond to Escape key to close, and accept a `label` prop for `aria-label` (defaulting to "Popover").

**Rationale:** APG dialog pattern requires Escape dismissal. Generic "Popover" labels are useless to screen reader users — consumers should pass descriptive labels.

### 6. Toolbar uses APG roving tabindex via shared Toolbar component

**Decision:** `AlignDistributeBar` uses the `@strata/ui` `Toolbar` component which implements APG roving tabindex (ArrowLeft/Right/Home/End, single tab stop). Toggle buttons use `aria-pressed`.

**Rationale:** The `Toolbar` component already exists and implements the APG pattern correctly. Reusing it eliminates duplicated keyboard handling.

### 7. Proportion lock uses visible focus + aria-pressed state

**Decision:** The proportion lock checkbox uses `aria-pressed` for state communication, `aria-hidden="true"` on the decorative SVG icon (removing duplicate `aria-label`), and relies on the existing `:focus-visible` CSS rule on the label.

**Rationale:** The hidden checkbox pattern with visible label focus ring is a well-established accessibility pattern. `aria-pressed` communicates toggle state to screen readers.

### 8. Reduced-motion: disable CSS animations + skip JS camera animations

**Decision:** CSS `@media (prefers-reduced-motion: reduce)` rules disable keyframe animations (spinners, fades, slides) and set `transform: none`. JS camera animations (`smoothZoomTo`, `smoothPanTo`) check `prefersReducedMotion()` and skip to the final state.

**Rationale:** WCAG 2.3.3 requires disabling non-essential motion. The global `tokens.css` rule collapses duration custom properties to 0ms, but `@keyframes` animations need explicit `animation: none` rules.

### 9. Touch targets: enlarged invisible hit areas

**Decision:** Small interactive elements (layer toggles, disclosure arrows, search clear buttons) get enlarged hit areas via negative `margin` or `padding` while preserving their visual size.

**Rationale:** WCAG 2.5.8 (Target Size, Minimum) requires 24×24px targets. In a dense desktop editor, inflating visible sizes would break the layout. Enlarged invisible hit areas satisfy the requirement without visual changes.

## Consequences

- All dialog/command surfaces now have consistent focus management via `FocusTrap`.
- Keyboard-only users can operate context menus, reparent layers, and navigate toolbars.
- Screen readers receive correct state announcements (aria-pressed, aria-expanded, aria-modal).
- Reduced-motion users see no non-essential animation.
- Touch users have larger tap targets on small interactive elements.
- Cross-platform compatibility is preserved (no platform-specific APIs used).
