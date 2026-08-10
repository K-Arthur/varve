# Mockup System — Architecture

Status: implemented (Level 1 + Level 2 vertical slice); Level 3-5 deferred.
ADR: docs/architecture/adr/0015-mockup-system.md.
Audit: docs/audits/mockup-capability-audit-2026-08-05.md.
Slice report: docs/audits/mockup-vertical-slice-report-2026-08-05.md.
Deferred multimodal plan: docs/plans/mockup-multimodal-deferred.md.

## Product definition

A mockup is a composited presentation scene with replaceable content
surfaces, placed as a normal editable object in the Varve document. It is
distinct from:

- **Prototypes** (interactive navigation; `@varve/prototype`) — mockups do
  not play back or intercept interactions.
- **Device preview** (prototype presenter chrome) — mockups are document
  content, not presentation chrome.
- **Document templates** (`TemplateLibrary`) — a mockup *template* is a
  scene-slot contract (surfaces, geometry, plate, overlays, licence), not a
  starting document.
- **Export presets** — saved output configs; unrelated to mockup geometry.
- **AI-generated imagery** — optional future input to surface detection;
  never a replacement for deterministic placement.

## Document schema (2.15)

### `Document.mockupTemplates: Record<string, MockupTemplateAsset>`

```ts
interface MockupTemplateAsset {
  id: string;                 // stable id, e.g. 'builtin:phone-flat'
  schemaVersion: 1;
  name: string;
  category: MockupCategory;
  source: 'builtin' | 'user' | 'workspace' | 'community';
  orientation: 'portrait' | 'landscape' | 'square' | 'any';
  outputWidth: number;        // template design space, px
  outputHeight: number;
  backgroundColor: string;    // css color, or 'transparent'
  plate: MockupVectorShape[]; // full-bleed background shapes
  surfaces: MockupSurfaceDefinition[];
  overlays: MockupOverlayDefinition[];
  licence?: MockupLicenceSnapshot;
  tags?: string[];
  contentHash: string;
  capabilities?: string[];    // e.g. ['quad']
  createdAt?: number;
  updatedAt?: number;
}

interface MockupSurfaceDefinition {
  id: string;
  name: string;
  kind: 'flat' | 'quad';          // 'mesh' | 'cylindrical' reserved
  sourceSlot: string;             // 'screen' | 'front' | 'back' | ...
  x: number; y: number;           // slot rect, template space
  width: number; height: number;
  quad?: MockupQuad;              // required when kind === 'quad'
  fit: 'contain' | 'cover' | 'stretch' | 'native';
  alignment: { x: 'min' | 'center' | 'max'; y: 'min' | 'center' | 'max' };
  plate?: MockupVectorShape[];    // device chrome behind the content
  shadow?: { blur: number; offsetY: number; opacity: number };
  screenGlow?: boolean;           // soft screen emissive glow
  dark?: boolean;                 // dark bezel variant
}

interface MockupOverlayDefinition {
  id: string;
  name: string;
  kind: 'shadow' | 'highlight' | 'reflection' | 'vignette' | 'grain';
  opacity: number;
  blendMode?: BlendMode;
  shapes: MockupVectorShape[];
}

type MockupVectorShape =
  | { kind: 'rect'; x; y; width; height; rx?: number; fill: string }
  | { kind: 'ellipse'; x; y; width; height; fill: string };
```

Validation (`scene/src/mockup/validate.ts`) enforces: finite numbers,
non-degenerate quads, surface ids unique, slot inside output bounds,
bounded shape counts, known kinds/fits, licence shape. Raster assets for
masks/displacement are reserved fields (`clipMaskAssetId`,
`occlusionMaskAssetId`, `displacementAssetId`) validated but unused until
Level 4.

### `FrameNode.mockup: MockupInstanceData`

```ts
interface MockupInstanceData {
  templateId: string;
  surfaceBindings: Record<string, MockupSourceBinding>;
  overrides?: MockupInstanceOverrides;   // per-surface geometry/fit/appearance
  detached?: boolean;                    // true once content is flattened away
}
```

Binding modes:

- **live** — `{ mode: 'live', nodeId }`; re-rendered when the source subtree
  content digest changes.
- **snapshot** — `{ mode: 'snapshot', assetId }`; an immutable embedded
  raster of the source at capture time (content-addressed in
  `Document.assets`).
- external/component binding and detached content are represented by
  snapshot + regular frame editing (the editable raster is a normal image
  shape node when detached); UI labels this honestly.

## Rendering

Mockup frames render as ordinary IR. `decorateMockupIr` (editor,
`src/render/mockup/mockupIr.ts`) expands a mockup frame's IR item into:

1. background plate shapes;
2. per surface: plate shapes → surface content item;
3. overlays.

Surface content is an image-fill item (flat) or `warpedImage` item (quad)
whose `src` is a cached raster of the source subtree at the surface
resolution. The host supplies `renderSourceToCanvas(ctx, nodeId)`; both the
live canvas and the export compositor pass their structural replay, so
preview and export are pixel-identical.

### Geometry (`@varve/engine/src/mockup/`)

- `homography.ts` — DLT solve (normalized), forward/inverse point mapping,
  quad validation (finite, non-crossing, non-concave, non-degenerate,
  minimum area) and corner normalization.
- `quadWarp.ts` — `warpImageToQuad(ImageData, srcRect, dstQuad, outW, outH)`
  inverse-homography per-pixel bilinear warp (same sampling family as
  `meshWarp.ts`, true projective mapping, not a two-triangle bilinear
  patch).
- `fit.ts` — `fitRect(contain/cover/stretch/native + alignment)` used by
  both flat and quad surface placement (the quad's source sampling rect).

### Cache

`MockupSurfaceCache`: LRU, byte-budgeted. Key = (frameId, surfaceId,
`computeMockupSourceDigest(doc, nodeId)`, quality bucket). Source edits
change the digest → only that surface re-renders. Quality buckets: preview
(≤ 512px slot long edge), full (surface slot at render scale). Export uses
its own full-resolution pass, never preview upscaling.

### Renderer parity / diagnostics

Because surfaces ride IR, Canvas2D, worker, preview, and export agree by
construction. When a mockup frame exists, `sceneNeedsStructuralCompositing`
returns true (source rasterization is main-thread); a diagnostics counter
reports mockup frames and per-surface cache hit/miss. WebGPU backend
renders mockups through the fallback Canvas2D draw path (they are not GPU
primitives) — this is the documented deterministic fallback.

## Level 2 perspective UX

- Quad corners rendered as handles on the canvas overlay for the selected
  mockup frame; drag commits via one transaction.
- Snapping to other surface corners/edges, and pixel alignment.
- Inspector numeric fields for all four corners; Reset; invalid-geometry
  feedback (outline turns red, warp disabled rather than corrupted).
- Fit/alignment controls per surface; shadow/glow toggles.

## Templates

- **Built-in catalog** (`scene/src/mockup/builtinTemplates.ts`): 12
  original vector templates — phone (flat + perspective), tablet, browser,
  monitor, laptop (perspective), poster, business card (2 surfaces),
  book cover (perspective), packaging box (perspective front),
  social board, logo board. No device trade dress, no brand marks; licence
  snapshot: FSL-1.1-MIT, attribution "Varve contributors".
- **User templates**: import a validated template JSON (limits: 1 MiB,
  32 surfaces, 512 shapes, finite geometry); save a mockup instance as a
  user template; export the same JSON. Stored through the app-settings KV
  substrate, listed under Custom in the panel.
- **Template previews**: SVG rendered from template data (plate + slot
  outlines) — meaningful previews without raster assets.

## UI

- ResourcesPanel gains a **Mockups** tab (no Shell import change). Search,
  category chips, orientation filter, built-in/custom filter, grid of
  previews, detail + Apply.
- Context menu on a selected frame: **Apply mockup…** (Object menu and
  command palette reach the same action).
- Inspector **Mockups** section for selected mockup frames: Source
  (replace / reconnect / convert to snapshot / detach / remove), Placement
  (fit, alignment, rotation, quad numeric), Appearance (shadow, glow),
  Template (name, licence, replace, reveal).
- Canvas overlay with quad handles when a mockup surface is selected.

## Level 3-5 (deferred, evidence-backed)

| Level | Capability | Deferral evidence |
|---|---|---|
| 3 | mesh / cylindrical surfaces | `warpMesh` + `warpPath` exist and are tested; requires mesh-editing UX, displacement maps, seam handling, and tiled high-res rendering. `MockupSurfaceKind` reserves the kinds; validation rejects them today. |
| 4 | photographic raster templates | Schema reserves plate/mask/displacement assets; needs raster asset packaging (ZIP limits, path traversal, symlink, decompression-bomb protections), occluder compositing, and color management. |
| 5 | multimodal detection | `MockupRequest` types + schema validation ship; candidate-surface/segmentation/depth requires a new ONNX model (catalog entry, checksum, consent, memory gating per `engine/src/inference/`) and the Stage C-H pipeline; design recorded in `docs/plans/mockup-multimodal-deferred.md`. |
| Batch export / variants | multiple templates × sources | Export dialog extensions; naming and collision handling. |
| Home discovery | mockup templates in Home | Mockup templates are scene-anchored, not document starting points; editor-side discovery (context menu, palette, panel, inspector) is primary. |
| Community packs | remote downloads | Requires pack download host consent (CSP `connect-src`), checksums, update checks — icon-pack precedent; not wired for mockups. |

## Performance targets

- Browsing templates: no canvas work.
- Surface rasterization: ≤ 512 px preview bucket; quad warp ~ms for phone
  sizes; full-res at export only.
- Cache: bounded LRU; digest change invalidates one surface.
- Export: re-renders sources at output resolution (no preview upscale).
