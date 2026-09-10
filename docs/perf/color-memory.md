# Color Memory & WASM Ceiling

Memory budget implications of high-bit-depth color in the Strata rendering
pipeline. Created 2026-07-21.

## WASM linear memory ceiling

WebAssembly enforces a 4 GiB linear-memory address space ceiling (2^32 bytes).
A single `float32` buffer tops out at ~1 G pixels (4 bytes x RGBA).

| Canvas size | RGBA float32 | RGBA uint8 | Notes |
|-------------|-------------|------------|-------|
| 10000x10000 | 1.6 GiB | 400 MiB | Full-bleed print at 240dpi |
| 8192x8192   | 1.0 GiB | 256 MiB | Exact float32 ceiling |
| 4096x4096   | 256 MiB  | 64 MiB  | Safe for all targets |
| 2048x2048   | 64 MiB   | 16 MiB  | Mobile / HiDPI preview |

**Implication:** a single full-float32 render buffer at 10000x10000 consumes
the entire WASM address space. The compositor must tile at this resolution.

## Tile budget

Given the 4 GiB ceiling, the tile renderer should cap individual tile buffers:

- **Max tile dimension** at float32: 4096x4096 (256 MiB per tile, leaves room
  for 3-4 buffers in flight).
- **Max tile dimension** at uint8: 8192x8192 (256 MiB per tile).
- **Default tile size**: 1024x1024 — works at any bit depth with headroom for
  effects (blur/sharpen need x2 shadow buffers).

## Autosave inflation

A document containing float32 CMYK data serializes to JSON with full float
precision. Storage impact vs uint8:

| Schema | Per-pixel size | 100-shape document | Notes |
|--------|---------------|-------------------|-------|
| uint8 RGBA | 4 B | ~50 MB | Baseline |
| float32 RGBA | 16 B | ~200 MB | 4x inflation |
| float32 CMYK | 20 B | ~250 MB | 5x inflation (5 channels) |
| float32+gzip | ~6 B | ~75 MB | Compression helps, still 1.5x |

### Recommendations

- **Web target:** default to uint8 unless the user explicitly opts into
  high bit depth (float32/uint16). The `formatVersion: '2.4'` inflation factor
  can surprise web users on low-storage devices.
- **Desktop target:** float32 is acceptable on native (no WASM ceiling).
- **Autosave interval:** consider extending the autosave interval for float32
  documents to reduce disk I/O pressure.

## Gradient & effect buffers

The effects pipeline allocates offscreen canvases per-effect:
- `layerBlur` / `backgroundBlur`: 1 shadow buffer per filtered node
- `dropShadow`: 1 shadow buffer per shadowed node
- `filterCompositor` (non-CSS): 1 buffer per filtered node

At float32, each 2048x2048 buffer = 64 MiB. A scene with 10 blurred nodes =
640 MiB of temporary allocation during a single render pass. The compositor
should reuse a pool of scratch buffers rather than allocating per-effect.

## See also

- `docs/adr/0009-document-color-architecture.md` — bit depth model
- `packages/shared/src/colorConversion.ts` — normalizeChannel/denormalizeChannel
- `packages/engine/src/blur.ts` — separable blur buffer budget
