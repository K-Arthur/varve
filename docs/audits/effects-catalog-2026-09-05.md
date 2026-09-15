# Effects catalog inventory — 2026-09-05

This is a source inventory of the active shared catalog, not certification of every operation.
The repaired checkout contains **52 primitive adjustments** and **35 Studio recipes**.
The architecture guide previously claimed 36 recipes. Layer appearance effects, user Looks
and recipe instances are separate concepts and must not be counted as new primitives.

The detailed source snapshot (including every parameter default and inferred metadata) is
[the initial catalog snapshot](effects-catalog-2026-09-05.json). Inferred metadata is under repair;
it must not be treated as authoritative ranges, alpha behavior or runtime acceleration.

## Primitive coverage

All entries attach to Object Filters; additional surfaces are shown below. Their shared
state path is Adjustment → FilterIR → filter compositor. CPU means the registry claims a
Canvas2D/software path, not that every exposed parameter has been visually tested.
“Raster” describes the registry export claim; real exported-image checks are tracked separately.

| Stable ID | Display name | Additional surfaces | Parameters | GPU claim | SVG claim | This audit’s verification |
| --- | --- | --- | --- | --- | --- | --- |
| `brightness` | Brightness | adjustment-layer | value | false | native | Neutral partial strength: real inspector, Undo/Redo and PNG alpha verified |
| `contrast` | Contrast | image-tuning, adjustment-layer | value | false | native | Implemented but unverified in this audit |
| `exposure` | Exposure | image-tuning, adjustment-layer | value, offset, gammaCorrection | false | rasterize | Implemented but unverified in this audit |
| `saturation` | Saturation | image-tuning, adjustment-layer | value | false | native | Implemented but unverified in this audit |
| `hueSaturation` | Hue / Saturation | adjustment-layer | ranges | false | rasterize | Implemented but unverified in this audit |
| `hueRotate` | Hue Rotate | adjustment-layer | value | false | native | Implemented but unverified in this audit |
| `sepia` | Sepia | adjustment-layer | value | false | native | Implemented but unverified in this audit |
| `grayscale` | Grayscale | adjustment-layer | value | false | native | Implemented but unverified in this audit |
| `invert` | Invert | adjustment-layer | value | false | native | Numerical partial-strength alpha verified |
| `opacity` | Opacity | Object only | value | false | native | Numerical partial-strength alpha verified |
| `blur` | Blur | Object only | radius | false | native | Implemented but unverified in this audit |
| `sharpen` | Sharpen | Object only | amount, radius, threshold | false | rasterize | Implemented but unverified in this audit |
| `temperature` | Temperature | image-tuning, adjustment-layer | value | false | rasterize | Implemented but unverified in this audit |
| `tint` | Tint | image-tuning, adjustment-layer | value | false | rasterize | Implemented but unverified in this audit |
| `vibrance` | Vibrance | image-tuning, adjustment-layer | value | false | rasterize | Implemented but unverified in this audit |
| `levels` | Levels | adjustment-layer | inputShadows, inputMidtones, inputHighlights, outputShadows, outputHighlights, channel | false | rasterize | Implemented but unverified in this audit |
| `curves` | Curves | adjustment-layer | channel, points | false | rasterize | Implemented but unverified in this audit |
| `selectiveColor` | Selective Color | adjustment-layer | colorRange, cyan, magenta, yellow, black, relative | false | rasterize | Implemented but unverified in this audit |
| `colorBalance` | Color Balance | adjustment-layer | shadows, midtones, highlights, preserveLuminosity, algorithmVersion | false | rasterize | Implemented but unverified in this audit |
| `channelMixer` | Channel Mixer | adjustment-layer | outputChannel, redPercent, greenPercent, bluePercent, constant, monochrome | false | rasterize | Implemented but unverified in this audit |
| `photoFilter` | Photo Filter | adjustment-layer | color, density, preserveLuminosity | false | rasterize | Implemented but unverified in this audit |
| `shadowHighlight` | Shadow / Highlight | image-tuning, adjustment-layer | shadows, highlights, tonalWidth, midpoint | false | rasterize | Implemented but unverified in this audit |
| `halftone` | Halftone | adjustment-layer | pattern, frequency, angle, dotShape, channel, method, threshold, intensity, softness, invert, foregroundColor, backgroundColor | false | rasterize | Implemented but unverified in this audit |
| `gradientMap` | Gradient Map | adjustment-layer | stops, dither, preserveLuminosity, ditherSize, mode, reverse, intensity, luminanceMode, preserveSourceAlpha, interpolation, algorithmVersion | false | rasterize | Implemented but unverified in this audit |
| `tritone` | Tritone | effect-studio | shadowColor, midtoneColor, highlightColor, shadowPoint, highlightPoint, intensity, preserveLuminosity | false | rasterize | Implemented but unverified in this audit |
| `colorHalftone` | Color Halftone | effect-studio | screenSize, angle, dotShape, mode, intensity | false | rasterize | Implemented but unverified in this audit |
| `duotone` | Duotone | effect-studio | shadowColor, highlightColor, shadowPoint, highlightPoint, intensity, preserveLuminosity | false | rasterize | Implemented but unverified in this audit |
| `blackAndWhite` | Black & White | adjustment-layer | reds, yellows, greens, cyans, blues, magentas, brightness, preserveLuminosity | false | rasterize | Implemented but unverified in this audit |
| `posterize` | Posterize | adjustment-layer | levels | false | rasterize | Implemented but unverified in this audit |
| `threshold` | Threshold | adjustment-layer | level, luminanceMode, algorithmVersion | false | rasterize | Implemented but unverified in this audit |
| `lut` | LUT | adjustment-layer | lutJson, inputSpace, interpolation, intensity, linearize | false | rasterize | Implemented but unverified in this audit |
| `dither` | Dither | effect-studio | algorithm, paletteMode, levels, colors, metric, serpentine, strength, bayerSize, cellSize, alphaCutoff, seed | true | rasterize | Implemented but unverified in this audit |
| `paletteSnap` | Palette Snap | effect-studio | colors, metric, amount, dither, ditherAlgorithm, ditherStrength, alphaCutoff, seed | true | rasterize | Implemented but unverified in this audit |
| `bloom` | Bloom | effect-studio | threshold, softKnee, intensity, radius, diffusion, tint, tintAmount, composite, streakEnabled, streakAngle, streakLength, streakIntensity, streakAspect, quality | true | rasterize | Implemented but unverified in this audit |
| `rgbSplit` | RGB Split | effect-studio | mode, redX, redY, greenX, greenY, blueX, blueY, amount, centerX, centerY, falloff, fringeAngle, borderMode, intensity | true | rasterize | Implemented but unverified in this audit |
| `crt` | CRT | effect-studio | curvature, cornerRadius, scanlinePeriod, scanlineStrength, scanlineSoftness, phosphorMask, phosphorPitch, phosphorIntensity, glow, vignette, vignetteRadius, convergenceX, convergenceY, brightness, contrast | true | rasterize | Implemented but unverified in this audit |
| `vhs` | VHS | effect-studio | lumaNoise, chromaNoise, chromaBleed, jitter, tracking, dropouts, headSwitching, tearing, signalBlur, timeInstability, seed, time, frameRate, quality | true | rasterize | Implemented but unverified in this audit |
| `lightShafts` | Light Shafts | effect-studio | lightX, lightY, lightType, direction, intensity, exposure, decay, density, weight, sampleCount, scattering, tint, occlusionSource, quality | true | rasterize | Implemented but unverified in this audit |
| `lensFlare` | Lens Flare | effect-studio | sourceX, sourceY, brightness, scale, ghostCount, ghostSpacing, halo, apertureBlades, apertureRotation, streakIntensity, anamorphicRatio, chromaticDispersion, seed, quality | true | rasterize | Implemented but unverified in this audit |
| `lightLeak` | Light Leak | effect-studio | seed, x, y, angle, size, softness, hue, saturation, lightness, intensity, noiseScale | true | rasterize | Implemented but unverified in this audit |
| `caustics` | Caustics | effect-studio | scale, depth, waveCount, complexity, refractionAmount, sharpness, lightAngle, brightness, contrast, dispersion, distortionAmount, output, waterTint, surfaceTint, seed, time, animationSpeed, tileable, quality | true | rasterize | Implemented but unverified in this audit |
| `motionBlur` | Motion Blur | Object only | distance, angle | false | rasterize | CPU kernel, compositor, bounds, editor and unit coverage added; real browser/editor/export test passed |
| `mosaic` | Mosaic | Object only | blockSize, originX, originY | false | rasterize | CPU kernel, compositor, bounds, editor and unit coverage added; real browser/editor/export test passed |
| `surfaceSmooth` | Surface Smooth | Object only | radius, sensitivity | false | rasterize | CPU kernel, compositor, bounds, editor and unit coverage added; real browser/editor/export test passed |
| `edgeInk` | Edge Ink | Object only | radius, threshold, softness, foregroundColor, backgroundColor, transparentBackground | false | rasterize | CPU kernel, compositor, bounds, editor and unit coverage added; real browser/editor/export test passed |
| `microDetail` | Fine Texture | image-tuning | amount, threshold | false | rasterize | Implemented but unverified in this audit |
| `definition` | Local Contrast | image-tuning | amount, radius, protectHighlights | false | rasterize | Implemented but unverified in this audit |
| `atmosphere` | Atmospheric Depth | image-tuning | amount, radius, protectHighlights | false | rasterize | Implemented but unverified in this audit |
| `dehaze` | Dehaze | image-tuning | amount, radius, protectHighlights | false | rasterize | Implemented but unverified in this audit |
| `edgeFalloff` | Vignette | image-tuning | strength, midpoint, feather, roundness, centerX, centerY, highlightProtection | false | rasterize | Implemented but unverified in this audit |
| `grain` | Grain | image-tuning | strength, scale, character, seed | false | rasterize | Implemented but unverified in this audit |
| `softBloom` | Highlight Glow | image-tuning | strength, radius, threshold, softness | false | rasterize | Implemented but unverified in this audit |

## Curated recipes

These are compositions of existing primitives, not additional algorithms. Their application,
customization, restoration and persistence still need dedicated verification in this audit.

| Stable recipe ID | Name | Ordered members |
| --- | --- | --- |
| `studio-palette-cut` | Palette Cut | posterize, paletteSnap |
| `studio-pigment-wash` | Pigment Wash | tritone, softBloom, grain |
| `studio-inked-paper` | Inked Paper | duotone, grain |
| `studio-screen-print` | Screen Print | colorHalftone, paletteSnap |
| `studio-dry-ink` | Dry Ink | blackAndWhite, dither, grain |
| `studio-crosshatch` | Crosshatch | blackAndWhite, halftone |
| `studio-ink-wash` | Ink Wash | tritone, softBloom, grain |
| `studio-sprayed-stroke` | Sprayed Stroke | paletteSnap, dither |
| `studio-glass-shift` | Glass Shift | caustics, rgbSplit |
| `studio-ocean-ripple` | Ocean Ripple | caustics, lightLeak |
| `studio-refracted-light` | Refracted Light | caustics, lightLeak |
| `studio-prism-flare` | Prism Flare | lensFlare, rgbSplit |
| `studio-relief-study` | Relief Study | blackAndWhite, sharpen, posterize |
| `studio-chalk-field` | Chalk Field | blackAndWhite, dither, grain |
| `studio-pencil-poster` | Pencil Poster | dither, duotone, grain |
| `studio-stamp-cut` | Stamp Cut | threshold, duotone, grain |
| `studio-graphic-pen` | Graphic Pen | blackAndWhite, sharpen, threshold |
| `studio-dot-study` | Dot Study | blackAndWhite, halftone, grain |
| `studio-halftone-pattern` | Halftone Pattern | blackAndWhite, halftone |
| `studio-paper-copy` | Paper Copy | blackAndWhite, threshold, grain |
| `studio-contour-dither` | Contour Dither | blackAndWhite, sharpen, dither |
| `studio-chromatic-bloom` | Chromatic Bloom | bloom, rgbSplit |
| `studio-cinema-shafts` | Cinema Shafts | lightShafts, softBloom |
| `studio-neon-phosphor` | Neon Phosphor | crt, bloom |
| `studio-light-leak` | Light Leak | lightLeak, softBloom |
| `studio-aperture-star` | Aperture Star | lensFlare, bloom |
| `studio-laser-streak` | Laser Streak | bloom, rgbSplit |
| `studio-solar-shift` | Solar Shift | invert, posterize, lightLeak |
| `studio-terminal-glow` | Terminal Glow | duotone, crt, bloom |
| `studio-analog-signal` | Analog Signal | vhs, crt |
| `studio-newsprint` | Newsprint | blackAndWhite, halftone, grain |
| `studio-riso-ink` | Riso Ink | duotone, colorHalftone, grain |
| `studio-water-paper` | Water Paper | tritone, softBloom, grain |
| `studio-worn-tape` | Worn Tape | vhs, grain |
| `studio-reticulation` | Reticulation | dither, grain |

## Other categories and availability

- User Looks: `packages/scene/src/effectLooks.ts`; persisted reusable stacks, not primitives.
- Layer appearance: `packages/engine/src/effectPipeline.ts` and EffectIR; separate from FilterIR.
- Native kernels: `crates/varve-effects`; existence does not certify the active desktop dispatch.
- Optional GPU: per-operation and parameter-subset eligibility needs runtime evidence; the
  current registry collapses partial support into `true`, a confirmed metadata defect.
- Unknown future adjustments: scene normalization retains payloads, Object Filters presents
  an unavailable state, and FilterIR conversion excludes unknown kinds. This audit has not yet
  verified save/reload through the actual UI.
- Native packaged Linux, macOS and Windows routes have not been exercised in this audit.

The four additions are now present in the shared object-filter catalog. Bloom streaks and
background-removal edge analysis remain related implementation details, not equivalents for
these independently editable filters.

## Additional confirmed source discrepancies

- `AdjustmentBase` has no per-filter mask field. Object Filters inherits node/stack
  masking; registry prose claiming individual filter masks is inaccurate. Layer
  appearance EffectIR masks are a different model and must not be conflated.
- `dispatchLiveEffect` has consumers in tests and the GPU harness, but no production
  export caller was found. The production filter compositor remains synchronous
  CSS/software. Native/GPU implementation availability is not active-path coverage.
- Export callers now force the `export` quality tier even when a serialized effect
  requests an interactive tier. A focused kernel regression test covers this contract.
- The scene normalizer now treats `colors` as bounded RGB palette entries and
  preserves 32-bit seeds. Focused normalization tests cover dither, palette snap,
  and explicit export quality round trips.
- `filterToCss('vibrance')` substitutes saturation despite an existing distinct
  software Vibrance kernel. CSS/software agreement is not currently guaranteed.

These findings are not yet marked repaired or comprehensively reproduced.
