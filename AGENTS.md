# AGENTS.md — Strata

Local-first, cross-platform design suite. Native Rust engine on desktop
(Tauri 2), WASM behind the same facade on web. Linux (CachyOS/Arch) is the
primary dev OS.

## Toolchain (user-local, no sudo)
- Rust: `~/.cargo/bin` (rustc/cargo/rustfmt/clippy). Source with `. "$HOME/.cargo/env"`.
- pnpm: `~/.local/share/pnpm/bin`. Export `PNPM_HOME="$HOME/.local/share/pnpm"` and add `$PNPM_HOME/bin` to PATH.
- just: `~/.local/bin`.
- wasm32 target installed.

## Commands (run from repo root)
- `pnpm install` — install JS deps
- `just check-env` — verify toolchain on PATH
- `just test` — Rust (`cargo test --workspace`) + JS (`pnpm test` = Vitest)
- `just lint` — `cargo clippy -D warnings` + `pnpm lint` (Biome)
- `just format` — `cargo fmt` + `pnpm format`
- `just format-check` — verify formatting
- `pnpm typecheck` — `tsc --noEmit` across packages/*
- `pnpm audit:tokens` — WCAG 2.2 AA token gate (task 0.3)
- `pnpm audit:emoji` — zero-emoji gate (Strata plan §4.4)
- `just gate` — full Cascade Review gate (format-check + lint + test + audits)

## Quality gates (Cascade Review, §7) — every task must pass
TDD-first → tests green → token audit → zero emoji → axe-core zero violations
→ input-method audit (mouse/keyboard/touch/SR) → reduced-motion → 3-OS build
→ no layout thrash → assert native backend on desktop (not WASM).

## Hard rules
- No emoji anywhere (§4.4). SVG icons via Lucide `<Icon>` only.
- No hardcoded color/space/type values — trace to CSS custom properties (§6).
- TS strict, no `any` (Biome enforces `noExplicitAny: error`).
- Rust `unsafe_code = deny` workspace-wide.
- Cross-platform: if it works on macOS but not Linux, it's not done.
- Each module cites its research basis in a top-of-file comment (§0.2).

## Layout
- `crates/` — Rust (strata-core, strata-engine, strata-layout, strata-sync, strata-trace, strata-print)
- `packages/` — TS (engine, scene, layout, ui, editor, shared, collab, print, ai, codegen, plugin-sandbox)
- `apps/web` (Next.js, WASM backend), `apps/desktop` (Tauri 2, native backend)
- Packages export source TS (transpile-on-consume); `build` = `tsc --noEmit`.
