# Mockup System — Current-State Capability Audit (2026-08-05)

Repository-first audit performed before any mockup implementation. All
claims verified against the working tree at commit `77053fe9`.

## Search coverage

Queried for: mockup, device frame, presentation, screen preview,
perspective, homography, quad transform, mesh warp, displacement, envelope
deformation, smart object, linked content, template asset, clipping mask,
image fill, rasterization, shadow, reflection, surface, depth, segmentation.

Notable hits: `packages/engine/src/meshWarp.ts` (CPU warp, unintegrated),
`packages/scene/src/textWarp.ts` (envelope text warp), prototype
`DeviceFrame` (presentation chrome), `docs/audits/smart-object-feasibility-audit.md`
(asset-reference precedent), glitch effect channel displacement
(`effectPipeline.ts`). No homography, no perspective rendering, no mockup
concept anywhere in code.

## Capability matrix

| Capability | Existing | Partial | Missing | Broken | Evidence | Proposed owner |
|---|---|---|---|---|---|---|
| Flat device frame | | X | | | `DeviceFrame` in prototype presenter (`editor/src/components/Prototype/`); presentation-only, not document content | `@varve/scene` (template data) + `@varve/editor` (render) |
| Linked screen content | | | X | | No linked/smart-object concept; `AssetStorageKind 'linked'` designed but unimplemented (`scene/src/types.ts:487-492`); smart-object audit scoped it out | `@varve/scene` |
| Four-corner perspective | | | X | | `RenderItem.transform` strictly affine (`engine/src/types.ts:92`); no mat3/homography anywhere; perspective grid only in docs | `@varve/engine` |
| Mesh warp | | X | | | `meshWarp.ts` (540 lines, ImageData warp, tested at `meshWarp.test.ts:237`) — unintegrated into replay; editor has a handle-drag overlay only | `@varve/engine` |
| Curved/cylindrical surface | | | X | | Only color-science "cylindrical" (Lab LCh) in `nonSeparable.ts` | `@varve/engine` |
| Occlusion masks | | X | | | Scene masks (clip/alpha/luminance) are per-container and structural (`scene/src/masks.ts`); no template-level occluder concept | `@varve/scene` |
| Highlight/reflection overlay | | | X | | Nothing renderable per-template; reflection only in motion/video and text glyph paths | `@varve/scene` + `@varve/editor` |
| Shadow system | | X | | | dropShadow/outerGlow effects, alpha-aware shadow path (`replay.ts`); no contact-shadow/mockup-specific system | `@varve/scene` + `@varve/editor` |
| Template browser | | X | | | `TemplatesGallery` (`home/src/TemplatesGallery.tsx`) renders category-icon proxies — no real thumbnails; Tauri template commands absent from `lib.rs` invoke handler (would fail on desktop) | `@varve/home` (later) |
| Template authoring | | | X | | No package format, no manifest, no authoring UI | `@varve/scene` (format), `@varve/editor` (UI) |
| AI surface detection | | | X | | `@varve/ai` is a mock chat + command registry; real model infra is `engine/src/inference/` (u2netp etc.) with no surface/plane detection | `@varve/ai` (later) |
| High-resolution export | | X | | | `tiledExport` (`engine/src/export.ts:20`) tested but unwired; `renderBoundaryToSurface` with `exportScale` (`editor/src/export/compositor.ts:821`); no mockup-specific path needed | `@varve/editor` |
| Batch variants | | | X | | No multi-template/multi-source batch concept | `@varve/editor` |
| Offline use | | X | | | All scene data embedded; but templates have no local storage path on desktop and no packaged assets | `@varve/scene` |
| Licensing metadata | | | X | | `TemplateLibrary` has none; icon packs have SPDX + licenceUrl (the pattern to copy); no template-level licence | `@varve/scene` |

## Reusable foundations (verified)

- Immutable scene ops + snapshot undo (`scene/src/document-nodes.ts`,
  `editor/src/context/useHistory.ts` with begin/commit/abort transactions).
- Content-addressed assets with dedup (`scene/src/assets.ts:
  findOrCreateEmbeddedAsset`, FNV-1a 64-bit `hashContent`), pruning
  (`pruneUnusedAssets`), clipboard closure (`documentCodec.ts:668-711`).
- Versioned codec with migration chain (`scene/src/version.ts`,
  CURRENT_DOCUMENT_VERSION '2.14'; standalone migration module pattern in
  `colorMigration.ts`).
- Offscreen raster surfaces + `replayIr` + structural replay twins
  (`engine/src/rasterSurface.ts`, `raster.ts:renderRaster`,
  `editor/src/render/replayScene.ts`).
- CPU per-pixel warp (`engine/src/meshWarp.ts`) — the sampling foundation
  for the homography warp.
- Raster export at scale (`editor/src/export/compositor.ts`), export presets
  and metadata policy (`scene/src/export/`), PNG text-chunk metadata
  (`editor/src/components/SpecPanel/export.ts:insertPngTextChunks`).
- Manifest-driven, licensed, cached pack precedent
  (`editor/src/components/IconBrowser/PackManager.tsx` + `iconStorage.ts`
  LRU budget).
- Image cache + worker ImageBitmap transport (`engine/src/imageCache.ts`,
  `editor/src/render/renderWorker.ts`).
- Frame branch in `CanvasArea.replaySubtreeToCtx` (`CanvasArea.tsx:2065`),
  deterministic twin `replayStructuredScene`, structural-compositing gate
  (`render/sceneCompositing.ts`).

## Traced workflow (UI entry → mutation → render → save → export)

1. UI entry: selection → Inspector sections / context menu (both exist).
2. Mutation: `updateDoc(fn)` + transaction (`context.tsx:2488`, `useHistory.ts`).
3. Render: drawContent builds IR per node → `replaySubtreeToCtx` /
   compositor → worker. (Verified reachable for a new frame payload.)
4. Save/reload: `DocumentCodec.encode/decode` + version migrations.
5. Export: `ExportService` → `export/compositor.ts` → `replayStructuredScene`.

The mockup system hooks these five points; none require new architecture.

## Conclusions

- Nothing exists for mockups beyond generic device-preview chrome and an
  unintegrated CPU warp. Level 1 and Level 2 must be built from scratch, but
  every foundation (assets, undo, codec, replay, export, packs) is present.
- The IR/replay-first architecture (ADR-0001) makes preview/export parity a
  structural property of the design: mockups render as ordinary IR items.
- Deferred scope (mesh/cylindrical surfaces, photographic raster templates,
  multimodal detection, batch export, Home discovery, community packs) is
  documented in `docs/architecture/mockup-system.md`.
