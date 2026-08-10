# Thumbnail / Preview System — Current-State Audit (2026-08-09)

Audit performed before redesign per the Unified Thumbnail System task.
Every thumbnail-like path in the repository was mapped: producer, renderer,
source represented, cache key, persistence, dimensions, invalidation,
cancellation, scheduling, fallback, consumers, privacy, and renderer parity.

---

## 1. System inventory

| # | System | Location | Live? |
|---|--------|----------|-------|
| 1 | Platform thumbnail cache (content-hash keyed) | `packages/platform` (memory / web / tauri) + `crates/varve-sync` SQLite + Tauri IPC | **Live** |
| 2 | Legacy engine `renderThumbnail(doc)` mini-renderer | `packages/engine/src/thumbnail.ts` | **Live** (Home, InfoDialog) |
| 3 | Canonical engine `generateThumbnail(nodes)` IR service | `packages/engine/src/thumbnail/service.ts` | **Live** (editor path) |
| 4 | Editor doc-level source resolution | `packages/editor/src/thumbnail/thumbnailSource.ts` | **Live** |
| 5 | Editor thumbnail manager (save-time persistence) | `packages/editor/src/thumbnail/thumbnailManager.ts` | **Live** |
| 6 | Version-history thumbnail queue | `packages/editor/src/thumbnail/versionThumbnailQueue.ts` | **Live** |
| 7 | Page thumbnails | `packages/editor/src/components/PageNav/usePageThumbnail.ts` | **Live** |
| 8 | Pages panel thumbnails (reuses #7) | `packages/editor/src/components/PagesPanel/PagesPanel.tsx` | **Live** |
| 9 | Layers row thumbnails (28x28 mini-renderer) | `packages/editor/src/components/LayersPanel/useThumbnail.ts` + `thumbnailCache.ts` | **Live** |
| 10 | Home thumbnail loader (queue + in-memory LRU) | `packages/home/src/useThumbnailLoader.ts` | **Live** |
| 11 | Home file card / list display | `packages/home/src/FileCard.tsx`, `FileList.tsx`, `FileGrid.tsx` | **Live** |
| 12 | Home create/template immediate thumbnail | `packages/home/src/HomeShell.tsx` `generateThumbnail` | **Live** |
| 13 | ThumbnailSourcePicker + ThumbnailInfoDialog | `packages/editor/src/components/ThumbnailSourcePicker/` | **Dead code** (no importer outside tests) |
| 14 | Encrypted-project thumbnail policy | `packages/editor/src/thumbnail/encryptedThumbnailPolicy.ts` | **Dead code** (no importer) |
| 15 | Version history `VersionEntry.thumbnail` | `packages/platform` types + web/memory/tauri impls | **Persisted, never displayed** |
| 16 | Template previews | `packages/home/src/TemplatesGallery.tsx` | Placeholder icon only; `previewHash` unused for display |
| 17 | Asset previews | `packages/home/src/AssetBrowser.tsx`, `Asset.thumbnailHash` | **Dead field** (never written by any platform impl) |
| 18 | Export preview | `packages/editor/src/components/SpecPanel/export.ts` etc. | No thumbnail path (export dialog out of scope) |
| 19 | Minimap | `packages/editor/src/components/Minimap/` | Live navigation renderer, separate snapshot model; overlapping concept, not a cache |

---

## 2. Per-system map

### 1. Platform thumbnail cache — the shared storage today

- **API**: `Platform.getThumbnail(hash)`, `putThumbnail(record)`, `deleteThumbnail(hash)`, `evictThumbnails(keepCount)`.
- **Record**: `{ hash, dataUrl, width, height, createdAt }` — `dataUrl` is base64 PNG.
- **Key**: bare `contentHash` (FNV-1a 32-bit, 8 hex chars) of the serialized document JSON.
- **Storage**: memory `Map`; web IndexedDB store `thumbnails` (keyPath `hash`, index `createdAt`, DB version 3); Tauri SQLite `thumbnails` table (`hash`, `data_url`, `width`, `height`, `created_at`) via `home_get/put/delete/evict_thumbnail` IPC.
- **Eviction**: keep newest N by `createdAt` (memory `evictThumbnails`, SQLite same). Never called by any consumer.
- **Privacy**: no encryption distinction. `encrypted:` hash prefix exists as a convention in dead code only.
- **Renderer parity**: storage only; renderer varies by caller.

### 2. Legacy engine `renderThumbnail(doc)` — parallel mini-renderer

- **Producer**: Home (`useThumbnailLoader`, `HomeShell.generateThumbnail`) and `ThumbnailInfoDialog`.
- **Renderer**: `buildThumbnailScene` (hand-built engine `SceneNode`s: shape/frame/text only — no groups, masks, clips, adjustments, images, effects-driven geometry, tables) → stub engine `buildIr` → `replayIr` → PNG data URL.
- **Cache key**: caller-provided content hash (256x192).
- **Drift**: does not represent masks, clipping, image fills, blend-affecting geometry, components, or hidden-state filtering beyond `visible === false`. **Has drifted from the canonical pipeline.**

### 3. Canonical engine `generateThumbnail(nodes, revisionId, opts)` — IR service

- **Renderer**: engine `SceneNode[]` with pre-computed world transforms → stub engine `buildIr` → `replayIr` on a raster surface → PNG data URL.
- **Capability-gated** (`hasAnyCanvas` / `hasImageEncoding`); placeholder metadata when unavailable.
- **Limits**: `MAX_THUMBNAIL_DIMENSION = 4096` per side; no pixel-count or encoded-byte cap; PNG only; `devicePixelRatio` documented but unused; quality param exists.
- **Metadata**: cacheKey (content-hash of nodes+opts), sourceLabel, sourceBounds, scaleFactor, outputWidth/Height, mimeType, generatedAt, revisionId, isPlaceholder, warnings.
- **Cancellation**: AbortSignal honored between phases.
- **Fidelity**: as good as the nodes it is given — feed it `flattenSceneToEngine` output and it renders the canonical scene.

### 4. Editor `thumbnailSource.ts` — source resolution + a second hand-rolled conversion

- Resolves `document | page | frame | selection` → node ids + per-node `resolveWorldTransform` (hand-rolled affine composition, **missing page placement and rotation** — the editor's canonical `nodeWorldTransform` composes page placement per ADR-0123).
- Converts scene nodes to engine nodes via its own `toEngineNode` (shape/text/frame/group; **drops mask, clips, adjustments, image fills (passes `fills` only), tables, components, path-text**).
- **Duplication**: `packages/editor/src/render/sceneToEngine.ts` (`flattenSceneToEngine`) is the canonical conversion and header-declares "every live, worker, motion, thumbnail, and export path must use this module". `thumbnailSource.ts` does not use it.

### 5. `thumbnailManager.ts` — save-time persistence

- `persistProjectThumbnail(platform, doc, preference?)` — called after save AND after Save As in `context/usePersistence.ts` **without the preference** (always automatic).
- `preferenceToSource` falls back to `{ type: 'document' }` when the preference targets a missing page/node — silently, no invalidation signal.
- Writes under `contentHash(JSON.stringify(doc))` — the same key for every source/variant/preference: **different sources overwrite each other**.
- `clearPersistedThumbnail(platform, hash)` — manual clear.

### 6. Version thumbnail queue

- Bounded FIFO (concurrency 1, max 50, idle-scheduled), revision-matched guard (`documentHash === job.revisionHash` re-checked after generation), shutdown support.
- Generates 120x90 PNG via `generateDocThumbnail` (automatic source only), stores into `VersionEntry.thumbnail` (data URL).
- Pruning versions does not clean thumbnails explicitly (thumbnail is embedded in the entry row — deleted with the row).
- **Never displayed** by any UI today (Home `VersionHistory.tsx` renders no thumbnails).

### 7. Page thumbnails — `usePageThumbnail`

- Module-level `Map<string, string>` LRU (50) **keyed by bare page id** — cross-document collision risk (two documents with `page1`/`n1` ids, or any document closed and another with same ids opened, serves stale pixels).
- Generation: `generateDocThumbnail({ source: { type: 'page', pageId } })` 180x90 white bg.
- Guards: in-flight set per page id, generation counter, mounted flag. Cache never invalidated by document revision.
- Consumed by PageNav tabs and PagesPanel rows (same hook).

### 8. Layers thumbnails — `renderNodeToCanvas`

- Deliberately simplified 28x28 mini-renderer: rect/ellipse/circle/line/polygon/star/path (simplified), text "T", frame/group box, image fills via `getImageCache`, raster mask via `destination-in`, stroke, rotation, opacity. **Documented divergence** from full renderer.
- Cache: `ThumbnailCache` LRU (200) with **doc-namespaced** key `docId:nodeId:kind:fillHash:shapeHash:imageSrc:maskRev:dims` — the only cache in the repo that already handles cross-document collisions correctly (per `docs/plans/layers-panel-deferred.md`).
- Idle-scheduled, in-flight per key, active-key guard.

### 9. Home loader + display

- `useThumbnailLoader`: in-memory `Map<fileId, dataUrl>` LRU 100; batch queue of 5, idle-scheduled, priority bump on focus; `getThumbnail(contentHash)` → miss → `readFile` → legacy `renderThumbnail` → `putThumbnail` (256x192).
- **Race**: in-memory map keyed by `entry.id`, platform keyed by `contentHash` — stale async jobs are guarded only by the loading set; a file edited (hash changed) while a job is in flight can write a thumbnail under a stale hash and the map entry can show a stale image. No request-identity/generation token.
- `FileCard` renders via direct DOM mutation (`innerHTML = ''` + `new Image()`) — bypasses React, no object-fit, no error state, no alt text, no loading/lazy handling beyond a skeleton div.
- `FileList` uses `<img>` directly.
- **No encrypted handling**: `RecentFileRecord.encrypted` is never consulted by the thumbnail path.

### 10. Preference persistence

- `FileEntry.thumbnailPreference?: ThumbnailSourcePreference` exists in types; preserved through `upsertPreservingMeta` (spread of existing entry); **no dedicated Platform method** (pick-up via `upsertFile` in dead dialog code).
- **Not persisted in document JSON** (app metadata — documented decision needed).
- Editor save path ignores the preference entirely (`persistProjectThumbnail` called without it).

### 11. Encrypted policy

- `encryptedThumbnailPolicy.ts` implements: placeholder SVG, `removePlaintextThumbnail`, `createEncryptedThumbnailRecord` (`encrypted:` key), `clearProjectPreviewData`. **Exported but never imported** — the policy is not enforced anywhere.

### 12. Templates / assets / versions display

- Templates: gallery shows an icon proxy; `previewHash` unused for display; `createTemplateFromFile` computes a hash but never an image.
- Assets: `Asset.thumbnailHash` typed as optional string, read by `AssetBrowser`, **never written**.
- Versions: `VersionEntry.thumbnail` written by the queue; never read by UI.

---

## 3. Cross-cutting findings

### Duplication matrix

| Concern | #2 legacy renderer | #4 source conversion | #8 layers renderer | Canonical (`sceneToEngine` + `generateThumbnail`) |
|---|---|---|---|---|
| Scene→engine conversion | buildThumbnailScene (subset) | toEngineNode (subset) | hand-rolled canvas | `flattenSceneToEngine` |
| Bounds/fit | own | own | fixed 28x28 | service |
| Cache key | contentHash | contentHash | doc-namespaced node key | metadata.cacheKey (unused) |
| Scheduling | none / loader queue | none | idle callback | queue (version) |

### Identity defects (all confirmed by code)

1. **Bare page id cache** in `usePageThumbnail` (module-level, process-lifetime) — cross-document collisions.
2. **Single key per content hash** in the platform store — source preference, variant (size/fit/background), and renderer version all collide; last write wins.
3. **Content hash is FNV-1a 32-bit** — acceptable at editor scale but the *only* discriminator; combined with #2 there is no way to store two thumbnails for one document.
4. **No revision guard on Home loader** — stale async results can overwrite newer state.
5. **No invalidation events** — source deleted, preference changed, encryption changed, font/image readiness: none invalidate existing entries.

### Race hazards

- Home loader: no generation token; late completion after document changed writes under an old hash and renders from an old map entry.
- PageNav: generation counter guards React state, but the module cache key is revision-blind.
- Version queue: correctly revision-guarded (model for the rest).
- `persistProjectThumbnail` after save: fire-and-forget, no cancellation, no stale guard (two rapid saves can interleave; last-completed wins, which may be the older document).

### Privacy

- Encrypted projects: policy exists but is dead code; nothing prevents a plaintext thumbnail write for an encrypted document.
- Cache keys/logs: hashes are content-derived; no project names/paths in keys. OK.

### Renderer parity

- Home/InfoDialog use the **legacy** path; editor uses the **service**; pages use the **source module**; layers use a **documented simplified** path. Four render paths, two conversions of scene→engine, one (sceneToEngine) canonical.

---

## 4. What survives the redesign

| Asset | Fate |
|---|---|
| `Platform.get/put/delete/evictThumbnail` storage API | Retained; key becomes the canonical identity |
| `ThumbnailSourcePreference` (automatic/page/frame/selection) | Retained as persisted preference; extended with `region`; resolution moves to `@varve/scene` |
| Engine `generateThumbnail` IR service | Retained + upgraded (format, caps, rendererVersion, image preload) |
| `VersionThumbnailQueue` revision-guard pattern | Adopted into the shared scheduler |
| Layers `thumbnailCacheKey` doc-namespacing | Adopted as the model for all identities |
| Layers 28x28 renderer | Kept as a documented, deliberately-simplified node profile |
| `persistProjectThumbnail` | Reworked: preference-aware, identity-keyed, scheduler-routed |
| `flattenSceneToEngine` | Becomes the single doc→engine conversion for thumbnails |
| Encrypted policy module | Rewired into Home display + platform write path |
| ThumbnailSourcePicker/InfoDialog | Rewritten as the canonical picker wired to live editor state |
| Legacy `renderThumbnail` (engine `thumbnail.ts`) | Removed; all consumers migrate to the canonical pipeline |
| Home loader | Reworked: identity keys, generation token, bounded scheduler, `<Thumbnail>` primitive |
| `usePageThumbnail` | Reworked: revision-aware identity, doc-namespaced cache |
| `Asset.thumbnailHash` dead field / template `previewHash` | Left as-is (out of scope); documented as gaps |

See `docs/architecture/thumbnail-system.md` (post-implementation) for the
canonical model, and `docs/architecture/adr/0016-thumbnail-system.md` for the
cross-package ownership decision.
