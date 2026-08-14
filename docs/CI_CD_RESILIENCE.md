# CI/CD Resilience & Debugging Guide

This document describes the hardened GitHub Actions pipeline, the automated failure-debug tooling, and the local runner parity setup for the Varve monorepo.

## Hardened workflows

All workflows live in `.github/workflows/` and share the following hardening rules:

- **Pin every action to a 40-char commit SHA** — no `@v4`, `@stable`, `@main`, or tool-branch refs. Supply-chain rule enforced by `scripts/pin-github-actions.mjs --check` (static) and `--verify` (network, resolves each SHA upstream).
- **Pin pnpm** to `11.9.0` (matching `packageManager` in `package.json`).
- **Use `cache-dependency-path: pnpm-lock.yaml`** for `actions/setup-node` so `pnpm` cache keys are deterministic.
- **Set `timeout-minutes`** on every job so a hung runner is killed instead of burning minutes.
- **Install `just` via `taiki-e/install-action`** (`tool: just@1.54.0`) before any `just` recipe runs — GitHub-hosted runners do not ship `just`.
- **Add `rustup target add`** steps for macOS and Windows so `tauri build` can compile on the default `macos-latest` (Apple Silicon) and `windows-latest` runners.
- **Declare explicit least-privilege `permissions:` blocks** (top-level and per job). `website-deploy.yml` uses `pages: write` + `id-token: write` for GitHub Pages; `ci-debug.yml` uses `actions: read`; `release.yml` scopes `contents: write` to the draft/publish jobs only. v4 `upload-artifact`/`download-artifact` need no `actions:` scope, so none is granted.
- **Add `if: failure()` debug steps** to long-running workflows (`build.yml`, `ci-smoke.yml`, `e2e-keyboard-nav.yml` run `scripts/ci-debug.mjs` and upload a `ci-debug-report.md` artifact). The separate `ci-debug.yml` workflow covers the remaining pipelines via `workflow_run` (see the table below).

| Workflow | Trigger | Notes |
|---|---|---|
| `build.yml` | push, PR, manual | WASM + tauri build. On PRs the matrix collapses to Linux only and builds with `--no-bundle` (no packages are produced); full 3-OS build runs on push/manual. |
| `ci.yml` | push, PR, manual, weekly (Mon 02:00) | Rust, JS, website E2E, Playwright E2E matrix, desktop-e2e, plus `pipeline-validate` guard job. |
| `release.yml` | tag, manual | Draft-then-approve release pipeline (replaced `publish.yml`); checksums, SBOM, artifact verification. |
| `website-deploy.yml` | push touching `apps/website/**`, `scripts/release/**`, `package.json`, `pnpm-lock.yaml`, or the workflow file; `workflow_run` on Release `completed`; manual | Astro build to GitHub Pages at `https://varve.studio`. |
| `ci-debug.yml` | `workflow_run` after CI, Build + Package, Release, Website Deploy, Model Supply Chain Validation, Model Quantization & Validation, or E2E Keyboard Nav fails | Generates a consolidated debug report. |
| `model-validation.yml` | push/PR on model paths, weekly (Mon 08:00), manual | Manifest v3 + contract verification, ONNX graph inspection. |
| `quantize.yml` | push/PR on model paths, weekly (Mon 06:00), manual | Manifest v3 verification, quality validation, full quantization. |
| `e2e-keyboard-nav.yml` | push/PR on menu/shortcut paths, weekly, manual | Menu + canvas keyboard-nav E2E; the full 3-OS x 3-browser matrix runs on schedule/dispatch only, collapsed to 2 jobs on push/PR. |
| `ci-smoke.yml` | manual only | Single cheap ubuntu job (format-check + typecheck + lint + test + audits + workflow/pin validation) — the health probe after any infra block lifts. |
| `visual-baselines.yml` | manual only | Regenerates and commits the website visual-test baselines on runner infrastructure (ubuntu-latest). |

## Pipeline validation guard (new)

Every `ci.yml` run includes the `pipeline-validate` job, which:

1. `node scripts/validate-workflows.mjs` — YAML structure + real-parser syntax check.
2. `node scripts/pin-github-actions.mjs --check` — no mutable action refs.
3. `node scripts/pin-github-actions.mjs --verify` — every pinned SHA resolves upstream.
4. `node scripts/release/version.mjs verify` — version drift across the five manifests.
5. `node scripts/secret-scan.mjs` + `secret-scan.test.mjs` — tracked-tree secret scan + canary tests.
6. `node scripts/security/workflow-policy.mjs` + `workflow-policy.test.mjs` — signing-secret scoping and PR-safe release enforcement.
7. `node scripts/security/validate-client-env.mjs` (website + desktop) + regression tests — client-side env guard.
8. `node scripts/security/import-boundaries.mjs` + regression tests — package import-boundary audit.
9. `node scripts/ci-debug.test.mjs` + `ci-health.test.mjs` + `pin-github-actions.test.mjs` — extractor + pin-table regression.
10. `bash scripts/test-ci-shell-scripts.sh` — CI shell-script TDD assertions.

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

In CI, failure-debug coverage is layered: `build.yml`, `ci-smoke.yml`, and
`e2e-keyboard-nav.yml` run `scripts/ci-debug.mjs` inline (`if: failure()`)
and upload `ci-debug-report.md`; the separate `ci-debug.yml` workflow
triggers on `workflow_run` of the seven main pipelines to produce a
consolidated report. `ci-debug.yml` is intentionally dependency-free (no
`pnpm install`) — the script uses only Node builtins, so a broken dependency
tree cannot prevent the debug report from being produced.

Known gap: `visual-baselines.yml` has no failure-debug coverage (neither
inline steps nor a `ci-debug.yml` trigger entry). It is a manual, low-volume
workflow, so this is a cosmetic gap today — add its name to `ci-debug.yml`'s
`workflow_run.workflows` list if it ever starts failing regularly.

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
| `runner-unavailable` | Annotation *"The job was not acquired by Runner of type hosted even after multiple attempts"* — GitHub never assigned a hosted runner (capacity constraint / Actions outage). Not a code failure. |
| `stuck-queued` | Job or run accepted by GitHub (`started_at` set) but still `queued` > 30 min. Runner starvation during an Actions incident. Not a code failure. |
| `never-started` | Zero steps, no billing/runner annotation (runner outage / infra). Not a code failure. |
| `real-failure` | At least one step ran and failed. Needs log analysis. |

Note on GitHub's data model: jobs that never started are reported with
`conclusion: "cancelled"` and zero steps — the check-run annotation is the
**only** signal that distinguishes infra cancellation from a user/concurrency
cancel. The classifiers use the annotation, not the conclusion, to make that
call. User-cancelled runs (newer push superseding an older one via
`concurrency`) stay unclassified.

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
just ci-status              # GitHub Actions incident status (githubstatus.com)
just ci-rerun-stuck         # rerun runs stuck in queue > 30 min (asks for confirmation)
```

Every run of the health check classifies failed runs and prints a one-line
verdict per run (`BILLING` / `STUCK` / `INFRA` / `OK-CODE` / `OK`). The
pre-push hook runs `ci-health --quiet` **and** `ci-health --status --quiet` —
it prints an informational warning when remote CI is blocked or GitHub Actions
is in an incident, so a red push is never a surprise (both checks are
warning-only; they never block the push).

## Actions incident playbook (2026-08-06: major outage)

On 2026-08-06 GitHub Actions suffered a multi-hour **major outage**
(https://www.githubstatus.com, incident "Incident with Actions", impact:
critical). Symptoms in this repo:

- Runs stayed `queued` for 40 min to 2+ hours with zero steps started, then
  died with *"The job was not acquired by Runner of type hosted even after
  multiple attempts"* — on every workflow, including single-job ubuntu ones.
- Setup steps failed with `Service Unavailable` / *"Failed to resolve action
  download info"* (action-download service down).
- A `timeout-minutes: 10` job ("Manifest & contract verification") exceeded
  its budget because action resolution alone took > 10 min.

**Diagnosis** (in order):

```bash
just ci-status                 # Actions: major_outage — stop, do not re-run
just ci-health --runs 20       # runs show STUCK / INFRA (runner-unavailable)
```

**Response**:

1. Do NOT rerun jobs during the outage — they only re-queue. Do NOT push new
   commits expecting signal; the pre-push hook warns about the incident.
2. Wait for `just ci-status` to report `operational`.
3. Recover starved runs in one command:
   ```bash
   node scripts/ci-health.mjs --rerun-stuck --yes
   ```
   (lists runs queued > 30 min, then reruns each; `gh run rerun <id> --failed`
   works for concluded runs with real failures.)
4. If no run was ever queued, validate locally first: `just gate` + `just act-dry`.
5. Trigger the cheap single-job smoke workflow to confirm the pipeline is
   healthy before the full 3-OS matrix burns minutes again:
   ```bash
   gh workflow run ci-smoke.yml
   ```

**Hardening shipped after this incident:**

- `ci-health.mjs` / `ci-debug.mjs` gained `runner-unavailable` and
  `stuck-queued` classification (+ tests); `--status`, `--rerun-stuck`,
  `--probe` modes.
- `ci-debug.yml` now probes the triggering run first (`ci-debug.mjs --probe`):
  if every failure is infrastructure, it skips the debug job instead of
  adding another job to a starved runner pool.
- `e2e-keyboard-nav.yml` collapses its 12-cell matrix to 2 jobs on push/PR
  (full 3-OS x 3-browser only on schedule/dispatch).
- `ci.yml` rust and `build.yml` build matrices got `max-parallel: 2` so not
  every OS cell attempts runner acquisition simultaneously.
- `model-validation.yml` "Manifest & contract verification" timeout raised
  10 -> 25 min (headroom for slow action resolution during incidents).
- `actions/checkout` re-pinned v4.2.2 -> v6.0.3 (Node 20 -> Node 24) — kills
  the *"targets Node 20 but is being forced to run on Node 24"* deprecation
  warning on every run.
- New `ci-smoke.yml` (`workflow_dispatch`-only): single ubuntu job running
  format-check + typecheck + lint + test + audits + workflow/pin validation —
  the cheap health probe after any infra block lifts.
- Pre-push hook warns when `ci-health --status` reports a GitHub Actions
  incident.

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

- Node 26, pnpm 11.9, and Rust 1.97 are installed user-local.
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

Make sure the workflow has the correct `permissions` block for the action
being used. `actions/upload-artifact@v4` / `actions/download-artifact@v4`
need no `actions:` scope, but a job that sets an explicit `permissions:`
block must still grant the scopes its own steps use (e.g. `pages: write` +
`id-token: write` for `actions/deploy-pages`, `actions: read` for API reads
in `ci-debug.mjs`). If a job omits the block entirely, it inherits the
top-level workflow permissions.

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

### Typecheck fails on all platforms with `TS2307: Cannot find module ...` / `TS2305: no exported member`

The pushed commit contained a broken intermediate state of a feature branch
(e.g. icon-library files referenced before their restore/rename commit
landed). The failing CI commit and the local `HEAD` are different — check:

```bash
git merge-base --is-ancestor <fix-commit> <failed-ci-commit> && echo fixed || echo still-broken
```

Note that an untracked scratch file under `packages/*/src` (e.g. a
`__scratch__/probe.test.tsx` from a debugging session) breaks `pnpm typecheck`
locally even though it is never committed. Do not delete the user's active
scratch files mid-session — just verify it is untracked (`git status`) and
never stage it.

### E2E jobs fail on Windows with `ParserError: ...\temp\*.ps1:3` at the test step

The `run:` block uses bash line continuations (`\` at end of line), but the
default shell on Windows runners is PowerShell, which rejects them. Fix: add
`shell: bash` to the step. Validated by `bash scripts/test-ci-shell-scripts.sh`
for the scripts themselves; the YAML-level `shell:` fix is a manual workflow
edit.

### E2E tests die in `navigateToEditor` with `page.goto` / `.layers-panel` timeouts on the first test of a run

The editor's module graph takes ~90-100s to transform on a cold vite cache
(measured locally; CI runners are slower). Symptoms: the first test of every
spec file times out at `page.goto` or the New-button/`.layers-panel` wait
while later tests pass. Mitigations in place:

- `tests/e2e/global-setup.ts` warm-up: loads the app and clicks through to a
  real editor before any spec runs, so vite transforms the full graph once.
- `playwright.config.ts` `timeout: 180000` (was 60s — the old value capped
  every test below the measured cold first-paint).
- `tests/e2e/shared.ts` `navigateToEditor` goto timeout raised to 120s.

If the first test still fails on a warm server, check whether a parallel
process is editing `packages/scene`/`packages/engine` — vite invalidates and
re-transforms those modules mid-run, causing page reloads that reset the app
state mid-test (a concurrent agent or the user's own session). Re-run after
their edits settle.

### Menu E2E assertions fail with `toContainText` / `toBeLessThanOrEqual` on the menubar

Two historical classes, both fixed:

- Type-ahead: after an arrow key (buffer reset), a single char must restart
  the search from the first match — not cycle from the currently focused
  item. Unit-tested in `packages/ui/src/utils/menuTypeAhead.test.ts`.
- Object menu clipping: the logo geometry tools pushed the Object menu past
  the viewport-constrained max height, clipping the final command. Grouped
  under `Object > Path` (both `menu/defs.ts` and `Menubar.tsx` `buildMenus`).
  Guarded by `tests/e2e/menus/visual-integrity.spec.ts`.

