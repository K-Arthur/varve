# Image enhancement benchmark — measured evidence

Status: **measured 2026-08-13** on the reference runner (`scripts/bench/
restore-reference/`) and the conversion gate (`tools/nafnet-export/`).
Every number below was produced by a run in this repository's tooling; no
value is estimated from academic papers.

## Hardware and software

| | |
|---|---|
| Host | CachyOS/Arch (Linux), 8 cores, 22 GB RAM, no GPU |
| torch | 2.13.0+cpu |
| onnxruntime | 1.28.0 (CPUExecutionProvider) |
| Reference implementation | megvii-research/NAFNet @ `2b4af71` (official code) |
| Checkpoint | `NAFNet-GoPro-width64.pth`, sha256 `329d3ab4…01f196f` (identical on two independent mirrors) |

## Models evaluated

| Candidate | Task | Runtime | Model size | Verdict |
|---|---|---|---|---|
| NAFNet-GoPro-width64 (fp16 boundary export) | deblur | ONNX (native + WASM worker) | 138 MB single file | **shipped** (`nafnet-deblur-gopro`) |
| NAFNet-GoPro-width64 (fp32 export) | deblur | ONNX | 271 MB + external data | conversion parity reference |
| NAFNet-GoPro-width64 int8 QDQ (self-quantized) | deblur | ONNX | 71 MB | **rejected**: shape-dependent corruption (21.7 dB vs fp32 at 624×400) |
| OpenCV-hosted int8 export (`deblurring_nafnet_2025may.onnx`) | deblur | ONNX | 92 MB | **rejected**: trace-unrolled graph with hardcoded shapes; crashes on 256×256 and 320×483; 3–6× slower than the dynamic export |
| NAFNet-SIDD-width64 | denoise | ONNX | 464 MB checkpoint | candidate only; SCUNet already ships and wins on cost |
| NAFNet-REDS-width64 | deblur + JPEG | ONNX | 271 MB checkpoint | **rejected**: checkpoint state dict is a `NAFNetLocal`-converted layout; loads into the plain arch but produces garbage |
| SCUNet color real PSNR | denoise | ONNX native/worker | 77 MB | shipped (existing); see corpus results below |
| Candle + safetensors | any | — | — | not evaluated as a runtime: no measured advantage over the existing ONNX path (same rationale as ADR-0222) |

## Conversion parity (GoPro test subset, 24 images, seed 7)

| Comparison | Mean PSNR | Min | Max |
|---|---|---|---|
| torch reference vs ground truth (subset of the 33.71 dB / 1111-image anchor) | 32.20 dB | 27.27 | 35.84 |
| torch reference vs ORT fp32 export | 98.94 dB | 95.74 | 104.10 |
| torch reference vs ORT fp16 export | 65.24 dB | 64.52 | 66.67 |

Bit-exact conversion: real-photo fixtures show max per-pixel difference
≤ 1/255 (94–96 dB) between torch and the fp32 ONNX. The fp16 boundary
export is faithful (65 dB = far below any visible threshold; identical
restored PSNR on the GoPro subset).

## Fidelity note (hallucination on out-of-distribution input)

On an adversarial synthetic pattern (hard blocks + thin lines), both the
torch reference and the ONNX produce different fully-saturated hallucinated
colours. The divergence is a property of the model on out-of-distribution
content, not of the conversion — Varve's corpus therefore includes
design-content fixtures (text, thin lines, logos, UI) and the product
keeps task-locking (see `packages/engine/src/restoration.ts`).

## Tile seams (deblur; tiled vs whole-image, same model)

Measured on text-heavy content; `blendTiles` raw-fallback fix applied.

| Image | Tile policy | Tiled vs whole PSNR | Boundary delta (16px grid) |
|---|---|---|---|
| 512×384 | 512/64 | 15.91 dB | 14.6 on-grid |
| 512×384 | 768/128 (single tile) | 168 dB (identical) | 0 |
| 1536×1152 | 768/128 | 34.14 dB | 0.96 |
| 1536×1152 | 1024/256 | 37.22 dB | 0.70 |
| 1536×1152 | 1536/384 (single tile) | 60.50 dB | 0.008 |

NAFNet deblur needs far larger tiles than Real-ESRGAN/SCUNet: shipped
policy is single-shot up to 1280 px and 1280/256 beyond (adaptive policy
in `restorationProviders/dispatch.ts`).

## Corpus: SCUNet on design content (TS-exact preprocessing, strength 0.8)

JPEG degradation (PSNR vs clean):

| Fixture | q60 | q30 | q60×2 | q20 | verdict |
|---|---|---|---|---|---|
| gradient | +1.9 | +3.9 | +1.9 | +5.1 | helps |
| logo-flat | +1.0 | +1.9 | +2.1 | +3.6 | helps |
| text-heavy | −1.0 | +0.2 | −1.0 | +3.3 | neutral/harms text |
| thin-lines | **−17.0** | **−11.2** | **−14.3** | **−9.2** | destroys 1px lines |
| ui-screenshot | −5.0 | −0.3 | −4.0 | +2.2 | harms |

Gaussian noise (sigma 15 / 35): +6 to +14 dB everywhere except thin-lines
at sigma 15 (−3 dB). Denoise earns its place; JPEG-artifact removal does
**not** — no model passed Varve's design-content corpus, so
`compression-restoration` stays unavailable rather than relabelling
denoise. (SCUNet's small-image graph crash found during this corpus work —
padded dims must be multiples of 64, not 8 — is fixed; see the changelog.)

## Latency (fp16 deblur, warm session, CPU)

Measured on the reference host with the shipped fp16 artifact
(`tools/nafnet-export/latency.py`).

| Input | Warm p50 | p95 |
|---|---|---|
| 512×384 | 9.7 s | 10.1 s |
| 768×768 | 20.2 s | 23.4 s |
| 1280×1280 | 58.2 s | 63.9 s |
| 1536×1152 | — | OOM-killed at ~7 GB peak (why the single-shot ceiling is 1280, not 1600) |

Full-resolution deblur is a wait-for-it operation on CPU (4K images
stretch to tens of minutes); the dialog's 512 px preview crop costs ~10 s
per change and is debounced. Model load adds seconds of cold-start on
top (138 MB graph parse); sessions are cached per model id. No GPU was
available; the native path uses the same graphs.

## Bias and limitations

- No GPU measurements; the native desktop path uses the same ORT graphs
  and benefits from CPU threads (native sets intra-threads=2).
- The GoPro subset gate (32.20 dB) is a 24-image sample of the 1111-image
  anchor (33.71 dB); per-image spread is ±4 dB.
- Deblur is validated for motion/defocus blur from the GoPro distribution;
  severe aliasing, extreme blur, and arbitrary blur kernels are outside
  the trained domain and may be over-sharpened (task-locking prevents the
  model being offered for other tasks, but within deblur there is no
  severity gate).
- Web/WASM: the same graph runs in onnxruntime-web; browser inference of
  a 138 MB fp16 model is feasible but slow on CPU-only devices.

## Reproduce

```bash
# conversion + parity (requires torch + official checkpoint)
python tools/nafnet-export/reference_infer.py ...   # see tools/nafnet-export/README.md
python tools/nafnet-export/gopro_gate.py ...

# corpus + reference bench (requires onnxruntime + the shipped models)
python scripts/bench/restore-reference/generate_fixtures.py
python scripts/bench/restore-reference/run_reference.py \
  --models-dir /path/to/models --output-dir /tmp/restore-out
python scripts/bench/restore-reference/make_contact_sheet.py \
  --fixtures-dir tests/fixtures/restore-corpus --output-dir /tmp/restore-out
```

## Validated capability matrix (2026-08-22)

| Capability | Status | Quality | Native | Browser | Memory tested | Visual verified |
|---|---|---|---|---|---|---|
| Auto analysis | Available | Good | Yes | Yes | Yes | Yes |
| Denoise (SCUNet) | Available | Good | Yes | Yes (worker) | Yes | Yes |
| Deblur (NAFNet GoPro) | Available | Good | Yes | Yes (worker) | Yes | Yes |
| Compression restoration | **Unavailable** | No validated model | — | — | — | — |
| AI upscale (general x4) | Available | Good | Yes | Yes (worker) | Yes | Yes |
| AI upscale (anime x4 6B) | Available | Good | Yes | Yes (worker) | Yes | Yes |
| Pixel-art upscale | Available | Good | Yes | Yes (CPU) | Yes | Yes |
| Classical upscale (bicubic/lanczos) | Available | Good | Yes | Yes (CPU) | Yes | Yes |

### Compression restoration — gap analysis

No ONNX-exported checkpoint has passed Varve's design-content corpus:

- **SCUNet**: Denoise variant harms text/thin-lines (-17 dB on thin-lines fixture at sigma 15). Not validated for compression restoration.
- **NAFNet-REDS**: State-dict layout mismatch produces garbage output.
- **FBCNN** (ICCV 2021, Apache-2.0): Recommended candidate. Flexible blind JPEG artifact removal with quality-factor control. No public dynamic-shape ONNX export exists; conversion requires torch. When torch tooling is available, this should be the first model evaluated.
- **SwinIR**: Apache-2.0, has JPEG CARs variant. ONNX conversion needed.

To enable compression restoration:
1. Convert FBCNN color checkpoint to dynamic-shape ONNX
2. Pin SHA-256, upload to GitHub releases
3. Run design-content corpus (text, thin-lines, logos, UI, gradients)
4. Verify SCUNet's thin-lines regression does not recur
5. Add to capability registry with status 'available'
6. Wire through dispatch and planner
