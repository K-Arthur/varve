# Generative editing local-model checkpoint — 2026-09-15

This checkpoint records the local-model research and validation completed on
`master`. It is an evidence report, not a release qualification for semantic
prompt editing.

## Decision

No prompt-conditioned local model is enabled. The pinned Stable Diffusion 1.5
Q4 artifact remains disabled because its published runtime requires a patched
llama-box/stable-diffusion.cpp path and its real-photograph candidates failed
prompt adherence or runtime-integrity review. No arbitrary checkpoint import
or silent remote fallback is available.

The local workflow that is currently honest is:

- promptless Fill and Remove / Generative Subtract through the bounded local
  reconstruction paths;
- promptless desktop Expand through the local LaMa path, within its reviewed
  photographic limits; and
- Fast/PatchMatch as the constrained-device option for supported Fill/Remove
  work, without claiming semantic generation.

Browser Expand, Replace, prompt-conditioned Fill, and prompt-conditioned
Expand remain unavailable until a complete local model/runtime profile passes
the real-photo, memory, cancellation, and platform gates.

## Local candidate registry

`packages/engine/src/generativeEdit/modelProfiles.ts` is now the renderer-side
allowlist and research ledger. A runnable profile must identify:

- a pinned artifact revision and SHA-256 checksum;
- every required component role, not just one weight file;
- the input and mask convention plus a frame contract;
- a model-specific adapter, qualified backend, and CPU architecture;
- offline-after-install behaviour; and
- a measured available-memory value meeting the profile's working-set floor.

The registry contains the disabled SD 1.5 Q4 profile and research-only
records for PowerPaint v2-1, FLUX.1-Fill-dev, FIBO-Edit 1.5 turbo, and SDXL
Inpainting. Research records cannot be routed by the provider facade. Their
published usage requirements are materially different: PowerPaint documents
a Python 3.9/Diffusers/PyTorch environment and includes outpainting in its
task table. Its published bundle contains a Realistic Vision / SD 1.5 base and
a separate BrushNet adapter, so its future sidecar must use a 512-pixel SD 1.5
frame rather than the SDXL contract. FLUX Fill is a gated 12-billion-parameter
workflow with separate text encoders and VAE; FIBO uses its own structured-edit
pipeline; and SDXL has a larger 1024-pixel working contract. See the [PowerPaint model
card](https://huggingface.co/JunhaoZhuang/PowerPaint-v2-1), [FLUX Fill model
card](https://huggingface.co/black-forest-labs/FLUX.1-Fill-dev), [FIBO model
card](https://huggingface.co/briaai/Fibo-Edit-1.5-turbo), and [SDXL inpainting
card](https://huggingface.co/diffusers/stable-diffusion-xl-1.0-inpainting-0.1).

These candidates are therefore not suitable low-memory Chromebook or ARM
defaults. No candidate is promoted based on file size, a quantized extension,
or a successful PNG response alone.

## Validation

Passed:

- `VARVE_TEST_WORKERS=1 pnpm exec vitest run packages/engine/src/generativeEdit/modelProfiles.test.ts --pool=forks --maxWorkers=1 --testTimeout=120000` — 5 tests.
- The focused generative engine lane — 7 files, 60 tests — passed before the
  final profile-gate-only rerun; the final profile rerun passed 5 tests.
- `node scripts/quality/generative-qualification.mjs --json` — all 24 frozen
  photographic fixtures and 32 tasks validate as input-only. This command
  intentionally makes no model-quality claim.
- `VARVE_E2E_PORT=1437 VARVE_E2E_WORKERS=1 npx playwright test tests/e2e/caf/expand-real-photo.spec.ts tests/e2e/caf/caf.spec.ts --project=chromium --reporter=list` — the real-photo Expand boundary passed; the run stopped on a 2-pixel Chromium antialiasing snapshot mismatch before the remaining cases.
- The isolated rerun of the affected real-photo visual case passed after the
  assertion gained a four-pixel renderer-edge tolerance. The baseline was not
  updated; the actual and expected dialog images were inspected and matched
  visually.
- `pnpm audit:docs`, `pnpm audit:emoji`, and `pnpm audit:tokens` passed.
- Commit hooks passed for `60c59abe7`, `7432b0778`, and `b2110a17c`.

The retained real-model evidence is in the runtime and SDXL qualification
reports:

- [runtime qualification](generative-editing-runtime-qualification-2026-09-12.md)
  — SD 1.5 candidates failed prompt quality or runtime integrity;
- [SDXL probe](generative-editing-sdxl-probe-2026-09-15.md) — the 1024-pixel
  candidate exceeded the host's practical memory envelope and failed the
  requested boat task; and
- [Expand qualification](generative-expand-qualification-2026-09-13.md) —
  promptless LaMa Expand preserved source pixels but remains limited for
  difficult architecture and subject boundaries.

## Outstanding release gates

`pnpm verify:plan` reported full-suite escalation because the shared worktree
contains concurrent workspace, native, serialization, and validation changes.
`pnpm verify:affected` stopped with the required escalation. The explicit
`pnpm verify:full` checkpoint reached architecture and typechecking, then
stopped on pre-existing repository-wide findings, including the engine LUT
tests' `Shaper3D`/`size` type mismatch. It did not certify the full repository.

Still outstanding are a qualified semantic local model, Windows/macOS/ARM and
Chromebook package evidence, the constrained 4-GB run, native cancellation
latency, complete multi-seed model-quality scoring, and final package-level
portability/export certification. The current state must not be marketed as
prompt-conditioned generation.
