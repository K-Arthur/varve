# ADR-0206: Dock-tree representation

- **Status:** Accepted
- **Date:** 2026-08-07

## Context

Panel arrangement across windows requires a normalized, serializable layout
model. The current Shell.tsx uses flat CSS Grid with hardcoded panel slots.
Multi-window support needs a recursive dock tree that represents splits,
tabs, and empty regions.

## Decision

D1 — A dock tree is a recursive discriminated union:

```
DockNode = DockSplitNode | DockTabGroupNode | DockPanelNode | DockEmptyNode
```

D2 — `DockSplitNode` holds a direction (`horizontal` | `vertical`), two
   children, and a split ratio (0..1). `DockTabGroupNode` holds an ordered
   array of panel instance IDs with an active tab index. `DockPanelNode`
   holds one panel instance ID. `DockEmptyNode` is a drop target.

D3 — Every node has a stable `DockNodeId` (collision-resistant string).
   Every panel instance has a stable `PanelInstanceId`.

D4 — Pure operations (insert, remove, move, split, merge, normalize) are
   functions `DockNode → DockNode` testable without React or Tauri.

D5 — Serialization produces a flat normalized form. Recursive trees are
   serialized as arrays with parent/sibling references to avoid deep nesting.

## Consequences

- Layout operations are deterministic and testable.
- Serialization is compact and versioned.
- Invalid trees (orphaned panels, empty splits) are normalized on load.

## Migration impact

Current sidebar widths and visibility migrate into an initial dock tree
representation. The migration reads `settings.panel.leftPanelWidth` etc.
and produces a dock tree on first run.

## Rejected shortcuts

- Flat panel-position arrays (no split representation).
- CSS-only docking (no programmatic layout operations).
