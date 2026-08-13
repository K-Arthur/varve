# ADR-0220: Object Selection runtime boundary

Status: Accepted for the current implementation; runtime replacement remains
subject to the parity and benchmark gates below.

## Context

Varve needs interactive point/box image segmentation without coupling the
editor to a model or inference runtime. The existing repository already has a
worker-backed ONNX path, checksum-verified model manifests, lazy model loading,
provider fallback, and a split SAM2 encoder/decoder implementation.

The alternative considered is Candle with safetensors weights and a native
Rust implementation. Safetensors is a storage format, not an inference
runtime; choosing it would also require validating the complete Hiera
architecture, prompt encoding, mask decoding, and platform accelerators.

## Decision

Define Object Selection against the model-independent
`SegmentationBackend` contract in `@varve/engine`. Keep the current split ONNX
worker adapter behind that boundary while the runtime benchmark is completed.
The encoder runs once per source image and the prompt decoder reuses its
embedding through a bounded two-entry/512 MiB LRU.

The editor owns prompts, transient candidates, cancellation, and document
commit semantics. The backend owns tensors, model sessions, preprocessing, and
execution providers.

## Why this is reversible

The contract exposes capabilities rather than SAM-specific types:
point/box/mask prompts, candidate masks, embedding preparation, and lifecycle.
A Candle backend, a future official ONNX export, or another provider can be
conformance-tested without changing the editor interaction model.

## Rejected shortcuts

- **Direct SAM/ONNX imports in the editor:** rejected because it makes future
  backends and browser/native parity expensive and encourages tensor details in
  UI code.
- **Candle because it is Rust:** rejected without parity, latency, memory, and
  accelerator evidence.
- **Serializing embeddings in documents:** rejected because embeddings are
  large, model-version-specific, and not required to render a committed mask.
- **Calling an arbitrary automatic mask “Select Subject”:** rejected because
  promptable segmentation does not provide semantic subject understanding.

## Required runtime gate before replacement

The benchmark must use the same fixtures, source coordinates, model variant,
and prompts for every backend. Report cold load, image encoding p50/p95,
subsequent prompt p50/p95, peak RAM/VRAM, provider, binary/model size, and
mask IoU/boundary deltas against the official predictor. A replacement is not
accepted if it regresses mask quality or makes the lower-resource CPU path
unusable.
