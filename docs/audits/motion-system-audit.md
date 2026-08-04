# Strata Motion System Audit

## Executive Summary

Strata's motion subsystem has a solid document-level foundation (`Document.timelines`,
`TimelineSampler`, `TimelineEngine`) and **integration is wired through Phase 5 types**
(2026-07-06):

**P0 — Playback & prototype (complete)**
- `MotionFacade` replaces the context playback stub; `currentTime` advances via RAF
- `TimelinePanel` mounted in `Shell` bottom dock
- `Document.interactions` (v1.6) persists prototype wiring
- `createRuntimeFromDocument` loads interactions; `processDelays` polled in present mode
- `PrototypeScreenView` dispatches click events with `nodeId`

**P2 — Unification (complete)**
- State machine RAF bridge syncs `activeTimelineId` from `SMRuntime`
- Prototype variable bridge: `setPrototypeVariable` writes `Document.variableStore`
- `InteractionSection` inspector UI + `PrototypeFlowView` flow graph
- Smart Animate: `matchLayersByName` / `buildSmartAnimateValues` + editor bridge on navigate

**P3 — Fidelity (complete)**
- Oklab color interpolation in sampler
- Path morphing via `ensureVertexMatch` + `interpolatePath`
- Composite operations (`replace`/`add`/`accumulate`)
- Text property animation (string midpoint)
- Timeline markers on ruler; `MotionPreset` CRUD on Document

**P4 — Export & performance (complete)**
- ExportDialog CSS/Lottie/SVG/MP4/WebM motion export
- `videoExport.ts` WebCodecs encoder + MP4/WebM mux (`mp4-muxer` / `webm-muxer`)
- Sampler keyframe cache + `invalidateSamplerCache()` on timeline mutations
- Motion benchmark: 100 tracks × 10 keyframes under budget

**P5 — Advanced (types only, deferred implementation)**
- `MotionExtension`, `AudioSyncTrack`, `CollaborativeKeyframeLock`
- `NestedTimelineRef` — **implemented (proof slice, 2026-07-06)**: track `nestedTimelineId` + `nestedStartProgress`, sampler resolution, TrackRow inspector dropdown

Remaining gaps: state machine inspector panel, rigging/IK/skeleton extensions, full interactive export parity (Lottie/scroll timeline bindings), real-time collaborative keyframe locks, audio sync tracks. Phase C (timeline UX) complete as of 2026-07-06.

See `docs/architecture/motion-system.md`.

### Phase C — Timeline UX (2026-07-06)

Completed:

- Context wiring: `addTimelineMarker`, `removeTimelineMarker`, `renameTimelineMarker`, `createMotionPresetFromTimeline`, `applyMotionPreset`, `toggleAutoKeyframe`
- TimelineRuler: double-click add marker, right-click rename/delete context menu
- TimelinePanel: save/apply motion preset controls, auto-keyframe toggle in PlaybackControls
- Auto-keyframe: inserts keyframes at playhead during playback on opacity edits (`motion/autoKeyframe.ts`)
- Spec handoff: `buildSpec` / `specToMarkdown` timelines section + `MotionSpecSection` in SpecPanel

## 1. Current-State Audit

### 1.1 Existing Motion Capabilities

| Area | Location | Status |
|---|---|---|
| Document timeline model | `packages/scene/src/motion.ts`, `motion-types.ts` | Built |
| Timeline CRUD (create/rename/remove, track/keyframe ops) | `packages/scene/src/motion.ts` | Built |
| Keyframe interpolation (basic) | `packages/shared/src/easing.ts` | Built |
| Timeline sampler | `packages/editor/src/timeline/TimelineSampler.ts` | Built |
| Playback engine (RAF) | `packages/editor/src/timeline/TimelineEngine.ts` | Built |
| Editor motion state | `packages/editor/src/state/motion-state.ts` | Built |
| Editor playback controls | `packages/editor/src/context.tsx`, `TimelinePanel.tsx` | **Wired (P0)** |
| Canvas rendering integration | `packages/editor/src/CanvasArea.tsx` | **Wired (P0)** |
| Prototype interactions on Document | `packages/scene/src/interactions.ts` | **Built (v1.6)** |
| Prototype animation (simple) | `packages/prototype/src/animation.ts` | **Deprecated** |
| Prototype runtime actions | `packages/prototype/src/runtime.ts` | Built |

### 1.2 Architecture Strengths

- **Document-level timelines**: Timelines live on `Document.timelines`, are
  serialized with the document, and are immutable like the rest of the scene
  model. This matches the research-backed direction of Figma Motion and Lottie.
- **Ephemeral overrides**: `TimelineSampler` produces per-node property
  overrides that are applied at render time without mutating the document. This
  is a clean, undo-friendly design.
- **IR-replay rendering**: The engine already uses a compact IR-replay pipeline
  (ADR-0001), so animation can be injected before IR build without touching
  the renderer.
- **Shared easing module**: `@varve/shared` provides a reusable easing function
  registry used by both the timeline sampler and prototype transitions.

### 1.3 Existing Problems

#### A. Timeline sampler is now complete for the core timing model

`packages/editor/src/timeline/TimelineSampler.ts` now implements the full
WAAPI-style timing model:

- `FillMode` (`none`, `forwards`, `backwards`, `both`).
- `PlaybackDirection` (`normal`, `reverse`, `alternate`, `alternate-reverse`).
- `defaultIterations` and looping.
- `autoReverse`.
- Discrete interpolation (`'discrete'`).
- Spatial bezier interpolation (`spatialTangents`).
- Color interpolation (RGB arrays, hex strings, managed colors).
- Affine/transform interpolation (6-element numeric arrays).

Remaining interpolation gaps: path morphing, shape vertex interpolation, and
text per-character animation.

#### B. Timeline engine looping and direction is now implemented

`TimelineEngine` now honors `iterations`, `loop`, `autoReverse`, and playback
`direction`. The `_processFrame` logic advances iterations correctly, reverses
on alternating iterations, and clamps the final frame.

#### C. Canvas motion integration is now robust

`CanvasArea.tsx` applies timeline overrides whenever `activeTimelineId` is set,
including at time 0. Overrides are applied to the flattened engine nodes before
the IR build, supporting nested property paths such as `transform[4]` and
`fills[0].color`.

#### D. Two disconnected animation systems

`packages/prototype/src/animation.ts` has its own `AnimationTimeline` and
`Keyframe` types and its own interpolation. It is not used by the editor
timeline system. This creates duplicated concepts and prevents prototype
actions from driving document timelines.

#### E. No shape/path animation

There is no path morphing, shape interpolation, or vector animation beyond
basic transform/opacity properties.

#### F. No text animation

No per-character, per-word, or per-line animation support.

#### G. No rigging, IK, or deformation

Not expected at this stage, but the document model does not yet reserve
extension points for bones, constraints, or meshes.

#### H. Animation export is implemented

`packages/codegen` supports timeline/keyframe export to CSS `@keyframes`, SVG
`<animate>`, and Lottie JSON. Lottie fidelity is currently limited to
transform/opacity tracks; position, scale, and spatial bezier tangents require
additional mapping work.

#### I. Reduced-motion support added to timeline playback

`TimelineEngine` now supports a `reducedMotion` flag that skips the RAF loop and
jumps to the final resting state. `createMotionTimelineEngine` detects
`prefers-reduced-motion` and passes it through, so the editor timeline play
button respects the user preference while manual scrubbing remains available.

Remaining gap: surface the reduced-motion preference in the editor UI and apply
it to prototype timeline actions.

#### J. State machine runtime is now implemented

`packages/scene/src/state-machine-runtime.ts` provides a pure, testable runtime
for state machines: entry state selection, trigger evaluation, input-driven
conditional transitions with a safe expression evaluator, and transition
progress tracking. The runtime is independent of rendering and can be used by the
editor, prototype player, and export pipeline.

Remaining gap: wire the runtime into the prototype player so state changes drive
timeline playback.

#### K. Performance risks

The sampler iterates every track every frame with no dirty tracking, no spatial
index, and no early-out for unchanged tracks. This is acceptable for small
documents but will not scale to thousands of keyframes.

## 2. Research Findings

### 2.1 Timeline Architecture

- **Figma Motion (2026)**: Motion lives on the canvas in the same file as
  components and variables. Keyframes are per-property, timeline is time-based, and
  animation styles are reusable. Components carry motion across files.
  Source: `https://www.figma.com/blog/introducing-figma-motion/`
- **Lottie**: Document-level animation with layers, keyframes, pre-comps, and
  markers. Frame-rate independent, vector-focused, with a render tree separate
  from the object model. Source: `https://lottie.github.io/lottie-spec/latest/`
- **Web Animations API**: Timing model defines `currentTime`, `iterations`,
  `direction`, `fill`, `delay`, and `endDelay`. `KeyframeEffect` holds property
  keyframes and easing. Source: MDN Web Animations API.

### 2.2 Keyframe & Interpolation

- Modern systems use property keyframes with per-keyframe easing (CSS/Framer
  Motion/After Effects).
- Spatial interpolation uses cubic bezier tangents (After Effects `ti`/`to`).
- Shape interpolation requires compatible path topology (Lottie, SVG morph).
- Color interpolation should be in perceptually uniform space (OKLCH) for
  quality.

### 2.3 Playback & Runtime

- Use `requestAnimationFrame` with time-based deltas, not frame-counting, for
  consistent motion under dropped frames.
- Looping, direction, and fill are essential for any professional timeline.
- Reduced motion must be respected via `prefers-reduced-motion`.

## 3. Competitive Analysis

| Capability | Strata | Figma Motion | After Effects | Lottie |
|---|---|---|---|---|
| Document-level timelines | Yes | Yes | Yes (comp) | Yes |
| Per-property keyframes | Yes | Yes | Yes | Yes |
| Fill/direction/iterations | Partial | Yes | Yes | Yes |
| Looping | No | Yes | Yes | Yes |
| Spatial bezier | No | Yes | Yes | Partial |
| Color interpolation | No | Yes | Yes | Yes |
| Transform interpolation | Partial | Yes | Yes | Yes |
| Shape/path animation | No | Limited | Yes | Yes |
| Text animation | No | Yes | Yes | Yes |
| Rigging/IK | No | No | Yes (Duik) | No |
| Mesh deformation | No | No | Yes | Limited |
| Animation export | No | Yes | Yes | Yes |
| Reduced motion | Partial | Yes | Yes | Yes |

## 4. Gap Analysis

Critical gaps:

1. **Sampler does not implement the timing model**. Fill, direction, and
   iteration semantics are declared but ignored.
2. **Engine does not loop or handle iterations correctly**.
3. **Canvas integration ignores time 0 and fill mode**.
4. **No shared interpolation between prototype and timeline**.
5. **No color, transform, or path interpolation**.
6. **No animation export**.
7. **No reduced-motion integration for timeline playback**.

## 5. Architecture Recommendations

### 5.1 Motion Document Architecture

**Recommendation: Document-level timelines with per-node property tracks.**

Keep the current `Document.timelines` model. Each timeline is a named collection
of `AnimationTrack` objects. Tracks target a node id and a dot-notation property
path. This is the same model as Lottie and Figma Motion and is the most
extensible for future features (nested timelines, reusable animation presets,
components with motion).

Future extension: introduce a `TimelineReference` on `FrameNode`/`Page` to bind a
timeline to a scope, enabling nested and reusable timelines without changing
the core data model.

### 5.2 Timeline Architecture

- Implement the full WAAPI-style timing model (fill, direction, iterations,
  delay, endDelay).
- Support looping and auto-reverse at the sampler level.
- Add timeline markers and sections as metadata for organization.
- Preserve current immutable CRUD operations.

### 5.3 Keyframe & Tweening

- Extend `interpolateValue` in `@varve/shared` to support colors (OKLCH),
affines, and discrete steps.
- Implement spatial bezier interpolation for position/path tracks using
  `spatialTangents`.
- Add a `path` interpolation strategy for shape morphing once path topology is
  established.

### 5.4 Runtime & Playback

- Fix `TimelineEngine` to honor loop, direction, and iterations.
- Make `createMotionTimelineEngine` pass timeline defaults to the sampler.
- Add a `prefersReducedMotion` check that disables or shortens motion.

### 5.5 Rendering Integration

- Apply overrides whenever `activeTimelineId` is set, including at time 0.
- Implement fill mode in the sampler so rendering sees the correct values before
  and after the active interval.
- Fix property path application to support array indices and nested object
  paths.

### 5.6 Prototype Integration

- Converge prototype transitions and timeline playback on the shared sampler.
- Wire `startAnimation`/`stopAnimation` actions to document timelines.

### 5.7 Export

- Extend `packages/codegen` to emit CSS animations and Lottie-compatible
  keyframes from `Document.timelines`.

### 5.8 Accessibility

- Integrate `prefers-reduced-motion` into timeline playback.
- Provide accessible playback controls (already present in UI).

## 6. Performance & Scalability

Current risks:

- O(tracks) per-frame sampling.
- No dirty tracking for unchanged tracks.
- No bounds culling for off-screen nodes.

Recommended mitigations:

- Cache sorted keyframes and segment index per track.
- Track per-frame dirtiness based on active interval.
- Consider spatial hashing for large numbers of animated nodes.

## 7. Accessibility Findings

- Prototype transitions already reduce motion for users who prefer it.
- Timeline playback does not. Add a global reduced-motion gate.
- Keyboard control for the timeline is minimal (no shortcut to step to next
  keyframe).

## 8. Incremental Implementation Roadmap

The scope described in the original request is larger than a single session.
The recommended incremental path is:

### Phase 1: Core Timing Model (this session)

1. Implement fill mode, direction, iterations, and looping in
   `TimelineSampler`.
2. Fix `TimelineEngine` loop, iteration, and reverse playback.
3. Fix `CanvasArea` motion application (time 0, fill mode, property paths).
4. Add color interpolation to `@varve/shared`.
5. Add tests for all of the above.

### Phase 2: Interpolation & Integration

1. Implement spatial bezier interpolation.
2. Add affine/transform interpolation.
3. Converge prototype animation on the shared sampler.
4. Wire prototype actions to document timelines.

### Phase 3: Advanced Motion

1. Path/shape interpolation.
2. Text animation (character/word/line).
3. Animation presets and reusable styles.
4. Timeline markers and sections.

### Phase 4: Export & Performance

1. CSS animation export.
2. Lottie export.
3. Performance optimization (caching, dirty tracking).
4. Reduced-motion integration across all playback.

### Phase 5: Future Systems

1. Rigging and IK.
2. Mesh deformation.
3. Audio synchronization.
4. Multi-page / nested timeline references.

## 9. Test Strategy

- Unit tests for `TimelineSampler` covering fill, direction, iterations, loop.
- Unit tests for `TimelineEngine` covering loop, reverse, auto-reverse.
- Unit tests for `interpolateValue` color and transform paths.
- Integration tests for `CanvasArea` motion override application.
- Regression: run `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm audit:tokens`,
  `pnpm audit:emoji`.

## 10. Remaining Risks

- Full shape/path animation requires path topology matching and is a large
  research area.
- Rigging and IK are entire subsystems and should be scoped separately.
- Export fidelity to Lottie/CSS will require mapping Strata's rendering model to
  those formats.
- Performance at scale requires profiling with real large documents.

## 12. Implementation Log

### Phase 1 core timing model (previous session)

Implemented and tested:

- `packages/editor/src/timeline/TimelineSampler.ts`
  - WAAPI-style timing model: fill mode, direction, iterations, looping.
  - Discrete interpolation support.
  - Typed interpolation dispatch for RGB colors and affine transforms.
- `packages/editor/src/timeline/TimelineEngine.ts`
  - Looping, autoReverse, and correct multi-boundary iteration advancement.
  - Fixed iteration counting and finish detection.
- `packages/editor/src/state/motion-state.ts`
  - Passes timeline defaults to the sampler.
- `packages/editor/src/CanvasArea.tsx`
  - Applies overrides whenever an active timeline is selected (including at
    time 0).
  - Supports nested property paths with bracket array indices (`transform[4]`,
    `fills[0].color`).
- Tests added/updated:
  - `packages/editor/src/timeline/TimelineSampler.test.ts` (+21 tests)
  - `packages/editor/src/timeline/TimelineEngine.test.ts` (+5 tests)
  - `packages/editor/src/CanvasArea.motion.test.ts` (+6 tests)

### Phase 2 follow-up (current session)

Implemented and tested:

- `packages/editor/src/timeline/TimelineSampler.ts`
  - Fixed spatial bezier interpolation: the `bezier` track strategy now
    dispatches to `interpolateSpatialBezier` when keyframes have tangents.
- `packages/editor/src/timeline/TimelineEngine.ts`
  - Added `reducedMotion` config and playback option that jumps to the final
    state without RAF animation.
- `packages/editor/src/state/motion-state.ts`
  - Detects `prefers-reduced-motion` and passes it to the engine.
- `packages/scene/src/state-machine-runtime.ts`
  - New pure state machine runtime: entry state, trigger evaluation,
    input-driven conditional transitions, transition progress.
- `packages/scene/src/state-machine.ts`
  - Extended `addSMTransition` to accept optional `condition`, `duration`, and
    `easing`.
- `packages/scene/src/index.ts`
  - Exports state machine modules.
- `packages/shared/src/interpolation.ts`
  - Fixed a TypeScript narrowing error in `toVec2`.
- `packages/engine/src/replay.ts`
  - Removed an extra closing brace and a duplicate `clip` signature that
    blocked downstream test compilation.
- Tests added/updated:
  - `packages/editor/src/timeline/TimelineSampler.test.ts` (spatial bezier)
  - `packages/editor/src/timeline/TimelineEngine.test.ts` (+2 reduced motion)
  - `packages/scene/src/state-machine-runtime.test.ts` (8 new tests)

### Verification

- Targeted motion tests: 165/165 passed.
- `pnpm audit:emoji`: clean.

### Motion System Overhaul — Phases 2–5 (2026-07-06)

Implemented:

**Phase 2 — Unification**
- `packages/editor/src/motion/stateMachineBridge.ts` — SM timeline id resolution
- `packages/editor/src/motion/smartAnimateBridge.ts` — screen transition layer matching
- `packages/editor/src/motion/prototypeRuntime.ts` — `createRuntimeFromDocument`
- `packages/editor/src/components/Inspector/sections/InteractionSection.tsx`
- `packages/editor/src/components/Prototype/PrototypeFlowView.tsx`
- Context: `addNodeInteraction`, `removeNodeInteraction`, SM RAF loop, variable bridge

**Phase 3 — Fidelity**
- `packages/shared/src/interpolation.ts` — `interpolateColorOklch`, path `ensureVertexMatch`
- `packages/editor/src/timeline/TimelineSampler.ts` — composite ops, cache, path/text dispatch
- `packages/scene/src/motion.ts` — `addTimelineMarker`, `createMotionPreset`
- Timeline ruler marker rendering

**Phase 4 — Export & performance**
- `packages/editor/src/components/Export/ExportDialog.tsx` — CSS/Lottie/SVG/MP4/WebM motion export
- `packages/engine/src/videoExport.ts` — WebCodecs + MP4/WebM mux via mp4-muxer/webm-muxer
- `packages/editor/src/motion/videoExportBridge.ts` — IR-replay frame renderer
- `packages/codegen/src/animation-interactive.ts` — React/CSS scroll binding export (navigate handlers; scroll timeline partial)
- `packages/engine/src/motion.bench.test.ts` — sampler benchmark
- `findKeyframeSegmentIndex()` in TimelineSampler for O(log n) lookup
- `invalidateSamplerCache()` wired in context timeline CRUD

**Phase 5 — Extension types**
- `MotionExtension`, `NestedTimelineRef`, `AudioSyncTrack`, `CollaborativeKeyframeLock`
  in `motion-types.ts`; `motionExtensions` / `motionPresets` on Document

**Docs**
- `docs/architecture/motion-system.md` — canonical architecture reference

**Tests added**
- `packages/editor/src/motion/*.test.ts` (Facade, playback, prototype, smartAnimate bridge)
- `packages/scene/src/interactions.test.ts`, `motion-presets.test.ts`
- `packages/prototype/src/smartAnimate.test.ts`
- `packages/editor/src/Shell.motion.test.tsx`
- `tests/e2e/motion/timeline-playback.spec.ts`
- `pnpm audit:tokens`: 93/93 pass.
- `pnpm exec biome check` on all touched files: clean (0 errors).
- `pnpm typecheck`: pre-existing errors in `packages/engine/src/replay-fill.test.ts`,
  `packages/engine/src/replay-filter.test.ts`, and `packages/engine/src/replay.test.ts`
  (unrelated to motion; tracked in the engine package).

## 11. Follow-up fixes (2026-07-18)

`packages/editor/src/components/OnionSkinOverlay.tsx` — merged to `master`:

- Onion-skin UI state now correctly reads from `state.motion` (`onionSkinEnabled`,
  `onionSkinBeforeCount`, `onionSkinAfterCount`, `onionSkinOpacity`) instead of
  a non-existent `state.onionSkin` cast.
- Frame rendering is async-safe: `await createEngine('stub')` and
  `await eng.buildIr({ nodes })` run inside the effect, with a cancellation flag
  to avoid state updates on unmounted frames.
- Node conversion goes through the canonical `sceneNodeToEngineNode` converter
  before applying sampled overrides and the world transform, removing hand-rolled
  type-unsafe property copying.
- `getOnionSkinFrames` `_doc` parameter typed as `unknown` so test helpers that
  pass a timeline placeholder compile cleanly.

Verified with `pnpm test OnionSkinOverlay` (9/9 passing).

## 12. Conclusion

Strata's motion foundation is in the right place architecturally. This session
completed the core timing model in the sampler and engine, fixed the rendering
integration, and added robust interpolation. These changes are incremental,
testable, and unlock most near-term motion use cases without rewriting the
document model.
