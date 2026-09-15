# Varve Desktop

Varve's native desktop application — a Tauri 2 shell hosting a Vite + React
frontend that renders the design suite's canvas, panels, and tools.

## Architecture

- **Frontend**: Vite + React + TypeScript (`src/`)
- **Native shell**: Tauri 2 (`src-tauri/`) — Rust commands for file I/O,
  document persistence (`varve-sync`), image tracing (`varve-trace`), and IPC
- **Rendering**: IR-replay — the Rust engine emits compact render IR, the webview
  replays it to Canvas2D or WebGPU. See
  `docs/architecture/render-pipeline.md`.

## Prerequisites

See `docs/development/setup.md` for the full toolchain (Rust, pnpm, system
libraries for WebKitGTK/GTK on Linux).

## Running

```bash
pnpm tauri:dev     # native Tauri window (requires toolchain from setup.md)
```

For the browser-only dev server (no native shell):

```bash
pnpm dev           # Vite dev server at http://localhost:1420
```

## Building

```bash
pnpm tauri build   # production bundle + installer
```

Packaging commands (`just package-linux`, `package-dmg`, `package-windows`)
are documented in `docs/development/setup.md` and `docs/release/`.

## Structure

| Path | Purpose |
|------|---------|
| `src/` | React frontend (Shell, EditorProvider, CanvasArea, panels) |
| `src-tauri/` | Tauri Rust shell — commands, IPC, window management |
| `public/` | Static assets, WASM, bundled models |
| `scripts/` | Dev icon install, pre-tauri hooks |

## Key docs

- `docs/architecture/render-pipeline.md` — how pixels get to the screen
- `docs/architecture/lifecycle-system.md` — quit/close/exit flow
- `docs/release/` — packaging, signing, distribution
- `docs/development/setup.md` — full setup and command reference
