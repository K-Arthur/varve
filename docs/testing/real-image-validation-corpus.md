# Real-image validation corpus

Small, deterministic, legally redistributable image fixtures for model-quality
testing. Synthetic gradients and patterns cover the failure modes that real
photos expose, without requiring a large collection of licensed photography.

> **Status (2026-08-10):** the eight programmatic fixtures described in the
> original version of this document (`hair-strands.png`, `fur-edge.png`,
> `transparency-glass.png`, `low-contrast-subject.png`, `shadow-compression.png`,
> `multi-subject.png`, `small-subject.png`, `skin-tone-variety.png`) and their
> generator script (`scripts/generate-test-fixtures.mjs`) were **never
> created**. The document is retained as the plan for that corpus; the
> sections below describe what actually exists today.

## Fixture inventory (planned — not yet generated)

| Fixture | Size | Mode | What it tests | Source |
|---------|------|------|---------------|--------|
| `hair-strands.png` | 200×200 | RGBA | Fine edges, semi-transparent strands against solid bg | Programmatic (generated) |
| `fur-edge.png` | 200×200 | RGBA | Irregular fuzzy boundary, high-frequency detail | Programmatic (generated) |
| `transparency-glass.png` | 200×200 | RGBA | Refractive transparent material, partial alpha | Programmatic (generated) |
| `low-contrast-subject.png` | 200×200 | RGBA | Subject with similar colour to background | Programmatic (generated) |
| `shadow-compression.png` | 200×200 | RGBA | Cast shadow, JPEG-like blocking artifacts | Programmatic (generated) |
| `multi-subject.png` | 300×200 | RGBA | Two separated subjects with gap | Programmatic (generated) |
| `small-subject.png` | 200×200 | RGBA | Tiny central subject, large background area | Programmatic (generated) |
| `skin-tone-variety.png` | 200×200 | RGBA | Multiple skin-tone swatches | Programmatic (generated) |

## Existing E2E fixtures

| Fixture | Size | Notes |
|---------|------|-------|
| `tests/e2e/fixtures/caf-4k.png` | 4K | Deterministic canvas-rendered fixture used by E2E image tests |
| `tests/e2e/fixtures/photo-fixture.jpg` | — | Deterministic photographic-style fixture (generated 2026-08-07) |
| `tests/e2e/fixtures/caf-test.png` | Small | Minimal canvas fixture |
| `tests/e2e/fixtures/flower.jpg` | Stub | Placeholder — replace with real small JPEG |
| `tests/e2e/fixtures/subject-photo.png` | 74×52 | Small subject preview |
| `tests/e2e/fixtures/test-image.png` | 39×52 | Minimal test image |

Additional generated fixtures for animated media (APNG/GIF) live in
`packages/engine/src/media/__fixtures__/` and are produced by
`scripts/generate-media-fixtures.mjs` — separate from this corpus.

## License

The planned programmatic fixtures are intended to be CC0 1.0 Universal
(public domain) once generated — no external data, no photography, no
third-party IP. Existing E2E fixtures are generated in-repo; `photo-fixture.jpg`
and `caf-4k.png` are deterministic renders, not licensed photography.

## Usage tiers

### Public (in-repo, CI)
Existing fixtures in `tests/e2e/fixtures/`. These are deterministic,
small, and can be checked into any branch.

### Local-only (not committed)
No local-only fixtures currently. If real-photo fixtures are added in future,
they belong in a separate `.gitignore`d directory with documented provenance
and per-image attribution.

## Adding a new fixture

When the planned corpus is built, write a deterministic generator (no random
values without a fixed seed) — the originally planned script name was
`scripts/generate-test-fixtures.mjs` (does not exist yet; create it, or
extend `scripts/generate-media-fixtures.mjs` for animated-media fixtures).
The generator should overwrite `tests/e2e/fixtures/*.png` with fresh output.
