# Mockup System — Architecture

Status: implemented (Levels 1–2 + photographic templates + a bounded
front-facing cylindrical slice); mesh, calibrated displacement, PSD
smart-object re-rendering, and model-assisted proposals remain explicitly
unsupported. ADR: `docs/adr/0015-mockup-system.md`.
Audit and improvement record: `docs/audits/mockup-editing-improvement-2026-09-13.md`.

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

Nothing in the mockup system introduces a workspace, route, document type,
or parallel editor. It is frames + document-embedded template assets +
renderer decoration + inspector/overlay controls.

## Document schema

### `Document.mockupTemplates: Record<string, MockupTemplateAsset>`

```ts
interface MockupTemplateAsset {
  id: string;                    // 'builtin:phone-flat' | 'user:…'
  schemaVersion: 2;
  name: string; description?: string;
  category: MockupCategory;
  source: 'builtin' | 'user' | 'workspace' | 'community';
  orientation: 'portrait' | 'landscape' | 'square' | 'any';
  outputWidth: number; outputHeight: number;   // template design space, px
  backgroundColor: string;                     // css color or 'transparent'
  plateImage?: {                               // photographic base plate
    assetId: string; width: number; height: number;
    fit: 'cover' | 'contain' | 'stretch'; opacity?: number;
  };
  plate: MockupVectorShape[];                  // full-bleed vector background
  surfaces: MockupSurfaceDefinition[];
  overlays: MockupOverlayDefinition[];
  licence?: MockupLicenceSnapshot;
  tags?: string[];
  contentHash: string;
  capabilities?: string[];    // e.g. ['flat'], ['quad'], ['cylindrical']
  library?: boolean;          // user-authored: retained when unreferenced
  createdAt?: number; updatedAt?: number;
}

interface MockupSurfaceDefinition {
  id: string; name: string; sourceSlot: string;
  kind: 'flat' | 'quad' | 'cylindrical'; // mesh remains reserved/rejected
  x: number; y: number;           // slot rect, template space
  width: number; height: number;
  quad?: MockupQuad;              // required when kind === 'quad'
  fit: 'contain' | 'cover' | 'stretch' | 'native';
  alignment: { x: 'min' | 'center' | 'max'; y: 'min' | 'center' | 'max' };
  plate?: MockupVectorShape[];    // slot-local for quads, absolute for flat
  platePadding?: { x: number; y: number };
  shadow?: { blur: number; offsetX?: number; offsetY: number; opacity: number };
  screenGlow?: boolean;
  dark?: boolean;                 // legacy decorative flag (templates use plate colours)
  clipMaskAssetId?: string;       // alpha coverage in template space
  occlusionMaskAssetId?: string;  // foreground coverage; requires plateImage
  maskOptions?: { invert?: boolean; feather?: number; channel?: 'alpha' | 'luminance' };
  clipMaskOptions?: { invert?: boolean; feather?: number; channel?: 'alpha' | 'luminance' };
  occlusionMaskOptions?: { invert?: boolean; feather?: number; channel?: 'alpha' | 'luminance' };
  clipMaskPlacement?: { x: number; y: number; width: number; height: number };
  occlusionMaskPlacement?: { x: number; y: number; width: number; height: number };
  cylindrical?: { axis: 'vertical' | 'horizontal'; wrapDegrees: number;
    seam: number; crop: 'visible' | 'slot' };
  displacementAssetId?: string;   // reserved — rejected until a renderer exists
}
```

`MockupPlateImage` and the mask asset ids reference `Document.assets`
(content-addressed). Templates remain self-contained: the closure retains
plate/mask assets on save, clipboard payloads and packages. Codec
normalization preserves dangling plate/mask references with a warning so a
restored asset can reconnect; export blocks until the dependency is present.

### `FrameNode.mockup: MockupInstanceData`

```ts
interface MockupInstanceData {
  templateId: string;
  surfaceBindings: Record<string, MockupSourceBinding>;
  overrides?: Record<string, MockupSurfaceOverride>;
  templateOwnerId?: NodeId;        // private template copy for instance authoring
  detached?: boolean;             // legacy flag; flattening removes the payload
  createdAt?: number;
}
```

Binding modes:

- **live** — `{ mode: 'live', nodeId }`; re-rendered when the source subtree
  content digest changes. Editing the source is an ordinary document edit.
- **snapshot** — `{ mode: 'snapshot', assetId }`; an immutable embedded
  raster of the source captured at freeze time (content-addressed in
  `Document.assets`).

Per-surface overrides: rect/quad/cylindrical geometry, fit, alignment, rotation
(degrees about the slot centre), flips, shadow, and glow. All exposed values
are applied by the renderer; none are decoration-only. Surface edits clone a
shared library template to a private instance-owned copy before mutation.

Property operations (scene): `setMockupBinding`, `clearMockupBinding`,
`setMockupSurfaceOverride`, `replaceMockupSurfaceOverride`,
`setMockupTemplate` (raw swap), `planMockupTemplateRemap` +
`applyMockupTemplateRemap` (slot-identity remap), `updateMockupTemplate`,
`makeMockupTemplateUnique`, `clearMockup`, `pruneUnusedMockupTemplates`
(library templates retained), `computeMockupSourceDigest`.

## Rendering

Mockup frames render as ordinary IR through `decorateMockupIr`
(`editor/src/render/mockup/mockupIr.ts`). Composition order is explicit and
shared by every host:

1. template `backgroundColor` rect;
2. `template.plate` vector shapes;
3. `template.plateImage` (untouched photo, fitted cover/contain/stretch);
4. each surface, in template order: shadow → plate/chrome → mapped artwork
   (clip and occlusion coverage baked once) → surface glow;
5. template overlays (opacity multiplied; blend modes mapped to engine names).

Surface content is an image-fill item (flat/cylindrical) or `warpedImage` item
(quad). `bakeSurface` fits the live source subtree (or snapshot asset) with
contain/cover/stretch/native + alignment, captures live vector content at the
projected output footprint, applies rotation/flips to the artwork only, and
composites clip/occlusion coverage exactly once:

- **clip** keeps content where coverage exists (`destination-in`); inverted
  clip removes it (`destination-out`).
- **occlusion** removes content where foreground coverage exists
  (`destination-out`), revealing the base plate beneath; inverted occlusion
  keeps only covered content. This is why occlusion requires `plateImage`.
- A mask that has not decoded yet is deferred (content stays unclipped for
  that frame); the image-cache listener schedules a reframe. Masks are
  coverage, never colour, so no ICC/gamma transform touches them.
- Only `channel: 'alpha'` is implemented; `luminance` is rejected by
  validation until a renderer path exists.

Quad surfaces bake slot-local plate chrome together with content and warp the
expanded quad (`platePadding`) through the engine's true inverse-homography
`warpImageToQuad`. This is projective mapping of a plane, not mesh or 3D.

Cylindrical surfaces use `warpImageToCylinder`: a destination-driven,
premultiplied-alpha remap with explicit vertical/horizontal axis, 5–180°
visible wrap, normalized seam, and `visible`/`slot` crop policy. It is a
front-facing orthographic arc only. It does not infer radius, backside,
camera perspective, folds, lighting, or calibrated displacement, and its
output is deliberately raster content inside the ordinary surface image-fill
path. A cylinder selection therefore cannot be mistaken for full 3D.

### Host parity

`render/mockup/mockupExport.ts` is the single decoration module for
export-shaped hosts. It collects live-bound source ids, flattens them with the
boundary, decorates with `allowStalePreview: false`, settles the baked data
URLs, and reports missing surfaces. Before replay it also settles every
template-referenced plate and mask asset through the shared image cache. A
template asset is outside the ordinary scene-node resource barrier, so this
explicit step prevents a first export from racing lazy plate/mask decode and
silently baking a placeholder. Missing template assets fail export with an
actionable reconnect/restore message. Used by:

- **live canvas** (`canvas/renderPipeline.ts`) at `qualityScale: 1`;
- **raster export** (`components/SpecPanel/export.ts`) at the requested
  export scale — this is the route used by PNG/JPEG/WebP and the rasterized
  PDF paths;
- **SVG/PDF flatten boundaries** (`export/compositor.ts`).

Export bakes surfaces above 1× at output scale; export never upscales a
frame-resolution raster and never presents stale pixels. Missing sources are
reported as export warnings and rendered as explicit placeholders.

### Cache and invalidation

`MockupSurfaceCache` is a byte-budgeted LRU keyed by frame, surface, source
digest, quality bucket, surface kind, and a geometry signature that includes
frame size, override rect/quad, fit/alignment, rotation/flip, and mask
configuration. Source edits change only the affected surface's digest. The
live cache is cleared when the document id changes (per-document node ids
would otherwise collide) and bounded by 32 MiB. `getLatest(frame, surface)`
provides a clearly labelled last-good preview for a lost source on the canvas;
`allowStalePreview: false` disables it for export.

### Worker and structural routing

`sceneNeedsStructuralCompositing` returns true when any visible node carries a
`mockup` payload. Mockup surface baking needs main-thread structural replay,
and quad warp uses DOM canvas APIs, so mockup documents never enter the
replay worker; this also keeps the worker from ever receiving a
`warpedImage` it cannot render.

## Template authoring

- **From selection**: the canvas context menu / command palette action
  captures the selected image, frame, or group as an untouched base plate
  (PNG asset), wraps it in a user library template with one replaceable
  surface, and instantiates it beside the source. One undo step; the source
  artwork is never modified.
- **Surface geometry**: the canvas overlay (`MockupSurfaceOverlay`) outlines
  every surface of a selected mockup; clicking a chip selects the edit
  target. Flat surfaces get corner and edge handles; quad surfaces get four
  corner handles. Drags are one transaction per gesture; invalid quads are
  rejected (geometry stays at the last valid state); Escape aborts; Reset
  clears the override.
- **Masks**: "Clip from selection" / "Occluder from selection" capture the
  selected node's alpha into a document asset and assign it to the surface.
  The instance first gets a private template copy, so a shared template is
  never mutated by an instance edit.
- **Surface management**: rename, reorder (draw order), and remove surfaces
  on the instance's template. Removing a surface also drops its binding and
  overrides.
- **Portable bundles**: `.varve-mockup.json` is
  `{ format: 'varve-mockup-template', version: 1, template, assets }`.
  Import validates template structure, asset count (≤ 65), MIME allowlist
  (PNG/JPEG/WebP), per-asset bytes (≤ 20 MB), dimensions (≤ 16 384 px and
  64 MP), strict base64 data-URL syntax, and referenced-asset completeness
  before embedding. Exports never include bound artwork, paths, or fonts;
  bundle import is atomic at the document transaction boundary.

Built-in catalog (`scene/src/mockup/builtinTemplates.ts`): 16 original vector
templates spanning mobile/device screens, browser/desktop, print, stationery
(including front/back), apparel/tees, signage/billboards, packaging (including
the bounded cylindrical label), social/marketing, and logo presentation. There
is no device trade dress or brand mark; the catalogue records FSL-1.1-MIT and
"Varve contributors" attribution for these original fixtures. This catalogue
is a subject starter set, not a claim of photo-realistic product fidelity.

## Source integrity

- Live bindings reference document nodes; snapshots are immutable embedded
  rasters. A snapshot keeps the surface fit, so later fit changes apply to the
  frozen image instead of double-fitting baked pixels.
- Copy/paste and cross-document paste remap bindings and templates
  (`import/mergeImportedResources.ts`); unresolvable references are dropped
  explicitly.
- Deleting a bound source keeps the binding as a missing reference: the
  inspector shows "Missing source", the canvas keeps a labelled last-good
  preview, and export warns. No stale pixels are silently presented as
  current.
- `isAssetReferenced` / `removeNode` retain snapshot bindings and template
  plate/mask assets; library templates are not pruned while unreferenced.
- Self/ancestor/indirect cycles are structurally impossible: a mockup
  surface binds a node id and renders it through the normal subtree replay;
  digests are cycle-guarded (`computeMockupSourceDigest` visited set).

## UI surfaces

- **Resources → Mockups tab**: search, category/orientation filters, vector
  previews, favourites/recents, licence display, apply, create-from-selection,
  bundle import, per-custom-template export.
- **Inspector → Mockups**: template identity/licence/replacement (slot-identity
  remap with unbound reporting), per-surface list, source actions (Replace,
  Edit source, Snapshot, Reconnect, Clear), placement (fit, alignment,
  rotation, flips), appearance (shadow, glow), geometry (numeric rect/quad),
  masks, surface rename/reorder/remove, duplicate linked/independent,
  flatten-to-image, remove mockup.
- **Canvas overlay**: surface chips + geometry handles described above,
  labelled targets, Reset/Done, keyboard abort.
- Canvas context menu and command palette: "Apply mockup…" and "Create mockup
  template from selection…".

## Deferred, with evidence

| Capability | Status | Evidence / next step |
|---|---|---|
| Mesh surfaces | reserved, rejected | `meshWarp` exists but has no topology validation, seam handling, or authoring UI. |
| Cylindrical surfaces | implemented, bounded | `warpImageToCylinder` + schema 2 + inspector controls + save/reopen/export coverage implement a front-facing orthographic arc. No backside, camera, radius solve, lighting, or full 3D claim. |
| Displacement maps | reserved, rejected | Needs map encoding, channel, neutral value, strength units, coordinate space, and edge behaviour defined end to end. Luminance/depth is not a calibrated displacement field. |
| Luminance mask coverage | reserved, rejected | Only alpha coverage has a renderer path. |
| Batch variants | implemented, bounded | `MockupVariantsPanel` reuses the existing raster export service with explicit source/template assignments, deterministic names, collision suffixes, progress, cancellation, and no temporary document nodes. Browser downloads remain the current destination path. |
| PSD smart-object replacement | not supported | `@webtoon/psd` imports layers/masks/blend modes as pixels; it does not implement Photoshop's renderer. See `docs/architecture/import-system.md`. |
| Multimodal surface proposals | deferred | Typed request contract ships (`mockup/multimodal.ts`); no model is required for manual workflows. |
| Community template packs | deferred | Would reuse the icon-pack download/manifest precedent; no remote host is configured. |
| Thumbnail decoration | partial / follow-up | The selected document canvas and export paths compose mockups; Home thumbnail decoration still needs a dedicated capture contract and is not presented as verified parity. |
