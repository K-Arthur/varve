# Vectorization / Image Trace — ownership and coordination (2026-09-13)

Status: **active**. Owner: this session. Branch: `master` (per request).

## Scope claimed

The image-trace / raster-to-vector feature end to end:

- `crates/varve-trace/` (engine)
- `packages/engine/src/rasterTrace.ts`, `packages/engine/src/upscaleProviders/*trace*`
- `packages/editor/src/components/Vectorize/**`
- `packages/editor/src/logo/vectorization/**`
- `packages/editor/src/imageOperations.ts` trace functions
- `packages/scene/src/liveTrace.ts` (audit only — no UI wiring planned)
- `tests/e2e/canvas/image-trace.spec.ts`
- `docs/architecture/image-trace-system.md`, `docs/adr/0170-*`, website trace copy
- Trace-related research/audit notes under `docs/agents/`

## Concurrent work check (2026-09-13)

- Working tree contains staged/unstaged work by other agents (font storage,
  website docs, upscale ONNX EP, acceleration, generative editing). **Never
  staged or committed by this session.**
- `crates/varve-upscale/Cargo.toml` has an unrelated ONNX/WebGPU diff. The
  trace dispatch chain only consumes upscale providers indirectly; no shared
  file is under edit.
- No ownership record existed for tracing before this file. No `liveTrace` or
  Vectorize callers outside tests, so no integration conflict.
- Commits from this session are scoped with explicit pathspecs
  (`git commit -- <paths>`) so other agents' staged work is never included.

## Integration points that must not be silently forked

- `registerEditorActions` in `Shell.tsx` and the Object/canvas/Layers menus
  all converge on `editor.openVectorizeDialog()` →
  `VectorizeDialogHost` → `VectorizeDialog` → `VectorizeWorkflow`.
  There is **one** dialog; do not add a second.
- Insertion / re-trace go through `insertTraceGroup` / `replaceTraceGroup`.
- `RasterTraceOptions` is the provider contract; camelCase on the native wire.
- `GroupNode.traceMetadata` is the provenance contract; `sceneVersion`
  migrations must keep accepting v1 payloads.

## Validation obligations for this work

- `pnpm verify:plan` first, then `pnpm verify:affected`.
- Rust: `cargo test -p varve-trace` and `cargo clippy -p varve-trace` when the
  engine changes (targeted; not workspace-wide).
- E2E: `tests/e2e/canvas/image-trace.spec.ts` on chromium, plus visual capture
  of preview modes (light/dark).
- Audits: `pnpm audit:docs`, `pnpm audit:emoji`, `pnpm audit:tokens` when
  docs/tokens are touched.
- Full gate only on explicit escalation per `docs/quality/validation-strategy.md`.

## Out of scope (documented, not implemented)

- Visible-appearance (crop/mask/effect) capture before trace.
- Learned/generative vectorization; ONNX model additions to tracing.
- A second tracing dialog or a separate trace workspace.
