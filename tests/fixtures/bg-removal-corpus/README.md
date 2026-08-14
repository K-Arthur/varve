# Background-removal benchmark corpus

The checked-in fixtures are intentionally small and legally redistributable.
They cover deterministic pipeline regression and reference-model drift. The
JPEG images in this directory currently use U²-NetP outputs as `referenceModel`
masks; those masks are **not ground truth** and must not be used to claim model
accuracy.

For quality decisions, provide a separate directory through
`VARVE_BGREMOVAL_BENCH_DIR`. Keep source images, masks/mattes, and a manifest
together there. The Playwright benchmark writes one mask per requested method
and a machine-readable `results.json`; summarise it with:

```bash
VARVE_BGREMOVAL_BENCH_DIR=/path/to/corpus \
VARVE_BGREMOVAL_BENCH_ITERATIONS=3 \
pnpm exec playwright test tests/e2e/canvas/background-removal-quality.spec.ts \
  --project=chromium --workers=1 --reporter=list
node scripts/bench/background-removal-report.mjs \
  --input /path/to/corpus/results.json \
  --output /path/to/corpus
```

The held-out evaluation set should include, at minimum:

- hair, fur, feathers, foliage, wires, cables, spokes, fences, and eyelashes;
- glass, clear plastic, translucent fabric, smoke, steam, fog, reflections, and soft shadows;
- low-contrast, backlit, over/under-exposed, noisy, compressed, cluttered, multi-subject, cropped,
  boundary-touching, holed, tiny-subject, and near-full-frame images;
- products, portraits, lifestyle photography, illustrations, anime/cartoon art, logos, icons,
  UI screenshots with text, posters, mockups, and rendered 3D products;
- tiny, very wide/tall, high-megapixel, grayscale, alpha-bearing, EXIF-rotated, ICC-profiled, and
  high-bit-depth inputs where the host pipeline supports them.

Use separate development, tuning, and held-out evaluation manifests. A binary
mask supports IoU, Dice, precision, recall, mask MAE, and boundary F-score. A
true alpha matte may additionally report SAD, MSE, gradient error, and trimap
band MAE. Do not relabel segmentation masks as mattes.

Large or licensed corpora stay outside Git. Record the source, license,
redistribution permission, dimensions, category, mask classification, annotator,
and known ambiguities in the external manifest. The checked-in
`corpus.json` is the schema and hygiene contract for routine CI.

## Synthetic reference fixtures

The deterministic generator creates CC0 RGB/RGBA fixtures with exact masks in
the PNG alpha channel. It does not borrow pixels and uses a fixed seed:

```bash
python3 -m venv /tmp/varve-bgremove-reference-venv
. /tmp/varve-bgremove-reference-venv/bin/activate
python -m pip install -r scripts/bench/bgremove-reference/requirements.txt
python scripts/bench/bgremove-reference/generate_fixtures.py \
  --output-dir /tmp/varve-bgremove-reference/images
python scripts/bench/bgremove-reference/run_reference.py \
  --models-dir /path/to/pinned-onnx-models \
  --images-dir /tmp/varve-bgremove-reference/images \
  --output-dir /tmp/varve-bgremove-reference/reference
```

The reference runner emits masks at source resolution and copies genuine
source alpha channels into `*-ground-truth.png`. Binary fixtures remain
segmentation targets; only alpha-bearing fixtures are marked as alpha targets.
The runner requires the exact pinned ONNX files and records the requested
model, preprocessing mode, and output paths. Missing models or dependencies
are hard errors, so an incomplete run cannot be mistaken for parity evidence.
