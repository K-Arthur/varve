# ADR-0025: Persistent identity format

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0026; audit `docs/audits/history-identity-inventory-2026-08-05.md`

## Context

Nodes and styles mint sequential ids (`n<N>`, `s<N>`) from one persisted
counter (`node-id.ts:4-7`, `styles.ts:338`); components, variables, and
imports use their own counters. Two branches of the same document independently
allocate **identical ids** — a merge must never let that happen. The only
parser is `maxNumericNodeId` (`documentCodec.ts:121-128`).

## Alternatives

- **UUIDv4 per entity:** 36-char ids, no ordering, changes every test/update
  site, no relation to existing format.
- **ULID:** timestamp-bearing — leaks creation time, hurts determinism
  guarantees, needs privacy review.
- **Random actor namespace + monotonic counter:** document-scoped counter with
  a random component (chosen below).

## Decision

New ids keep the human-readable prefix + counter and append a random
component: **`n<counter>_<16-hex-random>`** (64 bits randomness per
allocation) for node-space ids (nodes `n`, styles `s`, components, table
remaps), and pure-random suffixes (`col-<16-hex>`, `grp-<16-hex>`,
`v-<16-hex>`) for entities with no persisted counter (variables). Randomness
comes from `crypto.getRandomValues` with a documented fallback; an optional
RNG parameter keeps tests deterministic. The persisted counter continues to
bump, giving debuggable ordering; uniqueness within a document comes from the
counter, uniqueness across branches from the random component.

Legacy `n<number>` / `s<number>` ids remain **readable forever**
(compatibility period, ADR-0026); only new allocations use the new format.
`maxNumericNodeId` ignores new-format ids (its regex simply does not match),
so decode-time counter recovery stays safe; a small extension recovers the
counter from `n<counter>_<hex>` ids.

## Consequences

- **Migration impact:** zero forced migration; `migrateLegacyNodeIds` is
  available (ADR-0026) but not auto-run.
- **Backward compatibility:** all string-keyed collections are agnostic;
  clipboard/import regenerate ids anyway; no parser breakage.
- **Cross-platform/Performance:** id length grows from ~3-6 to ~22 chars;
  negligible; mint cost is one `getRandomValues` call.
- **Security:** 64-bit randomness per allocation; no timestamp disclosure.
- **Accessibility:** none.
- **Rejected shortcuts:** global timestamp-based ids; keeping sequential ids
  and hoping branches don't collide; per-merge renumbering (destroys
  cross-branch identity stability).
