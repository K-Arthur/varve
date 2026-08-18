# Semantic-corpus — provenance

## Summary

296 deterministic test images for semantic-search and embedding evaluation.
Generated from a fixed seed (`20260813`) via `manifest.json`; no external
image sources were used.

## Generation

The images are programmatic test patterns across seven visual domains:

| Domain | Count | Description |
|--------|-------|-------------|
| photo | 97 | Landscapes, portraits, products, food, vehicles |
| ui | 40 | Dashboard and mobile UI mockups |
| logo | 39 | Logo marks and wordmarks |
| pattern | 41 | Stripes, dots, spheres |
| illustration | 21 | Illustration-style renders |
| poster | 19 | Poster layouts |
| render | 39 | Architecture and 3D renders |

Each domain contains families of 19 variants (base, exact, resized,
jpeg-compressed, etc.) for testing duplicate-near-duplicate detection.

## License

All images are generated deterministically from code. No third-party
pixels. Generated content is CC0.

## Regeneration

The `scripts/semantic-corpus/` directory contains embedding-reference
and charmap tools. The original image generator is not checked in;
the images are committed as fixtures. If regeneration is needed, a new
generator matching the `manifest.json` schema can be written.
