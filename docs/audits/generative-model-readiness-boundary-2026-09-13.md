# Generative model readiness boundary — 2026-09-13

## Decision

The native diffusion model may be installed and exercised for diagnostics, but
it must not become a prompt-capable product provider after passing only the
small masked compatibility probe. The current photographic qualification
evidence rejects the available SD 1.5 candidates, so the release certificate
allowlist is intentionally empty and the prompt-conditioned modes remain
unavailable.

This keeps visual validation authoritative: a helper that starts, decodes a
PNG, changes the requested mask, or produces a red-looking pixel is not enough
to establish that Fill, Replace, or Expand follows a prompt on real images.

## Implementation boundary

`apps/desktop/src-tauri/src/lib.rs` records the result of the bounded probe as
`preflight_qualified`. Readiness additionally requires all of the following:

- the metadata schema, model hash, model profile, helper runtime, backend,
  platform, and architecture match the current desktop runtime;
- the device memory preflight succeeds; and
- the exact model checksum appears in
  `GENERATIVE_MODEL_QUALITY_CERTIFIED_CHECKSUMS`, after the reviewed
  photographic corpus and platform gates pass.

The last condition is compiled into the application. A local metadata file or
the compatibility probe cannot promote an unreviewed artifact. When the
compatibility probe passes but the certificate is absent, model status reports
that prompt-conditioned generation remains unavailable and does not return an
opaque generation handle.

## Evidence basis

- [`generative-editing-runtime-qualification-2026-09-12.md`](./generative-editing-runtime-qualification-2026-09-12.md)
  records the failed SD 1.5 Q4/F16 real-photograph runs and their retained
  full-frame, difference-map, and 100% boundary evidence.
- [`generative-inpainting-model-comparison-2026-09-13.md`](./generative-inpainting-model-comparison-2026-09-13.md)
  records the independent runtime and precision comparisons.
- [`generative-editing-model-landscape-2026-09-12.md`](./generative-editing-model-landscape-2026-09-12.md)
  records alternative model families, low-memory strategies, and the reasons
  they remain candidates rather than product claims.

The promptless PatchMatch/LaMa Fill, Remove, and reconstruction-based Expand
paths are separate capabilities and are not promoted by this certificate.
They continue to require their own real-photo visual and persistence evidence.
