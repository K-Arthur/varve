# ADR-0126: Page ownership of scene nodes

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Nodes are owned by page content roots, master content roots, or `rootChildren`
(orphans/pasteboard) — ownership is positional, never declared. Deletion
silently removes content (`removePage` drops the whole contentRoot subtree,
`document-pages.ts:75-100`); duplicate does not remap chain references
(`document-pages.ts:128-224`).

## Decision

D1 — Ownership is derived from roots (no redundant field) but must be
unambiguous: every non-global node resolves to exactly one owner:
`page | master | pasteboard | global`.

D2 — A scene helper `resolveOwnership(doc, nodeId)` returns the owner kind and
owner ID; invariants are validated on load and in dev (`devValidate`):
no node under two roots, no page/master root inside another root, no orphaned
page-owned nodes after page deletion.

D3 — Page deletion exposes explicit policies (delete content / move to
pasteboard / move to another page / cancel) instead of silent removal. Text
threads crossing the page are resolved before commit (ADR-0136).

D4 — Duplicate page remaps all reference-bearing fields (mask, slots, text
chains, component instances, variable bindings) through the ID map, and
duplicates linked text frames with a new story thread.

D5 — Pasteboard-owned content is never exported; global content is exported
once per page but never duplicated per page in the model.

## Alternatives

- Storing `ownerId` on every node — rejected: redundant with the tree; drifts
  under reparenting.
- Treating pasteboard as a special hidden page — rejected: it would export
  and print.

## Consequences

- Cross-page reparent (drag) uses `computeReparentTransform`
  (`coordinateService.ts:489-506`) + ownership invariant checks in one undo
  transaction.
- Selection set and layers tree gain owner context.

## Migration impact

Load-time validation only; existing docs are already positional.

## Compatibility impact

None.

## Security considerations

Shared-root and orphan checks prevent cross-page data leakage on load.

## Rejected shortcuts

- Allowing two pages to reference one content root.
- Silent content deletion on page removal.
