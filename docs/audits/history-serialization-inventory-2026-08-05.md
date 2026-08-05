# Persistent History — Serialization Field-Policy Inventory (2026-08-05)

Part of the persistent step-level history architecture audit (Milestone 1).
Evidence from `packages/scene` (`documentCodec.ts`, `version.ts`, `types.ts`).
Feeds ADR-0027 (canonical serialization) and the canonicalizer implementation
(Milestone 3).

## Summary

- `DocumentCodec.encode` = `JSON.stringify(stampVersion(stripEmbeddedAssetPayloads(
  normalizeDocument(doc))))` (`version.ts:906-911`, `documentCodec.ts:846`).
  **Plain `JSON.stringify`** — insertion-order output, no canonical ordering.
- `DocumentCodec.decode` = JSON.parse → legacy warnings → validation →
  migration chain (0.9→2.15, `version.ts:45-759`) → shape validation →
  raster-mask validation → `normalizeDocument` (`documentCodec.ts:509-695`).
- **Unknown fields are preserved** (normalize spreads `...doc`); there is no
  unknown-field whitelist. Unknown extension data therefore rides along.
- **Asset payloads are stripped/rehydrated**: per-fill `image.src` is removed at
  encode when equal to the asset `dataUrl` (`version.ts:837-862`) and
  rehydrated at decode (`version.ts:770-826`). `Document.assets` itself keeps
  `dataUrl` (the bytes live in the file once).
- **Excluded already**: selection, camera/viewport (`usePersistence.ts:41-45`),
  undo stacks. Included accidentally today: nothing runtime-specific found
  (but unknown-field passthrough makes this fragile).
- No content hashing of documents anywhere canonical; the closest is
  `contentHash(JSON.stringify(doc))` — FNV-1a 32-bit, key-order-sensitive —
  for thumbnail cache keys (`platform/src/pure.ts:80-88`).

## Field policy classification (document level)

| Field | Policy (proposed) | Notes |
|---|---|---|
| `id` | `authored-semantic` | UUIDv4 |
| `name` | `authored-semantic` | |
| `formatVersion` | `authored-semantic` (schema) | Stamped at save |
| `rootChildren` | `ordered-semantic` | Paint order — never sort |
| `globalChildren` | `ordered-semantic` | |
| `nodes` | `unordered-semantic` (map) | Sort keys canonically |
| `components` | `unordered-semantic` (map) | |
| `nextId` | `derived-recomputable` | Recomputable from ids; keep for compat |
| `paints` / `styles` / `assets` / `timelines` / `stateMachines` / `masters` / `interactions` / `iconAssets` / `rasterMaskAssets` / `selectionSets` etc. | `unordered-semantic` (maps) | Sort keys canonically |
| `pages` / `spreads` / `sections` | `ordered-semantic` | Page order authored |
| `guides` / `swatches` / `spotColors` | `ordered-semantic` | List order authored |
| `fontManifest` | `unordered-semantic` | |
| `DocumentAsset.dataUrl` | `external-content-reference` | Identity is `asset-<hash>`; payload excluded from canonical text/hash (ADR-0030) |
| `mockupTemplates`, `logoProject`, `gradientPresets`, `motionPresets`, `linterConfig` | `authored-semantic` (nested policies) | |
| `textChains`, `brushPresets` | `authored-semantic` (opaque, preserved) | Unknown internal shapes — keep ordered as authored |

## Node-level fields (from `NodeBase`, `types.ts:911-980`)

Ordered list (proposed canonical order for a node object): `id`, `kind`, `name`,
`parentId` (where present), `visible`, `locked`, `opacity`, `blendMode`,
`rotation`, `bindings`, `styleId`, `styleOverrides`, `fills`/`fill`,
`paintRefs`, `strokes`, `effects`, `mask`, `constraints`, `layoutSizing`,
`gridPlacement`, `presets`, geometry (`x/y/w/h` or `points`), kind-specific
fields, then unknown extension keys sorted lexicographically.

Authored-order arrays (never sorted): `children`, `fills`, `strokes`, `effects`,
`points` (path), `runs` (text), `keyframes`, `tracks`, action sequences.

## Number policy (proposed)

- Enforce finite numbers at mutation boundaries; reject/repair `NaN`/`Infinity`
  on decode (today they would survive `JSON.stringify` as `null`, silently
  corrupting content).
- Normalize `-0` → `0`.
- No aggressive rounding: coordinates, path points, transform matrices, colors
  preserved to full float64 precision as authored.

## String policy (proposed)

- Preserve authored text exactly; no Unicode normalization of user-visible text.
- No locale-dependent formatting in serialization.
- Identifier/branch-name normalization uses separate explicit policies.

## Volatile data (must be excluded or separated)

Selection, hover, active tool, panel state, viewport/camera, cursor position,
derived bounds, render caches, worker state, temporary previews, machine-local
paths, download progress, transient presence, non-semantic timestamps.

## Missing today

1. **Schema-aware canonical ordering** (no such serializer exists).
2. **Deterministic content hash** (only FNV-1a 32-bit over raw JSON.stringify).
3. **Unknown-field policy** (currently preserved by passthrough; canonical form
   must define deterministic ordering for unknown keys).
4. **Asset reference policy** (dataUrl in canonical text).
5. **Cross-platform golden fixtures** for serialization.

## Conclusion

Current serialization is deterministic *given an object's insertion order* but
is not a canonical form: map ordering, unknown keys, payload handling, and
number/string policies are unspecified. The canonicalizer (M3) must be built on
the schema, not on recursive key sorting, per ADR-0027.
