# ADR-0015: Non-Destructive Mockup System

- **Status:** Accepted — Level 1 + Level 2, photographic templates, a
  bounded cylindrical slice, and bounded mesh envelope surfaces implemented
  (last amended 2026-09-25)
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

### 5. Scope: Level 1 (flat) + Level 2 (perspective) + bounded cylinder + bounded mesh

- Level 1 flat mockups: affine placement (contain/cover/stretch/native +
  alignment), masks via the frame system.
- Level 2 perspective: four-corner quad placement through the homography;
  quad handles on canvas + numeric controls; invalid geometry rejected or
  clearly reported.
- Level 3 curved, part 1 — cylindrical surfaces have a bounded front-facing
  orthographic remap with explicit axis, visible arc, seam, and crop
  controls. This is raster mapping, not a 3D renderer, and does not infer a
  backside, camera, radius, or light.
- Level 3 curved, part 2 (2026-09-25) — mesh envelope surfaces: a bounded
  (rows+1)×(cols+1) grid of bilinear patches behind `kind: 'mesh'` at
  template schemaVersion 3. Cells must stay convex; folds that would turn a
  cell inside out are rejected at validation, at IR build, and mid-drag.
  This is an envelope for folded fabric and drape — still no lighting, no
  backside, no camera, and never labelled 3D.
- Level 4 photographic templates (raster plates and alpha clip/occlusion
  masks) are implemented through document assets and the authoring UI.
  Calibrated displacement maps and luminance mask coverage remain rejected.
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
  payloads. Mockup template schema 2 adds cylindrical geometry, mask
  placement/options, and private instance template ownership; older template
  schema 1 records migrate with deterministic defaults and rehashed content.
- Replay gains one additive primitive case; cylindrical content is baked to an
  ordinary image fill and does not add a 3D or second rendering system.
- Mockup frames force the structural (main-thread) render path when present
  (worker renderer is disabled), because surface rasterization is
  main-thread. Browsing mockup templates never touches the canvas.
- Imported user templates are treated as untrusted: size/count/hash limits,
  geometry validation, licence passthrough with unknown-permission
  semantics.
- AI assistance stays optional; no model is added by this work.

## Amendment (2026-09-13): export parity, surface editing, photographic templates

Vertical-slice follow-up. Full audit, reproduction evidence, and research
citations: `docs/audits/mockup-editing-improvement-2026-09-13.md`. Canonical
architecture: `docs/architecture/mockup-system.md`.

Decisions that extend, not replace, the original ADR:

1. **Export parity is a contract, not a convention.** All export-shaped hosts
   share `render/mockup/mockupExport.ts`; a mockup selected for raster/PDF
   export renders the composed mockup. Missing sources always warn and draw a
   placeholder; stale preview rasters are canvas-only.
2. **Mockup frames force structural compositing.** Quad warp uses DOM canvas
   APIs; docs now match the code.
3. **Per-surface instance overrides are rendering inputs.** Rotation, flips,
   alignment, shadow/glow, backgroundColor, and overlay blend modes are
   applied; anything not applied is not exposed.
4. **Photographic templates are an additive template capability.** A raster
   `plateImage` plus alpha `clipMaskAssetId`/`occlusionMaskAssetId` coverage
   compose in a defined order (background → plate → content → occluder →
   overlays). Luminance-channel coverage and displacement maps stay rejected
   until a renderer path exists; an ellipse clip is never called a cylinder.
5. **Template instances are scoped.** Editing surface geometry/masks on an
   instance first clones the template into a private user-library copy;
   library templates are retained when unreferenced.
6. **Portable template bundles are bounded and content-free by default.**
   `.varve-mockup.json` carries template geometry plus plate/mask assets only;
   bound artwork, paths, and fonts are never exported. Import validates every
   bound before embedding.
7. **Source loss is recoverable and honest.** Deleting a bound source keeps a
   labelled last-good preview in the editor, reports the missing source in
   the inspector, and warns on export.
8. **Every export route either composes the mockup or says why not**
   (2026-09-25). SVG and vector-PDF treat a mockup frame as a mandatory
   raster flatten boundary so the boundary host runs
   `decorateMockupSubtree` — capability assessment, not documentation, is
   what keeps an export honest. PDF/X (press) has no decoration host and
   therefore blocks mockup subtrees with an actionable error plus a
   blocking preflight finding rather than exporting a bare frame; code
   exports carry an advisory finding. Image fills reach the print pipeline
   through a single bounded manifest builder
   (`export/printImageManifest.ts`), because without it the Rust printer
   substitutes a checkerboard placeholder — a real defect found by
   reproduction on 2026-09-25, not a hypothetical.

Validation: scene/scene-adjacent unit tests, focused editor tests, E2E
coverage, and inspected visual/export artifacts are recorded in the audit
report and the Agent Validation Report.

## Amendment (2026-09-25): mesh envelope surfaces, truthful PSD disclosure, Home covers

Slice record: `docs/audits/mockup-mesh-surfaces-2026-09-25.md`.

1. **Mesh is a schema-3 capability, not an un-gated enum.** `kind: 'mesh'`
   requires template schemaVersion 3, whose only new requirement is the
   optional grid payload; schema 1–2 templates keep rejecting mesh payloads,
   so enabling the capability is a migration (the same deterministic version
   stamp as 1→2), not a removed validation check.
2. **The envelope is bilinear and fold-free by construction.** Per-cell
   inverse bilinear (not per-cell homography) because a bilinear patch's
   restriction to a shared edge depends only on that edge's endpoints, so
   adjacent cells agree exactly — no seam slivers by construction. Grids
   with folded, concave, or degenerate cells are rejected by one predicate
   (`isMeshGridValid`) shared by validation, IR build, and replay.
3. **Malformed payloads render placeholders, never plausible geometry.** A
   grid that fails validation in any host becomes an explicit
   invalid-geometry placeholder (live, export, thumbnail).
4. **Home covers join the decoration contract.** `generateThumbnail` gains
   an optional canonical `buildIr` override; the editor decorates thumbnails
   through the shared module and marks undecorated fallbacks provisional so
   a bare frame is never persisted as an authoritative cover.
5. **PSD smart objects are counted, not silently generic.** The importer
   reports the detected SoLd/PlLd layer count and states the boundary:
   layers import as rendered pixels; embedded artwork, warps, and
   re-editability do not come along. The count is informational and never a
   capability claim.
6. **Right-click is reserved for context actions.** A tool gesture must
   never start on button 2; routing it to creation tools let a right-click
   commit artwork and immediately close the very context menu the click
   opened (`ToolManager` gates button 2 before tool routing).
