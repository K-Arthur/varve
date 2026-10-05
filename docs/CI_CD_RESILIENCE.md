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
- **Declare explicit least-privilege `permissions:` blocks** (top-level and per job). Workflows that run the API-backed failure extractor grant only `actions: read` in addition to `contents: read`; `website-deploy.yml` uses `pages: write` + `id-token: write` for GitHub Pages; `release.yml` scopes `contents: write` to the draft/publish jobs only. v4 `upload-artifact`/`download-artifact` need no `actions:` scope. Ordinary PR jobs do not receive write permissions; the trusted `ci-debug.yml` workflow-run job is the sole PR-comment writer.
- **Use `if: always()` diagnostics where timeouts/cancellations matter** in long-running workflows. The separate `ci-debug.yml` workflow covers the remaining pipelines via `workflow_run` (see the table below), checks out only the trusted default branch, and posts PR comments from that trusted checkout. A machine-readable failure manifest classifies the first useful error without turning infrastructure failures into product failures.

| Workflow | Trigger | Notes |
|---|---|---|
| `build.yml` | push, PR, manual | WASM + tauri build. On PRs the matrix collapses to Linux only and builds with `--no-bundle` (no packages are produced); full 3-OS build runs on push/manual. |
| `ci.yml` | push, PR, manual, weekly (Mon 02:00) | Staged plan/preflight → compile/unit → selected integration lanes → stable `CI / certification`; exact checked-out SHA throughout. |
| `release-candidate.yml` | manual | Frozen exact-SHA candidate matrix with triage/final modes and immutable policy-bound evidence. |
| `release.yml` | tag, manual | Exact-SHA certification preflight, then draft-then-approve packaging; checksums, SBOM, provenance, artifact verification. |
| `website-deploy.yml` | push touching website sources/data/workflow; protected `repository_dispatch` after human release publication; guarded `workflow_run` fallback; manual | Full source certification on website changes; a published release performs release-data validation plus build/deploy, not the complete website corpus again. |
| `ci-debug.yml` | `workflow_run` after a tracked workflow fails or times out, including Visual Baselines | Generates a consolidated debug report; its trusted `post-pr-comment` job updates one PR comment when the failed run came from a PR. |
| `model-validation.yml` | push/PR on model paths, weekly (Mon 08:00), manual | Manifest v3 + contract verification, ONNX graph inspection. |
| `quantize.yml` | push/PR on model paths, weekly (Mon 06:00), manual | Manifest v3 verification, quality validation, full quantization. |
| `e2e-keyboard-nav.yml` | push/PR on menu/shortcut paths, weekly, manual | Menu + canvas keyboard-nav E2E; the full 3-OS x 3-browser matrix runs on schedule/dispatch only, collapsed to 2 jobs on push/PR. |
| `ci-smoke.yml` | manual only | Single cheap ubuntu job (format-check + typecheck + lint + test + audits + workflow/pin validation) — the health probe after any infra block lifts. |
| `visual-baselines.yml` | manual only | Compares visual baselines by default; snapshot updates require explicit reviewed inputs and produce an artifact for a reviewed commit. |

## Staged CI and stable certification

`ci.yml` uses one exact-SHA `ci-plan.json` generated before dependency-heavy
jobs. `pipeline-validate` downloads that plan and runs changed-file format,
lint, and selected typechecks before the compile/unit/integration graph. A
global-impact plan selects every category rather than relying on a separate
shell regex.

The job graph is intentionally separated:

1. Stage A: plan, workflow/action/security policy, secret scan, version and
   changed-file preflight.
2. Stage B: selected JavaScript/Rust/WASM compile and unit checks.
3. Stage C: selected website, browser, native smoke, and serialization/
   integration checks.
4. Stage D: candidate/scheduled/full extended matrix.

Release publication is deliberately separate from release completion. The
Release workflow keeps the draft private until an explicit human publish, then
sends `varve-release-published` with the exact tag and SHA through
`repository_dispatch`. The website release-data job verifies that the GitHub
release is no longer a draft before it can build or deploy. The
`workflow_run` path remains as a protected fallback, but it applies the same
published-state check. A draft can therefore never appear as a published
download, and a release-only data update does not repeat the website source
functional/a11y/visual corpus.

`CI / certification` always runs after every possible required job. It accepts
only `success` or a category that the exact plan deliberately did not select;
`failure`, `cancelled`, `timed_out`, missing jobs, and selected skips fail the
check. The check name is stable and is the required-check candidate for
`master`.

To activate that contract, an administrator should open Settings → Rules →
Rulesets, select the `master` branch, require pull requests, and add the exact
check name `CI / certification` under required status checks. Keep force-push
and deletion disabled for `master` and `v*` release tags. After saving, open a
test PR and inspect the ruleset evaluation/API response to confirm the stable
check—not a dynamic matrix job—is the required check. This repository session
had no authenticated ruleset access, so those remote settings remain a human
administrator action.

## Pipeline validation guard

Every `ci.yml` run includes the `pipeline-validate` job, which first consumes
the exact plan/preflight and then runs:

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

The `Build + Package` matrix also runs the complete CI tooling suite on each
selected native OS immediately after its frozen dependency install, before
TypeScript and Rust compilation. This catches Windows command-dispatch and
macOS path-alias regressions that a Linux-only preflight cannot prove. Its
later JavaScript step runs the unchanged Vitest suite without repeating the
tooling checks; a failed native preflight stops that cell.

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
7. Prints a **Probable category** section when the collected evidence matches a
   known signature. It counts *distinct* signatures, not raw log repeats
   (reporter output, the HTML report, and every per-job download reprint the
   same failure). Categories are deliberately conservative: the screenshot
   baseline, missing/ambiguous UI control, and timeout signatures carry the
   remediation their evidence supports, and anything unrecognised stays
   uncategorised rather than being guessed at.

`ci-debug.yml` is the single report producer for tracked pipelines. It triggers
on `workflow_run` completion, so it sees every job's finalized logs; the
workflow_run checkout is the trusted default branch, which is why PR comments
are posted from there and never from the untrusted pull-request jobs.
Jobs do **not** run their own `ci-debug.mjs`. An earlier design did, and it was
both wasteful and misleading: every shard of the sharded E2E lane downloaded the
entire run's logs (16 identical copies), each copy was partial because sibling
shards were still running, and each one re-printed every other job's failures.
`ci-smoke.yml` keeps an inline report because it is a single cheap manual job
whose whole purpose is to check pipeline health in place.

The debug job receives the workflow's `${{ github.token }}` explicitly and the
workflow grants `actions: read`; this avoids a misleading empty report when the
runner has no `gh` login configured. Its `workflow_run` checkout is the
default branch precisely because the current PR checkout is untrusted, which is
how PR comments can be posted safely: the commenter is checked out from the
default branch and `issues: write` is granted to that one job only. The
`--context N` and `--max-hits N` options reduce output for large logs, for
example:

```bash
node scripts/ci-debug.mjs --run-id <RUN_ID> --context 3 --max-hits 5
```

Every debug report can also write `ci-failure-manifest.json` through
`scripts/ci/failure-manifest.mjs`. The manifest records the exact SHA, workflow
and run, profile, failed job/step, test IDs, first useful error, category,
artifacts, local reproduction command, retry suitability, and known-failure
status. Categories include product defect, test/stale assertion,
visual-review-required, timeout/resource, setup/dependency, runner/billing,
and cancellation. Cancelled jobs with recorded execution are inspected for
failures that happened before cancellation. Their original job/step conclusion
remains recorded; `terminationCategory` identifies cancellation, while
`executedFailure` and the primary category expose proven assertion, timeout,
or visual failure evidence. Clean and never-started cancellations have no
fabricated test IDs or assertion, and cancelled attempts receive neither an
automatic retry recommendation nor a governed exemption. Raw logs are
normalized and redacted before manifest serialization. Reproduction commands
target the failing spec and line through the browser lease with one worker,
or the owning compiler check; missing evidence selects the impact planner.
The probe writes `report_required` only after successful classification.
An unavailable probe leaves the decision unknown and still attempts the
report; only explicit `false` skips it. Reports use immutable artifact IDs
from an upload named for the source run and reporting run/attempt. The PR
consumer skips when no report artifact was produced.

A temporary entry in `ci-known-failures.json` must contain
an exact test ID, issue/reference, owner, platforms, creation/expiry dates,
and an expected signature; a changed signature or expired entry blocks.

Dependency caches are disposable acceleration only: a missing or corrupt cache
must never block a build. Node jobs cache the pnpm store using the committed
`pnpm-lock.yaml` hash and install with `--frozen-lockfile`; Python jobs use
`setup-python`'s pip cache keyed by `scripts/quantize/requirements.txt`; Rust
jobs use `Swatinem/rust-cache`, which separates target/toolchain state. No
compiled C/C++ output is cached in this repository; if a native CMake target is
added, cache only the package-manager/download directory and key it by runner,
compiler, architecture, and the lockfile—not `build/` or `target/` outputs.

## Failure classes seen in this repository

Measured, not theorised. Each entry is a class that has actually produced a
red run here, with the class of fix that addresses it. Use this before
reaching for a retry: retrying is a genuine fix for exactly one of these
(transient infrastructure), and for the rest it erases the evidence that would
have identified the cause.

| Class | What it looks like here | Fix that addresses it |
|---|---|---|
| Test/assertion race | A `findByRole`/`findBy*` query that races a portal or animation mount. Fixed in `Menubar.test.tsx` by awaiting the same rendered state the open menu shows — not by raising the timeout. | Wait on the real condition, not a fixed delay. |
| Environment drift (fonts) | Emoji glyphs rasterise from the host's `NotoColorEmoji.ttf`. CachyOS ships v2.051 (2024) and the Ubuntu runner ships a newer build, so the `multilingual-text` visual fixture renders visibly older OpenMoji artwork locally while staying within tolerance. | Keep that fixture's tolerance scoped to it (`tests/e2e/visual/replay.spec.ts`) and treat `visual-baselines.yml` on the runner as the only place baselines are regenerated. |
| Carrier-shape drift | A test that builds a synthetic snapshot and then asserts on imports resolving *inside* it (`workspace imports must resolve inside the exact snapshot, never the dirty checkout`). It passes locally over a stale `dist` and fails on a clean runner checkout. | Assert on the carrier the test itself constructs; do not rely on a prebuilt artifact surviving into a temp snapshot. |
| Configuration duplication drift | `pnpm/action-setup` pins `version: 11.9.0` in every job that installs dependencies (28 occurrences). Drift between those blocks versus `packageManager` changes installer behaviour between jobs with no obvious cause. | Keep one version source; if you must edit one, grep the whole tree. `scripts/validate-workflows.mjs` is the place to add a consistency assertion. |
| Cache poisoning / staleness | A cache keyed on something weaker than what actually affects compatibility serves incompatible content. pnpm caches here embed the lockfile hash in the key, which is sound; do not shorten those keys. | Key on OS, architecture, language version and lockfile hash; never restore across them. |
| Diagnostics gap | A failing job whose own log GitHub cannot serve yet renders `Job concluded as null but no log text was downloaded.` — true, unhelpful, and it reads as a data bug. Now replaced by `jobUnavailableLogText` in `scripts/ci-debug.mjs`, which names the state and the next action. | Say what is actually known and what to do next; never emit a bare `null`. |
| Untrusted metadata in trusted output | The PR commenter embeds `run.head_branch`, which is attacker-controlled for a fork PR, inside a Markdown code span posted with `issues: write`. Fixed by `sanitizeInlineCode` in `scripts/pr-debug-comment.mjs`. | Sanitise and bound before interpolation; never interpolate raw event fields into shell or Markdown. |
| Windows/macOS parity | Bash-only fixtures, path and shell assumptions that pass on Linux and fail on the other two matrix legs (`scripts/quality/execution-plan.test.mjs` uses a real POSIX signal fixture on `process.platform !== 'win32'`). | Guard platform-specific fixtures explicitly; do not let one OS's test body run on another. |
| Worktree dirt from a browser spec | A spec wrote review evidence to a path the CI lane did not sandbox, so `git status --porcelain` was non-empty when a later lane discovered its browser inventory. `browser-inventory.mjs#requireInventorySource` refuses to run on a dirty worktree, so the production-demo lane aborted *after* the E2E cases had already passed and the shard went red. Cause: `path.resolve(process.env.VARVE_E2E_OUTPUT_DIR)` — that variable is a bare directory *name* used for report grouping (`scripts/quality/playwright-run-output.mjs`), so resolving it produced `run-<pid>-<port>/` in the repository root. | Capture through `test.info().outputPath()` (already under the gitignored `test-results/<run>/`). Enforced by `tests/unit/e2e-spec-discipline.test.ts`, which fails any spec that resolves that variable into a filesystem path. |
| Dialog/navigation deadlock | `await page.waitForEvent('dialog')` followed by an awaited `page.reload()`, where the dialog is only raised *by* that navigation — neither promise can settle, so the test burns its entire timeout and the reload is cancelled (`page.reload: Test timeout ... exceeded`). The app arms a genuine `beforeunload` guard on an unsaved document (`LifecycleProvider`), which Playwright dismisses by default. | Register `page.on('dialog', ...)` **before** navigating and accept the `beforeunload` dialog there. Enforced by `tests/unit/e2e-spec-discipline.test.ts`. |

### Cross-repository context

GitHub's own measurement puts flaky-caused failures at roughly 9% of commits;
Atlassian reports 15-21% of build failures and Google about 16% of tests
showing some flakiness ([FlowVerify summary](https://www.flowverify.co/blog/flaky-tests-six-root-causes),
[Luo et al. 2014 category split](https://www.flowverify.co/blog/flaky-tests-six-root-causes)).
A large-scale GitHub Actions rerun study ([arXiv 2602.02307](https://arxiv.org/html/2602.02307v1),
1,960 Java projects) found 3.2% of builds rerun, of which 67.7% were flaky,
with flaky tests, network issues and dependency resolution the three most
prevalent categories. The practical consequence for this repository: at
~21,800 tests, a test that is individually fine 999 times in 1,000 still fails
often enough to be seen, so per-test flake rate matters more than a pipeline
pass-rate average.

`fail-on-flaky-tests` is already set on the browser gates here, and retries are
`0` on the visual and website gates. Both are deliberate: a gate that retries
its way to green cannot tell you which of the classes above you are looking at.

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
| `stuck-queued` | Still queued after 30 min. A delay observation: inspect concurrency, runner annotations, and service status before attributing an outage. |
| `never-started` | Zero steps, no billing/runner annotation. Startup cause is unknown; inspect cancellation and concurrency before diagnosing infrastructure. |
| `real-failure` | At least one step ran and failed. Needs log analysis. |

Note on GitHub's data model: jobs that never started are reported with
`conclusion: "cancelled"` and zero steps — the check-run annotation is the
**only** signal that distinguishes infra cancellation from a user/concurrency
cancel. The classifiers use the annotation, not the conclusion, to make that
call. Cancellation alone does not prove a source failure. The debug probe
records executed cancellations as `inspectionNeeded`, distinct from
`realFailures`, so their logs can establish whether tests failed earlier.
Zero-step cancellations without a confirming annotation remain unclassified.

`ci-debug.mjs` fetches check-run annotations for failed jobs and, on a billing
block, emits an **Infrastructure block detected** section at the top of the
report with the exact remediation (resolve billing at
https://github.com/settings/billing) — instead of the misleading
"no log text downloaded".

`ci-health.mjs` is the one-command pipeline health check:

```bash
just ci-health              # classify failures across the last 10 runs
just ci-health ARGS="--runs 25"
just ci-health ARGS="--workflow CI"
just ci-health ARGS="--strict"     # exit 1 when any infra block is found
just ci-health ARGS="--json"       # machine-readable
just ci-status              # GitHub Actions incident status (githubstatus.com)
just ci-rerun-stuck         # inspect long queues; does not restart active work
```

Every run of the health check classifies failed runs and prints a one-line
verdict per run (`BILLING` / `STUCK` / `INFRA` / `OK-CODE` / `OK`). The
pre-push hook queries health and service status only after a local checkpoint
failure. Both are informational and preserve that checkpoint's exit status.
A successful push starts independent remote validation; inspect its exact
accepted SHA with `just ci-health` and the run's job results.

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
just ci-health ARGS="--runs 20"       # runs show STUCK / INFRA (runner-unavailable)
```

**Response**:

1. Do NOT rerun jobs during the outage — they only re-queue. Check service
   status directly; a successful local push hook does not diagnose remote health.
2. Wait for `just ci-status` to report `operational`.
3. Inspect delayed runs:
   ```bash
   node scripts/ci-health.mjs --rerun-stuck --yes
   ```
   This lists long queues without restarting active work, including with
   `--yes`. Once a run has concluded and the external cause is resolved,
   `gh run rerun RUN_ID --failed` or `gh run rerun --job JOB_ID` retries its
   failed work at the original SHA.
4. If no run was ever queued, validate locally first with the bounded checks:
   `pnpm verify:plan`, `pnpm verify:affected`, and (before an outbound push)
   `pnpm verify:push --since origin/master`; use `just act-dry` for workflow
   graph sanity. Run the full gate only with an explicit reason.
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
  the patched archive extractor, and lockfile patch integrity; it runs
  `scripts/security/extract-zip-containment.test.mjs`, which extracts malicious
  archives against the patched module and proves an outside canary is untouched.
- `bash scripts/test-ci-shell-scripts.sh` — shell assertions on `ci-local-run.sh` dispatch, act-missing detection, secrets stub, and `bash -n` syntax for every CI shell script and git hook.
- The same shell suite rejects `act` versions below 0.2.89 and verifies that `--check` reports the Node 24 compatibility requirement.

Run them directly with:

```bash
pnpm test:ci:tools
```

`pnpm audit --prod` is the production dependency gate. The frozen pnpm graph
pins `adm-zip` 0.6.1 and `brace-expansion` v5 5.0.12. `extract-zip@2.0.1` is
locally patched to reject absolute or out-of-tree symlink targets and to
refuse writing a regular entry through an existing symlink leaf, because no
patched upstream npm release exists. The generic `pnpm audit` command may still
report that original development-only advisory because its scanner does not
evaluate local patch files; the dependency-hardening contract test and the
`extract-zip-containment` runtime test verify the effective lockfile and
containment behaviour instead of hiding the advisory.

Integration CI and release-candidate preflight run
`scripts/security/dependency-advisories.mjs`: a production npm audit against
`pnpm-lock.yaml`, then Cargo audits against both `Cargo.lock` and
`apps/desktop/src-tauri/Cargo.lock`. These are independent dependency graphs;
the Tauri/gtk-rs stack exists only in the desktop graph. Real vulnerability
findings and incomplete or failed scans block the gate unless the exact reviewed
local mitigation below is verified. The scanner retains
maintenance and glib unsoundness warnings without advisory ignores, and the
local `extract-zip` mitigation remains covered by its separate containment
test. A passing scan does not mean every upstream alert or warning is fixed.

The 0.5.0 website build also carries reviewed pnpm patches for
`http-cache-semantics@4.2.0` ([GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp))
and `braces@3.0.3` ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)).
At the recorded 2026-10-03 upstream review, neither had a published fixed version.
The patches enforce shared-cache revalidation for private cookie responses and
bound parser nesting before recursive brace processing. They preserve ordinary
cache and pattern behavior, verified through fourteen real consumer regressions.

Raw audit reports retain both HIGH findings. The separate effective result is
`locally-mitigated` only when the complete finding set and five consumer paths,
committed patch and runtime-test hashes, frozen lockfile, installed sources, and
all fourteen first-attempt regressions match. Additional findings, missing inputs,
skips, timeouts, or modified sources fail closed. Cargo scans remain independent.
The evidence includes the review timestamp and primary advisory/registry URLs;
it does not claim the upstream advisories are resolved. Replace these patches
with verified upstream fixes when available, reviewing the dependency graph and
rerunning the regressions before removing either mitigation.

## Pre-commit / pre-push hooks

The hooks are **tracked in `.githooks/`** and activated by
`core.hooksPath=.githooks`, which `pnpm install` sets through the `prepare`
script (`scripts/install-git-hooks.mjs`). Nothing is copied into `.git/hooks`.

- `pre-commit` — invokes the tested `pnpm verify:commit` driver, which runs
  staged format/lint, cheap policy audits, direct staged unit tests, and E2E
  typechecking when needed. It never starts browser, visual, native,
  benchmark, release, or full-corpus suites.
- `pre-push` — runs the exact-ref bounded checkpoint (`pnpm verify:push`); it
  never invokes the complete repository gate automatically. Remote-only lanes
  are printed and remain enforced by `CI / certification`.
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

Before pushing, run the bounded checkpoint:

```bash
pnpm verify:push
```

For impact that selects deferred lanes, the command reports exactly what CI
must certify. For a large unpublished history, push an integration branch and
open a PR; preserving all commits is supported and does not require a squash.
Use `pnpm verify:full` only as an explicitly requested local diagnostic or
candidate checkpoint, never as an automatic hook fallback.

## Concurrency, triage, and targeted reruns

- PR validation may cancel an obsolete commit because only the newest PR SHA
  is useful feedback.
- `master` certification does not cancel itself; release-candidate and release
  packaging groups never silently cancel a frozen candidate or in-flight
  release.
- Candidate `triage` mode uses bounded Playwright failures to discover a small
  set; `final` mode runs the promised matrix. Repair and rerun the affected
  lane, then certify the new SHA. Do not create an empty commit to restart a
  runner/setup failure.
- A rerun executes the original SHA and ref. A source repair requires a new
  reviewed commit and run; retrying the old run cannot test the repair.
  For an unchanged-source runner/setup failure, use `gh run rerun --job JOB_ID`
  or `gh run rerun RUN_ID --failed` after the cause is resolved. Never rerun a
  still queued or running job merely because it has waited a long time.
- Artifact names include the run attempt and matrix identity. Plan and WASM
  consumers download immutable artifact IDs from their producer outputs,
  including unchanged successful producers retained by a partial rerun.
  Execution receipts remain in separate artifact directories. Aggregation
  selects the newest receipt per matrix cell and keeps untouched earlier
  cells; a newer failure, duplicate, malformed receipt, wrong run, or wrong
  source blocks certification instead of falling back to an older success.
- Certification checks bind to the GitHub Actions app, exact SHA, workflow
  run, job or custom-check attempt, policy, and unexpired evidence artifact.
  A newer pending or failed check supersedes an older green check.
- Release platform artifacts carry exact-SHA/policy/platform sidecars. The
  resumable collector refuses missing, modified, out-of-tree, or mismatched
  artifacts and writes final checksums only after all required targets exist.
- Release collection also verifies the latest producing job through the
  GitHub API before selecting artifact IDs. A newer failed producer cannot
  supply its previous attempt's package. Publication verifies the draft's
  actual bytes, checksums, signatures, and provenance again. The website has
  an independent recovery dispatch from the verified published tag, so a
  Pages failure does not require rebuilding or republishing installers.

The incident research, demonstrated repository gaps, implemented controls,
and remaining certification boundaries are recorded in the
[CI rerun and recovery audit](audits/ci-rerun-recovery-audit-2026-10-02.md).

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
sudo pacman -S shellcheck
yay -S actionlint       # or: go install github.com/rhysd/actionlint/cmd/actionlint@latest

actionlint               # checks every workflow directly
just validate-workflows  # structure + actionlint together
```

**Install shellcheck too, not just actionlint.** actionlint shells out to
shellcheck for every `run:` block *when shellcheck is on PATH*, and silently
skips that entire class of check when it is not. GitHub runners ship
shellcheck and most dev machines do not, so actionlint without shellcheck is
quiet locally and fails in CI on the same commit — which is exactly what
happened when this gate was first added.

`validate-workflows.mjs` pins `SHELLCHECK_OPTS=--severity=warning` so local
and CI agree, and gates on warning-and-above. Style and info findings do not
fail the build: they are pre-existing here, and some are deliberate —
`release.yml` builds `TAURI_EXTRA_ARGS="--config A --config B"` and passes it
unquoted *so that it word-splits*, which SC2086 reports at info level.
Rewriting a working release pipeline to satisfy an info-level style
preference is not worth the risk. Override the threshold when you want the
full picture:

```bash
SHELLCHECK_OPTS='--severity=style' node scripts/validate-workflows.mjs
```

`.github/actionlint.yaml` declares `windows-11-arm`, a real GitHub-hosted
runner label that actionlint 1.7.7 does not know about yet. Keep that list
minimal: known noise buries real findings.

## E2E sharding

The chromium Playwright project is ~1030 tests, and `playwright.config.ts`
pins `workers` to 1 deliberately — software-rendered canvas plus on-device
model inference contend hard enough in parallel to kill an unrelated page
mid-test. Serially that does not fit in a 30-minute job, so CI shards the
project across eight jobs (`--shard=N/8`) instead of raising the worker count,
which preserves serial execution *inside* each job.

**The shard count is measured, not chosen.** A first attempt at four shards
still hit the ceiling on every leg (run 32888711333). Shard 1 was the only
one to reach its summary — 241 tests in 27.0m, about 6.7s per test — which
puts the whole project near 115 minutes of serial work. Four ways is ~29m of
tests plus ~3m of setup, exactly the limit. Eight puts each leg near 15m of
tests, leaving headroom for the retry cost of a failure rather than sitting
on the ceiling.

If the suite grows, re-derive it the same way rather than nudging the number:
take a completed shard's `N passed (Tm)` line, divide for per-test cost,
multiply by the total from `--list`, and divide by the budget you want.

Reproduce one shard exactly as CI runs it:

```bash
pnpm exec playwright test --project=chromium --shard=1/8
```

Two reporters are always configured. The `html` reporter writes only when a
run finishes and prints nothing while running, so on its own a job that hits
its wall-clock limit produces no progress, no failing-test name and no report
at all. Both `list` and `github` therefore run in CI, and `list` runs locally.

They answer different questions and neither substitutes for the other. The
`github` reporter annotates failures at their source line but prints *nothing*
for passing tests — so a shard that simply ran out of wall clock without
failing still logged nothing, which is what shards 2-4 of run 32888711333
did. `list` is what answers "how far did it get before it was killed".

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
pnpm verify:plan
pnpm verify:affected
pnpm verify:push --since origin/master
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
2. Download the `varve-e2e-report-<run_id>-shard<N>-attempt<A>` artifact; it uploads
   under `if: always()` and so survives a cancellation.
3. Reproduce that shard locally: `pnpm exec playwright test --project=chromium --shard=N/8`.

A cancelled job skips every `if: failure()` step. Use `if: always()` for
anything that must survive a timeout.

### One hanging test costs nine minutes

`retries: 2` means three attempts. A test that exhausts the 180s per-test
timeout therefore burns **9 minutes**, and Playwright shards by file rather
than by runtime, so all of that lands in a single shard. This dominates shard
balance far more than test count does.

Measured in run 32894540118 (8 shards): six shards finished in 14.7-20.2m,
and the only two containing a 180s-timeout test were the outliers — shard 7
at 26.7m (`quick.spec.ts`, since deleted: a committed debug file with no
assertions that could never pass) and shard 5 cancelled at 30.3m
(`warp.spec.ts:168`, a genuine hang).

So when a shard overruns, look for a 180s timeout before adding shards:

```bash
gh api "repos/K-Arthur/varve/actions/jobs/<job_id>/logs" \
  | grep -c 'Test timeout of 180000ms exceeded'
```

Each hit is ~9 minutes. Fixing or quarantining one such test is worth more
than doubling the shard count, because more shards cannot split a single test.

### Known failures the E2E timeout was hiding

The E2E job was cancelled at 30m on every run that executed it, which meant
several real failures downstream of that point had never once been reported.
Sharding made them visible. They are product issues, not CI issues, and are
deliberately left untriaged here rather than papered over:

| Test | Symptom |
| --- | --- |
| `tests/e2e/canvas/depth-blur.spec.ts:173` | `expect(received).toBe(expected)` — failed all three attempts, so deterministic rather than flaky |
| `tests/e2e/canvas/depth-blur.spec.ts:231` | same, depth-range mask on the image node |
| `visual/replay.spec.ts` → `node-types-1x` | 158 pixels (ratio 0.01) differ from the baseline |
| `visual/replay.spec.ts` → `multilingual-text-1x` | same class of drift |
| `tests/e2e/inspector/ownership.spec.ts:109` | failed all three attempts — deterministic |
| `tests/e2e/canvas/upscale-dialog-visual.spec.ts:20` | failed all three attempts |
| `tests/e2e/canvas/visual.spec.ts:11` | failed all three attempts |
| `tests/e2e/canvas/warp.spec.ts:168` | hangs to the 180s timeout on every attempt — ~9 min/run |
| `tests/e2e/home/empty-states.spec.ts:49` | failed once, passed on retry — genuinely flaky, not a regression |

For the visual set, do **not** simply regenerate the baselines. Review the
artifact first — `varve-visual-diff-<run_id>` contains real
baseline/current/diff images (it reported an empty manifest until the
nested-output fix), and `tests/e2e/visual/review.html` renders them.

What the diff actually shows: the rectangle, circle and ellipse are
pixel-identical, and the delta is confined to the glyph edges of the text
sample — so this is text rasterization or text layout, not shape geometry.
Both the 1x and 2x variants drift, which argues against DPR-specific
antialiasing noise.

That leaves two candidate explanations, and they need opposite fixes:

1. **Runner font drift.** The baselines were captured on `fe04a50b`
   (2026-07-25) and are compared against whatever `ubuntu-24.04` image is
   current; a freetype/fontconfig bump shifts glyph edges by a few pixels.
   Regenerating on runner infrastructure is then correct.
2. **A real change from the text-pipeline rework.** Several commits landed
   after the baselines were taken — `2e2d3ccd` (route plain replay through
   canonical layout), `fc1d63e2` (render rich spans from layout snapshots),
   `48c091b9` (key shaping cache by font revisions), `e819da58` (NBSP units,
   descending-run grouping). Any of these could legitimately move glyphs, in
   which case the baseline is stale *and* the change wants reviewing on its
   own merits.

Distinguish them by checking out `fe04a50b`'s renderer against the current
runner: identical output means (1), different output means (2).

### `toHaveScreenshot` fails with a different element size (for example 740x544 vs 690x544)

Playwright screenshots are compared pixel-exactly, and the committed baselines
must be produced by the same platform that compares them (`ubuntu-latest` plus
`pnpm exec playwright install --with-deps chromium`). A baseline regenerated on
a developer machine (CachyOS) fails on the runner even for a visually identical
UI: fontconfig/freetype differences change glyph rasterization, and any panel
sized by `max-content` changes width with them.

Symptoms that identify this class:

- the reported image sizes differ (not just a handful of pixels), or
- the diff is confined to glyph edges.

Do **not** regenerate the PNG locally and do **not** add a blanket
`maxDiffPixels` tolerance. Use the dedicated runner-side review: dispatch the
`Visual Baselines` workflow (`workflow_dispatch`, target `app-ui`, one explicit
`app_case`), run it once in comparison mode and inspect the expected/actual/diff
artifacts, then dispatch a reviewed update and commit the reviewed PNG by hand.
The workflow header documents the exact inputs; `target: website` and
`target: app-replay` follow the same compare-then-update cycle.

### Windows `Build (windows-latest)` fails in `CI tooling portability preflight`

`pnpm test:ci:tools` (the heavy-lease tests) died with
`Error [ERR_UNSUPPORTED_ESM_URL_SCHEME]: ... Received protocol 'c:'` because the
Windows cancellation preload was spawned as
`node --import C:\...\cancel-event.mjs`. Node's ESM loader requires a `file://`
URL for `--import`; a bare drive path is parsed as an unsupported URL scheme and
the child exits before it can publish its lease. Fixed in
`scripts/quality/heavy-lease.test.mjs` (`preloadArgsForPlatform` converts through
`pathToFileURL`) and guarded by an offline assertion that runs on every OS.

### A real-model E2E spec fails in CI with "did not produce a review"

Specs that need a large gitignored ONNX artifact are opt-in, exactly like
`VARVE_SAM2_REAL_MODEL` and `VARVE_GROUNDING_DINO_REAL_MODEL`. The browser lane
does not download those models, so such a spec must gate on an explicit env
opt-in; otherwise it fails on every run. Currently gated:
`tests/e2e/canvas/portrait-matting.spec.ts` via `VARVE_MODNET_REAL_MODEL`. Run it
with the MODNet artifact present:

```bash
VARVE_MODNET_REAL_MODEL=1 pnpm exec playwright test \
  tests/e2e/canvas/portrait-matting.spec.ts --project=chromium
```

Skipped cases are recorded in the browser inventory as an explained capability
gap, never as a green pass.

### A commit with obvious format or lint errors reached master

The local gate was not running. Check first:

```bash
git config --get core.hooksPath   # must print .githooks
```

Git reads hooks from `.git/hooks` **or** `core.hooksPath`, never both, so a
`core.hooksPath` set by any other tool silently disables every hook that was
copied into `.git/hooks`. Repair with `node scripts/install-git-hooks.mjs`,
and see **Do not copy hooks into `.git/hooks`** above for the full history.
