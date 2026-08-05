# ADR-0025: Command routing

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Today, mutation is direct: panels call context methods (`setSelectedOpacity`
→ `updateDoc`, `context.tsx:4287-4317,2488-2516`). Detached panels live in
another JS context and cannot call the canonical provider's methods. The
`ActionRegistry` (`actions/ActionRegistry.ts`) is a per-window UI facade,
not a serializable command bus.

## Alternatives

1. Replicate the provider per window and hope state converges — rejected
   (ADR-0017).
2. Route every detached-panel mutation through the existing action system
   by name — insufficient: actions close over a window-local context value;
   panel mutations like `setSelectedOpacity` are context methods, not
   registry actions.
3. A **typed command client** on the broker that re-enters the canonical
   provider through its own methods (chosen).

## Decision

- Define `SubmitEditorCommand` (`commandId` uuid, `originWindowId`,
  `originPanelInstanceId`, `activeDocumentId`, `expectedRevision?`,
  `commandType`, `payload`) in the protocol module (ADR-0023).
- `commandType` is a closed, validated union mapped to canonical provider
  methods (initial set: `set-opacity`, `rename-node`, `set-fill`,
  `set-transform`, `delete-nodes`, `undo`, `redo`, `set-selection`,
  `switch-document`, `save-document`). Registration is a table
  `commandHandlers.ts` with per-command payload schema validators.
- Broker pipeline: validate session/sender/generation → validate panel
  capability (registry, ADR-0019) → validate active document (ADR-0027) →
  validate payload schema → apply **once** via the canonical provider
  (idempotency by `commandId` dedupe in a bounded window) → undo/redo
  update naturally (single stack, ADR-0026) → bump session revision →
  fan out resulting patches (ADR-0024) → `COMMAND_ACK` (with new revision)
  or `COMMAND_REJECT` (with reason) to the origin.
- Stale commands (`expectedRevision` mismatch) are rejected, not silently
  applied; the origin resyncs.
- Undo/redo from any window are broker-routed commands; the invoking window
  does not own a private stack.

## Consequences

- Detached panels never mutate a replicated store; every mutation has one
  application point, one undo entry, one revision bump.
- The canonical provider's public surface doubles as the command handler
  registry; no new mutation path is created for windows.

## Migration impact

None; the command client is additive. Direct calls inside the primary
window remain direct (no round-trip for the same-window fast path).

## Cross-platform implications

Transport-agnostic; the same command routing runs over Tauri events,
BroadcastChannel, and memory transports.

## Security implications

Commands are validated end-to-end (ADR-0040); `commandType` is allowlisted;
payload size is bounded; `commandId` dedupe prevents replay.

## Accessibility implications

`COMMAND_ACK`/`REJECT` drive live-region announcements in the origin
window ("Layers panel: rename applied").

## Performance implications

One IPC hop per detached edit (target < 20 ms round-trip budget, M8);
same-window edits stay synchronous. Coalesced inspector drags submit at
transaction boundaries (ADR-0026).

## Rejected shortcuts

Broadcasting `setState` closures; duplicating undo stacks per window;
treating every context method as a generic callable string command
(untyped, unvalidated).
