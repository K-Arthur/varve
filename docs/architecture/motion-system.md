# Motion System Architecture

Motion is a first-class document capability in Varve. Animation data lives on `Document`; playback and prototype runtime are editor facades that sample timelines without mutating undo history.

Framework evaluation and adoption boundaries are documented in
[`motion-framework-evaluation.md`](./motion-framework-evaluation.md). Varve
borrows GSAP's sequencing/lifecycle ideas and Remotion's deterministic
frame-addressable rendering contract without adding either as a required
runtime dependency.

## Document Model (v1.6)

```
Document
  ├── timelines: Record<string, Timeline>
  ├── activeTimelineId?: string
  ├── interactions: Record<NodeId, DocumentInteraction[]>   (v1.6)
  ├── motionPresets?: Record<string, MotionPreset>
  ├── motionExtensions?: Record<string, MotionExtension>    (Phase 5+ types only)
  ├── stateMachines?: Record<string, StateMachine>
  └── variableStore?: VariableStore
```

### Timeline

- **Tracks** target `nodeId` + dot-notation `property` paths
- **Keyframes** use `progress` (0–1), typed `value`, per-keyframe `easing`, optional `spatialTangents`
- **Playback defaults**: fill mode, direction, iterations, autoReverse (WAAPI-aligned)
- **Markers**: `TimelineMarker[]` for named progress points on the ruler
- **Composite ops**: `replace` | `add` | `accumulate` when multiple tracks target one property

### Interactions (v1.6)

Persisted prototype wiring in `packages/scene/src/interactions.ts`. Structurally compatible with `@varve/prototype` `Interaction` at runtime. Loaded via `createRuntimeFromDocument()`.

### Motion Presets

Reusable motion styles captured from timelines (`createMotionPreset` / `removeMotionPreset` in `motion.ts`). Parallel to `TextStyle` / `EffectStyle`.

### State Machines

`SMState.timelineId` links interactive states to document timelines. Editor RAF loop advances `SMRuntime` via `advanceSMTransition` and syncs `activeTimelineId` when the bound timeline changes.

## Editor Architecture

```
MotionFacade
  ├── TimelineEngine (RAF)
  ├── TimelineSampler → property overrides (Oklab colors, path morph, composite)
  └── callbacks → patch motion.currentTime + canvas redraw

CanvasArea.drawContent
  └── sampleTimelineAt(doc, activeTimelineId, currentTime)
      └── applyPropertyPath → buildIr → replayIr

PrototypePresenter
  └── PrototypeScreenView (hotspots + hit-test nodeId)
      └── createRuntimeFromDocument(doc)
      └── usePrototypeTransition — dissolve/slide/push/smart-animate screen transitions
      └── smartAnimateBridge on navigate (layer name matching)

Inspector (prototype mode)
  ├── InteractionSection — per-node interaction CRUD
  └── PrototypeFlowView — BFS flow graph of frame screens
```

## Key Files

| Layer | Path |
|---|---|
| Types | `packages/scene/src/motion-types.ts` |
| CRUD | `packages/scene/src/motion.ts` |
| Interactions | `packages/scene/src/interactions.ts` |
| Sampler | `packages/editor/src/timeline/TimelineSampler.ts` |
| Playback | `packages/editor/src/timeline/TimelineEngine.ts` |
| Facade | `packages/editor/src/motion/MotionFacade.ts` |
| Prototype bridge | `packages/editor/src/motion/prototypeRuntime.ts` |
| Smart Animate | `packages/prototype/src/smartAnimate.ts`, `editor/motion/smartAnimateBridge.ts` |
| SM bridge | `packages/editor/src/motion/stateMachineBridge.ts` |
| Export (CSS/Lottie) | `packages/codegen/src/animation-*.ts` |
| Export (UI) | `packages/editor/src/components/Export/ExportDialog.tsx` |
| Video export (UI) | `packages/editor/src/components/Export/ExportDialog.tsx` |
| Video export bridge | `packages/editor/src/motion/videoExportBridge.ts` |
| Interactive export | `packages/codegen/src/animation-interactive.ts` |
| Prototype transitions | `packages/editor/src/components/Prototype/usePrototypeTransition.ts` |
| Benchmark | `packages/engine/src/motion.bench.test.ts` |

## Rendering Integration

Overrides are applied to flattened engine nodes **before** `buildIr` (ADR-0001). `motion.currentTime`, `motion.isPlaying`, and `motion.activeTimelineId` are `drawContent` dependencies for live playback.

Sampler cache: `invalidateSamplerCache()` is called on timeline mutations; keyframe segment cache keys include track fingerprint to avoid stale reads.

## Onion skin rendering

`OnionSkinOverlay` draws previous/next-frame ghosts while the workspace is in `'motion'` mode:

- Reads onion-skin state from `state.motion` (`onionSkinEnabled`, `onionSkinBeforeCount`, `onionSkinAfterCount`, `onionSkinOpacity`).
- For each ghost time, `sampleTimeline` produces `Map<nodeId, Map<property, value>>` overrides.
- `sceneNodeToEngineNode` converts scene nodes to the engine's `SceneNode` contract; overrides and the computed world transform are applied.
- `await createEngine('stub')` + `buildIr` produce render IR, which is replayed through a tinted `ReplayTarget` for translucent before/after frames.

## Interpolation (Phase 3)

| Strategy | Implementation |
|---|---|
| Color | Oklab (`interpolateColorOklch` in `@varve/shared/interpolation.ts`) |
| Affine | 6-element array lerp |
| Path | `ensureVertexMatch` + `interpolatePath` when `interpolation: 'path'` (now creatable via `addTrack` opts) |
| Text | String discrete midpoint on `text` / `text.*` property paths |
| Spatial | `spatialTangents` + `interpolateSpatialBezier` |

### Solo/Muted Tracks

The sampler respects `track.muted` and `track.solo`: if any track in a timeline is solo, only solo tracks are evaluated. Muted tracks are always skipped.

### Nested Timelines

Nested timeline evaluation during playback passes the full `Document` to `sampleTimeline`, enabling nested timeline resolution in the playback path (not just static sampling).

### Duration-0 Safety

`TimelineEngine._advanceTime` returns immediately when `duration <= 0`, preventing infinite loops on empty timelines.

## Export (Phase 4)

- **ExportDialog** exposes per-timeline CSS keyframes, Lottie JSON, SVG animate, and MP4/WebM video (WebCodecs + `mp4-muxer` / `webm-muxer`).
- **videoExport.ts** — `exportTimelineToVideo()` with injected frame renderer; `videoExportBridge.ts` wires `sampleTimelineAt` → `buildIr` → `replayIr` on OffscreenCanvas.
- **animation-interactive.ts** — exports `Document.interactions` to React event handlers and optional CSS scroll bindings (`useScrollTimeline` partial).
- Reduced-motion video export: single final frame when `prefers-reduced-motion` is active.

## Video export (complete)

- **WebCodecs path**: `exportTimelineToVideo()` in `packages/engine/src/videoExport.ts` encodes frames via `VideoEncoder`, muxes with `mp4-muxer` / `webm-muxer`.
- **Frame renderer**: `videoExportBridge.ts` samples timeline → `buildIr` → `replayIr` on OffscreenCanvas per frame.
- **UI**: ExportDialog motion section lists per-timeline MP4/WebM buttons when timelines exist and WebCodecs is available.
- **E2E**: `tests/e2e/motion/video-export.spec.ts` (skipped when `VideoEncoder` unavailable).

Video export is frame-addressable: frame `i` at `fps` is sampled at
`i * 1000 / fps` milliseconds. The sample time is not derived from the final
frame count, so the renderer and encoder share one deterministic clock.

## Prototype screen transitions (complete)

- **usePrototypeTransition** — hook coordinating transition kind, duration, easing, and Smart Animate layer overrides between prototype screens.
- Wired in `PrototypePresenter` / `PrototypeScreenView` for present mode navigation.
- Per-layer Smart Animate via `computeSmartAnimateHotspotOverrides` + `smartAnimateBridge`.

## Extension Points (Phase 5 — types only)

Reserved in `motion-types.ts`, not yet implemented:

| Type | Purpose |
|---|---|
| `MotionExtension` / `MotionExtensionKind` | skeleton, bone, IK, mesh deform, path constraint |
| `NestedTimelineRef` | Lottie pre-comp style nested timelines — **proof slice implemented** |
| `AudioSyncTrack` | Timeline-aligned audio |
| `CollaborativeKeyframeLock` | Multiplayer keyframe editing stub |

## Deprecated

`@varve/prototype/animation.ts` standalone timeline model — use `Document.timelines` instead.

## Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Alt+T` | Toggle timeline panel |

## Phase C — Timeline UX (complete)

- Marker CRUD on ruler (double-click add, context menu rename/delete)
- Motion preset save/apply from timeline panel
- Auto-keyframe toggle (Diamond icon) inserts keyframes at playhead during playback
- Spec panel motion summary with export hash

## Tests

| Area | File |
|---|---|
| MotionFacade | `packages/editor/src/motion/MotionFacade.test.ts` |
| Playback integration | `packages/editor/src/motion/playback-integration.test.ts` |
| Prototype wiring | `packages/editor/src/motion/prototype-integration.test.ts` |
| Smart Animate | `packages/prototype/src/smartAnimate.test.ts` |
| Interactions CRUD | `packages/scene/src/interactions.test.ts` |
| Motion presets | `packages/scene/src/motion-presets.test.ts` |
| Sampler | `packages/editor/src/timeline/TimelineSampler.test.ts` |
| Shell timeline | `packages/editor/src/Shell.motion.test.tsx` |
| Auto-keyframe | `packages/editor/src/motion/autoKeyframe.test.ts` |
| Timeline ruler | `packages/editor/src/timeline/TimelineRuler.test.tsx` |
| E2E playback | `tests/e2e/motion/timeline-playback.spec.ts` |
| E2E video export | `tests/e2e/motion/video-export.spec.ts` |
| Benchmark | `packages/engine/src/motion.bench.test.ts` |
