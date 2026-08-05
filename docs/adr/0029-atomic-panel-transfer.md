# ADR-0029: Atomic panel transfer

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Detach/reattach/move must never leave zero or two instances of a singleton
panel, and must never destroy panel-local state mid-flight. The current
mount model (Shell unmounts or keeps panels per booleans) is not
transactional.

## Alternatives

1. Unmount source, then mount destination, then fix up (rejected: crash
   window leaves the panel gone).
2. Two-phase commit with a source that stays mounted until the destination
   acknowledges (chosen).

## Decision

Implement the transfer state machine as a broker-owned transaction:

```
IDLE → PREPARING_SOURCE → CREATING_DESTINATION →
WAITING_FOR_DESTINATION_READY → HYDRATING_DESTINATION →
DESTINATION_ACKNOWLEDGED → COMMITTING_LAYOUT → REMOVING_SOURCE_INSTANCE
→ COMPLETE
```

with rollback edges from every state back to IDLE, restoring the previous
valid layout.

- Flow: validate detach capability + singleton/document constraints
  (ADR-0019/0027) → capture bounded, typed panel-local state
  (`prepareForTransfer`, ADR-0019 codec) → `TransferTransactionId` →
  mark source `transferring` (dimmed, still functional) → create or
  identify destination window (ADR-0022) → wait for `WINDOW_HYDRATED`
  with startup timeout → send panel definition + instance id + local
  state → wait for `DESTINATION_ACKNOWLEDGED` → commit the layout change
  atomically (pure dock ops, ADR-0021) → deactivate source mount →
  focus destination → COMPLETE.
- Failures (window create fails, hydration timeout, duplicate ack, stale
  transaction, close-during-transfer) roll back: keep/restore the source,
  close an unused destination if safe, clear transfer state, emit a
  recoverable error, and preserve exactly one instance.
- Reattach: offer previous-host hint, primary left/right docks, another
  auxiliary window, or new window; previous host may no longer exist —
  the hint is validated before use.
- When an auxiliary window's last panel transfers out, the empty window
  closes only after the destination acknowledges (ADR-0030).

## Consequences

- Transfer is a first-class, tested state machine (every transition and
  failure injection, ADR-0042).
- Panel-local state survives where safe; ambiguous input (IME, active
  pointer capture, open modal) blocks or resolves per panel policy
  (ADR-0034).

## Migration impact

None; new subsystem.

## Cross-platform implications

Destination-window creation and focus differ per OS, but the state machine
is OS-agnostic; failure injection tests run on memory/browser/tauri
transports.

## Security implications

Transfer messages are validated envelopes (ADR-0023); a destination cannot
claim a panel it was not assigned; duplicate acks are idempotent.

## Accessibility implications

Keyboard-driven transfer moves focus into the detached panel after
hydration; reattach restores focus to the panel in its destination;
live regions announce each phase ("Layers panel detached into Window 2").

## Performance implications

Bounded snapshot sizes keep hydration fast (M7 budget: detach < 1 s p95);
rollback never leaves orphan windows.

## Rejected shortcuts

Fire-and-forget unmount+remount; optimistic layout commit before
destination readiness; blocking the UI while a window is created.
