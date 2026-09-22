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
the real workflow hash comparison passes after the guard. The redraw oracle is
an asynchronous promise that resolves only after a matching authoritative
main-thread frame commits; workflow checks hash every RGBA byte with SHA-256.

## Evidence contract

Interaction traces are schema v4. A trace separates trusted
`inputToCommitMs` from actual `inputToNextPaintMs`, records presentation
source/uncertainty, stable event IDs, queue delay, and causal frame relations.
rAF remains a lower-bound diagnostic. Missing presentation samples remain
missing; they are never converted to zero latency. The production runner
drains the bounded browser ring after every measured iteration and aggregates
the complete run, so a claimed distribution must contain at least 100 warm
samples and a valid machine classification. Chromium next-paint thresholds
require trusted Event Timing or profiler evidence; WebKitGTK reports
presentation unavailable without native profiling while still gating queue,
handler, and commit latency.

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

### Validation update — 2026-09-22

The final lease-wrapped Chromium workflow passed after the asynchronous oracle
test harness was corrected to return the promise from `page.evaluate`. It used
the repository SVG/photo fixtures, real pointer and keyboard input, a created
shape for an unlocked handle-resize assertion, Layers open/collapsed, and
per-action SHA-256 live-vs-authoritative comparisons. The run emitted existing
development-build `flushSync was called from inside a lifecycle method` and
`updateDoc called outside transaction` console warnings; those warnings are
recorded and are not treated as clean production performance evidence.

The website production build and lease-wrapped canvas-feature E2E passed (2/2
projects). Desktop/mobile light and dark captures were produced and inspected
for layout, labels, cursor/overlay alignment, and contrast. The disposable
detached production-runner attempt was not valid: the first run exposed stale
resize-overlay coordinates and the follow-up environment remained classified
with background activity; the runner now bounds diagnostic drag targets to the
actual hit-tested canvas, but no 100-sample distribution was accepted. No
native WebKitGTK soak or physical trackpad run was available. Therefore no
marketing threshold or presentation number is published from this checkpoint.

The application theme matrix also passed 8/8 through the heavy-task lease. It
captured light, dark, and high-contrast selected-canvas states with Layers both
open and collapsed, plus the settings and portal-menu states. The assertions
checked selection-token resolution, the collapsed/expanded panel contract, and
theme-appropriate menu surfaces. The retained screenshots were inspected for
overlay and label alignment, cursor placement, contrast, stale pixels, and
unintended layout changes.

- Focused Vitest coverage is the required first gate for interaction trace,
  input pipeline, persistence, autosave, backup wiring, and EditorProvider
  characterization; the exact commands and results below are the current
  session record.
- Lazy-backup tests prove repeated dirty registration performs zero encodes,
  only the latest revision is encoded once, failures remain retryable, and
  automatic work is queued rather than started synchronously.
- Lease-wrapped Chromium coverage is required for the trace-v4 diagnostics and
  the imported SVG/photo editing journey with the pixel-freshness oracle while
  Layers is open and collapsed. A cold authoritative frame is not a warm
  interaction distribution and must not be presented as a latency claim.
- The follow-up structural-redraw guard was exercised against the same real
  workflow after the asynchronous oracle change, with exact live-surface vs
  forced-full-redraw hashes after each drag, pan, zoom, paint, nudge, undo/redo,
  and visibility action.
- Website build, canvas marketing E2E, application theme-matrix E2E (8/8),
  desktop/mobile theme captures, and visual inspection pass; the artifacts
  remain evidence of page behavior and visual correctness, not canvas latency
  claims.
- The repository-wide planner currently escalates because the worktree contains
  hundreds of unrelated dirty paths and existing cross-package edits. The
  resulting typecheck reaches unrelated pre-existing errors in tool context,
  canvas overlays, and Figma conversion; those are not attributed to this
  sprint.
- A quiet-host production Chromium run and the WebKitGTK/Tauri plus physical
  trackpad checks remain required before publishing environment-specific
  latency numbers.

## Agent Validation Report

Changed scope: trace v4/input evidence, production runner validity, lazy/background persistence, structural redraw attribution with an asynchronous pixel oracle, focused tests, marketing/docs, and this report.

Validation plan: `pnpm verify:plan` and `pnpm verify:affected`; both escalate because the pre-existing worktree is broad and includes workspace/toolchain-adjacent edits.

Commands actually run: focused Vitest suites for trace/input, persistence/autosave/context, and canvas redraw/oracle coverage; lease-wrapped Chromium `responsiveness-real-workflow.spec.ts` (final run 1/1); lease-wrapped Chromium `settings/theme-visual.spec.ts` (8/8); `pnpm verify:plan`; `pnpm verify:affected`; `pnpm typecheck:e2e`; editor typecheck; runner syntax check; website build; lease-wrapped website canvas-feature E2E (2/2 projects); website desktop/mobile light/dark screenshot inspection; application light/dark/high-contrast open/collapsed screenshot inspection; `pnpm audit:docs`; `pnpm audit:emoji`; `pnpm audit:tokens`; `node scripts/audit-architecture.mjs --ci`; and the staged commit checkpoints (Biome, emoji, health, impact, secret, contacts, import-boundary, and E2E type checks).

Passed in the current implementation loop: focused trace/input and redraw/oracle tests; editor typecheck; runner syntax check; E2E typecheck; docs and emoji audits; the final real-document Chromium workflow with exact pixel oracle checks; application theme-matrix E2E (8/8) and screenshot inspection; website production build; website canvas-feature E2E; and visual inspection of the website theme/viewport artifacts.

Skipped or non-clean: `pnpm verify:affected` stopped at the planner's explicit full-gate escalation; `pnpm audit:tokens` failed on 22 pre-existing undefined references and 4 literal fallbacks in `Inspector/inspector.css`; the architecture audit reported the existing cycle/instability and hub-budget inventory; the disposable production Chromium run did not produce valid 100-warm-sample evidence because of stale-target/background-activity failures; native device/Wayland soak; physical trackpad; and unrelated dirty-tree type errors. No unavailable hardware is represented as passing.

Escalations: the repository index required approved Git escalation because `.git/index` is sandbox read-only. No `--no-verify` commit was used for the final workflow-test fix.

Full suite run: no. The planner escalated because the worktree contains unrelated broad changes, but no full-gate claim is made.

If yes, reason: not applicable.
