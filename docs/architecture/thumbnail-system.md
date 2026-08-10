# Thumbnail System

Canonical architecture for every thumbnail-like representation in Varve:
Home file cards, page navigation, pages panel, version history, the file
thumbnail picker, and any future preview surface (project covers, embedded
`.varve` previews, OS file thumbnails).

Thumbnail is a **platform capability**, not a collection of unrelated
screenshots. A Varve thumbnail has: an explicit subject + source + revision
+ render profile + privacy policy + deterministic cache identity + bounded
lifecycle. UI surfaces request that representation; they never invent their
own rendering or cache logic.

See also: `docs/audits/thumbnail-system-current-state-2026-08-09.md` (the
pre-redesign map of 19 overlapping systems), `ADR-0016` (cross-package
ownership).

---

## 1. Model

```
ThumbnailSourceSpec  what content represents the file
  automatic | page | frame | selection | region        (packages/shared)

ThumbnailVariant     output profile for a role
  role + width + height + fit + background + format + dpr  (packages/shared)

ThumbnailPolicy      privacy + resource policy
  encrypted + allowEmbeddedPreview + networkAccess:'denied'  (packages/shared)

ThumbnailIdentity    deterministic cache key
  docKey + revisionHash + sourceKey + variantKey + rendererVersion + profileKey
                                                             (packages/shared)
```

Layering (no cycles, contracts at the lowest appropriate layer):

| Layer | Owns |
|---|---|
| `@varve/shared` | Contracts: `ThumbnailSourceSpec`, `ThumbnailVariant` + `THUMBNAIL_VARIANTS` registry, `ThumbnailStatus`, `ThumbnailPolicy`, `computeThumbnailIdentity`, `ENCRYPTED_PROJECT_PLACEHOLDER`. Pure — no DOM/engine/scene/React. |
| `@varve/scene` | Document-domain resolution: `resolveThumbnailSource` (page/frame/selection/region/automatic heuristic), `validateThumbnailSource`, `hasRenderableContent`. Pure over `Document`. |
| `@varve/engine` | Render service: `generateThumbnail(nodes, revisionId, opts)` — IR build + replay on a raster surface, hard pixel/byte caps, image-fill preload, `THUMBNAIL_RENDERER_VERSION`. |
| `@varve/platform` | Persistence: `get/put/delete/evictThumbnail` keyed by identity string; `setThumbnailPreference` on the FileEntry; memory / IndexedDB / SQLite backends. |
| `@varve/editor` | Orchestration: `renderDocThumbnail` (resolution → `flattenSceneToEngine` → engine service), `ThumbnailScheduler`, `thumbnailManager` (save path), `thumbnailCommands`, picker dialog + host, version-history queue, page thumbnails. |
| `@varve/home` | Consumption: canonical identity load, legacy warm-migration fallback, `<Thumbnail>` display, encrypted placeholder. |
| `@varve/ui` | `<Thumbnail>` presentation primitive (loading/skeleton/error/empty/encrypted states, object-fit, checkerboard, a11y). |

## 2. Identity — the cache key

`computeThumbnailIdentity` (packages/shared) composes:

```
thumb:v2:<namespace>:<docKey>:<revisionHash>:<sourceKey>:<variantKey>:<rendererVersion>:<profileKey>
```

Rules (all enforced by deterministic unit tests):

- `docKey` is the **stable file id** (`FileEntry.id`), never a bare node or
  page id — node ids are per-document sequential counters (`n1` in every new
  document) and collide across documents.
- `revisionHash` is the content hash of the serialized document — editing
  the design invalidates the entry by construction.
- `sourceKey` distinguishes automatic/page/frame/selection/region; selection
  ids are sorted (order-independent).
- `variantKey` separates output profiles (home-card vs page-nav vs
  version-history…) so surfaces never fight over one slot.
- `rendererVersion` (`THUMBNAIL_RENDERER_VERSION` in the engine) bumps the
  key when the render pipeline semantics change — old images are naturally
  invalidated instead of migrated.
- Identity version `v2` marks canonical keys; legacy bare content-hash keys
  are read as a **disposable warm-migration fallback** and regenerated on
  the next save.

## 3. Source resolution and the automatic heuristic

`resolveThumbnailSource` (packages/scene) is deterministic:

- `automatic` → active page (master-aware projection) when the document has
  pages; otherwise the largest populated top-level frame; otherwise root
  content; an empty document reports `validity: 'empty'` and callers render
  the empty placeholder instead of transparent pixels.
- `page` → master-aware page projection (`activePageNodesWithMaster`),
  rendered in page-local coordinates (page at the origin), frame = page rect.
- `frame` → the node plus its visible descendants; `worldFrame` = content
  bounds.
- `selection` → surviving renderable ids; `worldFrame` = union bounds.
- `region` → crop of the automatic scope to a user rectangle (document
  coordinates).

Guides, rulers, selection handles, collab cursors and debug overlays are
never scene nodes — excluded structurally. Hidden nodes are excluded
explicitly. Missing sources (deleted page/frame) report
`missing-source`; the service falls back to automatic and reports
`fallbackApplied` so the UI can surface it.

## 4. Rendering — one pipeline

Every thumbnail renders through the **canonical conversion**
`flattenSceneToEngine` (the same module the canvas uses — masks, clips,
opacity, blend modes, gradients, effects, adjustments, image fills, tables,
text) into engine IR, then through the engine thumbnail service
(`generateThumbnail`): build IR → replay → encode.

- Page previews pass `localTransforms: true` so a page renders in
  page-local coordinates instead of at its pasteboard placement.
- Raster fills are preloaded through the shared image cache with a bounded
  timeout; results rendered before sources were ready are marked
  `isProvisional` and never stored as authoritative.
- Fonts are awaited within a bounded deadline (`document.fonts.ready` +
  500 ms); failures never block generation.
- Empty documents produce a deterministic SVG placeholder.
- Deliberate divergence, documented: the Layers panel 28×28 node previews
  keep their simplified single-node renderer (a node-preview profile, not a
  document cover); master rendering on page previews follows the
  master-aware projection.
- Hard limits: 2048 px per side, 2048² total pixels, 768 KB encoded bytes
  (quality fallback), `image/png`/`image/webp` with encoder fallback,
  network access structurally denied (`ThumbnailPolicy.networkAccess`).

## 5. Persistence

- **Preference** (`ThumbnailSourcePreference`) lives on the `FileEntry`
  (app metadata, not document JSON — it must not change the document bytes
  and invalidate every revision hash). `Platform.setThumbnailPreference`
  persists it; `upsertPreservingMeta` keeps it across saves.
- **Image data** is stored keyed by identity string in the existing
  platform thumbnail store (SQLite `thumbnails` table / IndexedDB
  `thumbnails` store / memory map) — no schema migration required; old
  entries are disposable.
- Data URLs are retained (measured: a 256×192 PNG encodes to ~5–20 KB;
  base64 overhead is ~33% — acceptable at 100–1000 files; the eviction
  policy bounds growth). Byte size is recorded in metadata for future
  binary-BLOB migration decisions.

## 6. Scheduling

`ThumbnailScheduler` (packages/editor) is the single bounded queue:
concurrency 1 (background thumbnail work must never compete with canvas
interaction), priority order visible > current-doc > background > idle,
deduplication by identity key, cancellation (a newer request for the same
key aborts the running job), idle-time dispatch, shutdown support. Version
history reuses it with `idle` priority and its own revision re-check after
generation. Home's loader uses its own bounded batch queue (canonical
identity lookups only — generation is editor-owned).

## 7. Invalidation

Invalidation is **identity-based**: the key changes when the document
revision, source preference, variant, or renderer version changes, so a
stale entry can never be served or overwritten. Race protection:

- the scheduler aborts + replaces jobs by key;
- `renderDocThumbnail` takes an AbortSignal checked between phases;
- the version queue re-checks `versionId + documentHash` after generation;
- a missing source degrades to automatic with `fallbackApplied`, never a
  broken cover; the preference itself is left untouched.

## 8. Privacy / encryption

Encrypted projects never write decrypted pixels to plaintext caches
(`thumbnailPolicyForEncrypted` + `clearProjectPreviewData` on the save
path). Home forces the content-free `ENCRYPTED_PROJECT_PLACEHOLDER`
(shared) for any file whose recent record is encrypted, regardless of cache
contents. Cache keys are content hashes — no project names or paths.

## 9. UI surfaces

- **Editor — File menu** "Set File Thumbnail…", canvas context menu ("Use
  Selection as File Thumbnail", "Use Frame as File Thumbnail", "Set File
  Thumbnail…"), page context menu ("Use Page as File Thumbnail"), and the
  command palette (all commands registered in the action registry, keyboard
  accessible).
- **ThumbnailPickerDialog** — previews each source through the canonical
  pipeline before committing, persists the preference, surfaces missing
  sources, resets to automatic, restores focus, keyboard-operable, no
  native `<select>`.
- **Home** — `<Thumbnail>` primitive with loading/empty/error/encrypted
  states; cards never render via DOM mutation.

## 10. Gaps (intentionally deferred)

- Home file-context-menu "Choose Thumbnail…" (needs editor context; the
  picker is editor-side; Home shows canonical previews).
- Project covers / mosaics (Subjects of the unified system — see §14 of the
  task spec; not built).
- OS file thumbnails / embedded `.varve` previews (format-compatible; the
  identity + persistence model extends without rewrites).
- Motion poster frames: deterministic now (revision-hash identity means
  time-0 render); a `posterTime` source can be added to the spec union
  without architecture changes.
- Worker/OffscreenCanvas generation (renderer duplication cost outweighed
  by 256×192 idle-rendered images; capability fallbacks exist).
