# Image & Text Manipulation System — Architecture Audit

**Scope:** Review the image, text, compositing, masking, and rendering subsystems in Strata and lay a foundation for professional-grade creative workflows.

**Date:** 2026-07-03

## 1. Current-state audit

### 1.1 What exists today

| Subsystem | Status | Evidence |
|---|---|---|
| Scene graph / document model | Built | `@/packages/scene/src/types.ts`, `@/packages/scene/src/document.ts` |
| Node types | Shape, Text, Group, Frame, Image | `@/packages/scene/src/types.ts:248-410` |
| IR-replay rendering | Built | `@/packages/engine/src/replay.ts`, `@/crates/strata-engine/src/lib.rs` |
| Fill stacks | Solid, gradient, image, pattern | `@/packages/scene/src/fills.ts`, `@/packages/engine/src/types.ts:265-284` |
| Blend modes | 19 modes, CSS mapping | `@/packages/scene/src/types.ts:53-72`, `@/packages/engine/src/replay.ts:255-297` |
| Strokes & effects | Stacked; drop/inner shadow, blur | `@/packages/scene/src/types.ts:79-137` |
| Masks | Clip masks on Group/Frame (alpha stub) | `@/packages/scene/src/masks.ts`, `@/packages/editor/src/CanvasArea.tsx:480-560` |
| Text node | Single-style text, basic wrap/align | `@/packages/scene/src/typography.ts`, `@/packages/engine/src/replay.ts:507-606` |
| Image node / image fill | Imported as data-URL-backed fills | `@/packages/import/src/image.ts`, `@/packages/engine/src/imageCache.ts` |
| Image cache | Async loading, subscription, eviction | `@/packages/engine/src/imageCache.ts` |
| Font registry | Family/variant registry, Google Fonts injection | `@/packages/engine/src/fontRegistry.ts` |
| Undo/redo & transactions | Editor context | `@/packages/editor/src/context.tsx` |

### 1.2 Architecture strengths

- **IR-replay seam (ADR-0001).** Native Rust computes a compact render IR; the webview replays it to Canvas2D/WebGPU. This is the correct strategic split for performance and cross-platform parity.
- **Immutable document model.** `@varve/scene` returns new documents per operation, which simplifies undo, time-travel, and SSR/export.
- **Stacked fills & effects.** The model already supports multi-fill, multi-stroke, and multi-effect stacks with per-item opacity and blend mode.
- **Mask scaffolding.** Group/Frame can designate a child as a clip mask; the canvas renderer already applies it via `clip()`.

### 1.3 Critical gaps

| Gap | Why it matters | Evidence / risk |
|---|---|---|
| No raster layer / pixel buffer | Photo editing, retouching, and painting are impossible without a writable raster surface. | `ImageNode` only references a `src` URL; there is no pixel backing. |
| No adjustment layers | Nondestructive exposure/contrast/levels/curves cannot be represented. | No `AdjustmentLayer` node type; no filter pipeline in scene or IR. |
| No filter/effect pipeline | Blur, sharpen, distortion, stylization are either CSS-only or absent. | `Effect` is limited to shadows and blurs; no filter node abstraction. |
| Alpha masks are stubbed | Soft/gradient masks are not implemented. | `@/packages/scene/src/masks.ts:9` explicitly marks alpha as deferred. |
| No smart object / linked asset model | Embedded images are always data-URL-embedded; no relink, replacement, or multi-resolution. | `@/packages/import/src/image.ts:16` embeds by default; no asset catalog. |
| No brush engine | Digital painting workflows are unsupported. | No brush/stroke types in scene or engine. |
| Text is single-run / single-style | Rich typography, mixed styles, and OpenType application are not rendered. | `richText` exists in types but is ignored by the engine and inspector. |
| No path text / text warp | Text cannot follow a vector path or be distorted. | `pathTextSettings` exists in types but is not implemented. |
| No text-to-shape conversion | Outline text, text clipping, and graphic typography are unsupported. | No conversion helpers. |
| No selection system | Pixel, shape, and soft selections are absent. | No selection mask abstraction. |
| Rust engine lags TS engine | `strata-engine` does not emit ImageNode/TextNode primitives and has no fill stack for images. | `@/crates/strata-engine/src/lib.rs:62-151` lacks `Image` and `Text` primitives; `build_render_ir` is shape-only. |
| Canvas2D compositing limitations | Blur/background-blur cannot be applied correctly without offscreen buffers; group-level blend modes are not isolated. | `@/packages/engine/src/replay.ts:229-240` blur is set after fill is already drawn. |
| Large-image / high-DPI scalability | No tiling, mipmapping, or resolution streaming; data-URL embedding bloats documents. | ImageCache loads full HTMLImageElement with no downsample. |

## 2. Competitive research findings

Research sources: Adobe Photoshop/Illustrator/InDesign docs, Figma help center, Affinity documentation, Krita/Procreate brush-engine deep-dives, Graphite editor, and recent WebGPU compositor implementations (Diffusion Studio, GPU-Net, Masterselects reference engine).

Key findings:

1. **Modern creative apps use a node-based or layer-based nondestructive pipeline.** Photoshop (Adjustment Layers / Smart Filters), Affinity (Live Layers), and Graphite (node graph) all separate the *operation* from the *pixels* so parameters remain editable.
2. **Raster editing requires a tile or mip-based backing store.** Krita uses `KisPaintDevice` (tile-based); Procreate uses stamp-based brush rendering on a GPU-backed layer stack. Large images must be streamed, not held fully in memory.
3. **Rendering should stay GPU-resident.** WebGPU compositors use ping-pong textures, pooled render targets, and single-queue submits. Canvas2D is acceptable for UI/vector but cannot efficiently do per-pixel filters, blur, or thousands of layers.
4. **Text is two subsystems:** a high-level paragraph/line layout (HarfBuzz-style shaping) and a rendering primitive. Figma, Sketch, and Affinity separate rich-text content from the final glyph run output so that path text, warp, and text-to-shape all operate on shaped glyph paths.
5. **Brush engines are sensor-driven stamp systems.** Pressure, tilt, speed, and random inputs map to size, opacity, flow, hardness, and rotation. Stroke smoothing (Catmull-Rom or exponential) and interpolation are essential.
6. **Masks are compositing operations, not geometry.** Alpha masks, luminance masks, and vector masks must be represented as separate layer-like sources that modulate the composite of the layers they mask.

## 3. Gap analysis

| Capability | Needed for | Current coverage | Gap severity |
|---|---|---|---|
| Raster layer backing | Photo editing, painting | 0% | P0 |
| Adjustment layers | Nondestructive correction | 0% | P0 |
| Filter pipeline | Blur, sharpen, stylize | 10% (CSS blur only) | P0 |
| Alpha/gradient masks | Soft masking | 20% (clip only) | P1 |
| Smart objects / linked assets | Reusable, replaceable images | 10% | P1 |
| Brush engine | Digital painting | 0% | P1 |
| Rich text / typography | Publishing, UI design | 30% (types only) | P1 |
| Path text / warp | Logo/type design | 10% | P2 |
| Text-to-shape | Graphic typography | 0% | P2 |
| Selection system | Editing, masking | 0% | P2 |
| WebGPU compositor | Performance, scale | 0% | P1 |

## 4. Architectural recommendations

### 4.1 Layer and compositing architecture

- Introduce an `AdjustmentLayerNode` and `FilterLayerNode` as first-class scene nodes. They are not geometry; they declare a region (via the node's own bounds or a mask) and an operation that is applied to the composited result of all nodes below them within the same scope.
- Keep the IR contract as the seam. Add a new IR primitive `filter` that carries a filter type + parameters + input bounds. The webview (or native backend) can implement the filter in Canvas2D fallback, WebGPU, or Skia.
- Move from Canvas2D immediate-mode to an offscreen-compositing model for groups/frames: render the subtree to a temporary canvas/texture, then apply opacity, blend mode, and filters. This gives correct group isolation, background blur, and alpha masks.

### 4.2 Image manipulation

- Add a `RasterLayerNode` (or extend `ImageNode` with a pixel backing). Use an `ImageBuffer` abstraction backed by `ImageBitmap` / `OffscreenCanvas` / WASM memory.
- Represent adjustments as a nondestructive `Adjustment` stack on the node: brightness, contrast, exposure, saturation, hue-rotate, levels, curves, white balance, black & white, selective color. Each adjustment is a parameter object that can be toggled/reordered.
- Implement adjustment application in a WebGPU/Canvas2D filter stage. For the Canvas2D fallback, use `filter: brightness() contrast() saturate() hue-rotate()`; for WebGPU, pass a uniform block to a single fragment pass.
- Add an asset catalog (`Document.assets`) that stores linked vs. embedded images with hashes, dimensions, and optional mipmap/pyramid data. Replace raw data URLs with asset IDs.

### 4.3 Masking

- Generalize `Mask` from `sourceNodeId` to a `MaskSource` that can be a child node, a raster alpha channel, or a gradient field.
- Support `clip`, `alpha`, `luminance`, and `inverted` modes.
- Render masks as an offscreen alpha mask (or use the compositor's stencil) rather than `ctx.clip()` where soft edges are needed.

### 4.4 Text manipulation

- Split text into `TextContent` (rich text runs) and `TextLayout` (shaped glyph runs). The engine converts rich text to glyph runs at render time using a measurer/shaper.
- Implement `PathText` by placing shaped glyph runs along a `Shape` path.
- Implement `TextWarp`/`TextEnvelope` as a geometric deformation of glyph runs or paths after shaping.
- Add `textToShapes(node)` that converts glyph outlines to editable vector paths (future: use opentype.js or Rust `tTFParser` + `kurbo`).

### 4.5 Brush engine

- Model a brush stroke as a `BrushStroke` object: sampled dab positions + per-dab pressure/tilt + brush preset ID.
- Brush presets are resources with shape, grain, spacing, jitter, and dynamic mappings.
- Render strokes via stamp compositing on a raster layer. Use `PointerEvent` coalesced events, Catmull-Rom smoothing, and distance-based spacing.
- Store strokes nondestructively where possible (e.g., on a vector brush layer that replays dabs on demand), with a rasterized cache for performance.

### 4.6 Rendering

- Evolve the IR to include `RenderLayer` records that indicate offscreen composite scopes.
- Add a `Compositor` package (`@varve/compositor`) that consumes IR and either replays to Canvas2D or WebGPU.
- Benchmark: keep IR <100 KB/frame for typical scenes, 60 fps preview, and streaming export.

## 5. Rendering recommendations

- **Short term:** Fix the existing Canvas2D renderer: blur must be applied via offscreen pre-render, not after fill; group blend modes must be isolated; image fills must support `fit`, `tile`, and `stretch`.
- **Medium term:** Implement a WebGPU ping-pong compositor with pooled textures, 37 blend modes, and per-layer filter uniforms.
- **Long term:** Move the native engine to Skia/wgpu for headless/export; keep the IR contract unchanged.

## 6. Performance and scalability findings

- **Image memory:** data-URL embedding and unbounded image cache will OOM on large documents. Add asset catalog with downsampled proxies and LRU eviction.
- **Layer count:** Canvas2D state saves/restores and nested clipping do not scale to thousands of layers. Move to retained GPU layer list.
- **Filter chains:** CSS filters on Canvas2D are slow and non-isolated. GPU compositor is required for real-time filter stacks.
- **Text measurement:** measuring text per frame via `measureText` is fine for small docs but needs a shaped glyph cache for large documents.

## 7. Accessibility and usability findings

- Keyboard workflows are present (shortcuts, APG tree view), but brush and path-text tools lack keyboard alternatives.
- Screen-reader text editing is partially supported via the textarea overlay, but rich text runs and text-on-path need alternative descriptions.
- Color contrast is audited via token gates; image filters should respect `prefers-reduced-motion` and provide alternative text for generated content.

## 8. Import/export risks

- Text-to-shape and path-text fidelity will be lost in SVG export unless glyph paths are resolved at export time.
- Adjustment layers and filter stacks cannot be represented in plain SVG/PNG without rasterization or SVG filters. Need an explicit rasterize-on-export option.
- Linked assets require packaging logic when exporting to a standalone file format.

## 9. Incremental implementation roadmap

| Phase | Focus | Deliverable |
|---|---|---|
| P0 | Nondestructive adjustment layer type + IR filter primitive + Canvas2D fallback | `AdjustmentLayerNode`, `FilterIR`, tests |
| P0 | Fix image fill fit/tile/stretch and add image node fit | working image fill modes + tests |
| P1 | Raster layer backing + brush stroke model | `RasterLayerNode`, `BrushStroke`, tests |
| P1 | Text path / warp foundation + glyph-run layout | `textToPath`, `shapeTextRuns`, tests |
| P1 | WebGPU compositor scaffolding | `@varve/compositor` package |
| P2 | Alpha/luminance masks + selection system | `MaskSource`, `PixelSelection` |
| P2 | Smart object / asset catalog | `Document.assets`, relink, replace |
| P2 | Text-to-shape conversion | `textToShapes` + export |
| P3 | Full brush engine (presets, dynamics, smoothing) | Brush tool + library |
| P3 | High-DPI / large-image streaming | tiled raster layer |

## 10. Verification strategy

- **Unit tests:** every new scene type and adjustment/filter operation must have deterministic tests (e.g., replay to a recorder or read pixels from OffscreenCanvas).
- **Visual regression:** Playwright E2E with canvas snapshots for image fill modes, text path, and blur effects.
- **Performance:** benchmark IR size and frame time for 100/1000/10000 layer scenes.
- **Gates:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm audit:emoji`, `pnpm audit:tokens` after every change.

## 11. Remaining risks

- WebGPU adoption limits us to Chromium-based browsers for the GPU compositor; maintain Canvas2D fallback.
- WASM/native raster backends are needed for serious photo editing; the browser's canvas can hit memory limits.
- Font shaping and text-to-outline require a font parsing/shaping library; the current browser Canvas2D `fillText` is insufficient for professional typography.

## 12. Foundation implemented in this session

- `AdjustmentLayerNode` and adjustment stack model in `@varve/scene`.
- `FilterIR` primitive and Canvas2D replay support in `@varve/engine`.
- Text-path foundation (`shapeTextRuns`, `textToPath`) in `@varve/scene`.
- Brush stroke model and stroke smoothing in `@varve/scene`.
- Unit tests for all of the above.

See `docs/plans/image-text-manipulation-roadmap.md` for the detailed continuation plan and remaining work.
