# ADR-0167: CPU / WASM / worker / GPU ownership for warp

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Nonlinear geometry evaluation must be deterministic across backends, cheap
enough to run per-frame, and never depend on GPU-only correctness.

## Decision

D1 — The **canonical reference evaluator is deterministic TypeScript** in
`@varve/engine/src/warp/` (maps, adaptive subdivision, bounds, foldover,
text adjustments). It is the only correct implementation and is shared by
render (Canvas2D + worker + WebGPU-fallback), hit testing, bounds, and
export.

D2 — Evaluation runs on the main thread at `interactive` tolerance during
editing; the engine-node memo (`EngineNodeMemo`) keys on the immutable node
reference, so warped geometry is computed once per node change, not per
frame. Worker offload and a Rust/WASM port (via `varve-wasm`) are the
documented follow-up; a port must match this module's tolerances and order.

D3 — The WebGPU path renders whatever falls outside its solid-shape subset
through Canvas2D — warped geometry therefore never depends on GPU
tessellation.

D4 — Budgets: quality profiles map to absolute tolerances (draft 2 /
interactive 0.5 / high 0.25 / export 0.1 source-local px); per-node point
budget (default 50k) and subdivision depth (14) cap worst-case cost.

## Alternatives

- GPU-only evaluation: rejected — parity and offline export correctness.
- Evaluation in the Rust IR builder: rejected — Rust IR is a pass-through
  in this architecture; webview-side evaluation keeps one implementation
  for every backend.
