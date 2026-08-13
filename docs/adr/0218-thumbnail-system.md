# ADR-0218 — Unified Thumbnail System

- Status: accepted
- Date: 2026-08-09
- Deciders: architecture session (unified thumbnail task)
- Supersedes: the informal content-hash-keyed thumbnail cache introduced
  with the Home surface; the legacy engine `renderThumbnail` mini-renderer;
  the hand-rolled page/frame source conversion in
  `packages/editor/src/thumbnail/thumbnailSource.ts`.

## Context

Varve accumulated partially overlapping thumbnail paths: Home file cards,
page navigation, pages panel, layers previews, version history, template
and asset previews. They disagreed on cache keys (bare content hash vs bare
page id vs doc-namespaced node keys), on renderers (legacy mini-renderer vs
IR service vs simplified 28×28 canvas), and on identity semantics
(cross-document node-id collisions, source/variant collisions, no revision
invalidation, stale async overwrites). Users had no way to choose what
represents a design. Encrypted-project policy existed but was dead code.
See `docs/audits/thumbnail-system-current-state-2026-08-09.md`.

## Decision

Thumbnail is a platform capability with one source of truth:

1. **Contracts in `@varve/shared`** — `ThumbnailSourceSpec`
   (automatic/page/frame/selection/region), `ThumbnailVariant` (+ registry),
   `ThumbnailStatus`, `ThumbnailPolicy`, and `computeThumbnailIdentity`.
   Deterministic cache identity = docKey + revisionHash + sourceKey +
   variantKey + rendererVersion + profileKey. Pure, framework-agnostic.
2. **Source resolution in `@varve/scene`** — `resolveThumbnailSource` with
   the deterministic automatic heuristic (active page → largest populated
   frame → root content → empty placeholder). Document-domain, pure.
3. **Rendering through the canonical pipeline** — the editor service
   resolves sources, converts via `flattenSceneToEngine` (the same module
   the canvas uses), and renders via the engine `generateThumbnail` IR
   service. One conversion; no parallel mini-renderer for covers. Raster
   fills request an `ImageCache.loadAtSize` representation capped to the
   thumbnail's physical output size when the runtime supports at-size decode;
   the full source remains authoritative for live replay and export.
4. **Persistence unchanged in shape** — identity strings as cache keys in
   the existing platform store; `setThumbnailPreference` on the FileEntry
   (app metadata, never document bytes). Legacy entries are disposable
   warm-migration fallbacks.
5. **One bounded scheduler** — concurrency 1, priority, dedupe,
   cancellation, stale-job guards (editor).
6. **User-selected sources** — File menu, canvas/page context menus,
   command palette, and a picker dialog; preference survives restarts;
   missing sources fall back to automatic and are surfaced.
7. **Encryption enforced** — encrypted sessions write only the content-free
   placeholder; Home never displays cached pixels for encrypted files.

## Consequences

- One documented model; duplicate/legacy implementations removed or adapted
  (legacy engine `renderThumbnail` is deprecated and slated for removal once
  all consumers migrate; the Layers 28×28 renderer remains as a documented
  node-preview profile).
- Cache identity fixes cross-document collisions, variant collisions, and
  revision staleness by construction; races are killed by scheduler
  key-based cancellation.
- New preview surfaces (project covers, embedded `.varve` previews, OS
  thumbnails, motion poster frames) are additional subjects/variants over
  the same system — no new subsystem.
- Cost: an extra `@varve/scene` module and editor orchestration module;
  Home no longer generates thumbnails itself (editor save path does), so
  never-opened legacy files show placeholders until the next save.

## Raster representation policy

Thumbnail generation is allowed to use a disposable display representation,
but never rewrites or replaces the embedded source. Inline `data:`/`blob:`
assets use the shared byte-bounded at-size cache when `createImageBitmap` is
available. Remote URLs and runtimes without that API use the existing full
HTML-image path, preserving Canvas2D correctness across WebKit/WebView
deployments. A thumbnail render receives the selected resource through
`replayIr`'s image lookup hook, so it does not change the main canvas cache
entry or placement state.

## Alternatives considered

- **Keep per-surface caches**: rejected — the audit found 4 render paths
  and 3 cache-key schemes already drifting apart.
- **Full scene→engine conversion moved to `@varve/scene`**: rejected —
  `flattenSceneToEngine` depends on editor-internal modules (table compile,
  mask proxies, page placement); layering keeps the conversion editor-owned
  and makes Home a consumer, not a generator.
- **Home-side generation via a scene-owned subset renderer**: rejected —
  recreates the parallel-renderer drift the audit identified.
- **Binary BLOB storage instead of data URLs**: deferred — measured
  overhead is small; byte caps + eviction bound growth; revisit when
  persistent-store benchmarks demand it.
