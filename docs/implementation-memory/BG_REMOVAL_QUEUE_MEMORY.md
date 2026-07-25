# Background Removal Queue Memory

## 2026-07-10 — Stuck "queuing" state fix

### Root cause

Three missing `processQueue()` calls in `workerPool.ts`:

1. **Dispatched job timeout** (line ~300): When a dispatched job's timeout fired
   (10s cold start / 60s warm), the worker was freed (`busy = false`) but
   `processQueue()` was never called. Any queued (UNASSIGNED) jobs in the
   `pending` array remained stuck until their own 120s queue timeout.

2. **Dispatched job abort** (line ~328): When a dispatched job was cancelled
   via AbortController, same missing `processQueue()` — the freed worker
   never picked up queued jobs.

3. **Queued job abort** (line ~271): When a queued (not yet dispatched) job
   was cancelled, other queued jobs were not re-evaluated for dispatch.

### Symptoms explained

- **"queuing" stuck in inspector panel**: If the user had two background
  removal jobs in flight (e.g., from two separate UI interactions), the
  second job would queue but never dispatch when the first timed out.
- **"complete"/"fail" dialog mismatch**: After a timeout, the worker's
  eventual late-arriving response would match no pending job (already
  removed by the timeout handler), triggering the defensive branch in
  `onWorkerMessage` which frees the worker but does not propagate the
  stale result to the UI. The UI had already shown a timeout error.

### Changes made

- `packages/engine/src/backgroundRemoval/workerPool.ts`:
  - Added `processQueue()` after dispatched job timeout handler
  - Added `processQueue()` after dispatched job abort handler  
  - Added `processQueue()` after queued job abort handler
  - Changed `cancelAllWorkerJobs()` to copy-then-clear so abort handlers
    don't double-reject

- `packages/engine/src/backgroundRemoval/__tests__/workerPool.test.ts` (NEW):
  - Test: queued job dispatched after running job times out
  - Test: queued job dispatched after running job aborted
  - Test: queued jobs dispatched after a completed job frees the worker

### Verification

- All 3 new worker pool tests pass
- All 211 existing bg-removal tests pass (25 files)
- All 830 engine tests pass (66 files)
- All 45 editor bg-removal tests pass (3 files)
- `pnpm typecheck` clean on all packages
- `pnpm lint` — 0 new errors on changed files
- `pnpm audit:emoji` clean (1052 files)

### Next actions

- No further bg-removal queue work needed. The three missing `processQueue()`
  calls were the only gap between the pool architecture and correct queue
  draining.
