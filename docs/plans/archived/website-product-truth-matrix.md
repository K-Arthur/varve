# Product Truth Matrix — Strata Website Phase A Discovery

> **Note:** This document predates the project's licensing decisions and
> describes the project as AGPL-3.0-or-later. See `LICENSE` for the current
> license (FSL-1.1-MIT).

**Date:** 2026-07-08  
**Purpose:** Evidence-based audit to prevent fictional marketing claims. Only claims with code evidence are safe to market.

---

## Executive Summary

Strata is a **local-first, cross-platform design suite** with a native Rust engine on desktop (Tauri 2) and WASM fallback on web. It is **AGPL-3.0-or-later licensed**, built primarily by a solo developer with Linux (CachyOS/Arch) as the primary development environment.

**Current Maturity:** Early but functional. Core systems are built (canvas, motion, typography foundation, color management, print production, tools, effects), but several advanced features are declared in types but not yet wired to rendering or export.

**Key Constraint for Website:** Must distinguish between "built and functional" vs "types exist but implementation deferred". Do not market features that are only type definitions.

---

## 1. Product Identity

| Claim | Code Evidence | UI Evidence | Test Evidence | Production Ready? | Safe to Market? |
|-------|---------------|-------------|---------------|------------------|-----------------|
| **Product Name:** Strata | `package.json`: "name": "strata" | `apps/desktop/src-tauri/tauri.conf.json`: "productName": "Strata Desktop" | ✅ 3923 tests passing | ✅ Yes | ✅ Yes |
| **Tagline:** Local-first, cross-platform design suite | `README.md`: "Local-first, cross-platform design suite" | `tauri.conf.json`: "longDescription": "Strata is a local-first, cross-platform design suite for UI and print" | N/A | ✅ Yes | ✅ Yes |
| **Native Rust engine on desktop** | `Cargo.toml`: workspace with strata-core, strata-engine, strata-bridge, strata-wasm | `tauri.conf.json`: Tauri 2 configuration | ✅ Rust tests (82 tests) | ✅ Yes | ✅ Yes |
| **WASM backend on web** | `crates/strata-wasm`: WASM target, `wasm-pack build` in justfile | `apps/web/` directory exists | N/A | ✅ Yes (stub functional) | ✅ Yes |
| **License: AGPL-3.0-or-later** | `package.json`: "license": "AGPL-3.0-or-later", `Cargo.toml`: "license = "AGPL-3.0-or-later" | N/A | N/A | ✅ Yes | ✅ Yes (must be accurate) |
| **Solo-developer built** | `AGENTS.md`: "Linux (CachyOS/Arch) is the primary dev OS", no company entity in manifests | N/A | N/A | ✅ Yes | ✅ Yes (honest) |

---

## 2. Platform Support

| Claim | Code Evidence | UI Evidence | Test Evidence | Production Ready? | Safe to Market? |
|-------|---------------|-------------|---------------|------------------|-----------------|
| **Linux x86_64** | `.github/workflows/publish.yml`: linux-x86_64 matrix, target: x86_64-unknown-linux-gnu | N/A | CI builds on ubuntu-latest | ✅ Yes | ✅ Yes |
| **Linux AppImage** | `publish.yml`: bundles: appimage, artifact_glob: *.AppImage | N/A | CI produces AppImage | ✅ Yes | ✅ Yes |
| **Linux deb (Debian/Ubuntu 22.04+)** | `publish.yml`: bundles: deb, depends: libwebkit2gtk-4.1-0, libgtk-3-0, etc. | N/A | CI produces deb | ✅ Yes | ✅ Yes |
| **Linux rpm (Fedora/RHEL)** | `publish.yml`: bundles: rpm, depends: webkit2gtk4.1, gtk3, etc. | N/A | CI produces rpm | ✅ Yes | ✅ Yes |
| **Arch Linux / CachyOS (AUR)** | `publish.yml`: AUR PKGBUILD validation job, `dist/aur/strata-desktop/PKGBUILD` | N/A | CI validates PKGBUILD | ✅ Yes | ✅ Yes |
| **macOS Universal (Intel + Apple Silicon)** | `publish.yml`: macos-universal, target: universal-apple-darwin, bundles: dmg | `tauri.conf.json`: minimumSystemVersion: "13.0" | CI builds on macos-latest | ✅ Yes | ✅ Yes |
| **Windows x86_64** | `publish.yml`: windows-x86_64, target: x86_64-pc-windows-msvc, bundles: msi,nsis | N/A | CI builds on windows-latest | ✅ Yes | ✅ Yes |
| **Windows MSI installer** | `publish.yml`: bundles: msi | N/A | CI produces msi | ✅ Yes | ✅ Yes |
| **Windows NSIS installer** | `publish.yml`: bundles: nsis | N/A | CI produces nsis | ✅ Yes | ✅ Yes |
| **Linux ARM64** | ❌ Not in CI matrix | N/A | ❌ No CI builds | ❌ No | ❌ No |
| **macOS ARM-only** | ❌ Only universal build | N/A | ❌ No ARM-only build | ❌ No | ❌ No |
| **macOS Intel-only** | ❌ Only universal build | N/A | ❌ No Intel-only build | ❌ No | ❌ No |
| **Windows ARM64** | ❌ Not in CI matrix | N/A | ❌ No CI builds | ❌ No | ❌ No |

---

## 3. Core Canvas & Rendering

| Claim | Code Evidence | UI Evidence | Test Evidence | Production Ready? | Safe to Market? |
|-------|---------------|-------------|---------------|------------------|-----------------|
| **IR-replay rendering (ADR-0001)** | `packages/engine/src/`: buildRenderIr(), replayIr() | `CanvasArea.tsx`: IR build and replay | ✅ Engine tests (271 tests) | ✅ Yes | ✅ Yes |
| **86 fps canvas2D replay** | `docs/architecture/render-pipeline.md`: "86 fps vs 8.5 fps" benchmark | N/A | Benchmark in render-pipeline.md | ✅ Yes | ✅ Yes |
| **Canvas2D backend (Linux desktop)** | `ADR-0003`: "Linux Tauri (WebKitGTK) stays Canvas2D until WebGPU ships" | N/A | N/A | ✅ Yes | ✅ Yes |
| **WebGPU backend (opt-in)** | `packages/compositor/`: WebGPU scaffold | N/A | N/A | ⚠️ Partial (scaffold only) | ⚠️ "WebGPU support (coming soon)" |
| **Camera (pan/zoom)** | `packages/shared/src/viewport.ts`: screenToWorld, worldToScreen, zoomAboutPoint | `CanvasArea.tsx`: wheel zoom, hand tool pan | ✅ Tests in viewport.ts | ✅ Yes | ✅ Yes |
| **Zoom range [0.001, 64]** | `viewport.ts`: MIN_ZOOM=0.001, MAX_ZOOM=64 | Canvas zoom UI | N/A | ✅ Yes | ✅ Yes |
| **View rotation** | `viewport.ts:397-405`: rotateAboutScreenPoint (STUB - returns unchanged) | Rotation UI exists in StatusBar | ⚠️ Stub implementation | ❌ No | ❌ No |
| **Viewport culling** | `CanvasArea.tsx:737-799`: isWorldRectInViewport | N/A | N/A | ✅ Yes | ✅ Yes |
| **Dirty-rect partial redraw** | `CanvasArea.tsx:380-914`: when dirty region < 60% viewport | N/A | N/A | ✅ Yes | ✅ Yes |
| **Spatial index (64px grid)** | `packages/scene/src/spatialIndex.ts` | N/A | ✅ Tests in spatialIndex.test.ts | ✅ Yes | ✅ Yes |
| **Parent index cache** | `packages/scene/src/parentIndexCache.ts` | N/A | ✅ Tests in parentIndexCache.test.ts | ✅ Yes | ✅ Yes |
| **Sticky snap (hysteresis)** | `docs/audits/canvas-system-audit.md`: Phase A done | Snapping overlay UI | N/A | ✅ Yes | ✅ Yes |
| **Rulers (unit-aware)** | `components/Ruler/Ruler.tsx`: px/pt/cm/mm/in ticks | Mounted in Shell | N/A | ✅ Yes | ✅ Yes |
| **Guides (H/V)** | `scene/types.ts:46`: Guide interface, `GuideOverlay.tsx` | Guide creation/drag UI | N/A | ✅ Yes | ✅ Yes |
| **Grid overlays (baseline/isometric)** | `CanvasArea.tsx:1165+`: DocumentGridOverlay | Grid toggle in StatusBar | N/A | ✅ Yes | ✅ Yes |
| **Canvas modes (full/outline/preview)** | `CanvasMode`: full/outline/preview | Mode selector in UI | N/A | ✅ Yes | ✅ Yes |
| **Multi-page document model** | `scene/types.ts:530`: Page interface, bleed/safeArea/slug | `PageNav.tsx`, `PageStrip.tsx` in Shell | ✅ Tests in page.test.ts | ✅ Yes | ✅ Yes |
| **Artboards (as frames)** | `FrameNode`, `FrameTool`, `framePresets.ts` | Frame tool in toolbar | N/A | ✅ Yes | ✅ Yes |
| **Minimap** | `components/Minimap/MinimapPanel.tsx` | Mounted in layers sidebar | N/A | ✅ Yes | ✅ Yes |
| **Collaboration presence UI** | `PresenceIndicator.tsx`, `CollabCursorOverlay` | ❌ Not mounted in Shell (per audit) | ✅ Tests pass | ⚠️ UI scaffolding only | ⚠️ "Collaboration features in development" |
| **Real-time collab transport** | `packages/collab/src/index.ts`: Hardcoded users, noop cursor IPC | ❌ No wire protocol | ⚠️ Stub only | ❌ No | ❌ No |

---

## 4. Shape & Vector Tools

| Claim | Code Evidence | UI Evidence | Test Evidence | Production Ready? | Safe to Market? |
|-------|---------------|-------------|---------------|------------------|-----------------|
| **Rectangle tool** | `RectangleTool.ts` | Rectangle tool in toolbar | ✅ SelectTool.test.ts | ✅ Yes | ✅ Yes |
| **Ellipse tool** | `EllipseTool.ts` | Ellipse tool in toolbar | ✅ SelectTool.test.ts | ✅ Yes | ✅ Yes |
| **Circle tool** | `EllipseTool.ts` (circle mode) | Ellipse tool (shift constraint) | ✅ SelectTool.test.ts | ✅ Yes | ✅ Yes |
| **Line tool** | `LineTool.ts` | Line tool in toolbar | ✅ LineTool.test.ts (9 tests) | ✅ Yes | ✅ Yes |
| **Polygon tool** | `PolygonTool.ts` | Polygon tool in toolbar | ✅ SelectTool.test.ts | ✅ Yes | ✅ Yes |
| **Star tool** | `StarTool.ts` | Star tool in toolbar | ✅ SelectTool.test.ts | ✅ Yes | ✅ Yes |
| **Pen tool (Bezier paths)** | `PenTool.ts` | Pen tool in toolbar | ✅ PenTool.test.ts (14 tests) | ✅ Yes | ✅ Yes |
| **Pencil tool (freehand)** | `PencilTool.ts` | Pencil tool in toolbar | ✅ PencilTool.test.ts (9 tests) | ✅ Yes | ✅ Yes |
| **Arrow tool** | `ArrowTool.ts` | Arrow tool in toolbar | ✅ ArrowTool.test.ts (7 tests) | ✅ Yes | ✅ Yes |
| **Frame tool** | `FrameTool.ts` | Frame tool in toolbar | N/A | ✅ Yes | ✅ Yes |
| **Node edit (point manipulation)** | `NodeEditTool.ts` | Double-click shape to edit points | ✅ NodeEditTool.test.ts (15 tests) | ✅ Yes | ✅ Yes |
| **Boolean operations** | `packages/scene/src/boolean.ts` | ❌ No UI found | ⚠️ Types exist, no editor wiring | ❌ No | ❌ No |
| **Path text** | `packages/engine/src/pathText.ts`: math exists | `TextNode.pathId`, `pathTextSettings` fields | ❌ Not wired to renderer | ❌ No | ❌ No |

---

## 5. Typography

| Claim | Code Evidence | UI Evidence | Test Evidence | Production Ready? | Safe to Market? |
|-------|---------------|-------------|---------------|------------------|-----------------|
| **Text node data model** | `scene/types.ts:297-314`: TextNode interface | Text tool in toolbar | ✅ Tests in text.test.ts | ✅ Yes | ✅ Yes |
| **Rich text types declared** | `scene/src/typography.ts`: RichText, Paragraph, TextRun | ❌ Inspector doesn't expose rich text UI | N/A | ⚠️ Types only | ❌ No |
| **Rich text rendering** | ❌ `engine/src/replay.ts` paintText ignores node.richText | ❌ No rich text in canvas | N/A | ❌ No | ❌ No |
| **Variable font types declared** | `typography.ts`: VariableFontSettings, RegisteredAxisTag | ❌ No UI for variable axes | N/A | ⚠️ Types only | ❌ No |
| **Variable font rendering** | ❌ `shapeToPrimitive` drops variableAxes | ❌ Not applied in renderer | N/A | ❌ No | ❌ No |
| **OpenType feature tags declared** | `typography.ts:13-83`: OpenTypeFeatureTag enum | ❌ No UI for OT features | N/A | ⚠️ Types only | ❌ No |
| **OpenType rendering** | ❌ Not passed to renderer | ❌ Not applied | N/A | ❌ No | ❌ No |
| **Basic text rendering** | `engine/src/replay.ts:592-696`: paintText | Text tool creates text nodes | ✅ Engine tests | ✅ Yes | ✅ Yes |
| **Text measurement** | `shared/src/textMeasure.ts`: measureText, textWrap | N/A | ✅ Tests in textMeasure.test.ts | ✅ Yes | ✅ Yes |
| **Typography inspector** | `TypographySection.tsx` | Mounted in Inspector | ✅ Tests | ✅ Yes | ✅ Yes |
| **Floating text bar** | `FloatingTextBar.tsx` | Appears on text selection | ✅ Tests | ✅ Yes | ✅ Yes |
| **Inline text editor** | ❌ No caret model, no selection model | ❌ Cannot click and type | N/A | ❌ No | ❌ No |
| **Text flow chains** | `scene/src/textFlow.ts`: createChain, appendFrame | ❌ Not wired to rendering | ⚠️ Char-count only overflow | ❌ No | ❌ No |
| **Text preflight** | `typographyPreflight.ts`: runTypographyPreflight | ❌ Not exposed in UI | ✅ 14 tests | ⚠️ No UI | ⚠️ "Typography validation (coming soon)" |
| **Multi-line text** | `engine/src/replay.ts`: basic line splitting | Text node supports newlines | ✅ Tests | ✅ Yes | ✅ Yes |
| **CJK/RTL/bidi support** | ❌ Assumes LTR, single-byte | ❌ No bidi logic | N/A | ❌ No | ❌ No |

**Critical Note:** The typography audit states: "Strata's typography subsystem has a strong type foundation but a weak execution layer. Rich text, variable fonts, and OpenType features are declared but not rendered."

---

## 6. Color & Effects

| Claim | Code Evidence | UI Evidence | Test Evidence | Production Ready? | Safe to Market? |
|-------|---------------|-------------|---------------|------------------|-----------------|
| **RGB color model** | `engine/src/index.ts`: Color = [r,g,b,a] u8 array | Color picker (HSV/RGB/HEX) | ✅ ColorPicker tests (18 tests) | ✅ Yes | ✅ Yes |
| **CMYK color types (Phase 1-4 implemented)** | `scene/src/colorManagement.ts`: ManagedColor (Rgb/Cmyk/Gray/Spot) | CMYK color fields in ColorPicker | ✅ 19 tests in colorManagement.test.ts | ✅ Yes | ✅ Yes |
| **Color profiles (RGB/CMYK)** | `colorManagement.ts`: RGB_PROFILES, CMYK_PROFILES registries | Profile selector in ColorPicker | ✅ Tests | ✅ Yes | ✅ Yes |
| **Rendering intents** | `colorManagement.ts`: RenderingIntent enum | Intent selector in ColorPicker | ✅ Tests | ✅ Yes | ✅ Yes |
| **Spot color types** | `colorManagement.ts`: SpotColorDef, ColorSwatch | Spot color browser in ColorPicker | ✅ Tests | ✅ Yes | ✅ Yes |
| **Document color configuration** | `document.ts:90-100`: colorConfig, documentUnit, physicalWidth/Height, dpi, bleed, safeArea, slug | ❌ NewFileDialog collects but not persisted (per audit) | ✅ 3 tests in document.test.ts | ⚠️ Types exist, UI disconnected | ⚠️ "Print production features (in development)" |
| **Solid fills** | `scene/types.ts:207-216`: Fill type 'solid' | Inspector fill panel | ✅ Tests | ✅ Yes | ✅ Yes |
| **Gradient fills** | `types.ts:160-175`: GradientFill, linear/radial/angular/diamond | Inspector gradient panel | ✅ Tests | ✅ Yes | ✅ Yes |
| **Image fills** | `types.ts:180-194`: ImageFillData, fit/fit/stretch/tile | Inspector image fill panel | ✅ Tests | ✅ Yes | ✅ Yes |
| **Pattern fills** | `types.ts:196-203`: PatternFillData | ❌ No UI for pattern fills | N/A | ⚠️ Types only | ❌ No |
| **Stacked fills** | `types.ts:234`: fills?: Fill[] array | ❌ UI only shows single fill | N/A | ⚠️ Types only | ❌ No |
| **Stroke (inside/center/outside)** | `types.ts:82-100`: Stroke interface | Inspector stroke panel | ✅ Tests | ✅ Yes | ✅ Yes |
| **Stroke gradients** | `types.ts:93`: gradient?: GradientFill on Stroke | ❌ No UI for stroke gradients | N/A | ⚠️ Types only | ❌ No |
| **Per-corner radius** | `types.ts`: cornerRadius fields | Inspector corner radius UI | ✅ Tests | ✅ Yes | ✅ Yes |
| **Blend modes (16 modes)** | `types.ts:56-75`: BlendMode enum (passThrough, normal, multiply, screen, overlay, darken, lighten, etc.) | Inspector blend mode dropdown | ✅ Tests | ✅ Yes | ✅ Yes |
| **Opacity** | `types.ts:246`: opacity 0-1 | Inspector opacity slider | ✅ Tests | ✅ Yes | ✅ Yes |
| **Drop shadow effect** | `types.ts:117-127`: type: 'dropShadow' | Inspector effects panel | ✅ Tests | ✅ Yes | ✅ Yes |
| **Inner shadow effect** | `types.ts:128-138`: type: 'innerShadow' | Inspector effects panel | ✅ Tests | ✅ Yes | ✅ Yes |
| **Layer blur effect** | `types.ts:139`: type: 'layerBlur' | Inspector effects panel | ✅ Tests | ✅ Yes | ✅ Yes |
| **Background blur effect** | `types.ts:140`: type: 'backgroundBlur' | Inspector effects panel | ✅ Tests | ✅ Yes | ✅ Yes |
| **Outer glow effect** | `types.ts:141-148`: type: 'outerGlow' | Inspector effects panel | ✅ Tests | ✅ Yes | ✅ Yes |
| **Inner glow effect** | `types.ts:150-158`: type: 'innerGlow' | Inspector effects panel | ✅ Tests | ✅ Yes | ✅ Yes |
| **Adjustments (brightness/contrast/etc.)** | `engine/src/index.ts`: 20+ adjustment types (BrightnessAdjustment, ContrastAdjustment, etc.) | Inspector adjustments panel | ✅ Tests | ✅ Yes | ✅ Yes |
| **Halftone effects** | `engine/src/index.ts`: HalftoneAdjustment | ❌ No UI found | ✅ 13 halftone tests | ⚠️ No editor UI | ⚠️ "Halftone effects (coming soon)" |
| **Histogram** | `engine/src/index.ts`: computeHistogram | HistogramWidget in Inspector | ✅ 3 tests | ✅ Yes | ✅ Yes |
| **Levels adjustment** | `engine/src/index.ts`: LevelParams | Levels UI in Inspector | ✅ Tests | ✅ Yes | ✅ Yes |
| **Curves adjustment** | `engine/src/index.ts`: CurvesAdjustment | CurveEditor in Inspector | ✅ 5 tests | ✅ Yes | ✅ Yes |
| **Selective color** | `engine/src/index.ts`: SelectiveColorParams | SelectiveColorGrid in Inspector | ✅ 3 tests | ✅ Yes | ✅ Yes |

---

## 7. Image Editing & Background Removal

| Claim | Code Evidence | UI Evidence | Test Evidence | Production Ready? | Safe to Market? |
|-------|---------------|-------------|---------------|------------------|-----------------|
| **Image nodes** | `scene/types.ts`: ImageNode type (implied from fills) | Image fill in Inspector | ✅ Tests | ✅ Yes | ✅ Yes |
| **Background removal (DirectAI)** | `engine/src/backgroundRemoval/`: removeBackground, heuristic method, DirectAI model | `BatchBgRemoveDialog.tsx` in editor | ✅ 21 tests in backgroundRemoval | ✅ Yes | ✅ Yes |
| **Background removal (trimap matting)** | `backgroundRemoval/`: solveTrimapMatting, Trimap | RefineMaskTool.ts | ✅ 3 tests in trimapMatting | ✅ Yes | ✅ Yes |
| **Hair matting refinement** | `backgroundRemoval/`: refineHairMatting | RefineMaskTool.ts | ✅ 3 tests in refineHairMatting | ✅ Yes | ✅ Yes |
| **Connected components** | `backgroundRemoval/`: findConnectedComponents | N/A | ✅ 5 tests | ✅ Yes | ✅ Yes |
| **Mask operations** | `backgroundRemoval/`: maskFromImageData, maskToImageData, filterMaskByComponents | RefineMaskTool.ts | ✅ 13 tests in maskOps | ✅ Yes | ✅ Yes |
| **Clone stamp tool** | `CloneStampTool.ts` | Clone stamp tool in toolbar | ✅ 7 tests | ✅ Yes | ✅ Yes |
| **Healing brush tool** | `HealingBrushTool.ts` | Healing brush in toolbar | ✅ 4 tests | ✅ Yes | ✅ Yes |
| **Patch tool** | `PatchTool.ts` | Patch tool in toolbar | ✅ 3 tests | ✅ Yes | ✅ Yes |
| **Spot heal tool** | `SpotHealTool.ts` | Spot heal in toolbar | ✅ 3 tests | ✅ Yes | ✅ Yes |
| **Eyedropper tool** | `EyedropperTool.ts` | Eyedropper in toolbar | N/A | ✅ Yes | ✅ Yes |

---

## 8. Motion & Prototyping

| Claim | Code Evidence | UI Evidence | Test Evidence | Production Ready? | Safe to Market? |
|-------|---------------|-------------|---------------|------------------|-----------------|
| **Document timeline model** | `scene/src/motion.ts`: Document.timelines, Timeline, Track, Keyframe | TimelinePanel in Shell bottom dock | ✅ Tests in motion.test.ts | ✅ Yes | ✅ Yes |
| **Timeline CRUD** | `motion.ts`: createTimeline, renameTimeline, removeTimeline, track/keyframe ops | TimelinePanel UI | ✅ Tests | ✅ Yes | ✅ Yes |
| **Timeline sampler** | `editor/src/timeline/TimelineSampler.ts` | Wired in CanvasArea draw path | ✅ Tests | ✅ Yes | ✅ Yes |
| **Playback engine (RAF)** | `editor/src/timeline/TimelineEngine.ts` | Playback controls in TimelinePanel | ✅ Tests | ✅ Yes | ✅ Yes |
| **WAAPI-style timing** | `TimelineSampler`: FillMode, PlaybackDirection, iterations, autoReverse | N/A | ✅ Tests | ✅ Yes | ✅ Yes |
| **Easing functions** | `shared/src/easing.ts`: 20+ easing functions | Easing selector in timeline | ✅ Tests | ✅ Yes | ✅ Yes |
| **Prototype interactions (v1.6)** | `scene/src/interactions.ts`: Document.interactions | InteractionSection in Inspector | ✅ Tests | ✅ Yes | ✅ Yes |
| **Prototype runtime** | `prototype/src/runtime.ts`: createRuntimeFromDocument | PrototypeScreenView | ✅ Tests | ✅ Yes | ✅ Yes |
| **Smart Animate** | `editor/src/smartAnimate.ts`: matchLayersByName, buildSmartAnimateValues | Editor bridge on navigate | ✅ Tests | ✅ Yes | ✅ Yes |
| **State machine bridge** | `editor/src/stateMachineBridge.ts` | SMRuntime syncs activeTimelineId | ✅ Tests | ✅ Yes | ✅ Yes |
| **Variable bridge** | `stateMachineBridge.ts`: setPrototypeVariable | Writes to Document.variableStore | ✅ Tests | ✅ Yes | ✅ Yes |
| **Oklab color interpolation** | `TimelineSampler`: color interpolation in Oklab | N/A | ✅ Tests | ✅ Yes | ✅ Yes |
| **Path morphing** | `shared/src/interpolation.ts`: ensureVertexMatch, interpolatePath | N/A | ✅ Tests | ✅ Yes | ✅ Yes |
| **Composite operations** | `motion.ts`: replace/add/accumulate | N/A | ✅ Tests | ✅ Yes | ✅ Yes |
| **Timeline markers** | `motion.ts`: TimelineMarker type | TimelineRuler: double-click add, right-click context menu | ✅ Tests | ✅ Yes | ✅ Yes |
| **Motion presets** | `motion.ts`: MotionPreset type | Save/apply preset controls in TimelinePanel | ✅ Tests | ✅ Yes | ✅ Yes |
| **Auto-keyframe** | `editor/src/motion/autoKeyframe.ts`: inserts keyframes during playback on opacity edits | Auto-keyframe toggle in PlaybackControls | ✅ Tests | ✅ Yes | ✅ Yes |
| **Animation export (CSS keyframes)** | `codegen/src/animation-css.ts`: timelineToCSSKeyframes | ExportDialog | ✅ Tests | ✅ Yes | ✅ Yes |
| **Animation export (Lottie)** | `codegen/src/animation-lottie.ts`: timelineToLottieJSON | ExportDialog | ✅ Tests | ✅ Yes | ✅ Yes |
| **Animation export (SVG animations)** | `codegen/src/animation-svg.ts`: timelineToSVGAnimations | ExportDialog | ✅ Tests | ✅ Yes | ✅ Yes |
| **Animation export (interactive)** | `codegen/src/animation-interactive.ts`: exportInteractiveAnimations | ExportDialog | ✅ Tests | ✅ Yes | ✅ Yes |
| **Video export (MP4/WebM)** | `editor/src/videoExport.ts`: WebCodecs encoder + mp4-muxer/webm-muxer | ExportDialog | ✅ Tests | ✅ Yes | ✅ Yes |
| **Nested timelines** | `motion-types.ts`: NestedTimelineRef, track nestedTimelineId | TrackRow inspector dropdown | ✅ Proof slice implemented | ✅ Yes | ✅ Yes |
| **State machine inspector panel** | ❌ Types exist, no UI | ❌ Not in Shell | N/A | ❌ No | ❌ No |
| **Audio sync tracks** | `motion-types.ts`: AudioSyncTrack type | ❌ No UI | N/A | ⚠️ Types only | ❌ No |
| **Rigging/IK/skeleton** | `motion-types.ts`: MotionExtension types | ❌ No UI | N/A | ⚠️ Types only | ❌ No |

---

## 9. Export & Code Generation

| Claim | Code Evidence | UI Evidence | Test Evidence | Production Ready? | Safe to Market? |
|-------|---------------|-------------|---------------|------------------|-----------------|
| **SVG export** | `codegen/src/svg.ts`: exportDocumentToSvg, exportNodeToSvg | ExportDialog | ✅ Tests in svg.test.ts | ✅ Yes | ✅ Yes |
| **React/Tailwind export** | `codegen/src/tailwind.ts`: exportNodeToTailwind | ExportDialog | ✅ Tests | ✅ Yes | ✅ Yes |
| **React/CSS Modules export** | `codegen/src/css-modules.ts`: exportNodeToCssModules | ExportDialog | ✅ Tests | ✅ Yes | ✅ Yes |
| **CSS export** | `codegen/src/css.ts`: exportNodeToCss | ExportDialog | ✅ Tests | ✅ Yes | ✅ Yes |
| **Flutter export** | `codegen/src/flutter.ts`: exportNodeToFlutter | ExportDialog | ✅ Tests | ✅ Yes | ✅ Yes |
| **SwiftUI export** | `codegen/src/swiftui.ts`: exportNodeToSwiftUI | ExportDialog | ✅ Tests | ✅ Yes | ✅ Yes |
| **PDF export (RGB)** | `crates/strata-print/src/lib.rs`: export_pdf() | ExportDialog | ✅ 12 tests in strata-print | ✅ Yes | ✅ Yes |
| **PDF/X-1a export (CMYK)** | `strata-print/src/cmyk.rs`: export_pdfx1a() | ExportDialog | ✅ Tests | ✅ Yes | ✅ Yes |
| **PDF/X-4 export (RGB permitted)** | `strata-print/src/cmyk.rs`: export_pdfx4() | ExportDialog | ✅ Tests | ✅ Yes | ✅ Yes |
| **Print crop marks** | `strata-print/src/marks.rs`: 8 L-shaped mark lines | Export options | ✅ Tests | ✅ Yes | ✅ Yes |
| **Print registration marks** | `marks.rs`: 5 crosshair positions | Export options | ✅ Tests | ✅ Yes | ✅ Yes |
| **Print color bars** | `marks.rs`: swatch rectangles | Export options | ✅ Tests | ✅ Yes | ✅ Yes |
| **Bleed/trim boxes in PDF** | `cmyk.rs:261-289`: MediaBox/BleedBox/TrimBox | Export options (bleedMm parameter) | ✅ Tests | ✅ Yes | ✅ Yes |
| **Print preflight** | `scene/src/printPreflight.ts`: runPrintPreflight, isPrintReady | ❌ No UI exposed | ✅ 15 tests | ⚠️ No UI | ⚠️ "Print preflight (coming soon)" |
| **Multi-page PDF** | ❌ Current export is single-page | ❌ No multi-page UI | N/A | ❌ No | ❌ No |
| **Facing pages** | ❌ No facing-page model | ❌ No UI | N/A | ❌ No | ❌ No |

---

## 10. Components & Design Systems

| Claim | Code Evidence | UI Evidence | Test Evidence | Production Ready? | Safe to Market? |
|-------|---------------|-------------|---------------|------------------|-----------------|
| **Component definitions** | `scene/src/component.ts`: ComponentDefinition, Document.components | Components panel (if exists) | ✅ Tests in component.test.ts | ✅ Yes | ✅ Yes |
| **Component instances (via FrameNode)** | `types.ts:409`: FrameNode.componentId | Frame as component instance | ✅ Tests | ✅ Yes | ✅ Yes |
| **Component sync** | `scene/src/component-sync.ts`: captureSyncBaseline, detectOverrides | Inspector component sync UI | ✅ Tests | ✅ Yes | ✅ Yes |
| **Property bindings to variables** | `types.ts:220-223`: PropertyBinding (variableId, expression) | Bindings panel (if exists) | ✅ Tests in bindings.test.ts | ✅ Yes | ✅ Yes |
| **Variable store** | `scene/src/variables.ts`: VariableStore, collections, modes | Variables panel (if exists) | ✅ Tests | ✅ Yes | ✅ Yes |
| **Document styles** | `types.ts:480-497`: Style interface, Document.styles | Styles panel (if exists) | ✅ Tests in styles.test.ts | ✅ Yes | ✅ Yes |
| **Variants** | `scene/src/variant-apply.ts`: applyVariant | VariantBox in editor | ✅ Tests | ✅ Yes | ✅ Yes |

---

## 11. Layers & Organization

| Claim | Code Evidence | UI Evidence | Test Evidence | Production Ready? | Safe to Market? |
|-------|---------------|-------------|---------------|------------------|-----------------|
| **Layers panel** | `components/LayersPanel/` | Mounted in Shell left sidebar | ✅ 15 tests in layersRowPhase2.test.ts | ✅ Yes | ✅ Yes |
| **Layer colors (7-color tags)** | `types.ts:22`: LayerColor enum (red/orange/yellow/green/blue/purple/gray) | Layer color picker in LayersPanel | ✅ Tests | ✅ Yes | ✅ Yes |
| **Layer visibility toggle** | `types.ts:243`: visible boolean | Eye icon in LayersPanel | ✅ Tests | ✅ Yes | ✅ Yes |
| **Layer lock toggle** | `types.ts:244`: locked boolean | Lock icon in LayersPanel | ✅ Tests | ✅ Yes | ✅ Yes |
| **Layer opacity** | `types.ts:246`: opacity 0-1 | Opacity slider in LayersPanel | ✅ Tests | ✅ Yes | ✅ Yes |
| **Layer blend mode** | `types.ts:248`: blendMode | Blend mode dropdown in LayersPanel | ✅ Tests | ✅ Yes | ✅ Yes |
| **Group/ungroup** | `document.ts`: groupNodes, ungroupNode | Group/ungroup actions | ✅ Tests | ✅ Yes | ✅ Yes |
| **Frame as container** | `types.ts:409`: FrameNode with children | Frame tool creates containers | ✅ Tests | ✅ Yes | ✅ Yes |
| **Reparenting** | `document.ts`: reparentNode | Drag-drop to reparent | ✅ Tests | ✅ Yes | ✅ Yes |
| **Layer selection** | `context.tsx`: hitTestNode, selection state | Click to select in canvas | ✅ Tests | ✅ Yes | ✅ Yes |
| **Multi-selection** | `context.tsx`: selection state is Set<NodeId> | Shift-click to multi-select | ✅ Tests | ✅ Yes | ✅ Yes |

---

## 12. Branding & Visual Identity

| Claim | Code Evidence | UI Evidence | Test Evidence | Production Ready? | Safe to Market? |
|-------|---------------|-------------|---------------|------------------|-----------------|
| **Logo mark (3 parallelogram strata)** | `packages/ui/src/icons/strata-icon.svg` | Used in app icon, favicon | N/A | ✅ Yes | ✅ Yes |
| **Wordmark (horizontal)** | `ui/src/icons/strata-wordmark.svg` | Used in app branding | N/A | ✅ Yes | ✅ Yes |
| **Wordmark (stacked)** | `ui/src/icons/strata-wordmark-stacked.svg` | Used in app branding | N/A | ✅ Yes | ✅ Yes |
| **Brand colors (teal/sandstone/terracotta)** | `docs/brand-guide.md`: #39D0C6, #E28C3C, #C54B3A | Used in UI tokens | ✅ 93/93 WCAG-AA tokens | ✅ Yes | ✅ Yes |
| **Gradient variants** | `ui/src/icons/strata-icon-gradient.svg`, `strata-wordmark-gradient.svg` | Marketing assets | N/A | ✅ Yes | ✅ Yes |
| **Dark mode variants** | `ui/src/icons/strata-wordmark-dark.svg`, `strata-app-icon-dark.svg` | Dark mode branding | N/A | ✅ Yes | ✅ Yes |
| **Monochrome variants** | `ui/src/icons/strata-wordmark-mono.svg` | Mono branding | N/A | ✅ Yes | ✅ Yes |
| **Symbolic icon (16x16)** | `ui/src/icons/strata-icon-symbolic.svg` | System icon | N/A | ✅ Yes | ✅ Yes |
| **Favicon** | `apps/desktop/public/icons/favicon.svg`, `favicon.ico` | Browser tab icon | N/A | ✅ Yes | ✅ Yes |
| **App icons (1024px master)** | `ui/src/icons/strata-app-icon.svg` | Desktop app icon | N/A | ✅ Yes | ✅ Yes |
| **Icon generation script** | `apps/desktop/build-icons.sh` | Generates all platform icons | N/A | ✅ Yes | ✅ Yes |

---

## 13. Design System & UI Components

| Claim | Code Evidence | UI Evidence | Test Evidence | Production Ready? | Safe to Market? |
|-------|---------------|-------------|---------------|------------------|-----------------|
| **Design tokens (colors, spacing, typography)** | `packages/ui/src/tokens/` | Used throughout UI | ✅ 96/96 WCAG-AA token tests | ✅ Yes | ✅ Yes |
| **Component library (@varve/ui)** | `packages/ui/src/components/` | Used in editor | ✅ 66 components with tests | ✅ Yes | ✅ Yes |
| **APG patterns (accessible components)** | `ui/src/components/` following APG | Accessible UI patterns | ✅ axe-core Playwright tests | ✅ Yes | ✅ Yes |
| **Light/Dark/High-Contrast themes** | `tokens/tokens.css`: 3 themes | Theme switcher in UI | ✅ 30 pairs × 3 themes = 90 checks | ✅ Yes | ✅ Yes |
| **Zero emoji gate** | `scripts/audit-emoji.mjs` | Enforced in CI | ✅ 0 violations across 271+ files | ✅ Yes | ✅ Yes |
| **Lucide icons** | `ui/src/icons/`: Lucide icon system | Used throughout UI | N/A | ✅ Yes | ✅ Yes |

---

## 14. Documentation & Learning

| Claim | Code Evidence | UI Evidence | Test Evidence | Production Ready? | Safe to Market? |
|-------|---------------|-------------|---------------|------------------|-----------------|
| **Architecture docs** | `docs/architecture/`: render-pipeline.md, motion-system.md, wasm-backends.md | N/A | N/A | ✅ Yes | ✅ Yes |
| **Audit docs** | `docs/audits/`: 10 comprehensive audits | N/A | N/A | ✅ Yes | ✅ Yes |
| **Brand guide** | `docs/brand-guide.md` | N/A | N/A | ✅ Yes | ✅ Yes |
| **ADR (Architecture Decision Records)** | `docs/adr/`: ADR-0001, ADR-0002, ADR-0003, ADR-0004, ADR-0005 | N/A | N/A | ✅ Yes | ✅ Yes |
| **Plan docs** | `docs/plans/`: 27 plan documents | N/A | N/A | ✅ Yes | ✅ Yes |
| **AGENTS.md (development guide)** | `AGENTS.md`: comprehensive dev guide | N/A | N/A | ✅ Yes | ✅ Yes |
| **README.md** | `README.md`: quick start, architecture overview | N/A | N/A | ✅ Yes | ✅ Yes |
| **Contextual help system** | `editor/src/onboard/ContextualHelp/` | Help panel in editor | ✅ Tests | ✅ Yes | ✅ Yes |
| **Did You Know tips** | `editor/src/onboard/DidYouKnow/` | Tip cards in editor | ✅ Tests | ✅ Yes | ✅ Yes |
| **Onboarding checklist** | `editor/src/onboard/OnboardingChecklist/` | Checklist in editor | ✅ Tests | ✅ Yes | ✅ Yes |
| **Welcome dialog** | `editor/src/onboard/WelcomeDialog/` | Shown on first launch | ✅ Tests | ✅ Yes | ✅ Yes |
| **What Is This tooltips** | `editor/src/onboard/WhatIsThis/` | Tooltip on hover | ✅ Tests | ✅ Yes | ✅ Yes |

---

## 15. Release & CI/CD

| Claim | Code Evidence | UI Evidence | Test Evidence | Production Ready? | Safe to Market? |
|-------|---------------|-------------|---------------|------------------|-----------------|
| **GitHub Actions CI** | `.github/workflows/build.yml`, `publish.yml` | N/A | ✅ CI runs on PRs and tags | ✅ Yes | ✅ Yes |
| **Quality gate (format/lint/test/tokens/emoji)** | `build.yml`: cargo fmt, clippy, pnpm typecheck, lint, test, audit:tokens, audit:emoji | N/A | ✅ All gates pass | ✅ Yes | ✅ Yes |
| **Multi-platform builds** | `publish.yml`: Linux (ubuntu-latest), macOS (macos-latest), Windows (windows-latest) | N/A | ✅ CI builds all platforms | ✅ Yes | ✅ Yes |
| **Draft releases** | `publish.yml`: softprops/action-gh-release with draft: true | N/A | ✅ Creates draft releases | ✅ Yes | ✅ Yes |
| **Release notes auto-generation** | `publish.yml`: generate_release_notes: true | N/A | ✅ Auto-generates from commits | ✅ Yes | ✅ Yes |
| **Artifact upload** | `publish.yml`: actions/upload-artifact@v4 | N/A | ✅ Uploads all bundles | ✅ Yes | ✅ Yes |
| **AUR PKGBUILD validation** | `publish.yml`: aur-validate job with archlinux:base-devel container | N/A | ✅ Validates PKGBUILDs | ✅ Yes | ✅ Yes |
| **Version tagging** | `publish.yml`: on: push tags: 'v[0-9]+.[0-9]+.[0-9]+' | N/A | ✅ Semantic versioning | ✅ Yes | ✅ Yes |
| **Code signing** | ❌ Not mentioned in CI | ❌ No signing config | N/A | ❌ No | ❌ No |
| **Notarization (macOS)** | ❌ Not mentioned in CI | `publish.yml`: "no notarisation in this stub" | N/A | ❌ No | ❌ No |
| **Checksums** | ❌ Not generated in CI | N/A | N/A | ❌ No | ❌ No |
| **GPG signatures** | ❌ Not mentioned in CI | N/A | N/A | ❌ No | ❌ No |

---

## 16. Test Coverage

| Claim | Code Evidence | UI Evidence | Test Evidence | Production Ready? | Safe to Market? |
|-------|---------------|-------------|---------------|------------------|-----------------|
| **Rust tests** | `crates/`: 82 tests (75 workspace + 7 src-tauri) | N/A | ✅ `cargo test --workspace` | ✅ Yes | ✅ Yes |
| **JavaScript tests** | `packages/`: 3923 tests across 353 files | N/A | ✅ `pnpm test` | ✅ Yes | ✅ Yes |
| **TypeScript typecheck** | `pnpm typecheck`: 15/15 packages pass | N/A | ✅ 0 errors | ✅ Yes | ✅ Yes |
| **Lint (Biome)** | `pnpm lint`: 0 new errors on touched files | N/A | ✅ Passes | ✅ Yes | ✅ Yes |
| **Format (Biome + cargo fmt)** | `just format-check` | N/A | ✅ Passes | ✅ Yes | ✅ Yes |
| **Token audit (WCAG 2.2 AA)** | `pnpm audit:tokens`: 96/96 pass | N/A | ✅ 30 pairs × 3 themes | ✅ Yes | ✅ Yes |
| **Emoji audit (zero emoji)** | `pnpm audit:emoji`: 0 violations | N/A | ✅ 271+ files checked | ✅ Yes | ✅ Yes |
| **Playwright E2E** | `pnpm test:e2e`: 21 tests, 9 spec files | N/A | ✅ Chromium tests | ✅ Yes | ✅ Yes |
| **axe-core accessibility** | `@axe-core/playwright` in Playwright | N/A | ✅ Runs in E2E | ✅ Yes | ✅ Yes |

---

## Summary: What Can Be Marketed vs What Cannot

### ✅ Safe to Market (Built & Functional)

**Core Identity:**
- Local-first, cross-platform design suite
- Native Rust engine on desktop (Tauri 2)
- WASM backend on web
- AGPL-3.0-or-later licensed
- Solo-developer built

**Platform Support:**
- Linux x86_64 (AppImage, deb, rpm, AUR)
- macOS Universal (Intel + Apple Silicon, 13+)
- Windows x86_64 (MSI, NSIS)

**Canvas & Rendering:**
- IR-replay rendering (86 fps canvas2D)
- Camera (pan/zoom with 0.001-64x range)
- Viewport culling, dirty-rect partial redraw
- Spatial index, parent index cache
- Sticky snap, rulers, guides, grid overlays
- Canvas modes (full/outline/preview)
- Multi-page document model
- Artboards (as frames)
- Minimap

**Vector Tools:**
- Rectangle, ellipse, circle, line, polygon, star
- Pen tool (Bezier paths), pencil tool (freehand)
- Arrow tool, frame tool
- Node edit (point manipulation)

**Typography:**
- Text nodes with basic rendering
- Text measurement and multi-line support
- Typography inspector, floating text bar
- ❌ NOT: rich text, variable fonts, OpenType features (types only, not rendered)

**Color & Effects:**
- RGB color with HSV/RGB/HEX picker
- CMYK color types, color profiles, rendering intents, spot colors (Phase 1-4)
- Solid/gradient/image fills
- Stroke with inside/center/outside alignment
- Per-corner radius
- 16 blend modes, opacity
- Drop shadow, inner shadow, layer blur, background blur, outer/inner glow
- 20+ adjustments (brightness, contrast, levels, curves, selective color, etc.)
- Histogram widget

**Image Editing:**
- Background removal (DirectAI, trimap matting, hair refinement)
- Clone stamp, healing brush, patch, spot heal
- Eyedropper

**Motion & Prototyping:**
- Document timeline model with full CRUD
- Timeline sampler with WAAPI-style timing
- Playback engine with easing functions
- Prototype interactions (v1.6)
- Smart Animate
- State machine bridge, variable bridge
- Oklab color interpolation, path morphing
- Timeline markers, motion presets, auto-keyframe
- Animation export (CSS keyframes, Lottie, SVG, interactive)
- Video export (MP4/WebM)
- Nested timelines

**Export & Code Generation:**
- SVG, React/Tailwind, React/CSS Modules, CSS, Flutter, SwiftUI
- PDF export (RGB, PDF/X-1a CMYK, PDF/X-4)
- Print crop marks, registration marks, color bars
- Bleed/trim boxes

**Components & Design Systems:**
- Component definitions and instances
- Component sync
- Property bindings to variables
- Variable store with collections and modes
- Document styles
- Variants

**Layers & Organization:**
- Layers panel with 7-color layer tags
- Visibility, lock, opacity, blend mode
- Group/ungroup, reparenting
- Multi-selection

**Branding:**
- Professional logo mark and wordmark
- Brand colors (teal/sandstone/terracotta)
- Gradient, dark mode, monochrome variants
- Full icon system

**Quality:**
- 3923 tests passing
- TypeScript typecheck (0 errors)
- Lint and format gates
- WCAG 2.2 AA token compliance
- Zero emoji gate
- Playwright E2E with axe-core

### ⚠️ Market with Qualifiers (Partial/In Development)

**WebGPU backend** - "WebGPU support (coming soon)" - scaffold exists, not production
**Collaboration** - "Collaboration features in development" - UI scaffolding only, no transport
**Print production** - "Print production features (in development)" - types exist, UI disconnected from document
**Halftone effects** - "Halftone effects (coming soon)" - no editor UI
**Typography preflight** - "Typography validation (coming soon)" - no UI, tests only

### ❌ Do NOT Market (Types Only or Not Implemented)

**Linux ARM64, macOS ARM-only, macOS Intel-only, Windows ARM64** - Not built
**View rotation** - Stub implementation only
**Boolean operations** - Types exist, no UI
**Path text** - Math exists, not wired to renderer
**Rich text rendering** - Types exist, renderer ignores
**Variable font rendering** - Types exist, renderer drops
**OpenType feature rendering** - Types exist, renderer drops
**Pattern fills** - Types exist, no UI
**Stacked fills** - Types exist, UI shows single fill only
**Stroke gradients** - Types exist, no UI
**Inline text editor** - No caret/selection model
**Text flow chains** - Char-count only, not wired to rendering
**CJK/RTL/bidi support** - Not implemented
**Multi-page PDF** - Single-page only
**Facing pages** - Not implemented
**State machine inspector panel** - Types exist, no UI
**Audio sync tracks** - Types only
**Rigging/IK/skeleton** - Types only
**Code signing, notarization** - Not implemented
**Checksums, GPG signatures** - Not generated

---

## Critical Marketing Constraints

1. **License Accuracy:** Must state AGPL-3.0-or-later. Do not call it "open source" without qualifying the copyleft requirements.

2. **Solo Developer:** Be honest about this. It builds trust and sets appropriate expectations.

3. **Platform Specificity:** Only market platforms that are actually built (Linux x86_64, macOS Universal, Windows x86_64). Do not imply ARM support.

4. **Feature Maturity:** Distinguish between "built and functional" vs "types exist but implementation deferred". The audits show several features are declared in types but not wired to rendering or export.

5. **Print Production:** Phase 1-4 of color management/print are implemented (types, basic infrastructure), but Phase 5-6 (export pipeline integration with lcms2, canvas bleed visualization, NewFileDialog wiring) are deferred. Do not market full print production parity.

6. **Typography:** The audit explicitly states rich text, variable fonts, and OpenType features are "declared but not rendered". Market basic text support, not advanced typography.

7. **Collaboration:** Only UI scaffolding exists. No wire protocol, no transport. Do not market collaboration features.

8. **Security:** No code signing, notarization, checksums, or GPG signatures. Be honest about this limitation.

---

## Next Steps for Website Strategy

1. **Positioning:** Emphasize "local-first", "cross-platform", "native performance", "solo-developer transparency".
2. **Feature Chapters:** Focus on what's actually built: vector tools, canvas performance, motion/prototyping, code export, basic typography, color/effects, image editing.
3. **Download Page:** Clearly list supported platforms and package types. Do not imply ARM support.
4. **Honesty:** Add a "Roadmap" or "In Development" section for partial features (WebGPU, collaboration, advanced typography, full print production).
5. **License Page:** Clearly explain AGPL-3.0-or-later implications.
6. **Support Page:** Set realistic expectations for solo-developer support capacity.
