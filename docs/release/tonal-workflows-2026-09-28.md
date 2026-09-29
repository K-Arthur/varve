# Tonal workflow changes — 2026-09-28

These changes connect Channels, Curves, Channel Mixer, White Balance, Split
Toning and Sharpen to the existing editable Object Filters and Adjustment
Filters. They work locally without an account or model download on the
current RGBA8 software effect surface.

- Curves share their evaluator with the graph, retain every RGB/component
  point set and accept fractional numeric values. New curves use PCHIP;
  existing files keep the legacy transfer until explicitly upgraded. Point
  actions, keyboard movement and captured pointer drags supplement each other.
  Editable Soft contrast/Invert presets affect only the current channel.
- Channel Mixer retains all three output rows and reads the original pixel
  for every output. Negative coefficients and offsets remain creative controls.
- White Balance uses relative warmth/tint and linear RGB gains for rendered
  images. A labelled upstream patch picker and conservative explicit Auto
  can reject unreliable evidence. Repeated Auto replaces the estimate.
- Split Toning adds shadow/highlight chroma at the source Oklab lightness,
  with editable presets, pivot, smooth transition and strength. Zero chromatic
  contribution is exactly neutral; black/white endpoints remain protected.
- Channels inspects the selected image's original source without changing
  artwork. Channel snapshots use the existing partial-coverage selection and
  mask resources. Saved coverage operations now have owning undo transactions.
- Sharpen adds versioned Gaussian editing controls and requested document-pixel
  comparisons. Channels separately offers an original source-pixel crop.
  Legacy box sharpening remains available. Optional output sharpening uses
  one consistent encoded or linear domain and runs once after final resize.
- Browser raster PDF export now packs RGB correctly, retains nonopaque
  coverage through a soft mask and writes real byte offsets. Opened PNG,
  SVG image and Poppler-rendered PDF comparisons caught and verified this repair.

The software effect surface does not promise 16/32-bit, HDR, camera-calibrated
Kelvin, CMYK/spot channel painting or a new native/GPU kernel. Canvas/encoder
round trips may quantize partial alpha or discard hidden RGB even where scalar
no-ops preserve raw bytes. Existing Temperature, Tint and Color Balance keep
their established semantics.

The website's Color & Effects overview and new Channels and Tonal Editing
guide explain the same limits and use actual editor captures. No website or
release was published by this change.

Browser/menu, precision/history, mask, demo, offline warm reopen and rendered
export evidence is recorded in the audit. Native validation is pending after
the fresh Rust build exhausted disk space. Physical-device and cold offline
PWA qualification remain explicit follow-ups; this is not release certification.

See the [architecture](../architecture/tonal-adjustments.md),
[research and validation](../audits/tonal-workflows-2026-09-28.md) and
[opened visual evidence](../screenshots/tonal-workflows/README.md).
