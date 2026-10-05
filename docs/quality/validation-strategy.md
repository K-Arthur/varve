# Varve Validation Strategy — Bounded Checkpoints and Exact-SHA Certification

Canonical policy for how Varve validates changes. This document is the
source of truth; `AGENTS.md` carries the condensed agent protocol. The measured
implementation audit is [validation-release-system-audit-2026-08-31](../audits/validation-release-system-audit-2026-08-31.md).

> **Validate according to impact, not repository size.**
> The cheapest validation capable of proving a change correct runs first;
> broader validation is selected automatically by impact and risk; the full
> repository suite is an explicit escalation/final-gate operation.

## Why

Varve is a large monorepo. Discovery at the 0.5.0 checkpoint on 2026-10-02
listed **1,903 Chromium cases in 422 specs**; the local unit gate ran 1,909
passing test files. These are measured checkpoint counts, not fixed limits.
Running the
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

Tiers describe scope, not execution order. The affected executor runs selected
audits and compiler checks first, then its remaining non-browser checks, and
browser lanes last. It preserves the selected scope. When `e2e:all` is selected,
that unfiltered app suite covers selected exact app specs, app domains, and
visual projects in one invocation; the executor prints each coverage mapping
instead of running those specs twice. Coverage succeeds only when the broader
lane passes. Website tests retain their separate configuration and both build
outputs, and `verify:quick` cannot claim coverage from an unselected Tier 4 lane.

## Four validation profiles

Tiers describe evidence depth. Profiles describe who owns the evidence and
when it is allowed to run:

| Profile | Owner | Contract |
|---------|-------|----------|
| `commit` | pre-commit | staged format/lint, cheap policy checks, and direct tests; never browser, visual, native, benchmark, or release suites |
| `push` | developer machine | exact Git pre-push refs, net-diff checks, outgoing-history security/policy scan, bounded direct tests/typechecks, and an explicit list of CI deferrals |
| `integration` | `CI / certification` | the canonical planner's selected categories for the exact checked-out SHA; required before the integration branch or `master` is accepted |
| `candidate` | `Release Candidate / certification` | a frozen exact SHA, extended cross-platform/browser/visual/native/package matrix, policy hash, and immutable evidence artifact before a release tag |

`globalImpact`, `integrationRequired`, `releaseCandidateRequired`, and
`localFullRequested` are separate fields. A global-impact plan means that
selection is broad or uncertain; it is not a failed test and does not make the
ordinary push hook run `verify:full`.

The canonical source is `scripts/quality/validation-policy.mjs`, with lane
commands in `scripts/quality/validation-lanes.mjs`. The same policy is consumed
by `affected-plan.mjs`, `push-plan.mjs`, `ci-plan.mjs`, the CI aggregator, and
candidate evidence. Every receipt/evidence record includes the policy version
and SHA-256 policy hash.

### Commit checkpoint

The staged pre-commit checkpoint is intentionally cheap and local.

### Push checkpoint

The exact-ref pre-push checkpoint is bounded and defers remote certification
lanes explicitly.

The local `@varve/editor` unit lane has a 30-minute ceiling. An exact-ref run
covering 801 editor test files took 1,528 seconds with eight workers while an
ARM64 release build was active (2026-09-24). The lane runner starts each
command in an isolated process group and terminates its descendants when the
deadline expires, so a timeout cannot leave Vitest workers running in the
background. The diffusion helper's separate C++ test and Clippy profiles are
estimated at 600 seconds each: a test build took 427 seconds, and a cold
Clippy build exceeded the 300-second local deadline on 2026-10-02. Ordinary
push explicitly defers those helper lanes to exact-SHA integration and
candidate Rust certification; other selected crate checks remain local.
The generic local deadline and 12-minute planning budget stay unchanged.
A successful local push checkpoint does not certify deferred native work.
Command supervisors also watch their original POSIX parent while executing
owned work. If that launcher exits without forwarding a signal, the supervisor
cleans up only its owned descendants and returns failure; a delivered SIGTERM
still returns 143. Keep the launcher alive for the duration of a validation
attempt. Windows command shims use the pinned adapter, native PATH delimiters,
and a fail-closed guard for batch arguments containing line breaks or NUL.
The 10K layer drop-target benchmark warms the resolver and uses
the fastest of three full sweeps; its 150ms ceiling remains unchanged.

### Integration certification

The stable remote check is authoritative for the exact integration SHA.

### Release-candidate certification

The frozen candidate check is the extended release evidence for one SHA.

## Commands

| Command | What it runs | When |
|---------|-------------|------|
| `pnpm verify:plan` | Impact plan for current changes (dry run) | Always first |
| `pnpm verify:plan --staged` | Plan for staged changes only | Before commit |
| `pnpm verify:plan --since <ref>` | Plan the committed changes in `<ref>...HEAD`; excludes staged, unstaged, and untracked files | CI/branch work |
| `pnpm verify:quick` | Tier 0 + Tier 1 (touched + direct tests) | Trivial/localized edits |
| `pnpm verify:triage` | Tiers 0–4; every selected Playwright invocation stops after five failures by default with zero retries; still runs when a final full gate is required | First discovery pass after a large integration or merge batch |
| `pnpm verify:affected` | Tiers 0–4, risk-aware | **Default inner loop for agents** |
| `pnpm verify:push` | Exact outgoing-ref push checkpoint; accepts `--pre-push`, `--since <ref>`, `--strict`, `--json`, and `--dry-run` | Normal pre-push hook |
| `pnpm workflow:status` | Read-only branch/upstream state, hook diagnosis, and recent operation summary | Before synchronization |
| `pnpm workflow:doctor` | Read-only repository workflow and hook diagnostics | Setup/troubleshooting |
| `pnpm workflow:history -- --json` | Durable local operation attempts, failures, and incomplete work | After an interrupted operation |
| `pnpm workflow:report` | Export the sanitized operation journal as JSON | Attach to review/incident evidence |
| `pnpm verify:commit` | Staged format/lint, cheap policy audits, changed unit tests, and E2E typechecking when staged | Normal pre-commit hook |
| `pnpm verify:full` | Remote full repository gate (Tier 5); same contract as `--remote` | Normal release checkpoint after hosted integration and candidate certification |
| `pnpm verify:full --local` | Explicit offline full gate with separate resumable browser shards | Deliberate local certification; no second hosted run is inferred as passed |
| `pnpm verify:full --remote` | Verify existing full exact-SHA integration and final candidate artifacts, then run the three missing local audits | Clean, committed, accepted `master`; requires the same full-gate reason |
| `pnpm verify:full --remote --status` | Inspect the same remote evidence without running audits; always returns a non-pass status | Diagnose pending, incomplete, or blocked certification |
| `pnpm verify:full --local --resume` | Resume passed local full-gate lanes and shards for the same clean candidate and unchanged inputs | Interrupted or failed local gate after repairing an external condition |
| `pnpm release:prepare <version>` | Validate clean release state, set canonical version, verify changelog, and print the proposed tag | Before a release commit |
| `pnpm release:status` | Print exact HEAD, version/changelog agreement, and current policy hash | Freeze/review a candidate |
| `pnpm release:certify -- --sha <sha> --mode final` | Print the exact remote candidate-certification request | After integration succeeds |
| `pnpm release:resume -- --dir <artifact-dir> --version <v> --sha <sha>` | Verify exact-SHA artifact sidecars and write a complete manifest only when every required platform is present | Resume a partial release |
| `just gate` | Full Cascade Review gate (kept as compatibility alias) | Human release gate |
| `just gate-full` | Same as `verify:full`, requires `VARVE_FULL_GATE_REASON` | Human-facing full gate |
| `just check-quick` / `just check-affected` | just wrappers for verify:quick/affected | just users |

Without `--since`, the planner checks staged, unstaged, and untracked work
when present; on a clean worktree it checks the branch against `origin/master`.
The explicit ref comparison is an exact committed range, so unrelated local
files do not change a branch or CI plan. A changed Playwright baseline under
`<spec>.spec.ts-snapshots/` selects E2E typechecking followed by its existing
owner spec. If that spec is absent, the planner retains the domain-wide E2E
fallback. Website spec and snapshot changes select the owning website
TypeScript check and exact spec through the separate website configuration;
website source, shared helpers and runner configuration keep the complete
website scope. Hosted CI retains the complete website suite even when a local
spec-only plan is narrow. Changes to the shared Playwright global setup select
the complete app browser suite.

`pnpm test:website:e2e` owns one heavy-task lease and builds both website outputs
fresh. Do not wrap that command in another lease. It checks both isolated ports
before building and again after acquiring the lease, rejects occupied servers,
and runs one worker with no retries or snapshot updates. Local defaults are
15991 and 15992; `VARVE_WEBSITE_E2E_PORT` and `VARVE_WEBSITE_E2E_PORT_ROOT` override
them independently. A compiler failure prevents the affected website browser
lane from starting.

The normal release path is bounded local affected validation, a normal push,
exact-SHA hosted integration, final candidate certification, then
`pnpm verify:full`. The full command defaults to the remote evidence verifier;
it never silently launches the serial browser farm when evidence is absent.
Pending remote work remains incomplete. `--local` is an explicit execution
choice for offline or native debugging and cannot be combined with `--remote`
or `--status`. Local browser shards have independent receipts so a failed
shard does not discard passed shards at unchanged inputs.

The policy currently requires 16 complete Chromium shards. Discovery and
aggregation verify their exact, disjoint case inventory; a shard count alone
cannot certify coverage. Release browser runs use no retries or snapshot
updates and stop after five failures, while complete green coverage remains
required. See [test pipeline efficiency](test-pipeline-efficiency.md) for the
measurement, isolation rules, recovery procedure, and research-backed limits
on further reuse and pruning.

The remote full gate reuses completed GitHub Actions work instead of duplicating
compiler, unit, Rust, and browser lanes locally. It requires full integration
and final candidate plans for the accepted `master` SHA, all ten categories,
the policy's complete browser shard set, every promised platform and lane,
and the current policy.
It verifies the actual immutable plan and certification archive bytes, their
digests and expiry, and the latest producer runs and attempts. A newer queued
or failed run prevents adoption of an older green check. The local complement
contains only Emoji, Health, and Architecture audits; `--resume` reuses their
unchanged receipts. Source and remote identities are checked again afterward.
This command never dispatches, reruns, tags, publishes, or deploys. Exit 2 means
pending, incomplete, or status-only; exit 3 means an external startup/API block;
executed failures and invalid evidence fail with exit 1. Each attempt is
recorded in the durable operation journal.

`pnpm workflow:status` is read-only. Its structured output distinguishes
`up-to-date`, `ahead-only`, `behind-only`, `diverged`, `missing-upstream`, and
`detached` synchronization states, then separately reports staged/index work,
unstaged work, untracked files, and in-progress merge/rebase/cherry-pick/
revert/bisect state. Use that information before choosing plain Git `fetch`,
`pull --ff-only`, an explicit merge/rebase, or a conflict abort. The workflow
tooling does not auto-stash, rewrite, pull, reset, or delete locks.

Environment overrides:

- `VARVE_TEST_WORKERS` — vitest `--maxWorkers` bound
- `VARVE_E2E_WORKERS` — playwright `--workers` bound
- `VARVE_E2E_MAX_FAILURES` — override Playwright's bounded failure count in `verify:triage`
- `VARVE_HEAVY_TASK_PARALLELISM=0` — opt out of the heavy-task lease
- `VARVE_FULL_GATE=1` / `VARVE_FULL_GATE_REASON` — permit/justify full gate
- `VARVE_PUSH_OVERRIDE_REASON="<specific reason>"` — deliberate push override;
  history/security checks still run and the reason is recorded under the common
  Git directory. It cannot bypass protected refs, release-tag provenance, or
  candidate certification.

### Push checkpoint contract

`.githooks/pre-push` is only an adapter. Git supplies every ref update on
stdin; `scripts/quality/pre-push.mjs` passes those exact updates to
`push-plan.mjs`. The driver uses argument-array Git processes and NUL-delimited
diff/log output. It computes the remote-to-local net diff for ordinary checks,
then separately scans every outgoing commit for secrets, prohibited metadata,
and oversized binary additions. Worktree files are reported as a warning and
are never included.

The exit contract is intentionally distinguishable:

- `0`: local push checkpoint passed; CI certification may still be required;
- `1`: a selected local/history check failed;
- `2`: invocation, missing-object, shallow-history, or no-safe-base error;
- `4`: protected-ref, non-fast-forward-protection, or release-provenance refusal.

The normal profile never invokes `verify:full`, complete Vitest/Cargo,
all-Playwright, visual, native multi-platform, benchmark, model-quality,
packaging, signing, or notarization lanes. If impact requires those lanes, the
hook prints them as `remoteRequired`/`deferred` and still succeeds when local
blocking checks pass. `--strict` is an explicit human request to run the
selected lanes locally.

Commit count is a workload signal, not a correctness gate. A direct push to
`master` is no longer refused merely because it contains 50 or more outgoing
commits. The hook scans the complete outgoing history once, validates each
distinct target tree in a clean disposable snapshot, and reports the exact
integration/candidate lanes that remain remote-owned. If repository rules or
the maintainer's review process require an integration branch, use one for
that policy decision—not as a workaround for a local count threshold.

Actual validation never uses dirty or partially staged files as evidence for a
committed target. The driver creates a clean detached worktree for every
distinct pushed head SHA, runs its local lanes there, and removes it after the
attempt. Dry runs remain non-mutating. A failure to create or clean a snapshot
is incomplete evidence and returns an error; it cannot become a pass.

Successful push receipts live in the common Git directory at
`.git/varve-validation/receipts/` (the common directory is used for linked
worktrees). They are reusable only for an exact set of refs, base/head SHAs,
net-file hash, outgoing-commit hash, lockfile hash, tool versions, policy
version/hash, and a maximum six-hour age. They are a local cache only and
cannot satisfy `CI / certification`, candidate certification, signing, or
provenance. A dry run never writes a receipt.

Local lane receipts in `.git/varve-validation/lane-receipts/` let a successful
`pnpm verify:push --since origin/master` serve the same commit's Git pre-push
hook, even though the two commands spell their refs differently. Lane reuse
still requires the same remote, base/head/tree SHAs, net files, outgoing
commits, lockfile, policy, tool versions, and selected lanes within six hours.
Every invocation rebuilds the push plan and rechecks protected refs, release
provenance, and complete outgoing history before reading either cache. A dry
run or emergency override neither reads nor writes reusable lane evidence.
Affected Playwright runs acquire the shared heavy-task lease and memory gate.

Full-gate attempts also record each completed lane immediately under
`.git/varve-validation/full-gate-receipts/`, with an operation journal visible
through `pnpm workflow:history`. A normal full run executes every lane anew;
`--resume` reuses a passed lane only for the same clean HEAD/tree, command,
policy, tool versions, environment digest, installed dependency metadata, and
generated WASM/model bytes within six hours. Environment values are hashed,
never stored. Dirty trees receive fresh validation without reusable receipts.
Any source edit or new commit conservatively invalidates all earlier lanes.
The WASM build records its resulting runtime bytes; later lanes require those
bytes to remain stable. A fresh failed or interrupted attempt invalidates that
lane's older pass. These receipts cannot replace exact-SHA remote integration
or release-candidate certification. After a product repair, run its exact
checks and freeze the new candidate before the final full checkpoint.

Push operation history is separate from receipts and lives at
`.git/varve-validation/operations/`. Each attempt gets a unique versioned
record; completion, failure, cancellation, and recovery are terminal states,
and stale `running` records can be marked `incomplete` with
`pnpm workflow:history -- --recover`. Records contain sanitized destinations,
ref/tree identities, selected and deferred work, per-lane outcomes, and the
fact that remote acceptance is `unobserved-pre-push`. Credentials and whole
environment dumps are never stored. History is local diagnostic evidence: it
does not pretend that a successful pre-push hook proves a remote update.

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

Full-suite verification requires a stated reason. `verify:full` exits
with code 2 (not a pass/fail) unless `VARVE_FULL_GATE=1` or
`VARVE_FULL_GATE_REASON` is set. "Just to be safe" is not a reason.

The full gate runs workspace Cargo tests and Clippy through
`scripts/cargo-with-generative-bindgen.mjs`, matching the affected Rust lanes
and desktop checks. The workspace's `vendor/bindgen` patch backports the
upstream Clang 22 forward-declaration fix while preserving the native runtime
and generated layout assertions. Its focused regressions generate and compile
C, C++, and genuine Linux stdio bindings. Both Cargo wrappers preserve caller
Clang flags and use system headers. The validation wrapper excludes
packaged-only resources during desktop `check`, `test`, and `clippy`, so keep
full-gate commands on it.

The full gate builds the baseline, SIMD, and colour WASM artifacts with
`just wasm-build-all` before browser validation, as CI does. These binaries
are ignored build output, so a clean checkout otherwise serves Vite's HTML
fallback at a `.wasm` URL and the editor silently exercises the TypeScript
stub. Browser readiness checks require a WASM MIME response as well as HTTP
200 to catch this false-positive.

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

Inspector edits also select `audit:inspector-css`, `audit:tokens`, and
`audit:spacing`; broader interface stylesheet edits select `audit:spacing`
and `audit:sizing`. Each selected lane must resolve in both the compatibility
`LANES` map and the CI `laneArgv` executor. The validation-policy tests include
inspector and interface stylesheet fixtures so local and CI planning cannot
select an unregistered audit.

## Architecture audit finding

The 0.5.0 release architecture comparison measured 75 modules with instability
above 0.9 at committed `master` SHA `dde0141d1` and in the pending interface
changes, with identical module identities. The August 25 baseline commit
`1266f7fc3` measured 50 and stores a ceiling of 55 in
`.architecture-baseline.json`; the current drawer repairs did not add to this
existing excess. Inspection of `scripts/audit-architecture.mjs --ci` found that
it enforces cycle allowlists, the global cycle limit, and layer violations,
but does not compare the reported instability or unused-export counts against
the stored `max_unstable` and `max_unused_exports` thresholds. A passing audit
therefore leaves those two metrics as reported architecture debt. The next
action is to add regression tests for both omitted threshold checks and reduce
the measured excess before enabling their enforcement. Keep the committed
ceilings unchanged; this finding does not grant a baseline increase or a
release-certification exemption.

## Multi-agent coordination

Heavy tasks (full vitest, Playwright, cargo workspace tests, desktop
builds, WASM builds, visual suites) acquire an exclusive **heavy-task
lease** keyed by the repository's common git directory, so separate
worktrees coordinate on the same lock. The lease lives under
`$XDG_RUNTIME_DIR|/tmp/varve-leases/`, carries owner PID/timestamp, waits
bounded time (default 10 min), reclaims a lease only after its owner PID
exits, and never kills unrelated processes. Elapsed time alone does not make
a live build's lease stale. Each lease has an owner ID so a
reclaimed task cannot remove its successor's lock when it eventually exits.
Opt out deliberately with `VARVE_HEAVY_TASK_PARALLELISM=0`.
Black-box tests for the lease give child processes a private
`XDG_RUNTIME_DIR`; otherwise a child launched from a leased full gate would
wait on the parent process's repository lock.

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
- A colocated unit or benchmark test change runs that file directly; source
  domain rules do not add unrelated browser or benchmark corpora. Product
  source changes still select their configured integration lanes.
- A shared E2E test-infrastructure change fans out to an entire E2E domain -> every selected
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

- Pre-commit stays cheap: staged format/lint, cheap policy audits, direct
  staged unit tests, and E2E typechecking when E2E files are staged. No
  browser, visual, native, benchmark, release, or full-suite commands.
- Pre-push runs `pnpm verify:push --pre-push <remote> <url>` by default. It
  validates the exact refs Git is about to send, remains bounded for a 200-
  commit range, and reports remote-only lanes explicitly. It never calls
  `verify:full` automatically.
- The hook queries informational CI health only when its local checkpoint
  fails. Successful pushes avoid a network health query whose result cannot
  validate the local commit or predict remote acceptance.
- A meaningful emergency override is
  `VARVE_PUSH_OVERRIDE_REASON="network outage; CI run 123 is green" git push`.
  The override is printed and appended to the common-Git local audit log; it
  is not a normal workflow and does not permit protected-ref or release-tag
  bypasses.
- `git push --no-verify` remains an emergency Git escape hatch, not a documented
  validation profile. Follow-up integration certification is still required.

## CI

`.github/workflows/ci.yml` is staged. `pipeline-validate` performs the exact-
SHA plan and fast preflight before compile/unit/integration jobs. Dynamic jobs
consume the canonical categories; extended lanes are selected for candidate,
scheduled, or explicit full profiles. The final `CI / certification` job uses
`if: always()`, accepts only successful selected jobs or deliberate skips, and
rejects failures, cancellations, timeouts, and missing evidence. Its name is
stable even when the selected job graph changes, so it is the required-check
candidate for `master`.

Each applicable job also uploads a versioned execution receipt. The receipt
records the checked-out commit and tree, plan/policy hashes, category, actual
lane, matrix identity, browser shard, runner, workflow run/attempt, command
outcome, duration, and (when the checkout is dirty) a bounded list of
redacted changed paths. This makes test-generated source changes actionable
without including file contents in CI evidence. Certification reconciles
those receipts with the plan:
all required lanes and platform cells must be present for the exact source;
missing, duplicate, stale, cancelled, failed, or unexpected receipts block the
check. The parent job conclusion remains a separate required signal. These
receipts are CI evidence only; local validation receipts remain caches and
cannot satisfy protected checks or release provenance.

`release-candidate.yml` freezes one SHA and emits
`varve-release-candidate-<sha>-<policy-hash>-run-<run_id>-attempt-<attempt>` plus a stable
`Release Candidate / certification` check. Its `triage` mode is explicitly
non-certifying and may run without a successful prior integration check so it
can collect bounded failures; only `final` produces passed candidate evidence.
`release.yml` verifies both exact-SHA checks and the policy hash before
installing large release dependencies.
CI is authoritative; local affected validation is only the unmerged feedback
loop.

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
   The same `--max-failures` limit and `--retries=0` apply to exact specs,
   domains, the whole app suite, visual lanes, and website browser validation.
   These are discovery bounds; a green bounded run does not replace the
   required final full gate or exact-SHA certification.
2. Repair each classified failure and rerun its affected compiler check,
   exact spec, and direct unit tests until they pass. Do not repeatedly rerun
   unrelated, previously green E2E domains while the candidate is still
   changing.
3. Once the candidate is frozen, run the exact-SHA candidate workflow once.
   A failed final checkpoint starts a new failure-resolution batch; target the
   failed job or lane and keep already-green exact-SHA evidence. Do not create
   an empty commit just to restart CI.

This is not a cache of old passes: every code change still receives direct
validation, and the final gates re-execute the relevant broad suite against
the exact frozen commit. It removes duplicate work without weakening release
evidence.

Ordinary app browser actions have a 45-second deadline, separate from the
180-second test budget and 10-second assertion deadline. Cold navigation and
real model inference retain their explicit longer deadlines. A missing control
must surface as an action failure rather than consuming the entire test budget
on every retry. Use zero retries for bounded discovery of deterministic
failures; retain the final gate's retry policy and review reported flaky passes.
Playwright documents these independent budgets in its
[timeout reference](https://playwright.dev/docs/test-timeouts).
