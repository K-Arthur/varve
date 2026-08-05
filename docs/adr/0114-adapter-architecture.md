# ADR-0114: Adapter architecture

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

DTCG, Tokens Studio, Style Dictionary, Figma Variables, and future platforms
each have different fidelity, capabilities, and API constraints. One set of
conditional conversions would be untestable and dishonest about
capabilities.

## Decisions

### D1 — Explicit adapter contract

```ts
interface TokenAdapter {
  id: string; displayName: string;
  capabilities: TokenAdapterCapabilities;
  detect(input): Promise<TokenDetectionResult>;
  import(input): Promise<TokenImportResult>;
  export(input): Promise<TokenExportResult>;
  pull?(input): Promise<TokenPullResult>;
  push?(input): Promise<TokenPushResult>;
}
```

### D2 — Honest capability reporting

Capabilities declare read/write/delete/rename support, modes, collections,
aliases, composites, color spaces, extensions, stable external ids,
incremental updates, pagination, rate limits, auth requirements, plan/account
restrictions, and round-trip fidelity. The UI never presents operations the
adapter cannot perform: an import-only adapter gets no "Synchronize" button,
and a Figma account without write permission sees read-only affordances.

### D3 — The DTCG adapter is the reference adapter

It implements stable-spec parsing/serialization, validation, semantic diff,
resolver support, source preservation, unknown-extension preservation, the
`org.varve.*` namespace, round-trip tests, and conformance fixtures. Every
other adapter is verified against it.

### D4 — Loss classification everywhere

Every conversion classifies as: lossless / lossy-with-warning / preserved-
but-unsupported / blocked. Import and export produce reports, never silent
drops.

## Alternatives

- One mega-module of conditional conversions — rejected: untestable,
  incapable of honest capability reporting.
- Only ever shipping DTCG — rejected: the program requires compatibility
  with real-world ecosystems.
- Reverse-engineering undocumented platform APIs — rejected outright
  (ADR-0114-D4 in the program spec).

## Consequences

- A shared adapter contract test suite every adapter must pass
  (capability accuracy, import/export validation, stable-id behavior, loss
  reporting, cancellation, no hidden side effects).
- New platform adapters ship only when their supported workflow can be
  tested.

## Migration impact

None.

## Compatibility impact

Adapters are additive; existing documents unchanged.

## Security considerations

Remote adapters (Figma etc.) require explicit consent and secure credential
storage (ADR-0119); network clients are sandboxed with no SSRF-friendly URL
handling (allowlisted hosts per adapter).

## Rejected shortcuts

- Unverified "all platforms" stubs.
- Marketing-derived capability claims (capabilities come from documented
  APIs only).
- Using a Figma file as an invisible intermediary for local DTCG sync.
