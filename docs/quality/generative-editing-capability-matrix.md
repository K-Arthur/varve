# Generative editing capability matrix

This is the qualification ledger for the local-first generative editing
workflow. “Implemented” means that the code path exists. “Automatically
verified” means a repeatable repository check passed. “Visually reviewed” is
reserved for an inspected output from the production provider; interface
screenshots and mocks do not qualify.

Last updated: 2026-09-09.

## Provider and platform status

| Capability | Browser | Desktop Linux CPU | Desktop Vulkan/Metal | Qualification evidence |
|---|---|---|---|---|
| Fill without a prompt | Implemented; automatically verified with deterministic tests | Implemented through the shared pipeline | Not separately qualified | `packages/engine/src/generativeEdit/generativeEdit.test.ts`, `tests/e2e/caf/caf.spec.ts` |
| Remove without a prompt | Implemented; automatically verified with deterministic tests | Implemented through the shared pipeline | Not separately qualified | `packages/engine/src/generativeEdit/generativeEdit.test.ts`, `tests/e2e/caf/caf.spec.ts` |
| Prompt-conditioned Fill | Unavailable by design; no remote fallback | Implemented behind the native model gate; real-photo qualification pending | Not verified | Native helper path; no release claim until the model lane passes |
| Prompt-conditioned Replace | Unavailable by design | Implemented behind the native model gate; real-photo qualification pending | Not verified | Native helper path; no release claim until the model lane passes |
| Prompt-conditioned Expand | Unavailable by design | Implemented behind the native model gate; real-photo qualification pending | Not verified | `packages/editor/src/components/ContentAwareFill/expandCanvas.test.ts`; native model lane pending |
| Mask editing and refinement | Implemented; automatically verified | Shared implementation | Shared implementation | `packages/editor/src/components/ContentAwareFill/maskOperations.test.ts` |
| In-place acceptance and Restore Original | Implemented; automatically verified | Shared implementation | Shared implementation | `packages/editor/src/imageOperations.test.ts` and scene persistence tests |
| Save/reopen, clipboard, package export | Implemented paths | Implemented paths | Shared implementation | Document codec, closure, and clipboard tests; generative package evidence pending |

## Pinned desktop model profile

The explicit download profile is Stable Diffusion 1.5 Inpainting Q4_0 from
the `gpustack/stable-diffusion-v1-5-inpainting-GGUF` repository. The artifact is
pinned to the `21491e4` repository revision, is 1,747,219,584 bytes, and has
SHA-256:

```text
d157ce24483f0c999062da140eacebe8f3ed015e652723e31f6d39119b800c16
```

The model card identifies the artifact as CreativeML OpenRAIL-M and warns that
the GGUF is experimental for a patched runtime. Varve therefore performs a
masked production-helper qualification after installation; a matching file
hash alone does not make the provider ready. See the [model card](https://huggingface.co/gpustack/stable-diffusion-v1-5-inpainting-GGUF)
and [stable-diffusion.cpp runtime](https://github.com/leejet/stable-diffusion.cpp).

The pinned Rust binding is `diffusion-rs = 0.1.20`. The helper is supervised in
a separate process, and the webview receives only an opaque qualified handle.
Weights are not stored in the repository or in portable documents.

## Evidence state

- The repository currently contains three attributed photographic fixtures:
  [fixture provenance](../../tests/e2e/fixtures/PROVENANCE.md). They are
  suitable for interface and deterministic image-path checks, not the planned
  24-photo/32-task release corpus.
- The downloaded Q4_0 artifact was verified against the pinned hash in a
  temporary test location. A real masked CPU inference run completed and was
  visually inspected; this proves one genuine result and is retained under
  `tests/e2e/fixtures/generative-evidence/`. The full task corpus is not yet
  run, so the prompt modes remain gated for release claims.
- Vulkan on Linux/Windows, Metal on macOS, constrained 4-GB behaviour, cold and
  warm timings, cancellation latency, and package-level reopening evidence
  remain outstanding.

This ledger deliberately records gaps rather than converting an enabled
control or a passing mock into a capability claim.
