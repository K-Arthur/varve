# Validation, CI, and Release System Audit — 2026-08-31

Status: baseline, proposed architecture, implementation evidence, and remaining
administrator actions recorded for the validation/release refactor.

## Scope and safety boundary

This audit was performed on the dedicated local branch `validation-release-system`,
created from `feat/adjustment-hardening` without cleaning or changing the worktree.
The worktree was already dirty and continued to change while the audit ran. The
pre-existing UI, CSS, editor, and E2E edits are not part of this effort and must
not be formatted, reverted, staged, committed, pushed, tagged, or published by
this work.

At the first snapshot:

| Item | Observation |
| --- | --- |
| Repository | `https://github.com/K-Arthur/varve.git` |
| Default branch | `master` |
| Working branch at entry | `feat/adjustment-hardening` |
| Working branch for this effort | `validation-release-system` |
| `origin/master` | `08c0b7eb5a5c586a1257d2be145ffbd86f15207f` |
| HEAD at entry | `7f657faa1a36142b91eaeba32253dabaa04c1ac3` |
| Ahead/behind vs `origin/master` | `45/0` |
| Upstream | none configured for the working branch |
| Worktree at first snapshot | 76 tracked changes, 8 untracked files; no staged changes observed |
| Planner scope at first run | 84 files; later runs grew as concurrent edits landed |
| Local remote objects | `origin/master` and the merge-base were available |

The worktree later grew to 91 tracked and 20 untracked entries while the user’s
parallel UI work continued. Any final validation result must therefore identify
the exact files and SHA it covered rather than treating the live worktree as a
stable release candidate.

At final handoff, concurrent user work had advanced the branch to HEAD
`c0af0a9bb8f70b1f759e9f9ac9ac9969ab7433ff` (61 commits ahead of
`origin/master`, 243 committed net paths) with 55 modified tracked files and
34 untracked files in the live worktree. The push-plan dry run was rerun at
that SHA and passed in approximately 9.6 s. The implementation test results
below remain anchored to the earlier tested SHA
`cd106d097113b074af1b19e296f9e7b76df22ecf`; the newer user-owned changes were
not silently included in those test claims.

## Toolchain baseline

Captured from the local environment:

| Tool | Version / result |
| --- | --- |
| Node | `v22.23.2` |
| pnpm | `11.9.0` |
| Rust | `rustc 1.97.1 (8bab26f4f 2026-07-14)` |
| Cargo | `cargo 1.97.1 (c980f4866 2026-06-30)` |
| just | `1.58.0` |
| Playwright package | `1.62.1` |
| Platform | Linux x86_64, kernel `6.17.9-273-tkg-eev2-llvm` (CachyOS/Arch host) |
| WebKit/GTK prerequisites | documented as installed; `just check-env` was not a clean machine-readable capture because its recipe prints shell source under this runner |

## Local validation measurements

Commands were run before changing the validation system. Results include the
failure class; they are not evidence that unrelated dirty files are correct or
incorrect.

| Command | Duration | Result and first useful boundary |
| --- | ---: | --- |
| `pnpm verify:plan` | 3.5 s | Pass; 84 files, Tier 0–4 selected, full escalation `NO` |
| `pnpm verify:quick` | 86.2 s | Failed in `audit:tokens`: `tsx` could not create `/tmp/tsx-1000/228.pipe` (`listen EPERM`). Format, lint, emoji, and docs passed first. |
| `pnpm verify:affected` | 75.2 s | Failed in `format:touched` before tests; selected broad canvas/home/visual/all/benchmark lanes and reported 147% test-file coverage (391/266). |
| `pnpm exec biome check .` | 108.8 s | Failed after scanning 4,197 files: 2 errors and 22 warnings, including repository files outside the intended validation-system scope. |
| `node scripts/audit-health.mjs --ci` | 0.2 s | Failed at `spawnSync /bin/sh EPERM` after reporting current hub counts (context 76 imports, CanvasArea 37, Shell 56, Menubar 18). |
| `node scripts/audit-architecture.mjs --ci` | ~5 min bounded observation | Reported `shared: madge parse error` and `engine: madge parse error`; no complete result within the bounded observation window, terminated with Ctrl-C. |
| `pnpm typecheck` | 8m 11.0 s | Workspace packages progressed through home; editor typecheck exited 137 (resource/OOM-style termination), no ordinary type diagnostic emitted. |

At the baseline stage, before the refactor, the existing full gate’s first deterministic commands were the same broad root
Biome, emoji, health, architecture, and workspace typecheck sequence. Its heavy
tail is confirmed in `scripts/quality/verify.mjs:258-281`: CI tools, the complete
Vitest corpus, all-target Cargo tests, all-target Clippy, Chromium Playwright,
and visual regression. The full gate was not launched from this dirty worktree
at baseline; the measurements above cover its deterministic preflight without
starting its heavy tail. A later explicit full-gate run, made after the
refactor with a stated reason, is reported in the after-state section below.

## Remote CI evidence

The public Actions API was readable without a valid authenticated `gh` token for
run metadata. `gh auth status` reported the configured K-Arthur token invalid;
job logs and ruleset/protection endpoints returned 403 or were unavailable, so
no log/artifact image was downloaded or approved from this environment.

Latest relevant runs observed on 2026-08-31:

| Run | Workflow/event | SHA | Duration | Result |
| ---: | --- | --- | ---: | --- |
| 33370560082 | CI / scheduled | `08c0b7e` | 58m 53s | failure |
| 33392306102 | CI Debug Report / workflow_run | `08c0b7e` | 21 s | success |
| 33392169389 | Model Quantization & Validation / scheduled | `08c0b7e` | 1m 36s | failure |
| 33364120614 | CI / pull_request (Dependabot runtime) | `e52e9ca` | 16m 17s | success |
| 33364120639 | Build + Package / pull_request (Dependabot runtime) | `e52e9ca` | 35m 56s | success |
| 33363926053 | CI / pull_request (Dependabot naga) | `861a252` | 23m 04s | success |

Run `33370560082` job evidence:

| Job | Duration | Result |
| --- | ---: | --- |
| Change lanes | 16 s | success |
| Pipeline validation | 54 s | success |
| Website E2E (dual deployment modes) | 4m 29s | failure |
| Rust ubuntu | 10m 23s | success |
| Rust macOS | 6m 45s | success |
| Rust Windows | 11m 07s | success |
| JS | 12m 15s | failure at render-path perf gate |
| Visual regression | 3m 08s | failure |
| Native desktop Linux | 6m 25s | success |
| Native desktop macOS | 8m 46s | success |
| Native desktop Windows | 9m 41s | success |
| Playwright 1/8, 2/8, 3/8, 4/8, 7/8, 8/8 | 20m 39s–39m 50s | failure |
| Playwright 5/8, 6/8 | 40m 19s, 40m 29s | cancelled; both exhausted the 40-minute job ceiling |

Artifacts listed by the public API included Playwright reports for shards 1–8,
visual report and visual-diff manifest, and JS/E2E debug reports. The Actions
logs/artifact download endpoints require valid `actions:read` authentication in
this environment, so expected/actual/diff images were not inspected and no
baseline was changed. This is an access limitation, not a classification of
those failures as product defects.

Run `33392169389` job evidence:

| Job | Duration | Result |
| --- | ---: | --- |
| Manifest verification | 15 s | success |
| Quality validation | 35 s | failure |
| Runtime smoke (Ubuntu) | 20 s | success |
| Runtime smoke (macOS) | 23 s | success |
| Runtime smoke (Windows) | 1m 12s | success |
| Full quantization | skipped | deliberate schedule/profile skip |

The current repository therefore has real product/test/visual/performance
failures mixed with cancelled browser jobs and unavailable diagnostic logs. The
new failure manifest must preserve that distinction instead of turning all red
jobs into one generic “CI failed” state.

## Confirmed root causes in the current design

1. `.githooks/pre-push:16-27` invokes `pnpm verify:affected` under `set -e`.
2. `scripts/quality/verify.mjs:315-319` exits 2 when `plan.full` is true,
   even though that condition means “remote/full certification is required,”
   not “a selected local test failed.”
3. `scripts/quality/affected-plan.mjs:60-83` mixes worktree/staged/untracked
   files into normal scope and `:67` constructs a shell command string from a
   ref. It does not consume Git’s exact pre-push ref stream.
4. The current planner reports full escalation, but the hook has no distinct
   push profile and no stable receipt identity.
5. `validation-impact.config.mjs` and `ci.yml` encode overlapping path policy;
   CI’s `changes` job uses shell regexes at `.github/workflows/ci.yml:58-82`,
   while local selection uses JavaScript glob/dependency logic.
6. `ci.yml` has no stable `CI / certification` aggregator. Dynamic jobs can be
   skipped or cancelled without one required, always-run final evidence check.
7. `ci.yml:pipeline-validate` has no `needs: changes`, so expensive jobs can
   start before the cheap pipeline gate establishes that the commit is valid.
8. `release.yml:178-252` repeats broad ordinary validation on the tag even when
   the exact source SHA may already have passed integration checks. It has no
   exact integration/candidate receipt verification before dependency-heavy
   packaging.
9. `website-deploy.yml:52-123` reruns full website tests and both deployment
   mode E2E paths on a successful Release `workflow_run`, even when only
   release data/download links changed.
10. Existing CI diagnostics classify billing/runner starvation, but they do not
    emit the requested per-test failure manifest or known-failure governance.

## Proposed architecture

The refactor will retain the existing cheap commit gate and explicit full gate,
but separate four profiles:

| Profile | Authority | Ordinary expensive lanes |
| --- | --- | --- |
| Commit checkpoint | local pre-commit | staged format/lint, cheap policy, direct tests |
| Push checkpoint | local pre-push | exact outgoing net diff + history scan, bounded affected package checks; reports remote deferrals and exits 0 when local blockers pass |
| Integration certification | required CI check | canonical plan for the exact commit; selected compile/unit/integration lanes and stable `CI / certification` aggregation |
| Release-candidate certification | frozen exact SHA | extended cross-platform/browser/visual/native/packaging compatibility matrix, signed machine-readable evidence |

The data flow is:

```text
commit checkpoint
       │
       ▼
Git pre-push stdin ──> exact ref/range driver ──> push-plan.json + receipt
       │                                      ├─ local blocking lanes
       │                                      └─ remote required/deferred lanes
       ▼
ordinary branch / integration PR ──> canonical CI plan ──> staged jobs
                                             │              └─ CI / certification
                                             ▼
                                   frozen exact master SHA
                                             │
                                             ▼
                              release-candidate certification
                                             │ exact SHA + policy hash
                                             ▼
                                    immutable release tag
                                             │
                                             ▼
                    release preflight → resumable platform builds → verify
                                             │                         │
                                             └─ draft release ──────────┘
                                                       │ human publish
                                                       ▼
                             release-data-only website deploy + live smoke
```

Implementation constraints:

- Git input is parsed as four fields per line and all Git subprocesses use
  argument arrays; file lists are NUL-delimited and chunked.
- Net validation uses the remote SHA supplied by Git, while every outgoing
  commit is separately checked for secrets, prohibited message trailers, large
  blobs, and release metadata risks.
- A local receipt lives in the common Git directory and is reusable only when
  base/head refs, changed/outgoing hashes, lockfile, policy, tool versions, and
  age all match.
- The pre-push hook stays a small CI bypass/stdin adapter and never calls
  `verify:full` automatically.
- Release packaging refuses to start without exact-SHA integration and
  candidate certification; platform artifacts are resumable only when their
  source SHA, toolchain, configuration, and signing-policy identity match.
- No tags, settings, secrets, releases, deployments, or remote branches are
  created or changed by this effort.

## Measurement gaps to close during implementation

- authenticated job logs, traces, screenshots, and visual diffs for runs
  `33370560082` and `33392169389`;
- repository rulesets and required checks (administrator API access is needed);
- exact current release packaging durations per platform and website deployment
  duration;
- candidate matrix duration after the new staged graph is in place.

These gaps will be reported as deferred or access-blocked evidence rather than
filled with assumptions.

## Implemented after-state and measured results

The refactor was implemented on the local branch `validation-release-system`.
No remote branch, tag, release, deployment, secret, or repository setting was
changed. The implementation is intentionally usable before an administrator
updates the GitHub ruleset.

The four boundaries are now concrete:

- `scripts/quality/commit-checkpoint.mjs` owns the staged, bounded pre-commit
  checks; `.githooks/pre-commit` is a thin adapter.
- `scripts/quality/push-plan.mjs` consumes Git's exact pre-push ref stream,
  computes the remote-to-head net diff, and separately scans every outgoing
  commit. `scripts/quality/pre-push.mjs` executes only the bounded local lanes,
  reports remote deferrals, and writes exact-identity receipts.
- `scripts/quality/validation-policy.mjs` is the shared policy consumed by
  local planning, CI planning, aggregation, and candidate evidence.
- `.github/workflows/ci.yml`, `release-candidate.yml`, and `release.yml` now
  separate staged integration certification, frozen candidate certification,
  and release-specific packaging/trust work. `website-deploy.yml` has a
  publication dispatch path guarded by the non-draft release state.

Measured commands after implementation:

| Command | Result | Duration / evidence |
| --- | --- | --- |
| `VARVE_PUSH_DRY_RUN=1 pnpm verify:push --since origin/master` | pass | approximately 9.4 s at the implementation snapshot; 59 outgoing commits, 226 net paths; full/remote lanes were listed, not run |
| `node scripts/quality/commit-checkpoint.test.mjs` | pass | direct driver regression |
| `pnpm test:ci:tools` | pass | approximately 34.2 s in the final run; all CI, planner, receipt, release, security, hook, and shell-tool tests |
| targeted `pnpm exec biome check …` | pass | 86 implementation/test files, approximately 65 s including process startup |
| `pnpm exec vitest run tests/unit/validationPolicy.test.ts --maxWorkers=1` | pass | 45/45 tests, approximately 1.5 s |
| mobile browser E2E for `try-demo.spec.ts` | pass | 1/1, approximately 46 s; readiness signal and mobile drawer semantics |
| `node scripts/audit-health.mjs --ci` | pass | current hub/complexity baseline within enforced ceilings |
| `node scripts/audit-architecture.mjs --ci` | pass | approximately 3m10s; 15 dependency cycles under the ceiling of 19; zero layer violations and unused exports |
| `pnpm audit:docs`, `pnpm audit:emoji`, `pnpm audit:tokens` | pass | docs/link, zero-emoji, and 3-theme token gates clean |
| workflow/pin/security/impact audits | pass | 11 workflow files pinned; policy and impact audits clean |

The mandatory affected planner recognized the intentional validation-system
scope and printed `FULL-SUITE ESCALATION: YES`. `pnpm verify:affected` exited
with its documented status 2 because the current repository changes include
workspace/toolchain and validation infrastructure; this is an escalation
signal, not a failed local test. An explicit `pnpm verify:full` run was made
with a stated reason. All format, audits, package typechecks, E2E typecheck,
CI tools, and Rust/JavaScript pre-test gates passed. The full Vitest corpus was
the first failing stage: 13 files, 56 tests failed, 1,409 files passed and 5
were skipped in approximately 792.6 s. The failures are the existing UI
assertion/snapshot set listed in the baseline section; no snapshots or visual
baselines were regenerated.

The implementation planner snapshot covered 107 live worktree paths and selected
`@varve/desktop`, `@varve/editor`, `@varve/engine`, and `@varve/ui`; it still
prints full escalation because the worktree contains validation/toolchain
changes. At the implementation measurement (HEAD `cd106d097113b074af1b19e296f9e7b76df22ecf`),
the exact outgoing-range dry run against `origin/master` covered one ref, 59
commits, and 226 net paths with policy hash
`de02557bde73edfc492624df33fc0b31286574a493f6201505c4a847c48cfe74`. It
completed in approximately 9.4 s and listed the deferred lanes without
running them. The final policy/tool regression chain completed in
approximately 34.2 s. The live worktree at report time contained 73 modified
tracked files and 34 untracked files; those unstaged files are not part of the
exact outgoing-commit checkpoint.

Critical-path interpretation:

- The historical master run `33370560082` took approximately 58m53s and let
  browser shards start alongside failures in website E2E, JavaScript, visual,
  and browser jobs. The new CI graph gates expensive jobs behind exact-SHA
  planning and preflight, and finishes with one stable `CI / certification`
  check. A post-change remote duration is not measurable until this branch is
  authorized and pushed.
- The local 200-commit dry run is bounded by the final net diff and history
  scan; it did not invoke complete Vitest, Cargo, Playwright, visual, native,
  benchmark, model, packaging, or release lanes. Warm receipt reuse is exact
  identity only and has not been used to claim remote certification.
- Candidate and platform-resume critical paths remain unmeasured because no
  candidate was tagged or packaged. The workflow now prevents packaging from
  starting until exact integration and candidate evidence exists, and a
  platform artifact can be reused only with matching SHA, policy, toolchain,
  platform, and byte digest sidecars.
- The post-change remote CI critical path, candidate matrix duration, release
  packaging duration, and website deploy duration remain unmeasured because
  this branch was not pushed and no release/deployment was authorized.

## Failure classification and unresolved access

The current red set is not one defect. The full-gate UI failures are classified
as product/test assertion debt pending owner review: shell-region and portaled
Inspector queries, stale option assertions, and snapshots. The historical
browser failures are classified as mixed product/test/visual candidates;
their expected, actual, diff, trace, and job logs could not be downloaded.
Cancelled shards are cancellation/resource-orchestration evidence, not proof
of a product regression. Model quality run `33392169389` has a distinct
quality-validation failure while manifest and runtime smoke passed. The
machine-readable `scripts/ci/failure-manifest.mjs` plus
`ci-known-failures.json` now preserve exact IDs, signatures, artifacts,
reproduction commands, retry suitability, ownership, and expiry rather than
using blanket `continue-on-error`.

The public GitHub API was sufficient to record workflow IDs and job outcomes,
but the available `gh` credential was invalid for authenticated logs,
artifacts, repository rulesets, and required-check inspection. No remote
mutation was attempted. An administrator must inspect and then require the
stable `CI / certification` check for `master`, separately protect release
tags, and grant the minimum Actions/Pages/attestation permissions already
declared in the workflows. The exact UI/API procedure is documented in
`docs/CI_CD_RESILIENCE.md` and `docs/release/release-candidate-runbook.md`.

## Rollback and recovery

The implementation is additive and local until reviewed. To stop using the
new branch, return to the prior branch without rewriting or cleaning the
worktree. To recover a failed push checkpoint, fetch the missing comparison
object, rerun the exact `pnpm verify:push --since <ref>`, and inspect the plan
artifact under the common Git directory. To recover a release, do not retag:
rerun the failed platform job, verify its exact-SHA provenance sidecar, then
run `pnpm release:resume ...`; the final manifest refuses mixed or incomplete
artifacts. Draft releases remain private until an explicit human publish.
