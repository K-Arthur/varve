# Strata monorepo task runner. `just -l` lists recipes.
# Tooling is installed user-local; cargo/pnpm/just are expected on PATH.

default: list

list:
    @just --list --unsorted

# --- One-time environment check ---
check-env:
    @echo "rustc:  $$(rustc --version)"
    @echo "cargo:  $$(cargo --version)"
    @echo "pnpm:   $$(pnpm --version)"
    @echo "just:   $$(just --version)"
    @echo "pkg-config webkit2gtk-4.1: $$(pkg-config --exists webkit2gtk-4.1 && echo FOUND || echo MISSING)"

# --- Install JS deps ---
install:
    pnpm install

# --- Build everything ---
build: build-rust build-js
build-rust:
    cargo build --workspace --all-targets
build-js:
    pnpm -r --filter "./packages/*" run build

# --- WASM build (web engine backend) ---
wasm-build:
    rustup target add wasm32-unknown-unknown
    cd crates/strata-wasm && wasm-pack build --target web --out-dir ../../apps/desktop/public/wasm --out-name strata_wasm
    which wasm-opt 2>/dev/null && wasm-opt -O3 -o apps/desktop/public/wasm/strata_wasm_bg.wasm apps/desktop/public/wasm/strata_wasm_bg.wasm || echo "wasm-opt not on PATH — skipping manual optimization"

wasm-build-simd:
    rustup target add wasm32-unknown-unknown
    cd crates/strata-wasm && RUSTFLAGS="-C target-feature=+simd128" \
      wasm-pack build --target web --out-dir ../../apps/desktop/public/wasm --out-name strata_wasm_simd
    which wasm-opt 2>/dev/null && wasm-opt -O3 -o apps/desktop/public/wasm/strata_wasm_simd_bg.wasm apps/desktop/public/wasm/strata_wasm_simd_bg.wasm || echo "wasm-opt not on PATH — skipping SIMD optimization"

wasm-check:
    rustup target add wasm32-unknown-unknown
    cargo check --target wasm32-unknown-unknown -p strata-wasm

# --- WASM build (colour engine, for browser print pipeline) ---
wasm-build-colour:
    rustup target add wasm32-unknown-unknown
    cd crates/strata-colour && wasm-pack build --target web --out-dir ../../apps/desktop/public/wasm --out-name strata_colour -- --features wasm
    which wasm-opt 2>/dev/null && wasm-opt -O3 -o apps/desktop/public/wasm/strata_colour_bg.wasm apps/desktop/public/wasm/strata_colour_bg.wasm || echo "wasm-opt not on PATH — skipping manual optimization"

wasm-build-all: wasm-build wasm-build-simd wasm-build-colour

wasm-size:
    ls -lh apps/desktop/public/wasm/strata_wasm_bg.wasm apps/desktop/public/wasm/strata_wasm_simd_bg.wasm apps/desktop/public/wasm/strata_colour_bg.wasm 2>/dev/null

wasm-check-colour:
    rustup target add wasm32-unknown-unknown
    cargo check --target wasm32-unknown-unknown -p strata-colour --features wasm

# --- Tests (TDD-first) ---
test: test-rust test-js
test-rust:
    cargo test --workspace --all-targets
test-js:
    pnpm test

# --- Quality gates ---
lint:
    cargo clippy --workspace --all-targets -- -D warnings
    pnpm lint
format:
    cargo fmt --all
    pnpm format
format-check:
    cargo fmt --all -- --check
    pnpm exec biome ci --formatter-enabled=true --linter-enabled=false .

# Token + emoji + a11y gates (Cascade Review, §7)
gates: audit-tokens audit-emoji
audit-tokens:
    pnpm audit:tokens
audit-emoji:
    pnpm audit:emoji

# --- Icon generation ---
# Canonical master: packages/ui/src/icons/strata-app-icon.svg
# (via apps/desktop/build-icons.sh — do not regenerate launchers from mark-only SVGs)
generate-icons:
    bash apps/desktop/build-icons.sh

# Install FreeDesktop .desktop + hicolor icons for tauri:dev on Wayland/KDE
# so Plasma resolves the Strata icon instead of the Wayland logo.
install-dev-icons:
    bash apps/desktop/scripts/install-dev-icons.sh

# --- Combined pre-commit gate ---
gate: format-check lint test gates
    @echo "Cascade Review gate passed."

# --- CI/CD local tooling ---
install-git-hooks:
    node scripts/install-git-hooks.mjs

act-list:
    bash scripts/ci-local-run.sh list

act-run JOB="js" ARGS="":
    bash scripts/ci-local-run.sh run {{JOB}} {{ARGS}}

act-dry WORKFLOW=".github/workflows/build.yml":
    bash scripts/ci-local-run.sh dry-run {{WORKFLOW}}

ci-debug RUN_ID="":
    node scripts/ci-debug.mjs --run-id "{{RUN_ID}}"

# --- Packaging ---

# Build all Linux bundles (AppImage + deb + rpm). Requires Linux + Tauri deps.
package-linux:
    cd apps/desktop && pnpm tauri build --bundles appimage,deb,rpm --ci
    @echo "Bundles written to apps/desktop/src-tauri/target/release/bundle/"

# Build deb only (faster; useful for quick install testing on Debian/Ubuntu).
package-deb:
    cd apps/desktop && pnpm tauri build --bundles deb --ci

# Build AppImage only.
package-appimage:
    cd apps/desktop && pnpm tauri build --bundles appimage --ci

# Build macOS dmg (run on macOS only).
package-dmg:
    cd apps/desktop && pnpm tauri build --bundles dmg --ci

# Build Windows msi + nsis (run on Windows only).
package-windows:
    cd apps/desktop && pnpm tauri build --bundles msi,nsis --ci

# Validate AUR PKGBUILDs using Docker (requires docker; works on any OS).
# Standard AUR CI pattern: useradd non-root builder + makepkg --printsrcinfo.
aur-validate:
    docker run --rm -v "$(pwd)/dist/aur:/aur" archlinux:base-devel bash -c " \
      useradd -m builder && \
      chown -R builder:builder /aur && \
      cd /aur/strata-desktop && su -c 'makepkg --printsrcinfo' builder && echo 'source PKGBUILD OK' && \
      cd /aur/strata-desktop-bin && su -c 'makepkg --printsrcinfo' builder && echo 'bin PKGBUILD OK' \
    "

# Smoke-test AppImage on the current Linux session (Wayland or X11).
# Exits after 5 s to prevent hanging in CI.
appimage-smoke:
    #!/usr/bin/env bash
    set -euo pipefail
    _img=$(find apps/desktop/src-tauri/target/release/bundle/appimage -name '*.AppImage' | head -1)
    if [[ -z "${_img}" ]]; then echo "No AppImage found — run 'just package-appimage' first."; exit 1; fi
    chmod +x "${_img}"
    echo "Launching ${_img} for 5 s smoke test..."
    timeout 5 "${_img}" --no-sandbox || true
    echo "Smoke test complete."
