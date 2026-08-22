# Paint System

**Status:** Implemented; see Limitations for what is not
**Updated:** 2026-08-20

## Scope

This describes how a pointer stroke becomes document pixels in Varve, and the
invariants the paint subsystem holds. It covers the raster brush, eraser,
smudge, Clone Stamp, Healing Brush, grain, wet media, symmetry and the brush
library. Vector pressure is covered only where it shares behaviour with the
raster path.

Documented behaviour here has been exercised by the tests named in each
section. Anything not yet implemented is listed under Limitations rather than
described as if it ships.

## Pipeline

```
Pointer / stylus input
        │  normalizePressure / normalizeTilt   (tools/pointerDynamics.ts)
        ▼
PaintStrokeSession                             (tools/PaintTool.ts)
  identity, frozen preset, colour, alpha lock,
  area selection, history transaction
        │
        ▼
Symmetry transforms → one engine stroke per branch   (tools/symmetry.ts)
        │
        ▼
BrushWorkerHost                                (render/brushWorkerHost.ts)
  incremental dispatch, bounded lossless queue,
  cancellation, replay-based fallback
        │
        ├── worker ──► brushWorker.ts ─┐
        └── main thread ───────────────┤ both run
                                       ▼
                        scene/strokeEngine.ts   (the only dab algorithm)
                                       │
                                       ▼
                        Paint target resolver   (tools/paintTarget.ts)
                                       │
                                       ▼
                        Selection coverage      (tools/selectionCoverage.ts)
                                       │
                                       ▼
                        Canonical compositor    (scene/rasterLayer.ts)
                          coverage × alpha lock × blend × grain
                                       │
                                       ▼
                        Raster tiles → history → dirty rect → render
```

Wet media and the retouch tools attach to the same compositor rather than
running beside it:

```
WetPaintManager  ◄──►  PaintTool.mixWet        (scene/wetPaintManager.ts)
       ▲
WetPaintScheduler — runs only while wet        (render/wetPaintScheduler.ts)

Clone / Heal  ──►  scene/retouchRaster.ts  ──►  same tip mask, coverage,
                                                 alpha lock and history
```

## Invariants

### One dab algorithm

`scene/strokeEngine.ts` is the only implementation of "given these samples,
what dabs does this brush produce?". The worker and the main thread both call
it, so parity is a property of the code rather than something tests police
afterwards. `brushDispatch.test.ts` asserts the two paths produce identical
dabs for the same seed, and that either can finish a stroke the other started.

### Strokes are identified, not just current

Every message carries `(strokeId, generation)`. A result whose generation is no
longer current is dropped on arrival, so a cancelled stroke's late results
cannot reach the canvas. Cancellation is a message to the worker, not only a
rejected promise on the host — rejecting a promise reclaims no CPU.

### Backpressure never loses ink

Input arrives faster than any worker consumes it. Pending batches are merged,
never discarded: at most one message is in flight, so the queue is bounded at
one merged batch regardless of input rate, while every sample the user made
still reaches the canvas. Dropping obsolete *preview* computation and dropping
*stroke content* are different things; only the former is ever done.

### A stalled worker degrades, it does not disable

One slow response falls back to the main thread for that batch only, replaying
the stroke's confirmed points into a fresh engine so spacing, arc length and
jitter continue where the worker left off. The worker is retired only after
repeated failures or a hard error.

### Jitter is stroke-local

Dab jitter comes from a `BrushRng` owned by the stroke, not a process-global
PRNG. Two overlapping strokes, or a worker job and its synchronous fallback,
cannot perturb each other's jitter.

### Presets are snapshotted per stroke

`PaintStrokeSession` freezes the preset, colour, alpha lock and area selection
at pointer-down. Changing brush size mid-stroke cannot produce a stroke built
from two brushes.

### Drying is not a command stream

Wet paint mutates no canonical pixels — deposited colour is already committed —
so drying creates no history entries. Undo cannot depend on how long ago a
stroke was painted.

## Alpha lock

Alpha lock constrains new coverage by the destination alpha and preserves the
destination alpha exactly. A pixel at alpha 0.5 receives half the coverage it
otherwise would; a fully transparent pixel receives nothing; an opaque pixel
paints normally. The continuous ramp between is what lets soft edges survive
painting under alpha lock.

It applies identically on the worker and synchronous paths, to normal and
blend-mode compositing, and to smudge. Under alpha lock the compositor does not
materialise absent tiles, since a tile that does not exist is fully transparent
and can never receive paint.

Eraser and alpha lock: the eraser is not constrained by alpha lock. Erasing
already only removes alpha, so constraining it by alpha would make it
progressively unable to finish removing what it started.

## Selection

Selections are analytical (`engine/areaSelection.ts`) and are sampled per dab
into a small `CoverageMask` sized to the dab, so a large document selection
never allocates a full-canvas bitmap for one stroke. Coverage multiplies dab
coverage rather than hard-clipping it, so a feathered selection produces a
feathered stroke edge. The selection is snapshotted at pointer-down.

## Grain

Textures are decoded once into an 8-bit luminance plane and read with one array
index per pixel. Anchoring is explicit:

| Anchor          | Texture is fixed to        | Pan/zoom moves it? |
| --------------- | -------------------------- | ------------------ |
| `layer`/`canvas`| layer pixel space          | no                 |
| `brush`         | the dab centre             | n/a — travels      |
| `stroke`        | distance along the stroke  | no                 |

Wrapping uses a floored modulo, so negative world coordinates do not mirror the
texture across the origin. A texture that cannot be resolved paints unmodulated
and reports itself missing; it is never silently replaced with another texture.

The decoded cache is bounded by bytes and evicts least-recently-used entries.
Textures larger than 2048px on a side are downsampled rather than refused.

## Wet media

`WetPaintManager` holds wetness in 64px tiles allocated only where paint landed
and freed the moment they dry, so drying a 4K layer that is 2% wet does not walk
8 million pixels. `WetPaintScheduler` requests a frame only while the manager
reports wet pixels; a dry document schedules nothing.

Timing is elapsed-time based. A dropped frame is clamped to a per-step ceiling;
a gap longer than five seconds is treated as the app having been suspended, and
the paint dries outright rather than the simulation lurching forward by minutes
in one step. Backgrounding suspends the clock, not the wetness.

Wet state is runtime-only and is not written to `.varve`. Reopening a document
restores its pixels, not its wetness.

## Smudge

Smudge carries a per-stroke reservoir. Each dab picks colour up from the canvas,
mixes it into what the brush holds, and lays part of it back down, so the trail
fades with distance. Pickup happens before deposit; depositing first would let
the brush immediately re-collect its own output and the trail would never fade.

| Mode          | Behaviour                                                  |
| ------------- | ---------------------------------------------------------- |
| `sampling`    | Moves only pigment already on the canvas.                   |
| `fingerpaint` | Mixes the foreground colour into the reservoir on pickup.    |
| `mixing`      | Starts the stroke with a full reservoir of foreground.       |

Pure smudge refuses to deposit into transparent pixels: moving pigment cannot
create it. That is also why a pure smudge dragged off the edge of a shape leaves
no trail on bare canvas — there is nothing to pick up and nowhere to put it.

The reservoir drains by the fraction a dab actually transfers, which is about
half the centre-of-tip deposit fraction once the mask's falloff is accounted
for. Pickup replenishes it on the next dab, so over painted canvas the brush
reaches an equilibrium and the smear carries; over bare canvas nothing
replenishes it and the trail fades on its own.

Smudge carries a dab session and smoothing seed across pointer flushes for the
same reason the brush does, and more urgently: a smudge dab both picks up and
deposits, so a spacing restart at a batch boundary shows as a blotch rather than
a slightly uneven edge. The preset is frozen at pointer-down, since strength
drives both how much pigment moves and how fast the trail fades.

`sampleAllLayers` uses the same read-only flattened composite Clone Stamp does.
Deposits still land on the target layer alone.

## Clone Stamp and Healing Brush

Both mutate canonical raster tiles through `scene/retouchRaster.ts`, reusing the
brush tip mask, selection coverage and alpha-lock rules, so their results are
undoable, persisted, exportable and clipped like a brush stroke.

Both sample a tile snapshot taken at stroke start. Sampling live target tiles
would let a stroke consume its own output, smearing the result along the drag
direction and making it depend on tile iteration order.

Healing takes texture from the source and colour from the destination by
shifting the source's mean colour under the dab to the destination's — a
first-order approximation of the gradient-domain solve, and what distinguishes
a heal from a clone.

## Symmetry

Symmetry transforms the *input* stroke; it does not duplicate the tool. Each
transform produces one independent engine stroke through the same pipeline, so
mirrored copies inherit dynamics, grain, alpha lock and selection clipping.
Direction is reflected along with position, so directional grain and non-round
tips mirror correctly. Radial segments are capped at 32.

## Paint target

`tools/paintTarget.ts` answers "where does paint go?" in one place. Mask targets
are explicit rather than inferred from whichever thumbnail was clicked last.
Refusals carry a reason: a locked layer says it is locked and is never
auto-unlocked; a hidden layer says so; having no pixel layer reports that one
can be created. While a mask is the target, colour controls are disabled (a
grayscale mask stores coverage, not colour) and clone/heal are disabled rather
than quietly editing the content layer instead.

## Brush library

User state (custom brushes, favourites, recents, tags) is keyed by stable id, so
renaming a brush cannot orphan a favourite or a document reference. It is user
state, not document state, and is never written into a `.varve`.

Brush packages are versioned and validated. Presets referencing a user grain
embed its bytes; built-in grains stay id references. Import treats its input as
untrusted: fields are validated individually so unknown keys never reach a
runtime brush, embedded assets are size-checked before allocation, path-shaped
resource ids are refused, and a preset that fails validation is dropped rather
than half-applied. Id collisions require an explicit policy — there is no
silent-overwrite path.

## Profiling

`render/paintProfiler.ts` reports p50/p95/p99/max for input-to-dabs, compute,
queue delay and compositing. It is free when off: one boolean test per call, no
allocation, and sample buffers exist only in detailed mode.

`shouldUseWorker` scores a brush by dab area, density, grain and symmetry. A
small hard round stays on the main thread, where it beats a structured clone
each way; large, textured or symmetric brushes move off it.

## Visual fixtures

`packages/scene/src/__fixtures__/paintFixtures.render.test.ts` renders fourteen
scenarios through the real engine and writes PNGs to `reports/paint-fixtures`
(gitignored). A test asserting a pixel value does not tell you whether a stroke
*looks* like a stroke, and Playwright cannot drive the desktop WebView on Linux,
so these exist to be looked at.

Covered: hard and soft tips, pressure taper, elliptical tips, scatter jitter,
wet edge, alpha lock, feathered selection, mirrored symmetry, smudge transport,
batched smudge, finger paint, clone, heal and mask painting.

Looking at them caught two defects no unit test would have flagged: wet edge
darkening every dab's rim instead of the stroke's, and the smudge reservoir
draining so fast the trail died before it left the shape it started in.

## Limitations

**P2 — incomplete professional workflow**

- Healing's `pattern` source mode is not implemented and is not offered.
- The symmetry guide overlay renders and is bounded, but its origin handle is
  not yet draggable — the axis is positioned through settings, not the canvas.

**P3 — advanced / optional**

- Wet mixing is evaluated once per dab at its centre rather than per pixel.
- Grain sampling is nearest-neighbour; there is no bilinear filtering.
- Tilt is normalized to a single magnitude; `tiltAzimuth` exists but no brush
  parameter consumes it yet.
- Brush thumbnails do not render grain.
- Mask painting supports the container-local form (`FrameNode`); masks in
  `source-image-pixels` space still go through `RefineMaskTool`.

**Not verified**

- No testing has been done on real stylus hardware. Pressure and tilt behaviour
  is covered by synthetic pointer tests only, and should be reported as such.
- The Brush Browser and Brush Editor are covered by component tests in jsdom;
  they have not been inspected in the running desktop app. The paint *engine*
  has been visually inspected through the fixtures above.
- No performance benchmarks have been run, so `shouldUseWorker`'s threshold is
  reasoned from cost structure rather than measured.
