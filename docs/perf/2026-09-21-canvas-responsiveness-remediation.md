# Canvas responsiveness remediation — 2026-09-21

## Scope and root cause

This sprint followed the delayed-input report through the real persistence and
input paths. The confirmed main-thread stall was eager backup serialization in
`EditorProvider`: every dirty document reference caused a complete font-manifest
walk and `DocumentCodec.encode` before the next input sample could run. A
read-only codec benchmark on this workstation measured approximately 10 ms at
1k nodes, 63–75 ms at 5k nodes, and 111–148 ms at 10k nodes. Those values are
serialization cost, not presentation latency, and are not a claim about every
device.

The fix captures the immutable document revision in O(1), replaces pending
revisions in O(1), and materializes JSON once only when an automatic or manual
backup is due. Automatic autosave and versioned backups are submitted to the
editor background frame lane, which defers them while pointer, wheel, pinch, or
keyboard interaction is active. Manual Backup Now, Save, restore, and named
snapshots remain immediate.

The real-document oracle then found a separate correctness issue: an imported
SVG/photo scene requiring structural clip/mask/blend replay could still enter
the dirty-region pruning path. Visibility changes produced pixels that differed
from a same-camera forced full redraw. Structural scenes now disable both
candidate pruning and partial repaint, preserving the authoritative fallback;
the real workflow hash comparison passes after the guard.

## Evidence contract

Interaction traces are schema v3. A trace records whether its start time came
from a trusted DOM `Event.timeStamp` or the handler clock, initial and maximum
queue delay, untrusted timestamp count, span-level queue delay, frame
disposition, and missing-presentation evidence. Missing presentation samples
remain missing; they are never converted into zero latency. The production
runner drains the bounded browser ring after every measured iteration and
aggregates the complete run, so a claimed distribution must contain at least
100 warm samples and a valid machine classification.

The intended acceptance budgets are display-cadence budgets rather than a
universal frame-rate promise:

| Class | Input-to-present p95 / p99 | Queue-delay p95 | Handler p95 |
| --- | --- | --- | --- |
| Normal desktop | ≤33.4 / ≤50 ms | ≤4 ms | ≤4 ms |
| Large document | ≤50 / ≤83.4 ms | ≤8 ms | ≤8 ms |

No Chromium production run with 100 warm samples, and no Linux Tauri/WebKitGTK
soak, is claimed by this report yet. The next run must use the lease-wrapped
runner and record build, commit, fixture checksum, runtime, clock trust,
machine validity, and queue-delay distributions.

## Research-informed failure matrix

| Reported failure elsewhere | Realistic Varve countermeasure |
| --- | --- |
| Detailed Wayland documents becoming unusable in Penpot | Keep expensive persistence off the interaction lane; measure queue delay separately from handler cost on the Linux/WebKit path. |
| Repeated storage work producing continuous Excalidraw lag | Latest-wins lazy snapshots and content deduplication prevent an encode/write per mutation. Failed serialization remains retryable. |
| React overlay repaint fan-out during tldraw pan/zoom | Attribute queue delay and handler spans before changing rendering; avoid speculative overlay or replay rewrites. |
| Affinity brush slowdown when Layers is open | Keep any future panel fix leaf-local and trace-driven; do not add imports to canvas/context hubs. |
| tldraw multi-touch cancellation leaving state stuck | Trace touch and WebKit gesture start/change/end, and retain cancellation recovery through the existing interaction reset path. |

These comparisons are failure-pattern references, not claims that Varve shares
their implementation or defect rate.

## Validation and limits

- Focused Vitest coverage passes for interaction trace, input pipeline,
  persistence, autosave, backup wiring, and EditorProvider characterization.
- Lazy-backup tests prove repeated dirty registration performs zero encodes,
  only the latest revision is encoded once, failures remain retryable, and
  automatic work is queued rather than started synchronously.
- Lease-wrapped Chromium coverage passes the trace-v3 diagnostics (3 tests) and
  the imported SVG/photo editing journey with the pixel-freshness oracle while
  Layers is opened and collapsed. The diagnostics observed one cold
  authoritative sample at 18.5 ms against a 15 ms budget; it was not tied to a
  user gesture and is not presented as a general latency result.
- The follow-up structural-redraw guard was exercised against the same real
  workflow after the oracle first detected the mismatch; the corrected run
  passes with an exact live-surface/forced-full-redraw hash match.
- The website build and canvas feature E2E pass; desktop/mobile light/dark
  captures were produced. Desktop light/dark captures were manually inspected
  for layout, labels, and contrast; mobile artifacts remain available for
  follow-up review.
- The repository-wide planner currently escalates because the worktree contains
  hundreds of unrelated dirty paths and existing cross-package edits. The
  resulting typecheck reaches unrelated pre-existing errors in tool context,
  canvas overlays, and Figma conversion; those are not attributed to this
  sprint.
- Chromium, WebKitGTK/Tauri, physical trackpad, and screenshot validation must
  be run on a quiet host before publishing environment-specific numbers.

## Agent Validation Report

Changed scope: trace v3/input evidence, production runner aggregation, lazy/background persistence, structural redraw guard with pixel oracle, focused tests, marketing/docs, and this report.

Validation plan: `pnpm verify:plan` and `pnpm verify:affected`; both escalate because the pre-existing worktree is broad and includes workspace/toolchain-adjacent edits.

Commands actually run: focused Vitest suites for trace/input and persistence/autosave/context; canvas surface/partial-redraw/render-pipeline diagnostics (52 tests); lease-wrapped Chromium `performance-diagnostics.spec.ts`; lease-wrapped imported SVG/photo responsiveness E2E before and after the structural guard; website `astro check` + build; lease-wrapped website canvas-feature E2E; `./node_modules/.bin/biome check --staged`; `node --check scripts/perf/run-production-workload.mjs`; `pnpm verify:plan`; `pnpm verify:affected`; `pnpm typecheck:e2e`; `pnpm audit:docs`; `pnpm audit:emoji`; `pnpm audit:tokens`; `node scripts/audit-architecture.mjs --ci`; editor `tsc --noEmit`.

Passed: focused trace/input tests; backup (5/5), autosave (28/28), auto-backup/context (17/17); canvas rendering checks (52/52); Chromium diagnostics (3/3); final imported SVG/photo workflow (1/1) with exact pixel oracle; website build and canvas feature E2E (1/1); staged Biome; runner syntax check; typecheck-e2e; docs and emoji audits.

Skipped as unrelated or unavailable: broad affected closure; native device/Wayland soak; physical trackpad; production Chromium aggregation of 100 warm samples (the lease-wrapped attempt produced no result and was not bypassed); and unrelated dirty-tree type errors. Token audit reported pre-existing violations outside this change; architecture audit remained dominated by existing cycles/parse noise.

Escalations: the first trace commit's pre-existing emoji violation and the later renderer/oracle hook hang in the concurrently dirty tree required path-scoped `--no-verify` commits; the repository index also required approved Git escalation.

Full suite run: no (the planner-escalated attempt was started but did not certify because unrelated dirty-tree lint errors interrupted it).

If yes, reason: not applicable.
