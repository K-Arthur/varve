# Development Setup

## Prerequisites

| Tool | Version | Installation |
|------|---------|--------------|
| Rust | 1.97+ | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| pnpm | 11.9+ | `npm install -g pnpm` or `corepack enable && corepack prepare pnpm@latest --activate` |
| just | 1.54+ | `cargo install just` or `pacman -S just` / `brew install just` |
| Node.js | 26+ | via fnm/nvm/volta or system package manager |
| wasm32 target | — | `rustup target add wasm32-unknown-unknown` |

### Linux (Tauri)

```bash
# Arch Linux
sudo pacman -S webkit2gtk-4.1 gtk3 librsvg libsoup3 \
  ttf-font fontconfig openssl cmake

# Ubuntu/Debian
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev \
  libsoup-3.0-dev libjavascriptcoregtk-4.1-dev
```

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

```bash
# All tests
just test

# Individual suites
just test-rust            # cargo test --workspace
just test-js              # pnpm test (Vitest)

# E2E (Playwright, chromium)
npx playwright install chromium
npx playwright test tests/e2e --project=chromium --reporter=list

# Single E2E file
npx playwright test tests/e2e/canvas/tools.spec.ts --project=chromium --reporter=list
```

## Quality gates

Before committing, run:

```bash
just gate
```

This runs format-check, lint, test, and the audit gates (tokens, emoji,
docs drift, architecture health, typecheck regression).
Each gate is also available individually:

```bash
just format              # Auto-format
just format-check        # Check formatting
just lint                # Lint (Biome + Clippy)
just gates               # Audits only
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
