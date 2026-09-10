# Input latency and console flood — investigation, 2026-07-26

Scope: canvas interaction latency, Alt-drag duplication, and the reported
console flood (`[Warning] 7960 console messages are not shown.`).

Measurement environment: CachyOS (Linux 7.1.3), Wayland, dev Vite server on
`:1420` driven by a scripted Playwright/Chromium session (separate tab; the
developer's own `tauri:dev` WebKitGTK window was left untouched). Timings
include Playwright CDP overhead and the machine was under concurrent load from
other agents' typecheck/audit runs, so absolute milliseconds are **directional**
— the console counts and node/undo counts are exact.

Scenario: open editor, drag-create a rect, click-select, 40-step drag,
40-step Alt-drag, undo.

## Result summary

| Metric | Before | After |
|---|---:|---:|
| Console messages, whole session | 4249 | 11 |
| Console messages during drag | 2339 | 0 |
| Console messages during Alt-drag | 1194 | 0 |
| Console messages while idle | 3 | 3 |
| Drag wall-clock (40 moves) | 12345 ms | 7016 ms |
| Alt-drag wall-clock (40 moves) | 8059 ms | 7159 ms |
| Duplicates created per Alt-drag | 1 | 1 |
| Alt-drag copy tracks the pointer | no | yes |

The 11 remaining messages are all one-time boot diagnostics: Vite HMR connect
(2), React DevTools notice (1), WebGPU `No available adapters` (4, expected in
headless Chromium), the WASM-engine fallback notice (1), a genuine shortcut
collision (1), plus 2 idle repeats of the Vite lines. Nothing is emitted by any
pointer, render, or undo path.

## Confirmed root causes

### 1. Audit rules re-registered on every editor state change

`Shell.tsx` registered actions, shortcuts and audit rules inside an effect keyed
on `[editor, editorHelp]`. The editor context value is a new object on every
state update, so the effect re-ran on **every pointer move during a drag**.
`registerBuiltinRules()` then re-registered all ~28 built-in audit rules, and
`registerRule` logs `[audit] Overwriting rule: <id>` for each one that already
exists — roughly 28 warnings per pointer move.

This accounted for essentially the entire flood: 153 repetitions of each of ~28
distinct rule-id messages. It also burned main-thread time formatting messages
inside the interaction path, and re-ran `createActionHandlers` per pointer move.

Fix: `registerEditorActions` still receives the fresh context (its handlers
close over it), but `registerAllShortcuts` and `registerBuiltinRules` are
context-independent and now run exactly once, preserving the ordering constraint
documented in AGENTS.md (real handlers before no-op stubs). `registerAllShortcuts`
is fully `!r.has(id)`-guarded, so running it once is behaviourally identical.

### 2. A WebGL context leaked on every rendered frame

`adaptiveProfile.detectPlatformCapabilities()` did
`document.createElement('canvas').getContext('webgl')` on every call, never
released it, and is reached from `computeProfile()` — which runs **once per
rendered frame** from `CanvasArea.drawContent`. Browsers cap live WebGL contexts
(Chromium ~16) and force-lose the oldest past the cap, which is why
`WARNING: Too many active WebGL contexts. Oldest context will be lost.` appeared
109 times during a single drag once the audit flood stopped masking it.

Fix: capabilities are detected once and cached for the session (the same
cache-once pattern `tools/inputNormalizer.ts` already used), and the probe
context is explicitly released via `WEBGL_lose_context`.

This one was invisible until cause 1 was fixed — a good argument for fixing
floods at the source rather than filtering them.

### 3. Alt-drag duplicates never followed the pointer

Observed: with the pointer dragged to ~(590,385), the copy sat at (170,170) —
`duplicateSelected()`'s fixed +20/+20 offset — while the *original* was the node
that got displaced. This is materially worse than the reported "delayed
duplicate": the copy never tracked the pointer at all.

Two causes, both in `SelectTool.onDragMove`:

- `duplicateSelected()` re-selects the clones through `setState`, so the new ids
  are not observable on the frame that fires it. The still-selected originals
  were moved on that frame, dragging them out from under the copy.
- Once the clones did become the selection they had no `initialPositions` entry
  (that map is keyed on ids captured at pointer-down), so every loop iteration
  hit `continue` and nothing moved for the rest of the gesture.

Fix: the gesture is handed to the clones as soon as they appear in the
selection; each clone inherits the drag origin recorded for the node it was
cloned from. `duplicateSelected` builds the new selection in source order, which
makes that correspondence reliable. Interrupted gestures reset the pending
handoff at the next pointer-down.

## Open defects found but NOT fixed (ownership / decision required)

### A. One gesture produces several history entries, including no-op undos

Measured by counting undos that change the rendered canvas:

| Gesture | Undos to restore pre-gesture state | Notes |
|---|---:|---|
| Plain drag (move only) | 3 | the **first** undo changes nothing visible |
| Alt-drag (duplicate + move) | 5 | undos 2 and 3 change nothing visible |

Target is one undo per gesture. `duplicateSelected` already correctly skips its
undo push inside a transaction ("Fix C1" in `context.tsx`), so the extra entries
come from the transaction commit path itself, not from duplication.

**Not fixed deliberately.** This is the transaction/history manager in
`context.tsx`, and a concurrent agent is actively working exactly this area —
they have an uncommitted `context/useHistory.ts` extraction plus
`context/__tests__/transactionHistoryRegression.test.tsx`, whose single test is
"undoes a transform on the first undo after commit", i.e. the same no-op-first-undo
symptom. Editing it here would collide with live work. The measurements above are
recorded so that agent can use them as an acceptance check; the Alt-drag row
should reach 1 once the plain-drag row does.

### B. Genuine shortcut collision

`flattenSelection` and `toggleDistractionFree` are both bound to
`Ctrl+Shift+F` (`ShortcutManager.ts:120` and `:338`). `ShortcutManager` detects
and reports this correctly at boot — the warning is a real signal, not noise.

**Not fixed deliberately.** Which action loses the binding is a product/UX
decision rather than a bug fix, and another agent is concurrently adding entries
to that same table (`reopenLast`).

## Verified NOT to be causes

- **Logging in hot paths.** Only 48 `console.*` call sites exist in non-test
  source, and the two in genuinely hot code are already guarded: `replay.ts`'s
  outside-stroke warning is once-only via `_strokeAlignWarned`, and
  `useFlatTree.ts`'s flatten warning is dev-only and thresholded at 50 ms.
  Neither fired during the benchmark.
- **Idle CPU.** Idle emitted 3 messages in 3 seconds both before and after, all
  Vite HMR; no evidence of an idle repaint loop from this instrumentation.

## Files changed

| File | Change |
|---|---|
| `packages/editor/src/Shell.tsx` | run context-independent registrations once |
| `packages/editor/src/canvas/adaptiveProfile.ts` | cache capabilities; release probe WebGL context |
| `packages/editor/src/canvas/__tests__/adaptiveProfile.test.ts` | +3 tests |
| `packages/editor/src/tools/SelectTool.ts` | Alt-drag clone handoff |
| `packages/editor/src/tools/__tests__/SelectTool.test.ts` | +7 tests |
| `crates/strata-core/src/align.rs`, `crates/strata-sync/src/lib.rs` | rustfmt only (unblocked the pre-push gate) |

## Verification run

- `vitest run packages/editor/src/tools packages/editor/src/canvas` — 572 passed,
  1 skipped, 0 failed.
- `biome check` clean on every file changed here.
- The 7 new Alt-drag tests were re-run against the pre-fix `SelectTool.ts`: 5 of
  them fail, confirming they actually catch the regression rather than merely
  describing current behaviour.
- Alt-drag verified end-to-end against the running dev server, including a
  before/after screenshot of the copy's final position.

## Caveats

- Chromium/Vite, not the WebKitGTK Tauri runtime. WebGPU was unavailable in this
  environment (`No available adapters`), so the Canvas2D path is what was
  exercised. The WebGL-context leak is renderer-independent (it was a probe, not
  the render backend), but the timing figures should not be read as WebKitGTK
  numbers.
- Wall-clock drag timings include CDP round-trips per synthetic pointer move and
  concurrent load from other agents' builds; treat them as directional only.
- No Windows or macOS coverage was run.
