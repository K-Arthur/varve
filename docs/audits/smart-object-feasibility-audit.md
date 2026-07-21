# Smart Object Feasibility — Decision-Gate Audit

**Scope:** Determine whether a Photoshop-style Smart Object capability is justified in Strata, map it against existing scene-graph/asset/rendering systems, and recommend the smallest architecture that solves validated workflow gaps without duplicating existing systems.

**Date:** 2026-07-20

**Method:** Parallel codebase audit (scene graph, assets/import, non-destructive editing, document lifecycle) cross-referenced against current-generation behavior in Photoshop, Illustrator, Affinity, Figma, Sketch, GIMP, Krita, and SVG/PDF/ORA prior art.

**Naming:** this document deliberately avoids "Smart Object" — the recommended model (§7) is narrower than Photoshop's and the name should say so. Proposed terms, consistent with the `kind` discriminator used throughout this doc:

- **Asset** — the document-level record (`Document.assets[id]`): content hash, natural dimensions, storage kind, payload. Not user-facing vocabulary by itself.
- **Embedded Asset** — an `Asset` whose bytes live inside the document (Phase 1, and the only kind shipped in Phase 1). This is the user-facing term for "this image's data is stored once and referenced by every layer that uses it."
- **Linked Asset** — an `Asset` whose bytes live in an external file, resolved by path + fingerprint (Phase 2, deferred). Same record shape, different storage kind — no schema redesign needed to add it later.
- A fill (or, later, other content) holds an `assetId`, not raw bytes — that reference is what "Convert to Embedded Asset" / "Detach from Asset" type actions would operate on.

This reads as "Embedded/Linked Asset," matching Illustrator's and Affinity's own vocabulary for the same embed/link distinction — deliberately, since that's the closest correct analogy, not Photoshop's more elaborate nested-document model.

---

## 1. Existing capabilities (don't rebuild these)

Strata already implements several of the primitives a Smart Object system is normally built from. None of them is called "Smart Object," but the behavior exists:

| Capability | Status | Evidence |
|---|---|---|
| Non-destructive crop | **Built**, hardened today (Session 52+, 2026-07-20) | `packages/editor/src/imageCrop.ts` — crop only mutates shape `w`/`h` and fill `x`/`y`/`scale`; `ImageFillData.src` and `imageWidth`/`imageHeight` untouched; `resetToSourceBounds()` proves full recoverability |
| Non-destructive effects/filters | **Built** | `Effect[]` on every visual node + `Adjustment[]` on `AdjustmentNode` (`packages/scene/src/types.ts:296-379`) — descriptor lists evaluated at render time via `filterCompositor.ts`, never baked into pixels |
| Non-destructive masks | **Built** | `packages/scene/src/masks.ts` — mask sourced from a sibling/child node, source "remains independently editable"; cycle detection; dangling-ref cleanup. **Gap:** one mask per container, source must be its own child — cannot be shared across unrelated layers |
| Linked (one-definition-many-targets) adjustments | **Built** | `createLinkedAdjustment()` (`context.tsx:5052`) — one `AdjustmentNode`, `explicit-targets`/`document` scope, edit-once-affects-all. Codebase's own docs (`effects-halftone-audit.md:20`) already analogize `AdjustmentNode` to "Photoshop Smart Filters / Affinity Live Filter Layers" |
| Component/instance/variant system | **Built** (Figma-style) | `packages/scene/src/component.ts` — instances are full deep copies with a `componentId` back-pointer, `propertyOverrides`, variant resolution. Baseline-aware sync (`component-sync.ts`: `pushMasterChanges`/`syncInstance`) distinguishes user overrides from stale-master drift |
| Non-destructive upscale/trace | **Built** | `docs/architecture/image-vector-enhancement.md` — inserts derived sibling nodes; source untouched |
| Background removal as overlay | **Built** | `BackgroundRemovalState` stored separately from `ImageFillData.src` |
| Schema/migration infrastructure | **Mature** | `packages/scene/src/version.ts` — 20 migrations (0.9→2.5), pure functions, would absorb a new node kind or asset table with a standard migration |
| Content-addressed asset dedup | **Precedent exists, not generalized** | `RasterMaskAsset` (`types.ts:83-92`) — document-level, content-hashed, dedup'd immutable payload store, already round-trips through codec/migration. This is the pattern to generalize, not invent |
| Generic hash-keyed render/thumbnail caching | **Built** | `SubtreeIrCache`, `SubtreeReplayCache`, `ThumbnailCache` — all content-hash-keyed LRUs with explicit invalidation wired to a `docVersion` staleness guard |
| Component/style library (cross-document reuse) | **Built**, images excluded | `packages/scene/src/library.ts` — publish/install components and styles across documents. No equivalent exists for raw image assets |

**Net read:** the *editing* half of "Smart Object" (non-destructive transform, filters, masks, linked adjustments) is already solid and idiomatic to this codebase. The *content* half (a real asset with an identity, embedded-vs-linked storage, and dedup) is the missing piece.

---

## 2. Missing workflows (confirmed gaps)

| Gap | Evidence | Severity |
|---|---|---|
| No asset identity for images | `ImageFillData.src: string`, documented literally as `"Image source: data URL, file path, or asset id. Stub until asset system lands."` (`types.ts:414`) | High |
| No byte dedup | Every fill embeds its own base64 copy; placing one image on 10 layers = 10x bytes in the JSON, autosave, recovery, and every undo snapshot | High |
| No embedded-vs-linked distinction | Zero occurrences of "linked"/"relink"/"missing file" related to images anywhere in scene/editor/platform | High |
| Replace-image is unsafe | `ImageFillControls.tsx` "Replace image" overwrites `src` but never recomputes `imageWidth`/`imageHeight` — a different-aspect-ratio replacement silently corrupts crop/fit framing | Medium (cheap to fix independent of everything else) |
| No external file linking or file-watching | `Platform.listenForChanges` is a no-op on web/memory backends; the Tauri backend only relays the app's own Home/library CRUD events, not OS-level file changes. No `notify` crate anywhere in `crates/` | High (if linking is in scope) |
| No nested/referenced documents | Zero hits for "nested document"/"documentRef"/"embed" as a document-in-document concept across scene/editor/import | High (if full parity is in scope) |
| No shared export-flattening path | 5 codegen targets + Rust PDF exporter + Rust canvas IR builder each do their own independent per-node-kind switch; a new node kind needs bespoke handling in ~6 places | Medium — architectural cost multiplier for *any* new node kind, not specific to this feature |
| Scoped undo doesn't generalize | `enterIsolation`/`exitIsolation` (`context.tsx:759`) is a selection/hit-test filter only — it does not fork the document or the undo stack. The only real precedent for a scoped snapshot is the F2 multi-tab session store (`snapshotEditorSession`) | High (if "edit nested source in isolation" is in scope) |
| PSD import is non-functional despite being documented as done | `@webtoon/psd` is declared as a dependency but never imported; `parsePsdData` reads a few header bytes and emits placeholder layers with `src: ''`. AGENTS.md Session 30 claims full layer-tree extraction — this is inaccurate to current code | **Separate, higher-priority bug** — flagged below, not solved by a Smart Object feature |
| Retouch tools may not persist edits | Healing Brush / Clone Stamp / Patch tools call `getImageData`/`putImageData` directly on the shared on-screen `contentCanvasRef`, never call `updateDoc`/touch `node.fills` or tile data — edits may be lost on next redraw | **Separate, urgent bug** — needs live verification, unrelated to Smart Objects |

---

## 3. User value

Mapping the prompt's candidate workflows against what's actually missing (after removing what Strata already handles):

- **Reuse one raster source across multiple placements without duplicating bytes** — real gap, real value. Every user who places a logo/photo on more than one layer today pays a hidden multiplier in file size, autosave time, and recovery-point storage.
- **Replace an image safely while preserving transform/crop/effects/mask** — mostly solved already (transform/crop model is correct); the one bug (stale natural dimensions) is a targeted fix, not a reason for new architecture.
- **Link to an external file with update notifications** — real but speculative value; no current user workflow depends on it, and Figma (a direct product comparable) has explicitly declined to build file-level linking, steering users to published libraries instead — which Strata already has for components/styles.
- **Embed an editable SVG/PDF/PSD with round-trip fidelity** — real gap, but the import layer isn't ready to support it (PSD import doesn't actually parse layers yet); building "keep it editable" on top of an import path that doesn't reliably extract content yet is solving the wrong layer first.
- **Convert selected layers into a reusable object** — already covered for vector/frame content via `createComponentFromGroup` (Session 50). Not covered for "wrap a raster image as a re-editable smart object," but that's really the asset-identity gap above, not a missing conversion command.

---

## 4. Architectural overlap and conflicts to avoid

- A Photoshop-style Smart Object (a node type carrying an embedded nested document + its own Smart Filters stack) would **duplicate two systems that already exist**: the component/instance system (deep-copy-with-overrides) and the `AdjustmentNode` non-destructive filter stack. Building a parallel version of either violates the project's own architecture constraints (no parallel scene graph, no duplicate component system — AGENTS.md's hub-file and module-instability rules exist precisely to prevent this kind of drift).
- The actual missing primitive sits **one layer below** "Smart Object": a document-level, content-addressed **asset store** distinguishing embedded vs. linked storage, referenced by id from fills (and, later, from other content kinds). This is exactly what the `ImageFillData.src` comment ("stub until asset system lands") and the `RasterMaskAsset` precedent were already pointing at.
- Once that asset layer exists, "multiple layers share one image" becomes "reference the same asset id" (cheap), "replace image" becomes "swap the asset id + recompute natural dimensions" (fixes the existing bug for free), and "linked to an external file" becomes a storage-kind variant on the same table entry — without inventing a new node kind or a new override system.
- Full nested-document "edit Smart Object contents in a sub-editor" is a materially bigger, separate capability (real scoped undo, breadcrumb UX, a document-in-document render/undo boundary) that has no foundation yet — the isolation-mode audit shows the closest existing mechanism is UI-only. Building it before the asset layer exists means building it on data (inline base64, no identity) that would need to be migrated out from under it almost immediately.

---

## 5. Complexity and maintenance cost

| Scope | Cost | Touches |
|---|---|---|
| Asset-reference layer (embedded only): `Document.assets` map generalizing `RasterMaskAsset`, dedup by content hash, fills reference by id | **Moderate** — additive to mature infra | scene types/migration, fill read paths (`fills.ts`, `imageOperations.ts`, `ImageFillControls.tsx`), all render/export paths currently reading `fill.src` directly (~6 places per the export-flattening finding), cache-key enumerations (`cacheContentParts()`, `thumbnailCacheKey()`), autosave/recovery |
| + Linked (external file) storage kind | **Moderate, additive** | `Platform` interface (file-change detection per backend — real OS watch on Tauri via `notify`, best-effort on web via File System Access handles, no-op on memory), relink/missing-file UI, path portability (relative/absolute/project-relative) |
| + Full nested-document edit-in-place | **Large, not additive** | scoped undo (new infra, F2 session pattern as a starting point at best), isolation mode that actually forks state, breadcrumb UX, per-format nested editors (PSD-in-PSD is a different problem than PDF-in-.strata) |

---

## 6. Risks

- **File-size/perf bloat** — Photoshop's own most-cited user complaint (measured 2–3x file-size multipliers from embedded Smart Objects, worse when nested) is exactly what an asset layer without dedup-by-default would reproduce. Must ship with content-hash dedup from day one; retrofitting later is a breaking migration.
- **Track record of "documented as done, actually stubbed"** — this audit surfaced two real instances (PSD import, retouch-tool persistence) of features claimed complete in AGENTS.md that aren't. Anything shipped for this feature needs live E2E verification (per the repo's own `verify` skill and canvas-testing conventions), not just unit tests, before being called complete.
- **New attack surface if linking ships** — external file paths, decompression, and eventually project packaging introduce path-traversal, zip-slip, and decompression-bomb classes of risk that don't exist today. Scope this to Phase 2 and validate independently.
- **Security is moot for Phase 1** — an embedded-only asset store has the same trust boundary as today's inline data URLs; no new external input surface.

---

## 7. Recommended option

**Introduce a narrower non-destructive object model — an "Asset Reference" layer — not a Smart Object system.**

Rejecting a full Smart Object implementation for now: the prerequisite (real asset identity) doesn't exist, and the two things that make Smart Objects distinctive (nested document editing, Smart Filters) either duplicate existing systems (filters) or have no foundation yet (nested editing). Building "the real thing" today would mean building it twice.

Phase 1 (justified now): generalize `RasterMaskAsset` into a document-level `assets` map for image fills — `{ id, kind: 'embedded', hash, bytes/dataUrl, naturalWidth, naturalHeight }` — with fills referencing `assetId` instead of inlining `src`. Design the record shape so `kind: 'linked'` and non-raster `kind`s (vector/document) slot in later without a schema redesign, but implement only `embedded` raster now. This alone: fixes byte duplication, makes multi-instance-of-one-image real and cheap, and fixes replace-image correctness (stale dimensions) as a side effect.

Phase 2 (defer until Phase 1 ships and real usage validates demand): external file linking — relink, missing-file detection, manual refresh, path handling. Gate this behind actual user requests, the same way Figma gated it and ultimately declined.

Not now / likely never at full Photoshop parity: nested-document "edit contents in a sub-editor" with its own Smart Filters stack. Strata's `AdjustmentNode` + linked-adjustment-scope model already covers the non-destructive-filter half of this without a nested document at all; the remaining ask (embed and live-edit a whole other document/PSD/PDF inside a node) has enough new infrastructure cost and thin validated demand that it belongs behind a real user signal, not this audit.

Independent of the Smart Object decision — recommend fixing now, as separate work:
1. PSD import: either wire up `@webtoon/psd` for real or correct the AGENTS.md claim and the misleading "smart objects not supported" warning that implies partial support which doesn't exist.
2. Retouch tools (Healing Brush/Clone Stamp/Patch): verify live in-browser whether edits actually persist into the document; this looks like a silent-data-loss bug.

---

## 8. Explicit non-goals

- No new "Smart Object" node kind with its own bespoke flag set.
- No nested-document-in-document live editing or a second, node-scoped Smart Filters stack — `AdjustmentNode` already owns non-destructive filtering.
- No PSD/AI/PDF "keep editable inside Strata" round-trip in this phase — imports remain flatten-on-import.
- No external file linking, file-watching, relink UI, or project packaging in Phase 1.
- No changes to the component/instance/variant system — it already solves reuse for vector/frame content; this work is scoped to raster image assets only.
- No masking changes beyond what already exists (shared/reusable mask sources across unrelated containers is a real but separate, smaller gap — not required for this feature).
