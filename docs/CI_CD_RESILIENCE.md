# CI/CD Resilience & Debugging Guide

This document describes the hardened GitHub Actions pipeline, the automated failure-debug tooling, and the local runner parity setup for the Strata monorepo.

## Hardened workflows

All workflows live in `.github/workflows/` and share the following hardening rules:

- **Pin every action to a 40-char commit SHA** — no `@v4`, `@stable`, `@main`, or tool-branch refs. Supply-chain rule enforced by `scripts/pin-github-actions.mjs --check` (static) and `--verify` (network, resolves each SHA upstream).
- **Pin pnpm** to `11.9.0` (matching `packageManager` in `package.json`).
- **Use `cache-dependency-path: pnpm-lock.yaml`** for `actions/setup-node` so `pnpm` cache keys are deterministic.
- **Set `timeout-minutes`** on every job so a hung runner is killed instead of burning minutes.
- **Install `just` via `taiki-e/install-action`** (`tool: just@1.54.0`) before any `just` recipe runs — GitHub-hosted runners do not ship `just`.
- **Add `rustup target add`** steps for macOS and Windows so `tauri build` can compile on the default `macos-latest` (Apple Silicon) and `windows-latest` runners.
- **Add `actions: read`/`actions: write`** permissions where needed so `download-artifact`/`upload-artifact` and GitHub Pages artifact uploads do not fail with `Resource not accessible`.
- **Use `if: failure()` debug steps** after every long/important job. The steps run `scripts/ci-debug.mjs` and upload a `ci-debug-report.md` artifact.

| Workflow | Trigger | Notes |
|---|---|---|
| `build.yml` | push, PR, manual | Build + package on Linux/macOS/Windows. |
| `ci.yml` | push, PR, manual | Rust, JS, Playwright E2E matrix, plus `pipeline-validate` guard job. |
| `release.yml` | tag, manual | Draft-then-approve release pipeline (replaced `publish.yml`); checksums, SBOM, artifact verification. |
| `website-deploy.yml` | push to `apps/website/**`, manual | Astro build to GitHub Pages. |
| `ci-debug.yml` | `workflow_run` after any workflow fails | Generates a consolidated debug report. |
| `model-validation.yml` | push/PR on model paths, weekly | Manifest v3 + contract verification, ONNX graph inspection. |
| `quantize.yml` | push/PR on model paths, weekly | Manifest v3 verification, quality validation, full quantization. |
| `e2e-keyboard-nav.yml` | push/PR on menu/shortcut paths, weekly | Menu + canvas keyboard-nav E2E on 3 OS x browsers. |

## Pipeline validation guard (new)

Every `ci.yml` run includes the `pipeline-validate` job, which:

1. `node scripts/validate-workflows.mjs` — YAML structure + real-parser syntax check.
2. `node scripts/pin-github-actions.mjs --check` — no mutable action refs.
3. `node scripts/pin-github-actions.mjs --verify` — every pinned SHA resolves upstream.
4. `node scripts/ci-debug.test.mjs` + `pin-github-actions.test.mjs` — extractor + pin-table regression.
5. `bash scripts/test-ci-shell-scripts.sh` — CI shell-script TDD assertions.

This job would have caught the 2026-08-01 outage, where every workflow was pinned to fabricated SHAs.

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
4. Extracts high-priority failure patterns (errors, panics, test failures, exit codes, `##[error]` annotations, unresolvable action refs, etc.).
5. Writes a Markdown report with failed jobs, failure snippets, and local reproduction commands.

In CI, every workflow runs `scripts/ci-debug.mjs` on failure and uploads `ci-debug-report.md`. A separate `ci-debug.yml` workflow also triggers on `workflow_run` events to produce a single consolidated report. `ci-debug.yml` is intentionally dependency-free (no `pnpm install`) — the script uses only Node builtins, so a broken dependency tree cannot prevent the debug report from being produced.

## Infrastructure blocks: billing / runner outages

The 2026-08-01..04 outage was not a code failure: GitHub refused to start any
job because the account's payment had failed. Every run failed in ~3s with
*"The job was not started because recent account payments have failed or your
spending limit needs to be increased."*

A job that never starts has **zero recorded steps** in the jobs API. `ci-debug.mjs`
and `ci-health.mjs` classify every failed job as one of:

| Class | Meaning |
|---|---|
| `billing-block` | Zero steps + check-run annotation matching the billing message. Not a code failure. |
| `never-started` | Zero steps, no billing annotation (runner outage / infra). Not a code failure. |
| `real-failure` | At least one step ran and failed. Needs log analysis. |

`ci-debug.mjs` fetches check-run annotations for failed jobs and, on a billing
block, emits an **Infrastructure block detected** section at the top of the
report with the exact remediation (resolve billing at
https://github.com/settings/billing) — instead of the misleading
"no log text downloaded".

`ci-health.mjs` is the one-command pipeline health check:

```bash
just ci-health              # classify failures across the last 10 runs
just ci-health --runs 25
just ci-health --workflow CI
just ci-health --strict     # exit 1 when any infra block is found
just ci-health --json       # machine-readable
```

Every run of the health check classifies failed runs and prints a one-line
verdict per run (`BILLING` / `INFRA` / `OK-CODE` / `OK`). The pre-push hook
runs `ci-health --quiet` and prints an informational warning when remote CI is
blocked, so a red push is never a surprise.

## Local runner parity with `act`

Install `act` (full job execution requires a container engine — Docker or podman):

```bash
# Arch / CachyOS
yay -S act docker      # or paru; podman is an alternative to docker

# Or grab the latest binary from https://github.com/nektos/act/releases
```

`act --list` and `act -n` (dry-run) work **without** a container engine — they
only parse the workflows and print the job graph. So `just act-list` and
`just act-dry` are usable even while Docker is unavailable; only `just act-run`
needs a running engine.

List workflows/jobs:

```bash
just act-list
```

Dry-run a workflow to validate YAML syntax + job graph:

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

`.act-secrets` is gitignored; never commit real tokens.

Check whether the local container engine is missing before a `just act-run`:

```bash
bash scripts/install-ci-tooling.sh --check
```

## CI tooling regression tests

The pipeline tooling is covered by TDD assertions that run as part of `pnpm test` (via `test:ci:tools`) and the `pipeline-validate` job:

- `node scripts/ci-debug.test.mjs` — failure-line detection + extraction ranking + job classification (`billing-block` / `never-started` / `real-failure`).
- `node scripts/test-ci-debug.mjs` — simulated log-scenario extraction.
- `node scripts/ci-health.test.mjs` — pipeline-health classifier aggregates.
- `node scripts/pin-github-actions.test.mjs` — pin-table integrity + fabricated-SHA regression.
- `bash scripts/test-ci-shell-scripts.sh` — 20 assertions on `ci-local-run.sh` dispatch, act-missing detection, secrets stub, and `bash -n` syntax for every CI shell script and git hook.

Run them directly with:

```bash
pnpm test:ci:tools
```

## Pre-commit / pre-push hooks

Hooks are installed automatically by `pnpm install` through the `prepare` script.

- `pre-commit` — runs `biome check --staged`, `pnpm audit:emoji`, `audit-health`, workflow validation, and — when workflow files are staged — the SHA pin `--check` and `--verify` gates.
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

If you changed any workflow, additionally run:

```bash
just validate-workflows
just pin-actions
just pin-actions-verify
just ci-tools-test
```

## Notes for CachyOS / Arch Linux

The local environment matches CI closely:

- Node 26, pnpm 11.9, and Rust 1.96 are installed user-local.
- Tauri 2 system dependencies are the same as `apt` in the Ubuntu workflows because both are the WebKitGTK 4.1 / GTK3 stack.
- `act` is the recommended local runner for YAML/dependency validation before push.
- `gh` is required for the debug tools; install with `bash scripts/install-ci-tooling.sh` (also installs `act` and Docker).

## Troubleshooting

### Every job fails in 3-5s with `The job was not started because recent account payments have failed...`

This is a GitHub account **billing block** — no job ever starts, so no code
change can fix it. Diagnose:

```bash
just ci-health        # every run shows BILLING
```

Fix: resolve the payment at https://github.com/settings/billing, then re-run
the workflow. While blocked, validate everything locally:

```bash
just gate            # full Cascade Review gate, no GitHub minutes
just act-dry .github/workflows/ci.yml   # job graph + YAML sanity
```

The pre-push hook warns about the block automatically. Do not chase red runs
as if they were code failures — the `ci-debug` report's "Infrastructure block
detected" section says so explicitly.

### `Resource not accessible by integration` on artifact upload/download

Make sure the workflow has the correct `permissions` block. Upload needs `actions: write`; download needs `actions: read` when the job sets explicit `permissions`.

### Every job dies at "Set up job" with `Unable to resolve action ... unable to find version ...`

A pinned action SHA does not exist upstream (the 2026-08-01 outage root cause). Diagnose:

```bash
node scripts/pin-github-actions.mjs --verify   # lists fabricated SHAs
node scripts/pin-github-actions.mjs --pin      # re-pins to verified SHAs
```

### `onnxruntime-web` not found during `pnpm install`

The `postinstall` script now resolves `onnxruntime-web/dist` from multiple pnpm locations (workspace package symlink, root symlink, and `.pnpm` store). If it still fails, run `pnpm install --frozen-lockfile` from the workspace root.

### `ci-debug.mjs` fails with `No GitHub token available`

Create a classic PAT with `repo` and `actions:read` scopes, or run `gh auth login`.
