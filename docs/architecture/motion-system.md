# Motion System Architecture

Motion is a first-class document capability in Strata. Animation data lives on `Document`; playback and prototype runtime are editor facades that sample timelines without mutating undo history.

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

Persisted prototype wiring in `packages/scene/src/interactions.ts`. Structurally compatible with `@strata/prototype` `Interaction` at runtime. Loaded via `createRuntimeFromDocument()`.

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
| Interactive export stub | `packages/codegen/src/animation-interactive.ts` |
| Benchmark | `packages/engine/src/motion.bench.test.ts` |

## Rendering Integration

Overrides are applied to flattened engine nodes **before** `buildIr` (ADR-0001). `motion.currentTime`, `motion.isPlaying`, and `motion.activeTimelineId` are `drawContent` dependencies for live playback.

Sampler cache: `invalidateSamplerCache()` is called on timeline mutations; keyframe segment cache keys include track fingerprint to avoid stale reads.

## Interpolation (Phase 3)

| Strategy | Implementation |
|---|---|
| Color | Oklab (`interpolateColorOklch` in `@strata/shared/interpolation.ts`) |
| Affine | 6-element array lerp |
| Path | `ensureVertexMatch` + `interpolatePath` when `interpolation: 'path'` |
| Text | String discrete midpoint on `text` / `text.*` property paths |
| Spatial | `spatialTangents` + `interpolateSpatialBezier` |

## Export (Phase 4)

- **ExportDialog** exposes per-timeline CSS keyframes, Lottie JSON, SVG animate, and MP4/WebM video (WebCodecs + `mp4-muxer` / `webm-muxer`).
- **videoExport.ts** — `exportTimelineToVideo()` with injected frame renderer; `videoExportBridge.ts` wires `sampleTimelineAt` → `buildIr` → `replayIr` on OffscreenCanvas.
- **animation-interactive.ts** — stub export of `Document.interactions` to React/CSS scroll bindings.
- Reduced-motion video export: single final frame when `prefers-reduced-motion` is active.

## Extension Points (Phase 5 — types only)

Reserved in `motion-types.ts`, not yet implemented:

| Type | Purpose |
|---|---|
| `MotionExtension` / `MotionExtensionKind` | skeleton, bone, IK, mesh deform, path constraint |
| `NestedTimelineRef` | Lottie pre-comp style nested timelines |
| `AudioSyncTrack` | Timeline-aligned audio |
| `CollaborativeKeyframeLock` | Multiplayer keyframe editing stub |

## Deprecated

`@strata/prototype/animation.ts` standalone timeline model — use `Document.timelines` instead.

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
| E2E | `tests/e2e/motion/timeline-playback.spec.ts` |
| Benchmark | `packages/engine/src/motion.bench.test.ts` |
