# ADR-0127: Global and pasteboard-only content

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

`Document.globalChildren` exists (`document.ts:194-195`) and renders with
`activePageNodes` (`document-pages.ts:372-382`). Pasteboard content has no
explicit carrier today (rootChildren entries that are not page/master roots).

## Decision

D1 — `globalChildren` remains the exclusive carrier for global content: nodes
visible on every page (annotations, overlays). Global nodes live outside any
content root; ownership = `global`.

D2 — `rootChildren` entries not reachable from any page/master content root
are pasteboard content (ownership = `pasteboard`). Pasteboard content renders
on the canvas but never in page exports, thumbnails, or print.

D3 — Global content exports once per page (per page geometry); it is never
cloned per page.

D4 — A node cannot be both global and page-owned; moving a node into
`globalChildren` removes it from its content root (one transaction).

## Alternatives

- Pasteboard as a hidden page — rejected: export/print leakage risk
  (ADR-0126 D5).
- Global content duplicated into every page root — rejected: breaks identity
  and undo granularity.

## Consequences

- New canvas layer: pasteboard background and pasteboard items render behind
  and around placed pages.
- Thumbnail source lists exclude pasteboard and include globals (current
  behavior: `thumbnailSource.ts:39-63` includes globals; pasteboard exclusion
  is new).

## Migration impact

None — existing docs already satisfy the partition (roots are exclusive).

## Compatibility impact

None.

## Security considerations

Pasteboard items with external URLs are subject to the existing CSP
(`docs/architecture/security-csp.md`).

## Rejected shortcuts

- A pasteboard "page".
- Auto-exporting pasteboard items.
