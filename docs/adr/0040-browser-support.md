# ADR-0040: Browser support

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0020, ADR-0028

## Context

Persistent history must work in the browser (IndexedDB; OPFS available) as
well as on desktop, while Git integration is inherently desktop-native.

## Alternatives

1. Desktop-only history, browser gets a stub — violates the product
   principle of cross-platform parity.
2. Full parity via the storage contract (chosen): same revision DAG,
   checkpoints, branches, diff, and manual merge in the browser; desktop-only
   features are clearly identified.

## Decision

The history store contract (ADR-0020) is implemented over IndexedDB (with
OPFS as an option for large payloads) in the browser, SQLite on desktop, and
memory in tests. Storage-quota failures surface as actionable errors without
corrupting refs. Desktop-only capabilities — native Git executable
integration, repository configuration, merge drivers, filesystem watchers,
CLI installation — are clearly labeled in the UI and never silently emulated
in the browser. The browser can still open Git-conflicted files exported
manually (merge workspace operates on the file pair + manifest).

## Consequences

- **Migration impact:** web version stores migrate in place (ADR-0024).
- **Backward compatibility:** legacy `varve-home` DB upgrades through the
  existing schema-versioned migration path.
- **Cross-platform/Performance:** IndexedDB writes are batched and
  transaction-safe; quota pressure handled.
- **Security:** same validation paths; quota and incognito modes degrade to
  explicit messaging.
- **Accessibility:** none.
- **Rejected shortcuts:** silently faking Git support in the browser;
  different history semantics per runtime.
