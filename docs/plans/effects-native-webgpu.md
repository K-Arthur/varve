# Effects Native + WebGPU Acceleration Plan

**Goal:** Implement native Rust and WebGPU compute backends for all ten live
effects (dither, paletteSnap, bloom, rgbSplit, crt, vhs, lightShafts,
lensFlare, lightLeak, caustics), with a dispatch chain (native-first under
Tauri, WebGPU on web, CPU fallback), agreement regression tests, and the
remaining deferred items from the live-effects work.

## Architecture

```
Adjustment → FilterIR → applyFilterWithCompositing (sync, interactive preview: CPU)
                        └─ export path (async): dispatchLiveEffect
                             ├─ nativeEffectProvider   (Tauri IPC → crates/varve-effects)
                             ├─ gpuEffectProvider      (WebGPU compute, @varve/compositor)
                             └─ cpuEffectProvider      (existing TS kernels — byte-exact reference)
```

- Interactive preview stays synchronous CPU: the adjustment backdrop runs in
  CanvasArea's per-frame sync path; routing it through async IPC/GPU would
  change the per-frame hot path (AGENTS.md: benchmark before changing
  per-frame dispatch). Export (async, single-shot, export quality) uses the
  dispatch chain.
- Native provider: new crate `crates/varve-effects` (all 10 kernels, f64,
  JS-compatible rounding, u32-wrapping hashes) exposed via a
  `apply_live_effect_binary` Tauri command (raw RGBA body + JSON header).
- GPU provider: `packages/compositor/src/webgpu/effects/` — compute-shader
  runner + one WGSL kernel per effect (9 parallel-friendly; dither error
  diffusion is sequential → stays CPU, gpuStatus `partial`).

## Wire contract (native + GPU share it)

```json
{
  "effect": "bloom",
  "width": 640, "height": 480,
  "quality": "normal",
  "coordSpace": { "scale": 1, "originX": 0, "originY": 0, "regionX": 0, "regionY": 0 },
  "params": { "threshold": 0.7, "...": "..." }
}
```

`params` keys are camelCase matching the TS kernel interfaces; defaults
replicate the TS `??` defaults.

## Agreement tests

- Fixtures generated from the TS kernels (the reference implementation) via a
  gated vitest run: `GENERATE_EFFECT_FIXTURES=1 pnpm --filter @varve/engine
  test -- fixtureGen`. Output: `crates/varve-effects/tests/fixtures/*.json`
  + `manifest.json`.
- Rust integration tests replay every fixture through `apply_effect` and
  compare: exact for arithmetic-only effects (dither, paletteSnap, rgbSplit,
  crt), `maxDelta` for transcendental effects (bloom, vhs, lightShafts,
  lensFlare, lightLeak, caustics).
- GPU agreement: Playwright harness page (esbuild bundle of engine kernels +
  compositor runner) compares GPU output vs CPU within tolerance; skips when
  no GPU adapter.

## Registry + docs

- `effectContract.ts`: `gpuStatus` → `implemented` (9) / `partial` (dither);
  add `nativeStatus` → `implemented` (all 10).
- `docs/architecture/live-effects-system.md`: capability matrix, dispatch
  chain, export wiring, known-limitations updates.

## Task list

- [ ] Crate skeleton: Cargo.toml, lib.rs (request types, params reader,
      js_round, u32 hash helpers), prng.rs, quality.rs, blur.rs, palette_core.rs
- [ ] Fixture generator (vitest, env-gated) + committed fixtures
- [ ] Rust kernels: dither, paletteSnap, rgbSplit (exact class)
- [ ] Rust kernels: crt, vhs, lightLeak, lightShafts (tolerant class)
- [ ] Rust kernels: bloom, lensFlare, caustics (tolerant class)
- [ ] Tauri command `apply_live_effect_binary` + registration
- [ ] TS providers + dispatch (`liveEffects/dispatch.ts`), registry update
- [ ] Export wiring in `flattenForExport.ts` (order-preserving interleave)
- [ ] WebGPU runner + WGSL kernels (9 effects)
- [ ] GPU agreement harness (Playwright, skip-if-no-GPU)
- [ ] Docs update + full regression gates

## Next items (deferred from live-effects round, now completed by this work)

1. WebGPU compute paths for all effects (registry-classified) — this plan
2. Native (Rust) acceleration — this plan
3. Registry capability columns (gpuStatus/nativeStatus) truthfully populated
4. Dither documented as sequential (CPU-only) with a partial GPU status
5. Agreement regression net for all three backends
