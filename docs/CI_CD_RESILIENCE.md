# CI/CD Resilience & Debugging Guide

This document describes the hardened GitHub Actions pipeline, the automated failure-debug tooling, and the local runner parity setup for the Strata monorepo.

## Hardened workflows

All workflows live in `.github/workflows/` and share the following hardening rules:

- **Pin pnpm** to `11.9.0` (matching `packageManager` in `package.json`).
- **Use `cache-dependency-path: pnpm-lock.yaml`** for `actions/setup-node` so `pnpm` cache keys are deterministic.
- **Set `timeout-minutes`** on every job so a hung runner is killed instead of burning minutes.
- **Add `rustup target add`** steps for macOS and Windows so `tauri build` can compile on the default `macos-latest` (Apple Silicon) and `windows-latest` runners.
- **Add `actions: read`/`actions: write`** permissions where needed so `download-artifact`/`upload-artifact` and GitHub Pages artifact uploads do not fail with `Resource not accessible`.
- **Use `if: failure()` debug steps** after every long/important job. The steps run `scripts/ci-debug.mjs` and upload a `ci-debug-report.md` artifact.

| Workflow | Trigger | Notes |
|---|---|---|
| `build.yml` | push, PR, manual | Build + package on Linux/macOS/Windows. |
| `ci.yml` | push, PR, manual | Rust, JS, and Playwright E2E matrix. |
| `publish.yml` | tag, manual | Quality gate, platform bundles, AUR validation, release. |
| `website-deploy.yml` | push to `apps/website/**`, manual | Astro build to GitHub Pages. |
| `ci-debug.yml` | `workflow_run` after any workflow fails | Generates a consolidated debug report. |

## Automated failure-debug report

`scripts/ci-debug.mjs` is the failure-debug engine. It can be run locally:

```bash
# Latest failed run in the current repo
pnpm ci:debug

# Specific run
node scripts/ci-debug.mjs --run-id <RUN_ID> --output report.md

# JSON output
node scripts/ci-debug.mjs --run-id <RUN_ID> --json
```

The script:

1. Resolves the repo from `GITHUB_REPOSITORY` or `git remote get-url origin`.
2. Uses `GITHUB_TOKEN` or `gh auth token` for GitHub API auth.
3. Fetches the workflow run metadata and the per-job logs archive.
4. Extracts high-priority failure patterns (errors, panics, test failures, exit codes, etc.).
5. Writes a Markdown report with failed jobs, failure snippets, and local reproduction commands.

In CI, every workflow now runs `scripts/ci-debug.mjs` on failure and uploads `ci-debug-report.md`. A separate `ci-debug.yml` workflow also triggers on `workflow_run` events to produce a single consolidated report.

## Local runner parity with `act`

Install `act` (requires Docker):

```bash
# Arch / CachyOS
yay -S act

# Or grab the latest binary from https://github.com/nektos/act/releases
```

List workflows/jobs:

```bash
just act-list
```

Dry-run a workflow to validate YAML syntax:

```bash
just act-dry .github/workflows/build.yml
```

Run a specific job locally:

```bash
# Run the JS job
just act-run js

# Run a specific job with extra act flags
just act-run js --secret-file .act-secrets
```

Create `.act-secrets` for workflows that need a `GITHUB_TOKEN`:

```bash
cat > .act-secrets <<EOF
GITHUB_TOKEN=ghp_...
EOF
```

## Pre-commit / pre-push hooks

Hooks are installed automatically by `pnpm install` through the `prepare` script.

- `pre-commit` — runs `biome check --staged` and `pnpm audit:emoji` on staged files.
- `pre-push` — runs `just gate` (format-check, lint, tests, token/emoji audits).

Both hooks bail out in CI. If you want to skip them manually, use `git commit --no-verify` or `git push --no-verify` (not recommended for code that will run CI).

## Failure-prevention checklist

Before pushing, run:

```bash
just gate
```

This runs `format-check`, `lint`, `test`, and `gates` (token/emoji audits). If this passes, the CI matrix is highly likely to pass.

For a quick syntax/dependency check against the actual GitHub Actions runner image:

```bash
just act-dry .github/workflows/build.yml
```

## Notes for CachyOS / Arch Linux

The local environment matches CI closely:

- Node 26, pnpm 11.9, and Rust 1.96 are installed user-local.
- Tauri 2 system dependencies are the same as `apt` in the Ubuntu workflows because both are the WebKitGTK 4.1 / GTK3 stack.
- `act` is the recommended local runner for YAML/dependency validation before push.

## Troubleshooting

### `Resource not accessible by integration` on artifact upload/download

Make sure the workflow has the correct `permissions` block. Upload needs `actions: write`; download needs `actions: read` when the job sets explicit `permissions`.

### `onnxruntime-web` not found during `pnpm install`

The `postinstall` script now resolves `onnxruntime-web/dist` from multiple pnpm locations (workspace package symlink, root symlink, and `.pnpm` store). If it still fails, run `pnpm install --frozen-lockfile` from the workspace root.

### `ci-debug.mjs` fails with `No GitHub token available`

Create a classic PAT with `repo` and `actions:read` scopes, or run `gh auth login`.
