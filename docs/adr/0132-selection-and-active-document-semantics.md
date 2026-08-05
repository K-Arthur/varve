# ADR-0132: Selection and active-document semantics

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Selection lives in the session (`state.selection`, `SelectionProvider`,
`context/SelectionContext.tsx:44-219`) and follows the active tab
(snapshots on switch). With panel windows, we must decide whether selection
is global or per-view, and what "active document" means in a detached panel.

## Alternatives

1. Per-window selection with sync — rejected: split-brain selection makes
   undo/context unpredictable.
2. Shared session selection, panel windows follow the active document,
   document pinning deferred (chosen for M7/M8).

## Decision

- **Selection is session-shared** for panel windows: detached panels see
  and manipulate the same selection as the primary canvas. (A future
  `DocumentView`-scoped selection only appears with canvas windows,
  ADR-0142.)
- **Active document is session-shared**: switching tabs in the primary
  updates every detached document-dependent panel (context label + values).
  Panels display their context in the panel chrome: "following active
  document" or "no document available" — never a stale name.
- A panel mid-edit resolves or cancels its local edit before the document
  context switches (ADR-0138/0034 panel-local policies).
- **Document pinning is deferred** (pinned panels must define close/switch
  behavior, cross-document mutation protection, and visual distinction).
  Until then `documentRequirement: 'active-document'` panels follow the
  active document; `documentId` pinning fields exist in the instance model
  but are unused.
- Never display one document while submitting commands to another: every
  command carries `activeDocumentId`; the broker rejects mismatches
  (ADR-0130).

## Consequences

- Detached Inspector edits always land in the document the user sees.
- Switching documents broadcasts one patch set; panels reconcile their
  local unsaved input first.

## Migration impact

None; selection/active-document state is unchanged in the primary.

## Cross-platform implications

None.

## Security implications

Command `activeDocumentId` validation prevents cross-document mutation
(ADR-0145).

## Accessibility implications

Panel chrome announces "following active document" and document name
changes; screen readers in detached windows get live updates via the
session channel.

## Performance implications

Selection patches are coalesced (ADR-0129) — a drag-selection in the
primary produces at most one patch per frame to detached windows.

## Rejected shortcuts

Per-window selection; letting panels keep editing after a document switch;
silently pinning a panel to the first document it sees.
