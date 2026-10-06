# Test pipeline efficiency and failure recovery

This document records the release checkpoint investigation and execution
changes. The [validation strategy](validation-strategy.md) remains the
canonical selection policy; the [candidate runbook](../release/release-candidate-runbook.md)
owns release operations. Research describes other systems, not Varve defects.

## Measured problem

The 0.5.0 checkpoint discovered **1,903 Chromium cases in 422 files**. The
previous eight-shard comments described roughly 1,030 cases and had become
stale. A local serial browser lane ran for about 112 minutes without finishing.
It exposed 33 failures before interruption, while screenshot producers changed
three tracked images and invalidated the frozen source. Ten preceding local
lanes had passed; an incomplete browser run never certified the release.

Test count alone is insufficient. The critical costs include cold application
transforms, slow case tails, repeated green work, implicit retries, output races,
and discovering invalid source only at the end. These are measured separately
from runner queue time and external startup failures.

## Implemented execution contract

1. **Local development:** run the affected planner and its selected closure.
   Repair each observed failure with compiler checks, direct units, and its
   exact browser spec. Unknown paths and shared infrastructure keep conservative
   broader selection. An infrastructure escalation is not permission to spend
   hours on a serial browser run before pushing the same candidate.
2. **Hosted integration:** normal pushes use bounded local checks and explicit
   remote deferrals. Complete Chromium validation uses the policy's **24
   single-worker shards**, approximately 79 cases each at the 1,907-case checkpoint.
   `fullyParallel` distributes individual cases. This reduces the nominal case
   share; it does not promise equal runtimes or a measured 24-fold speedup.
3. **Candidate:** freeze one accepted `master` SHA. Final certification requires
   its integration evidence and the candidate platform, visual, native, and
   runtime requirements. A triage report cannot certify a candidate.
4. **Full checkpoint:** `pnpm verify:full` verifies existing hosted evidence and
   runs its missing local audits. Absent evidence remains incomplete. Deliberate
   offline execution requires `--local`; browser shards have separate receipts,
   and `--local --resume` retains only unchanged, complete lanes.
5. **Failure recovery:** release browser runs have zero retries, no automatic
   snapshot updates, and retained failure traces. Triage stops after five
   failures per cell; final mode reports the complete failure set. A green run
   must execute its complete selection.
   Rerun failed hosted cells at the original SHA after diagnosing the cause.
   Source repairs require a new SHA. Aggregation uses the latest cell attempt.

## October 6 orchestration failures and repairs

The following failures were pipeline defects with concrete evidence:

| Evidence | Cause | Repair and regression coverage |
| --- | --- | --- |
| [Candidate 37453733595](https://github.com/K-Arthur/varve/actions/runs/37453733595): browser commands passed, all browser receipts failed | Final commands enabled one retry and omitted flaky-failure enforcement, contradicting receipt policy | Restore strict execution. Commands, receipt checks, and workflow guards share `browser-execution-policy.mjs`. Workflow validation rejects missing or conflicting flags before downstream browser jobs start. Negative controls cover the observed retry change and duplicate overrides. |
| [Release 37452062493](https://github.com/K-Arthur/varve/actions/runs/37452062493): preflight rejected a successful candidate | The verifier expected an Actions run URL; GitHub normalized the API-created check URL to a check ID | Bind the trusted check using its run/attempt `external_id` and validate its producer and artifact independently. Tests retain rejection of wrong source, workflow, attempt, policy, and expired evidence. |
| Existing immutable `v0.5.0` tag still executed its old verifier | Release preflight checked out product source and used its orchestration tools | A recovery dispatch pins the verifier to the dispatched workflow SHA, while the version, product bytes, certification SHA and policy remain pinned to the tag. Source-isolation guards cover preflight, the repeated gate, and package checkout. |
| [Recovery 37492438307](https://github.com/K-Arthur/varve/actions/runs/37492438307): certified-source gate timed out during Git fetch | A dependency-free policy job fetched the entire approximately 425 MB tracked source tree inside a five-minute budget | Certification and signing policy jobs use sparse checkout for their complete script dependency closure. A disposable minimal-checkout fixture executes signing resolution; package jobs retain the complete tagged source. |

Candidate planning also rejects a workflow revision different from the input
source SHA. Otherwise a newer workflow can execute settings that the frozen
source does not describe, and its producer identity cannot satisfy exact-source
certification. Freeze accepted `master` before dispatch and keep it stable while
the final candidate runs. Release recovery is separately supported because it
verifies an already-certified immutable product tag.

There is no need to delete old receipts to make a failed-job rerun pass.
Aggregation groups receipts by lane, matrix and shard, retains untouched green
cells from earlier attempts in the same run, and selects the newest execution
for each rerun cell. A newer failure cannot fall back to an older success.
Duplicate current receipts, missing inventory, or source/policy drift fail
certification. These cases have fixture regression tests in `aggregate-ci.test.mjs`.
Use `gh run rerun <run-id> --failed` after diagnosing a same-source failure;
source repairs receive a new SHA and new evidence. Do not restart the entire
matrix or prune artifacts simply because one shard failed.

Sparse checkout uses the pinned action's documented
[file selection](https://github.com/actions/checkout#fetch-only-a-single-file).
It reduces policy-job fetch inputs; hosted timing after the repair must establish
the actual gain. Product preflight initially selects release scripts, the nine
version manifests and changelog, then materializes every `POLICY_FILES` input
from the tagged policy module before hashing. A minimal-checkout fixture checks
version/changelog and proves hash equality with a complete worktree. Full Git
ancestry still verifies tag provenance; native packaging receives full source.

The first repair's [integration planner](https://github.com/K-Arthur/varve/actions/runs/37492370661)
also exhausted its five-minute deadline inside full-history Git fetch, before
running selection. Integration/candidate planning now
use a `blob:none` partial clone with full ancestry and a complete head worktree.
This avoids transferring historical binary blobs; it does not omit current
source, change path selection, or replace ancestry validation with a shallow
clone. Planning jobs allow 15 minutes for a bounded cold checkout; browser and
assertion deadlines are unchanged. Verify hosted checkout and planner timings
separately before claiming a measured speedup.

Website release-data validation has the same small-job boundary: select its
two verifier scripts and committed manifest, retain workflow/source publication
checks, and use full source for the website/demo build. Its regression fixture
executes validation from that minimal checkout, preventing a hidden dependency
from becoming another five-minute publication blocker.

## Measured cross-platform duplication

The exact-SHA `Build + Package` run on 2026-10-03 ran the same host-independent
TypeScript workspace/E2E checks, Biome lint, and complete Vitest suite in both
Ubuntu and macOS matrix cells. The two cells spent 7m11s on typechecking, 33s
on JS lint, and 46m21s on Vitest: **54m05s of duplicated runner time**. The
Linux unit lane stopped after one Menubar test failed; the macOS lane completed
the same suite successfully. A separate `CI / certification` workflow already
owns the planned JS checks for integration, and `Release Candidate` owns them
for the frozen release SHA.

`Build + Package` therefore keeps host-specific command portability checks,
Rust lint/tests, and Tauri compile/build in its OS matrix, while the canonical
CI and candidate jobs remain responsible for TypeScript, JS lint, unit tests,
and shared audits. This avoids spending native-runner time on a duplicate JS
failure and still requires the canonical JS check to pass before an accepted
integration or release candidate. The first run after this split should be
compared with the baseline by job queue time, wall time, and runner-minutes; a
change in job structure alone is not evidence of improved wall-clock latency.

Frontend build output is **not** shared between platform cells yet. Tauri hook
environment, webview target, generated WASM/model/helper assets, and the Rust
context macro all affect build inputs. Cross-cell reuse needs a same-SHA
artifact contract that verifies every relevant input and output digest, plus
an equivalence check on each target platform. A mutable cache hit or a recent
branch artifact is not proof that those inputs match.

Normal pushes also account for package size. The editor's 801-file lane had
taken 1,528 seconds with eight workers, but previously inherited a 100-second
estimate and entered a 720-second local budget. Its conservative estimate is
now 1,530 seconds. Package work exceeding the remaining budget is explicitly
remote-required; direct changed tests and cheap checks remain local. Deliberate
strict execution retains that lane and its timeout. Deferral cannot establish a
release pass: exact-source hosted coverage is still required.

Local push lanes share the browser/build lease. Its key hashes the canonical
absolute common Git directory, so the main checkout and detached validation
worktrees coordinate correctly. During migration, acquisition also reserves
legacy aliases atomically; the old `.git` alias can conservatively serialize
different repositories until older clients are retired. Nested commands must
prove descendant ownership. The bounded launcher records its original parent
identity and cleans up detached descendants on timeout, cancellation, or parent
loss, including a killed parent. A live or unverified owner is never reclaimed
because its run is old.

Discovery runs the same canonical selection with `--list`, without starting a
browser or web server. Its inventory binds case identities, selected projects,
source SHA/tree, plan hash, and policy hash. Receipts carry the inventory digest.
Aggregation rejects omitted or duplicate cases, overlapping shards, unexpected
cases, missing projects, altered inventories, runner errors, retries, incomplete
results, and entirely skipped selections. Existing optional model/hardware
boundaries need stated reasons; unexplained skips cannot silently pass.
Discovery and receipts reject dirty source. The shard count is part of the plan
hash, so eight or sixteen green jobs cannot satisfy the twenty-four-shard policy.

Normal screenshot tests write inside their own test output. Canonical product
captures require an explicit capture destination and reviewed promotion.
The coordinator sets a stable execution output name that workers inherit,
including replacement workers after a failure. Other executions get separate
directories. Port and output-name validation rejects malformed configuration.

Screenshot-only website changes now have a bounded local path. The impact
policy allowlists the website screenshot PNGs, their manifest, the matching
documentation copies, and 14 existing consumer specs. It runs website units,
the website E2E typecheck, and those consumers in one Playwright invocation, so
the two static outputs are built once. The set checks screenshot delivery,
responsive/reflow behavior, accessibility, and the feature pages that display
the captures. Missing specs or stale globs fail the impact-config audit. Any
website source/layout/runner change mixed into the same diff keeps the complete
website E2E suite. Hosted integration, candidate certification, and deployment
also retain the complete website suite. No test is quarantined or skipped
because it failed.

The reviewed 14-spec bundle selected 175 cases and took about 277 seconds on
the local release runner, compared with 652 cases and about 678 seconds for the
complete website suite (roughly 59% less observed browser time and 73% fewer
cases). This is a measured local comparison, not a hosted SLA or a guarantee
of equal setup cost on another runner. Both builds, frozen snapshots, zero
retries, a single worker, and the release-owned output checks remain in force.

The progress reporter atomically saves active cases, completed attempts, first
failure, counts, durations, errors, and status during execution. Interruption
therefore leaves usable diagnostics before the final HTML report exists.
Reporter write failures and incomplete final execution fail the run. CI feedback
adds case p50/p95, slowest cases, shard imbalance, missing evidence, and divergent
outcomes. These reports are diagnostic; they never grant certification.

## Research: gains and failure cases

| Reported problem | Application to Varve |
| --- | --- |
| Slack rebuilt unchanged frontend assets; finding coherent reusable artifacts was a separate challenge. [E2E optimization](https://slack.engineering/speedup-e2e-testing/) | Remove duplicate local/hosted execution now. Existing same-run WASM artifacts remain shared. Further frontend/candidate reuse requires complete input identity; branch names and artifact recency are insufficient. |
| Slack's thousands of blocking tests produced slow feedback, unclear ownership, and cascading service failures. [Safety and velocity](https://slack.engineering/balancing-safety-and-velocity-in-ci-cd-at-slack/) | Preserve affected local checks and hosted release coverage, report failures by case and source, and separate startup blocks from product failures. Do not copy Slack's criticality percentages without measuring Varve selection recall. |
| Google found retries could multiply failure delay and quarantine could hide races. [Flaky tests](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html?m=1) | Release retries stay zero. Retain the first failure. Divergence opens an investigation; it does not automatically waive a test. |
| GitHub's simple retry-based flake detection missed most flakes; differentiated timing/process/host investigations found more. [Flaky builds](https://github.blog/engineering/engineering-principles/reducing-flaky-builds-by-18x/) | Feedback identifies divergent outcomes but does not label every divergent case safe. Investigate state isolation, scheduling, hardware, and actual product races separately. |
| Playwright balances case/file counts rather than observed runtime, and context isolation does not isolate shared files. [Sharding](https://playwright.dev/docs/test-sharding), [parallel isolation](https://playwright.dev/docs/test-parallel) | Use single-worker hosted shards, measure timing skew, and isolate output. Complete inventory coverage proves selection; it does not prove performance balance. |
| Artifact digest mismatch can produce only a warning; caches permit partial restores. [Artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data#validating-artifacts), [caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching) | Verify actual certification bytes and hashes independently. A build cache is acceleration, never evidence of a test pass. |
| Outages can cascade through CI dependencies. [Slack circuit breakers](https://slack.engineering/circuit-breakers/) | Keep billing, never-started jobs, network/model failures, OOM, and executed regressions distinct. Preserve diagnostics and retry the affected cell only after its external condition is resolved. |

## Remaining optimizations and acceptance criteria

Complete integration-to-candidate execution adoption is **not active**. Current
certificates lack all required command, tool, environment, and generated-runtime
identities. Safe adoption must extend producers, certificate aggregation,
candidate preflight, and the remote verifier together. It must reject missing
metadata, expired artifacts, mismatched bytes, partial coverage, and newer red or
queued producer runs. Candidate-only native, platform, and visual requirements
still execute. Recheck adopted producers after candidate execution.

Likewise, replacing development-server browser tests with a shared frontend
bundle needs equivalence checks for test bridges, harness entry points, optional
models, WASM/ORT assets, and environment defines. Reusing the public demo would
test a different capability surface. Measure cold startup and build/upload costs
before enabling that change.

Use the first complete hosted run to compare setup time, test execution p50/p95,
slowest shard, runner queue time, runner-minutes, and first-failure latency.
Increase shard count only when reduced execution time outweighs repeated setup
and account concurrency limits. Move expensive assertions into lower tiers only
after proving equivalent coverage; keep real pointer, rendering, persistence,
migration, export, and security interactions blocking where their risk requires
them. Maintain explicit owners for persistent failures and an expiry for any
future approved quarantine. Selection miss measurements and a periodic full
safety net are prerequisites for further pruning.
