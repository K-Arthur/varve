# ADR-0027: Canonical serialization

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0021, ADR-0028, ADR-0031; audit `docs/audits/history-serialization-inventory-2026-08-05.md`

## Context

`DocumentCodec.encode` is `JSON.stringify` of a normalized object
(`version.ts:906-911`): deterministic only given insertion order; map ordering,
unknown keys, numbers, strings, and payload handling are unspecified. Git
diffs, content hashes, and cross-platform goldens need a canonical form.

## Alternatives

1. Recursive key sorting — corrupts authored order of child/fill/path arrays;
   explicitly rejected by the brief.
2. Minimal normalization (sort only known map keys) — unspecified unknown
   fields and payloads remain.
3. Schema-aware canonical serializer (chosen).

## Decision

A canonical serializer in `@varve/scene` driven by a declarative per-type
schema (`packages/scene/src/canonical.ts`):

- **Property ordering:** schema-defined per type (e.g. node: `id, kind, name,
  parentId, visible, locked, opacity, blendMode, rotation, bindings, styleId,
  styleOverrides, fills, fill, paintRefs, strokes, effects, mask, constraints,
  layout, geometry, text, component metadata, extension data`); unknown keys
  sorted lexicographically inside their namespace.
- **Maps** keyed by stable ids: sorted lexicographically by canonical id.
- **Ordered arrays** (children, rootChildren, globalChildren, pages, spreads,
  fills, strokes, effects, runs, points, keyframes, tracks, action
  sequences): authored order preserved — never sorted.
- **Set-like arrays:** sorted by a documented stable key where a true set is
  identified; none assumed without evidence.
- **Numbers:** finite-only (reject/repair NaN/Infinity at mutation boundaries);
  `-0` → `0`; no precision loss, no aggressive rounding, no exponent
  normalization beyond what `JSON.stringify` requires; transform/path/color
  values preserved to full float64.
- **Strings:** preserved exactly; no Unicode normalization of authored text.
- **Optional properties:** `undefined` omitted; `null` preserved as authored.
- **Unknown fields:** preserved and deterministically ordered (never dropped)
  — extensions survive.
- **Binary payloads:** `DocumentAsset.dataUrl` excluded from the canonical
  text; the content-addressed `asset-<hash>` id is the reference (ADR-0030).
  Per-fill `image.src` is stripped when it duplicates the asset payload
  (mirrors `stripEmbeddedAssetPayloads`).
- **Format:** compact JSON, no newline, UTF-8, schema version embedded.
- **Hashing input:** exactly the canonical bytes (pure-TS SHA-256,
  ADR-0021).
- **Idempotence contract:** `canonicalize(canonicalize(doc)) ===
  canonicalize(doc)`; parse→reserialize stability; cross-platform byte
  equality via golden fixtures (Linux/macOS/Windows + Node/browser).

## Consequences

- **Migration impact:** none to the existing file format; canonical form is a
  derived layer for hashing, diffing, Git text conversion, and goldens.
- **Backward compatibility:** `DocumentCodec.encode/decode` unchanged.
- **Cross-platform/Performance:** pure TS; no locale/engine dependence; runs
  off the interaction path (transaction commit time).
- **Security:** schema validation prevents prototype-pollution paths (no
  `__proto__`/`constructor` traversal); payload exclusion bounds canonical
  text size.
- **Accessibility:** none.
- **Rejected shortcuts:** recursive key sorting; hashing raw `JSON.stringify`;
  Unicode-normalizing authored text; dropping unknown fields.
