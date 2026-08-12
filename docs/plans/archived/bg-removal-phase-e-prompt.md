# Background Removal — Phase E Completion Prompt

**Use this document as the agent prompt.** Phases A–D are done (Session 39). Phase E closes remaining stubs and deferred advanced features. Do **not** edit this file during execution — update `docs/audits/background-removal-audit.md` and `docs/plans/bg-removal-deferred.md` when finished.

---

## Mission

Complete Phase E of the background-removal deferred work: native Rust AI path (optional build), hair/fur matting refinement, multi-subject picker, trimap editor — plus wire up existing stubs that Phase E depends on. Preserve offline-first / ADR-0005 invariants unless an ADR amendment is written first.

---

## Corrected baseline (verify at session start — do not trust stale numbers)

Run before any code change:

```bash
pnpm exec vitest run \
  packages/engine/src/backgroundRemoval \
  packages/editor/src/components/__tests__/BatchBgRemoveDialog.test.tsx \
  packages/editor/src/tools/__tests__/RefineMaskTool.test.ts \
  packages/editor/src/tools/__tests__/ToolManager.test.ts \
  packages/editor/src/components/Inspector/sections/__tests__/bgRemovalFeatures.test.tsx \
  packages/editor/src/components/Settings/BgRemovalModelsTab.test.tsx \
  packages/editor/src/components/BackgroundRemoval/ModelDownloadDialog.test.tsx \
  packages/editor/src/components/Inspector/controls/CurveEditor.test.tsx

pnpm --filter @varve/engine typecheck
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
pnpm test   # expect ~11 failures in uncommitted motion WIP — unrelated
```

**Last verified (Session 39):**

| Gate | Result |
|---|---|
| Focused bg-removal suite | **145/145** (18 files) |
| `@varve/engine` typecheck | **0 errors** |
| `cargo clippy -D warnings` | clean |
| `cargo test --workspace` | **166/166** |
| Full `pnpm test` | **3731/3743** pass (11 motion WIP failures) |
| Full `pnpm typecheck` 15/15 | blocked by motion WIP (`scene/styles.ts`, `motion.bench.test.ts`) |

---

## Prerequisite — ADR amendment (mandatory before native AI ships)

Phase E.1 (native Rust ONNX) **must not** land in release CI without updating `docs/adr/0005-offline-model-bundling.md`:

1. Decide storage model: keep IndexedDB-only (Option A, current) **or** add native `~/.local/share/strata/models/` as a second cache (Option B).
2. If Option B: document dispatch order change (native before Worker? parallel fallback?) and consent/download UX (single download vs dual storage).
3. Pin `ort` version policy (currently `=2.0.0-rc.11`; rc.12 breaks Linux — see `crates/strata-bgremove/Cargo.toml`).
4. CI matrix: opt-in `ai` feature job only; default builds stay heuristic-only.

**Hair matting, multi-subject, trimap** do not require ADR changes — they extend the existing mask pipeline.

---

## Stub inventory (what exists vs what is missing)

### E.0 — Known stubs / parity gaps (fix regardless of E.1–E.4 scope)

| Stub | Location | Problem |
|---|---|---|
| Direct-ONNX path ignores `previewMaxDimension` | `packages/engine/src/backgroundRemoval/index.ts` → `removeBackgroundAI()` | Worker uses `previewDownscale.ts`; main-thread fallback resizes full-res → model input only. Large images block main thread. |
| Duplicate resize logic | `index.ts` `resizeImageData()` vs `previewDownscale.ts` | Consolidate on `downscaleImageData` + model-input resize. |
| Rust model metadata stale | `crates/strata-bgremove/src/model.rs` `AVAILABLE_MODELS` | Still points at dead BiRefNet GitHub URLs; sizes 120MB/380MB vs TS manifest 214MB/928MB rembg mirror. |
| Rust model download | `model.rs` | `is_model_downloaded` / `model_path` only — **no download, verify, or delete**. Scaffolding only. |
| Native inference exists but unshipped | `crates/strata-bgremove/src/inference.rs` | Full ONNX path behind `ai` feature; hardcoded input name `"input"`; fixed confidence 0.85; no decontaminate; no preview downscale. |
| Tauri IPC always heuristic | `apps/desktop/src-tauri/src/lib.rs` `remove_background` | Does not call `inference::remove_ai` even when models exist in webview IndexedDB. |
| WebGPU EP | `worker.ts` `getSession()` | WebGL → WASM only; WebKitGTK has no `navigator.gpu` (ADR-0005 note). Revisit only if target webview gains WebGPU. |
| BiRefNet manifest checksums | `apps/desktop/public/models/manifest.json` | `sha256: null` for remote models — run `scripts/compute-model-checksum.mjs` before release bundling. |

### E.1 — Native Rust AI (ADR-gated)

**Goal:** Optional desktop native ONNX path for environments where Worker is unavailable or for perf experiments — without breaking Worker-first dispatch for shipped builds unless ADR says otherwise.

Tasks:

1. Amend ADR-0005 per prerequisite section.
2. Sync `model.rs` metadata with TS `AVAILABLE_MODELS` + manifest (rembg URLs, sizes, checksum fields).
3. Implement native download/write/delete OR document explicit "native reads from webview-exported path" bridge — pick one in ADR, implement consistently.
4. Wire Tauri `remove_background` to route `ai-balanced` / `ai-quality` to `inference::remove_ai` when `ai` feature enabled **and** model bytes available.
5. Parity fixes in `inference.rs`:
   - Dynamic input/output names (match worker session probing).
   - `previewMaxDimension` downscale before model input (port logic from TS or share dimension constants).
   - Decontaminate + feather (reuse or port `maskOps` algorithms to Rust).
   - Real confidence from output tensor (not hardcoded 0.85).
6. Tests: `cargo test -p strata-bgremove --features ai` with fixture ONNX or mock; IPC round-trip test in src-tauri.
7. CI: separate job `cargo test -p strata-bgremove --features ai` — not in default `just gate` until stable.

### E.2 — Hair / fur matting refinement pass

**Goal:** Dedicated post-AI edge refinement for fine detail (hair, fur, glass) beyond brush painting.

Current state: `RefineMaskTool` (brush add/subtract), `maskOps.decontaminateMask`, feather — no closed-loop matting.

Tasks:

1. Research basis comment at top of new module (e.g. closed-form matting, KNN matting, or guided filter — pick one appropriate for on-device CPU).
2. Add `refineHairMatting(imageData, mask, opts)` in `@varve/engine` (new file under `backgroundRemoval/`).
3. Inspector: "Refine edges (hair/fur)" action in `BackgroundRemovalSection` — runs matting pass, replaces mask, undoable via `updateDoc`.
4. Optional: auto-suggest when confidence < threshold or user picks method after AI quality tier.
5. TDD: golden mask comparison on small fixture images; no pixel-exact GPU dependence.

**Out of scope:** Full Photoshop Select & Mask UI (that's E.4 trimap).

### E.3 — Multi-subject instance picker

**Goal:** When segmentation returns multiple disconnected foreground regions, let user pick which subject(s) to keep.

Current state: **no code** — greenfield.

Tasks:

1. Add `findConnectedComponents(mask)` in `maskOps.ts` (4-connected or 8-connected CC labeling).
2. After AI removal, if component count > 1, show `SubjectPickerOverlay` on canvas (bounding boxes + click/toggle to include/exclude).
3. Persist selection as filtered mask before `setBackgroundRemoval`.
4. Batch/export: default = largest component; optional "pick per image" mode in batch dialog.
5. TDD: synthetic two-blob mask → picker returns correct subset; single blob skips picker.

### E.4 — Trimap editor (Select-and-Mask lite)

**Goal:** Three-zone editing (definite fg / unknown / definite bg) for difficult edges — lighter than full Photoshop workflow.

Current state: **no code** — greenfield; `RefineMaskTool` is binary brush only.

Tasks:

1. Scene model extension (if needed): `backgroundRemoval.trimapDataUrl?: string` OR ephemeral trimap during edit session only (prefer ephemeral to avoid schema churn — document choice).
2. New `TrimapEditTool` or extend `RefineMaskTool` with mode toggle: Foreground / Unknown / Background pens.
3. Run matting inference from trimap (E.2 engine can consume trimap) or use trimap to refine existing AI mask via alpha propagation.
4. Inspector entry: "Edit trimap…" after AI apply; Escape/V exits.
5. TDD: paint trimap zones → matting output shifts edge as expected on fixture.

---

## Suggested execution order

```
ADR amendment (E.1 blocker)
  → E.0 stub parity (previewMaxDimension on direct path, Rust metadata sync)
  → E.2 hair matting (standalone value)
  → E.3 multi-subject picker (depends on mask CC, independent of matting)
  → E.4 trimap editor (depends on E.2 matting consumer)
  → E.1 native Rust AI (large; only if ADR approved)
  → WebGPU EP (only if WebKitGTK target gains navigator.gpu)
```

E.2 + E.3 deliver user-visible value without Rust/ADR work. E.1 is optional acceleration, not required for hair/multi-subject/trimap.

---

## Regression protocol (after each sub-phase)

```bash
pnpm format && pnpm --filter @varve/engine typecheck && pnpm lint
pnpm exec vitest run packages/engine/src/backgroundRemoval \
  packages/editor/src/components/__tests__/BatchBgRemoveDialog.test.tsx \
  packages/editor/src/tools/__tests__/RefineMaskTool.test.ts \
  packages/editor/src/tools/__tests__/ToolManager.test.ts \
  packages/editor/src/components/Inspector/sections/__tests__/bgRemovalFeatures.test.tsx
pnpm audit:emoji && pnpm audit:tokens
cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings
# If E.1 touched:
cargo test -p strata-bgremove --features ai
```

---

## Deliverables

1. Implementation per approved scope (minimum: E.0 + at least one of E.2/E.3/E.4).
2. Updated `docs/audits/background-removal-audit.md` — gap table, roadmap, verification counts.
3. Updated `docs/plans/bg-removal-deferred.md` — Phase E status table.
4. `AGENTS.md` Session entry with exact pass counts.
5. ADR-0005 amendment if E.1 shipped.
6. Executive summary with focused/full/Rust pass counts.

**No commits unless explicitly requested** (this prompt is for a future session; the Session 39 commit is separate).

---

## Acceptance criteria (Phase E complete)

- [ ] Direct-ONNX fallback uses `previewMaxDimension` (parity with Worker).
- [ ] Rust `model.rs` metadata matches TS manifest (URLs, sizes).
- [ ] Hair matting pass available in inspector with tests.
- [ ] Multi-subject picker appears for multi-blob masks with tests.
- [ ] Trimap editor MVP with matting integration and tests.
- [ ] (Optional) Native `ai` feature builds, tests, and IPC routes correctly per ADR.
- [ ] Focused bg-removal suite green; no new lint/typecheck regressions on touched files.
- [ ] BiRefNet checksums populated OR documented as release-only with script invocation recorded in audit.

---

## Key files to read first

| File | Why |
|---|---|
| `docs/adr/0005-offline-model-bundling.md` | Storage + dispatch policy |
| `docs/audits/background-removal-audit.md` | Gap analysis + Session 39 baseline |
| `packages/engine/src/backgroundRemoval/index.ts` | Dispatch + direct ONNX stub |
| `packages/engine/src/backgroundRemoval/worker.ts` | Reference AI pipeline |
| `packages/engine/src/backgroundRemoval/previewDownscale.ts` | Shared downscale |
| `packages/engine/src/backgroundRemoval/maskOps.ts` | Mask utilities + decontaminate |
| `packages/editor/src/tools/RefineMaskTool.ts` | Brush refine baseline |
| `packages/editor/src/components/Inspector/sections/BackgroundRemovalSection.tsx` | Inspector integration |
| `crates/strata-bgremove/src/inference.rs` | Native ONNX stub |
| `crates/strata-bgremove/src/model.rs` | Native model metadata stub |
| `apps/desktop/src-tauri/src/lib.rs` | Tauri `remove_background` IPC |
