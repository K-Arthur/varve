# LaMa decode interpolation — real-photo quality tuning, 2026-09-16

Status: implemented and unit-tested fix, backed by a disposable real-model
probe across a wider corpus than the earlier
[browser real-model check](lama-reconstruction-real-model-check-2026-09-16.md)
covered. Continues that check's "close the gap, don't chase a new model"
direction: this is a tuning fix to the shared decode path both Fill/Remove
and Expand already use, not a model or geometry change.

## Question

The Expand qualification report already flagged an "architecture continuation
remains limited/review-only" case with a "dark generated band despite a close
immediate seam score." That was recorded as an open limitation, not
diagnosed. Asked to look for ways to improve LaMa's results across a wider,
real-photo corpus and across modalities (Fill/Remove and Expand), the first
step was to actually reproduce that failure with real evidence and find out
what is actually causing it.

## What was checked

Downloaded the pinned production LaMa checkpoint again (same verified
SHA-256: `1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6`)
and built a disposable Node/`onnxruntime-node` harness that, unlike the
2026-09-16 browser check, reuses the actual production geometry functions
directly from source (`extractBoundedContext`/`compositeFillResult` in
`contentAwareFill/contextExtraction.ts`, `computeExpandPlan`/
`buildExpandedFrame`/`restoreProtectedPixels`/`expandCoverageMask` in
`generativeEdit/expandPlan.ts`, and `decodeLamaOutput` itself) rather than a
simplified proxy — only the letterbox-resize-to-512 step, which depends on
`OffscreenCanvas`, was reimplemented (bilinear, matching what a real canvas
`drawImage` would do). Ran both a Fill-style masked-patch case and a
full-geometry Expand case (18% margins on two sides) against ten diverse real
photographs: landscape, architecture (the flagged case), a bearded-man
portrait, still life, a Galápagos crab (fine texture/fur-adjacent detail), a
sepia interior room, a glass-reflection scene, a historic building facade,
a seascape sunset, and a hot-spring landscape. All ten ran successfully;
outputs were inspected as images, not inferred from logs.

## Finding

**Fill/Remove showed no visible defect in any of the ten cases** — masked
regions blended seamlessly into surrounding texture, lighting, and fine
detail (hair, fur-adjacent crab legs, lace curtains) even with a hard-edged,
unfeathered mask.

**Expand showed a clear, consistent defect in every case with a
large-enough output frame**: visible rectangular block/pixelation artifacts
at the newly generated border, most obvious on smooth gradients (sky,
out-of-focus backgrounds, water) where blocking reads as banding rather than
texture. This reproduces the documented architecture "dark band" finding —
but inspection showed the banding there is this same blocking artifact
sitting on a photograph with strong tonal gradients, not a separate
model-quality failure.

Root cause: `decodeLamaOutput` (`packages/engine/src/inference/models/lama.ts`)
resized the model's fixed 512×512 output back up to the caller's target
resolution using **nearest-neighbor** sampling (`Math.floor(x * xRatio)`).
Fill/Remove's bounded context is usually close to 512px, so the enlargement
factor is small and nearest-neighbor is nearly invisible. Expand's output
frame is the *full requested output size* — for these ten photos, 1.4–2.7×
their original dimensions — so the model's 512px generation is enlarged by a
much larger factor, and nearest-neighbor's blocking becomes clearly visible.
This function is shared by every caller (native and browser-worker LaMa
alike, both Fill/Remove and Expand), so the fix improves all of them, but the
effect was practically invisible until Expand was exercised against the real
model with real-scale margins.

## Fix

Replaced the nearest-neighbor sampler in `decodeLamaOutput` with bilinear
interpolation (pixel-center sampling, clamped to the content region so the
existing letterbox-crop semantics are unchanged). Re-ran the four
worst-affected cases (architecture, a historic building facade, a seascape
sunset, and the bearded-man portrait) through the same probe with the fix:
all four lost the blocking artifact, replaced by a smooth — if intentionally
soft, as already disclosed to users via `estimateExpandGenerationResolution`
— gradient at the generated border. No case regressed.

All eight pre-existing `decodeLamaOutput` unit tests still pass unchanged: the
letterbox-crop boundary tests only assert exact values at the extreme edges
of the sampled region, where clamping pins the bilinear sample to the same
single source pixel nearest-neighbor would have used, and the uniform-color
tests average to the same uniform value under either algorithm. Added one new
test asserting an actual interpolated (non-source-exact) midpoint value,
which fails under the old nearest-neighbor implementation and passes under
the new one — the only test in the file that would have caught this
regression.

## What this is not

- Not a re-qualification of the pinned LaMa checkpoint or the frozen
  24-photo/32-task corpus — this is a decode-path bug fix, evidenced by a
  disposable probe outside that corpus, not a new qualification run.
- Not evidence about `onnxruntime-web`'s WASM backend specifically (same
  caveat as the 2026-09-16 browser check: this ran on `onnxruntime-node`'s
  CPU backend against the identical ONNX graph).
- Does not change mask semantics, context padding, compositing, or any
  geometry contract — only how the model's fixed-resolution output is
  resampled to the caller's target size.
- Does not resolve the underlying, already-disclosed resolution limit: a
  512px generation enlarged to a much larger output frame is still lower
  effective detail than native resolution. That tradeoff is unchanged and
  correctly surfaced by `estimateExpandGenerationResolution`'s disclosure
  text; this fix only removes the *additional*, avoidable blocking on top of
  it.
