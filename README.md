# Strata

Local-first design suite for vector, layout, typography, motion, prototyping, and
print production. Runs natively on Linux, macOS, and Windows — no subscription,
no cloud dependency.

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

## License

Strata Community Edition is licensed under the **Business Source License 1.1**
(BSL 1.1), with an automatic conversion to the **MIT License** after four
years from each release. See `LICENSE` for the full terms.

"Strata" is a trademark of K-Arthur. See `TRADEMARKS.md` for usage guidelines.

Third-party component attribution is in `THIRD_PARTY_NOTICES`.
