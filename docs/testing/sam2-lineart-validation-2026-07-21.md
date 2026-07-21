# SAM2 and line-art pipeline validation — 2026-07-21

Real end-to-end validation against the actual downloaded ONNX weights
(`vietanhdev/segment-anything-2-onnx-models`, `rocca/informative-drawings-
line-art-onnx`), not mocked tensors. Unit tests
(`packages/engine/src/inference/models/sam2.test.ts`, `lineArt.test.ts`)
verify the pre/post-processing math in isolation; this session additionally
ran the real models to prove that math is correct, using both synthetic
ground-truth fixtures and real photos. Scripts: `scripts/validate-pipelines/`.

## Method

1. Downloaded the actual encoder/decoder/line-art `.onnx` files.
2. Inspected the real graphs directly with the `onnx` Python package
   (opset, input/output names, shapes) rather than trusting documentation
   or the model card.
3. Ran real inference (`onnxruntime`) with the exact preprocessing and
   prompt-encoding logic mirrored from the TypeScript implementation.
4. Validated against (a) synthetic images with known ground truth, so
   quality can be measured numerically, and (b) real, licensed photos, so
   texture/lighting/clutter that synthetic shapes don't have gets exercised.

## Bugs found and fixed

### 1. SAM2 prompt coordinates ignored the letterbox transform (severe)

The image preprocessing scales a source image to fit the fixed 1024×1024
encoder input while preserving aspect ratio, then pads (centers) it —
standard "letterbox" resize. Prompt encoding, however, mapped normalized
0-1 coordinates straight to 1024-space (`x_norm * 1024`), with no
knowledge of that same transform. For any non-square image — the large
majority of real photos — this silently misplaces the prompt.

Measured on a synthetic 1920×1080 image with a known-position subject:

| | mask-vs-ground-truth IoU | model-reported confidence |
|---|---|---|
| Before fix (naive mapping) | 0.002 | 0.98 |
| After fix (letterbox-aware mapping) | 0.97 | 0.99 |

The "before" row is the dangerous case: the model was *confident* in a
mask that covered essentially the wrong region of the image — a silent
wrong-answer failure, not a crash or visible error.

**Fix**: the worker now exposes the letterbox transform it computed for
the encoder's image (`WorkerInferResult.outputs.letterbox`);
`useSam2Segmentation.ts` caches it alongside the embeddings and passes it
to the decoder call; `encodeSam2Prompts()` accepts it and maps
coordinates correctly (`offsetX + x_norm * (1024 - 2*offsetX)`, and
symmetric for y). Square images (offset 0,0) are unaffected — this is
why unit tests alone didn't catch it; the existing tests happened not to
exercise non-square geometry.

### 2. Line-art letterbox padding stretched into the output (moderate)

Same underlying cause: `decodeLineArtOutput` resized the model's full
padded 256×256 output straight back to the original aspect ratio, so the
white letterbox bars got stretched into the image and shifted real
content.

Measured on a synthetic 1920×1080 image with a horizontal edge at a known
row:

| | position error |
|---|---|
| Before fix (no crop) | 49px (4.5% of height) |
| After fix (crop before resize) | 18px (1.7% of height) |

**Fix**: `decodeLineArtOutput` now accepts the same `letterbox` transform
and crops out the padded region before the final resize.

### 3. Wrong output tensor key — would have crashed on first real use (critical, but shallow)

`LensBlurSection.tsx` (depth) and `LineArtSection.tsx` (line art) both
read `result.outputs.data` / `result.outputs.dims` directly. The worker
always keys each output by its *real* ONNX tensor name — verified by
inspecting the graphs directly:

- depth-anything-v2-small's output is named `predicted_depth`, not `data`.
- the line-art model's output is named `output`, not `data`.

Both would have been `undefined` on first real invocation. Fixed to read
`result.outputs.predicted_depth` / `result.outputs.output` respectively.
This one wasn't found by inference correctness testing — it was found by
tracing the actual field names in the real ONNX graphs, which is exactly
what unit tests with hand-built mock objects can't catch (a mock object
will happily have whatever field name the test author assumed).

## Real-photo spot checks

Not part of the automated regression gate (no ground truth for an
arbitrary photo), but run manually this session for qualitative
confirmation on genuinely complex, real images rather than only clean
synthetic shapes:

- **SAM2**: a real 3872×2592 outdoor photo (black dog on a concrete slab,
  cluttered background — people, a van, trees, construction debris). A
  single point prompt on the dog's body produced a mask that precisely
  followed the dog's silhouette (legs, torso, ears) at 8.5% image
  coverage, cleanly excluding the background clutter.
- **Line art**: the same dog photo produced a correctly-proportioned
  pencil-sketch rendering with edges in the right places (verified
  visually — the dog, tree, and background structures all line up with
  the source photo). A second real image — an 1887 public-domain
  engraving that's already line-art style — was run through the same
  model as a sanity check that it doesn't destroy already-linear input;
  it didn't.
- Source images: `Dog_Portrait_1.jpg` (Wikimedia Commons, CC BY-SA 4.0)
  and `Dog_and_Kitten.jpg` (Wikimedia Commons, public domain, pre-1931).
  Neither is committed to this repository — see
  `docs/testing/real-image-validation-corpus.md` for the project's
  fixture policy.

## What's still not verified

Mask *quality* against Meta's own reference SAM2 implementation (running
the identical prompt through the original PyTorch model and diffing) —
this environment has no GPU/PyTorch runtime to produce that reference.
The graph contract (shapes, tensor names, required inputs) is verified
directly against the real ONNX files; the geometric correctness (does a
click land in the right place, does an edge land in the right place) is
verified against known-position synthetic ground truth; the qualitative
behavior on messy real photos was visually reviewed. Numeric agreement
with the original PyTorch reference implementation is the one rung of the
brief's "compare against a trusted reference pipeline" ladder that
wasn't reachable here.
