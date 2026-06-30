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

See AGENTS.md for detailed development guide.
