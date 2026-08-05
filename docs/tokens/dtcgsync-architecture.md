# DTCG Design-Token Synchronization — Target Architecture

- **Date:** 2026-08-05
- **Status:** Accepted (Milestone 1). Implementation plan for the native DTCG
  token-sync program. Each numbered decision maps to an ADR in `docs/adr/`.

## 1. Objective

Make Varve a standards-based participant in multi-platform design-token
workflows: connect or create a DTCG source, parse and validate, preview,
import/map into Varve, bind to design properties, edit in Varve or externally,
detect local and external changes, compute a three-way semantic merge, resolve
conflicts, apply atomically, write standards-compliant files, optionally
commit/push through explicit Git actions, and survive save/reopen/recover.

All of this works locally and deterministically. AI never becomes the parser,
resolver, merge engine, or synchronization mechanism.

## 2. Standards baseline

- Target stable version: **DTCG 2025.10 family** — the "Design Tokens Format
  Module 2025.10" Draft Community Group Report (published 2026-07-30 snapshot)
  plus its Color and Resolver module reports.
- The report is a **Draft Community Group Report, not a W3C Recommendation and
  not on the W3C Standards Track**. Varve will never label it otherwise.
- A `DtcgSpecificationVersion` capability abstraction gates every feature
  (`supportsFormatModule`, `supportsColorModule`, `supportsResolverModule`,
  supported types, supported reference forms). Future drafts sit behind an
  experimental adapter and never alter stable serialization.
- Normative anchors implemented (from the 2025.10 format report):
  - Token = object with `$value`; `$type` inherits from closest typed parent
    group; unknown type ⇒ invalid (never guessed from value shape).
  - Names must not start with `$` and must not contain `{`, `}`, `.`.
  - `$root` reserved root-token name; paths include `.$root`.
  - Group properties: `$description`, `$type`, `$extends`, `$deprecated`,
    `$extensions`; `$extends` deep-merges like JSON Schema 2020-12 `$ref`
    (local override wins, no circular inheritance).
  - References: curly brace `{path}` (complete tokens only, always resolves to
    `$value`) AND RFC 6901 JSON Pointer `$ref` (MUST support; property-level
    references; `~0`/`~1` escapes; numeric segments = array indices).
  - Types: `color`, `dimension` (`px`/`rem` only), `fontFamily`, `fontWeight`
    (1–1000 or alias strings), `duration` (`ms`/`s`), `cubicBezier`
    (`[x1,y1,x2,y2]`, x in [0,1]), `number`, and composites `strokeStyle`,
    `border`, `transition`, `shadow`, `gradient`, `typography` (five required
    fields; `lineHeight` is a unitless multiplier).
  - Resolution order: local tokens → root tokens → extended tokens → nested
    groups, recursively. Cycles in aliases, `$extends`, and `$ref` are errors.
  - Color grammar lives in the Color module; the format report only says
    "see the Color module". Varve implements `colorSpace`/`components`/`alpha`/
    `hex` with a per-version color-space registry.
- A separate Resolver module report defines resolver documents (sets, sources,
  modifiers, transformers, defaults). Varve implements it as its own module
  (ADR-0105), never reusing the Format module's `$type` vocabulary for
  resolver metadata.

## 3. Package ownership

| Package | Owns |
| --- | --- |
| **`@varve/tokens`** (new) | DTCG AST, versioned parser, serializer, validation, token-type codecs, reference graph, resolver engine, semantic diff, three-way merge, rename detection, adapter contracts, sync plans. Zero React, zero scene imports. |
| **`@varve/scene`** (`src/tokens/`) | Canonical `DesignTokenStore` (stable ids, provenance, local state, sources, sync state, base snapshots), existing-`Variable` compatibility bridge, document persistence field, migrations. |
| `@varve/platform` | Local filesystem source plumbing, watchers, atomic writes, secure credential storage (later), Git process boundary (later), OS capability detection. |
| `@varve/editor` | Token Sync Center, source setup, token tree, detail view, diff UI, conflict UI, inspector binding integration, notifications, commands, accessibility. |
| `@varve/codegen` | Platform output profiles (CSS/SCSS/TS/JSON/Android/Swift/Dart), naming/unit/color transforms, generated-file ownership policy. |
| `@varve/ai` | Optional typed multimodal proposals only (classification, extraction, naming suggestions). Never parsing/merging. |

Dependency direction: `tokens` is a leaf (imports only `@varve/shared`
primitives); `scene` imports `tokens` types; `editor` imports both; `platform`
is independent. No cycles.

## 4. Data flow (connect → … → continue syncing)

```
connect source (file/dir/git later)
→ read bytes (platform port)
→ encoding/size validation
→ JSON parse with source-location map (bytes → path/offset → line/column)
→ DTCG structural parse (versioned)
→ semantic validation (types, names, references)
→ reference graph construction
→ normalized token graph
→ preview (semantic diff against base snapshot)
→ import/map into DesignTokenStore (stable UUID ids, provenance)
→ bind tokens to variables → bindings on nodes
→ edit in Varve (updateDoc undo transaction) or externally (watcher)
→ detect divergence (base/local/remote)
→ three-way merge → validated TokenMergePlan
→ conflict UI (BASE | VARVE | SOURCE) → resolution
→ apply atomically (one undo transaction; external files untouched)
→ serialize (source-preserving or canonical) → atomic file writes
→ explicit Git actions (stage/commit/push) when user requests
→ save/reopen/recover (schemaVersion + base snapshot + source re-read)
```

## 5. Persistence contract

- The document carries one optional additive field on `VariableStore`
  (`tokenSync`) — verified to survive `serializeDocument` + `normalizeDocument`
  (both spread the document). No codec change required.
- `tokenSync` is versioned internally (`schemaVersion`), contains sources,
  tokens, sync states, and compact base snapshots; snapshots are excluded from
  token exports and are size-bounded.
- Machine-local data (absolute paths, watcher state, credentials) lives in
  workspace-local/user-local connection records, never in the document.
- No `eval`, no `Function`, no arbitrary transform execution anywhere in the
  pipeline. Deterministic, typed, allowlisted transforms only.

## 6. Implementation milestones

1. Audit + baselines + ADRs (this milestone).
2. Canonical token model + migration (`scene/src/tokens/`).
3. `@varve/tokens`: 2025.10 format support (parser, serializer, codecs,
   diagnostics, round-trip tests).
4. Reference graph + color integration.
5. Resolver contexts (sets, modifiers, lazy permutations).
6. Semantic diff + three-way merge + tombstones.
7. Local sources: file/directory source, watcher, atomic writes, browser
   fallback. Independently shippable.
8. Frontend vertical slice: Sync Center, setup flow, token tree, diff,
   conflict view, inspector integration, a11y, Playwright.
9. Git-backed synchronization (working-tree, explicit actions).
10. Interoperability adapters: Tokens Studio, Style Dictionary outputs,
    Figma Variables (each verified, never unverified stubs).
11. Multimodal typed proposals (deterministic-first, preview-gated).
12. Hardening: fuzzing, stress, low-memory, cross-platform, docs.

Each milestone ends with diff review, targeted tests, typecheck, lint, a
focused commit, and a recorded hash.

## 7. Guardrails

- **Three-way, never two-way:** `base`/`local`/`remote` for every semantic
  field. No timestamp-wins, no source-wins, no whole-file replacement.
- **Atomic:** a sync applies a validated change set completely or not at all.
- **Explicit external mutation:** no file rewrite, commit, push, or PR merely
  because a difference was detected. Preview first, explicit action required.
- **Source-preserving:** untouched raw sections, ordering, indentation,
  newline style, BOM, final newline, `$extensions` all survive round trips.
- **Deterministic:** AI never validates, resolves, or merges.
- **Privacy:** local-first; uploads require explicit disclosure; no token
  names/values/paths in telemetry or logs by default.
