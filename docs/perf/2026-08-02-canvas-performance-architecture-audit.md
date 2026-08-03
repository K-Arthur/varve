# Canvas performance architecture audit — 2026-08-02

## Scope and evidence status

This document maps the production canvas interaction path before further
optimization. It complements the measured findings in `docs/perf/findings.md`
and the session results in
`docs/perf/2026-08-02-interaction-memory-hardening-report.md`.

The budgets below are regression targets, not claims about every supported
device. Each result must retain its build mode, refresh rate, scene fixture,
browser/webview, hardware, and warm/cold status. A result without that metadata
is informational only.

## End-to-end architecture map

```text
Pointer, wheel, key, touch, or pen input
  -> React canvas input handlers (`canvas/inputPipeline.ts`)
  -> ToolManager and active tool gesture state
  -> hit testing / selection resolution
  -> spatial broad-phase snap query (`scene/spatialIndex.ts`)
  -> semantic filtering and snap fine phase (`tools/snapping.ts`)
  -> preview/document mutation (`context.tsx`)
  -> document diff and cache invalidation (`canvas/dirtyRegion.ts`)
  -> keyed lane scheduler (`performance/frameScheduler.ts`)
  -> scene preparation, culling, memoized IR build (`CanvasArea.tsx`)
  -> main-thread compositor or latest-wins render worker
  -> Canvas2D/WebGPU compositing
  -> frame commit recorded by `canvas/perfRuntime.ts`
```

## Stage inventory

| Stage | Execution owner | Input -> output | Cache dependencies | Cancellation / stale-work control | Expected frequency | Current instrumentation | Worst-case cost |
|---|---|---|---|---|---|---|---|
| Input receipt | Webview main thread | DOM event -> normalized pointer/tool context | element bounds, camera state | pointer capture release; gesture end/cancel | once per input event; coalesced events remain browser-dependent | `pointer.input` span and bounded interaction ring under `?perf=1` | handler can inherit hit-test, tool, snap, React state, and layout work |
| Interaction dispatch | Webview main thread | tool context + event -> tool finite-state-machine transition | tool-local gesture state, transform cache | pointer cancel, Escape, tool switch | once per input event | included in `pointer.input`; named subspan gap recorded below | proportional to active selection and tool behavior |
| Hit test / selection | Webview main thread, with engine facade where selected | world point -> ordered candidates / selection | frame spatial index, transform cache, scene order | current event supersedes hover result | pointer down and hover pointer moves | input duration and existing hit-test tests | deep groups and broad visible scopes can approach scene traversal |
| Snap broad phase | Webview main thread | moving bounds + tolerance -> nearby node ids | revisioned uniform spatial hash, parent index | gesture snap session reset; document identity rebuild | once per snapped move/resize operation | broad/index/semantic counts and query duration | min(theoretical query cells, occupied index cells), plus returned candidates |
| Snap semantic filter | Webview main thread | nearby nodes + editing scope -> valid bounds | transform cache, parent index, selection set | current event supersedes result | once per snapped move/resize | semantic candidate count | O(k) nearby candidates plus bounds lookup |
| Snap fine phase | Webview main thread | valid anchors/guides -> deterministic winning X/Y + guides | gesture hysteresis session | modifier bypass; gesture end resets session | once per snapped move/resize | fine count and evaluation duration | O(k log k) after sorted midpoint/spacing optimization |
| Preview / scene mutation | Webview main thread / React state | tool result -> immutable document or preview state | transaction/history state | transaction abort; later state wins | once per accepted tool update | interaction wall/busy time; document revision | selected-node count, ancestor updates, React subscriber fan-out |
| Invalidation | Webview main thread | previous/current document -> partial bounds or full reason | resolved styles, parent index, visual bounds, tile versions | new document diff supersedes old plan | once per changed render | redraw reason, full-redraw reason, dirty rectangle count/ratio | O(n) identity diff; bounds work for changed nodes and ancestors |
| Render scheduling | Webview main thread | keyed lane job -> one animation-frame callback | per-key pending job map | key replacement; explicit cancel; interaction lane priority | at most one queued job per key per frame | correlated `render.queue` span under `?perf=1` | O(number of scheduled keys), bounded by keyed replacement |
| Frame setup | Webview main thread | document + camera -> active/visible node list | parent/frame indexes, styles, variants, transform cache | draw-in-flight coalesces to one pending follow-up | once per rendered frame | `setupMs`, node and culled counts | O(n); current largest measured phase near 1K nodes |
| Node preparation / IR | Webview main thread plus native/WASM engine facade | visible scene nodes -> cached or newly built IR | engine-node memo, node hash memo, subtree IR cache | render revision and draw-in-flight generation | once per rendered frame; builds only for misses | `preLoopMs`, `hashMs`, build time, memo computes/hits | O(visible nodes + cache misses); native IPC can add serialization/queue delay |
| Main-thread replay | Webview main thread | IR + resources -> canvas backing store | image/font/gradient/subtree replay caches | newer frame replaces pixels; no mid-replay interrupt | once per non-worker frame | replay and total frame duration | O(drawn items); effects and raster-layer reconstruction add intermediates |
| Worker admission / queue | Webview main thread | render command + transferable bitmaps -> in-flight/pending slot | render bitmap budget | one in-flight + one latest pending; pending replacement closes resources | at most once per stale worker frame | revisions, pending/in-flight bytes, admission failures, queue depth derivable from slots | byte estimation O(image count); bitmap collection/decode may dominate |
| Worker replay | render worker | IR + resources -> transferred frame bitmap | worker OffscreenCanvas and image map | stale results discarded; synchronous replay cannot be interrupted mid-command | one active command | worker revision, wait/processing span gap recorded below | O(IR + effects), plus backing-store allocation on resize |
| Composite / present | Webview main thread and OS compositor | current worker bitmap or main-thread canvas -> visible frame | retained worker bitmap, compositor caches | revision/camera/surface identity checks | once per rendered frame | replay/total time and commit timestamp; OS presentation is not directly observed | canvas composite plus webview/Wayland/WebView compositor scheduling |

## Gesture-frequency audit

- Once per gesture: transaction start/end, pointer capture, snap-session reset,
  interaction trace allocation, and final history commit.
- Once per pointer event: tool-context construction, hover hit testing, tool
  dispatch, snap query/evaluation when enabled, preview mutation, cursor update
  throttled to 32 ms, and edge-autopan decision.
- Once per animation frame: document/setup walk, culling, hash/memo lookup, IR
  build for misses, replay/composite, diagnostics sample when enabled.
- Potentially several times per frame: browser-delivered pointer events and
  React state updates. The keyed scheduler coalesces render requests, and the
  async draw guard permits only one active draw plus one pending follow-up.
- Background work: image/font decode subscribers, worker completion, thumbnails,
  minimap, autosave, and inference providers can independently request work.
  Direct manipulation uses the scheduler's input lane; the resource providers
  do not yet share one global admission controller.

## Production regression budgets

All latency distributions require at least 100 warm interaction samples after
an explicit warm-up. Cold-start and first-decode samples are reported
separately. `max` is diagnostic rather than a shared-runner CI gate.

### End-to-end latency targets

| Profile | Refresh | Fixture | pointer-to-present p95 | p99 | slow-interaction threshold | Frame budget |
|---|---:|---|---:|---:|---:|---:|
| normal desktop | 60 Hz | small / mixed-realistic | <= 33.4 ms | <= 50 ms | 50 ms | 16.7 ms |
| normal high refresh | 120 Hz | small / mixed-realistic | <= 16.7 ms | <= 25 ms | 33.4 ms | 8.3 ms |
| large document | 60 Hz | 10K lightweight / dense snap / raster-heavy | <= 50 ms | <= 83.4 ms | 66.7 ms | 16.7 ms, with quality degradation allowed |
| constrained | 60 Hz | stress-4gb application profile | <= 66.7 ms | <= 100 ms | 83.4 ms | 33.4 ms |

The same rows are recorded separately for production Chromium, WebView2,
WKWebView, and native WebKitGTK. Platform results are never averaged together.
The targets are initial review thresholds; a platform-specific relaxation
requires a trace-backed decision record, not an implicit fallback.

### Stage and resource budgets

| Metric | Normal target | Large/constrained target | Gate style |
|---|---:|---:|---|
| event queue delay to handler start, p95 | <= 4 ms | <= 8 ms | release trace |
| pointer handler duration, p95 | <= 4 ms | <= 8 ms | release trace |
| snap broad phase, p95 | <= 1 ms | <= 2 ms | benchmark + counts |
| snap fine phase, p95 | <= 2 ms | <= 4 ms | benchmark + canonical parity |
| render queue wait, p95 | <= 8.3 ms | <= 16.7 ms | release trace |
| main-thread frame total, p95 | <= one refresh interval | <= two refresh intervals | release trace |
| dirty work for a one-node move | candidate and redraw counts independent of total offscreen scene size | same | deterministic work-count test |
| full redraw attribution | 100% has a stable reason | 100% | deterministic test |
| worker render queue | <= 1 in flight + 1 pending | same | deterministic test |
| worker bitmap transfer budget | 128 MiB default | 64 MiB stress-4gb; 32 MiB stress-2gb | admission test |
| decoded image cache | 256 MiB balanced | 64 MiB low | byte-accounting test |
| trace retention | <= 50 interactions, 512 spans and 240 frames per interaction | same | deterministic test |
| snap retention | <= 120 samples | same | deterministic test |
| frame retention | <= 120 samples | same | deterministic test |

Timing ceilings are not asserted on contended shared CI. CI enforces operation
counts, bounded queues/bytes, parity, cleanup, and generous smoke ceilings;
tighter latency gates belong to platform-keyed benchmark hardware.

## Confirmed cache invalidation boundaries

- Spatial snap index: keyed by document identity; mutation creates a new
  immutable document and rebuilds on the next gesture query.
- Transform cache: selectively invalidated by changed nodes and ancestors;
  structural changes clear it.
- Engine-node and subtree IR caches: selective for property/geometry edits;
  structural edits clear affected retained state.
- Dirty region: old and new visual bounds, including effect padding; raster
  layers compare 128 px tile versions.
- Worker result: render revision plus viewport, camera, DPR, and resize
  generation; stale bitmaps are closed before presentation.
- Image and font completion: independent stamps request a new render and are
  separately attributed.

## Evidence status and remaining gaps

1. `pointer.input`, `snap.prefilter`, `snap.evaluate`, `render.queue`, and
   `render.main` are correlated inside one bounded interaction trace.
   `interaction.dispatch`, `render.worker`, and OS-level `composite.present`
   still need separate spans or calibrated cross-process timing.
2. The worker host and CanvasArea now share an identity-aware frame-disposal
   boundary, so context-loss, stale-response, replacement, and duplicate-close
   paths release resident accounting exactly once.
3. A 24-iteration real-pointer Chromium soak now records forced-GC heap and
   bounded application-resource samples, but the full deterministic workload
   corpus is not yet wired to a production build or multi-hour native runner.
4. Production partial redraw now records and can freeze/visualize the merged
   backing-store dirty rectangle, but it still prepares the visible list before
   clipping; dirty-area reduction does not yet prove proportional node-work
   reduction or expose individual pre-merge rectangles/repainted node IDs.
5. Raster layers are tiled in the scene model, but replay reconstructs a full
   layer-sized intermediate from all tiles. This requires a measured trigger
   before changing the per-node hot path.
6. Native WebKitGTK environment capture exists; native sampling evidence still
   requires an installed profiler and a release GUI session.

These gaps are tracked as evidence requirements. A change is not credited as a
performance improvement until the relevant workload is remeasured.
