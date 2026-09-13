# Photo source, RAW development, HDR, and retouching

Status: current implementation contract (2026-09-13)

This document describes the photographic paths that extend Varve's existing
Photo/Image Tuning, raster tools, document assets, history, renderer, and
export services. It does not define a new workspace, route, document model,
history manager, asset manager, or model manager.

## Stage graph and ownership

The supported path is deliberately a graph rather than a universal filter
sequence:

```text
immutable source bytes
  -> signature/container validation
  -> RAW sensor decode and calibration (or rendered-image decode)
  -> scene/display-linear working raster
  -> existing image tuning and persistent raster retouch
  -> optional bounded HDR alignment/deghost and radiance/fusion merge
  -> explicit tone map and gamut/display transform
  -> disposable SDR preview or range-bearing master export
```

`@varve/engine/raw` owns the bounded classic DNG sensor subset and produces a
`RawMosaic`. `developRaw` owns demosaic, black/white calibration, white
balance, camera-matrix selection, exposure, crop/orientation, and the initial
development recipe. `@varve/engine/hdr` owns the separate radiance and
exposure-fusion kernels, alignment/deghost masks, global tone map, and the
verified OpenEXR subset. `@varve/shared/rangeRaster` owns the processing
contract. `@varve/scene` owns immutable asset provenance and source bindings.
The editor owns contextual controls and calls the same document update and
history services used by the rest of the application.

The legacy `RasterTile` path remains RGBA8. It is still the canonical target
for ordinary raster paint and retouch. A float range raster is not passed
through that path: until a float tile target is introduced and verified,
byte-only retouch reports its SDR boundary rather than claiming to preserve an
HDR master.

## Pixel contract

`RangeRasterContract` records dimensions, float32 sample type, row stride,
RGBA layout, RGB/gray channel semantics, primaries, transfer, bit depth,
alpha mode, reference (`scene-linear`, `display-linear`, or
`display-referred`), relative reference white, and provenance. RGB values may
be negative or above 1.0 in scene-linear processing. Alpha is independently
bounded to [0, 1]. `sanitizeRangeRasterInPlace` handles NaN, infinity, alpha,
and an explicit finite RGB safety bound at an untrusted boundary.

This contract separates:

- precision from gamut, transfer function, and provenance;
- scene-linear values from display-referred appearance;
- a range-bearing master from an SDR rendition;
- the image source from its display canvas.

Canvas2D/WebGPU previews are consumers of a transform, never the authority for
source development, later retouch, HDR merging, or master export. Existing
RGBA8 adjustments either operate on the declared display boundary or remain
outside the range-preserving promise. There is no implicit JPEG/canvas
readback conversion in the master path.

The existing Photo source inspector also decodes the verified OpenEXR subset
back into a range raster. It keeps the EXR as `masterAssetId` and stores a new
SDR rendition when tone-map exposure or display white point changes. This is
the supported SDR-only editing route: the output transform is undoable and
persisted, while the range-bearing asset is not rewritten.

## Genuine RAW subset

The first supported decoder is `varve-dng-bayer-uncompressed/1`. It requires a
classic TIFF/DNG signature and a bounded raw IFD, then reads sensor samples from
the raw strips. It does not read the embedded JPEG/thumbnail as final pixels.
The decoder currently supports:

| Input property | Supported subset | Explicitly rejected or deferred |
| --- | --- | --- |
| Container | Classic TIFF/DNG, little or big endian | Other containers and malformed/truncated structures |
| Sensor layout | 2x2 Bayer CFA or monochrome, one sample per pixel | X-Trans, Foveon, multi-shot and unsupported CFA layouts |
| Storage | Uncompressed, chunky, FillOrder 1, 8/10/12/14/16-bit packed samples | Compressed strips, planar storage, reverse bit order |
| Calibration | ActiveArea, DefaultCrop, black/white levels, AsShotNeutral, ColorMatrix, LinearizationTable | Required DNG delta/opcode processing that this revision cannot execute |
| Development | Bilinear Bayer, explicit WB/profile/exposure/black/white/highlight/shadow, crop/orientation, optional bounded RGB NR/sharpen | Advanced demosaic, DCP/opcode parity, automatic hidden brightness, missing Lensfun profile |

The UI displays the camera/model when present, the sensor dimensions and bit
depth, decoder identity, warnings, and separate sensor/output clipping counts.
White-balance values are called calibrated only when `AsShotNeutral` exists;
otherwise the control is an explicit neutral/custom fallback. When two DNG
ColorMatrix tags are present, the automatic choice compares the recorded
calibration illuminants with the as-shot neutral for the two known common
illuminants (Standard Light A and D65); the user can choose either matrix in
the controls. DNG ColorMatrix is an XYZ-to-camera matrix, so the implementation
inverts it and applies an explicit D50-to-D65 adaptation before the sRGB
working transform. ForwardMatrix, DCP hue/saturation tables, and arbitrary
illuminant interpolation remain unsupported and are reported as such. Sensor
channels are never relabelled as sRGB without a declared profile/fallback.

The browser-safe route is also the current Tauri webview route. A native
LibRaw/RawSpeed adapter and a native Rust `rawler` adapter remain future
providers behind the same interface; neither is a hidden executable or a
requirement for this subset. The comparison is recorded in the dated audit.

## Source recipes and downstream repairs

RAW and bracket sources are immutable embedded assets. Derived developed
rasters, HDR masters, and SDR renditions carry role, source ids, source
revision, decoder id, operation, and recipe metadata. A binding on an image
fill points to the source ids, the current derived asset, and (for HDR)
`masterAssetId`; the EXR master is represented by its own provenance asset and
is not accidentally added as an input source. A standalone supported EXR uses
`hdr-master-import` rather than being mislabeled as camera radiance.

The current retouch policy is baked revision ownership, not automatic pixel
replay. A raster repair sampled from a developed image remains attached to the
document's existing repair layer and source revision. Changing WB, profile,
demosaic, crop, lens correction, or upstream exposure creates/replaces the
derived developed asset but does not silently move or recolor old repair
pixels. The UI labels this condition and asks the user to intentionally reapply
or rebase. A future replayable source-space repair must add stable anchors and
stage dependencies before it can change this policy.

## Retouch boundary

Clone, heal, spot-heal, and patch write through the canonical persistent scene
tile transaction. Sampling is separate from destination ownership: a writable
raster layer is required, source snapshots are frozen per stroke/patch, and
the selected source scope is not allowed to feed the destination back into the
same stroke unintentionally. Spot-heal is a bounded deterministic texture
variance search; it is not described as Poisson or generative reconstruction.
Patch uses a frozen source region and feathered source-over composition.

Source interpolation uses premultiplied RGB/alpha to avoid translucent dark
fringes. Coverage and alpha lock are applied once. Zero strength, cancel, and
no valid source are identity/no-history cases. Image-filled shapes do not
become writable raster layers by implication; the UI reports the target
boundary instead of painting only a visible canvas.

## Brackets and HDR master

The contextual Merge exposure bracket dialog is reachable from Image Tuning.
It reviews selected files, rejects duplicates/mixed RAW/rendered input, checks
dimensions and RAW metadata, lets the user choose a reference and enter
missing positive exposure times, and uses bounded translation alignment. It
warns about missing camera/lens metadata and blocks radiance normalization when
known camera, crop, orientation, focal length, ISO, aperture, CFA, or source
encoding values disagree. Rotation, perspective, rolling shutter, focus
breathing, and parallax are not hidden inside a global stretch.

Radiance reconstruction accepts consistently developed linear frames, excludes
invalid/saturated channel samples, normalizes by explicit exposure time, and
retains float32 scene values before tone mapping. Deghost masks are conservative
reference-relative validity masks; moving-sample counts are shown. Invalid
alignment borders remain invalid coverage, not black radiance.

Rendered inputs take a separate browser-sRGB-to-linear path and are labelled
exposure fusion. Fusion does not use exposure times and is never presented as
calibrated recovered scene radiance. Its deghost preview compares an
exposure-relative local-contrast feature with spatial support; the reported
count is a conservative motion/low-confidence candidate count, not camera
response calibration or proof that a subject moved. Neither a single-image
tone map nor frame interpolation is HDR bracket recovery.

The verified OpenEXR subset is one-part, scanline, uncompressed, full-sample
RGBA or RGB, float16/float32, finite samples, with data/display windows and
Varve metadata for reference, provenance, alpha, primaries, and transfer. The
writer rejects half-float overflow unless the caller explicitly chooses clamp.
Deep, multipart, tiled, compressed, subsampled, and unknown-channel files are
rejected with an actionable error. The SDR PNG is a disposable rendition; the
EXR asset is the range-bearing master. Rendered exposure-fusion EXR output is
display-linear and may remain in [0, 1]; only the radiance path promises
scene-linear extended values when the inputs and exposures are valid.

## Display and output truth

Tone mapping is a stable full-frame global Reinhard transform. It uses an
explicit scene exposure and white-point scale and does not recompute from the
viewport or mutate the master. PQ and HLG are distinct transfer/display
systems; this slice does not encode either or infer absolute nits from scene
values. Gain-map JPEG/HEIF/Ultra HDR output is deferred until a validated
encoder, metadata relationship, and independent decoder are integrated.

The preview probes float16 Canvas2D, wide-gamut/high-dynamic-range media
queries, and WebGPU availability, but reports a candidate/unknown route rather
than claiming physical HDR presentation. The SDR rendition and EXR export do
not depend on the connected monitor. WebKitGTK/Tauri, WebView2, WKWebView, and
ChromeOS require separate runtime/display evidence before a supported display
claim is made.

## Dependency and license boundary

The current implementation adds no RAW decoder dependency and no model
download. OpenEXR-compatible bytes are produced by the small verified subset;
the repository's own license notices still govern Varve code. Any future
bundled dependency must be reviewed separately:

- LibRaw documents LGPL-2.1/CDDL-1.0 alternatives and a native API with
  per-instance/thread and build considerations.
- RawSpeed is LGPL-2.1, CMake/C++ based, supplies raw data rather than a
  complete development look, and its camera data must match its code revision.
- DNGLab's Rawler crate is Rust but explicitly warns that its API is not stable
  and does not follow SemVer.
- Lensfun code/database/application components have different licensing and
  data obligations; a missing profile is not a successful correction.
- ONNX models are not required for RAW, retouch, or HDR. Existing inference
  manifests/providers remain the owner if an optional assisted retouch model is
  later qualified.

See the dated implementation audit for source URLs, access date, issue-based
failure evidence, corpus provenance, and measured results.
