# Palette Extraction System

Status: built in the editor Inspector for selected image shapes.

## Contract

Palette extraction is a derived analysis of an image. It does not add a palette
blob to the document schema and it never replaces the source asset. A user can
explicitly persist the result as document swatches or as colour variables;
those writes use the existing immutable document update path and therefore
remain undoable.

The public engine entry point is `analyzePalette` in
`packages/engine/src/intelligence/paletteExtractor.ts`. The result is versioned
with `PALETTE_ANALYSIS_VERSION` and contains:

- extracted swatches with Oklab/Oklch coordinates, population, alpha-weighted
  coverage, and a role candidate;
- derived harmony suggestions, marked with `origin: "derived"`;
- WCAG 2.1 contrast pairs with body-text and large-text thresholds;
- warnings for transparency, empty input, or a lack of useful opaque pairs;
- bounded timing data for sampling, clustering, post-processing, and total
  analysis time.

## Pixel pipeline

The editor decodes only a bounded preview of the selected image. The preview
is crop-aware: when an image has a visible crop, the Inspector offers a
Full image / Visible crop choice, defaulting to the visible crop so the
analysis samples pixels the user can see rather than silently analysing
hidden ones. The choice is part of the analysis configuration: the two
sources produce distinct cache keys and results. The editor caps the
temporary canvas at 256 × 256 pixels before transferring the RGBA bytes to
the analysis service.

The engine then:

1. rejects pixels below the configurable alpha threshold and records whether
   transparency was encountered;
2. takes stable spatial representatives so large regions remain represented;
3. takes a second high-chroma representative per spatial cell so a small
   saturated accent is not swallowed by a neutral background;
4. converts sRGB samples to Oklab and runs deterministic seeded K-Means++ with
   bounded iterations;
5. merges near-duplicate clusters, maps centroids back into sRGB gamut, and
   assigns presentation-only roles such as dominant, accent, or neutral;
6. derives harmonies in OKLCH and calculates contrast pairs from opaque
   extracted colours.

The seed is derived from the sampled bytes and bounded configuration unless a
caller supplies one. Equal input bytes and configuration therefore produce
equal ordering and values, which makes the result suitable for cache keys,
tests, and reproducible UI review.

## Runtime ownership

`packages/editor/src/intelligence/paletteAnalysisService.ts` owns the runtime
boundary. It transfers the bounded RGBA buffer to a module worker, rejects
stale responses, supports `AbortSignal` cancellation, and keeps a small
content/config keyed cache. The service has a queued main-thread fallback for
environments where module workers are unavailable; the fallback uses the same
engine function and remains bounded.

The service key includes the algorithm version, asset identity or content
hash, dimensions, crop, and requested colour count. A document update such as
saving swatches must not invalidate a still-current source or cause an
unnecessary re-analysis; the Inspector keeps the current source in a ref for
that lifecycle boundary.

## Colour management and accessibility

The current browser decode boundary is RGBA8 and browser canvas colour
management remains the display authority. ICC metadata is carried into the
source descriptor for provenance, but profile-aware raster decode is not
pretended where the browser does not provide it. Native colour-management
work remains governed by the broader
[`colour-management.md`](colour-management.md) contract.

Harmony colours are explicitly generated suggestions, not sampled colours.
They are gamut-mapped before being displayed. Contrast uses the shared WCAG
2.1 relative-luminance and contrast-ratio helpers and reports 3:1 large-text
AA, 4.5:1 body-text AA, and the corresponding AAA thresholds.

## Inspector workflow

For one selected image, the Appearance tab shows Palette beside Paint Library. The user can:

- choose between three and twelve requested colours and re-run analysis;
- copy an extracted or harmony colour as HEX;
- use an extracted colour as the current fill, or save one/all extracted
  swatches to the document;
- save extracted colours as new colour variables without overwriting existing
  variables;
- review accessible foreground/background pairs and transparency warnings.

Analysis is local: no network request and no model download are involved.
Large source images are never scanned at full resolution by the editor path.

## Validation and limits

The unit suite covers deterministic output, transparent-pixel filtering,
small-accent retention, contrast thresholds, finite bounded output, cache
identity, fallback execution, cancellation, and stale worker responses. The
Playwright workflow in
`tests/e2e/canvas/palette-extraction.spec.ts` imports a real fixture image,
drives the Inspector through the browser, saves swatches, captures the
rendered section, and checks the narrow Inspector for horizontal overflow.

This is a palette suggestion system, not semantic image understanding. Role
labels are heuristics, derived harmonies are proposals, and WCAG pair checks
do not replace review of typography, font weight, anti-aliasing, or the final
display/export colour profile.
