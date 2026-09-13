# Varve shader system

**Status:** current implementation and verification boundary
**Updated:** 2026-09-13

This document separates the three things that are often called “shaders” in
creative software:

1. **Engine shaders** are the WGSL programs and Canvas2D/native equivalents
   that move pixels, render primitives, composite surfaces, and process masks.
2. **Creative shader effects** are ordinary editable Varve effects such as
   Bloom, RGB Split, CRT, VHS, Light Shafts, Lens Flare, Light Leak, Caustics,
   and Palette Snap. They are selected and edited through the existing effect
   workflows; a user does not need to write code.
3. **Shader infrastructure** owns contracts, packing, compilation, resource
   lifetime, cache invalidation, diagnostics, fallback, and tests.

Arbitrary shader authoring is not part of the built-in effect contract. It is a
separate, deferred product decision that would need a constrained language
subset, resource budgets, versioning, and a last-known-good recovery path.

## Production paths

The canonical document path remains the existing scene and filter pipeline:

```text
Effect controls → persisted Adjustment → FilterIR → renderer/export boundary
                                          ├─ interactive Canvas2D/software reference
                                          ├─ native compute where the desktop capability says usable
                                          └─ optional WebGPU effect provider for an async consumer
```

The WebGPU primitive compositor is not an implicit filter compositor. It must
not render an effect-bearing object as an unfiltered GPU primitive. The
interactive replay therefore remains the authoritative synchronous path until
an entire effect scope can be dispatched asynchronously without changing
ordering, masks, opacity, or history behavior.

The optional browser compute path is implemented by
`packages/compositor/src/webgpu/effects/runner.ts` and exposed as the
`gpuEffectProvider`. Consumers must pass it into the existing
`buildEffectChain`/`dispatchLiveEffect` contract. The provider is never assumed
to exist merely because the browser exposes a `navigator.gpu` property. The
runner declines software adapters under its normal policy, while the dedicated
agreement harness may explicitly allow one for shader execution tests.

## Canonical effect contract

The persisted artistic meaning is the `Adjustment`/`FilterIR` value. GPU
handles, bind groups, compiled modules, pooled textures, mapped buffers, and
temporary object URLs are runtime state and must not be serialized.

Each built-in effect has:

- a stable `kind` and, where a correction changes pixels, an explicit
  `algorithmVersion` in its document data;
- validated defaults and bounded parameters in the existing effect registry;
- a declared input/output surface, quality tier, coordinate-space behavior,
  color/alpha convention, and export policy;
- deterministic seed/time values when it is procedural or animated;
- a CPU/software implementation that remains the fallback and reference;
- a provider failure boundary that reports the reason instead of silently
  exporting the original unshaded pixels.

The current WebGPU live-effect runner uses these interface rules:

| Resource | Contract |
| --- | --- |
| Working pixels | straight RGBA8 at the existing sRGB effect boundary |
| Float parameters | one 128-element f32 storage buffer, zero-padded per pass |
| Exact integers | one 16-element u32 storage buffer for seeds/hash inputs; f32 copies remain readable for diagnostics |
| Palette | 128 RGB triplets in a read-only storage buffer |
| Pass target | `rgba8unorm` storage texture, separate from sampled inputs |
| Coordinates | pixel centers are `(gid.xy + 0.5) / surfaceSize`; producer dimensions travel with every sampled input |
| Readback | `copyTextureToBuffer` uses a 256-byte row stride and explicitly unpacks padding |
| Upload | `queue.writeTexture` uses the tight source row stride; it is not confused with copy readback alignment |

The runner rejects malformed dimensions, over-sized parameter arrays, forward
references, duplicate texture inputs, same-pass read/write aliases, and
dispatches over the device workgroup limit before submitting work. Multi-pass
effects identify their actual producer dimensions; a consumer may not silently
reinterpret a lower-resolution producer using its own size.

### Color Halftone compatibility boundary

The corrected Color Halftone document semantics are algorithm version 2 and
remain on the verified CPU/reference path. The standalone WebGPU helper accepts
an explicit `algorithmVersion: 1` request for its legacy screening contract;
other versions fall back to CPU with a diagnostic. This is intentional: the
backend must not silently change screen polarity, phase, cell geometry, or
colour-separation behavior while a matching v2 kernel is being validated.

## Color, alpha, and compositing boundary

The existing effect documentation defines the current boundary as sRGB-encoded,
straight RGBA at filter inputs and outputs. Individual kernels may use
premultiplied values internally where displacement or blur requires it, but
must return to the contract before compositing. Masks and displacement data are
not color textures and must not receive color conversion as a side effect.

The current WebGPU effect textures are `rgba8unorm`. This is a bounded SDR
path, not an HDR or wide-gamut promise. Repeated passes can quantize values;
effects that need a higher-precision working surface require a separate
capability and export contract rather than an unannounced format switch.

The CPU path remains the semantic reference only after its own alpha and blend
behavior is verified. A GPU result is not accepted just because a command
buffer submitted successfully: shader diagnostics, validation scopes, output
dimensions, alpha, edge behavior, and image statistics are checked together.

## Compilation, cache, and device recovery

Compilation is separated from pipeline validation and runtime submission:

- `GPUShaderModule.getCompilationInfo()` is inspected for error messages and
  source locations;
- pipeline creation runs inside a paired validation error scope;
- labeled resources make browser diagnostics attributable to an effect/pass;
- module and pipeline keys include effect ID, shader source identity, entry
  point, sampled-input count, sampler, output format, and device generation;
- replacing a kernel under an existing ID invalidates its dependent modules and
  pipelines;
- concurrent calls to one runner are serialized because parameter buffers,
  readback buffers, and pooled textures are shared;
- queued source bytes are copied before waiting, so a caller may reuse its
  preview buffer without changing a pending export;
- device loss drops all child resources and generation state. Late work from an
  obsolete generation is rejected. A failed optional GPU job falls back to the
  CPU provider and must not destroy a shared capability device owned by another
  feature.

Texture pooling is LRU-bounded by a 64 MiB retained-texture budget. Textures
needed by the active pass plan are pinned until that plan finishes, so eviction
cannot turn a valid multi-pass dependency into a blank surface.

## What is verified

| Area | Evidence | Status |
| --- | --- | --- |
| RGBA8 copy alignment | unit coverage for 48, 64, and 65 pixel rows plus padded-row unpacking | implemented and verified |
| Pass planning | unit coverage for producer dimensions, forward references, and aliases | implemented and verified |
| Parameter integrity | u32 transport for procedural seeds and packing bounds | implemented; browser execution is covered by the GPU harness |
| WGSL source drift | nine TypeScript kernels compared with generated naga mirrors | implemented and verified |
| Shared-runner overlap | harness supports concurrent effect requests against one runner | implemented; browser execution requires the GPU E2E lane |
| Device/cache cleanup | generation guards, loss invalidation, bounded pool, and focused source tests | implemented; hardware loss injection remains runtime-specific |
| Interactive document semantics | existing Canvas2D replay remains authoritative | verified by the existing effect workflow; GPU is not silently substituted |
| Arbitrary user shader source | no built-in execution surface | deliberately deferred |

The dedicated browser tests distinguish API availability, adapter selection,
and actual compute/readback. A CPU fallback or a successful JavaScript helper
call is not counted as GPU verification.

## Research and failure-mode decisions

Research was intentionally bounded to the rules that affect this runner and to
failure modes reported by users of established creative tools.

| Question | Source/version/access date | Finding | Decision and trade-off | Verification |
| --- | --- | --- | --- | --- |
| Which storage access modes and host layouts are valid? | [WGSL specification](https://www.w3.org/TR/WGSL/), Candidate Recommendation Draft, accessed 2026-09-13 | Read-only storage is valid; host-shareable offsets, strides, and binding sizes still have to match. | Use read-only layouts for immutable parameter/palette data and a separate u32 buffer; retain executable packing tests. | WGSL drift + browser compilation diagnostics |
| Which row alignment applies to readback? | [`copyTextureToBuffer()`](https://developer.mozilla.org/en-US/docs/Web/API/GPUCommandEncoder/copyTextureToBuffer), MDN current, accessed 2026-09-13 | Texture-to-buffer rows need a 256-byte `bytesPerRow` and enough padded buffer capacity. | Pad only copies and unpack rows; do not pad `writeTexture` by cargo-cult. | 48×32, 64×32, and 65×3 layout tests; GPU E2E |
| How should uploads differ? | [`writeTexture()`](https://developer.mozilla.org/en-US/docs/Web/API/GPUQueue/writeTexture), MDN current, accessed 2026-09-13 | Upload layout is described separately from copy layout. | Keep tight upload rows and a padded readback path. | Host packing tests + browser diagnostics |
| What does a failed submission mean? | [WebGPU error model](https://gpuweb.github.io/gpuweb/explainer/#errors), current explainer, accessed 2026-09-13 | Validation errors are asynchronous; invalid calls can produce no useful work unless errors are observed. | Pair error scopes and compilation diagnostics; no “silent no-op” workarounds. | Pipeline/error-path tests and harness |
| How should compilation be surfaced? | [`GPUShaderModule.getCompilationInfo()`](https://developer.mozilla.org/en-US/docs/Web/API/GPUShaderModule/getCompilationInfo), MDN current, accessed 2026-09-13 | Diagnostics include severity and source locations. | Preserve locations in surfaced errors and keep the last valid effect outside draft compilation. | Formatting unit test |
| What happens after loss? | [`GPUDevice.lost`](https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/lost), MDN current, accessed 2026-09-13 | Child resources are unusable and must be recreated. | Invalidate by device identity/generation; do not destroy a shared device from one effect’s catch block. | Loss callback tests; real loss remains hardware-dependent |
| Which industry complaints are realistically avoidable? | Adobe Community reports on [RGB-to-CMYK artifacts](https://community.adobe.com/bug-reports-711/p-photoshop-27-8-later-rendering-artifacts-exposed-previews-and-color-banding-1629988), [GPU neural-filter crashes](https://community.adobe.com/questions-712/critical-failure-gpu-crash-error-with-neural-filters-on-new-hardware-rtx-5060-1183729), and [canvas flicker](https://community.adobe.com/bug-reports-711/p-photoshop-27-10-ui-canvas-and-screen-flickering-1639703), accessed 2026-09-13 | Users lose trust when GPU acceleration causes corruption, flicker, freezes, or forces a whole-app GPU switch-off. | Keep acceleration per operation, retain CPU fallback, disclose backend state, and keep the document editable. | Backend diagnostics, CPU path, and production visual/export checks |

These reports are user complaints, not algorithmic authorities. They informed
recovery and disclosure policy, not a claim that Varve reproduces another
product’s implementation.

## Product guidance

Built-in shader effects belong in the normal effect/fill/adjustment UI with
meaningful controls for scale, angle, origin, colors, intensity, seed, and
quality. Presets store artistic parameters and algorithm versions, not GPU
objects. A static cached preview is never described as an editable CPU
equivalent.

On systems without a usable WebGPU/native compute device, Varve continues with
the tested software path. It does not download a shader, require cloud
compilation, disable browser security, or silently remove an effect from an
export. SVG/PDF retain unaffected vector/text content and rasterize only the
smallest dependency region when the format cannot express the effect.
