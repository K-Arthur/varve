# ADR-0009: Document Color Architecture — Bit Depth, Working Space, and ICC Pipeline

## Status

Proposed — extends the existing `ManagedColor` system (ADR-0002 color tokens, Session 35 color
management). Created 2026-07-21.

## Context

The current system stores all channels as 0-255 with no bit depth concept. CMYK uses analytical
RGB↔CMYK conversion (duplicated in two modules) rather than ICC profiles. Blending happens in
gamma-space (mathematically incorrect). The Rust ICC engine (`varve-colour`) exists but is
bypassed by the print pipeline. Import preserves color only from SVG; PSD/PDF/EPS discard it.
Codegen collapses everything to sRGB hex/rgba strings.

This ADR defines the bit depth model, internal normalized representation, working space, and
ICC integration that the rest of the color-architecture work (rendering, import/export, UI)
builds on. It is deliberately narrow: it does not redesign `ManagedColor` or `ColorConfig`, it
extends them.

## Design Decisions

### D1 — Bit depth as a field on RGB/Gray variants

```ts
type BitDepth = 'uint8' | 'uint16' | 'float16' | 'float32';

interface RgbColor {
  space: 'rgb';
  bitDepth: BitDepth;        // NEW — defaults to 'uint8' when absent
  r: number; g: number; b: number; a: number;
  profile?: string;
}
// same shape for CmykColor, GrayColor (SpotColorRef is a reference, unchanged)
```

`bitDepth` is **optional with default `'uint8'`** so every existing `ManagedColor` in the wild
(deserialized from a saved document) stays valid without a migration pass. A `withDefaultBitDepth()`
helper closes the gap for code that needs an explicit value.

Channel ranges by bit depth:

| bitDepth | range    | notes |
|----------|----------|-------|
| uint8    | 0–255    | integer. Backward compatible. |
| uint16   | 0–65535  | integer. |
| float16  | 0.0–1.0  | half-float precision intent; stored as JS number. |
| float32  | 0.0–1.0  | single-precision; HDR can exceed 1.0. |

The same range applies to **all channels** (R G B A C M Y K V) for a given bit depth. CMYK uint8
continues to use 0-255 (current behavior) — UI divides by 255 to display 0-100%.

### D2 — Normalized float is the internal representation

All math (blending, gradient interpolation, compositing, conversion) operates on
**normalized f32 channels in 0.0-1.0 range, straight alpha, linear-light** (when the working
space is linear). Two helpers go between storage and internal form:

- `normalizeChannel(value, bitDepth) → number` (0.0-1.0)
- `denormalizeChannel(value, bitDepth) → number` (storage range)

These live in `@varve/shared/colorConversion.ts` and are the single choke point. No other
module should divide by 255 or guess a range.

### D3 — Working space on ColorConfig

`ColorConfig` gains two fields:

```ts
interface ColorConfig {
  mode: ColorMode;
  bitDepth: BitDepth;             // NEW — document default
  rgbProfile: ColorProfileRef;
  cmykProfile: ColorProfileRef;
  displayProfile?: ColorProfileRef;
  outputIntent?: OutputIntentRef;
  workingSpace: 'srgb' | 'linear'; // NEW — 'linear' for correct blending
  blackGeneration: BlackGenerationConfig;
}
```

`workingSpace: 'srgb'` matches current behavior (blending in gamma space). `'linear'` decodes
channels before blending and re-encodes after. The default is `'srgb'` for existing documents;
new documents can opt into `'linear'`.

`bitDepth` at the document level is the default for newly created colors. A per-color
`bitDepth` overrides it.

### D4 — Conversion pipeline hierarchy

Conversions use the first mechanism available:

1. **ICC (profile-based)** when both source and target profiles are known — delegates to
   `varve-colour` WASM (`IccEngine`) or to LittleCMS on the Rust print path.
2. **Analytical fallback** — the existing `colorConversion.ts` math, now input-normalized.

A single function `convertColor(color, targetSpace, opts)` exposes this. It never silently
drops precision: converting uint8→float promotes; float→uint8 warns via opts.

### D5 — ManagedColor type stays a discriminated union

We do **not** refactor to `{ value, encoding }`. The discriminated union is used in 30+ files.
Adding `bitDepth` is the smallest change that satisfies the requirement. Spot color refs stay
unchanged (they carry a name and process fallback, not raw channels).

### D6 — Alpha is always straight in storage

Straight (non-premultiplied) alpha is the canonical storage form. Premultiplication is applied
locally inside blur/sharpen/composite (where it already happens) and reversed before the result
is stored. No node carries premultiplied channels.

## Key Files

| File | What changes |
|------|-------------|
| `packages/shared/src/colorConversion.ts` | `normalizeChannel`, `denormalizeChannel`, `convertColor`, `bitDepth` helpers |
| `packages/scene/src/colorManagement.ts` | `BitDepth` type, `bitDepth` field on RGB/Gray variants, `withDefaultBitDepth` |
| `packages/scene/src/colorMode.ts` | Normalized conversion paths |
| `packages/shared/src/blendModes.ts` | Linear-light blending (when working space = linear) |
| `packages/scene/src/types.ts` | `ColorConfig.bitDepth`, `ColorConfig.workingSpace` |
| `packages/scene/src/version.ts` | 2.3 → 2.4 migration: adds defaults for new fields |

## Migration

- **Document 2.3 → 2.4**: adds `bitDepth: 'uint8'`, `workingSpace: 'srgb'` to `ColorConfig`.
  Existing colors without `bitDepth` default to `'uint8'` at read time. No channel values
  change. **Lossless** — reversible by dropping the new fields.
- **Serialized colors**: `bitDepth` is optional. A missing field reads as `'uint8'`.

## Out of scope (future ADRs)

- Spectral color, device-link profiles, LAB/HSV native storage (extension points prepared).
- Per-node bit depth (all nodes in a document share the document default; architecture allows
  per-node later without a schema change).
- Display-side runtime ICC transform (planned: shader-based display LUT).
- HDR tonemapping / external display support.
