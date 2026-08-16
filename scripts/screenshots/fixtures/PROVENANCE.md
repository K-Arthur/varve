# Fixture provenance

Every other fixture in this directory is generated (the `.varve` documents
are code-authored in `../demo-document.ts`; see that file's header). Raster
photos can't be code-generated the same way, so the one used for image-based
scenes is recorded here explicitly — this file exists so a photo's origin
and license are never left to be inferred from a filename.

## `earth.jpg`

- **Source:** NASA Image and Video Library, EPIC (Earth Polychromatic
  Imaging Camera) view of Africa and Europe.
- **NASA ID:** `GSFC_20171208_Archive_e000676`
- **Original asset:** `GSFC_20171208_Archive_e000676~large.jpg`,
  retrieved from `images-assets.nasa.gov` on 2026-08-15.
- **License:** NASA imagery is not subject to copyright in the United
  States (public domain) per NASA's media usage guidelines
  (nasa.gov/nasa-brand-center/images-and-media/), except where NASA has
  incorporated separately copyrighted material — not the case for this
  Earth-observation photograph. No NASA logo, personnel, or endorsement is
  depicted or implied by its use here.
- **Used by:** the `palette-inspector` scene in `../product.mjs`, which
  operates on a real photograph rather than a synthetic test swatch, since
  palette extraction is only honestly shown against real photographic
  content.

## `earth-noisy.jpg`

- **Derived from:** `earth.jpg` above (same source, same license), with
  `magick earth.jpg -attenuate 0.6 +noise Gaussian -quality 85
  earth-noisy.jpg` applied — a fixed, deterministic, reproducible transform,
  not a separate photo.
- **Why a degraded derivative:** the Enhance feature's Auto analysis
  correctly reports "No specific restoration suggested" against the clean
  source photo, which is accurate but doesn't demonstrate what the feature
  actually does. A visibly noisy derivative of the same rights-cleared photo
  lets the `enhance-dialog-auto` scene show a real, reproducible
  "Recommended: denoise" result instead — including the honest "needs the
  SCUNet model, which is not installed yet" state, since that's the real
  first-run experience (models are downloaded on demand, not bundled).
