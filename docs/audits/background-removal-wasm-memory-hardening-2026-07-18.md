# Background Removal — WASM Memory Hardening Audit

**Date:** 2026-07-18 | **Scope:** BiRefNet WASM crash risk, backend capability verification, preflight gating, manual-mask fallback exposure

## 0. Concurrent-agent context (read this first)

This session began mid-flight: `packages/engine/src/backgroundRemoval/**` had uncommitted
changes from another agent (git identity "Cascade Agent", tool later confirmed to be
**OpenCode running `deepseek-v4-flash`**, driven directly by the repo owner) building
`environmentCapabilities.ts`, `modelInfo.ts`, and a try-and-fallback dispatch path. That work
landed as commit `415df7f` while this audit was still reading the diff. OpenCode remained
active (and directly operated by the user) for the duration of this session, with its own todo
list covering materially the same ground (WASM reproduction harness, quality-tier fallback,
mask-editing exposure, resource-lifecycle hardening).

**Division of work actually followed:** this session added the memory *preflight gate*
(§5), the isolated reproduction harness and native-ONNX investigation (§3–4), and a manual-mask
discoverability fix (§7). It deliberately did **not** touch provider-chain ordering or
worker-pool concurrency/session-lifecycle code, since OpenCode's own todo list showed it
mid-way through exactly that area — see §8 for what's recommended there instead of changed.

## 1. The core problem, confirmed

`directOnnxProvider.ts` and `worker.ts` each had a final "if every accelerated provider
failed, fall back to bare WASM" step that called `ort.InferenceSession.create(...,
{executionProviders: ['wasm']})` unconditionally. That call is exactly what can produce a
`std::bad_alloc` — and per the task brief, this had already been observed to crash a headless
sandbox. Catching the *result* of that call is not sufficient hardening, because (a) a native
WASM allocation failure is not guaranteed to surface as a catchable JS rejection in every host
(see §3 for where it did/didn't in practice), and (b) even where it is catchable, attempting the
allocation at all is the unsafe step for large models on constrained hosts.

## 2. Fix implemented: real preflight gate (not catch-after)

`packages/engine/src/backgroundRemoval/worker.ts` (`getSession`) and
`packages/engine/src/backgroundRemoval/providers/directOnnxProvider.ts` (`createOrtSession`)
now:

1. Try every **accelerated** provider (webgpu, webgl) from `getBestOnnxProviders()` first,
   exactly as before.
2. Before falling through to bare WASM, call `isWasmModelSafe(modelId)`
   (`environmentCapabilities.ts`, already existed but was never wired into the actual
   inference path — it was only exported and unit-tested in isolation).
3. If unsafe, **throw before calling `InferenceSession.create`** with an error containing
   `"exceeds the safe WASM memory limit"` — a string `BackgroundRemovalSection.tsx`'s
   `normalizeErrorMessage` already special-cased (that UI code existed before the gate did;
   it was waiting for a producer).

Commit: `56957da fix: gate bare-WASM BiRefNet inference behind a real memory preflight`

New regression tests prove the gate fires **before** the risky call, not just that the
eventual error is caught:

- `packages/engine/src/backgroundRemoval/__tests__/workerWasmPreflight.test.ts` (3 tests) —
  imports `worker.ts` with `self` stubbed, mocks `onnxruntime-web` and
  `environmentCapabilities`, and asserts `InferenceSession.create` is **never called** when
  `preferredOnnxProviders=['wasm']` and `isWasmModelSafe()` resolves `false`.
- `packages/engine/src/backgroundRemoval/__tests__/directOnnxWasmPreflight.test.ts` (2 tests)
  — same assertion for the main-thread provider.
- `directAi.telemetry.test.ts` updated: the old "bare WASM fallback" test expected a redundant
  `['wasm','wasm']` `executionProviders` array (an artifact of the old loop re-attempting
  `'wasm'` as a regular loop entry); the new gated fallback issues a clean `['wasm']` call.

Full focused suite after the change: **36 test files / 312 tests pass**
(`pnpm exec vitest run packages/engine/src/backgroundRemoval`).

## 3. Isolated reproduction harness — real `std::bad_alloc`, reproduced and explained

Built a disposable Node.js harness (not committed; lived in `node_modules/.strata-bg-harness/`,
deleted after use) that runs **onnxruntime-web's actual WASM backend** — the same `.wasm`
binary and JS glue the browser/webview loads — outside the editor process, with a timeout,
per-phase memory snapshots, and no GPU/WebGL/WebGPU available (Node has none), matching the
reported "no usable GPU/WebGL context, no cross-origin-isolated threaded WASM" conditions.

**This is a WASM-architecture reproduction on a Node.js host, not a WebKitGTK reproduction.**
The failure mode below is governed by the wasm32 spec's 4 GiB linear-memory address space, which
is host-engine-agnostic (V8-in-Node and JavaScriptCore-in-WebKitGTK both run the identical
`.wasm` module under the identical 32-bit memory model) — but it was not observed inside
WebKitGTK directly in this session (see §4 for why, and what remains unverified there).

| Run | Model | Input | Threads | Result | Peak RSS | Where it failed |
|---|---|---|---|---|---|---|
| 1 | birefnet-general-lite (224 MB) | 1024×1024 | 1 | **`std::bad_alloc`**, caught as JS `Error` | ~4027 MB | `session.run()` (inference), not model load |
| 2 (repeat) | same | same | 1 | **`std::bad_alloc`**, identical | ~4029 MB | same — deterministic, not flaky |
| 3 | same | same | 8 (simulating cross-origin-isolated threaded WASM) | **`std::bad_alloc`**, identical | ~4145 MB | same — threading does not raise the wasm32 4 GiB ceiling |
| 4 | same | 512×512 | 1 | Clean model error (`Got invalid dimensions... Expected: 1024`) | — | this specific ONNX export has a **static** input shape; can't be run at lower resolution without re-export |
| control | u2netp (4.7 MB) | 320×320 | 1 | Success | 370 MB | model load 319 ms, inference 1546 ms |

Raw logs preserved at (session-local, not committed):
`/tmp/claude-1000/.../scratchpad/bgtest/birefnet-lite-1024-{1thread,1thread-run2,8thread}.log`,
`u2netp-control.log`.

**Findings:**
- The failure is at the **wasm32 4 GiB address-space ceiling**, not host RAM exhaustion (this
  machine has 22 GB free) — deterministic across 3 runs, unaffected by thread count. Multi-
  threaded/cross-origin-isolated WASM would not have prevented this crash; it only helps
  throughput, not the address-space ceiling.
- The failure surfaced during **`session.run()`** (activation-tensor allocation), not
  `InferenceSession.create()` (weight loading) — the model itself loads fine (1.4 GB RSS,
  4.2–4.6 s) before inference pushes it over the edge.
- In **this specific host build** (`onnxruntime-web`'s Node/`ort.node.min.mjs` entry), the
  failure *was* a catchable `Error: failed to call OrtRun(). ERROR_CODE: 6, ERROR_MESSAGE:
  std::bad_alloc` — not a hard process abort. This is a data point, not a guarantee: it does
  not establish that the same allocation failure is always catchable inside a WebKitGTK Web
  Worker (different Emscripten ABORT/exception-handling configuration is plausible). The
  preflight gate in §2 does not depend on this being catchable — it prevents the attempt
  outright, which is the safe design regardless of what a given host does on failure.
- The `isWasmModelSafe('birefnet-general-lite')` heuristic (`224 MB × 4 ≈ 896 MB` estimated
  peak vs. `wasmSafeModelBytes = 50 MB` with no cross-origin isolation) correctly classifies
  this exact case as unsafe — the gate would have refused this attempt.

## 4. Real WebKitGTK/Tauri (CachyOS Wayland) — what was and wasn't verified

**Environment confirmed real:** this session ran directly on the target CachyOS/Wayland
machine (`WAYLAND_DISPLAY=wayland-0`, KDE Plasma), with WebKitGTK 2.52.5 / GTK3 available via
`pkg-config` and PyGObject, matching AGENTS.md's recorded toolchain.

**What succeeded:**
- Built `strata-desktop` in dev mode (`pnpm tauri:dev`) — real Rust compile, real window
  process (`target/debug/strata-desktop`), real Vite dev server on `localhost:1420`.
- Screenshot (`spectacle`) confirms the app's splash window renders on the real Wayland
  session.

**What did not complete, and why:**
- **Full click-through of the AI-quality removal flow in the live GUI was not achieved.**
  This system has no `xdotool`/`ydotool`/`wtype` input-automation tool installed, so the
  running window could not be driven programmatically without installing new input-injection
  tooling — a system change this audit did not make unprompted.
- The repo's existing WDIO/Tauri E2E harness (`tests/wdio/tauri-smoke.e2e.ts`, embedded
  WebDriver via `tauri-plugin-wdio`) was the correct tool for this, but
  `pnpm desktop:build:test` (`tauri build --debug --features wdio`) failed at the
  `tsc --noEmit` step with ~20 **pre-existing, unrelated** type errors (SolidIcon icon-name
  migration across `HomeShell`, `Prototype`/`Motion` context types, `HitTestEngine`, etc.) —
  all from other in-progress work in the shared tree. Fixing those was out of scope: they
  belong to the concurrent SolidIcon migration, not this task, and touching them risked
  colliding with that work.
- A custom `PyGObject` + `WebKit2` 4.1 harness was built to load the app's dev URL directly in
  the real WebKitGTK engine and run JS via `run_javascript` (bypassing the need for
  WebDriver/input automation). `document.title`/`readyState` round-trips worked correctly,
  proving JS execution and the Python↔WebKit bridge functioned — but **ES module scripts
  never executed** in this specific harness configuration (`<script type="module">` silently
  no-ops; the real app's `#root` never mounts, 0 children). This reproduced even on the
  production app's own `index.html`, so it is a gap in this ad hoc harness's WebKit
  initialization (likely a `WebKitSettings`/process-model flag this harness didn't set that
  Tauri's own `wry` integration does set) — not a finding about the app. Tried
  `WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1` as a common container fix; no change. Not
  pursued further given diminishing returns and the concurrent-session constraint (§0).

**Honest conclusion:** the memory-safety fix (§2) is verified by unit tests plus the
WASM-architecture reproduction (§3), which is engine-agnostic evidence for *why* the gate is
necessary. It is **not** independently confirmed by an automated, real-WebKitGTK, full-app
click-through in this session. That remains open — recommended next step: fix the unrelated
typecheck errors blocking `pnpm build:wdio` (separately from this task), then run
`xvfb-run pnpm test:wdio` (or run headed, since a real display is available) with a new spec
that drives the Inspector's AI Quality removal on a real image.

## 5. Native Rust ONNX (`ort` crate, `ai` Cargo feature) — a genuinely safe alternative, proven

`crates/strata-bgremove` already has a feature-gated native inference path (`ort =
"=2.0.0-rc.11"`, `load-dynamic`) that was **not compiled into any build or CI job** — `ai` is
opt-in and absent from `apps/desktop/src-tauri/Cargo.toml`'s default features, confirmed by
grepping `justfile`/`package.json` for `--features ai` (no matches). This session obtained a
real `libonnxruntime.so` and exercised it end-to-end:

| ONNX Runtime .so version | Result |
|---|---|
| 1.20.1 | Rejected at dlopen: `ort` rc.11 requires `>= 1.23.x` |
| 1.23.0 | Loads, but **fails on this specific BiRefNet-Lite file**: `Cannot parse data from external tensors... /decoder/Constant_1066_output_0` — a model-parsing incompatibility, not a crash |
| **1.27.1** (matches the pinned `onnxruntime-web@1.27.0`) | **Full success**, both models |

With 1.27.1 (`ORT_DYLIB_PATH` pointed at the extracted `.so`, real image input, real bundled
model files copied to `~/.local/share/strata/models/`):

| Model | Method | Elapsed | Peak RSS | Confidence | Output |
|---|---|---|---|---|---|
| u2netp | ai-balanced | 527 ms | 42 MB | 0.976 | valid mask |
| birefnet-general-lite | ai-quality | 17.9 s (fixture 1) / 15.2 s (fixture 2) | **445 MB** | 0.984 / 0.995 | valid, visually correct masks (fine fur edges, multi-subject product shot both handled correctly) |

**This is the single highest-leverage finding of this audit:** native execution of the exact
same BiRefNet-Lite model that crashes at ~4 GB under bare WASM completes cleanly at **~445 MB
peak RSS** — a ~9× reduction — because it isn't bound by the wasm32 4 GiB linear-memory
ceiling at all. Mask images decoded and visually inspected (lion portrait: clean fur/whisker
edges; coffee-cup + bell product shot: both subjects correctly isolated from a textured wood
background).

**Not done, and why (deliberately deferred):**
- Did **not** flip `ai` to a default feature or reorder the provider chain to prefer
  `tauri-native` before `worker-onnx`. That requires bundling a real `libonnxruntime.so` per
  target platform (Linux/Windows/macOS) as a Tauri resource, resolving `ORT_DYLIB_PATH` at
  runtime relative to the app's resource dir, and CI changes for three platforms — none of
  which this session could verify on Windows/macOS, and all of which land in the same files
  (`dispatch.ts`'s `AI_PROVIDER_CHAIN`, worker-pool/session lifecycle) OpenCode's own todo
  list showed it mid-way through (§0). Recommended as the top follow-up item, scoped
  separately.
- The `birefnet-general-lite.onnx` file's incompatibility with onnxruntime 1.23.0 (works on
  1.27.1) is worth tracking: if the desktop build ever pins a different onnxruntime native
  version than the one matching `onnxruntime-web`, re-verify this model loads before shipping.

## 6. Backend capability matrix

| Backend / model | Session create | Complete inference | Peak mem | Notes |
|---|---|---|---|---|
| WASM (Node host), u2netp, no GPU | ✓ | ✓ 1546 ms | 370 MB | control, safe |
| WASM (Node host), birefnet-lite, no GPU, 1024², 1 thread | ✓ | ✗ `std::bad_alloc` | ~4.0 GB | reproduced 2×, deterministic |
| WASM (Node host), birefnet-lite, no GPU, 1024², 8 threads | ✓ | ✗ `std::bad_alloc` | ~4.1 GB | threading doesn't help — address-space ceiling, not throughput |
| Native `ort` (Linux x64), u2netp | ✓ | ✓ 527 ms | 42 MB | via `ai` feature + `ORT_DYLIB_PATH` (opt-in, not in current build) |
| Native `ort` (Linux x64), birefnet-lite | ✓ | ✓ 15–18 s | 445 MB | onnxruntime 1.27.1 required; 1.23.0 fails to parse this model file |
| Tauri/WebKitGTK app launch (CachyOS Wayland, real display) | ✓ (window renders) | not exercised | — | blocked on input automation / unrelated typecheck breakage, see §4 |
| Chrome/Chromium, Firefox, Windows, macOS | — | **not tested** | — | no such environment available in this sandbox; not claimed |

Per the evidence-gating rules this audit was run under: the Chrome/Firefox/Windows/macOS rows
are reported as **not tested**, not inferred from the Linux results.

## 7. Manual mask fallback — confirmed already exposed, discoverability improved

Read-verified in `BackgroundRemovalSection.tsx`: "Refine Mask" (brush), "Refine edges
(hair/fur)" (guided matting), and "Edit trimap" (foreground/background/unknown painting) all
render whenever `node.mask?.rasterMask?.provenance ?? node.backgroundRemoval` is truthy —
which happens after **any** successful removal, including Quick mode (the always-available,
non-AI heuristic). So a user whose device can't safely run any AI tier still has a full manual
path: Quick removal → brush/trimap refinement — this matches OpenCode's own answer to the
user's identical question during this session, cross-checked independently here.

What was missing: the error messages shown when AI fails never told the user this path exists.
Fixed (commit `722645e`): the WASM-memory-limit error and the "failed in all quality modes"
error now explicitly say to use Quick mode plus the brush/trimap tools, instead of only
suggesting "switch to AI Balanced" or "try again later."

## 8. Recommendations not implemented this session (to avoid colliding with concurrent work)

1. **Bundle a matching `libonnxruntime.so` per platform and default-enable native inference
   on Tauri desktop for `ai-quality`**, preferring it over `worker-onnx` when
   `strata_bgremove::has_ai()` is true and `environmentCapabilities` reports no accelerated
   browser backend. This is the fix proven safe in §5 (~9× memory reduction, no wasm32
   ceiling) but needs cross-platform packaging work this sandbox can't verify on
   Windows/macOS, and touches the same provider-chain/session-lifecycle code OpenCode's todo
   list indicates it's actively hardening.
2. **Re-verify `birefnet-general-lite.onnx` against whatever onnxruntime native version
   actually ships**, given the 1.23.0-fails/1.27.1-works discrepancy found in §5.
3. **Re-export or offer a dynamic-input-shape BiRefNet variant** — the current bundled export
   has a static `[1,3,1024,1024]` input, so "lower bounded inference resolution" (a mitigation
   the original task asked to investigate) isn't available without a model-conversion step;
   it's not just an app-code change.
4. **Finish real WebKitGTK click-through verification** (§4) once the unrelated typecheck
   breakage blocking `pnpm build:wdio` is resolved by whoever owns the SolidIcon migration.

## Evidence records

```text
Environment: CachyOS Linux, Wayland (WAYLAND_DISPLAY=wayland-0), KDE Plasma
Runtime: onnxruntime-web 1.27.0 (pinned, package.json), Node v26.4.0 host for harness
Model: birefnet-general-lite (224 MB, static 1024x1024 input)
Backend requested: wasm (no accelerated provider available — simulated no-GPU environment)
Backend actually used: wasm (ort.node.min.mjs / Emscripten WASM build)
Cross-origin isolation: N/A (Node.js host; single-threaded and 8-threaded both tested)
Command: node <disposable-harness>.mjs birefnet-general-lite.onnx birefnet-general-lite 1024 1
Exit code: 1 (clean JS exception, not a process abort, in this host)
Session creation: succeeded (4.2-4.6s, ~1.4GB RSS)
Complete inference: FAILED — std::bad_alloc during session.run(), ~4.0-4.1GB RSS, reproduced 3x
Peak memory estimate: ~4.0-4.1 GB (wasm32 address-space ceiling)
Output artifacts: raw logs in session scratchpad (not committed; ephemeral /tmp)
Manual visual finding: N/A (inference did not complete)
Fallback triggered: N/A (isolated harness, not the app's dispatch path)
Remaining risk: WebKitGTK Worker-hosted WASM may differ in whether this is catchable vs. an
  abort; the preflight gate added in this session does not depend on that being catchable —
  it prevents the attempt before it happens, in-app.

Environment: CachyOS Linux, native Rust (no browser/webview involved)
Runtime: onnxruntime 1.27.1 native (ort crate 2.0.0-rc.11, load-dynamic, ORT_DYLIB_PATH)
Model: birefnet-general-lite (224 MB)
Backend requested: native ai feature (opt-in, not in default build)
Backend actually used: onnxruntime native CPU execution provider
Cross-origin isolation: N/A (native process)
Command: cargo run --release --features ai --example native_bg_test -- <real photo>
Exit code: 0
Session creation: succeeded
Complete inference: SUCCESS, 15.2-17.9s, confidence 0.984-0.995
Peak memory estimate: 445 MB VmRSS
Output artifacts: decoded PNG masks visually inspected (fur edges, multi-subject product shot)
Manual visual finding: correct silhouettes, clean edges on both fixtures
Fallback triggered: N/A (direct native call, not through app dispatch)
Remaining risk: not wired into the app's provider chain or default build (see §8.1); the
  specific bundled model file requires onnxruntime >=1.27.x-ish (1.23.0 fails to parse it)

Environment: CachyOS Linux, Wayland, real WebKitGTK 2.52.5 (Tauri dev build)
Runtime: strata-desktop debug binary, Vite dev server, WebKitGTK webview
Model: N/A (app launch verification only)
Backend requested: N/A
Backend actually used: N/A
Cross-origin isolation: N/A
Command: pnpm tauri:dev (apps/desktop)
Exit code: process launched successfully, window rendered (screenshot captured)
Session creation: N/A
Complete inference: NOT EXERCISED — no input-automation tool available to drive the real GUI;
  WDIO path blocked by unrelated pre-existing typecheck errors in build:wdio
Peak memory estimate: not measured
Output artifacts: screenshot (session scratchpad, not committed)
Manual visual finding: splash/window renders correctly on the real desktop
Fallback triggered: N/A
Remaining risk: the actual AI-quality removal flow was not click-tested end-to-end inside the
  real WebKitGTK webview in this session — see §4 and §8.4 for the concrete unblock path
```
