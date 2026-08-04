# Scrolling — stale pixels, clipping errors and input latency — 2026-08-03

Follow-up to the partial-redraw work
([`2026-08-03-partial-redraw-implementation.md`](2026-08-03-partial-redraw-implementation.md)),
scoped to scrolling: reported stale pixels, clipping errors and poor latency.

Three independent defects were found on the scroll path. All three are fixed,
each with a test that fails against the pre-fix behaviour.

## Verified facts

### 1. Partial redraw retained pixels across camera moves (visual corruption)

`usePartialRedraw` and the dirty-region prune gate considered the profile
tier, camera *rotation*, and dirty area — but never whether the camera had
**translated or zoomed** since the backing store was painted. A partial redraw
keeps every pixel outside the merged dirty rects; a pan moves all of them.

Any frame that changed the document *and* the camera together therefore
composited correctly-positioned dirty rects on top of content still drawn at
the previous scroll offset. The dirty region is derived purely from the
document diff (`computeFrameDirtyRegion(previous, next)`), so it covered only
the edited node's old and new bounds and could not know the camera had moved.

The reachable path is not exotic: `inputPipeline.ts` runs an **auto-pan** loop
whenever a drag reaches the viewport edge (`computeEdgeVelocity`), calling
`setPan` on every frame while the tool mutates the dragged node. Every one of
those frames took the partial path.

Measured in the visual oracle: >1,000 differing pixels against a trusted full
render — a large visible corruption, not a rounding artifact.

There was also a latent second-order hazard. The prune gate and the paint gate
were computed independently from overlapping-but-separate conditions. Pruning
the visible list while painting a *full* redraw clears the whole surface and
replays only the pruned subset, which erases every node outside the dirty
region. The conditions happened to agree; nothing enforced it.

### 2. Scroll deltas were dropped in coalesced bursts (input latency)

The wheel handler, the inertia tick and the auto-pan tick each read
`stateRef.current.pan` and called `setPan(snapshot + delta)`. `stateRef` is
assigned during render, so it only advances once React commits — but browsers
deliver several `wheel` events in one task (trackpads especially), and the
rAF-driven inertia and auto-pan ticks can also run before a commit.

Every event in such a burst resolved against the *same* snapshot and computed
the *same* destination, so all but the last delta were silently discarded.
Pinned by the sensitivity check in `scrollAccumulation.test.tsx`: three 40 px
events produce 40 px of travel instead of 120 px.

This is a correctness bug in the input path that presents purely as latency —
scrolling feels heavy and lags the input device, and the faster the scroll,
the larger the fraction of it that is thrown away.

### 3. O(nodes) work per scroll event (latency that scales with document size)

Clamping a pan against the document extent calls
`computeDocumentUnionBounds`, which walks every node and builds a parent
index. It ran inside the `setPan`/`setCamera` state updaters — so on **every**
wheel event, inertia frame, auto-pan frame and pinch step — and React may
invoke an updater more than once.

Measured on this machine (node/jsdom, `createPerformanceWorkload` fixtures):

| Fixture | Nodes | Union-bounds cost per pan event |
|---|---:|---:|
| vector-100 | 100 | 0.137 ms |
| vector-500 | 500 | 0.622 ms |
| vector-1k | 1,000 | 0.746 ms |
| vector-5k | 5,000 | 3.687 ms |

At 5,000 nodes a burst of three wheel events in one frame spent ~11 ms
re-deriving an answer that had not changed — most of a 16.7 ms budget, before
any rendering. This is a load-independent structural result: the same walk,
repeated, over an immutable document.

## Changes

| Change | File |
|---|---|
| `surfaceMatchesBackingStore` + `PaintedSurfaceIdentity` | `canvas/dirtyRegion.ts` |
| Surface gate threaded into the prune decision | `canvas/dirtyQuery.ts` |
| One shared per-frame surface check feeding both gates; painted identity recorded after content and present frames; cleared on context loss | `CanvasArea.tsx` |
| `panBy` (relative pan resolved inside the updater) | `context.tsx`, `context/types.ts` |
| Wheel / inertia / auto-pan switched to `panBy` | `canvas/inputPipeline.ts` |
| WeakMap cache for document union bounds | `context.tsx` |

### Why the surface gate is correct

The comparison is **exact**. A sub-pixel pan still shifts retained content, so
a tolerance would trade a correctness guarantee for at most one extra repaint.
The identity includes the backing-store dimensions and DPR, so a resize (which
reallocates and clears the surface) also forces a full redraw.

The result is computed **once per frame** and passed to both the prune gate and
the paint gate, so the two can no longer diverge. Full redraws caused by this
gate are attributed (`camera-moved`, `surface-stale`) rather than falling
through to a generic reason — no full redraw is unexplained.

Context loss clears the painted identity, so the recovery frame is a full
redraw rather than a partial redraw onto a blank surface. The worker present
path records the identity it composited under; it already refused to present a
bitmap whose camera did not match.

### Why `panBy` is correct

The base pan is read inside the state updater, so React's queue applies each
delta to the result of the previous one. Absolute `setPan` remains for callers
that genuinely have a destination (fit-to-screen, restore-view, tests).

`applyPanToState` returns the *same* state object when the clamp absorbs the
delta, so scrolling into a document edge stops re-rendering and stops
scheduling canvas frames instead of emitting a stream of no-op frames.

### Why the bounds cache is correct

Documents are immutable, so identity is a sound cache key — any mutation
produces a new document object and therefore a new entry. A `WeakMap` keeps
each entry alive exactly as long as its document: switching or closing a
document collects the entry with it, and nothing has to invalidate explicitly.
No document is retained by the cache.

## Tests

| Suite | Count | What it pins |
|---|---:|---|
| `canvas/__tests__/surfaceValidity.test.ts` | 15 | pan / sub-pixel pan / zoom / resize / never-painted rejection; prune-gate agreement; full-redraw attribution |
| `__tests__/scrollAccumulation.test.tsx` | 4 | delta accumulation against the **real provider** |
| `canvas/__tests__/panScrollCost.test.ts` | 4 | one document walk per burst; stable result; recompute on a new revision |
| `tests/e2e/visual/partial-redraw-oracle.spec.ts` | +2 (7 total) | partial redraw across a pan is visibly wrong; the forced full redraw is pixel-identical |

Sensitivity was verified, not assumed: `panBy` was temporarily reverted to the
stale-snapshot shape and the accumulation tests failed with exactly the
40-of-120 symptom, then restored.

Commands run:

```
npx vitest run packages/editor                 # 4372 passed, 2 failed (pre-existing, see below)
pnpm typecheck                                 # 15/15 packages pass
npx playwright test tests/e2e/visual/partial-redraw-oracle.spec.ts --project=chromium   # 7 passed
npx biome check <touched files>                # clean
cargo fmt --all -- --check                     # clean
```

## Separation of findings

**Verified facts** — all three defects above, each reproduced and pinned by a
test that fails against the pre-fix behaviour. The union-bounds timings are
measured on this machine and are load-independent in shape (O(nodes) per
event) even though the absolute milliseconds are not.

**Not caused by this work** — two `featureOwnership` tests fail because the
concurrent soft-proofing work added a `document-proof` inspector section
without updating the expected list. Confirmed by reproducing them unchanged in
a clean worktree at `2577a17d`, before any of this work. Two pre-existing e2e
typecheck errors (`focus-order.spec.ts`, `keyboard-nav.spec.ts`) are likewise
untouched.

**Fixed in passing** — `canvasRedrawOnDocChange` was failing for an unrelated
reason: its fixture omitted `id`, `name` and `nextId`, which `DocumentCodec`
now requires, so the decode failed, the provider silently fell back to a
default document, and the mutation under test was a no-op against a
non-existent node. Investigated because it sat in this blast radius; the
redraw pipeline itself was behaving correctly, and the guard is now restored.

**Platform coverage** — Chromium only. WebKitGTK and WebView2/WKWebView are
**not** validated for these changes. The surface gate is platform-independent
logic, but the pruning path it guards is the one that matters most on
WebKitGTK (where the render worker is unavailable), so on-device verification
there is worth doing.

## Known limitation introduced

Frames that change the camera and the document together are now **full**
redraws where they were previously (incorrectly) partial. This is the correct
trade — the partial output was visually wrong — but it means auto-pan drag
frames do more work than before. Pure scrolling is unaffected: it was already
a full redraw, because an unchanged document produces `dirty: none`.

## Follow-up backlog

1. **Scroll blit.** Panning still repaints every visible node. Copying the
   backing store by the pan delta and repainting only the newly exposed edge
   strips would make a pan cost O(nodes in the strips). The blocker is
   sub-pixel accuracy: the device-pixel delta is `panDelta × zoom × dpr` and is
   generally fractional, so a blit must either be restricted to
   integral-device-pixel deltas or accept resampling. Worth prototyping behind
   the existing surface-identity infrastructure, which already computes exactly
   the information a blit path needs.
2. **Native WebKitGTK verification** of the surface gate and the pruning path.
3. **Silent document-decode fallback.** A failed `DocumentCodec.decode` in
   `EditorProvider` falls back to a default document with no diagnostic. That
   is what made the stale test fixture above so hard to read, and it would be
   worse in production.
4. Re-run the production workload runner for scroll workloads now that the
   union-bounds cost is gone, to get before/after p50/p95 on an idle host.
