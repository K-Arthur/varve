# ADR-0044: Historical preview isolation

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0019, ADR-0043

## Context

Previewing a historical revision must never disturb the working document:
no state replacement on hover, no undo entries, no autosave, no collab
broadcast, no unsafe reuse of live caches — and no accidental edits.

## Alternatives

1. Preview by swapping editor state with the historical revision — mutable
   live path; rejected.
2. A read-only replay session isolated from the live editor state (chosen).

## Decision

Historical preview renders the target revision (canonical document or
snapshot, ADR-0021/0022) through the read-only replay path with a
clearly-marked historical banner (revision + branch context). It: never
writes to editor state beyond a distinct preview session; never creates undo
entries; never triggers autosave; never broadcasts collab changes; uses only
read-only rendering caches; forbids edits without an explicit
checkout/branch/restore action. Commands: Return to current, Branch here,
Restore here, keyboard escape path. Preview thumbnails are lazily rendered
and bounded. Editing paths opened from preview must pass through the
dirty-state workflow (ADR-0043).

## Consequences

- **Migration impact:** none.
- **Backward compatibility:** live editor path untouched.
- **Cross-platform/Performance:** preview replay cost bounded by revision
  size; no hidden-panel preview loops.
- **Security:** preview inputs are validated documents.
- **Accessibility:** banner and actions are announced; keyboard complete.
- **Rejected shortcuts:** hover-to-replace editor state; previewing by
  loading the revision into the live document; mutating live caches during
  preview.
