# Image enhancement benchmark

This report defines the reproducible evidence required before adding another
restoration model. It intentionally does not invent measurements for NAFNet,
Candle, or an untested accelerator.

## Comparison scope

| Candidate | Task | Runtime | Current status |
| --- | --- | --- | --- |
| SCUNet color real PSNR | real-world denoise | ONNX native/worker | shipped and manifest-verified |
| Real-ESRGAN general x4 | super-resolution | ONNX native/worker | shipped and manifest-verified |
| NAFNet SIDD checkpoint | denoise | not selected | candidate; task and licensing review required |
| NAFNet GoPro checkpoint | motion deblur | not selected | candidate; no Varve conversion/parity evidence yet |
| Candle + safetensors | any | not selected | no measured advantage over existing ONNX path |

Unsupported cells are intentionally left as status, not guesses. A benchmark
run should record model revision and SHA-256, source fixture, dimensions, tile
policy, provider, cold/warm timing, peak memory, output parity, PSNR, SSIM,
alpha difference, tile-boundary difference, and visual review notes.

## Corpus requirements

The held-out set should include photography, portraits, products, architecture,
UI screenshots, logos, text-heavy graphics, gradients, line art, illustrations,
anime, pixel art, transparency, and repeated JPEG degradation. Synthetic
degradation recipes must record type, severity, seed, source, dimensions, and
compression settings. Design fixtures receive additional checks for OCR/text
changes, 1px lines, logo geometry, alpha edges, and palette preservation.

## Reproduction

Run the existing quality evaluator for compact fixtures and use the benchmark
lane for real checkpoints. Generate comparison sheets with clean/source,
degraded, current path, candidate path, and difference crops at 100%. A model
does not qualify from PSNR/SSIM alone: ringing, halos, over-smoothing, false
detail, changed labels, and changed logos are product failures.

The current repository has not run a NAFNet conversion/parity bake-off, so this
document records that as pending rather than presenting academic numbers as
Varve measurements.
