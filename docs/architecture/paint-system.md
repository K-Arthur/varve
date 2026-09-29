# Paint System

**Status:** Implemented; see Limitations for what is not
**Updated:** 2026-09-29

## Scope

This describes how a pointer stroke becomes document pixels in Varve, and the
invariants the paint subsystem holds. It covers the raster brush, eraser,
smudge, Clone Stamp, Healing Brush, Spot Heal, Patch, Dodge Burn, grain, wet
media, symmetry and the brush library. Vector pressure is covered only where
it shares behaviour with the raster path.

Documented behaviour here has been exercised by the tests named in each
section. Anything not yet implemented is listed under Limitations rather than
described as if it ships.

## Product shape and workspace integration

Varve does not maintain a second document model or a separate "paint mode"
state. The workspace may reorganize the toolbar and inspector, but the
authoritative scene remains the same for Design, Draw, and every other
workspace.

When a raster or vector drawing tool becomes active, the existing tool-options
popover opens automatically. This keeps preset, size, opacity, flow, hardness,
spacing, strength, or stabilization controls discoverable without creating a
second drawing toolbar or duplicating brush state.

The output target is deliberately explicit:

- `Paint` and `Eraser` create or modify raster-layer pixels.
- `Smudge` modifies existing raster-layer pixels.
- `Pencil` creates editable vector path geometry.
- `Paint` is the painting interaction; document paints/fills remain styling
  entities and are not used as a name for raster tool state.

## Raster layer targeting and persistence

Painting resolves its raster target in this order on the active Design Canvas or
publishing page:

1. an explicitly selected raster layer, after checking it and its ancestors
   for visibility, locks, active-page membership, and an invertible world
   transform;
2. when selection is empty, an eligible raster layer in the active page
   subtree;
3. when selection is empty and no eligible layer exists, one page-sized
   `Brush Layer`, parented to the containing frame when one is active.

An explicit non-raster selection is refused. The brush does not route that
stroke to a different raster layer behind the selection. A stale or deleted
fallback, invalid page membership, inaccessible ancestor, singular transform,
or mask whose id does not match the selected node's mask asset is likewise a
refusal; these states cannot redirect a stroke. Mask painting also requires a
present, dimensioned asset in the coordinate space currently supported by the
mask session. The resolver's refusal reason is announced to assistive
technology. Canvas-surface strokes validate ancestry against the active Design
Canvas; page-surface strokes validate against the active page. When an explicit
non-pixel object is selected, Paint tool options
also offer **Create paint layer**. The action adds an empty layer to the active
editor surface and selects it; it does not reuse the selected object or consume
the refused pointer gesture, so the artist paints with a deliberate next
stroke.

Pixel-selection sources and pixel destinations are also independent. Magic
Wand's **Visible artwork** source samples a bounded renderer-produced snapshot
of the active scene, while **Selection Sources → Create flats layer** creates a
separate output layer for **Fill pixel layer**. The fill is one undoable
operation; the sample snapshot is temporary and never becomes document
content. Transparent linework is sampled over white so enclosed regions can be
selected without painting white pixels into the document.

For shading over an existing raster layer, select that visible raster source
and choose **Create clipped paint layer** in Paint tool options. Paint is
available from the existing Design toolbar as well as the specialist drawing
and photo toolbars, so this workflow does not require leaving Design. Varve creates
an ordinary raster child named **Shading** inside a named group whose live
scene-node alpha matte references the source. The source remains editable, and
paint deposits stay on the new child. The child's transform is mapped through
the active surface and the source's world transform; hidden, off-surface, or
singularly transformed sources are refused. Structured raster exports,
subtree-compositor exports, and artwork sampling include the external matte
source as a render dependency while keeping it outside the selected output
boundary. The browser regression verifies the clip, unchanged pixels outside
the source, undo/redo, save/reopen, and transparent PNG export. A vector shape
can supply the same live matte. For vector-source shading, SVG rasterizes only
the clipped paint group and keeps supported contour siblings native; fallback
placement and SVG view-box bounds use the compositor's world-space crop. The
browser PDF route preserves appearance by rasterizing the selected subtree, so
it does not promise editable vector content. Chromium verifies the vector
clip, undo/redo, save/reopen, and actual SVG/PDF downloads. Ancestor-transform
variants, desktop/PDF-X export, WebKitGTK, and pen hardware remain unqualified.

Clone Stamp, Healing Brush, Spot Heal, Patch, and Dodge Burn use the same
resolver but with stricter ownership: an explicitly selected raster layer is
the destination, a
selected non-raster object (an image-filled shape, text, a vector node) is
refused with a stated reason, and no implicit empty layer is created. Creating
an empty destination while the user asked to edit a different object is how
"it edited the wrong layer" reports start; the deliberate creation paths remain
the Layers panel and Photo source → Prepare retouch layers.

World samples are mapped through the inverse cached world transform before they
enter raster tile compositing. Raster layers use sparse 128 by 128 RGBA tiles;
the theoretical layer extent does not preallocate all tiles.

`RasterLayerNode.tiles` is a runtime `Map<string, RasterTile>`. The canonical
document codec converts it to a keyed serializable tile object with base64 pixel
buffers on encode and reconstructs the `Map` on decode. Invalid tile payloads
are discarded with a codec warning rather than crashing document load. Tile
buffers must be exactly `128 * 128 * 4` bytes.

## Pipeline

```
Pointer hardware
        │ PointerEvent / coalesced packet / optional predicted packet
        ▼
inputPipeline → collectSourceEvents → canonicalizeInputEvents
        │ normalized position, pressure, tilt magnitude + azimuth, timestamp
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
                          smooth → causal centripetal reconstruction
                          → arc-length spacing → dynamics → deterministic jitter
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

Confirmed samples are the only input to the authoritative branch. Predicted
samples fork a cloned engine state and paint a transient overlay; they never
advance spacing carry, arc length, jitter, wetness, smudge pickup, raster
tiles, or history. The next confirmed packet replaces the overlay and
pointer-up/cancel removes it.

### Input canonicalization

`collectSourceEvents()` collects a coalesced packet and appends the primary
event only when it is not its duplicate. When requested, predicted events are
kept as a separate tail. `canonicalizeInputEvents()` orders confirmed samples
by timestamp then arrival order, deduplicates them, and only then appends the
predicted tail. A confirmed sample always wins over an identical prediction.

`normalizeInputEvent()` makes malformed browser fields safe before they reach
tools. It preserves low pen pressure—including zero during hover/up—and uses a
constant-width/opacity fallback when pressure is disabled or unavailable. It
retains the active `button`/`buttons` state, unknown/custom pointer types, tilt
X/Y, magnitude, azimuth, altitude, twist, tangential pressure and contact
geometry. Equal-position/equal-time samples are retained when dynamics or
contact state changed, and throwing or missing optional sample APIs degrade to
the primary event. Observed pressure/tilt/eraser capability is reported
separately from API availability; a default `0.5` pressure sample is not proof
of a pressure sensor. `inputToStrokePoint()` forwards tilt magnitude and
azimuth, uses a monotonic timestamp, and receives a short-window filtered
velocity from `pointerDynamics.ts` rather than exposing raw `distance / dt`
spikes to brush dynamics.

`pointerrawupdate` is intentionally not an input source yet. It overlaps with
`pointermove` on Chromium and needs an explicit de-duplication/capture policy
before it can lower latency safely. Coalesced `pointermove` remains the
portable path for Tauri/WebKitGTK and browser builds; correctness must not
depend on raw updates.

### Reconstruction and preview

Raw hardware positions are observations, not the finished centreline.
`CausalStrokeReconstructor` retains one point of look-ahead and emits the
previous segment as a centripetal Catmull–Rom curve. Turns sharper than 60°
fall back to a straight resampled segment, preserving intentional corners
instead of allowing a spline hook. The last held segment is flushed with a
deterministic forward ghost on pointer-up. Its chord length is bounded to
0.25–1 layer pixels, independent from visual dab spacing, so sparse curves
are smooth without relying on arbitrary extra stamps.

The worker and synchronous fallback run this same incremental state machine.
The prediction mirror is cloned from confirmed `StrokeEngineState`, including
the reconstructor, spacing carry, arc length and `BrushRng` state. Therefore a
wrong prediction is disposable and the committed result remains invariant to
whether predictions were supported.

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

Pointer-up seals the confirmed tail and keeps the history transaction open
until the worker reports every branch settled. Switching tools while the
pointer is still down cancels that gesture; switching after pointer-up leaves
the sealed request alive so its final callback can commit the stroke. This
keeps a fast tool change from discarding visible in-flight pixels.

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

### Fractional coverage survives to pixels

Stroke points and dabs retain floating-point layer coordinates. The compositor
does not round a dab's mask origin: it samples the precomputed mask bilinearly
at each destination pixel and expands tile bounds through the final partial
pixel. Paint, erase, legacy smudge, pigment smudge, clone/heal and mask paint
share this rule.

At the supported 0.5–1px tip range, a bounded 4 by 4 coverage sample replaces
the coarse mask lookup. This keeps a tiny circle visible when its centre lies
between pixel centres and splits its coverage continuously instead of making it
blink or jump one pixel at a time.

### Presets are snapshotted per stroke

`PaintStrokeSession` freezes the preset, colour, alpha lock and area selection
at pointer-down. Changing brush size mid-stroke cannot produce a stroke built
from two brushes.

Brush presets also carry an optional `accumulation` setting. `buildup` remains
the compatibility default for existing presets and preserves the earlier
per-dab source-over behavior. `stroke-opacity` uses a bounded, one-byte-per-
pixel map shared across symmetry branches: each pixel builds toward that dab's
opacity ceiling during one pointer gesture, and a new gesture can deposit
again. Flow controls the rate of that buildup. The brush editor saves this
setting with a local brush preset; selecting a built-in Soft Shade preset
loads its stroke-opacity behavior. The preview uses the same stroke generator
and tile compositor, so overlap and opacity reflect the selected mode.

The per-gesture map is capped at 64 MiB. If a stroke touches more raster tiles
than fit, painting continues in buildup mode for new tiles and the editor
announces the fallback; already tracked tiles remain capped. Mask strokes
continue to converge toward the chosen mask value, which is their existing
coverage contract. A stroke-opacity mode does not change document pixels after
the stroke ends; separate gestures are independent history entries.

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

The existing Smudge tool exposes this contract in its Brush inspector. `Mode`
selects `sampling`, `mixing`, or `fingerpaint`; `Sample merged layers` is an
explicit opt-in toggle, and the button state is part of the live brush
settings rather than an invisible tool flag. Merged sampling shares the
retouch tools' paint-order layer walk and read-only source/target separation,
but its tile-only flatten does not map layer transforms or blend modes —
retouch merged sampling does (see Clone Stamp and Healing Brush). Deposits
still land on the active target layer alone, so an artist can texture a blank
layer from visible paint without accidentally painting the reference layers.

The merged snapshot is currently a bounded snapshot of visible raster-layer
tiles in the active scene tree's paint order. It is not a renderer readback:
vector nodes, group isolation, effects, and transformed non-raster content are
not implicitly sampled. The UI copy uses “merged raster layers” deliberately; a
future renderer-backed sampling path must preserve the same source/target
separation and revision checks.

## Clone Stamp and Healing Brush

Both mutate canonical raster tiles through `scene/retouchRaster.ts`, reusing the
brush tip mask, selection coverage and alpha-lock rules, so their results are
undoable, persisted, exportable and clipped like a brush stroke.

Both sample a tile snapshot taken at stroke start. Sampling live target tiles
would let a stroke consume its own output, smearing the result along the drag
direction and making it depend on tile iteration order.

Sampling scope is explicit and frozen per stroke:

| Scope          | Reads                                                      |
| -------------- | ---------------------------------------------------------- |
| `current`      | the destination layer alone                                |
| `below`        | the destination plus every contributing layer below it     |
| `allVisible`   | every visible contributing layer on the active page        |

The merged scopes are composed in scene paint order, exclude hidden layers and
hidden ancestors, apply per-layer opacity, map transformed layers into the
destination's local pixel space with bilinear inverse sampling, and evaluate
each layer's declared blend mode through the shared engine `blend()`. They do
not reproduce layer masks, clipping, group opacity, adjustment layers, or live
effects; that requires a renderer-backed readback and is listed under
Limitations rather than approximated by combining unrelated tile coordinates.
A bounded work budget reports `truncated` instead of allocating without limit.

Deposits always land on the destination layer alone, so merged sampling is
non-destructive: the layers that contributed to the sample are never written
back to.

A stroke whose deposits are all byte-identical no-ops (self-clone, fully
transparent source, zero coverage) returns the same node, keeps tile versions
unchanged, and aborts its transaction rather than leaving a history step.

The source anchor is stored in world space, so changing the destination layer
between strokes re-anchors the source correctly instead of reusing numbers from
another layer's local space. Aligned mode carries the source-to-cursor offset
forward across strokes; non-aligned mode restarts from the original anchor.

Healing takes texture from the source and colour from the destination by
shifting the source's mean colour under the dab to the destination's — a
first-order approximation of the gradient-domain solve, and what distinguishes
a heal from a clone.

All four retouch tools (Clone Stamp, Healing Brush, Spot Heal, Patch) clip
deposits to the active area selection through the same `selectionCoverage`
rasterisers the brush uses — Spot Heal with the bounded per-dab mask, Patch
with a mask rasterised only over the target rectangle. A selection that
exists but does not intersect the patch region yields an *empty* coverage
mask, which the canonical compositors treat as "nothing may be painted";
returning "no mask" there would silently un-clip the operation. The tools
also expose the compositor's alpha lock so repairs can be constrained to
existing pixel coverage, and Clone/Heal strokes carry real pen pressure: a
flow dynamics mapping whose identity bezier maps pressure p to a 2p
multiplier, which keeps the mouse's constant 0.5 (and pressure-disabled)
deposits byte-identical while a light pen stroke lays down proportionally
less. Tilt is still not mapped for retouch.

## Dodge and Burn

`DodgeBurnTool` applies signed exposure in stops under the brush mask:
destination pixels are decoded to linear light, scaled by
`2^(exposure × coverage)` with the same IEC sRGB transfer functions the
engine's exposure kernel uses, and re-encoded. A shadows/midtones/highlights
range focus weights the adjustment smoothly (all three weights stay positive
away from the extremes, so the range adjusts emphasis instead of masking
pixels out). Because the operation modifies existing pixels only, it never
creates tiles or coverage on transparent destinations, zero exposure is the
byte-identical identity with no history step, alpha is always the
destination's, and strokes clip to the active selection like the other
retouch tools.

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

Built-in starting points include a pressure-shaped Sketch Pencil and Inking
Nib, a firm Opaque Paint brush, a low-hardness Soft Shade brush, and the
existing round, marker, airbrush, textured, soft and eraser presets. Their
browser thumbnails use the same production dab generator as strokes. Built-in
categories are explicit: the general preset default has a nonzero
`smudgeStrength`, so inferring the Smudge category from that field incorrectly
filed the Airbrush as Smudge.

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

`packages/scene/src/__benchmarks__/paintAccumulation.bench.ts` compares the
canonical tile compositor in the default buildup mode and opt-in stroke-opacity
mode on 1K, 2K and 4K wide traces. The first local Node run measured about
7.0/13.8/29.6 ms for buildup and 9.0/17.2/35.4 ms for stroke opacity. These are
compositor microbenchmarks, not input-to-screen latency or physical stylus
measurements; use them to catch relative cost changes in the optional mode.

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
- Tilt magnitude and azimuth are retained through `StrokePoint`; no built-in
  preset currently maps azimuth, twist or tangential pressure to a target.
- Brush thumbnails do not render grain.
- Smudge merged sampling does not yet include vector/group/effect content or
  transformed raster compositing; use a flattened raster copy when that source
  fidelity is required.
- Retouch merged sampling maps layer transforms and blend modes, but layer
  masks, clipping, group opacity, adjustment layers, and live effects still
  require a renderer-backed readback and are not reproduced.
- Clone/heal/dodge-burn strokes map pen pressure to per-dab flow (see Clone
  Stamp and Healing Brush); tilt is carried by the shared stroke model but not
  mapped to retouch brush parameters yet, and Spot Heal's single click-to-fix
  dab does not scale with pressure.
- The clone-source marker and paint-target badge render through
  `PaintOverlay` while a retouch tool is active; the marker tracks the world
  anchor and the badge states the resolved destination or the refusal reason.
- Mask painting supports the container-local form (`FrameNode`); masks in
  `source-image-pixels` space still go through `RefineMaskTool`.

**Not verified**

- No testing has been done on real stylus hardware. Pressure and tilt behaviour
  is covered by synthetic pointer tests only, and should be reported as such.
- The Brush Browser and Brush Editor are covered by component tests in jsdom;
  they have not been inspected in the running desktop app. The paint *engine*
  has been visually inspected through the fixtures above.
- No production stylus calibration UI exists. The default linear pressure path
  is deterministic; device/user response curves, activation thresholds and
  saturation should be introduced as a persisted profile layer rather than
  baked into document history.
