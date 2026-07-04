# Strata Motion System Audit

## Executive Summary

Strata already has a foundational motion subsystem, but it is fragmented,
incomplete, and not yet competitive with modern tools. The architecture treats
motion as a document-level timeline system, which is the correct long-term
direction, but the sampling, playback, and rendering integration are missing
essential features such as fill modes, playback direction, looping, and robust
property interpolation.

This audit identifies the current state, research-backed gaps, and an
incremental roadmap to build a professional motion system without architectural
rewrites.

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
| Editor playback controls | `packages/editor/src/context.tsx`, `TimelinePanel.tsx` | Built |
| Canvas rendering integration | `packages/editor/src/CanvasArea.tsx` | Partial |
| Prototype transitions | `packages/prototype/src/transitions.ts` | Built |
| Prototype animation (simple) | `packages/prototype/src/animation.ts` | Built |
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
- **Shared easing module**: `@strata/shared` provides a reusable easing function
  registry used by both the timeline sampler and prototype transitions.

### 1.3 Existing Problems

#### A. Timeline sampler is incomplete

`packages/editor/src/timeline/TimelineSampler.ts` only supports a single
progress value [0, 1]. It ignores:

- `FillMode` (`none`, `forwards`, `backwards`, `both`) declared in
  `motion-types.ts`.
- `PlaybackDirection` (`normal`, `reverse`, `alternate`, `alternate-reverse`).
- `defaultIterations` and looping.
- `autoReverse`.
- Discrete interpolation (`InterpolationStrategy` includes `'discrete'` but is
  unused).
- Spatial bezier interpolation (`spatialTangents` exist but are unused).
- Color interpolation.
- Affine/transform interpolation.

Evidence:

```@/home/karthur/CodingProjects/Strata/packages/editor/src/timeline/TimelineSampler.ts:39-57
  const duration = timeline.duration > 0 ? timeline.duration : 1;
  const progress = Math.max(0, Math.min(currentTime / duration, 1));

  for (const track of timeline.tracks) {
    if (track.enabled === false || track.keyframes.length === 0) continue;

    const val = interpolateTrack(track.keyframes, progress, timeline.defaultEasing);
```

#### B. Timeline engine does not actually loop

`TimelineEngine` has an `iterations` config and a `loop` flag in the UI, but
finishing logic clamps to the end and stops. The `loop` state is never checked
in `_checkFinish()`.

Evidence:

```@/home/karthur/CodingProjects/Strata/packages/editor/src/timeline/TimelineEngine.ts:150-161
  private _checkFinish(): boolean {
    if (this._currentTime >= this._config.duration) {
      const maxIter = this._config.iterations ?? 1;
      const isLastIter = this._currentTime >= maxIter - 1;
      if (isLastIter && maxIter !== Infinity) {
        this._state = 'finished';
        if (this._onFinish) this._onFinish();
        return true;
      }
    }
    return false;
  }
```

The `isLastIter` check is also wrong: it compares `currentTime` against
`maxIter - 1` instead of `currentIteration`.

#### C. Canvas motion integration is fragile

`CanvasArea.tsx` only applies timeline overrides when `currentTime > 0`, so a
keyframe at progress 0 is invisible while the playhead is at the start. It also
has no fill-mode handling and dot-notation path parsing is broken for array
indices like `transform[4]`.

Evidence:

```@/home/karthur/CodingProjects/Strata/packages/editor/src/CanvasArea.tsx:461-482
  if (s.motion.activeTimelineId && s.motion.currentTime > 0) {
    const sample = sampleTimelineAt(doc, s.motion.activeTimelineId, s.motion.currentTime);
    ...
    for (const [prop, val] of props) {
      const segments = prop.split('.');
      if (segments.length === 1) {
        (fn as unknown as Record<string, unknown>)[prop] = val;
      } else {
        const head = segments[0]!;
        const tail = segments.slice(1).join('.');
        (fn as unknown as Record<string, unknown>)[head] = {
          ...((fn as unknown as Record<string, unknown>)[head] as Record<string, unknown>),
          [tail]: val,
        };
      }
    }
  }
```

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

#### H. No animation export

`packages/codegen` can export static SVG/React, but it does not export
keyframes, timelines, CSS animations, or Lottie.

#### I. Reduced-motion support is isolated

Prototype transitions have accessibility helpers (`prefersReducedMotion`), but
timeline playback does not query or respect it.

#### J. Performance risks

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

- Extend `interpolateValue` in `@strata/shared` to support colors (OKLCH),
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
4. Add color interpolation to `@strata/shared`.
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

### Phase 1 core timing model (this session)

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

### Verification

- Targeted motion tests: 54/54 passed.
- `pnpm audit:emoji`: clean.
- `pnpm audit:tokens`: 93/93 pass.
- `pnpm --filter @strata/editor test`: 615/624 passed; 9 failures are
  pre-existing in `colorCollections.test.ts` (unrelated to motion).
- `pnpm typecheck`: pre-existing errors in `scene/styles.test.ts`,
  `editor/SpecReadouts.tsx`, `editor/FillSection.tsx`, `import/svg.ts`,
  `prototype/variables.ts` unrelated to motion.

## 11. Conclusion

Strata's motion foundation is in the right place architecturally. This session
completed the core timing model in the sampler and engine, fixed the rendering
integration, and added robust interpolation. These changes are incremental,
testable, and unlock most near-term motion use cases without rewriting the
document model.
