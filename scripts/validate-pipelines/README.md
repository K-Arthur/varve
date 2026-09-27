# Multimodal pipeline validation

Real end-to-end validation of ONNX inference pipelines against the actual
downloaded weights — not mocked tensors. Vitest unit tests cover the
pre/post-processing math in isolation; these scripts prove that math is
correct against real model outputs, which is how two real bugs were found
(see `docs/testing/sam2-lineart-validation-2026-07-21.md`).

## Setup

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
mkdir -p models
```

Download the models these scripts validate (not committed to the repo —
see the root manifest at `apps/desktop/public/models/manifest.json` for
the canonical, verified URLs):

```bash
curl -L -o models/sam2_encoder.onnx \
  https://huggingface.co/vietanhdev/segment-anything-2-onnx-models/resolve/main/sam2_hiera_tiny.encoder.onnx
curl -L -o models/sam2_decoder.onnx \
  https://huggingface.co/vietanhdev/segment-anything-2-onnx-models/resolve/main/sam2_hiera_tiny.decoder.onnx
curl -L -o models/lineart.onnx \
  https://huggingface.co/rocca/informative-drawings-line-art-onnx/resolve/main/model.onnx
```

A verified archival mirror of the SAM2 pair lives on the repository's
`varve-models-v2` GitHub release (same upstream bytes, Apache-2.0). GitHub
release assets are not CORS-enabled, so the mirror is for manual/CI use only
(the in-app downloader keeps using the manifest's CORS-enabled URLs):

```bash
gh release download varve-models-v2 --pattern 'sam2_hiera_tiny.*.onnx' --dir models
sha256sum -c <<'EOF'
4cc015ee18520e93f8c7ddfeaca7436039daaaaf19721b4b96a8810a805e82f7  models/sam2_hiera_tiny.encoder.onnx
f5a4bd656c143899fb7f52d64ed81e6f6aeb37d477a0b6da50146ac7cf2187bf  models/sam2_hiera_tiny.decoder.onnx
EOF
```

Two things that are easy to get wrong, both encountered while running this:

**Filenames.** The validator loads `models/sam2_encoder.onnx` and
`models/sam2_decoder.onnx`. The mirror download above produces the upstream
filenames instead, so bridge them explicitly:

```bash
ln -sf sam2_hiera_tiny.encoder.onnx models/sam2_encoder.onnx
ln -sf sam2_hiera_tiny.decoder.onnx models/sam2_decoder.onnx
# ...or validate the bundled pair directly:
#   --models-dir ../../apps/desktop/public/models  (after the same two links)
```

**Two different encoder hashes are correct for two different consumers.**
`4cc015ee...` above is the **upstream** graph and is what this validator
loads directly with onnxruntime. The application never consumes those bytes
as-is: its manifest (`apps/desktop/public/models/manifest.json`) pins the
**repaired** graph, `b4cfd6c8bec2ef3674536419d731e61d15840367bd004d65095ae6a2b88b41cf`,
because ort-web's wasm shape inference rejects the upstream export's empty
`value_info` on `/conv_s0` and `/conv_s1` (the loader applies the reproducible
repair from `scripts/models/repair-sam2-graph.mjs` on install). So
`sha256sum -c` against the list above validates *validator* bytes; comparing
the bundled `apps/desktop/public/models/sam2_hiera_tiny.encoder.onnx`
against that list will fail by design — check it against the manifest instead
(the decoder hash `f5a4bd65...` is identical for both, since only the encoder
is repaired).

## Running

```bash
# Deterministic synthetic ground-truth regression suite (no network needed
# once models are downloaded; exits non-zero on regression)
.venv/bin/python3 validate_sam2_pipeline.py --synthetic
.venv/bin/python3 validate_lineart_pipeline.py --synthetic

# Manual spot-check against a real photo (not part of the automated gate —
# there's no ground truth for an arbitrary photo, this is for visual review)
.venv/bin/python3 validate_sam2_pipeline.py --real-image photo.jpg --point 0.4,0.5 --output /tmp/overlay.png
.venv/bin/python3 validate_lineart_pipeline.py --real-image photo.jpg --output /tmp/lineart.png
```

## What these catch that unit tests can't

Unit tests (`packages/engine/src/inference/models/sam2.test.ts`,
`lineArt.test.ts`) verify the TypeScript pre/post-processing functions
produce the right *shapes* and handle edge cases correctly, using
hand-constructed tensors. They cannot catch:

- A wrong assumption about what the real ONNX graph's inputs/outputs are
  named or shaped like (verified here by loading the actual `.onnx` files).
- A correct-looking transform that's wrong in a way that only shows up
  numerically (e.g. the letterbox coordinate bug — the code ran fine and
  produced a mask, just the wrong one).

Real photos matter in addition to synthetic ground truth because they
have texture, lighting, and multiple candidate subjects that a solid-color
square doesn't — a coordinate bug can hide in ways a clean synthetic test
won't reproduce (see the session notes in each script's docstring).

## Do not commit

Do not commit the downloaded `models/*.onnx` files or any real test
photos to git — `models/` and common image extensions are gitignored in
this directory. See `docs/testing/real-image-validation-corpus.md` for
the project's fixture policy.

## Cross-language reconstruction parity

`validate_sam2_pipeline.py --synthetic` certifies two reconstructions of the
decoder logits against source-space ground truth: `mask_to_full_res` (the
independent reference order) and `mask_to_full_res_production` (a line-for-line
mirror of `packages/engine/src/inference/models/sam2.ts`).

To freeze one real run and prove the *shipped* TypeScript lands on the same
pixels:

```bash
.venv/bin/python dump_sam2_fixture.py --out /tmp/sam2-parity
SAM2_REAL_PARITY_DIR=/tmp/sam2-parity npx vitest run \
  packages/engine/src/inference/models/sam2RealReconstructionParity.test.ts
```

Without `SAM2_REAL_PARITY_DIR` that suite skips and says so — it never reports
a pass it did not earn. Results are recorded in
`docs/quality/object-selection-parity.md` → "Mask reconstruction parity".
