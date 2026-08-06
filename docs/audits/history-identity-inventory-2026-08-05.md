# Persistent History — Identity Inventory (2026-08-05)

Part of the persistent step-level history architecture audit (Milestone 1).
Evidence gathered from `packages/scene`, `packages/import`, `packages/editor`
on 2026-08-05. Feeds ADR-0025 (persistent identity format) and ADR-0026
(legacy sequential-ID migration).

## Summary

- `NodeId = string` (`types.ts:45`); the canonical allocator is
  `nextNodeId(doc)` in `node-id.ts:4-7` minting **`n<counter>`** from the single
  persisted counter `Document.nextId` (starts 1, `document.ts:336`).
- `Document.nextId` is shared by nodes **and** styles (`styles.ts:338-340`
  mints `s<nextId>`). Because it is a plain shared counter, **two branches of
  the same document allocate identical IDs independently** — the core
  collision risk this project must eliminate.
- **At least five independent counter allocators exist** besides
  `nextNodeId`: component `IdGen` (`component.ts:41-52`), table remap
  (`tableOps.ts:75-129`, `r<N>/c<N>/cell<N>`), variable module counters
  (`variables.ts:78-86, 283-285`, `col-<n>/grp-<n>/v<n>`), library remap
  (`library.ts:123`), sketch import (`packages/import/src/sketch.ts:223-227`).
- Random/UUID ids (collision-resistant already): document id (`cryptoId`,
  `document-utils.ts:22-25`), pages, masters, guides (`g-<ts>-<rand>`), state
  machines (`st-/tr-/in-`+rand), motion (`tr-<ts>-<rand>`), icon assets,
  effects, selection sets, logo entities.
- **Content-addressed**: assets `asset-<hash>` (`assets.ts:37-85`).
- **Only one parser assumes the numeric format**: `maxNumericNodeId`
  (`documentCodec.ts:121-128`) — recomputes `nextId` on decode from
  `/^n(\d+)$/` matches (`documentCodec.ts:667-668`).
- `ids.ts` (prefix registry + `IdGenerator`) is dead code, not exported.

## Identity classes

| Entity | Format today | Allocator | Collision risk across branches | Notes |
|---|---|---|---|---|
| Document id | UUIDv4 | `cryptoId` | Low | Random |
| Node ids | `n<N>` | `nextNodeId` (doc counter) | **High** | Same doc, two branches → same `n<N>` |
| Style ids | `s<N>` | `styles.ts` (doc counter) | **High** | Shares node counter |
| Component ids | `n<N>` via IdGen | `component.ts:41-52` | **High** | Counter seeded from `doc.nextId` |
| Table model ids | `r<N>/c<N>/cell<N>` | `tableOps.ts:75-129` | Medium | Scoped per table; regenerated on remap |
| Variable collection/group/var | `col-<n>/grp-<n>/v<n>` | module counters `variables.ts:78-86,283-285` | **High + cross-session bug** | Module counters reset per session; persisted in store |
| Library remap | `n<N>` local counter | `library.ts:123` | Medium | Remap-only |
| Sketch import | `n<N>` local counter | `sketch.ts:223-227` | **High** | Independent of doc counter |
| Pages | `cryptoId` | random | Low | |
| Masters | `cryptoId` | random | Low | |
| Guides | `g-<ts>-<rand>` | random | Low | Timestamp + random |
| State machines / states / transitions | `st-/tr-/in-` + rand | random | Low | |
| Timelines / tracks / keyframes | random / `tr-<ts>-<rand>` | random | Low | |
| Icon assets | `icon-<ts>-<rand>` | random | Low | |
| Effects | `cryptoId` | random | Low | |
| Selection sets | `cryptoId` | random | Low | |
| Assets | `asset-<hash>` | content-addressed | Low | FNV-1a 64-bit digest of payload |
| Paints / swatches / spot colors | (check `paints.ts`, swatch ids) | mixed | Medium | Swatch ids `sw-<ts>-<rand>` per prefix registry |

## Reference sites (must be remapped by any ID migration)

- `rootChildren`, `globalChildren`, `children` arrays (`document-nodes.ts`).
- Page `contentRoot`, `backgrounds`, `masterPageId`, `masterOverrides`
  (`document-pages.ts`, `document-components.ts`).
- Master `masterRootId`; component `masterRootId`, `slots[].id` / slot fills
  (`frameSlots` records), instance `componentId`, `instanceOverrides`,
  `swapInstance` (`document-nodes.ts:531-614`).
- `mask.sourceNodeId` (`clone.ts:81-91`).
- `styleId` / `styleOverrides` on nodes; `paintRefs` / `fill.paintRef`.
- `bindings` (`bindings.ts` — new file, pre-existing uncommitted work).
- `interactions` keyed by `NodeId` (`interactions.ts`).
- `iconAssetId`, `selectionSets`, `textChains`, `brushPresets` (unknown shapes),
  raster-mask `sourceIdentity` (content-sha256, not ids).
- Editor clipboard round-trip (`clipboard.ts:21-26` carries raw nodes + asset
  tables) and `insertImportedSubtree` (`context.tsx:510-560`).

## Assessment against plan §5.2 questions

| Question | Finding |
|---|---|
| Globally collision-resistant? | Only random/content-addressed ids. Node/style/component/variable ids are counter-based → collide across independently edited copies. |
| Unique within one document? | Yes while `nextId` is monotonic; note `maxNumericNodeId` recompute on decode keeps it monotonic for legacy docs. |
| Can collide when two Git branches independently add content? | **Yes** — same counter, same format, no randomness. |
| Regenerated during serialization? | No — ids are stored data. |
| Derived from array indexes? | No (counter-based, but counter reuse after copy/import is possible). |
| Reused after deletion? | No within a document (`nextId` never decreases). Cross-document/copy: possible (two docs both have `n1`). |
| Stable across import/paste/detach/restore/merge? | Import/paste **regenerate** ids (by design). Detach/restore keep ids. Merge currently non-existent. |
| Parser assumptions | Only `maxNumericNodeId` (`documentCodec.ts:121-128`). Safe to extend. |

## Conclusion

The current format is a plain per-document counter and is **unsafe for
branching and merging**. The chosen direction (ADR-0025/0026): keep the
legacy `n<number>` / `s<number>` formats readable forever, and mint new ids in
a collision-resistant `n<counter>_<random-hex>` format. This preserves the
human-debuggable counter while adding branch safety, keeps the sole parser
compatible (regex simply won't match new-format ids), and avoids touching
`documentCodec.ts` normalization semantics.
