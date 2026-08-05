# ADR-0021: Dock-tree representation

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Panel arrangement is hard-coded in Shell's CSS grid (`editor.css:111-146`):
layers left, inspector right, others in fixed positions. Widths are CSS vars,
visibility is boolean flags, and the designed-but-dead per-mode override
store (`workspaceStore.ts`) never made it to runtime. Multi-window panels
need a single model that can represent sidebars, splits, tabs, and auxiliary
window roots — serializable, pure, and testable without React.

## Alternatives

1. Keep the CSS-grid approach and add per-window CSS — rejected: no
   model for tabs/splits, no serialization, no validation.
2. Third-party dock library — rejected: none fit the existing
   workspace-mode semantics; the model is small enough to own.

## Decision

Implement a pure dock-tree model in
`packages/editor/src/workspace/dock/`:

```ts
type DockNode =
  | { kind: 'split'; id: DockNodeId; direction: 'row' | 'column'; ratio: number;
      first: DockNode; second: DockNode }
  | { kind: 'tabs'; id: DockNodeId; activePanelInstanceId?: PanelInstanceId;
      panels: PanelInstanceRef[] }
  | { kind: 'panel'; id: DockNodeId; panelInstanceId: PanelInstanceId }
  | { kind: 'empty'; id: DockNodeId };
```

- `WorkspaceWindowLayout` = role (`primary` | `auxiliary-panel`), `dockRoot`,
  `placement`, `state`; `NativeWorkspaceLayout` = versioned collection of
  windows + name + mode association (ADR-0032).
- Pure operations in `dockOps.ts`: `insertPanel`, `removePanel`,
  `splitHost`, `tabGroup`, `movePanelToWindow`, `collapsePanel`,
  `mergeEmptyNodes`, `normalizeDockTree`, `serializeDockTree`,
  `deserializeDockTree`, `migrateSidebarPreferences` (from
  `settings.panel` flags/widths).
- Invariants enforced by `validateDockTree` and property-tested:
  each panel instance in at most one host; singleton policy respected;
  all referenced ids exist; ratios finite in (0,1); removal never corrupts;
  serialize/restore round-trips; random op sequences leave no unreachable
  panels (fast-check).
- Splits are the unit of width/height: `ratio` replaces
  `--sidebar-width`/`--inspector-width` for windows that use the dock model;
  the primary window keeps its grid until M12 browser fallback lands.

## Consequences

- Shell rendering can later derive from the dock tree without import
  budget damage (the mapping lives in a thin adapter).
- Panel visibility flags and widths migrate from `settings.panel` into the
  layout store once M9 lands; until then the dock model coexists and the
  migration function is tested in isolation.

## Migration impact

`migrateSidebarPreferences` reads `varve-editor-settings.panel` and
`varve-workspace-preferences` and produces a normalized dock tree; the
single-window browser layout is exactly one `WorkspaceWindowLayout` whose
root is a split with tabs.

## Cross-platform implications

The dock model is pure and OS-agnostic; placement stays out of the dock tree
(`machine-local`, ADR-0032).

## Security implications

Imported layouts (ADR-0032) are validated by `deserializeDockTree` before
any node is applied; malformed ratios/ids are rejected, not guessed.

## Accessibility implications

Keyboard-resizable splits (existing APG separator pattern in
`PanelResizeHandle.tsx`) generalize to any split node.

## Performance implications

Normalized trees are small; operations are O(depth); serialization is
bounded and id-based, so panel-local state is never duplicated into the tree.

## Rejected shortcuts

Storing absolute pixel positions in the tree; treating the tree as a map of
booleans; letting React components own tree mutation (all mutations go
through pure ops).
