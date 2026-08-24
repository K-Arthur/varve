# Varve Validation Strategy — Affected-First Validation

Canonical policy for how Varve validates changes. This document is the
source of truth; `AGENTS.md` carries the condensed agent protocol.

> **Validate according to impact, not repository size.**
> The cheapest validation capable of proving a change correct runs first;
> broader validation is selected automatically by impact and risk; the full
> repository suite is an explicit escalation/final-gate operation.

## Why

Varve is a large monorepo: ~20 JS packages, ~2,900 TS/TSX source files,
~1,177 Vitest files, ~177 Playwright specs, 13 Rust crates. Running the
entire suite after every localized change consumes CPU, RAM, disk, browser
processes, CI minutes, and developer feedback latency — and the cost grows
with the repo. It is also frequently unnecessary: a change to one button
label in Settings cannot break the Rust renderer.

## The validation tiers

| Tier | Scope | Example | Target cost |
|------|-------|---------|-------------|
| 0 | Changed-file checks | format/lint on touched files, emoji audit, docs audit | seconds |
| 1 | Directly related tests | `Select.tsx` -> `Select.test.tsx` | seconds–1 min |
| 2 | Affected package validation | `packages/ui/**` -> `@varve/ui` tests + typecheck | ~1 min |
| 3 | Reverse-dependent validation | shared package change -> dependents' tests/typechecks | minutes |
| 4 | Feature/domain integration | canvas E2E, visual specs, benchmarks, desktop/native | 5–30 min |
| 5 | Full repository validation | explicit gate: `pnpm verify:full` / `just gate-full` | 30+ min |

The planner (`pnpm verify:plan`) computes which tiers apply to the current
changes. It never silently decides what to skip — it prints the plan, the
reasons, and what is deliberately skipped.

## Commands

| Command | What it runs | When |
|---------|-------------|------|
| `pnpm verify:plan` | Impact plan for current changes (dry run) | Always first |
| `pnpm verify:plan --staged` | Plan for staged changes only | Before commit |
| `pnpm verify:plan --since <ref>` | Plan against an arbitrary base | CI/branch work |
| `pnpm verify:quick` | Tier 0 + Tier 1 (touched + direct tests) | Trivial/localized edits |
| `pnpm verify:triage` | Tiers 0–4, but Playwright stops after five failures by default; still runs when a final full gate is required | First discovery pass after a large integration or merge batch |
| `pnpm verify:affected` | Tiers 0–4, risk-aware | **Default inner loop for agents** |
| `pnpm verify:full` | Full repository gate (Tier 5) | Release checkpoints, explicit request, high-risk changes |
| `just gate` | Full Cascade Review gate (kept as compatibility alias) | Human release gate |
| `just gate-full` | Same as `verify:full`, requires `VARVE_FULL_GATE_REASON` | Human-facing full gate |
| `just check-quick` / `just check-affected` | just wrappers for verify:quick/affected | just users |

Environment overrides:

- `VARVE_TEST_WORKERS` — vitest `--maxWorkers` bound
- `VARVE_E2E_WORKERS` — playwright `--workers` bound
- `VARVE_E2E_MAX_FAILURES` — override Playwright's bounded failure count in `verify:triage`
- `VARVE_HEAVY_TASK_PARALLELISM=0` — opt out of the heavy-task lease
- `VARVE_FULL_GATE=1` / `VARVE_FULL_GATE_REASON` — permit/justify full gate

## Full-suite escalation rules

The planner escalates to Tier 5 automatically when changes touch:

- Workspace/toolchain: root `package.json`, `pnpm-lock.yaml`,
  `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `justfile`,
  `Cargo.toml`, `Cargo.lock`, Vitest/Playwright configs, `wdio.conf.ts`,
  `stryker.conf.json`
- Test-runner infrastructure that can invalidate test selection:
  `vitest.setup.ts`, `vitest.mocks.ts`, `scripts/quality/**`
- Release/signing/packaging: `apps/desktop/src-tauri/tauri*.conf.json`,
  `apps/desktop/src-tauri/Cargo.toml`, `scripts/release/**`,
  `.github/workflows/**`
- High-risk dependency upgrades (React, TypeScript, Vitest, Vite,
  Playwright, Tauri, ONNX runtime, biome, pnpm)

Full-suite execution locally requires a stated reason. `verify:full` exits
with code 2 (not a pass/fail) unless `VARVE_FULL_GATE=1` or
`VARVE_FULL_GATE_REASON` is set. "Just to be safe" is not a reason.

## Impact configuration

`validation-impact.config.mjs` at the repo root holds the EXCEPTIONAL risk
rules — implicit dependencies that static analysis cannot see:

- canvas renderer -> canvas E2E + render benchmark
- Settings -> settings E2E
- design tokens -> token audit + visual smoke
- keyboard infrastructure -> keyboard E2E
- Tauri commands -> native desktop suite
- serialization -> roundtrip corpus + export E2E
- model assets -> manifest/checksum + inference tests only
- wasm boundary -> wasm check + clippy

Every rule carries a `why` and is audited for staleness
(`scripts/quality/audit-impact-config.mjs`); the audit fails CI if a rule
references paths that no longer exist or lanes that are unknown.

## Multi-agent coordination

Heavy tasks (full vitest, Playwright, cargo workspace tests, desktop
builds, WASM builds, visual suites) acquire an exclusive **heavy-task
lease** keyed by the repository's common git directory, so separate
worktrees coordinate on the same lock. The lease lives under
`$XDG_RUNTIME_DIR|/tmp/varve-leases/`, carries owner PID/timestamp, waits
bounded time (default 10 min), reclaims stale leases (dead PID or >30 min
old), and never kills unrelated processes. Opt out deliberately with
`VARVE_HEAVY_TASK_PARALLELISM=0`.

Playwright runs always use `VARVE_E2E_PORT` (unique port), isolated
browser profiles, and the per-run output directories — see
`playwright.config.ts`.

## E2E domains

E2E specs are organized by feature domain directory under `tests/e2e/`
(canvas, settings, menus, export, layers, motion, home, a11y, visual,
startup, webgpu, tauri, save, thumbnails, workspace, logo, effects,
gradient-map, model-quality, icons, inspector, intelligence, crash,
workflow, format, editor). The planner selects domains from changed
files and impact rules; you can run a domain directly with
`pnpm exec playwright test tests/e2e/<domain>`.

## Adding new packages/tests

- New package: automatically discovered from the pnpm workspace —
  nothing to register.
- New test file: discovered by glob; a sibling test of a changed source
  file is auto-selected.
- New E2E domain: add a directory under `tests/e2e/<domain>/`; optionally
  register an impact rule if source changes should trigger it.
- New impact rule: add to `validation-impact.config.mjs` with a `why`;
  the config audit enforces it is not stale.

## Troubleshooting

- `verify:affected` selects 74%+ of the repository -> the planner prints a
  machine-enforced budget WARNING (fraction of repository test files
  selected, computed by `scripts/quality/affected-plan.mjs`). Investigate:
  is a package too highly coupled? Are impact rules too broad? Did a
  shared utility become a dependency hub? (This is an architectural
  signal, not just a cost problem.)
- A changed file's test was not selected -> the test may not be colocated
  or the implicit dependency is not registered; add an impact rule.
- A test-only change fans out to an entire E2E domain -> every selected
  browser lane first runs `pnpm typecheck:e2e`, catching compiler errors
  before a browser server starts. Direct Playwright specs then run as
  `e2e:file:<path>` at Tier 1. A domain-local E2E helper broadens to that
  domain; `tests/e2e/shared.ts`, `tests/e2e/helpers/**`, and fixtures
  broaden to `e2e:all`. This is intentional: shared harness changes can
  affect every consumer even when the changed file is a test.
- Uncertain impact -> escalate conservatively. The system must answer:
  what changed? what can depend on it? which tests prove those contracts?
  what implicit integrations need extra validation? If it cannot answer
  reliably, run the full gate.

## Pre-commit / pre-push

- Pre-commit stays cheap: staged format/lint, emoji audit, health check,
  workflow validation when workflows staged. No full-suite commands.
- Pre-push runs `pnpm verify:affected` by default; `VARVE_FULL_GATE=1`
  opts into the full gate. Never silently skip validation.

## CI

`.github/workflows/ci.yml` runs the full matrix on push to main/master and
on PRs (with path filtering where configured). `workflow_dispatch` and the
scheduled `model-validation.yml` provide the periodic full-suite safety
net. CI is the authoritative full gate for merged code; local affected
validation is the feedback loop for unmerged code.

## Agent validation protocol

Every Varve agent MUST:

1. Inspect `git status` / diff.
2. Run `pnpm verify:plan`.
3. Run `pnpm verify:affected` (or `verify:quick` for trivial edits).
4. Add feature-specific E2E/visual/perf validation when the plan indicates.
5. NOT run `pnpm test`, `just gate`, full Playwright, or
   `cargo test --workspace` by default.
6. Run `pnpm verify:full` only for explicit escalation conditions
   (see above), and only with a stated reason.
7. Record exactly what was run (and what was skipped, and why).

Skipping affected tests is prohibited. Running unrelated tests is
discouraged: it consumes shared developer resources and delays feedback.

## Failure-resolution and release-candidate loop

For a large merge/integration or a release candidate, use a three-stage
loop instead of restarting a broad browser gate after every individual fix:

1. Run `pnpm verify:triage` once to discover a bounded set of independent
   failures. It deliberately continues through the affected closure when the
   planner also requires a final full gate, catching downstream type/compile
   failures before the expensive checkpoint. Preserve its log and classify
   every failure as product defect, stale assertion, or environmental failure.
2. Repair each classified failure and rerun its affected compiler check,
   exact spec, and direct unit tests until they pass. Do not repeatedly rerun
   unrelated, previously green E2E domains while the candidate is still
   changing.
3. Once the candidate is frozen, run `pnpm verify:affected` exactly once,
   then run the required release `pnpm verify:full` checkpoint. A failed
   final checkpoint starts a new failure-resolution batch.

This is not a cache of old passes: every code change still receives direct
validation, and the final gates re-execute the relevant broad suite against
the exact frozen commit. It removes duplicate work without weakening release
evidence.
