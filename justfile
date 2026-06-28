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
    biome format --check .

# Token + emoji + a11y gates (Cascade Review, §7)
gates: audit-tokens audit-emoji
audit-tokens:
    pnpm audit:tokens
audit-emoji:
    pnpm audit:emoji

# --- Combined pre-commit gate ---
gate: format-check lint test gates
    @echo "Cascade Review gate passed."
