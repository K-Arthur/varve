# E2E test fixtures — provenance

## Image fixtures

| File | Dimensions | Type | Source | License | Notes |
|------|-----------|------|--------|---------|-------|
| `caf-4k.png` | 4288×4288 | PNG RGBA | Project-generated photograph | Varve (sole author) | Used for large-image / crop / pan-zoom E2E tests. |
| `caf-test.png` | 64×64 | PNG RGBA | Derived from `caf-4k.png` | Varve (sole author) | Downscaled thumbnail variant. |
| `photo-fixture.jpg` | 1280×850 | JPEG | Project-generated photograph | Varve (sole author) | Used for photo-editing E2E tests. |
| `subject-photo.png` | 200×200 | PNG RGBA | Project-generated | Varve (sole author) | Subject for removal/adjustment tests. |
| `test-image.png` | 100×100 | PNG RGBA | Programmatic | Varve (sole author) | Minimal test pattern. |
| `flower.jpg` | 29 bytes | HTML placeholder | Error/placeholder file | N/A | Not a valid image; retained as-is. |
| `real-life-landscape.jpg` | 1632×1224 | JPEG | [Landscape picture](https://commons.wikimedia.org/wiki/File:Landscape_picture.JPG), Michae2109 | Public domain | Real photographic landscape used for generative-editing preview coverage. |
| `real-life-portrait.jpg` | 5171×6402 | JPEG | [Full-length portrait of a man](https://commons.wikimedia.org/wiki/File:Full-length_portrait_of_a_man_LCCN2006689630.jpg), Library of Congress | Public domain | High-resolution grayscale portrait used for large photographic source coverage. |
| `real-life-still-life.jpg` | 1280×960 | JPEG | [Flower still life](https://commons.wikimedia.org/wiki/File:Flower_still_life.jpg), Jon Sullivan | Public domain | Color still life used for texture and object-composition coverage. |

## Reviewed generative evidence

`generative-evidence/sd15-q4_0-landscape-replace/` contains the first reviewed
production-helper run on a photographic source: the prepared source, explicit
source-pixel mask, raw model candidate, final masked composite, difference map,
and [run manifest](generative-evidence/sd15-q4_0-landscape-replace/manifest.json).
It is evidence that the pinned helper/model pair produces a genuine
prompt-conditioned result; it is not a release qualification of the profile.

Project-generated images remain marked above. The three `real-life-*.jpg`
fixtures were downloaded from Wikimedia Commons on 2026-09-09 from files
marked public domain on their source pages. They are included only as local
test inputs so visual and image-workflow checks exercise photographic content.
