# ADR-0116: Undo, redo, and transaction semantics

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Varve's undo is document-snapshot based (`updateDoc` pushes the previous doc
onto a 50-deep undo stack, `context.tsx:2488-2516`). Synchronization adds
new mutation surfaces (import, sync apply, conflict resolution, source
disconnect) plus external side effects (file writes, Git actions) that must
NOT be inside the document undo history.

## Decisions

### D1 — Separation of mutation domains

- Varve document mutation: undoable (existing stack).
- External file mutation: never undone by Varve undo; explicit reconciliation
  only.
- Git mutation: never undone; explicit actions only (ADR-0113).
- Remote platform mutation: never automatic (ADR-0114).

### D2 — Sync operations are single undo transactions

Initial import, token creation, rename, move, value/type/alias edits, mode
edits, resolver context edits, bulk binding, sync apply, conflict
resolution, multimodal proposal apply, and source disconnect (where it
mutates token ownership) each apply through one coherent `updateDoc`
transaction. Cancel restores the exact pre-preview state.

### D3 — Undo honesty

Undoing a sync transaction leaves external files untouched; Sync Center then
reports the document as having local changes relative to the source (the
undo is a local edit, not a source write). After undo/redo the sync state
machine recomputes from the current document snapshot (revision-based).

## Alternatives

- Pushing external writes into the undo stack — rejected: undoing would
  silently rewrite repositories.
- Side-effect-free "preview snapshots" shared with the undo stack — rejected:
  the 50-deep bound and snapshot cost of token libraries argues for
  transactional application with recompute-on-undo.

## Consequences

- Sync apply is atomic with the document (all-or-nothing), while the source
  is only ever written through the explicit write pipeline (ADR-0112).
- Playwright workflows 2/3 verify: undo sync → source file unchanged →
  reconcile explicitly; undo → redo keeps source state honest.

## Migration impact

None.

## Compatibility impact

None.

## Security considerations

Transaction payloads are validated before application (same gates as
imports).

## Rejected shortcuts

- Undoing file writes.
- Applying merge plans in multiple `updateDoc` calls (partial application).
- Letting AI results mutate scene JSON directly (ADR-0118).
