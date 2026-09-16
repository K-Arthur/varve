# LaMa reconstruction real-model check — browser Expand, 2026-09-16

Status: disposable diagnostic probe, not a formal qualification run. This
follows the [PowerPaint scope decision](../plans/powerpaint-adapter-qualification-scope-2026-09-16.md)
— that direction was dropped for now in favor of extending the model Varve
already ships and has already qualified natively (LaMa) to the browser, which
needs no GPU, no Python stack, and no hosted service. It directly informed the
code change in `packages/engine/src/generativeEdit/pipeline.ts` and
`packages/editor/src/components/ContentAwareFill/ContentAwareFillDialog.tsx`
described below.

## Question

The generative-editing capability gate disabled **all** of promptless Expand
in the browser, with a comment attributing this to the browser fallback
"visibly repeating/striping photographic edges." But `expandFallback.ts`
already routes through the same shared `runContentAwareFillPipeline` that
Fill/Remove use — native LaMa first, the browser ONNX-Runtime-Web worker
second (`modelType: 'lama'`, already registered in
`packages/engine/src/inference/inferenceWorker.ts`), Fast/PatchMatch only at
`quality: 'fast'`. The rejected evidence in
[`generative-expand-qualification-2026-09-13.md`](generative-expand-qualification-2026-09-13.md)
and the architecture doc both describe the browser path as "PatchMatch
texture continuation," not the model. So: was the real LaMa model ever
actually tested for Expand's border-generation case, or did the blanket gate
block it before anyone tried?

## What was checked

Downloaded the pinned production artifact directly (`Carve/LaMa-ONNX`,
`lama_fp32.onnx`, 208,044,816 bytes) and verified its SHA-256 against the
checksum already recorded in `generative-expand-completion-2026-09-13.md`:
`1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6` — exact
match. Ran it through `onnxruntime-node` (CPU execution provider) using the
exact documented tensor contract from
`packages/engine/src/inference/models/lama.ts` — `image` `[1,3,512,512]`
float32 0–1, `mask` `[1,1,512,512]` float32 (1 = inpaint), output already
scaled 0–255 — against `tests/e2e/fixtures/real-life-landscape.jpg`, for two
cases:

1. **Fill-style**: a small circular mask over the mid-ground (mirrors what
   Fill/Remove already send today).
2. **Expand-style**: the source letterboxed into the top-left 320×320 of the
   512×512 frame, mask covering the rest as "generate" — a simplified proxy
   for what `expandFallback.ts` sends (not the exact production letterbox/
   staged-border geometry, which is a separate, more careful contract).

This is directional evidence only, in the same spirit as the 2026-09-16
MI-GAN/Moebius screen: a disposable probe outside the product tree, not a run
through the actual production adapter, and not scored against the frozen
24-photo/32-task corpus. `onnxruntime-node`'s CPU backend is not literally
`onnxruntime-web`'s WASM backend, though it runs the identical ONNX graph
(opset 17, no custom ops per the model's own documented contract), so the
numerical output should match; this is not a substitute for an actual
in-browser qualification run.

## Environment

Same machine as the PowerPaint scope check, run immediately after: available
RAM fluctuated between roughly 1.1–2.5 GiB free during the session (heavy
concurrent load from other agent/desktop processes), 25 GB disk free. The
208 MB model plus `onnxruntime-node`'s CPU session fit comfortably within
that — a materially smaller footprint than any Python/Diffusers/PyTorch
candidate, which is exactly why this was feasible here and PowerPaint was not.

## Result

- Cold session load: ~16.0 s. Fill-style inference: ~7.6 s. Expand-style
  inference: ~8.1 s. (The native qualification report recorded 20–21 s warm /
  58 s cold including composition overhead on the same architecture family;
  these numbers are consistent with that, not a new latency claim.)
- **Fill-style result**: the masked region (fence line, dark grass, tree
  trunks) filled plausibly, continuous with surrounding tone and lighting, no
  visible seam.
- **Expand-style result**: the generated border continued the building
  roofline across the new region and extended the diagonal white curb/path
  line from the source in a geometrically coherent way, matching the source's
  perspective. Tree silhouettes continued plausibly. **No repeating or
  striped texture was visible** — the specific failure mode that got the
  Fast/PatchMatch path removed from the public capability surface did not
  reproduce here.

This is real, if limited (one photo, one synthetic geometry, no seed/
variation sweep, CPU-node not literal browser-WASM), evidence that the
striping failure documented for browser Expand belongs to PatchMatch, not to
LaMa — and that nobody had actually exercised LaMa for Expand's
edge-of-canvas case before this check; the capability gate disabled it
categorically rather than differentiating by quality tier.

## What changed as a result

`packages/engine/src/generativeEdit/pipeline.ts`:

- `localCapabilities()`'s `expand` capability is now structurally available
  everywhere (`available: true`, matching Fill/Remove), not gated on the
  desktop-only native diffusion provider. `ready` still gates only the
  prompt-conditioned path, unchanged.
- `runGenerativeEdit()` gained an explicit guard: Fast-quality Expand
  (`quality: 'draft'`) without a native diffusion helper present now fails
  closed with `unsupported-mode` and an explanatory message, precisely
  reproducing the one failure this project already rejected — PatchMatch at
  the image edge — while AI-quality Expand (native LaMa, or the browser
  worker once the model is installed) now reaches the shared reconstruction
  pipeline instead of being blocked by platform alone.

`packages/editor/src/components/ContentAwareFill/ContentAwareFillDialog.tsx`:

- Mirrors the same Fast+Expand+no-native-helper block at the UI layer
  (`expandFastBlockedHere`), with a hint explaining that AI quality
  (downloads the local model) or the desktop app are the paths forward,
  instead of the previous blanket "Expand is unavailable in the browser."

Tests: `packages/engine/src/generativeEdit/generativeEdit.test.ts` and
`capabilities.test.ts` updated/added to cover the new gate at both the
capability-reporting and execution level.
`tests/e2e/caf/expand-real-photo.spec.ts` updated to assert the new
Fast-blocked message and that switching to AI quality clears it and offers
the model download — **not run in this session**: this machine had a
conflicting dev server already bound to the default port from another
concurrent session, and available RAM was down to under 1 GB free by the
time this would have run. Running Playwright E2E here risked destabilizing
other in-progress work on this shared machine. This spec needs a real run
(and, beyond that, a genuine browser-WASM download-and-generate pass with a
real photograph, following this project's own established real-model
qualification bar) before this can be called verified rather than
implemented.

## What this is not

- Not a qualification of browser LaMa/Expand against the frozen corpus.
- Not evidence about `onnxruntime-web`'s WASM backend specifically, browser
  memory behavior, cancellation, or any platform other than this one Linux
  x86_64 CPU host.
- Not a claim that the production `expandFallback.ts` letterbox/staged-border
  geometry behaves identically to this probe's simplified corner-placement
  proxy — production Expand needs its own real-photo review once the E2E
  path above actually runs.
- Not a re-review of the Fast/PatchMatch rejection itself, which stands
  unchanged.
