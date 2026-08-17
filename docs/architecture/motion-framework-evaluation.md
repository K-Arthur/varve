# Motion Framework Evaluation

Status: accepted architecture decision, 2026-08-17

Varve evaluated GSAP and Remotion as references and possible dependencies for
the motion, prototype, and export systems. The decision is to adopt their
useful contracts without making either library authoritative for Varve
documents.

## Decision

Varve keeps these responsibilities in its own packages:

- `@varve/scene` owns persistent timelines, keyframes, markers, and prototype
  definitions.
- `TimelineSampler` is the deterministic evaluator. A document and an exact
  time produce the same evaluated overrides without mutating the document.
- `TimelineEngine` owns interactive playback only. It is a clock driver, not a
  second animation model.
- Video export uses an explicit frame index and frame rate. A frame is sampled
  at `frameIndex * 1000 / fps`, independent of render speed or encoder timing.
- The canvas, native engine, WASM engine, and export paths consume the same
  evaluated scene representation.

Neither GSAP nor Remotion should be added as a required runtime dependency.

## GSAP Findings

GSAP provides strong authoring and playback concepts that are relevant to
Varve:

- timelines as containers for child animations;
- absolute and relative positioning of children;
- labels for named time locations;
- nested timelines with local playheads;
- `play`, `pause`, `reverse`, `seek`, `timeScale`, and repeat/yoyo controls;
- lifecycle cleanup through `gsap.context()` in DOM/React integrations;
- ticker lag policy for interactive playback.

Varve already has equivalents for several of these concepts: tracks and
nested timelines, timeline markers, playback direction, iterations, and a
coordinated editor frame scheduler. Markers should remain the persisted label
primitive rather than importing GSAP's label representation.

GSAP should not own Varve scene animation because its core abstraction mutates
targets and is optimized for JavaScript objects and DOM targets. That would
duplicate `Document` state, bypass the IR replay pipeline, complicate undo and
serialization, and make native/WASM parity harder. GSAP's global ticker would
also compete with Varve's frame scheduler.

Potential future use: an optional, editor-only adapter for DOM presentation
microinteractions, provided it never writes document values and is cleaned up
with a scoped lifecycle. It must not be used for canvas playback, export, or
prototype state transitions.

## Remotion Findings

Remotion provides useful media-rendering contracts:

- compositions are functions of an explicit frame number;
- `Sequence` provides local time offsets for nested compositions;
- `interpolate()` maps a frame/time input to a value with explicit extrapolation;
- `spring()` is evaluated from frame number plus an explicit FPS;
- rendering can request individual frames or ranges;
- frame rendering is independent of wall-clock playback and can therefore be
  deterministic or parallelized.

These concepts directly reinforce Varve's architecture. `sampleTimelineAt`
already provides the pure evaluator, and the video exporter now uses an exact
frame clock rather than deriving sample time from the number of frames being
rendered. Nested timelines should continue to use local progress, analogous
to `Sequence` offsets.

Remotion itself should not be embedded in Varve's editor or export path:

- its React composition/runtime model is not the scene/IR model used by Varve;
- it would add a second renderer and asset lifecycle;
- its current license is source-available and proprietary, with company
  licensing requirements for some automation use cases;
- it assumes a rendering toolchain that is not shared by the Tauri native
  application and browser/WASM facade.

Varve may study Remotion's frame-range and slow-frame reporting patterns when
improving export diagnostics, but those features should be implemented in
Varve's own engine package.

## Adopted Improvements

### Frame-addressable export

For a valid FPS value, frame `i` is sampled at:

```text
timeMs = i * 1000 / fps
timestampUs = i * 1_000_000 / fps
```

The renderer and encoder use the same frame index. This avoids a mismatch in
which the last rendered frame is sampled at the timeline endpoint while its
encoded timestamp is still one frame earlier.

### Single playback clock

Interactive playback remains RAF-driven, but evaluation is still time-based.
The RAF timestamp advances `TimelineEngine`; it does not define animation
semantics. Export never uses RAF and never depends on render completion speed.

### Local timeline composition

Nested timelines retain local time/progress and are resolved by the canonical
sampler. Any future sequence/clip UI should compile to ordinary nested
timeline data rather than introduce a framework-specific runtime object.

### Export diagnostics

Future export work should expose frame count, frame rate, frame ranges, and the
slowest rendered frames. These are diagnostics around Varve's renderer, not a
reason to adopt a second rendering stack.

## Sources

- [GSAP timelines](https://gsap.com/docs/v3/GSAP/gsap.timeline/)
- [GSAP ticker](https://gsap.com/docs/v3/GSAP/gsap.ticker/)
- [GSAP context](https://gsap.com/docs/v3/GSAP/gsap.context/)
- [GSAP standard license](https://gsap.com/community/standard-license/)
- [Remotion `useCurrentFrame`](https://www.remotion.dev/docs/use-current-frame)
- [Remotion `interpolate`](https://www.remotion.dev/docs/interpolate)
- [Remotion `Sequence`](https://www.remotion.dev/docs/sequence)
- [Remotion renderer](https://www.remotion.dev/docs/renderer)
- [Remotion license and terms](https://www.remotion.dev/docs/license)
