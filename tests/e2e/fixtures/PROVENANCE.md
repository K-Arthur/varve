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

All raster images were created by the project maintainer (Kevin Arthur)
specifically for E2E testing. No third-party image sources are used.
