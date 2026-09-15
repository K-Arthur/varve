# ADR-0123: State partitioning across windows

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

The editor holds all state in one `EditorState` object
(`context/types.ts:130-364`). Synchronizing all of it into every window would
multiply memory, flood IPC, and re-run window-unscoped side effects.
State must be classified so each value has exactly one home and one sync
policy.

## Alternatives

1. Sync everything (reject: per-window resources like canvas viewports and
   ephemeral gesture state have no meaning off-window).
2. Projection-based sync, where each auxiliary window subscribes only to the
   slices its panels need (chosen).

## Decision

Adopt the explicit scope taxonomy from the program spec:

- `document-shared` — scene nodes, pages, styles, components, variables,
  document metadata, prototypes, timelines (the `Document` object itself).
- `session-shared` — open-document list, active document policy, undo/redo
  stacks, workspace mode, shared selection, collaboration connection, save
  authority.
- `window-local` — focused panel, native geometry, maximized/fullscreen,
  window-level menus, zoom where supported.
- `panel-instance-local` — scroll, expansion, search query, active tab,
  filters (stays in the panel component; serialized for transfer).
- `machine-local` — monitor map, saved window placement, named layouts,
  display fingerprints (never in the document, never broadcast).
- `ephemeral` — hover, pointer capture, drag preview, open context menu,
  tooltips, IME composition.

The broker (ADR-0128) publishes a **snapshot projection** (ADR-0129) built
from the `session-shared` + the `document-shared` slices required by the
hosted panels. `window-local` and `machine-local` state never crosses the
session channel.

## Consequences

- Auxiliary windows cannot rely on editor-internal invariants that assume a
  canvas (e.g. `document.querySelector('.editor-canvas')`,
  `context.tsx:3527,3541`) — those become window-local in the primary.
- Panel-local state survives transfer only through the typed, versioned
  local-state codec (ADR-0124), never through raw React state capture.
- The scope taxonomy is recorded in the type system as
  `StateScope` documentation on each projected field.

## Migration impact

Existing `state.*` fields get classified in `context/types.ts` comments;
no storage migration needed (M2+).

## Cross-platform implications

Monitor/geometry handling is machine-local on every OS; Wayland constraints
(ADR-0138) only affect the `machine-local` layer.

## Security implications

Machine-local state (monitor geometry, file paths) is never serialized into
session messages, crash reports, or shared layouts (ADR-0145, privacy).

## Accessibility implications

`ephemeral` state per window means each window keeps its own focus/ARIA live
regions; the broker coordinates only session-level announcements.

## Performance implications

Panels request only needed slices; a Layers-only window does not receive the
full scene when document projections can be pruned (deferred refinement in
M8; v1 sends document descriptors + selection + mode + layout).

## Rejected shortcuts

Synchronizing `EditorState` wholesale per update; syncing per-window
viewport/canvas state; storing panel-local UI state in a shared store.
