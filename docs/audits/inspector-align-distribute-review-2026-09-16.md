# Align & Distribute Inspector review — 2026-09-16

## Finding

`AlignDistributeBar` already has the correct domain gating: single selections
resolve to a parent frame or page, while distribution, key-object, Tidy Up, and
OBB controls appear only when they apply. Its prior presentation still left the
section context implicit. The section used an `h2` beside the Inspector's
`h2`/`h3` hierarchy and the current alignment target was only discoverable by
reading the active reference control.

## Decision

Keep this as a compact toolbar, not a disclosure or modal. Alignment is a
high-frequency operation and hiding its primary actions would recreate the
extra-click failure documented in the competitor research. Add a live summary
to the heading (`2 layers`, `Align to parent frame`, or `Align to page/canvas`)
so the current target remains legible while the controls are scanned.

The existing rules remain intentionally unchanged:

- inapplicable distribution and advanced clusters are omitted;
- unavailable reference targets remain keyboard-visible with an explanation;
- every alignment button names its target;
- Tidy Up remains a focused popover because its grid parameters are secondary;
- commands continue to use the shared editor operations and history path.

## Validation

Focused unit coverage exercises single root, single child, page/canvas,
multi-selection, fixed-gap distribution, Tidy Up, and ineligible selections in
`AlignDistributeBar.test.tsx`. The new summary is presentation-only; the
real-world Chromium audit remains required when the current Vite startup crash
is resolved.
