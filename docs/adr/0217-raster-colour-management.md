# ADR-0217: Canonical raster colour encoding and the colour-managed raster architecture

- **Status:** Accepted
- **Date:** 2026-08-09

## Context

Vector colours carry managed-colour semantics (`ManagedColor` with profile ids,
bit depth, fingerprints), but raster assets do not. Import already extracts
ICC profiles and EXIF orientation into `Document.assets[].metadata` +
`Document.iccProfiles` (content-addressed, deduplicated) — yet nothing consumes
that metadata: rendering, effects, export, print, thumbnails and preflight all
assume decoded pixels are sRGB 8-bit. An imported Display P3 photograph is
stored byte-for-byte, then decoded by the browser's default pipeline as sRGB
and exported as an untagged sRGB PNG. Gamut, precision, and provenance are
silently lost at every boundary.

Additional facts from the 2026-08-09 audit:

- Proofing (`applyProofToIr`) transforms only vector colours and skips image
  fills; its converter registry is empty in production.
- PDF/X raster fills render as checkerboard placeholders (no image manifest
  crosses the boundary; `cmyk.rs` hardcodes `None`).
- The TS analytical conversion layer covers sRGB only; the ICC engine lives in
  `varve-colour` (tintbox), reusable independently of print.
- All canvas contexts are created without a `colorSpace` option (sRGB default);
  ImageCache keys carry no colour identity.

## Decision

D1 — **Every raster pixel buffer names its encoding.** A canonical
`RasterColorEncoding` record (model / primaries / transfer / CICP matrix+range
/ bit depth / alpha mode / provenance / diagnostics) lives in `@varve/shared`
so scene, engine, import, editor, compositor and print share one vocabulary.
Provenance is mandatory and distinguishes `embedded-icc` from `named`,
`format-default`, `assumed`, `user-assigned`, and `legacy-assumed-srgb` —
an untagged image is never silently relabelled sRGB as though the file said so.

D2 — **Ingestion records, never converts.** Import writes the encoding block
onto `DocumentAsset.metadata` (schema 2.19, optional field; migration is a
version stamp only, no fabricated encodings for old documents). Assignment and
conversion remain separate operations forever: changing the label without
changing pixels is assignment; changing pixels to preserve appearance is
conversion.

D3 — **Deterministic per-format precedence for conflicting metadata.**
PNG: iCCP > sRGB chunk > cHRM/gAMA > nothing. JPEG: APP2 ICC > EXIF
ColorSpace > nothing. WebP: ICCP > nothing. TIFF: tag 34675 > photometric
interpretation. AVIF: colr ICC > colr nclx CICP. Conflicts are recorded as
diagnostics on the encoding, never averaged.

D4 — **Analytical wide-gamut working spaces in TS.** `@varve/shared` gains
primaries matrices for sRGB / Display P3 / Adobe RGB / ProPhoto / Rec.2020 and
transfer functions (srgb, gamma 2.2, gamma 1.8, ProPhoto, Rec.2020, linear;
PQ/HLG explicitly unsupported) with a single `convertEncodedRgb` pipeline
through XYZ D50. Conversion never clamps: authoritative out-of-gamut values
survive; clipping is a display/output boundary decision.

D5 — **Deterministic ICC matrix/TRC profile authoring.** `@varve/engine`
`rasterColor/profiles.ts` authors standard ICC v4 display profiles from the
same primaries/transfer tables the conversion uses, so exported "Display P3"
output is genuinely P3-encoded pixels plus a self-consistent P3 profile —
never a relabel. PNG embeds via iCCP (existing writer), JPEG via chunked APP2
segments; WebP cannot embed through canvas encoders and the limitation is
disclosed, not silently dropped.

D6 — **Explicit export colour policy.** The settings default colour space
(`srgb | display-p3 | adobe-rgb | pro-photo`) and the per-preset
`raster.colorProfile` now drive a real analytic conversion of the rendered
composite plus ICC embedding where the format supports it. sRGB remains the
byte-identical baseline (no conversion, no tag) unless a wide-gamut choice is
made.

D7 — **Preflight names the assumption.** `runPrintPreflight` reports
IMAGE_PROFILE_MISSING (untagged raster → assumed sRGB), invalid embedded
profiles, and mismatch info when an embedded profile differs from the document
working profile.

D8 — **Provider-based transform boundary (future).** `rasterColor/transform.ts`
defines the `RasterColorTransform` interface (source/target encodings,
format support, tiled + cancellable conversion). The analytic provider is the
always-available baseline; native/WASM ICC providers can slot in behind the
same interface without call-site changes. Alpha is never colour-transformed;
premultiplied sources are un-premultiplied for the colour math and re-
premultiplied after.

## Consequences

- Asset metadata grows by a small optional block; existing documents are
  byte-identical after the 2.19 version stamp.
- The conversion engine is analytic (matrix/TRC), not an ICC transform engine:
  profile-accurate conversion for arbitrary/custom profiles remains a native/
  WASM provider gap, documented in the capability matrix.
- Display still decodes through the browser's default sRGB pipeline; the
  authoritative document pixels remain untouched and display transforms stay
  non-destructive. A Display-P3 canvas surface, monitor ICC access, and
  per-frame worker conversions are future work, not this ADR.
- sRGB workflows are unchanged on every path (identity transforms are no-ops,
  default export policy converts nothing, preflight findings are new warnings
  only).
