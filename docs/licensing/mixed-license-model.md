# Varve Mixed-License Model

**Effective:** 2026-08-18  
**Status:** Implementation of Prompt 15 Option B

## Overview

Varve uses a mixed-license model: the application (editor, scene model,
UI, AI features, service integrations, and all app-specific code) remains
under FSL-1.1-MIT, while a set of reusable engine crates is published
under MIT OR Apache-2.0.

This gives the project access to grants, ecosystem reuse, and distro
channels that require OSI-approved licensing on the library layer,
while preserving commercial protection on the application.

## License map

### Open crates (MIT OR Apache-2.0)

| Crate | Description | Intra-workspace deps |
|-------|-------------|---------------------|
| `varve-core` | Geometry primitives, scene graph, hit-testing | None (dependency root) |
| `varve-colour` | ICC transforms, colour science, WASM bindings | `varve-core` |
| `varve-trace` | Raster-to-vector auto-tracing | `varve-core` |
| `varve-layout` | CSS-native flex/grid layout (Taffy) | `varve-core` |
| `varve-media` | Animated image decoding (GIF/APNG/WebP) | None |
| `varve-effects` | Live-effect kernels (dither, bloom, CRT, etc.) | None |
| `varve-upscale` | Image upscaling framework (bicubic + optional ONNX) | None |
| `varve-bgremove` | Background removal framework (heuristic + optional ONNX) | None |

### FSL-1.1-MIT application crates

| Crate | Description |
|-------|-------------|
| `varve-engine` | Scene-to-render-IR builder |
| `varve-print` | PDF/PDF-X export pipeline |
| `varve-bridge` | TS wire-format to SceneNode conversion |
| `varve-wasm` | wasm-bindgen glue for the web build |
| `varve-sync` | SQLite persistence + Yjs CRDT sync |

### FSL-1.1-MIT TypeScript packages

All `packages/*` and `apps/*` remain FSL-1.1-MIT. This includes
`@varve/editor`, `@varve/scene`, `@varve/ui`, `@varve/engine`,
`@varve/ai`, `@varve/home`, `@varve/prototype`, `@varve/collab`,
`@varve/history`, `@varve/compositor`, `@varve/layout`, `@varve/print`,
`@varve/codegen`, `@varve/import`, `@varve/cli`, `@varve/tokens`,
`@varve/shared`, `@varve/platform`, `@varve/crash`, `@varve/help`,
`@varve/collab`, and the root `package.json`.

### Third-party assets (unchanged)

ICC profiles (`varve-colour/profiles/`), bundled fonts, icon sets, and
ONNX model weights retain their original licenses. See
`THIRD_PARTY_NOTICES` for full attribution. The ICC profiles are
currently Artifex Software 2011 and must be replaced with
permissively-licensed equivalents before crates.io publication (see
"Known issues" below).

## Dependency direction

```
FSL crates ──→ open crates  (allowed: MIT/Apache permits this)
open crates ──→ FSL crates  (forbidden: open crates must not depend on FSL code)
```

All open crates depend only on each other (within the open set) and
on third-party crates with permissive licenses (MIT, Apache-2.0, ISC,
BSD, CC0). No open crate imports from any FSL crate or from the
application layer.

## Monetization boundary

The Pro edition (planned) includes:
- Advanced PDF/X export (owned by `varve-print`, FSL)
- Team collaboration and real-time sync (owned by `varve-sync`, FSL)
- Cloud asset libraries (server-side, not in any crate)
- Enterprise SSO and audit logging (server-side)
- Batch/automation features (server-side)
- Extended cloud rendering (server-side)

None of these features depend on or are implemented by the open crates.
Opening the engine layer does not affect the Pro monetization path.

## Distro eligibility

The open crates are independently packaging-eligible:
- **Fedora/Debian:** Crates under MIT OR Apache-2.0 qualify for main
- **AUR:** Both crates (MIT/Apache) and the app (FSL) can be packaged
- **Flathub:** The app builds from source; the FSL badge applies to the
  application package

## Grant eligibility

The open crates unlock:
- **NLnet / NGI Zero Commons Fund:** FLOSS infrastructure funding
  (up to €50k first round) — the colour + tracing + geometry crates
  are the pitch
- **Future:** STF/Prototype Fund become conceivable if the crates
  gain real dependents

## Known issues

1. **ICC profiles (varve-colour):** Both `sRGB.icc` and
   `default_cmyk.icc` are "Copyright Artifex Software 2011" from
   Ghostscript (AGPL-3.0-or-later). They must be replaced with
   permissively-licensed profiles before crates.io publication.
   Recommended: lcms2 reference profiles (MIT/X11).

2. **Crates.io publication:** The open crates have metadata ready
   (description, license, repository) but have not been published yet.
   Publication requires the ICC profile fix and manual `cargo publish`.

3. **SBOM generation:** `scripts/release/generate-sbom.mjs` reads
   licenses from `cargo metadata`, so it will automatically reflect
   the per-crate license split. No code change needed.

## Validation

`scripts/licensing/validate-license-boundary.mjs` enforces:
- Open crates carry `license = "MIT OR Apache-2.0"` in Cargo.toml
- FSL crates carry `license.workspace = true` (resolving to FSL-1.1-MIT)
- No open crate has a dependency path to an FSL crate
- TypeScript packages all carry FSL-1.1-MIT

Run via `node scripts/licensing/validate-license-boundary.mjs`.
