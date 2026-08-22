# Development Setup

## Prerequisites

| Tool | Version | Installation |
|------|---------|--------------|
| Rust | 1.97+ | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| pnpm | 11.9+ | `npm install -g pnpm` or `corepack enable && corepack prepare pnpm@latest --activate` |
| just | 1.54+ | `cargo install just` or `pacman -S just` / `brew install just` |
| Node.js | 22.12+ enforced by `engines` (`package.json`); 26 is what CI and active development use | via fnm/nvm/volta or system package manager |
| wasm32 target | — | `rustup target add wasm32-unknown-unknown` |

`just wasm-build` / `just wasm-build-all` additionally need
[wasm-pack](https://rustwasm.github.io/wasm-pack/) (`cargo install wasm-pack`
or `pacman -S wasm-pack`). `wasm-opt` from Binaryen is used when present and
silently skipped otherwise.

### Linux (Tauri)

```bash
# Arch Linux
sudo pacman -S webkit2gtk-4.1 gtk3 librsvg libsoup3 \
  ttf-font fontconfig openssl cmake

# Ubuntu/Debian
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev \
  libsoup-3.0-dev libjavascriptcoregtk-4.1-dev \
  libssl-dev libfontconfig1-dev libglib2.0-dev cmake pkg-config
```

The Ubuntu list mirrors what CI installs before building
(`.github/workflows/ci.yml`, `build.yml`, `release.yml`); E2E workflow jobs
additionally install `libayatana-appindicator3-dev`.

See [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for other platforms.

## First-time setup

```bash
git clone https://github.com/K-Arthur/varve
cd varve
pnpm install              # Install JS dependencies
just check-env            # Verify toolchain
cargo build --workspace   # Build all Rust crates
just install-dev-icons    # Tauri dev icons (Linux only)
```

## Running

### Web (Vite dev server)

```bash
cd apps/desktop
pnpm dev
# → http://localhost:1420
```

### Desktop (Tauri native window)

```bash
cd apps/desktop
pnpm tauri:dev
```

### Storybook (UI component library)

```bash
pnpm --filter @varve/ui storybook
```

## Testing

**Validate according to impact, not repository size** — see
[docs/quality/validation-strategy.md](../quality/validation-strategy.md).

```bash
# Impact plan for current changes (dry run — always start here)
pnpm verify:plan

# Affected-first validation (default inner loop — replaces plain `pnpm test`)
pnpm verify:affected

# Tier 0 + 1 only (format/lint on touched files + directly related tests)
pnpm verify:quick

# Individual suites (full-suite operations — reserved for explicit gates)
just test-rust            # cargo test --workspace
just test-js              # pnpm test (Vitest)
just gate                 # Full Cascade Review gate

# E2E (Playwright, chromium) — feature-scoped by domain directory
npx playwright install chromium
npx playwright test tests/e2e/canvas/tools.spec.ts --project=chromium --reporter=list

# Single E2E file
npx playwright test tests/e2e/canvas/tools.spec.ts --project=chromium --reporter=list
```

## Quality gates

For ordinary feature work, run the affected gate before committing:

```bash
just check-affected      # or pnpm verify:affected
```

The full repository gate is reserved for release checkpoints,
workspace/toolchain changes, serialization migrations, and explicit
requests — it requires a stated reason:

```bash
VARVE_FULL_GATE_REASON="<why>" just gate-full
```

Each gate is also available individually:

```bash
just format              # Auto-format
just format-check        # Check formatting
just lint                # Lint (Biome + Clippy)
just gates               # Quality audits (tokens/emoji/docs) + health, architecture, typecheck-regression
just gate                # Full gate (format-check + lint + test + gates)
```

## Useful commands

```bash
# WASM builds
just wasm-build          # Build WASM engine backend
just wasm-build-all      # All WASM variants

# Packaging
just package-linux       # AppImage + .deb + .rpm (Linux)
just package-deb         # .deb only
just package-rpm         # .rpm only
just package-appimage    # AppImage only (local smoke artifact)
just package-dmg         # macOS .dmg (macOS only)
just package-windows     # Windows .msi + .nsis (Windows only)

# Development utilities
just generate-icons      # Regenerate app icons from source SVG
just install-dev-icons   # Install icons for Tauri dev mode (Wayland fix)
just check-env           # Verify toolchain availability
```

## Project structure

See `docs/architecture/render-pipeline.md` for the rendering architecture
and `docs/README.md` for the full documentation index.

## Contributor path

Read [contributing.md](contributing.md) before starting work. External code
pull requests are currently paused, but bug reports, workflow proposals,
cross-platform testing, documentation corrections, and design feedback are
welcome through the documented Issue and Discussion channels. When code work
reopens, that guide explains the project map, impact-aware validation, and pull
request expectations.
