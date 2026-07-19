# Background removal real-image benchmark — 2026-07-19

## Scope

This benchmark exercises the production browser engine through Playwright, not a mocked
provider. It compares all three user-facing methods on four real photographs:

- cat/fur: Oxford-IIIT Pet (qualitative; no trimap was included in the selected mirror row)
- human/hair: P3M-10K portrait with a soft alpha matte
- vehicle: DIS5K off-road car with a pixel mask
- object: DIS5K patio table/chairs with a pixel mask

The repeatable harness is
`tests/e2e/canvas/background-removal-quality.spec.ts`. Fixtures are intentionally external and
selected with `STRATA_BGREMOVAL_BENCH_DIR`; they are not redistributed in this repository.

## Method

- Chromium drove the Vite application and imported the production background-removal module.
- Source images retained their original dimensions; inference used the production 1024 px
  preview ceiling and source-resolution reconstruction.
- Binary metrics use an alpha threshold of 128. Alpha MAE uses the full 0–255 matte.
- The 224,005,088-byte BiRefNet model was downloaded to `/tmp`, and its SHA-256 matched the
  application manifest: `5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333`.
- The harness records requested and actual method separately, so a fallback cannot masquerade
  as a successful Quality inference.

## Results

| Subject | Requested | Actual/backend | IoU | Dice | Precision | Recall | Alpha MAE | Time |
|---|---|---|---:|---:|---:|---:|---:|---:|
| Human | Quick | Quick/TypeScript | 0.683 | 0.812 | 0.995 | 0.685 | 0.152 | 140 ms |
| Human | Balanced | Balanced/WASM | **0.982** | **0.991** | 0.983 | **0.999** | **0.012** | 3.76 s |
| Human | Quality | **Balanced fallback/WASM** | 0.982 | 0.991 | 0.983 | 0.999 | 0.012 | 4.34 s |
| Vehicle | Quick | Quick/TypeScript | 0.128 | 0.227 | 0.178 | 0.312 | 0.553 | 369 ms |
| Vehicle | Balanced | Balanced/WASM | **0.490** | **0.658** | **0.953** | 0.502 | **0.132** | 2.81 s |
| Vehicle | Quality | **Balanced fallback/WASM** | 0.490 | 0.658 | 0.953 | 0.502 | 0.132 | 2.79 s |
| Object | Quick | Quick/TypeScript | 0.123 | 0.219 | 0.130 | **0.689** | 0.490 | 460 ms |
| Object | Balanced | Balanced/WASM | **0.390** | **0.561** | **0.967** | 0.395 | **0.075** | 3.75 s |
| Object | Quality | **Balanced fallback/WASM** | 0.390 | 0.561 | 0.967 | 0.395 | 0.075 | 3.64 s |

After repairing native model storage and routing, the same Quality model was run through the
bundled native ONNX Runtime on Linux:

| Subject | Actual/backend | IoU | Dice | Precision | Recall | Alpha MAE | Time |
|---|---|---:|---:|---:|---:|---:|---:|
| Human | Quality/native CPU | **0.992** | **0.996** | 0.996 | 0.995 | **0.007** | 17.70 s |
| Vehicle | Quality/native CPU | **0.982** | **0.991** | 0.987 | 0.996 | **0.006** | 34.53 s |
| Object | Quality/native CPU | **0.894** | **0.944** | 0.933 | 0.956 | **0.013** | 19.68 s |

The native cat result produced a coherent whole-cat silhouette with soft fur boundaries in 15.61
seconds. These are real BiRefNet results (`method=ai-quality`), not relabeled Balanced output.

Cat foreground diagnostics (no reference mask): Quick selected 25.2% of the image with no soft
edge pixels; Balanced selected 47.8% with 21.3% soft-edge pixels. Visual inspection showed Quick
fragmenting the white cat into foreground/background patches, while Balanced produced a coherent
silhouette with soft fur transitions. Quality produced the same mask as Balanced because it fell
back.

## Findings

1. **Balanced is production-credible for portraits.** The portrait result retained nearly all
   reference foreground and produced a low alpha error, including soft hair edges.
2. **Quick is only a coarse heuristic.** It was fast, but its vehicle/object masks were not usable
   without substantial correction, and it visibly fragmented the cat.
3. **Balanced is conservative on complex scenes.** High precision but low recall on the vehicle
   and patio set means it usually avoided background leakage while dropping valid foreground
   parts (front/lower vehicle structure and secondary furniture).
4. **Quality is not a distinct browser result on this Linux host.** Headless Chromium exposed no
   accepted hardware WebGPU adapter. Strata correctly rejected unsafe BiRefNet WASM execution and
   returned an explicitly identified Balanced fallback.
5. **The UI must continue to surface requested versus actual method.** Reporting these runs as
   “Quality” would be materially misleading even though the fallback itself completed safely.
6. **Native Quality is substantially better on complex subjects.** Compared with Balanced, native
   BiRefNet raised vehicle IoU from 0.490 to 0.982 and multi-object IoU from 0.390 to 0.894. The
   tradeoff is CPU latency (roughly 16–35 seconds on these fixtures).

## Deployment recommendation

- Keep U²-Net-P as the bundled, no-download compatibility fallback. At 4.7 MB it is the only
  current general model appropriate for constrained browser/WASM systems, but the vehicle and
  object scores above are too weak for it to be the long-term meaning of “Balanced.”
- Keep BiRefNet General Lite as desktop Quality. The native measurements above show that its
  224 MB download is a strong accuracy/size compromise. Do not expose the 928 MB full BiRefNet
  model by default until it demonstrates a material gain over Lite on this fixture set.
- Benchmark IS-Net general-use as the leading Balanced replacement candidate. Its official DIS
  evaluation targets complex natural objects at 1024×1024, while its roughly 177 MB size remains
  meaningfully below full BiRefNet. It should be an optional download with U²-Net-P fallback, not
  a mandatory bundled asset, until WASM/native memory and latency are measured on low-, mid-, and
  high-tier systems.
- Consider MODNet only as a portrait-specific fast route, not the general Balanced model: its
  published scope is photographic human matting rather than vehicles, products, and arbitrary
  multi-object scenes.

Primary references: [BiRefNet official implementation](https://github.com/ZhengPeng7/BiRefNet),
[IS-Net paper](https://www.ecva.net/papers/eccv_2022/papers_ECCV/papers/136780036.pdf),
[U²-Net official implementation](https://github.com/xuebinqin/U-2-Net), and
[MODNet official implementation](https://github.com/ZHKKKe/MODNet).

## Apply-path regression

The app-side “Generated mask dimensions do not match the selected source image” crash was caused
by stale or absent natural-dimension metadata on raster imports. Apply now aligns cached metadata
to the orientation-normalized source pixels used for inference, preserves referenced-paint
isolation, and treats a rejected commit as a recoverable preview error instead of throwing through
`EditorProvider`. The Chromium regression now drives Balanced through preview and **Apply**, then
asserts the committed “Re-apply” state and absence of an error boundary.

## Verification

```text
pnpm exec playwright test tests/e2e/canvas/background-removal-quality.spec.ts \
  --project=chromium --reporter=list

12 passed (1.5m)

XDG_DATA_HOME=/tmp/strata-native-quality cargo run -p strata-bgremove --features ai \
  --example native_quality_smoke -- <onnxruntime-dylib> <model.onnx> <image> <mask.png>

4/4 native runs returned method=ai-quality

npx playwright test tests/e2e/canvas/background-removal.spec.ts \
  --project=chromium --workers=1 --grep "AI Balanced"

1 passed
```

The raw local results and generated masks remain in `/tmp/strata-bg-bench/` for this workspace
session. They are ephemeral and are not source-controlled.
