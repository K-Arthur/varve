# PowerPaint v2-1 adapter qualification — scope and environment check, 2026-09-16

Status: scoping record only. No model weights were downloaded and no
qualification run was started. This follows directly from the
[2026-09-15 landscape review](../research/generative-inpainting-model-landscape-2026-09-15.md),
which names PowerPaint v2-1 as the first local prompt-model qualification
candidate but explicitly states it "requires a separate pinned Python/PyTorch
adapter or a proven native port" and is not yet attempted.

## What "qualification" actually requires

Following the same bar every other candidate in this codebase has been held
to (see the [qualification plan](../research/generative-inpainting-model-landscape-2026-09-15.md#qualification-plan-for-the-selected-local-candidates)
and the completed [MI-GAN/Moebius screen](../audits/generative-editing-lightweight-model-screen-2026-09-16.md)
as the most recent precedent), PowerPaint qualification is not "download a
checkpoint and try a prompt." It is:

1. **Component inventory and licensing.** PowerPaint-v2-1's own model card
   (`JunhaoZhuang/PowerPaint-v2-1`, Apache-2.0) documents a `DiffusionPipeline`
   used with `dtype=torch.bfloat16` and `device_map='cuda'` (or `mps` on Apple
   Silicon) — there is no documented CPU-only usage path. Varve's own
   architecture doc separately records PowerPaint's *published bundle* as an
   SD 1.5 base plus a separate BrushNet adapter (512×512 frame contract);
   that BrushNet component is not mentioned on the Hugging Face pipeline card
   itself, which is exactly the kind of discrepancy the qualification
   process exists to catch — component identity must be nailed down against
   the actual repository (`github.com/zhuang2002/PowerPaint`) before any run,
   not assumed from either doc.
2. **A supervised adapter**, following the pattern already built for the SD
   1.5 helper (`crates/varve-generative-helper/`): a separate process,
   opaque model/image handles over IPC (no raw paths or bytes across the
   webview boundary), the shared `DiffusionFrameContract` (mask polarity,
   input kind, letterbox geometry) implemented for whatever tensor shape
   PowerPaint/BrushNet actually expects, real progress reporting, and
   cancellation that terminates the process within the product's existing
   bound. PowerPaint's own runtime is Python/Diffusers/Transformers/
   Accelerate/PyTorch, not the Rust `diffusion-rs` binding the current SD 1.5
   profile uses — this is a second runtime family, not a config change to the
   first.
3. **The frozen 24-photo/32-task corpus and review gate** — same evidence
   bar as every other prompt candidate: three seeds, real-photograph Fill/
   Remove/Replace/Expand, mask-edge cases (empty, one-pixel, holes,
   disconnected, inverted, out-of-bounds), cancellation during load/sample/
   decode, and save/reopen/export/undo after acceptance.
4. **Per-platform evidence** — separate qualification per OS/backend/CPU
   architecture (this project's stated policy; a Linux CPU pass does not
   qualify Windows, macOS, or ARM).

Even the much smaller MI-GAN screen (14.8 MB, a single ONNX/GGUF file, no
adapter needed for the disposable probe) took a dedicated session using an
isolated `/var/tmp` build and was still only a *disposable diagnostic*, not a
qualification. PowerPaint is a full Diffusers pipeline with an unresolved
component list — this is realistically several sessions of work: environment
setup, component reconciliation, adapter code, corpus run, and — if it
passes — the actual Rust supervised-helper integration and its own test
coverage. It is not a today-sized task even under ideal conditions.

## Environment check performed before any download

Before committing to that effort, I checked whether *this* machine is a safe
place to even start, against the exact bar the project's own research doc
already set ("22 GiB physical memory, about 3.6 GiB available, and heavily
used swap... not a safe environment... No large model was started merely to
create a green-looking probe.") Measured 2026-09-16:

| Signal | Measured | Why it matters |
| --- | --- | --- |
| Available RAM | **2.0–2.5 GiB free**, 21 GiB of 22 GiB swap already in use | Worse than the prior "unsafe" baseline (3.6 GiB). A PyTorch + Diffusers + Transformers + Accelerate process alone commonly resides several hundred MB to 1+ GB before loading any weights; SD1.5-scale UNet + BrushNet + VAE + text encoder weights push working RSS well past what's free here. |
| GPU | AMD "Lucienne" integrated graphics only; no `nvidia-smi`, no discrete GPU | PowerPaint's own usage instructions specify `device_map='cuda'` or `mps`; there is no documented CPU-only path, and CPU-only `bfloat16` inference on an 8-core laptop APU would be slow and is not the path anyone has validated for this model. |
| Disk | 25 GB free on a 230 GB volume already 89% full, shared with the whole repo and every other agent's worktree | PyTorch CPU wheels, Diffusers/Transformers/Accelerate, and PowerPaint's weights (base SD1.5 scale plus BrushNet) would consume a meaningful fraction of what's left, on a disk other concurrent sessions also depend on. |
| Python toolchain | Python 3.14.7, **no pip, no conda/mamba installed** | PyTorch wheel availability for very new CPython minor versions lags; a working install is not guaranteed without first resolving a Python/toolchain mismatch, which is its own unscoped side effort. |
| Concurrent load | Two live `opencode2` processes, a live `claude` session, an `agy` process, and the user's own desktop (Firefox, KDE) all running now | This is a shared, live, interactive machine, not an isolated qualification box. A multi-GB download plus a CPU-bound multi-minute-per-image inference run risks starving or OOM-killing other agents' in-progress work (this has happened before on this machine — see the standing note on long/heavy runs getting silently SIGKILL'd under concurrent load). |

## Conclusion

This machine fails the project's own established device-safety bar, more
severely than the baseline that bar was written against, and on every one of
memory, GPU, disk, and toolchain readiness. I did not download PowerPaint
weights or install a Python ML stack here. Starting that work now would risk
degrading or crashing other concurrent sessions on this shared machine for a
run that is unlikely to complete successfully anyway (no CUDA/MPS, marginal
RAM, unproven Python 3.14 compatibility).

This is not a verdict on PowerPaint's suitability as a candidate — the
2026-09-15 landscape review's ranking stands. It is a verdict on this specific
shared desktop, right now, as the place to run that qualification.
