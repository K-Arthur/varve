# ADR-0107: Source connection model

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

A synchronization source (file, directory, Git working tree, remote
platform) must be representable without leaking machine-local data into
portable documents, and must degrade gracefully when a document opens on a
machine without the source.

## Decisions

### D1 — Phased source kinds

1. `local-file` — one DTCG token document.
2. `local-directory` — multiple token files, optional resolver document,
   include/exclude patterns, file partitioning, source ownership.
3. `git-working-tree` — a local repository path, no network required
   (ADR-0113).
4. `read-only-url` / `design-platform` — only after permission,
   authentication, and capability boundaries exist (ADR-0114/ADR-0120).

### D2 — Configuration shape

```ts
interface TokenSourceConfiguration {
  rootPath?: string; entryFiles: string[]; resolverFile?: string;
  include?: string[]; exclude?: string[]; direction:
  'import-only' | 'export-only' | 'bidirectional';
  formatting: TokenFormattingPolicy;
  stableIdPolicy: StableTokenIdPolicy;
  platform?: TokenPlatformConfiguration;
}
```

`direction` is enforced end-to-end: an import-only source never gets a write
button anywhere in the UI.

### D3 — Connection records are machine-local or workspace-local

Absolute paths, watcher state, and credentials live in user-local/workspace-
local connection records — never inside the document, DTCG files, or
committed project config. The document stores only the source's stable id,
kind, name, and a relocatable logical location hint.

### D4 — Unavailable-source behavior

When a document opens on a machine without the source: status becomes
`unavailable`, tokens remain fully editable as local values, bindings keep
working, and Sync Center offers reconnect, detach, or keep-local actions.
No data is discarded.

## Alternatives

- Storing absolute source paths in the document — rejected: portable
  documents would break on other machines and leak local structure.
- One global source registry shared by all documents — rejected: ownership
  and per-document bases must be independent; multiple documents may use the
  same source (each with its own sync state).

## Consequences

- A connection-record store (per workspace/user) with its own (non-secret)
  persistence; capability detection decides which source kinds are offered
  per runtime (ADR-0120).

## Migration impact

None — new feature; sources appear only when the user connects one.

## Compatibility impact

Existing documents have no sources and are unaffected.

## Security considerations

No credentials in documents, DTCG files, or Git-committed config; paths are
not broadcast to collaborators (ADR-0117); source discovery never follows
untrusted includes outside the configured root without confirmation.

## Rejected shortcuts

- Auto-importing every JSON file in a repository.
- One "Synchronize" button that bypasses direction/capability checks.
- Machine-local paths baked into documents.
