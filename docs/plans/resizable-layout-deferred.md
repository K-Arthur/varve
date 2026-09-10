# Resizable Layout Follow-up

The shared resize handle migration covers the current docked pane boundaries
used by the editor shell and Resources overlay. The following work remains
intentionally deferred so it can be implemented with representative layouts
and browser coverage rather than speculative abstractions.

## Remaining Work

- Add a true `ResizablePanelGroup` composition primitive if a second pane-group
  surface appears; the current shell is CSS-grid based and does not need a
  library-sized abstraction yet.
- Add a vertical splitter for the canvas/timeline relationship if timeline
  height becomes user-resizable. Define a timeline minimum based on track and
  transport controls before implementation.
- Add nested-group fixtures covering horizontal outer plus vertical inner
  layouts, intersecting handles, focus routing, and propagated minimum sizes.
- Expand browser interaction coverage for minimum/maximum bounds, keyboard
  resizing, pointer cancellation, window blur, scrollbar adjacency, and
  narrow-window transitions.
- Capture light, dark, high-contrast, 1x, 1.25x, 1.5x, and 2x visual states
  for idle, hover, active, and focused handles.
- Verify Resources drag-and-drop and scrollbar boundaries with populated
  libraries and long inspector/timeline content.
- Revisit layout persistence migration when panel IDs or workspace schemas
  change. Current width values are clamped by the existing workspace store;
  versioned migrations are not yet required.
- Decide whether workspace reset should expose a user-facing reset-layout
  command for panel widths; double-click reset currently remains the local
  affordance for the migrated shell handles.
- Re-run the affected editor suite after the unrelated `AdjustmentPanel` and
  editor typecheck failures in the working tree are repaired.

## Deliberate Exceptions

Canvas object transforms, crop/warp/gradient/table controls, timeline ruler and
keyframe drags, dialog resizing, and native window resizing remain specialized.
They have different coordinate, history, or ownership semantics and should not
be migrated to docked-pane handles.

## Current Contract

`@varve/ui` exports `ResizableHandle`. Hosts own pane geometry, persistence,
constraints, and drag behavior. The handle owns the semantic hit target,
orientation, cursor, visual divider, optional grip, active state, focus state,
and reduced-motion styling.
