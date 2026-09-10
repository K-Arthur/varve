# ADR-0102: Stable identity and path mapping

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

DTCG paths are human-readable identifiers in external files; Varve bindings
need durable internal identity. The current system breaks when a name changes
(baseline test pins the breakage). Renaming `color.brand.primary` to
`color.action.primary` must not break bindings when identity can be
determined.

## Decisions

### D1 — Layered identity strategy

1. **Preferred:** a Varve stable id stored in a namespaced `$extensions`
   entry (`org.varve.id`) when Varve owns or is permitted to annotate the
   source file.
2. Reuse recognized vendor ids through adapter metadata when safe (e.g. a
   Figma variable id or Tokens Studio `$extensions` entry), wrapped by the
   adapter.
3. Source file + JSON-pointer lineage from the synchronization base
   (path-to-pointer mapping recorded in the base snapshot).
4. Conservative rename/move detection (ADR-0109) only when no identity
   metadata exists.
5. User confirmation required for ambiguous matches — never merged on equal
   values alone (many legitimate tokens share values).

### D2 — The extension namespace

`org.varve.*` is the Varve extension namespace (reverse-DNS, per the format
report's `$extensions` guidance). Only interoperability metadata that
genuinely belongs in the token source is stored there; machine-local state
(paths, watcher state, credentials) is never exported.

### D3 — Path is data, not identity

`DesignTokenRecord.path` is a `readonly string[]` mirroring the DTCG group
path (including `$root` where present). All indexes (id, path, pointer,
stable id) are maintained by the token store (ADR-0121). Renames update the
path index and the reference graph, never token ids or bindings.

## Alternatives

- Using the DTCG path as the id — rejected: it is exactly the failure mode
  being fixed.
- A document-global monotonic counter for token ids — rejected: collides
  across import/copy/concurrent editing.
- Hash of path+value — rejected: value changes would re-identify tokens.

## Consequences

- Imported files may carry `org.varve.id` extensions after a successful write;
  round-trip tests must verify unknown-extension preservation.
- Heuristic rename detection is bounded and always previewed.

## Migration impact

Existing variables get stable token ids only when adopted into the token
store; legacy `vN` ids remain valid for non-sync documents.

## Compatibility impact

`org.varve.*` extensions are inert for other tools (MUST-preserve rule
protects them in both directions).

## Security considerations

`org.varve.id` values are validated as strings before use; malicious ids
cannot change identity resolution (store maps them, never trusts them).

## Rejected shortcuts

- Merging tokens because values are equal.
- Auto-renaming bindings by string substitution of the old name.
- Storing absolute paths or machine info in `$extensions`.
