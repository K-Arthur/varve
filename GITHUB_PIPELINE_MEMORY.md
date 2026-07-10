# GitHub Pipeline CI/CD Resilience Memory

> Live tracker for the CI/CD resilience & debugging engine task. Updated every turn.

## Current state
- **Repository**: `git@github.com:K-Arthur/Strata.git` (private / not accessible without auth)
- **Local machine**: CachyOS, Linux, Docker 29.6.1, Node 26.4.0, pnpm 11.9.0, cargo 1.96.0, rustc 1.96.0, just 1.54.0
- **Workflow files** (`.github/workflows/`):
  - `build.yml` — hardened Build + Package (matrix + debug + timeouts)
  - `ci.yml` — hardened CI (rust matrix + JS + E2E + debug + timeouts)
  - `publish.yml` — hardened Publish (gate + bundle + AUR + release + debug + timeouts)
  - `website-deploy.yml` — hardened Website deploy (Node 26, pnpm 11.9.0, `actions: write`)
  - `ci-debug.yml` — new `workflow_run` failure debug reporter
- **New tooling**:
  - `scripts/ci-debug.mjs` — automated failure log extractor and Markdown report generator
  - `scripts/ci-debug.test.mjs` — unit tests for failure extraction logic
  - `scripts/ci-local-run.sh` — `act` wrapper for local workflow runs
  - `scripts/install-git-hooks.mjs` — installs `.github/hooks/pre-commit` and `pre-push`
  - `.github/hooks/pre-commit` — staged `biome` check + `audit:emoji`
  - `.github/hooks/pre-push` — full `just gate`
  - `docs/CI_CD_RESILIENCE.md` and `README.md` updates
- **Tooling gaps**: `gh` CLI and `act` are now installed and authenticated.
- **Local validation**: `copy-onnx-wasm.mjs` passes, `ci-debug` extraction tests pass, `pnpm audit:emoji` and `pnpm audit:tokens` pass, `cargo fmt --check` passes, `bash -n` syntax for shell scripts passes. `pnpm typecheck` and `pnpm test` were canceled by user before completing.

## Completed fixes
1. **Workflow hardening**
   - Pinned `pnpm/action-setup` to `11.9.0` in all workflows.
   - Added `cache-dependency-path: pnpm-lock.yaml` to all `setup-node` steps.
   - Added `timeout-minutes` to every job.
   - Added `rustup target add` for macOS and Windows in `build.yml` and `publish.yml`.
   - Added `actions: write` to `website-deploy.yml` and `actions: read` to `publish.yml` release job.
   - Added `if: failure()` debug steps and artifact uploads in `build.yml`, `ci.yml`, `publish.yml`, and `website-deploy.yml`.
   - Fixed `website-deploy.yml` `pnpm install --filter` to use `pnpm --filter "@strata/website..." install --frozen-lockfile`.
   - Added `wasm-pack` cache-aware install in `ci.yml`.
2. **Automated failure-debug engine**
   - `scripts/ci-debug.mjs` resolves repo/token, downloads workflow logs, extracts failure patterns, and writes `ci-debug-report.md`.
   - `ci-debug.yml` runs on `workflow_run` failures and uploads a consolidated report.
3. **Local runner parity**
   - `scripts/ci-local-run.sh` wraps `act` for `list`, `run <job>`, and `dry-run <workflow>`.
   - `justfile` adds `act-list`, `act-run`, `act-dry`, `ci-debug`, and `install-git-hooks` recipes.
4. **Pre-commit/pre-push hooks**
   - `prepare` script installs hooks on `pnpm install` (skips CI).
   - `pre-commit` runs `biome check --staged` and `pnpm audit:emoji`.
   - `pre-push` runs `just gate`.
5. **Script robustness**
   - `scripts/copy-onnx-wasm.mjs` now resolves `onnxruntime-web/dist` from workspace package, root, or `.pnpm` store, no longer hard-coding version.

## Remaining steps
1. Install `gh` CLI and `act` locally, then authenticate with a GitHub token.
2. Run `pnpm typecheck` and `pnpm test` to completion (were canceled earlier) and address any failures.
3. Run `just act-dry .github/workflows/build.yml` to validate YAML/actions on a local runner.
4. Run `node scripts/ci-debug.mjs --run-id <latest-failure>` with a real `GITHUB_TOKEN` to confirm end-to-end log extraction.
