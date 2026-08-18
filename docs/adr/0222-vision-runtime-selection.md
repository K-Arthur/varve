# ADR-0222: Capability-driven visual-awareness runtime boundary

- **Status:** Accepted boundary; runtime selection pending benchmark evidence
- Date: 2026-08-13
- Owners: Varve editor, engine, native inference

## Context

Varve needs face, hand, pose, object, and segmentation capabilities for design
workflows. A crop operation should ask for face bounds, not load a holistic
model or expose a MediaPipe structure to the editor. The repository already
has ONNX Runtime browser/native paths, model manifests, checksum verification,
worker cancellation, and non-destructive masks/crops.

## Decision

Introduce a model-independent capability boundary in
`packages/engine/src/vision/`. The service owns request routing, coalescing,
source-revision caching, priority scheduling, cancellation, and resident-memory
admission. Backends advertise the capabilities they can produce and return
canonical result types. The editor consumes those types and existing scene
contracts only.

The first runtime to benchmark is the existing ONNX Runtime estate because it
has the smallest integration and deployment delta. This is not a claim that
ONNX wins every task. A MediaPipe, LiteRT, or Candle backend may be added only
behind the same contract after output parity, performance, licensing, and
privacy evidence is recorded.

## Alternatives considered

### MediaPipe Tasks

Pros: task-specific APIs, face/hand/pose/object/segmentation coverage, web and
native ecosystem. Cons: task bundles bring task-specific preprocessing and
postprocessing; model terms need separate verification; the current MediaPipe
privacy notice states that Tasks sends performance and utilization metrics to
Google. That conflicts with Varve's local-first privacy contract unless the
behavior can be disabled or isolated and consent is handled explicitly.

### Direct TFLite/LiteRT

Pros: possible smaller runtime and direct task models. Cons: a `.task` artifact
can contain metadata and graph orchestration, so reproducing a task by calling
one tensor graph is unsafe without parity fixtures. It would also add a native
runtime surface before the existing ONNX path is measured.

### Candle plus safetensors

Pros: Rust-native deployment and potentially small binaries for architectures
with a faithful Candle implementation. Cons: safetensors only stores weights;
architecture, preprocessing, postprocessing, and model parity would all be
owned by Varve. No current face/hand/pose model has passed that gate here.

### A holistic model by default

Rejected. Holistic inference is an optimization for a request that genuinely
needs face, hand, and pose together. It is the wrong default for static
face-aware crop, which needs only `FACE_BOUNDS`.

## Consequences

Positive:

- Design features remain independent of model names and runtimes.
- Unrelated models do not load for ordinary image placement.
- Results can be cached by source content and reused across node transforms.
- Saved documents remain renderable without an installed model.
- Runtime experiments can be performed behind one contract.

Costs:

- Each task adapter needs output validation and parity fixtures.
- Model provenance and licensing must be recorded per artifact.
- The current native model crates remain a compatibility boundary until a
  second task-specific native family justifies a bounded extraction.

## Release gates

No user-facing face/hand/pose marketing is enabled until the chosen backend
has: pinned artifacts and licenses, integrity verification, CPU fallback,
stale-result/cancellation tests, quality corpus results, cold/warm performance
measurements, WebKitGTK status, and privacy/network verification.
