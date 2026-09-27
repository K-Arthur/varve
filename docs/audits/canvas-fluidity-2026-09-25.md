# Canvas fluidity and input latency — 2026-09-25

**Status:** Implemented on `master` (`f0ae77958`..`8d2959d7b`), browser-validated;
native WebKitGTK and physical-device lanes not run (see Limits).
**Scope:** main-thread work on the hover, wheel pan, ctrl-wheel zoom, and drag
paths of the editor canvas, and correctness of retained pixels.
**Predecessors:** [canvas-responsiveness-2026-09-08](canvas-responsiveness-2026-09-08.md),
[canvas-navigation-overhaul-2026-09-17](canvas-navigation-overhaul-2026-09-17.md),
[`docs/perf/2026-09-21-canvas-responsiveness-remediation.md`](../perf/2026-09-21-canvas-responsiveness-remediation.md).

## Summary

The canvas renderer was rarely the bottleneck. Profiles of production builds
showed the main thread saturated by work that scaled with document size
rather than with the edit: a per-frame global state patch for the cursor that
re-rendered the whole editor while the pointer merely hovered, a geometry
refresh that committed float-residue camera changes on every pointer sample,
and about a dozen consumers re-deriving the same whole-document structures on
every render or frame. Removing that work at its source made hover produce no
canvas redraws at all, cut 10k-node pan, zoom, and drag frame time by 65–75%,
and removed a 1–2 s stall after each drag release on large documents. The
oracle then exposed a pre-existing partial-redraw seam, which is also fixed.

No quality reduction is involved: the adaptive preview policy, image
representation policy, and export paths are unchanged, and every settled
state matches a forced authoritative redraw exactly (see Pixel correctness).

## Method

- **Runtime:** Playwright headless Chromium (1440×900, DPR 1 unless noted) on
  the Linux development host (8 cores, 22 GiB, CachyOS). Production Vite
  builds served by `vite preview`; `?perf=1` enables the existing diagnostics
  handle. Development builds were used only to find the first lead, because
  React development mode dominated their profiles.
- **Paired builds:** "before" is a clean export of `master` at `db9ec37e0`
  (the base of this work after the plugin task's commits); "after" is the
  same export with only this task's files applied (49 differing paths at the
  time, verified with `diff -rq`; the later WASM rounds also carried the paste
  fix). Other tasks' uncommitted work is excluded from both. Runs alternate before/after in two rounds; each cell below shows
  round 1 · round 2 rather than an average.
- **Workloads:** the repository's deterministic corpus
  (`packages/editor/src/performance/workloadCorpus.ts`): `vector-1k`,
  `viewport-10k` (10,000 nodes, 100 visible), `text-heavy` (600),
  `effects-heavy` (150), `mixed-raster-vector` (24 images + 200 vectors),
  `clipped-frames`; plus `masked-content` and `blend-modes` for the oracle.
  Each is fit-all, then driven with trusted CDP input: 90 wheel-pan events,
  60 ctrl-wheel events, a 120-sample hover sweep, and a 60-sample drag.
- **Metrics:** frame phase timings from the diagnostics ring (content frames
  only; `none` means the phase produced no content frame); rAF callback
  intervals (a cadence lower bound, not presentation latency — MDN defines
  the rAF timestamp as the end of the previous frame's rendering); Long
  Animation Frame entries over 50 ms with script attribution; CPU profiles
  (100 µs sampling) with caller attribution for diagnosis only.
- **Engine backend:** the exported trees carry no ignored build output, so
  the WASM engine (`apps/desktop/public/wasm`) was missing from both arms of
  the two rounds in the full matrix below. The engine ran its TypeScript
  fallback there, which it reports with a console warning. Engine IR build
  and replay measured 0–0.2 ms per frame in those rounds, and the attributed
  cost was React and editor code, so the comparison stays symmetric.
  Separate rounds with the same WASM binary copied into both arms confirm
  the result (see Results). Those probes recorded the `varve_wasm_simd`
  fetch (HTTP 200) and no fallback warning.
- **Contention:** other agents' jobs ran on the host during parts of the
  session. Early runs under load (average 8–11) were used only for
  attribution; the reported comparison ran at load 1.7–3.8 with runs
  interleaved so both arms saw similar conditions. The display interval was
  60 Hz (T ≈ 16.7 ms).

## Results (final build, paired)

Headline changes, two alternating rounds each (before → after):

| Interaction | Metric | Before | After |
|---|---|---|---|
| Hover, 10k nodes | rAF interval p50 / long frames per sweep | 150–167 ms / 121 | 16.7 ms / 0 |
| Hover, 600 text nodes | rAF interval p50 / long frames | 83 ms / 119 | 16.7 ms / 0 |
| Hover, all fixtures | content redraws per sweep | 1–121 | 0 |
| Wheel pan, 10k | frame p50 / rAF p95 | 30–32 ms / 150–167 ms | 7.3–7.5 ms / 67 ms |
| Ctrl-wheel zoom, 10k | frame p50 / rAF p95 | 30–31 ms / 150–167 ms | 6.3–6.6 ms / 67 ms |
| Drag, 10k | frame p50 / rAF p50 / rAF p95 / long frames | 48–49 ms / 67 ms / 533–550 ms / 145 | 16.6–16.7 ms / 16.7 ms / 183 ms / 97 |
| Drag, 600 text nodes | rAF p95 / long frames | 100 ms / 91–96 | 50 ms / 62–64 |
| Pan, 1k | frame p50 / long frames | 5.0–5.8 ms / 21–24 | 3.2–3.3 ms / 3 |
| Drag commit, 10k root layers | main-thread task after release (history capture) | 1.1–1.9 s, ~400 MiB LCS table | table bounded at 64 MiB; unchanged orders skip the LCS |

With the WASM engine loaded in both arms (production builds, rounds run in
the order after, before, after, before; host load 2.5–3.1 where recorded),
the pattern holds:

| Interaction (WASM engine) | Metric | Before | After |
|---|---|---|---|
| Hover, 10k | rAF p50 / long frames | 167–250 ms / 121 | 16.7 ms / 0 |
| Hover, 600 text nodes | rAF p50 / long frames | 100 ms / 119–120 | 16.7 ms / 0 |
| Wheel pan, 10k | frame p50 / rAF p95 | 33–36 ms / 167–200 ms | 8.2–8.5 ms / 67–83 ms |
| Ctrl-wheel zoom, 10k | frame p50 / rAF p95 | 33–37 ms / 183–200 ms | 7.2–8.5 ms / 67–83 ms |
| Drag, 10k | frame p50 / rAF p95 / long frames | 52–56 ms / 600–833 ms / 151–175 | 16.6–16.9 ms / 200–217 ms / 94–95 |
| Drag, 600 text nodes | rAF p95 / long frames | 117–133 ms / 93–94 | 50–100 ms / 84–108 |

The text-fixture drag is the one mixed cell: one after round recorded more
long frames than either before round, though its rAF p95 still improved.

Full matrix. Frame times are content frames from the diagnostics ring; `none`
means the interaction produced no content frame. rAF intervals are a cadence
lower bound. Long frames are LoAF entries over 50 ms. Samples are content
frames / rAF intervals for the after run.

| Fixture | Phase | Frame ms p50/p95 before | after | rAF interval ms p50/p95 before | after | Long frames before | after | Samples (frames/rAF) after |
|---|---|---|---|---|---|---|---|---|
| vector-1k | pan | 5/9.1 · 5.8/10.6 | 3.2/6.4 · 3.3/5.7 | 16.7/33.4 · 16.7/33.4 | 16.7/33.3 · 16.7/33.3 | 21 · 24 | 3 · 3 | 180/285 · 178/282 |
| vector-1k | zoom | 3.6/6.6 · 4/7.4 | 1.5/4.4 · 1.6/4.3 | 16.7/33.4 · 16.7/33.4 | 16.7/33.4 · 16.7/33.4 | 1 · 0 | 0 · 0 | 63/149 · 65/149 |
| vector-1k | hover | 6.8/6.8 · 6/6 | none · none | 33.2/33.4 · 16.8/33.4 | 16.7/16.8 · 16.7/16.7 | 0 · 0 | 0 · 0 | 0/142 · 0/141 |
| vector-1k | drag | 8.7/13.6 · 8.2/13.1 | 6.7/8.8 · 6.7/8.6 | 16.7/50.1 · 16.7/50.1 | 16.7/49.9 · 16.7/33.4 | 56 · 50 | 45 · 40 | 120/250 · 120/262 |
| viewport-10k | pan | 31.6/39.5 · 30.3/38.6 | 7.3/10.7 · 7.5/10 | 16.8/166.7 · 16.7/150.1 | 16.7/66.7 · 16.7/66.7 | 92 · 94 | 90 · 90 | 180/285 · 177/287 |
| viewport-10k | zoom | 31.4/35.2 · 30.3/33 | 6.3/8.7 · 6.6/8.7 | 16.7/166.7 · 16.7/150 | 16.7/66.7 · 16.7/66.7 | 62 · 62 | 60 · 60 | 63/151 · 64/152 |
| viewport-10k | hover | 31.4/31.4 · 28.9/28.9 | none · none | 166.7/216.7 · 150.1/199.9 | 16.7/16.7 · 16.7/16.7 | 121 · 121 | 0 · 0 | 0/141 · 0/141 |
| viewport-10k | drag | 49.1/57.7 · 48/55.5 | 16.6/22.2 · 16.7/22.7 | 66.7/549.9 · 66.7/533.3 | 16.7/183.3 · 16.7/183.4 | 145 · 146 | 97 · 97 | 117/285 · 119/264 |
| text-heavy | pan | 3/5.7 · 3.3/5.8 | 1.5/4 · 1.6/3.9 | 16.7/33.4 · 16.7/49.9 | 16.7/33.3 · 16.7/33.3 | 28 · 35 | 0 · 2 | 112/270 · 108/278 |
| text-heavy | zoom | 2.6/5.4 · 2.7/5.2 | 1.5/4.3 · 1/4.1 | 16.7/50 · 16.7/50 | 16.7/33.4 · 16.7/33.4 | 28 · 33 | 0 · 1 | 56/172 · 53/170 |
| text-heavy | hover | 5.3/7.3 · 5.4/7.2 | none · none | 83.4/100.1 · 83.4/100.1 | 16.7/33.3 · 16.7/33.3 | 119 · 119 | 0 · 0 | 0/143 · 0/143 |
| text-heavy | drag | 8.5/11.1 · 8.5/11.7 | 7.3/10.2 · 7.3/10.6 | 16.7/100 · 16.7/100 | 16.7/50 · 16.7/50 | 96 · 91 | 62 · 64 | 61/324 · 60/314 |
| effects-heavy | pan | 1/1.4 · 0.9/1.2 | 0.5/0.9 · 0.6/0.8 | 16.7/16.8 · 16.7/16.7 | 16.7/16.8 · 16.7/16.8 | 0 · 0 | 0 · 0 | 91/216 · 91/214 |
| effects-heavy | zoom | 0.8/1.2 · 0.8/1 | 0.6/0.8 · 0.5/0.7 | 16.7/16.8 · 16.7/16.7 | 16.7/16.8 · 16.7/16.8 | 0 · 0 | 0 · 0 | 58/144 · 53/146 |
| effects-heavy | hover | 1/1.2 · 0.9/1.2 | 1.2/1.2 · none | 16.7/33.4 · 16.7/33.4 | 16.7/16.8 · 16.7/16.7 | 0 · 0 | 0 · 0 | 1/141 · 0/141 |
| effects-heavy | drag | 1.6/1.9 · 1.6/2.1 | 1.3/1.7 · 1.4/1.9 | 16.7/16.7 · 16.7/16.8 | 16.7/16.8 · 16.7/16.8 | 3 · 3 | 2 · 1 | 60/262 · 60/269 |
| mixed-raster-vector | pan | 1.8/2.7 · 1.8/2.6 | 1.4/2 · 1.3/2 | 16.7/16.7 · 16.7/16.8 | 16.7/16.7 · 16.7/16.8 | 0 · 0 | 0 · 0 | 91/209 · 91/214 |
| mixed-raster-vector | zoom | 1.2/2.1 · 1.2/2.2 | 0.9/2 · 0.9/1.9 | 16.7/16.8 · 16.7/16.7 | 16.7/16.7 · 16.7/16.7 | 0 · 0 | 0 · 0 | 55/144 · 53/145 |
| mixed-raster-vector | hover | 1.9/2 · 1.7/2 | none · none | 16.7/33.4 · 16.7/33.3 | 16.7/16.7 · 16.7/16.7 | 0 · 0 | 0 · 0 | 0/141 · 0/141 |
| mixed-raster-vector | drag | 2.6/3.2 · 2.5/3 | 0.7/1.1 · 0.8/1 | 16.7/16.8 · 16.7/16.8 | 16.7/16.8 · 16.7/16.7 | 3 · 3 | 1 · 1 | 61/234 · 61/235 |
| clipped-frames | pan | 1.6/2.1 · 1.5/2.2 | 1.3/1.7 · 1.2/1.8 | 16.7/16.7 · 16.7/16.7 | 16.7/16.7 · 16.7/16.8 | 0 · 0 | 0 · 0 | 90/207 · 90/210 |
| clipped-frames | zoom | 1.1/1.8 · 1.1/1.7 | 0.9/1.5 · 0.9/1.6 | 16.7/16.7 · 16.7/16.8 | 16.7/16.7 · 16.7/16.7 | 0 · 0 | 0 · 0 | 54/144 · 53/145 |
| clipped-frames | hover | 1.7/2.4 · 1.6/1.9 | none · none | 16.7/33.4 · 16.7/33.4 | 16.7/16.7 · 16.7/16.7 | 0 · 1 | 0 · 0 | 0/141 · 0/141 |
| clipped-frames | drag | 2.4/5 · 2.4/4.9 | 2.1/4.9 · 2.1/5.4 | 16.7/16.8 · 16.7/16.8 | 16.7/16.8 · 16.7/16.8 | 1 · 2 | 1 · 1 | 59/254 · 59/255 |

## Confirmed root causes

Each finding was located by CPU-profile caller attribution on an unminified
production build (headless Chromium, 1440×900, DPR 1) and then fixed at the
source. Percentages are shares of main-thread samples during the named
interaction on `viewport-10k` (10,000 nodes, 100 visible) unless stated.

| # | Finding | Evidence | Class | Fix |
|---|---|---|---|---|
| 1 | Every pointer move wrote `cursorPos` into `EditorState`, re-rendering every `useEditor()` consumer (Shell, Layers rows, Inspector, overlays) once per frame while the pointer merely hovered | Hover: 300–490 ms React tasks, rAF p50 167–267 ms; `inputPipeline.ts` rAF publish of `setCursorPos` | Input starvation via React fan-out | Cursor published to a leaf store (`canvas/cursorPosition.ts`); only the status-bar readout, collab publisher, and debug overlay subscribe |
| 2 | `refreshCanvasRect()` ran on every tool-context build (every pointer move) and reported unchanged geometry as a resize; anchor preservation's screen→world→screen round trip then committed a camera differing by float residue (pan drifted ~7e-14 per frame) | Text fixture after a zoom: 120 `camera-change / viewport-pan` content frames during hover with visually identical camera; `commitCameraAnchorOnResize` in the hover profile | Correctness + redundant work (forced layout per sample, full redraw per sample, camera drift) | Identical geometry is ignored; pointer-move tool contexts no longer re-read layout (the pipeline already refreshes at pointerdown/wheel/pinch) |
| 3 | `documentHasSolo` scanned every node, called per Layers row per render, twice per CanvasArea render, and per frame | 15–30% of samples (LayersRow 3.5–6.6 s per phase) | Repeated O(document) work | Cached per committed `nodes` record; solo-applied document cached for the last source so render memos stay effective under solo |
| 4 | Hover built a new `HitTestEngine` per sample, which rebuilt the parent map, the entire spatial index, and the occurrence list; far zoomed out the tolerance query probed ~16k grid cells | `buildSpatialIndex` 7%, `queryWithTolerance` 15% of hover samples | Repeated O(document) work | Structures cached for the two most recent documents; paint-order walk without copying; occupied-cell scan when the tolerance square exceeds the occupied grid |
| 5 | About eight consumers (name labels, accessibility tree, Inspector restrictions, align bar, move planning, both dirty-region passes, Layers parent caches) rebuilt the same parent map per document change | `buildParentIndexMap` 16% of drag samples | Repeated O(document) work | One sealed, shared `committedParentIndex` bounded to four recent documents; the older `getOrCreateParentCache` shares its most recent build |
| 6 | Layers rows derived a generated name for every row, scanning all names per row | `existingNames` 8% of drag samples | O(rows × nodes) per frame | Generated name only for unnamed rows or while renaming; per-document name census |
| 7 | The detached-panel session broker serialized the whole document every 50 ms of editing with no auxiliary window registered | `broadcastPatch → serializeDocument` 4.6% of drag samples | Work with no consumer | Patches only while a registered window exists (new windows still receive a full snapshot) |
| 8 | The document-accent hook canonically serialized and hashed the document on every change, though the default fixed-accent mode never reads the key | `documentRevisionHash` ~2.5 s per drag phase | Work with no consumer | Key computed lazily and compared only in document-accent mode |
| 9 | Scene scope was resolved up to five times per frame (renderer, snapping, overlays, minimap), and the viewport rectangle in its key defeated reuse on every pan | `resolveEditorSceneScope` callers each ~0.4–0.8 s per phase | Repeated O(document) work | Bounded memo; viewport keyed only for publishing surfaces with pages, the only case that culls by viewport |
| 10 | The renderer rescanned the document per frame for typography, raster, perspective, animated-media, and node-count facts; the dirty region was computed twice per frame for the same pair | 1–2% each; `computeDocumentDirtyRegion` 2 × ~0.7 s per drag phase | Repeated O(document) work | Single-entry per-document memos; last-pair dirty-region memo that replays recorded rectangles into the caller's recorder |
| 11 | `worldToScreen` rebuilt the camera affine per point; culling and label projection called it four times per node | `buildWorldToScreenAffine` + `multiplyAffine` ~5% | Redundant arithmetic | Projector/tester built once per rectangle or frame, bit-identical results |
| 12 | Each history capture (after every drag commit) ran an LCS over the full root order, allocating an `(n+1)×(m+1)` table — ~400 MiB at 10k root layers, and a RangeError at ~50k — plus an O(n²) pair lookup, even when the order was unchanged | 1.1–1.9 s `IDBRequest.onsuccess` long task after drag; `lcsIndices` 0.4–0.5 s | Stall after release + unbounded memory | Identity fast paths, exact prefix trimming, prebuilt pair indices, and an O(n log n) LCS above a 64 MiB table cap |
| 13 | Partial redraw cleared, filled, and clipped fractional device rects, so edge pixels blended retained and repainted content | Pixel oracle: a one-pixel column differing by up to 97 channel levels after an undo on `mixed-raster-vector`, reproduced on unmodified `master`; two pixels mid-drag once the camera stopped drifting | Stale pixels (correctness) | Dirty rects grown to whole device pixels before clear/fill/clip; replay candidates selected with 2 px extra margin |

Finding 2 had been masking finding 13: the per-sample camera drift made
almost every drag frame a full redraw, so the partial-redraw path rarely ran
during drags. Once the drift was fixed, the oracle exposed the seam, and the
seam fix was required before the drift fix could be considered safe.

Regressions introduced and fixed during this work:

- **Cursor readout priority.** The first cursor readout used
  `useSyncExternalStore`. Its updates render at sync priority from the
  pointer's animation-frame callback, and React folds the pending
  continuous-priority document update of an active drag into that flush,
  which moved the whole-editor re-render ahead of the frame's paint. Paired
  runs showed text-fixture drag cadence falling from rAF p50 16.7 ms to
  33–50 ms although total CPU fell. The readout now writes its own text from
  the store subscription; the same drag measures rAF p50 16.7 ms and p95
  50 ms (HEAD 116.7 ms).
- **Hit testing after a font load.** The first hit-test cache was keyed on
  the document alone, but text bounds depend on which fonts are loaded, so a
  web font arriving after the first hover left clicks resolving against
  fallback-font geometry. `font-geometry-oracle.spec.ts` caught it ("later
  lines are clickable"). The cache is now keyed on the document and the font
  registry revision (`721db4ee6`), with a unit test that registers a font
  and asserts a rebuild.
- **Paste selecting a node that does not exist (latent bug exposed).**
  `clipboard.spec.ts:146` (paste into a selected, collapsed frame must reveal
  the pasted layer) failed on this work in 5 of 6 runs and passed on the
  control. The cause was already on `master`: `commitPreparedFragment`'s state
  updater assigned the selection from a variable outside the updater and
  filled it only when it was still empty. React calls an updater during
  render (not eagerly at dispatch) whenever the provider already has a queued
  update, and development StrictMode then calls it twice. Each call mints
  new random node ids, so the second call's document was committed with the
  first call's id as the selection. The Layers panel then had no node to
  reveal. Restoring only the old per-frame cursor patch made the test pass
  again, so that patch had been changing which pastes take the deferred path;
  the exact scheduling difference was not traced. The updater now starts
  from an empty result on every call, and
  a StrictMode unit test forces the deferred path and asserts the selection
  exists in the document. No other updater in `context.tsx` reads a variable
  from outside the updater that way.
- **Canvas resize during a drag.** Resizes are applied around the pointer
  while a gesture holds a viewport anchor (content stays put) and around the
  viewport centre otherwise. Every pointer move used to re-read layout, so a
  panel that resized mid-drag was applied mid-drag. Without that read, the
  geometry observer applies it on the next animation frame, and a fast
  release got there first: pointer-up cleared the anchor before its own
  layout read, so the resize was applied around the centre and the shape
  just drawn moved by half the width change (75 px in the new test). Pointer
  up now reads layout before clearing the anchor: one read per gesture
  instead of one per sample. `responsive-geometry.spec.ts` gained a
  regression test that holds animation frames, resizes the viewport
  mid-drag, and requires the shape to land under the pointer. It fails 2/2
  without the fix and passes on the control and with the fix.
- **Perspective Escape lost (latent bug exposed).**
  `perspective-image.spec.ts` failed 12 of 15 runs on this work and 3 of 15 on
  the control, always at the second session's Escape. Tracing window
  listeners showed the overlay's own `keydown` listener being removed and
  re-added while Escape was still dispatching. An earlier window listener
  handled Escape and synchronously re-rendered the canvas (500 ms between
  the event's capture and bubble phases in failing runs, 15 ms in passing
  ones). The overlay re-subscribed on every render because its handlers
  change with `buildToolCtx`. A listener removed mid-dispatch is skipped, and
  one added then is not invoked for that event, so the session never
  cancelled. The overlay now subscribes once per tool and reads the latest
  handlers through a ref. A unit test re-renders it from an earlier listener
  during Escape and fails against the previous code (`cancel` never called).
- **Variable-font test depended on edge auto-pan (test fix).**
  `variable-font-axes.spec.ts:78` failed 15 of 15 runs on this work and 4 of
  9 on the control. Its text-creation drag ended 118 px past the canvas's
  right edge, which starts edge auto-pan. Auto-pan advances by elapsed time
  capped at 50 ms per frame, so the slow control frames under-panned and this
  work's 16.7 ms frames panned the designed distance. That scrolled the
  specimen out of the canvas screenshots the test compares. The drag now
  stays inside the canvas; with only that change the file passes 18 of 18
  runs in both arms. No assertion changed.

Hypotheses rejected or left unchanged, with reasons:

- React development-mode overhead dominated early dev-server profiles
  (`jsxDEV`, `addObjectDiffToProperties`). All attribution and timing therefore
  used production builds.
- The brush engine, stabilization, and coalesced-sample handling showed no
  hotspot in these workloads and were not changed.
- Canonical history hashing (~190 ms per commit at 10k nodes) was not
  memoized: a stale hash would silently skip a history revision if any code
  ever edited a committed document in place, and that could not be ruled out
  exhaustively.
- `findContainingFrameInDoc` still builds its own parent map during drag
  (<1% of samples): two callers pass documents that are still being built
  inside `updateDoc`, so the shared committed index is not safe there.

## Pixel correctness

Every change that can put retained pixels on screen was checked with the
authoritative-redraw oracle: after each interaction, the SHA-256 of the live
content surface was compared with the hash after
`window.__varvePerf.forceFullRedraw()` at the same state. The probe runs nine
checks per fixture (settled, mid-drag with the button held, after drag, after
hover, after pan, after zoom, after hover at the new zoom, after a second
drag, after undo) on eight fixtures.

| Build | DPR | Exact matches | Mismatches |
|---|---|---|---|
| `master` before (control) | 1 | 71 / 72 | after undo on `mixed-raster-vector` (seam, delta up to 97) |
| after, before the clip-snap fix | 1 | 70 / 72 | the same after-undo seam, plus 2 px mid-drag (delta 2) |
| after, final | 1 | 72 / 72 | none |
| after, final | 1.5 | 71 / 72 | 3 px mid-drag on `mixed-raster-vector`, max channel delta 1 |

The remaining DPR 1.5 difference is mid-gesture only, outside the current
dirty rect, and does not persist: the after-drag, pan, zoom, hover, and undo
checks match exactly. It is consistent with retained pixels painted at
settled image quality while the forced redraw during the gesture uses the
interactive image representation; this was not proven and is recorded as a
residual. The existing E2E oracle suites (`responsiveness-real-workflow`,
`many-image-render`) passed.

**Correction (2026-09-26).** Until `79fe9d8ca`, `forceFullRedraw()` could
present the render worker's bitmap, so for scenes the worker rendered it
compared the worker against itself. The table above therefore shows that no
stale pixels survived. It does not show that the worker drew the same pixels as
the main thread. With the oracle forced onto the main thread, the worker path
is wrong on current `master` for blend modes and effects; see the follow-up
pass below.

## Validation

`pnpm verify:plan` over this task's 56 paths selected Tier 0 (format and lint
on touched files, `audit:emoji`, `audit:inspector-css`, `audit:tokens`,
`audit:spacing`, `audit:docs`), Tier 1 (`typecheck:e2e` and the direct unit
tests), Tier 2 (unit and typecheck for `@varve/editor`, `history`, `scene`,
`shared`), Tier 3 (unit and typecheck for the 13 dependent packages), and
Tier 4 (`e2e:canvas`, `bench:render`). Full-suite escalation: no. The planner
warned that the selection covers 91% of repository test files because
`@varve/shared` and `@varve/editor` are dependency hubs.

`pnpm verify:affected` stopped at Tier 0 on another task's stylesheet at the
time, so each lane was run directly with the same commands. Other tasks'
uncommitted edits were present in the working tree throughout, so browser
lanes ran on two exported trees instead: a clean control (`master` at
`db9ec37e0`) and the same export with this task's files, each on its own dev
server port. A failure counts as pre-existing only if it also fails on the
control, and a failure seen only with this task's files was rerun at least
twice in both arms (six times where those reruns disagreed) before being
classified.

The first control runs were not valid, for two reasons found during triage.
The exported trees link `node_modules` from the main checkout, so Vite
refused to serve the bundled web fonts from outside its root (353 blocked
requests in one run). They also lack the ignored WASM build output, so the
engine fell back to TypeScript, and test fixtures added to `master` after the
export's base. Both arms were corrected identically (a scratch-only
`server.fs.allow` entry, the same WASM files, and `master`'s tracked
fixtures copied in), and the final canvas pass below ran under the corrected
setup. Earlier
classifications made before the correction were redone, and one measurement
difference was traced to it: the Layers header width differed between arms
(183.05 px vs 180.59 px) because only one arm had its fonts.

| Lane | Result | Notes |
|---|---|---|
| Tier 0 audits (docs, tokens, inspector-css, spacing, emoji) | pass | Rerun after the final doc edits |
| Biome on touched files | pass | |
| `typecheck:e2e` and typecheck for all 17 affected packages | pass | The last editor typecheck reported one error in another task's uncommitted `tokenSync/importWorkflow.test.ts` |
| Unit tests for 16 of 17 affected packages | pass | `@varve/editor` 1028 s |
| Unit tests for `@varve/website` | 1 failure, unrelated | Raw font-size ceiling (350 > 344) from other tasks' uncommitted `.astro` edits; this task touches no website file |
| E2E: oracle and responsiveness specs (`responsiveness-real-workflow`, `many-image-render`, `performance-diagnostics`, `name-labels`, `responsive-geometry`) | 10 / 10 pass | Run on the main checkout |
| E2E: input and navigation (`input-navigation`, `interaction-latency`, `middle-button-pan`, `snap-after-move`, `zoom-stability`, `tools`) | 31 pass, 1 pre-existing | `tools.spec.ts:169` (clipping-mask source icon) also fails on the corrected control |
| E2E: surfaces touched indirectly (`document-accent`, `layers`, `local-manager`, `detach`, `layers-header-solo-overflow`, `chromeos-device-matrix`) | 42 pass, 3 pre-existing | The three layout-measurement failures also fail on the corrected control |
| E2E: `tests/e2e/canvas`, all four slices (188 files), final pass on the committed code | 548 pass, 98 fail, 94 not run, 44 skipped | This task's tree under the corrected setup. All 98 failing tests (90 locations) were rerun on the identically prepared control, and 95 fail there too. The three that passed once on the control were rerun twice per arm. Across all runs `image-mode.spec.ts:62` failed 4 of 5 with this work and 3 of 5 on the control, `tables-visual.spec.ts:281` 1 of 5 in each arm, and `table-merged-divider.spec.ts:13` 1 of 5 with this work and 0 of 5 on the control, failing at the Shift+ArrowRight step that `tables.spec.ts` documents as racing the global shortcut manager. All three are classified as intermittent in both arms. The 94 not run follow failures in serial-mode files |
| Earlier canvas passes (before the corrected setup) | 4 regressions found | They surfaced `clipboard.spec.ts:146`, `font-geometry-oracle`, `perspective-image.spec.ts:8`, and `variable-font-axes.spec.ts:78`, all fixed (see Confirmed root causes), and showed `tables.spec.ts:51` and `warp-visual.spec.ts:102` failing in both arms |
| `clipboard.spec.ts:146` after the paste fix | 6 / 6 pass | `--repeat-each=6` on this task's tree; 5 of 6 failed before the fix |
| New resize-during-drag test (`responsive-geometry.spec.ts`) | fails 2/2 before the fix; passes 2/2 on the control; whole file 8/8 with the fix | |
| `perspective-image` and `variable-font-axes` after their fixes | 24 / 24 pass in both arms | `--repeat-each=6`; the control also passed the in-canvas variable-font drag 18/18 |
| Planner lanes for the pointer-up and overlay fixes (`9ae0e3725`, `d3585cb34`, `8d2959d7b`) | pass | Biome, emoji, `typecheck:e2e`, `inputPipeline.test.ts` and `PerspectiveOverlay.test.tsx` 9/9, editor unit tests 8,056/8,056, desktop unit tests 80/80 and typecheck. The editor typecheck error is again only the token-sync file |
| Planner lanes for the paste fix (`a5a4eaf6c`) | pass except unrelated | Biome, emoji, `context.import.test.tsx` 17/17, desktop typecheck and 1,916 s unit run pass. Editor unit tests: 8,039 pass, 8 fail: 7 in the token-sync task's uncommitted `TokenSyncPanel` and `LocalTokenForm` files, and 1 in `selectionCoverage.test.ts` from another task's later retouch commit, which uses no file this task changed. The editor typecheck error is the token-sync file noted above |
| `bench:render` (`pnpm bench:canvas`) | pass (6 / 6) | Engine replay bench; this task does not change the engine |
| `node scripts/audit-architecture.mjs --ci` | pass | 14 cycles (ceiling 19), no layer violations; `context.tsx` import count unchanged by this task |

`replaySubtreeToCtx` has no structural change: its per-node dispatch is
untouched, and one call inside it reads the shared parent index instead of
building a new one. Its frame cost is covered by the paired frame-time
matrix above (150 to 10,000 nodes, full pan and zoom frames and partial drag
frames). The 50,000-node tier was not run.

## Follow-up pass (2026-09-26)

Remaining-work item 1 was profiled on `master` at `79fe9d8ca` (unminified
production build, WASM engine loaded). Pan and zoom on `viewport-10k` spent
49% of the main thread rendering React and 11% committing, against 18% for
the canvas frame itself. The heaviest consumers re-derived whole-document
state on every camera change:

| Consumer | Share of pan | Cause | Change |
|---|---|---|---|
| Canvas name labels | 10% | projected and named all 10,000 candidates per camera change to place at most 80 | Unrotated cameras reject off-screen candidates with a world-space reach test; the widest possible label is culled before any name work; one camera affine per frame. Output identical (randomised equivalence test) |
| Canvas accessibility tree | 7.9% | recomputed every occurrence's world bounds per render; `CanvasOverlays` passed a fresh camera object, so any overlay render counted | World bounds keyed on the document; the camera step keyed on primitive values with one viewport tester per frame |
| Minimap | 6.8% | redrew every shape per camera change although only the viewport indicator moves | Document layer cached per minimap canvas and copied 1:1; the indicator drawn over it. Pixel-identical by construction (the indicator sets every context property it uses) |
| Export dialog | 3.4% | always mounted; `exportableNodes` and a name map over every node recomputed per editor render while closed | Document-derived inputs are empty while the dialog is closed |
| Inspector restrictions | 2.8% | keyed on the whole editor state | Keyed on exactly the 13 fields its input type picks |

Drag added whole-document passes per frame: the design-debt badge rescan
(6.7%), snapping's scene-scope resolution (4.9%), the compositing dependency
graph (1.6%), parent maps (3%), and two font-face scans (1.8%). The debt
badge now scans once edits pause for 300 ms. The scene scope, the compositing
adjacency, and `committedParentIndex` reuse their previous result when an edit
only changes node transforms. A drag frame's edit is exactly that, and none
of the three reads transforms (publishing surfaces that cull pages by the
viewport are excluded). The font scans key on a document identity that ignores
moves (`useFontStableDocument`). The move test is one identity walk per pair
of node records, memoised across its callers.

Paired rounds against `master` at `d96979dc5`, WASM engine loaded in both
arms. Rounds 1 and 2 measured the change before the move test was memoised,
and round 4 after. Round 3 ran at host load 7.6 and is excluded:

| `viewport-10k` | Before | After |
|---|---|---|
| Pan: long frames / rAF p95 | 90–91 / 67 ms | 13–22 / 33–50 ms |
| Zoom: long frames / rAF p95 | 60 / 67–83 ms | 9–17 / 33–50 ms |
| Drag: rAF p95 / max | 183–217 / 267–317 ms | 100–133 / 183–250 ms |
| Drag: long frames | 91–96 | 110–114 |

Text-heavy long frames fell as well (pan 9–19 → 1–5, drag 70–97 → 50–65).
Drag on `viewport-10k` has a shorter tail but more medium-length long
frames. Name-label candidates, accessibility-tree bounds, and the minimap
scene still recompute every node per drag frame, because each frame is a new
document; making them incremental is remaining work.

**Worker-path rendering on `master`.** With `79fe9d8ca` the oracle repaints
on the main thread, and the render worker's output differs there. A manual
bisect over the 116 commits since `db9ec37e0` (exported trees, the shared
checkout untouched) found `79fe9d8ca`, the oracle change itself, as the first
failing commit. The worker path was already wrong, and the oracle could not
see it:

- Blend modes: the worker replays onto a transparent `OffscreenCanvas` and
  the host paints the board underneath, so every blend mode composites
  against nothing and lands as its source colour (158,015 pixels off by up to
  184 levels on `blend-modes`). Scenes with a visible non-normal blend mode
  on a node, fill, or effect now stay on the main thread
  (`sceneCanUseWorkerRenderer`), where the board is the backdrop.
  `blend-modes` goes from 4/9 to 8/9 oracle checks. Handing the worker the
  board colour would keep such scenes off the main thread, but that needs
  `renderPipeline.ts`, which another task had open with staged changes.
- Effects: at rest, `effects-heavy` shows a blurred, offset worker bitmap from
  before the last camera change that no fresh frame replaces (352,935 pixels,
  up to 184 levels). Not fixed, for the same reason.
- The same staged index entry removes the `79fe9d8ca` oracle guard. If it is
  committed, the oracle goes back to hiding these differences.
- Without the WASM files the failures are identical, so they are not
  engine-specific. A remaining mid-drag difference on `blend-modes` (577
  pixels, up to 53 levels, main-thread partial redraws) settles by the
  after-drag check.

**Lost keys.** `TableEditOverlay` (capture phase, re-subscribed on every
editor state change) and `WarpOverlay` (re-subscribed on every warp-drag
frame) had the perspective overlay's defect. Both now subscribe once per
session and read the latest state through a ref. A unit test proves the
table overlay dropped an arrow key when an earlier listener re-rendered it
mid-dispatch, and handles it now. The table overlay's Enter fallback also
used a `"row,col"` coordinate as a cell id; it now uses the id.

| Validation | Result |
|---|---|
| Biome, emoji, inspector-css, tokens, spacing; `typecheck:e2e` | pass |
| Unit and typecheck, `@varve/scene`, `@varve/editor`, and the 13 dependent packages | pass |
| Oracle, 8 fixtures, after vs `master` | identical except `blend-modes` (4/9 → 8/9); `text-heavy` and `effects-heavy` fail equally in both |
| E2E: all canvas specs plus export, inspector, dialog, accessibility, and layers specs related to the change | in progress at this commit |

## Research evidence

Earlier sources were accessed 2026-09-25; the first-person issue and forum
reports added for this continuation were rechecked 2026-09-27. Community
reports are symptom evidence, not controlled studies; none is treated as proof
of Varve's cause.

| Source (date) | App / version / platform | Reported symptom | Cause or fix confirmed? | Relevance to Varve | Local reproduction | Limits |
|---|---|---|---|---|---|---|
| [web.dev INP](https://web.dev/articles/inp) (updated 2025-09-02) | Browser metric | INP observes click, tap, and key only; hover, zoom, and scroll are excluded | Normative documentation | INP cannot certify canvas hover/pan/zoom; Varve needs its own frame and trace evidence | Probe measures hover/pan/zoom rAF cadence and long frames separately | Chromium-centred |
| [MDN rAF](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame) | Web platform | rAF timestamp is the end of the previous frame's rendering, not a present time | Documentation | rAF intervals are a cadence lower bound, not input-to-photon latency | Reported as `raf` intervals only | No presentation timestamp |
| [MDN LoAF](https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/Long_animation_frame_timing) | Chromium | Frames delayed past 50 ms with script attribution | Documentation | Used to attribute long tasks; absence of LoAF does not prove 120 Hz smoothness | Probe records LoAF count and top scripts | Chromium only; 50 ms threshold |
| [W3C Pointer Events 3](https://www.w3.org/TR/pointerevents3/) and [MDN getCoalescedEvents](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents) | Web platform | Coalesced samples are chronological; predicted samples exist to reduce perceived latency; secure-context only; not Baseline | Documentation | Brush input must keep coalesced samples and never commit predictions; availability must be feature-detected | Existing `collectSourceEvents` path retained unchanged | WebKit position is neutral ([standards-positions #374](https://github.com/WebKit/standards-positions/issues/374), 2024-07-18); WebKitGTK support not established here |
| [Penpot #5063](https://github.com/penpot/penpot/issues/5063) (2024-09-05) | Penpot, Firefox 129, GNOME 46 Wayland, Intel | 0.5-5 fps and 100% of one core while panning a large text-heavy mockup with a touchpad | Open, labeled in progress; no published cause | Same platform family as Varve's primary target; one-core saturation pattern matches main-thread-bound work | 10k-node pan/zoom fixture, Linux | Browser, not WebKitGTK |
| [tldraw #4923](https://github.com/tldraw/tldraw/issues/4923) (2024-11-15) | tldraw, browser | Low fps panning 1024 visible notes; fast when few are visible | Linked PR closed; details not in the fetched page | Per-frame work proportional to shape count during camera motion | vector-1k pan | Fix content unavailable to us |
| [tldraw #5156](https://github.com/tldraw/tldraw/issues/5156) (2024-12-27) | tldraw, Windows/Android, Chrome/Edge/Firefox | Drawing becomes sluggish after ~1000 shapes | Open, no diagnosis | Input-path work that scales with document size rather than the edit | drag on 1k and 10k fixtures | No root cause |
| [Excalidraw #7846](https://github.com/excalidraw/excalidraw/issues/7846) (2024-04-03) | Excalidraw, Arc/Chrome | Dragged objects lag the cursor more as the window grows | Open, no diagnosis | Separates pointer position from artwork; viewport-size sensitivity | Future: repeat drag probe at larger viewports | Not reproduced here |
| [Krita Artists #126841](https://krita-artists.org/t/brush-lag-help/126841) (2025-06-15, last reply 2025-06-18) | Krita, Linux, pen | Brush and eraser lag regardless of renderer | Community attributes it to the MyPaint engine; reporter did not confirm | Brush lag has engine-specific causes; renderer toggles are not a universal fix | Not attempted: this pass found no brush-engine hotspot | Single thread, unconfirmed |
| [Adobe Community, Photoshop 2025 brush lag](https://community.adobe.com/questions-712/photoshop-2025-brush-lag-1174223) (2024-11-05, replies to 2025-09) | Photoshop 2025, Windows | Brush lag after update; several users affected | Partial: re-enabled smoothing for some, not for others | Distinguish intentional stabilization from pipeline lag | Not attempted | Mixed causes |
| [Adobe Community, brushing layer masks](https://community.adobe.com/questions-712/brushing-layer-masks-is-laggy-in-24-4-1-1167104) (2023-05-17; replies through 2024-02) | Photoshop 24.4.1/24.5, macOS | One author reports multi-second mask feedback and 10–15 s after several quick strokes | Author later found 100% smoothing was a cause; a follow-up still reported the issue | First stroke, feedback, and post-stroke catch-up must be measured separately; smoothing is not a universal root cause | Varve brush/Eraser response not yet isolated from canvas presentation | Community report, not a controlled profile |
| [Adobe Community, Photoshop 2025 brush lag](https://community.adobe.com/questions-712/photoshop-2025-brush-lag-1174223) (2024-11-05; replies through 2026-04) | Photoshop 2025, Windows/macOS | A basic round brush on a 500×500 document is reported slow; other replies attribute similar reports to smoothing, boot settings, or tablet drivers | Mixed and sometimes conflicting reports | Small documents can still have input-path lag; renderer toggles alone may mislead diagnosis | Varve still needs first-stroke/steady-state brush profile on a small document | Self-reported, multiple possible causes |
| [Excalidraw #8136](https://github.com/excalidraw/excalidraw/issues/8136) (2024-06-14) | Excalidraw, M1 MacBook Air, 16 GB | Author reports slowdown around 8k–14k objects in Chrome and unusable/blinking canvas at 14k–24k in Firefox; object mutation also slows | Closed “not planned”; no confirmed fix in the issue | Large-canvas editing and scene mutation both matter; adding a GPU path alone would not address history/persistence costs | Varve `viewport-10k` supports large mostly-offscreen pan/drag; broader 50k tier remains unrun | One author’s hardware/workload; reported FPS is not independently verified |
| [Excalidraw #7341](https://github.com/excalidraw/excalidraw/issues/7341) (2023-11-25) | Excalidraw, browser storage | Author attributes continuous writing lag and repeated console errors to localStorage quota failure on a growing document; reports IndexedDB stopped the issue for them | The reporter’s workaround helped their case; no general cause proven | Long-session degradation can come from persistence failures as well as rendering | Varve history capture was separately measured at about 190 ms for a 10k document; sustained save/load cycles and failure behavior still need soak evidence | One user’s attribution; do not infer the same storage root cause in Varve |
| [tldraw, “Back to Content”](https://tldraw.dev/blog/back-to-content) (2026-01-10) | tldraw, infinite canvas | Selected shapes prevented a navigation control from appearing after an offscreen-culling optimization | Maintainers confirmed a visibility-versus-culling mix-up and fixed it; they report the regression lasted over 20 months | Geometric visibility and renderer culling are different facts; selected/editing exceptions must not change navigation or accessibility truth | Keep the existing selection-aware navigation and geometry oracle cases distinct from render-cull tests | Vendor postmortem; Varve has not reproduced this tldraw defect |
| [Figma: reduce memory usage](https://help.figma.com/hc/en-us/articles/360040528173-Reduce-memory-usage-in-files) (undated) | Figma | Hidden layers, variants, images, and many pages drive memory; pages load on demand | Vendor documentation | Derived per-document caches must be bounded because history retains old documents | Caches added here are bounded to recent documents | Vendor guidance, not measurement |

These reports describe different failure classes rather than one “canvas
performance” defect. The Linux touchpad report and viewport-width drag report
concern navigation/input; Photoshop and Krita reports concern brush computation,
stabilization, or device drivers; the Excalidraw large-document reports include
scene mutation and persistence; and the tldraw postmortem is a correctness bug
caused by confusing geometric visibility with render culling. They motivate
separate Varve probes. They do not justify changing brush stabilization or
claiming a cross-product fix.

Decisions taken from this pass:

1. Measure hover, pan, and zoom with rAF cadence plus long-frame attribution,
   because INP excludes them.
2. Treat "cost scales with document size, not with the edit" (tldraw, Penpot)
   as the primary hypothesis, and test it with a 10k-node document whose
   visible set is only 100 nodes.
3. Bound every new document-derived cache, since undo history keeps old
   documents alive (the Figma memory lesson).
4. Leave the brush engine and smoothing unchanged: this pass found no
   brush-specific hotspot, and the community evidence shows brush lag causes
   are engine-specific.

## Limits and unmet targets

- **Not measured on the production runtime.** All timing and oracle evidence
  is headless Chromium on Linux. The Tauri WebKitGTK editor, WebView2,
  WKWebView, Firefox, and the 4 GB-class and ARM Chromebook targets were not
  run. The fixes remove JavaScript and React work, so they are expected to
  carry over, but native gains are unmeasured.
- **No presentation latency.** rAF intervals and frame work are reported;
  input-to-photon latency was not measured and no presentation claim is made.
- **Synthetic input only.** CDP wheel and pointer events; no physical
  trackpad, pen, or touch. The display interval was 60 Hz; 120/144 Hz was not
  tested. Timing ran at DPR 1; the oracle also ran at DPR 1.5.
- **Targets not met on the 10k fixture.** The proposed targets (visible
  response p95 within ~2T, p99 within ~3T) are met for hover on every fixture
  and approached on the smaller fixtures, but not for 10k-node pan (rAF p95
  67 ms, ~90 long frames per 90-event burst) or drag (rAF p95 183 ms, ~97 long
  frames). That remaining cost was not attributed in this pass (see below).
- **Brush and drawing input were not profiled.** No brush-specific hotspot was
  sought or changed; coalesced-sample handling is untouched.
- **No soak run.** New caches are bounded by construction (two to six
  documents, or per-record values that die with the record), but memory over
  a long session was not measured.
- **One residual oracle difference** at DPR 1.5, mid-gesture only (see Pixel
  correctness).

## Remaining work

1. Transform-only changes now share one changed-node classification and a
   bounded occurrence-geometry snapshot across name labels, accessibility,
   and minimap layout. The cache refreshes moved occurrences, descendants,
   ancestor bounds, and path-text dependents; font/scope/resolver changes take
   the full path, and live-boolean scenes conservatively rebuild. Five focused
   geometry tests compare incremental results with an independent full pass.
   This establishes correctness, not a timing win: browser profiling and the
   visual oracle have not yet been rerun. Candidate metadata and minimap
   layout still walk the projected occurrences, and every `useEditor()`
   consumer can still re-render per wheel event and drag frame.
2. Remove the deprecated `EditorState.cursorPos` / `setCursorPos` once
   `Shell.tsx` stops passing it to `useCollabPresence`.
3. Canonical history hashing still serializes the whole document once per
   capture (~190 ms at 10k nodes). Moving it off the interaction lane or
   making it incremental needs a safe design; memoizing by identity was
   rejected (see Confirmed root causes).
4. `findContainingFrameInDoc` still walks the page and builds a parent map on
   every drag move. The drag caller passes the committed document and could
   use `committedParentIndex`; this pass has not yet changed that call site.
5. Print-mode (publishing) scopes still resolve per pan frame because page
   culling depends on the viewport.
6. `commitPreparedFragment` returns the inserted ids by reading them out of
   its state updater. When React defers that updater to render, the call
   returns an empty list, so the "Pasted N layers" announcement and the
   import report's committed ids are skipped for that paste. Found while
   fixing the paste selection above; read from the code, not separately
   tested, and left unchanged because a synchronous result needs the
   insertion computed outside the updater.
7. The render worker should receive the board colour and paint it before
   replaying, so blended scenes can return to the worker. Until then they
   stay on the main thread (follow-up pass).
8. At rest, effects scenes can keep a stale, reprojected worker bitmap that no
   fresh frame replaces (`effects-heavy`, follow-up pass). Per this repo's
   rule, every reason the worker might decline or drop a frame must be
   decided before the frame picks its branch.
9. `ExportDialog` has a "save focus" effect that reads `document.activeElement`
   through its `document` prop (the scene document, which shadows the
   global), so it stores nothing. Nothing reads that ref, so there is no
   user-visible effect; the effect is dead code and can be removed.

## Continuation baseline — 2026-09-27

This pass remains on `master`. At export time the HEAD was
`cba8721748e9f3c0aa7462ef73034eafecf6e710`; other work continued to land on
the same branch during this pass. The checkout had 253 tracked paths with
staged and unstaged changes, plus 129 untracked paths. The renderer file had a
specific index conflict: the staged version removed the oracle's independent
main-thread redraw guard, while the working copy restored it and included
additional renderer-admission work. Those states must be reconciled before a
renderer commit. Concurrent plugin, token-sync, GPU/WebGL2, design-system, and
website work remains outside this audit unless a particular overlap is called
out.

Matched source snapshots were exported outside the shared checkout to
`/tmp/varve-fluidity-baseline-20260927-cba8721/{base,candidate}`. The base is
the exported HEAD; the candidate applies the captured staged/unstaged patch and
untracked files. Exact file manifests and SHA-256 digests are in that
directory. Its `build-identity.txt` records HEAD, branch, `rustc 1.97.1`, pnpm
11.9, Playwright 1.62.1, GTK 3.24.52, and WebKitGTK 2.52.6. Runtime and build
checks in this pass are Linux x86_64 only. Native physical touchpad/pen input,
WebView2, WKWebView, low-memory/ARM hardware, and higher refresh rates remain
unmeasured.

The complaint-to-reproduction matrix is deliberately explicit about gaps:

| User-reported failure | Varve reproduction/evidence | Status in this pass |
|---|---|---|
| Linux touchpad pan nearly stalls on a large text-heavy file ([Penpot #5063](https://github.com/penpot/penpot/issues/5063), Sep 5 2024) | 10k mostly-offscreen pan and browser wheel traces already exist; real touchpad events do not | Input class is covered synthetically; physical trackpad still needed |
| Drag lag grows with viewport width ([Excalidraw #7846](https://github.com/excalidraw/excalidraw/issues/7846), Apr 3 2024) | Existing paired canvas captures used 1440×900; the narrow/wide viewport pair is not yet run | Open local reproduction gap |
| Brush lag on a small 500×500 file ([Adobe Community](https://community.adobe.com/questions-712/photoshop-2025-brush-lag-1174223), Nov 27 2024) | The existing real-workflow spec includes one short paint stroke on imported content, but does not separate first-stroke feedback, steady-state handler cost, and presentation | Brush profile still required; no stabilization change is justified |
| Effects remain blurry or smear during navigation | `effects-heavy` differed from the forced main-thread oracle by 352,935 pixels (maximum channel delta 184) at a settled camera; the 13-image transfer-budget test covers a separate refusal path | Revision/fallback fix is implemented in the working copy; focused browser oracle run is queued behind an existing live heavy-task lease |
| Long-session writing slows after storage errors ([Excalidraw #7341](https://github.com/excalidraw/excalidraw/issues/7341), Nov 25 2023) | Varve's canonical history capture was measured near 190 ms on a 10k-node document; a 100-cycle Tauri open/edit/navigate/brush/save/close runner now exists, but has not run | Serialization cost is confirmed; session-level memory/save degradation is still unmeasured |

The external reports have different causes and evidentiary strength. In the
Krita Linux/pen thread, the user reported that renderer and smoothing changes
did not materially help; replies attributed the case to a particular MyPaint
brush, but the reporter did not independently confirm that diagnosis. In one
Photoshop mask thread, lowering smoothing helped its author, while another
Photoshop 2025 thread includes a simple round brush that remained slow at 0%
smoothing. These are reasons to profile Varve's first stroke, large tips,
sample processing, and canvas presentation separately—not reasons to change
Varve's stabilization or smoothing behavior without a local reproduction.

This continuation's focused checks pass: 83 Vitest tests across the worker
identity/submission and occurrence-geometry paths, plus three native-soak
runner tests under `node --test`. `pnpm typecheck:e2e` passes after the new
spec stopped augmenting the shared global `Window` type. The editor package
typecheck stops on an unrelated concurrent plugin-manifest error at
`packages/editor/src/plugins/package.test.ts:173`; the scene package
typecheck stops on two unrelated `codegen` workspace-mode mismatches in
`packages/scene/src/auditProfiles.test.ts`. Docs, emoji, and token audits pass.
The required canvas pixel-oracle run did not start: the heavy-task lease was
held by another large canvas E2E run for the full 600-second wait window.
Browser screenshots and the post-change timing profile remain outstanding; a
longer bounded lease wait is queued. `node scripts/audit-architecture.mjs
--ci` exits 0 with 14 distinct cycles, zero layer violations, and no enforced
baseline breach. It still prints existing over-budget warnings for Shell,
Menubar, and `context.tsx`; none is a changed file in this continuation. The
initial baseline snapshot remains at the captured `cba8721` source; newer
concurrent commits on `master` are not part of that snapshot.

The public browser demo scope was checked against the repository's GitHub Pages
hosting record. GitHub Pages cannot configure the COOP/COEP headers needed for
shared-memory WASM, so the docs now qualify that limitation to the current
public deployment instead of generalizing it to every browser build. Product
copy also distinguishes a temporary reprojected navigation preview from the
current authoritative frame and labels warm refinement times as targets.
Those website edits still require both base-path builds and visual review.

The native workflow soak now drives the Tauri/WebKitGTK application through
document creation, rectangle edit, wheel pan/zoom, pressure-shaped paint input,
local save, and document close. It verifies visible WebView dimensions, pixel
change, and per-cycle screenshots, while collecting process-tree RSS and host
memory/load samples. Its pointer/wheel events are explicitly DOM-synthetic;
physical pen/touchpad and OS-trusted input remain gaps. The fresh binary and
100-cycle run have not yet been executed.

Focused render unit tests pass (50 cases across revision tracking, worker host,
submission fallback, presentation identity, and render-pipeline baseline). The
committed containment-index follow-up passes 25 containment/parent-index tests;
its draft mutation call sites still use the local draft-index path. A
prior `pnpm verify:plan` selected a full-gate escalation because this shared
working tree also contains workspace and validation-infrastructure changes;
`pnpm verify:affected` reported the plan and refused to run without
escalation. The mandated full gate was attempted on the mixed tree and failed
in unrelated concurrent Biome, architecture/dead-code, and editor-corpus
typecheck lanes; focused validation and the browser oracle remain necessary
before claiming completion.
