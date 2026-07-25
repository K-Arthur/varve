# Strata

Local-first design suite for vector, layout, typography, motion, prototyping, and
print production. Runs natively on Linux, macOS, and Windows — no subscription,
no cloud dependency.

> Beta software. Breaking changes may occur. See [releases](https://github.com/K-Arthur/Strata/releases).

## Quick start

```bash
pnpm install
pnpm --filter @strata/ui storybook
```

See [docs/development/setup.md](docs/development/setup.md) for full setup instructions.

## Key packages

| Package | Purpose |
|---------|---------|
| `@strata/ui` | Design system tokens, APG-pattern components, icon system |
| `@strata/editor` | Editor shell, canvas, layers, inspector, tools, shortcuts |
| `@strata/engine` | WASM/native/stub engine facade with IR-replay renderer |
| `@strata/scene` | Immutable document model with ops |
| `@strata/codegen` | SVG/React/Flutter/SwiftUI code export |
| `@strata/platform` | Platform abstraction (Tauri/web/memory) |

## Architecture

Strata uses an IR (intermediate representation) replay pattern: the Rust engine
computes a scene and emits compact render IR; the webview replays it to
Canvas2D or WebGPU. See [ADR-0001](docs/adr/0001-native-render-in-tauri-webview.md)
for the rationale and [docs/architecture/render-pipeline.md](docs/architecture/render-pipeline.md)
for the full pipeline.

## Documentation

- **Setup**: [docs/development/setup.md](docs/development/setup.md)
- **Testing**: [docs/development/setup.md#testing](docs/development/setup.md#testing)
- **Architecture decisions**: [docs/adr/](docs/adr/)
- **Full index**: [docs/README.md](docs/README.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — all contributions require a DCO sign-off.

## License

Strata Community Edition is licensed under the **Functional Source License,
Version 1.1, MIT Future License** (FSL-1.1-MIT), with an automatic conversion
to the **MIT License** after two years from each release. See
[LICENSE](LICENSE) for full terms.

"Strata" is a trademark of K-Arthur. See [TRADEMARKS.md](TRADEMARKS.md) for usage guidelines.

Third-party component attribution is in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).
