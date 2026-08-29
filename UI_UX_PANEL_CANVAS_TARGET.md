# Varve Panels and Canvas Information Target

Date: 2026-08-29
Status: target for progressive implementation; changes are intentionally
incremental and rollback-friendly.

## Product target

Varve should feel like a dependable professional editing workspace: the canvas
gets the largest stable region, panels answer one task each, common controls
stay in predictable locations, and contextual information follows the user's
current selection without becoming duplicate noise.

## Information architecture

```text
Editor shell
├── Global navigation: menubar, workspace tabs, document tabs
├── Tool context: floating toolbar and tool options
├── Canvas: artwork, guides, selection affordances, transient HUD
├── Left navigation: minimap, pages, layers, variables/resources
├── Right context: Properties, Appearance, Adjustments, Prototype, Export, Audit
├── Bottom status: selection summary, save/backend health, units, snap, zoom
└── Transient: menus, dialogs, help, progress, toasts
```

The taxonomy is task-based, not frequency-based. Workspace modes select the
appropriate contextual surfaces through `getEffectiveWorkspaceConfig`; they do
not silently reorder the primary hierarchy. Existing command and shortcut
registries remain the source of truth for alternate access.

## Panel rules

- Every persistent panel has one named landmark or a labelled composite widget.
- Header identity precedes header actions; title, detach, collapse, and overflow
  affordances must not compete with the first content row.
- One primary scroll container per panel. Nested scrolling is reserved for an
  independently navigable composite such as the layer tree.
- Common content is identity/context → common edits → related appearance →
  advanced/diagnostic controls.
- Empty, loading, unavailable, warning, and recoverable-error states explain
  what happened and what the user can do next.
- Primary control order is stable. Suggestions may be shown in a separate,
  dismissible region but may not move established controls.
- Resize is available by pointer and keyboard. A splitter exposes its range,
  current value, and controlled pane.
- Responsive layouts use drawers or overflow, not unreadably small controls.
- Opening a drawer gives it a predictable dismissal path; Escape, backdrop, and
  an explicit trigger all close it, and focus returns to the trigger.

## Typography and density

Use the existing `@varve/ui` tokens. The target hierarchy is:

| Level | Use |
|---|---|
| panel title | named panel identity, sentence case |
| tab label | short workflow name, stable order |
| section heading | one task group, no generic “Miscellaneous” |
| field label | noun/short phrase, aligned consistently |
| value/input | tabular numerics where appropriate; mixed state is explicit |
| helper/error | concise next-step guidance, never placeholder-only |
| canvas transient | short, high-contrast, operation-critical only |

Compact visuals are allowed where they preserve effective pointer targets and
visible focus. Test 100%, 125%, 150%, and 200% scaling before changing sizes.
Long labels wrap or truncate with a full-name path (`title` or accessible
name); numeric fields never clip signs, units, decimals, or mixed indicators.

## Selection-state model

Selection, focus, hover, and active editing are separate states:

```text
document selection ──┬── canvas outline/handles
                     ├── layers aria-selected + row styling
                     ├── inspector contextual content
                     ├── breadcrumb/path context
                     └── persistent selection summary

keyboard focus ──────── one visible focus target in each composite widget
active editing ──────── text/path/crop affordances only while that mode owns input
hover ───────────────── pointer hint; never the only state signal
```

The canvas overlay uses the same camera transform as artwork. Near-selection
dimensions remain useful during manipulation; the bottom strip is the stable,
named summary for keyboard and assistive-technology users. The two surfaces
must use consistent units, rounding, and selection identity.

## Tree semantics

`LayersTree` remains a virtualized APG tree with roving focus. Its logical flat
result carries `depth`, `parentId`, sibling position, and sibling count. The
virtualizer may omit DOM rows, but it must not change the logical hierarchy
reported through `aria-level`, `aria-posinset`, and `aria-setsize`.

Selection remains independent from focus in the multi-select tree. Keyboard
reorder, pointer drag/reparent, rename, expand/collapse, and context menus are
equivalent access paths and retain selection/focus where the operation permits.

## Overlay and z-index model

- artwork and canvas backing surfaces are the base;
- noninteractive guides and labels sit above artwork;
- selection handles and active tool controls share the centralized interactive
  overlay layer;
- menus/dialogs use the design-system overlay/top-layer mechanism;
- status and persistent shell chrome must not intercept canvas pointer input;
- screen-space hit targets may exceed visible marks, especially at zoom
  extremes;
- labels clamp to the viewport and avoid handles/pointer-critical targets where
  the owning overlay supports collision decisions.

## Responsive rules

- Desktop keeps both side panels when the canvas can retain its minimum width.
- At compact widths, side panels become fixed drawers with a scrim and explicit
  FAB triggers.
- The drawer width remains usable; content reflows or scrolls inside the drawer.
- The floating toolbar may scroll or collapse groups at phone widths; tools are
  never silently removed from keyboard access.
- Status controls preserve the most important state first: selection/save,
  units/zoom, then secondary view toggles.
- `dvh`, safe-area-aware spacing, and forced-colors/reduced-motion behavior are
  required for any new responsive surface.

## Accessibility interaction patterns

- Native buttons, inputs, headings, lists, and dialogs first.
- `tree/treeitem` for layers, with declared hierarchy metadata when virtualized.
- `tablist/tab/tabpanel` for inspector workflows, with one tab in the page tab
  sequence and arrow-key movement inside the tablist.
- Focusable `separator` for splitters with `aria-valuenow/min/max` and
  `aria-controls`.
- `toolbar` for grouped actions and a visible `:focus-visible` indicator.
- `status` only for concise state changes; avoid announcing every pointermove.
- Escape closes the innermost owned transient surface or responsive drawer
  before falling through to canvas/tool cancellation.
- Color never carries selection, warning, lock, or visibility state alone.
- Reduced motion removes decorative transitions but does not remove feedback.

## Performance ownership

- Keep virtualization and indexed layer search.
- Keep panel state local to the owning surface; avoid adding broad context
  subscriptions for presentational changes.
- Derive tree semantics in the same O(n) flatten pass rather than walking the
  document per row.
- Do not change render/replay hot paths for readability without the repository's
  benchmark harness.
- Measure selection changes, panel open/resize, long-tree scroll, and rapid
  reorder before adding memoization or throttling.

## Migration, rollback, and decision records

The first implementation slices are additive:

1. add logical tree metadata fields and consume them in rows;
2. add splitter semantics while keeping the existing width persistence and key
   bindings;
3. centralize responsive drawer dismissal/focus without changing panel owners;
4. name the persistent selection status surface.

Each slice can be reverted independently. Persisted panel width and section
state formats are unchanged. No feature is removed or hidden. If future visual
testing shows that a near-selection label obscures artwork at a specific zoom,
the rollback is to adjust its placement policy, not to remove the persistent
selection summary.

## Acceptance checklist

- panel and tree landmarks have useful names;
- nested/filtered tree rows announce correct sibling position and count;
- splitters announce a current value in fresh and persisted sessions;
- drawer close paths include Escape, scrim, and explicit trigger with focus
  restoration;
- selection remains synchronized among canvas, layers, inspector, breadcrumb,
  and status summary;
- near-selection information is legible and non-obstructive at tested zooms;
- keyboard and pointer paths produce the same observable result;
- no new control is inert, decorative, or unreachable;
- affected unit, E2E, accessibility, and visual checks are recorded in
  `UI_UX_PANEL_CANVAS_VERIFICATION.md`.
