# Font parser and native collection audit — 2026-09-14

This note records two follow-up defects found after the exact-face boundary
work. It supplements the dated acceptance matrix and does not claim that the
desktop collection or rendering oracle is complete.

## Findings

The native enumeration cache was keyed only by the source path and stored one
face handle. A TTC/OTC with several faces could therefore return the first
member's collection index and handle for every family/name pair from that
file. The artifact hash was safe to share, but the member selection was not.

The parser's Macintosh platform name decoder replaced every byte above ASCII
with U+FFFD. Fonts that provide only platform-1 MacRoman name records could
lose accented or typographic family names even though the records were valid.

## Changes

Native enumeration now caches the immutable artifact bytes and hash per path,
then resolves the collection index and builds the opaque handle independently
for each enumerated face. The loader still re-enumerates the current system
collection, verifies the original hash, and checks the requested member before
returning bytes.

The parser now uses the standard MacRoman high-byte mapping for platform-1
name records. The mapping is embedded and deterministic; no host codec or
network request is involved. A fixture-level test covers `Café` encoded as a
Macintosh name record.

## Evidence

Commands run:

```text
rustfmt --edition 2021 apps/desktop/src-tauri/src/font.rs
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib font::tests -- --nocapture
pnpm exec biome check --write packages/engine/src/font/fontParser.ts packages/engine/src/font/fontParser.test.ts
pnpm exec vitest run packages/engine/src/font/fontParser.test.ts packages/engine/src/font/fontParser.realfont.test.ts packages/engine/src/font/fontParser.woff.test.ts --pool=threads --maxWorkers=1 --reporter=dot
```

Results:

- Desktop library compilation passed; the existing unrelated warnings in
  `build.rs` and `src/lib.rs` remain.
- Four native font enumeration/handle tests passed.
- Eighty-six parser, real-font, and WOFF tests passed.
- The real-font cases continue to use checked-in Fontsource artifacts and
  verify original-byte SHA-256 identity, variable axes, and OS/2 metrics.

## Limits

The host test does not certify every OS's font database or prove a multi-member
TTC exists on the runner. The exact-member rendering, restart, WebKitGTK, and
Windows/macOS checks remain pending. Malformed collection members still need a
dedicated corpus that is rejected before registration; this audit only closes
the cache and name-decoding defects.
