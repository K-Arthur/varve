# ADR-0119: Secret storage and permissions

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

The audit shows the only persisted settings store is a plain SQLite string KV
(`app_get_setting`/`app_set_setting`), which is NOT a secure store. Git
remotes, Figma OAuth tokens, and provider credentials must never land in
documents, token files, committed config, logs, crash reports, or clipboard
metadata.

## Decisions

### D1 — Secrets live in a secure store only

Tauri gains a credential command set backed by the OS credential service
(keyring/keychain/Secret Service — via a small Rust crate, `keyring` or
`secret-service`), behind a `SecureStorage` capability in the platform port.
Web builds report the capability as unavailable; any web-only credential
path requires a separate reviewed design and is off by default.

### D2 — Never-list

Secrets are never stored in: Varve documents, DTCG files, resolver
documents, Git-committed project configuration, application logs, crash
reports, or clipboard metadata. Logging and crash paths sanitize values and
paths (redaction of `http(s)://user:pass@`, token patterns, home
directories).

### D3 — Scoped permission model

Remote adapters (Git push, Figma, providers) request capabilities
explicitly (read-only vs write vs publish) with per-source consent, stored
per connection record, revocable. The UI surfaces which permissions a
source has and what it can do.

## Alternatives

- Reusing `app_set_setting` for tokens — rejected: plaintext in a local
  SQLite file is not a credential store.
- Embedding credentials in Git remotes — rejected outright.
- Storing credentials in the document for convenience — rejected outright.

## Consequences

- A `SecureStorage` port interface with a Tauri implementation and a
  test double; contract tests verify no secrets leak into exports or logs.

## Migration impact

None — new capability; existing settings KV is untouched.

## Compatibility impact

None.

## Security considerations

This ADR is the security baseline for every remote adapter; its contract
tests run in CI.

## Rejected shortcuts

- Plaintext credential files.
- `.env`-style committed config for tokens.
- Credential storage in documents "so sync works on another machine".
