# ADR-0015: Non-Destructive Mockup System

- Status: Accepted — Level 1 + Level 2 implemented (2026-08-05)
- Date: 2026-08-05
- Deciders: Architecture (repository-first audit of 2026-08-05)

## Context

Varve needs a first-class, non-destructive mockup workflow: place frames,
groups, pages, images, logos, and packaging content into realistic
presentation scenes (phones, laptops, posters, cards, boxes), keep the
mockup linked to its source so later edits update automatically, and export
high-quality flattened presentations while retaining an editable Varve
document.

The audit (docs/audits/mockup-capability-audit-2026-08-05.md) verified:

- No mockup node kind, no homography, no perspective rendering exists.
- `RenderItem.transform` is strictly affine (`packages/engine/src/types.ts:92`).
- `meshWarp.ts` provides a CPU ImageData warp (unintegrated into replay).
- `packages/scene` has a content-addressed asset table (`Document.assets`,
  `types.ts:508-520`) with `storage: 'linked'` designed as a future
  extension point — never implemented.
- Templates are flat `TemplateLibrary` records; the Tauri backend has no
  template commands; there is no template package format, no licensing
  metadata, and no thumbnail image storage for templates.
- The icon-pack manager (`IconBrowser/PackManager.tsx`) is the closest
  precedent for manifest-driven, licensed, cached content packs.
- Hub files (`CanvasArea.tsx`, `Shell.tsx`) are over their import budget and
  must not gain imports without removing equal-weight ones.

## Decision

### 1. A mockup is a FrameNode with a `mockup` payload

Add an optional `mockup?: MockupInstanceData` field to `FrameNode`
(`packages/scene/src/types.ts`). Rationale:

- A mockup is a real, editable, transformable object. Frames already provide
  position/size/rotation/opacity/blend/clip/masks, selection, hit-testing,
  layers, undo, and export for free.
- A new node kind would require touching the `SceneNode` union, engine
  `shapeToPrimitive`, hit testing, spatial indexes, tools, codegen, and
  dozens of kind-switches — high risk for no modelling gain.
- The `logoProject` precedent (document-level feature metadata over ordinary
  frames) shows this pattern is already idiomatic in Varve.

The mockup frame is a separate presentation object. The source design stays
where it is, editable and visible; the mockup references it.

### 2. Templates are document-embedded template assets

Add `Document.mockupTemplates: Record<MockupTemplateId, MockupTemplateAsset>`.
Template definitions (surfaces, geometry, plate shapes, overlays, licensing)
are copied into the document on first use and deduplicated by content hash.
This keeps documents self-contained: save/reopen/offline work without any
library lookup, and clipboard/package closure is explicit.

Built-in templates are generated programmatically (vector plate shapes —
original artwork, no device trade dress or brand marks), so no binary assets
ship and licensing stays verifiable. The template schema reserves raster
assets (background plates, masks, displacement maps) for user and community
templates; raster-bearing templates are validated at import.

### 3. Rendering rides the existing IR + replay pipeline

Mockups must not become a second renderer. The IR for a mockup frame is
composed of ordinary items:

- background plate: rect/ellipse primitives from the template's vector
  shapes;
- surface chrome: template plate shapes drawn behind the content;
- surface content: an image-fill item (flat surfaces) or a new
  `warpedImage` primitive (perspective surfaces) whose source is a cached
  raster of the linked source subtree;
- overlays: shape items (shadows, glows, reflections) with existing
  effects/blend modes.

One new primitive kind (`warpedImage`) is added to the engine replay switch
(with a benchmark run before merge, per AGENTS.md). Perspective warping is a
numerically stable inverse-homography per-pixel warp with bilinear sampling
(`packages/engine/src/mockup/quadWarp.ts`), reusing the `meshWarp.ts`
sampling approach for the Level-3 seam.

Because surfaces render through the same IR/replay path, preview, worker
rendering, and export are automatically pixel-identical (preview/export
parity without a second code path).

### 4. Source rasterization is injected by the host, not owned by the engine

Rendering a linked source subtree with full structural fidelity (masks,
clipped frames, isolated groups) requires the structural replay that only
the editor has (`replaySubtreeToCtx` on the live canvas,
`replayStructuredScene` in deterministic export). Therefore the editor owns
the surface rasterization:

- `packages/editor/src/render/mockup/mockupIr.ts` — `decorateMockupIr(...)`
  turns a mockup frame's IR into the composed mockup IR. It receives a
  `renderSourceToCanvas` callback from the host (CanvasArea draw path or the
  export compositor), so both hosts get identical results.
- A `MockupSurfaceCache` keys cached surface rasters by
  (frame id, surface id, source digest, quality bucket). The digest is a
  cheap content hash of the source subtree (`computeMockupSourceDigest` in
  `packages/scene/src/mockup/`), so source edits invalidate only affected
  surfaces. Cache eviction is LRU with a byte budget.

### 5. Scope: Level 1 (flat) + Level 2 (perspective) now; 3-5 later

- Level 1 flat mockups: affine placement (contain/cover/stretch/native +
  alignment), masks via the frame system.
- Level 2 perspective: four-corner quad placement through the homography;
  quad handles on canvas + numeric controls; invalid geometry rejected or
  clearly reported.
- Level 3 mesh/cylindrical: schema reserves `'mesh'`/`'cylindrical'` surface
  kinds; `warpMesh` is the intended seam. Deferred (see
  docs/architecture/mockup-system.md).
- Level 4 photographic templates (raster plates, occluders, displacement):
  schema reserves the fields; validation exists; deferred.
- Level 5 multimodal detection: `MockupRequest` types + schema validation
  ship now; the detection/segmentation pipeline is documented and deferred.

### 6. UI: a Mockups tab in the unified resources panel

The Library panel (`ResourcesPanel`) gains a third tab, Mockups. Zero new
Shell.tsx imports. Discoverability: canvas context menu ("Apply mockup…"),
Object menu, command palette, and the inspector mockups section. No new
workspace/panel plumbing.

### 7. Package ownership

- `@varve/scene`: `src/mockup/` — types, validation, built-in template
  catalog, ops (dedup/prune/bindings/detach), source digest, migration,
  codec normalization, clipboard closure.
- `@varve/engine`: `src/mockup/` — homography solve/validation, quad warp,
  fit math; `warpedImage` primitive in replay.
- `@varve/editor`: `src/render/mockup/` — IR decoration, surface cache,
  plate/overlay drawing; `src/components/Mockups/` — panel, previews,
  overlay; Inspector section; actions.
- `@varve/home`: deferred (mockup templates are scene-anchored, not document
  starting points; editor-side discovery is the primary surface).
- `@varve/platform`, `@varve/ai`, `@varve/compositor`: unchanged for this
  milestone (compositor backends never see scene semantics).

## Consequences

- Documents gain a `mockupTemplates` table and frames may carry `mockup`
  payloads. Version bumps 2.14 → 2.15 with a normalization migration.
- Replay gains one additive primitive case; benchmarked before merge.
- Mockup frames force the structural (main-thread) render path when present
  (worker renderer is disabled), because surface rasterization is
  main-thread. Browsing mockup templates never touches the canvas.
- Imported user templates are treated as untrusted: size/count/hash limits,
  geometry validation, licence passthrough with unknown-permission
  semantics.
- AI assistance stays optional; no model is added by this work.
