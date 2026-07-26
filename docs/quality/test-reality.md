# Test Reality Check — Does the Suite Catch Real Regressions?

Companion to `docs/quality/report-audit.md`. That report found the "98.5% reached by tests" claim
meant *imported by a test file*, not *asserted against*. This report measures the actual thing:
if `EditorProvider` (Ca=87) or `CanvasArea`'s render path breaks, does anything fail?

## TL;DR — go/no-go

**NO-GO on both Phase 3 refactors as currently scoped**, on direct evidence, not inference:

- **EditorProvider**: 3 of 4 injected representative bugs went **completely uncaught** — including a
  stale-closure bug in the auto-save/backup effect and a context-identity bug, the two failure
  modes this exact kind of refactor is most likely to introduce. Only a bug that made state updates
  a hard no-op was caught (and caught loudly, by 21 tests).
- **CanvasArea**: **all 3 injected rendering bugs were uncaught** — reversed paint order, a
  hardcoded blend mode, and swapped frame/group node handling. Existing CanvasArea tests check that
  the compositor's lifecycle methods were *called*, not what they were called *with*. There is
  currently no safety net for visual correctness in this file at all.

Minimum characterization tests to flip this to a go are listed in §5.

---

## 1. Mutation testing

Set up via Stryker Mutator (`@stryker-mutator/core` + vitest runner, dev-dependency only,
config at `stryker.conf.json`), scoped to hotspot files only, per the instruction not to run this
across whole packages. Two real environment issues had to be fixed before it would run at all:
Stryker's default file-copy swept up actively-changing Rust `target/` build directories (collided
with a concurrent `cargo-llvm-cov` run elsewhere in this session — added `ignorePatterns`), and the
vitest-runner plugin wasn't auto-discovered under this repo's pnpm layout (had to be listed
explicitly in `plugins`).

| File | Mutants | Killed | Survived | No coverage | Mutation score |
|---|---|---|---|---|---|
| `packages/scene/src/masks.ts` | 1,638 | 1,129 | 375 | 131 | **69.11%** |

Compare to `report-audit.md`'s measured branch coverage for `scene`: **72.4%**. For this
specific file, mutation score and coverage are close — not the dramatic gap the report-audit
predicted in general. The 131 "no coverage" mutants (8%) are the cleanest, least ambiguous
signal: code the tests never execute at all, distinct from code that's executed but not verified.

**Concrete survived mutants** (tests ran, didn't notice the change — this is the actionable part,
not the percentage): a type-guard (`value !== null && typeof value === 'object'`) weakened to
`|| !Array.isArray(value)` and to a bare `true`, both survived — boundary/type-guard logic is
exercised but not verified. Three separate `ConditionalExpression` mutations to `true` at
lines 109-111 all survived — branches get executed, their actual conditions are not checked. A
`UnaryOperator` (negation) mutation at lines 131-132 also survived.

**Not completed, and why**: `packages/engine/src/replay.ts` and
`packages/editor/src/CanvasArea.tsx`/`context.tsx` were not run. `masks.ts` (1,266 lines) took 18
minutes for 1,638 mutants; `replayIr` alone (~250 lines within replay.ts's 3,218) and
`replaySubtreeToCtx` (600 lines within CanvasArea.tsx) would each realistically take 20-40 minutes
scoped, and `EditorProvider` effectively *is* the entire 7,862-line `context.tsx` — there's no
representative bounded slice to run instead of the whole file, which would take multiple hours.
Stryker can't run two mutation passes concurrently against the same working directory (shared
`.stryker-tmp` sandbox), so these would need to run sequentially, not in parallel, on top of an
already long session. **This is itself a finding, not just a scheduling note**: getting a real
mutation score for the two functions this refactor is actually about costs multiple hours of
dedicated, uncontended machine time. Ready-to-run commands are on file for a follow-up session:
`npx stryker run --mutate "packages/engine/src/replay.ts:986-1237"` and
`npx stryker run --mutate "packages/editor/src/CanvasArea.tsx:1649-2248"`.

---

## 2. Assertion quality sweep

Static analysis only, across all 792 test files, 16 packages.

| Category | Count | Notes |
|---|---|---|
| Test files with zero assertions | **0** | Every test file has at least one `expect`/`assert` somewhere. |
| Snapshot-only tests | **5** | All in `packages/editor/src/menu/__tests__/{menuSnapshot,nativeAdapter}.test.ts` — spot-checked, these are full serialized menu-tree structures per state combination, not rubber-stamped single-primitive snapshots. Whether they've been *reviewed* on update isn't statically determinable. |
| `toBeDefined`/`toBeTruthy`/`not.toThrow` as sole assertion | **392** | Concentrated in `editor` (234) and `engine` (63). |
| Render-with-no-assertion | **4** | `GradientEditor.test.tsx` (×2), `GradientMapEditor.test.tsx` (×2). |
| `it.skip`/`test.skip`/`it.todo`/commented-out | **1** | `scene/intelligence/debtScanner.test.ts`. |
| Missing-await-on-async (spot-checked, hard to detect reliably) | **1** confirmed | `editor/components/__tests__/BatchBgRemoveDialog.test.tsx: "cancel during processing"` — worth a human look, not fully confirmed as a false-pass. |

### Assertion density per covered branch (worst first)

Formula: `(estimated real expect()/assert() count) / (test files × branch-coverage-fraction from report-audit.md §4)` — a proxy for "how many assertions exist per unit of branch coverage achieved." Lower = more coverage riding on thinner verification. A proxy, not a precise metric.

| Rank | Package | Files | Tests | Assert/file | Branch cov% | Density/covered-branch | Trivial-only tests |
|---|---|---|---|---|---|---|---|
| 1 | print | 2 | 11 | 6.5 | 60.6 | **10.73** | 0% |
| 2 | home | 21 | 125 | 11.9 | 70.2 | **16.96** | 25.6% |
| 3 | ui | 32 | 288 | 15.4 | 71.0 | **21.70** | 11.5% |
| 4 | compositor | 6 | 43 | 16.5 | 70.0 | **23.57** | 2.3% |
| 5 | help | 2 | 31 | 24.5 | 89.3 | **27.44** | 6.5% |
| 6 | import | 15 | 131 | 18.6 | 65.0 | **28.62** | 4.6% |
| 7 | editor | 360 | 3547 | 20.0 | 65.5 | **30.50** | 6.7% |
| 8 | ai | 2 | 19 | 17.0 | 53.4 | **31.84** | 0% |
| 9 | prototype | 15 | 243 | 24.1 | 75.0 | **32.18** | 0.8% |
| 10 | engine | 191 | 2314 | 25.4 | 77.1 | **32.91** | 2.7% |
| 11 | codegen | 24 | 240 | 24.1 | 71.9 | **33.50** | 1.7% |
| 12 | platform | 8 | 150 | 39.4 | 77.1 | **51.07** | 0% |
| 13 | shared | 29 | 679 | 45.8 | 88.7 | **51.63** | 0% |
| 14 | scene | 85 | 1522 | 38.2 | 72.4 | **52.76** | 0% |

`layout`/`collab` excluded (0 test files). **`home` (25.6% trivial-only, rank 2) is the cleanest,
strongest signal in this sweep; `ui` (11.5% trivial, rank 3) is the second.** `editor` — the
package that owns both refactor targets — sits mid-table (rank 7), not the worst, but with the
largest absolute number of thin (`toBeDefined`-only) assertions (234) of any package.

---

## 3. Bug-injection gate tests — the honest safety-net check

Method: created an isolated git worktree (`.worktrees/gate-test`, discarded after use — the main
tree was never touched), established a clean baseline against the 53 test files that actually
import `context.tsx`/`CanvasArea.tsx` (recounted from the plan's assumed sets), injected one
representative bug at a time, re-ran the same 53 files, diffed against baseline, reverted.

**Baseline** (unmodified code): 336/346 tests pass; 9 pre-existing failures across 3 files
(`context.import.test.tsx` ×5, `createActionHandlers.test.ts` ×2, `IntelligencePanel.test.tsx`
×2) — unrelated to anything touched here, present before any injection.

### EditorProvider (`context.tsx`)

| # | Injected bug | Result | New failures |
|---|---|---|---|
| 1 | `updateDoc` computes the new document but discards it (`document: s.document` instead of `document: newDoc`) | **CAUGHT** | 21 tests, 6 files (`adjustment.test.tsx`, `AdjustmentPanel.test.tsx`, `applyFramePreset.test.tsx`, `pageConfig.test.tsx`, `InteractionSection.test.tsx`, and one more) |
| 2 | Auto-save/backup effect's dependency array drops `state.document` (backup silently serializes a stale document after edits) | **NOT CAUGHT** | 0 |
| 3 | Context value's `useMemo` deps drop `bgRemoval` (consumers of that sub-value get a stale reference after it changes) | **NOT CAUGHT** | 0 |
| 4 | Swapped declaration order of two independent `useEffect` hooks (selection-based abort handlers for bg-removal vs. image-processing) | No difference (expected — these two are genuinely independent; not evidence of a gap, evidence the pair was a poor test case) | 0 |

### CanvasArea (`CanvasArea.tsx`)

| # | Injected bug | Result | New failures |
|---|---|---|---|
| 5 | Reversed paint order for a frame's children | **NOT CAUGHT** | 0 |
| 6 | Blend mode hardcoded to `'normal'`, ignoring the node's actual `blendMode` | **NOT CAUGHT** | 0 |
| 7 | Swapped which branch `'frame'` vs. `'group'` nodes are handled by | **NOT CAUGHT** | 0 |

(An 8th planned injection — dropping a `ctx.transform(...)` call — was not executed; time-boxed
in favor of covering breadth across both files. Flagged as not attempted, not as a negative
result.)

**Reading this honestly**: the one bug that was caught is also the most catastrophic and least
subtle — a document edit that produces no visible change at all trips assertions in six unrelated
feature-area tests, because so much of the suite indirectly depends on documents actually
persisting. That's a strong signal for gross breakage, and a near-zero signal for the kind of
*subtle* regression a context-splitting refactor is actually likely to introduce (a stale value
here, a dropped dependency there, a visual detail that's wrong but not absent). Every bug in that
subtler category — exactly the ones called out by name in the strangler-fig plan's own risk list
(stale closures, context value identity) — went straight through.

---

## 4. Flake audit

Budget reality: a full-suite run costs ~16 minutes; 20 of them would be 5+ hours, worse under the
CPU contention from mutation testing running concurrently in this same session. **2 runs
completed, not 20** — this is a lower bound, not a real flake census, and is explicitly not
sufficient to clear a test as non-flaky, only to catch the flakes unlucky enough to flip between
these exact two runs.

- Run 1: full monorepo, 9,746 tests, 952s, 31 failed.
- Run 2: scoped to editor+scene+engine, 7,763 tests, 308s, 22 failed.

| Test | Flip | Likely cause |
|---|---|---|
| `replay bench 100 rects — replay under 50ms p95` (`engine/src/bench/replay.bench.ts`) | failed → passed | Timing-threshold assertion, contention-sensitive by construction |
| `FramePresetsSection saves the selected frame size as a named custom preset (resize mode)` | failed → passed | Cause not identified — no obvious timing keyword, needs dedicated follow-up |

**Separate, more important finding than the 2 flakes**: 22-31 tests fail *consistently* in every
run (not flakily) — several are the same shape as the confirmed-flaky replay bench (e.g.
`LayersPanel`'s "deep clone 1K node subtree completes under 100ms"), i.e. performance-threshold
assertions that are structurally prone to flake but happened not to flip in this 2-run sample.
**This repo's suite currently does not pass cleanly on a single run**, independent of anything
this audit touched — that's a pre-existing-failures problem, distinct from flakiness, and worth
its own triage before it's used as a refactor gate for anything.

---

## 5. Minimum characterization tests to flip no-go → go

In priority order, cheapest-to-write and highest-signal first:

1. **A test that asserts the auto-save/backup payload matches `state.document` after an edit**,
   not just that `notifyEdit()`/`markDirty()` were called. This is the exact bug #2 gap — closes
   the single most consequential blind spot found here, since a stale backup after a refactor is
   silent data loss discovered only when a user tries to recover from one.
2. **Context-identity tests per sub-context**: for each field/value forwarded through
   `useEditor()`'s memoization (and, going forward, each sub-context's own memo), a test that
   changes the underlying source and asserts the reference *does* change, and a test that changes
   something unrelated and asserts it *doesn't*. This is bug #3's gap and is also literally
   listed as a required characterization in the companion Prompt 4 surface-mapping work.
3. **A CanvasArea pixel/structural regression check** — even a minimal one (a draw-call-sequence
   recorder, per the later visual-regression harness task, or a coarse pixel-hash comparison) for
   at least paint order, blend mode, and node-kind routing. Right now there is *no* test in this
   repo that would fail if these three were silently broken. This is the highest-value gap of the
   entire audit — CanvasArea is the actual render path and currently has zero correctness
   verification, only call-count verification.
4. **Effect-ordering assertions where order is load-bearing** — the two effects tested here (bug
   #4) turned out to be independent, which is good, but it means this specific risk (enumerated
   explicitly in the strangler-fig plan) hasn't actually been tested yet. Needs a genuinely
   order-coupled pair identified during the Prompt 4 characterization pass, not a re-run of this
   same negative result.
5. **Stabilize or explicitly quarantine the timing-threshold tests** (`replay bench`, `LayersPanel`
   deep-clone) before relying on a clean suite run as a refactor gate — as flagged in §4, these are
   structurally flake-prone and currently contribute to a >20-test steady-state failure count that
   makes it hard to tell a real regression from noise during a refactor's actual PR sequence.

None of these are large lifts individually — 1 and 2 are a day or two of focused test-writing; 3
is the one that needs real infrastructure (see the separate visual-regression harness work this
audit chain is feeding into). Until at least 1-3 exist, "the tests pass" on an EditorProvider or
CanvasArea refactor PR is not evidence of behavior preservation for the specific failure modes
this exercise was designed to check.
