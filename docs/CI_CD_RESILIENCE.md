# CI/CD Resilience & Debugging Guide

This document describes the hardened GitHub Actions pipeline, the automated failure-debug tooling, and the local runner parity setup for the Varve monorepo.

## Resilience benchmark decisions

The current design follows the documented behavior of the platform and its
local-runner ecosystem:

- GitHub's [workflow-run REST API](https://docs.github.com/en/rest/actions/workflow-runs) provides the log archive and per-job fallback used by `ci-debug.mjs`.
- GitHub's [workflow commands](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/workflow-commands) make `GITHUB_STEP_SUMMARY` the concise human-facing failure surface; raw logs remain available as artifacts.
- `actions/setup-node` and `actions/setup-python` key package caches from committed lock/requirements files. The [dependency-caching guidance](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching) treats caches as isolated, disposable acceleration rather than build inputs.
- GitHub's [concurrency model](https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency) and matrix limits inform the per-workflow groups and `max-parallel` caps in this repository.
- `act` is useful for graph and container-local execution, but its [runner documentation](https://github.com/nektos/act-docs/blob/main/src/usage/runners.md) warns that container images are not identical to hosted runners. The wrapper therefore verifies the parser version and the CI gates remain authoritative.

The project does not need a self-hosted Kubernetes runner pool today. GitHub's
[Actions Runner Controller](https://github.com/actions/actions-runner-controller)
is the scale-set reference if hosted capacity becomes a sustained constraint;
until then, bounded matrices and cancellation avoid turning transient capacity
incidents into a repository-wide queue.

## Hardened workflows

All workflows live in `.github/workflows/` and share the following hardening rules:

- **Pin every action to a 40-char commit SHA** — no `@v4`, `@stable`, `@main`, or tool-branch refs. Supply-chain rule enforced by `scripts/pin-github-actions.mjs --check` (static) and `--verify` (network, resolves each SHA upstream).
- **Pin pnpm** to `11.9.0` (matching `packageManager` in `package.json`).
- **Use `cache-dependency-path: pnpm-lock.yaml`** for `actions/setup-node` so `pnpm` cache keys are deterministic.
- **Set `timeout-minutes`** on every job so a hung runner is killed instead of burning minutes.
- **Install `just` via `taiki-e/install-action`** (`tool: just@1.54.0`) before any `just` recipe runs — GitHub-hosted runners do not ship `just`.
- **Add `rustup target add`** steps for macOS and Windows so `tauri build` can compile on the default `macos-latest` (Apple Silicon) and `windows-latest` runners.
- **Declare explicit least-privilege `permissions:` blocks** (top-level and per job). Workflows that run the API-backed failure extractor grant only `actions: read` in addition to `contents: read`; `website-deploy.yml` uses `pages: write` + `id-token: write` for GitHub Pages; `release.yml` scopes `contents: write` to the draft/publish jobs only. v4 `upload-artifact`/`download-artifact` need no `actions:` scope.
- **Add `if: failure()` debug steps** to long-running workflows (`build.yml`, `ci-smoke.yml`, `e2e-keyboard-nav.yml` run `scripts/ci-debug.mjs` and upload a `ci-debug-report.md` artifact). The separate `ci-debug.yml` workflow covers the remaining pipelines via `workflow_run` (see the table below). The smoke workflow also runs the simulated extractor scenario, so report generation is tested before it is needed.

| Workflow | Trigger | Notes |
|---|---|---|
| `build.yml` | push, PR, manual | WASM + tauri build. On PRs the matrix collapses to Linux only and builds with `--no-bundle` (no packages are produced); full 3-OS build runs on push/manual. |
| `ci.yml` | push, PR, manual, weekly (Mon 02:00) | Rust, JS, website E2E, Playwright E2E matrix, desktop-e2e, plus `pipeline-validate` guard job. |
| `release.yml` | tag, manual | Draft-then-approve release pipeline (replaced `publish.yml`); checksums, SBOM, artifact verification. |
| `website-deploy.yml` | push touching `apps/website/**`, `scripts/release/**`, `package.json`, `pnpm-lock.yaml`, or the workflow file; `workflow_run` on Release `completed`; manual | Astro build to GitHub Pages at `https://varve.studio`. |
| `ci-debug.yml` | `workflow_run` after a tracked workflow fails or times out, including Visual Baselines | Generates a consolidated debug report. |
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
9. `node scripts/ci-debug.test.mjs` + `node scripts/test-ci-debug.mjs` + `ci-health.test.mjs` + `pin-github-actions.test.mjs` — extractor, simulated log, and pin-table regression.
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
3. Fetches workflow metadata and check-run annotations, then downloads the run log archive.
4. Falls back to the per-job logs API when the archive is expired, unavailable, or missing a job. Requests are bounded at 30 seconds so a GitHub API incident cannot hang the debug job indefinitely.
5. Extracts high-priority failure patterns (errors, panics, test failures, exit codes, `##[error]` annotations, unresolvable action refs, etc.) and redacts credential-shaped values.
6. Ignores shell source lines that merely print `::error::` templates, writes a Markdown report, appends the same report to `GITHUB_STEP_SUMMARY`, and includes local reproduction commands. Indexed archive filenames are matched to job metadata so a valid log is never mislabeled as missing.

In CI, failure-debug coverage is layered: `build.yml`, `ci-smoke.yml`, and
`e2e-keyboard-nav.yml` run `scripts/ci-debug.mjs` inline (`if: failure()`)
and upload `ci-debug-report.md`; the separate `ci-debug.yml` workflow
triggers on `workflow_run` of the tracked pipelines to produce a
consolidated report. `ci-debug.yml` is intentionally dependency-free (no
`pnpm install`) — the script uses only Node builtins, so a broken dependency
tree cannot prevent the debug report from being produced.

Inline debug steps receive the workflow's `${{ github.token }}` explicitly and
the workflow grants `actions: read`; this avoids a misleading empty report when
the runner has no `gh` login configured. The `--context N` and `--max-hits N`
options reduce output for large logs, for example:

```bash
node scripts/ci-debug.mjs --run-id <RUN_ID> --context 3 --max-hits 5
```

Dependency caches are disposable acceleration only: a missing or corrupt cache
must never block a build. Node jobs cache the pnpm store using the committed
`pnpm-lock.yaml` hash and install with `--frozen-lockfile`; Python jobs use
`setup-python`'s pip cache keyed by `scripts/quantize/requirements.txt`; Rust
jobs use `Swatinem/rust-cache`, which separates target/toolchain state. No
compiled C/C++ output is cached in this repository; if a native CMake target is
added, cache only the package-manager/download directory and key it by runner,
compiler, architecture, and the lockfile—not `build/` or `target/` outputs.

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

Install `act` 0.2.89 or newer (full job execution requires a container engine — Docker or podman). This minimum is intentional: the workflows use Node 24 actions and older `act` releases reject them during dry-run.

```bash
# Arch / CachyOS
yay -S act docker      # or paru; podman is an alternative to docker

# Or grab the latest binary from https://github.com/nektos/act/releases
```

`act --list` and `act -n` (dry-run) work **without** a container engine — they
only parse the workflows and print the job graph. The Varve wrapper checks the
minimum version before invoking either mode, so an outdated Arch package fails
with an upgrade instruction instead of an opaque `runs.using=node24` error.
`just act-list` and `just act-dry` are usable while Docker is unavailable; only
`just act-run` needs a running engine.

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
- `node scripts/security/dependency-hardening.test.mjs` — transitive security overrides,
  the patched archive extractor, and lockfile patch integrity.
- `bash scripts/test-ci-shell-scripts.sh` — shell assertions on `ci-local-run.sh` dispatch, act-missing detection, secrets stub, and `bash -n` syntax for every CI shell script and git hook.
- The same shell suite rejects `act` versions below 0.2.89 and verifies that `--check` reports the Node 24 compatibility requirement.

Run them directly with:

```bash
pnpm test:ci:tools
```

`pnpm audit --prod` is the production dependency gate. The frozen pnpm graph
pins `adm-zip` 0.6.0 and `brace-expansion` v5 5.0.9. `extract-zip@2.0.1` is
locally patched to reject absolute or out-of-tree symlink targets because no
patched upstream npm release exists. The generic `pnpm audit` command may still
report that original development-only advisory because its scanner does not
evaluate local patch files; the dependency-hardening test verifies the
effective lockfile and patch contract instead of hiding the advisory.

## Pre-commit / pre-push hooks

The hooks are **tracked in `.githooks/`** and activated by
`core.hooksPath=.githooks`, which `pnpm install` sets through the `prepare`
script (`scripts/install-git-hooks.mjs`). Nothing is copied into `.git/hooks`.

- `pre-commit` — runs `biome check --staged`, `pnpm audit:emoji`, `audit-health`, workflow validation, and — when workflow files are staged — the SHA pin `--check` and `--verify` gates.
- `pre-push` — runs the affected-first validation (`pnpm verify:affected`), or the full gate with `VARVE_FULL_GATE=1`.
- `commit-msg` — rejects AI tool attribution trailers.

Both gating hooks bail out in CI. To skip them manually, use
`git commit --no-verify` or `git push --no-verify` (not recommended for code
that will run CI).

### Do not copy hooks into `.git/hooks`

Git reads hooks from **either** `.git/hooks` **or** `core.hooksPath` — never
both. Whenever `core.hooksPath` is set, `.git/hooks` is ignored completely.

This is not hypothetical: `git lfs install` sets `core.hooksPath=.githooks`,
and the installer used to copy the hooks into `.git/hooks` regardless. Both
the pre-commit and pre-push gates were therefore silently inert, which is how
unformatted files reached master and broke `lint` on every platform in run
32847356048. Git LFS is no longer used here, and its hooks — which `exit 2`
when `git-lfs` is absent — have been removed from `.githooks/`.

Verify the gate is live at any time:

```bash
git config --get core.hooksPath        # must print .githooks
node scripts/install-git-hooks.mjs     # repairs it, idempotent
node scripts/install-git-hooks.test.mjs
```

The last command is part of `pnpm test:ci:tools`, so a hooks directory Git
does not actually read now fails the suite instead of failing silently.

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

## Workflow validation: structure and semantics

`scripts/validate-workflows.mjs` runs two different kinds of check.

1. **Structural** (always): YAML parses, required keys exist, repo-wide
   invariants such as timeouts and concurrency hold.
2. **Semantic** (`actionlint`, when installed): the checks structure cannot
   express — undefined `needs` references, bad expression types, shellcheck
   over `run:` blocks, unknown runner labels.

The second class matters because those bugs are *invisible* to YAML parsing.
An expression referencing a job that is missing from `needs` is valid YAML and
evaluates to an empty string at runtime. That is precisely how the Draft
Release notes reported blank Windows and macOS signing status for as long as
they did.

Install actionlint locally to get the semantic pass — the validator skips it
with install guidance if it is absent, and CI installs a pinned,
checksum-verified release in `pipeline-validate`:

```bash
# Arch / CachyOS
yay -S actionlint       # or: go install github.com/rhysd/actionlint/cmd/actionlint@latest

actionlint               # checks every workflow directly
just validate-workflows  # structure + actionlint together
```

`.github/actionlint.yaml` declares `windows-11-arm`, a real GitHub-hosted
runner label that actionlint 1.7.7 does not know about yet. Keep that list
minimal: known noise buries real findings.

## E2E sharding

The chromium Playwright project is ~1030 tests, and `playwright.config.ts`
pins `workers` to 1 deliberately — software-rendered canvas plus on-device
model inference contend hard enough in parallel to kill an unrelated page
mid-test. Serially that does not fit in a 30-minute job, so CI shards the
project across four jobs (`--shard=N/4`) instead of raising the worker count,
which preserves serial execution *inside* each job.

Reproduce one shard exactly as CI runs it:

```bash
pnpm exec playwright test --project=chromium --shard=1/4
```

Two reporters are always configured. The `html` reporter writes only when a
run finishes and prints nothing while running, so on its own a job that hits
its wall-clock limit produces no progress, no failing-test name and no report
at all. CI therefore also uses the `github` reporter (streams progress,
annotates failures at their source line) and local runs use `list`.

A job that exceeds `timeout-minutes` is **cancelled, not failed**, so
`if: failure()` steps are skipped. Anything needed to diagnose a timeout must
use `if: always()`.

## Notes for CachyOS / Arch Linux

The local environment matches CI closely:

- Node 26, pnpm 11.9, and Rust 1.97 are installed user-local.
- Tauri 2 system dependencies are the same as `apt` in the Ubuntu workflows because both are the WebKitGTK 4.1 / GTK3 stack.
- `act` is the recommended local runner for YAML/dependency validation before push.
- `gh` is required for the debug tools; install with `bash scripts/install-ci-tooling.sh` (also installs `act` and Docker).

## Troubleshooting

### The smoke workflow fails at `Format check`

Run the formatter against the reported files and then verify the complete tree:

```bash
pnpm exec biome check --write --formatter-enabled=true --linter-enabled=false <reported-files>
just format-check
```

The debug report points to the first real formatter annotation and ignores the
action source line that prints the annotation template.

### Linux package metadata validation fails on AppImage, deb, or rpm

`apps/desktop/src-tauri/tauri.conf.json` must map
`linux/dev.varve.desktop.metainfo.xml` to
`/usr/share/metainfo/dev.varve.desktop.metainfo.xml` under every Linux target.
Run `node scripts/release/linux-package-metadata.test.mjs` before rebuilding.

### Build fails with one shared TypeScript error on every operating system

The frontend gate runs before native compilation, so one editor typecheck
error fans out to Linux, macOS, and Windows jobs. Run the exact package
typecheck locally first (`pnpm --filter @varve/editor typecheck`), fix the
shared source/test contract, then rerun the affected plan; changing runner
matrices will not fix this class of failure.

### `just act-dry` reports `runs.using=node24`

Check the installed version:

```bash
bash scripts/install-ci-tooling.sh --check
act --version
```

Upgrade to act 0.2.89 or newer with `yay -S act`, `paru -S act`, or the binary
from `https://github.com/nektos/act/releases`. The wrapper refuses older
versions because they cannot parse the current pinned action runtimes.

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

### The E2E job is cancelled at 30 minutes with a single "Running N tests" line

The job hit `timeout-minutes`. Historically the only reporter was `html`,
which prints nothing while running and writes its report only at the end, so
a timed-out run left no progress output, no failing-test name and no report —
there was no way to tell a slow suite from one hung test.

Both are fixed (sharding + the `github` reporter, see **E2E sharding**), so if
you see this again it is a genuine regression rather than the old capacity
problem. To diagnose:

1. Read the streamed progress in the job log — the last test named is where
   it stopped.
2. Download the `varve-e2e-report-<run_id>-shard<N>` artifact; it uploads
   under `if: always()` and so survives a cancellation.
3. Reproduce that shard locally: `pnpm exec playwright test --project=chromium --shard=N/4`.

A cancelled job skips every `if: failure()` step. Use `if: always()` for
anything that must survive a timeout.

### A commit with obvious format or lint errors reached master

The local gate was not running. Check first:

```bash
git config --get core.hooksPath   # must print .githooks
```

Git reads hooks from `.git/hooks` **or** `core.hooksPath`, never both, so a
`core.hooksPath` set by any other tool silently disables every hook that was
copied into `.git/hooks`. Repair with `node scripts/install-git-hooks.mjs`,
and see **Do not copy hooks into `.git/hooks`** above for the full history.
