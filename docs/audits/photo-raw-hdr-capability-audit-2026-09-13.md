# Photo, RAW, HDR, and retouch capability audit

Date: 2026-09-13
Branch: `master`
Status: implementation evidence record; update after each release fixture

## Scope and baseline

The baseline inspection followed the production path from source/import to
renderer, history, save/reopen, and export. Existing worktree changes from
other owners were preserved. Relevant baseline findings were:

| Finding | Evidence | Root cause | Resolution/status |
| --- | --- | --- | --- |
| Spot Heal and Patch were canvas mutations | `packages/engine/src/retouch.ts` callers used `getImageData`/`putImageData` | Visible canvas was treated as the artwork instead of a persistent target | Routed through scene tile transactions; verified by focused tests and browser pointer E2E |
| Retouch storage was byte-clamped | `packages/scene/src/retouchRaster.ts` stores `Uint8ClampedArray` tiles | No range-bearing target contract | Kept SDR boundary explicit; float master is separate and is not silently sent through byte tiles |
| RAW was absent from generic import | `packages/import/src/image.ts` normalized raster formats; no sensor decoder | Extension/thumbnail support could be mistaken for RAW development | Added honest DNG import capability label and a separate Photo/Image Tuning decoder route |
| No bracket radiance path existed | No radiance merge, exposure validation, alignment/deghost, or float export owner was wired | Existing frame interpolation/ordinary compositing are different problems | Added separate `@varve/engine/hdr` radiance/fusion path and contextual dialog |
| HDR display status could be overclaimed | Canvas/WebGPU APIs expose formats without proving OS/display presentation | Capability layers were conflated | Added explicit probe statuses and kept physical presentation unverified |

## Complaint-derived repairs

Public issue/forum reports are qualitative signals, not prevalence claims. The
following failure modes are realistic to address in Varve's architecture:

- darktable reports of projected source anchors, no visible retouch result,
  and resolution-dependent retouch motivated stable source snapshots,
  authoritative redraw, and explicit target resolution;
- Lightroom discussions about switching/committing healing tools motivated
  coherent transactions, cancel behavior, and no preview history pollution;
- Lightroom HDR/gain-map discussions motivated separate master/SDR status,
  independent export inspection, and no unsupported gain-map claim;
- RawTherapee stale-preview and crop/transform reports motivated recipe
  revision identity, source bytes as authority, and explicit crop/orientation
  metadata instead of trusting a thumbnail.

References: [darktable #4388](https://github.com/darktable-org/darktable/issues/4388),
[darktable #4655](https://github.com/darktable-org/darktable/issues/4655),
[darktable #11325](https://github.com/darktable-org/darktable/issues/11325),
[Lightroom healing discussion](https://community.adobe.com/questions-675/problem-when-switching-between-healing-tools-in-lrc-971633),
[Lightroom HDR display/export discussion](https://community.adobe.com/questions-675/hdr-images-not-displaying-correctly-when-exported-978766),
[Lightroom gain-map discussion](https://community.adobe.com/questions-675/do-the-hdr-exports-contain-gain-maps-972254),
[RawTherapee stale thumbnail #7628](https://github.com/RawTherapee/RawTherapee/issues/7628),
and [darktable crop/transform #17101](https://github.com/darktable-org/darktable/issues/17101).

## Current capability matrix

| Capability | Evidence owner | Current status | Honest claim |
| --- | --- | --- | --- |
| Clone/heal/spot/patch persistence | scene transaction tests + retouch E2E | Implemented-and-verified | Persistent raster-layer repairs; not an HDR float target |
| Range-bearing working raster | `packages/shared/src/rangeRaster.ts` tests | Implemented and numerically verified | Float32 contract with finite/alpha policy |
| OpenEXR master subset | `packages/engine/src/hdr/openExr.ts` tests | Implemented and numerically verified | Single-part uncompressed scanline RGB(A), float16/32 |
| OpenEXR master reopen/edit | `HdrSourceSection` + `decodeOpenExr` + persisted `masterAssetId` | Implemented-and-verified for Varve's OpenEXR subset | Tone-map/output changes create a new SDR rendition without rewriting the master |
| Genuine RAW decoding | `packages/engine/src/raw` tests + Leica M8 DNG fixture | Implemented and numerically verified for fixture | Classic uncompressed Bayer/mono DNG subset only |
| RAW recipe controls/persistence | Photo/Image Tuning + scene asset tests + RAW E2E | Implemented-and-verified for Leica M8 fixture | Versioned recipe and immutable source asset |
| Radiance bracket merge | HDR unit tests + dialog path | Implemented and numerically verified on synthetic bracket; real camera bracket is blocked by the current decoder subset | Explicit linear inputs/exposure values, bounded translation/deghost |
| Rendered exposure fusion | HDR unit tests + real OpenCV bracket E2E | Implemented-and-verified | Display-referred alternative, not radiance recovery |
| SDR rendition | tone-map/export path | Implemented and numerically verified | Disposable full-frame SDR output |
| HDR display | `hdrDisplay.ts` runtime probe | Implemented probe; physical display unverified | Candidate/unknown only until runtime and monitor evidence exists |
| PQ/HLG/gain-map export | no encoder/decoder integration | Unsupported/deferred | No display-HDR or Ultra HDR export claim |
| Model-assisted retouch | existing inference owner | Not required and not changed | Manual repairs remain usable without downloads/cloud |

## Supported matrix

| Surface | Verified support |
| --- | --- |
| RAW container | Classic TIFF/DNG signature; `varve-dng-bayer-uncompressed/1` |
| RAW data | Uncompressed chunky 8/10/12/14/16-bit MSB-packed, 2x2 Bayer or monochrome |
| RAW calibration | Black/white, active/default crop, orientation, AsShotNeutral, ColorMatrix, LinearizationTable |
| RAW fixture | `RAW_LEICA_M8.DNG`, DNG 1.0.0.0, Leica M8, 3920x2638 raw IFD, source hash recorded in corpus manifest |
| HDR master | Varve single-part uncompressed scanline OpenEXR, float16/float32 RGB(A) |
| Browser/desktop | Shared TypeScript engine route in the browser and Tauri webview; no native decoder dependency |
| Physical HDR | Unavailable as a verified product claim on the tested SDR/browser environment |

Unsupported RAW compression, X-Trans/Foveon/multi-shot, linear RGB DNG,
required opcodes/delta calibration, unknown lens profiles, compressed/tiled/
multipart/deep EXR, PQ/HLG/gain-map export, and arbitrary proprietary camera
extensions fail or remain deferred rather than falling back to a thumbnail.

## Numeric and independent evidence

The legally redistributable DNG fixture was fetched from the f-spot raw-samples
corpus under its repository/CCL terms and was not committed as a binary. An
independent ImageMagick probe identified the raw DNG IFD at 3920x2638 and a
separate 320x240 RGB embedded preview. Varve's decoder selected the raw IFD,
applied its LinearizationTable before calibration, retained the Bayer mosaic,
and emitted a 3916x2634 DefaultCrop development. Observed run on the local
Linux workstation:

```text
sha256: 081bc2378ad24e36670ad39028fd167953dfb4972699b00404a303744c5be4b
bytes: 10575296
decode: 4041.052 ms; 3920 x 2638; 8-bit Bayer; ISO 160
warnings: LinearizationTable applied; embedded preview ignored
develop: 20054.906 ms; 3916 x 2634 float32 scene-linear output
finite: true; min: -0.33315995; max: 7.2379274; above-white RGB samples: 147908
sensor-clipped: 0; output-clipped: 119116
```

These measurements are local Linux observations, not performance guarantees.
The independent decoder confirms container/raw dimensions, not converter-look
parity. Synthetic HDR tests distinguish 1, 2, and 4 exposure ratios before
tone mapping and round-trip values above 1 and negative working values through
the EXR subset. The independent rendered-bracket EXR check found a 484x714,
four-channel, float32, uncompressed scanline file with sRGB chromaticities and
Varve `display-linear`/`hdr-exposure-fusion` metadata. `vips max`, `vips min`,
and `vips avg` reported 1.000000, 0.004555, and 0.332174 respectively. That
fixture therefore proves truthful exposure fusion and export structure, not
above-white scene radiance recovery. Focused test commands and exact results
are kept in the final Agent Validation Report.

The real three-frame LuckyHDR iPhone bracket was also fetched locally without
being committed. LibRaw's `raw-identify` identified Apple iPhone17,2 files with
16-bit JPEG-compressed `PhotometricInterpretation 0x8023`; the current decoder
rejects that compression/variant explicitly before any preview can be used.
This is a real camera bracket, but it is not a supported radiance fixture in
this release. Academic-only RawHDR/Real-HDRV datasets were rejected as release
corpora until their redistribution terms permit product validation.

## Visual evidence ledger

| Evidence | Status |
| --- | --- |
| Persistent retouch pointer interaction, authoritative redraw, undo, reopen, export | Implemented-and-verified: `retouch-tools.spec.ts` passed 2/2 in 1.9m, including an actual PNG download with magic-byte validation; evidence: `reports/ui-review/retouch/01-healing-brush-painted.png`, `02-spot-heal-painted.png`, `04-reopened.png`. |
| Photo/Image Tuning DNG selection, source facts, recipe controls, clipping labels | Implemented-and-verified: real Leica DNG E2E passed 1/1 in about 1.8m; evidence: `reports/ui-review/photo-raw-hdr/01-raw-developed.png`, `02-raw-before-after.png`, `06-raw-reopened.png`. |
| HDR dialog review, reference selection, deghost status, SDR preview, EXR download | Implemented-and-verified: real OpenCV rendered bracket E2E passed 1/1 in 48.6s; evidence: `reports/ui-review/photo-raw-hdr/03-bracket-review.png`, `04-bracket-merged.png`, `05-bracket-sdr-preview.png`. |
| HDR master output transform and save/reopen | Implemented-and-verified: the same bracket workflow changed output exposure, checked the persisted recipe, reloaded from Home, and decoded the retained float32/display-linear master; evidence: `reports/ui-review/photo-raw-hdr/06-hdr-master-output-transform.png`, `07-hdr-master-reopened.png`. |
| SDR viewing transform for HDR artifact review | Available as a review transform; does not prove display luminance |
| Physical HDR monitor/runtime | Unavailable in this environment; not claimed |

## Research record

Research was performed and rechecked on 2026-09-13. Primary sources include
[LibRaw docs](https://www.libraw.org/docs), [LibRaw API](https://www.libraw.org/docs/API-CXX.html),
[rawlib 0.3.1](https://docs.rs/rawlib/latest/rawlib/), [old libraw 0.1.1](https://docs.rs/crate/libraw/latest),
[rsraw 0.1.1](https://docs.rs/crate/rsraw/latest), [libraw-rs-sys 0.0.4+libraw-0.20.1](https://docs.rs/crate/libraw-rs-sys/0.0.4%2Blibraw-0.20.1),
[Adobe DNG documentation](https://helpx.adobe.com/ca/camera-raw/desktop/dng-and-file-formats/digital-negative.html),
[RawSpeed](https://github.com/darktable-org/rawspeed),
[DNGLab/Rawler](https://github.com/dnglab/dnglab),
[Lensfun manual](https://lensfun.github.io/manual/latest/),
[OpenCV HDR reference](https://docs.opencv.org/4.13.0/d2/df0/tutorial_py_hdr.html),
[OpenEXR technical introduction](https://openexr.com/en/latest/TechnicalIntroduction.html),
[OpenEXR file layout](https://openexr.com/en/latest/OpenEXRFileLayout.html),
[ICC v4 specifications](https://www.color.org/v4spec/),
[ITU-R BT.2100-3](https://www.itu.int/rec/r-rec-bt.2100),
[HTML Canvas](https://html.spec.whatwg.org/multipage/canvas.html),
[WebGPU canvas configuration](https://gpuweb.github.io/types/interfaces/GPUCanvasConfiguration.html),
[Chrome WebGPU 129](https://developer.chrome.com/blog/new-in-webgpu-129),
[WebKitGTK 2.52](https://webkitgtk.org/2026/03/18/webkitgtk2.52.0-released.html),
[WebView2](https://learn.microsoft.com/en-us/microsoft-edge/webview2/),
[Android Ultra HDR](https://developer.android.com/media/platform/hdr-image-format),
and [ONNX execution providers](https://onnxruntime.ai/docs/execution-providers/).

## Remaining limits and handoffs

The precision/export contract owner must be consulted before adding float tile
storage or any new adjustment kernel. The import/source owner must keep generic
File > Import from substituting previews for RAW. The existing inference owner
must keep optional models out of the core path and use manifest/checksum/
cancellation contracts. Website copy must use the support matrix above. Native
LibRaw/RawSpeed/Rawler integration, DCP/Lensfun correction, real camera
bracket fixtures, full-resolution tiled alignment, source-space retouch replay,
gain-map output, and physical HDR display certification remain future work.
