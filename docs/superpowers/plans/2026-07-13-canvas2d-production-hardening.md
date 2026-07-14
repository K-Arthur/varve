# Canvas 2D Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the user-observed frame/text placement failures and remove the highest-risk Canvas 2D display/export divergences while preserving one modular rendering contract across Tauri and the Vite browser harness.

**Architecture:** Keep `@strata/scene` as document truth and IR replay as the backend seam. Extract document-to-engine conversion and scoped scene traversal into a renderer-neutral editor module consumed by live display, video, raster export, and native PDF export. Canvas capabilities remain runtime-detected; optional worker/offscreen paths must preserve the same camera and scene semantics as the main-thread Canvas 2D path.

**Tech Stack:** React 19, TypeScript strict mode, Canvas 2D, OffscreenCanvas with HTMLCanvas fallback, Web Workers, Tauri 2/Rust IR and PDF IPC, Vitest, Playwright, WDIO/WebKitGTK where executable.

---

## Scope and evidence labels

The repository has one production editor frontend in `apps/desktop`, embedded by Tauri and also runnable through Vite. `apps/web` is not a production application. This pass treats Vite as the cross-browser compatibility harness and records the missing production web packaging/offline layer as a deployment gap rather than claiming it was tested.

Must ship in this pass:

1. Real pointer-driven frame/text creation and preset placement remain visible and coordinate-correct.
2. All render/export paths use the strict text wire contract and composed world transforms.
3. Frame/group raster and PDF exports include their visible descendants in z-order.
4. Raster export works without OffscreenCanvas and fails explicitly for unsupported encoders or unsafe allocation.
5. Worker rendering preserves rotation, viewport, DPR, and stale-frame rules without feedback loops.
6. Image/pattern fills are clipped to object geometry and complex filters cannot mutate earlier destination content.
7. Canvas backing stores respond to fractional DPR and monitor-scale changes without resize-clear churn.

Deferred only with explicit evidence in the final report: production browser packaging/service worker, native UI execution on unavailable OSes, and exact cross-engine text pixels where rasterizers legitimately differ.

## Task 1: Restore trustworthy browser interaction coverage

**Files:**
- Modify: `tests/e2e/shared.ts`
- Create: `tests/e2e/canvas/frame-text-placement.spec.ts`
- Create: `tests/e2e/tsconfig.json`
- Modify: `package.json`

- [ ] Keep the existing failing Chromium tools run as RED evidence (`1 passed / 5 failed`, invalid mouse coordinates).
- [ ] Make `dragOnCanvas` accept the new point-object signature and the legacy numeric signature while callers migrate.
- [ ] Add an E2E TypeScript gate so signature drift fails before Playwright runtime.
- [ ] Add semantic frame/text placement tests that assert canvas-relative creation coordinates, visible pixels/overlays, text-editor focus, and preset bounds.
- [ ] Run focused Chromium, Firefox, and WebKit tests and record engine-specific evidence.

## Task 2: Canonical scene-to-engine conversion

**Files:**
- Create: `packages/editor/src/render/sceneToEngine.ts`
- Create: `packages/editor/src/render/sceneToEngine.test.ts`
- Modify: `packages/editor/src/CanvasArea.tsx`
- Modify: `packages/editor/src/motion/videoExportBridge.ts`
- Modify: `packages/editor/src/components/SpecPanel/export.ts`

- [ ] Write failing contract tests for strict text `shape`, paths, frames, adjustments, world transforms, visibility, scoped descendants, and z-order.
- [ ] Move node conversion out of `CanvasArea` without changing IR semantics.
- [ ] Build a scoped flattened scene from a node/document, applying variants, bindings, styles, and world transforms once.
- [ ] Replace duplicate converters in live display, video export, raster export, and PDF export.
- [ ] Verify native/WASM/stub parity fixtures accept the same scene.

## Task 3: Deterministic and resilient raster/PDF export

**Files:**
- Create: `packages/editor/src/render/rasterSurface.ts`
- Create: `packages/editor/src/render/rasterSurface.test.ts`
- Modify: `packages/editor/src/components/SpecPanel/export.ts`
- Modify: `packages/editor/src/components/SpecPanel/export.test.ts`
- Modify: `packages/engine/src/fontRegistry.ts`
- Modify: `packages/engine/src/fontRegistry.test.ts`

- [ ] Write failing tests for no-OffscreenCanvas fallback, requested/actual MIME mismatch, container descendants, nested transforms, font-specific loading, area budget rejection, and taint errors.
- [ ] Add a surface factory that prefers OffscreenCanvas but encodes through `HTMLCanvasElement.toBlob` when required.
- [ ] Validate both dimensions and estimated memory before allocation; return actionable errors instead of blank output.
- [ ] Load the concrete font faces/text used by the export before awaiting the current font set.
- [ ] Send canonical flattened nodes to raster and native PDF paths.

## Task 4: Worker camera and lifecycle parity

**Files:**
- Modify: `packages/editor/src/render/workerHost.ts`
- Modify: `packages/editor/src/render/renderWorker.ts`
- Modify: `packages/editor/src/render/workerHost.test.ts`
- Create: `packages/editor/src/render/renderWorker.test.ts`
- Modify: `packages/editor/src/CanvasArea.tsx`

- [ ] Write a failing transform-sequence test proving rotation is absent from worker replay.
- [ ] Send the complete `Camera`, including rotation, and apply the shared camera transform in the worker.
- [ ] Include rotation in cache equality/compensation policy; use main-thread replay when a cached bitmap cannot be safely compensated.
- [ ] Post explicit resize commands for viewport/DPR changes and reject old resize generations.
- [ ] Verify no identical frame request/reply loop occurs after a settled rotated render.

## Task 5: Canvas paint isolation and clipping

**Files:**
- Modify: `packages/engine/src/replay.ts`
- Modify: `packages/engine/src/replay-fill.test.ts`
- Modify: `packages/engine/src/filterCompositor.ts`
- Modify: `packages/engine/src/filterCompositor.test.ts`

- [ ] Write pixel-invariant tests showing ellipse/path image and pattern fills cannot paint outside geometry.
- [ ] Clip raster paints using the already-traced primitive path and anchor patterns at object bounds.
- [ ] Write a failing two-layer filter test proving one node's filter mutates prior destination pixels.
- [ ] Render complex-filter items into bounded isolated intermediates, then composite once with opacity/blend order preserved.
- [ ] Wrap every item save/restore in `try/finally` so one failed resource cannot poison later frames.

## Task 6: DPR, resize, and context recovery

**Files:**
- Create: `packages/editor/src/render/canvasSurface.ts`
- Create: `packages/editor/src/render/canvasSurface.test.ts`
- Modify: `packages/editor/src/CanvasArea.tsx`
- Modify: `packages/compositor/src/canvas2d/backend.ts`

- [ ] Write failing fractional-DPR tests showing repeated resize-clear behavior and stale DPR after a display-scale change.
- [ ] Round backing dimensions once, cap them to safe viewport budgets, and report whether a resize occurred.
- [ ] Observe DPR changes with a re-armed resolution media query plus resize/visibility events.
- [ ] Reinitialize Canvas 2D state and invalidate worker/compositor caches after backing-store replacement or restoration.

## Task 7: Documentation, benchmarks, and completion gate

**Files:**
- Modify: `docs/architecture/render-pipeline.md`
- Create: `docs/architecture/canvas2d-target-compatibility.md`
- Modify: `docs/perf/ledger.md`
- Modify: `vitest.config.ts`

- [ ] Record research sources/access dates, confirmed facts versus inference, target architecture, font/image/print policy, size/allocation policy, visual tolerance policy, and the production-web mismatch.
- [ ] Make replay benchmarks discoverable and record environment plus before/after p50/p95 where changes are performance-relevant.
- [ ] Run focused RED/GREEN tests, then `pnpm format`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm audit:emoji`, and `pnpm audit:tokens` in the required order.
- [ ] Run Chromium/Firefox/WebKit Canvas workflows and native Tauri tests only where the environment actually launches them; label all other matrix cells honestly.
- [ ] Request an independent cascade review, resolve critical/important findings, inspect `git status`, and verify each created commit with `git log --oneline -3`.
