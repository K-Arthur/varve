# Strata

Local-first, cross-platform design suite. Native Rust engine on desktop (Tauri 2),
WASM behind the same facade on web.

## Quick start

```bash
pnpm install
just gate
pnpm --filter @strata/ui storybook
```

## Architecture

- **@strata/ui** — Design system tokens, APG-pattern components, icon system
- **@strata/editor** — Editor shell, canvas, layers, inspector, tools, shortcuts
- **@strata/engine** — WASM/native/stub engine facade with IR-replay renderer
- **@strata/scene** — Immutable document model with ops
- **@strata/codegen** — SVG/React/Flutter/SwiftUI code export
- **@strata/platform** — Platform abstraction (Tauri/web/memory)

## CI/CD & local debugging

The `justfile` exposes `act-list`, `act-run`, `act-dry`, `ci-debug`, and `install-git-hooks`. Pre-commit/pre-push hooks are installed automatically by `pnpm install`. For a full guide on the hardened pipelines, automated failure reports, and local `act` runner parity, see `docs/CI_CD_RESILIENCE.md`.

See AGENTS.md for detailed development guide.
