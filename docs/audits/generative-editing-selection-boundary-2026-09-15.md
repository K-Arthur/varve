# Generative editing selection-boundary audit

Status: implemented and unit-verified, 2026-09-15.

## Finding

An inference provider cannot correct a selection that refers to the wrong
source pixels. The editor therefore has to validate the selection before it
allocates a model buffer or starts a generation job. The previous boundary
checked mask length and offset types, but a partially out-of-frame mask could
still be clipped while extracting context. That made the provider operate on
a different region from the one shown in the review surface.

## Current contract

- Object Selection uses the canonical world-to-source image mapper, validates
  include/exclude points and box geometry, rejects unsupported disconnected
  regions, and requires review of the exact visible candidate before it can be
  applied or imported into Generative Edit.
- Imported pixel, layer-mask, background-removal, alpha, and brush sources are
  converted into one editable source-image-pixel mask. The dialog shows its
  coverage, bounds, component count, edge contact, and warnings before
  generation.
- The engine now validates the complete mask frame before context extraction:
  dimensions and typed-array length must agree, offsets must be integral and
  non-negative, and the complete mask rectangle must lie within the source
  image. Invalid frames fail with an actionable `invalid-mask` error instead
  of being clipped or guessed.
- Candidate review identity includes a synchronous fingerprint of the complete
  source-resolution candidate mask, in addition to source, placement, model,
  candidate-set, and candidate-index identities. A changed candidate raster
  therefore loses review even when its surrounding session metadata is stale.
- Automatic foreground proposals use the same fail-closed boundary: their
  review token includes the exact analysis mask and optional soft alpha as well
  as source, placement, provider, dimensions, and candidate index. Mutating a
  foreground proposal after the overlay was reviewed clears approval before
  either selection or raster-mask commit.
- Provider masks remain separate from the user mask and final composite mask.
  The composite starts from an exact source clone, so pixels outside effective
  coverage cannot be changed by provider output.

## Evidence

The deterministic lane covers valid bounded frames, partial and fully
out-of-frame rejection, mismatched buffers, empty masks, and the generation
API's fail-closed behavior:

```text
TMPDIR=/home/kevina/varve-selection-validation-bXqjQq pnpm exec vitest run \
  packages/engine/src/contentAwareFill/contentAwareFill.test.ts \
  packages/engine/src/contentAwareFill/quickCleanup.test.ts \
  packages/engine/src/generativeEdit/generativeEdit.test.ts \
  --reporter=verbose
```

Result: 3 files passed, 54 tests passed.

Real-photo Object Selection evidence remains separate from these deterministic
checks. The reviewed SAM2 portrait and still-life lanes assert source
dimensions, target-region coverage, distractor exclusion, and persisted mask
geometry; they are required for semantic accuracy and are not replaced by the
unit tests above.

## Remaining qualification boundary

Geometry validation proves that the requested pixels are the pixels sent to a
provider. It does not prove that a model understood an arbitrary semantic
request. Prompt-conditioned Replace and Expand therefore remain unavailable
until a local model/runtime passes the real-photo semantic qualification gate.
