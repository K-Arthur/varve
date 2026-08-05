# Varve Design Principles

**Status:** Adopted 2026-07-27
**Scope:** `@varve/ui` internal product design system — Varve's own application chrome.
**Related:** ADR-0002 (tokens), ADR-0011 (design system governance), `visual-direction.md` (adopted patterns).

These principles resolve disagreements during component and layout design.
Each is concrete enough to guide an implementation choice.

---

## 1. Content is the product

The canvas and the user's artwork dominate visually. Chrome recedes.
- Panel borders are `--border-micro` (1px, low opacity) — not bold separators.
- Surfaces use near-white or near-black neutrals; the saturated accent appears only on interactive elements, never as a surface fill.
- No decorative color block competes with canvas content for attention.

**Test:** If a user screenshots their work, the chrome should be the least noticeable part of the image.

## 2. One action, one way

Similar actions look and behave consistently across all surfaces.
- "Delete" is always red (`--color-feedback-danger`), always has `aria-label="Delete"`, always requires confirmation when destructive.
- "Close" is always `Escape` or the same icon position — never `Escape` in one dialog and a swipe in another.
- All selects use the same `Select` component — no hand-rolled dropdowns.

**Test:** If a user learns a pattern in the Layers panel, the same pattern works in the Export dialog.

## 3. Progressive disclosure, not progressive obscurity

High-frequency actions are visible. Advanced capabilities are reachable but not in the way.
- Primary tools are in the toolbar; secondary tools are in the Inspector; expert features are in the command palette.
- Settings panels use disclosure sections — defaults are visible, advanced options are collapsed.
- "More options" means a real reduction in complexity, not a dumping ground for controls that didn't fit.

**Test:** A new user can complete their first task without opening a single disclosure section.

## 4. Input mode is not a second-class citizen

Mouse, keyboard, touch, pen, and trackpad are all first-class.
- Every interactive element is keyboard-reachable with a visible focus indicator (`--color-border-focus`).
- Touch targets are ≥ 24×24px even when the visual element is smaller (enlarged invisible hit area).
- Pen and touch gestures (pinch-to-zoom, pan, long-press context menu) have keyboard equivalents.
- No feature requires a specific input mode unless the feature is inherently pointer-based (freehand drawing).

**Test:** A user can complete a full session using only the keyboard and never lose track of where focus is.

## 5. Density serves the workflow

Compact mode exists for professional workflows with large monitors, not to cram more controls into less space.
- Density changes control height, padding, and gaps — never font size below the minimum readable threshold (11px actual).
- Touch density enforces larger targets — it never shrinks them.
- A control in compact mode must remain operable; if it can't, it stays at comfortable density.

**Test:** Compact mode at 100% zoom is legible on a 13" laptop screen without zoom.

## 6. State is communicated through more than color

No state relies on color alone.
- Selection has both color (`--color-tree-row-selected`) and a left-edge accent bar.
- Error has both color (`--color-feedback-danger`) and an icon and text.
- Disabled has both color (`--color-text-disabled`) and `aria-disabled` (or `disabled`) so assistive technology announces the state.
- Focus has a visible ring (`--color-interactive-focus-ring`) — it is never "just a slight brightness change."

**Test:** In high-contrast mode, every state difference remains visible.

## 7. Destructive actions are distinguishable and recoverable

Delete, clear, overwrite, and replace are visually and interactionally distinct from routine actions.
- Danger buttons use the `danger` variant — red, never teal or gray.
- Destructive actions in menus use `role="menuitem"` with a danger styling hook and are separated from routine items by a separator.
- Destructive actions that cannot be undone require explicit confirmation (type-to-confirm or checkbox).
- Actions that CAN be undone show a toast with an Undo option where feasible.

**Test:** A user who accidentally triggers a destructive action has at least one chance to prevent it.

## 8. Offline and degraded states are honest

When connectivity, GPU, or model availability changes, the UI communicates the state without ambiguity.
- A disabled button with `aria-disabled` and a tooltip explaining why is required — a visually disabled control with no explanation is not acceptable.
- Loading states are `aria-busy="true"`; empty states are `role="status"` with explanatory text; error states are `role="alert"` or `aria-live="assertive"`.
- "Unavailable" (feature exists but can't run now) is different from "hidden" (feature doesn't exist) — the UI reflects this distinction.

**Test:** A user on a plane understands what works offline and what doesn't, without guessing.

## 9. Appearance modes preserve meaning

Light, dark, and high-contrast themes are not color inversions — they are deliberate redesigns of the visual hierarchy.
- High-contrast mode increases border width, uses system color keywords under `forced-colors`, and removes shadow-based depth cues in favor of outline-based ones.
- Token values are chosen per-theme so that contrast ratios hold in all three themes — no token is "the same hue, darker."
- The accent hue shifts in high-contrast mode (teal → yellow-green) to maintain 3:1 UI contrast against black.

**Test:** Switching from dark to high-contrast mode, no element becomes invisible or ambiguous.

## 10. The interface scales without breaking

Desktop-first, but the chrome adapts to varied window sizes.
- At narrow widths, toolbars overflow into a menu — they don't truncate essential actions.
- Panels collapse to icon-only with toolbars, not to zero-width.
- Dialogs reflow; they don't horizontal-scroll.
- Text scaling up to 200% doesn't cause controls to overlap or clip.

**Test:** At 1280×720 window size, every primary action is reachable without horizontal scrolling.

---

## When principles conflict

Resolution order:
1. Accessibility (principles 4, 6) always wins.
2. Content dominance (1) wins over chrome discoverability.
3. Consistency (2) wins over novelty.

Document the conflict and resolution in the PR description.
