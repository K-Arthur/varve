# ADR-0141: Drag and drop across native windows

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

HTML drag events do not reach another WebView; pointer capture ends at the
source window boundary; native drag differs on Linux WebKitGTK; Wayland
restricts positioning. Perfect Photoshop-style tear-off dragging is not a
reliable baseline on all platforms.

## Alternatives

1. Block all dragging and rely on commands alone (safe but poor UX).
2. Ship command-driven transfers first, then progressive drag layers
   (chosen).

## Decision

- **Reliable baseline (M7):** detach button, context-menu actions,
  "Move panel to..." command, workspace manager (keyboard-accessible).
- **Enhanced (M13, only after command transfers are stable):**
  in-app drag of a panel tab to another Varve window uses the broker
  protocol (a drag is a *proposed transfer* carrying panel instance id and
  a drop-target window id; no HTML dataTransfer across windows). Native
  drag payloads are validated like any envelope (ADR-0128/0040).
  - Source window renders a drag preview locally; on pointer exit it
    converts to a broker-proposed transfer; destination windows show
    native drop highlights when the broker broadcasts the pending
    transfer.
  - Cancel paths: Escape, drop on invalid target, monitor disconnect
    during drag, source window losing focus (pointer capture end) —
    all cancel the proposed transfer, never a partial one.
  - Scale factors across mixed-DPI displays: coordinates are converted
    via the display scale of each window (ADR-0138), and drop targets
    are resolved by window id, not by coordinates, to avoid Wayland
    coordinate ambiguity.
- Platform audit gates the enhanced layer: if Linux WebKitGTK cannot
  deliver reliable drag-exit events, the enhanced layer degrades to
  click-to-move on Linux while commands remain fully functional.

## Consequences

- No essential operation requires dragging (acceptance criterion).
- Cross-window dragging never bypasses the transfer state machine
  (ADR-0134) — it merely *proposes* a transfer.

## Migration impact

None.

## Cross-platform implications

Documented per-OS: Wayland restrictions (no global drag), WebKitGTK drag
behavior, Windows mixed-DPI, macOS full-drag support; the baseline is
identical everywhere.

## Security implications

Drag payloads are typed envelopes, not serialized DOM; size-bounded;
destination windows cannot be spoofed into accepting arbitrary content.

## Accessibility implications

Every drag action has a keyboard equivalent (ADR-0146); drop targets have
visible focus states.

## Performance implications

Drag previews are window-local canvases; broker traffic is limited to
proposal/highlight/cancel events (coalesced).

## Rejected shortcuts

HTML5 dataTransfer across windows; global coordinate-based drop targeting
(breaks under Wayland); blocking the feature on perfect tear-off drag.
