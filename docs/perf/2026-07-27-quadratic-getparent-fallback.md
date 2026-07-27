# Quadratic getParent fallback — document-open hang and six related hot paths, 2026-07-27

Follow-up to [`2026-07-26-input-latency-console-flood.md`](2026-07-26-input-latency-console-flood.md).
That investigation asked "what rendering engine would be most optimal" and concluded the
question needed a real answer first: at what document scale does the current Canvas2D path
actually break down, and is the ceiling even a rendering problem? This is that answer.

## The discovery

Loading a 20,000-node flat document through the real desktop app (scripted via Playwright
against a throwaway dev server, not the user's own session) pegged a renderer process at
**96% CPU for over 10 minutes without finishing** — confirmed directly via `ps` process
monitoring during the hang, not inferred from a probe timeout. 100/500/1,000-node documents
loaded and dragged normally; 2,500 errored; 5,000 and 10,000 timed out loading.

That shape — fine, then a cliff, then a multi-minute hang — is the signature of an O(n²)
algorithm, not a rasterizer struggling to keep up. Root-caused it directly rather than
speculating.

## Root cause

`nodeWorldTransform(doc, id, parentIndex?)` and `nodeWorldBounds(doc, id, parentIndex?)`
(`packages/scene/src/coordinateService.ts`) walk a node's ancestor chain to compose its world
transform. The walk needs each node's parent, and there are two ways to get it:

- **With `parentIndex`** (a `Map<NodeId, NodeId>` from `buildParentIndexMap(doc)`, one O(n)
  pass): O(1) per lookup.
- **Without it**: falls back to `getParent(doc, id)`
  (`packages/scene/src/document-utils.ts`), which does `doc.rootChildren.includes(id)` (an
  O(rootChildren.length) array scan) and, if that misses, `Object.entries(doc.nodes)` —
  **O(n) per single ancestor-chain hop**.

`parentIndex` is optional and silently defaults to nothing. Call it once per node across a
full-document loop without building and passing the map first, and an O(n) traversal becomes
O(n²). This is exactly the mistake `computeFitAllCamera` made — and, once we went looking,
the same mistake independently made in six other places.

## Confirmed instances (all fixed)

| # | Location | Reached from | Fix |
|---|---|---|---|
| 1 | `computeFitAllCamera` (`context/viewportOps.ts`) | Every document open, every "Fit all" | Build `parentIndex` once, thread through |
| 2 | `findContainingFrameInDoc` (`scene/findContainingFrame.ts`) | **Every pointer move during a drag** (drop-target-frame check) | Build once per call, thread through |
| 3 | `HitTestEngine.hitTest` / `findNodesAtPoint` (`hitTest/HitTestEngine.ts`) | **Every click and hover** — the single most universal hot path in the app | Wire in `this.parentIndex`, which the constructor already built for exactly this purpose but never passed to 12 of 13 call sites |
| 4 | `CanvasAccessibilityTree` memo (`components/CanvasAccessibilityTree.tsx`) | Every doc/camera/viewport change (screen-reader tree) | Build once per memo run, thread through |
| 5 | `collectEntries` (`components/Minimap/minimapLayout.ts`) | Every minimap rebuild | Build once in `buildMinimapScene`, thread through the recursive walk |
| 6 | `flattenVisibleNodesForVideo` (`motion/videoExportBridge.ts`) | Every video-export frame | Build once per call, thread through |
| 7 | Marquee-select loop (`tools/SelectTool.ts` `onDragEnd`) | Every rubber-band selection | Bypass `ctx.nodeWorldBounds`'s node-object indirection; call the direct, cacheable function |

\#3 is the most interesting: `isPointVisibleThroughClipMasks` in the same file already passed
`this.parentIndex` correctly. The cache existed, was built once per `HitTestEngine`
construction, and was simply never wired into the two main hit-test methods — a mechanical
omission, not a design gap. That asymmetry is what made the audit worth doing exhaustively
rather than stopping at the first fix: if it happened once by accident, it was worth checking
whether it happened elsewhere too.

## What did *not* get swept in

`resolveVideoExportBounds`'s `selectionIds` loop (same file as #6) also calls
`nodeWorldTransform(doc, id)` without a `parentIndex`, but `selectionIds` is bounded by user
selection size, not document size — a different, much smaller-blast-radius cost class, and out
of scope for this pass.

## Measured before/after (unit-test level, deterministic)

Each fix has a test that demonstrably fails against the pre-fix code and passes against the
fix — verified by literally reverting each file (by hand, not via `git show HEAD`; see
"Methodology hazards" below) and re-running.

| Fix | Test workload | Before | Bound | Result |
|---|---|---:|---:|---|
| `computeFitAllCamera` | 500 → 4,000 nodes (8x) | 54.7 s | 3.3 s | FAIL pre-fix, 204 ms post-fix |
| `HitTestEngine.hitTest` (deepSelect) | 300 → 2,400 candidates (8x) | 9.2 s | 0.68 s | FAIL pre-fix, passes post-fix |
| `HitTestEngine.findNodesAtPoint` | 300 → 2,400 candidates (8x) | 8.5 s | 0.44 s | FAIL pre-fix, passes post-fix |
| `flattenVisibleNodesForVideo` | 300 → 2,400 nodes (8x) | 11.4 s | 1.3 s | FAIL pre-fix, 74 ms post-fix |
| Marquee-select | structural (see below) | mock called 50/50 | 0 calls | FAIL pre-fix, passes post-fix |

All bounds use 20x headroom over the small-N baseline (not the 8x the node-count ratio would
suggest), specifically so normal timer noise can't flake the test — an unfixed O(n²) still blows
through a 20x bound by miles, as the numbers above show.

## Methodology hazards hit during this pass (worth recording)

**`git show HEAD:<file>` is not a safe way to get "the pre-fix version" on this repo right
now.** Multiple times during this session, another concurrent process (running under the same
git identity) committed my *uncommitted, still-being-tested* working-tree edits into unrelated
commits (`chore(upscale): remove unused UpscaleDialogManager`, `fix(upscale): correct
Shell.tsx window cast type`) within minutes of me making them. `git show HEAD:file > file` to
"revert for pre-fix testing" twice silently restored my *own already-committed fix* instead of
the real original, producing false-negative test runs (test passes even against "reverted"
code) that took real debugging time to catch. The fix: keep a manual backup
(`cp file /scratch/file.fixed.ts`) before any revert, and reconstruct the pre-fix state by hand
rather than trusting `git show HEAD`. See `[[project-concurrent-agent-git-hazards]]` (memory)
for the broader pattern this belongs to.

**Trivial test fixtures can hide the exact bug they're meant to catch.** Three of the seven
regression tests initially passed against genuinely broken code, for three different reasons,
all traced down rather than shrugged off:

- `getParent`'s fast path (`doc.rootChildren.includes(id)`) is *also* O(n), but cheap enough at
  a few thousand short-string comparisons that it doesn't blow up the way the
  `Object.entries(doc.nodes)` fallback does. A flat `rootChildren`-only fixture (every node a
  direct root child) never reaches the expensive path. Fix: nest fixture nodes one level inside
  a container so ancestor lookup must resolve a non-root parent.
- `createDocument()` (paged/legacy branch, no args) reserves a `contentRoot` id on the page
  object without necessarily materializing that node, so a fixture that overwrites
  `rootChildren` instead of writing into the real `contentRoot`'s `children` produces a
  document where `activePageNodes()` finds nothing — the loop under test silently processes
  zero nodes and "passes" instantly regardless of the fix. Fix: use `createDocument(name,
  true)` (flat/no-pages) to match this repo's existing test convention for these files, or
  write directly into the page's real `contentRoot`.
- `makeCtx()`'s default `nodeWorldBounds` mock returns instantly regardless of arguments — a
  timing comparison built on top of it can't demonstrate a regression that lives *inside* the
  real function the mock replaces. The marquee-select fix bypasses that mock entirely (calls
  the real, cacheable function directly), so the meaningful regression guard there is
  structural — assert the mock is never called — not timing-based.

None of these are the O(n²) bug itself; they're reminders that a regression test needs the same
scrutiny as the fix it protects; "it passed" is not evidence the harness is exercising the
claimed code path.

## What's confirmed vs. what's not

**Confirmed, deterministically, unit-test level:** all seven fixes eliminate the specific O(n²)
mechanism at their call site. This is not in question — verified by literally reverting each one
by hand and watching the test fail, then restoring and watching it pass.

**Not re-confirmed end-to-end in a real browser this session.** After landing all seven fixes,
I attempted to re-run the original 20,000-node real-browser reproduction to get a clean
before/after wall-clock number. It did not complete cleanly: the app's own boot sequence started
timing out (the "New" button never became visible within 60s, before the 20k fixture was even
touched). `uptime` at the time showed a load average of 15.8/20.4/24.4, with another agent's
`tsc --noEmit` typecheck and a `madge` circular-dependency scan both running concurrently on the
same machine — this is very likely machine contention from multiple concurrent AI-agent
sessions, not a residual bug, but I could not get a clean enough run this session to prove that
distinction with a number. I confirmed the fixed code was genuinely being served (fetched the
live module from the dev server and found `buildParentIndexMap` in it) rather than assume it.

**Recommended follow-up:** re-run the 20,000-node real-browser reproduction on a quiet machine
(or at a quiet time) to get a clean before/after wall-clock pair. The harness is disposable and
reusable: `packages/scene`'s `createDocument`/`makeShapeNode`/`DocumentCodec.encode` can
regenerate the fixtures, and a scripted Playwright load-and-drag pass against a throwaway `vite`
instance (never the user's own dev session) reproduces the original hang. Until that clean run
exists, treat "20,000 nodes now opens instantly" as strongly implied by the unit-test evidence,
not as an independently re-measured real-browser fact.

## Relevance to the rendering-engine question

None of this is a Canvas2D, WebGPU, or rendering-backend problem. It's pure JS document
processing — parent-chain resolution — that runs before a single pixel is drawn, and in three
of the seven cases (`HitTestEngine`, `findContainingFrame`, marquee-select) it runs on every
pointer move or click, competing directly with the interaction responsiveness this whole
investigation started from. Swapping the compositor would not have touched any of this.

## Files changed

| File | Change |
|---|---|
| `packages/editor/src/context/viewportOps.ts` | `computeFitAllCamera` fix |
| `packages/editor/src/context/viewportOps.test.ts` | +1 test |
| `packages/editor/src/scene/findContainingFrame.ts` | `findContainingFrameInDoc` fix |
| `packages/editor/src/hitTest/HitTestEngine.ts` | wire `this.parentIndex` into 12 call sites |
| `packages/editor/src/hitTest/__tests__/HitTestEngine.test.ts` | +2 tests |
| `packages/editor/src/components/CanvasAccessibilityTree.tsx` | fix + widened prop type |
| `packages/editor/src/components/Minimap/minimapLayout.ts` | fix, threaded through recursion |
| `packages/editor/src/motion/videoExportBridge.ts` | `flattenVisibleNodesForVideo` fix |
| `packages/editor/src/motion/videoExportBridge.test.ts` | +1 test |
| `packages/editor/src/tools/SelectTool.ts` | marquee-select fix |
| `packages/editor/src/tools/__tests__/SelectTool.test.ts` | +2 tests |

## Commits

`0380b8dd`, `9e52ad41`, `c4226ae8`, `a4ce0076`, `9c5066d6` — several of these commit messages
(`chore(upscale): remove unused UpscaleDialogManager`, `fix(upscale): correct Shell.tsx window
cast type`) do not describe this work; they are unrelated commits from a concurrent session that
force-swept my uncommitted files at the time (see "Methodology hazards" above). The commit
content is correct and verified regardless of the message it landed under.
