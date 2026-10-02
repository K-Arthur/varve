# CI rerun, supply-chain, and release recovery audit

Date: 2026-10-02. Scope: integration CI, release candidates, packaging,
diagnostics, and release-bound website publication for the 0.5.0 checkpoint.
This records verified external incidents as design leads and distinguishes
them from defects demonstrated in Varve. It is not evidence that Varve was
compromised or experienced those organizations' incidents.

## External failures and the controls they informed

| Primary evidence | Relevant failure | Varve finding and response |
| --- | --- | --- |
| [GitHub artifact issue 506](https://github.com/actions/upload-artifact/issues/506), reported January 2024; [artifact action contract](https://github.com/actions/upload-artifact) | Parallel uploads can conflict even with overwrite enabled; artifacts have immutable identities. | CI and candidate artifact names omitted attempt identity; desktop debug uploads also omitted the OS matrix identity. Add both identities, retain previous artifacts, download producer IDs, and test names across two attempts and matrix cells. Do not use overwrite as a retry mechanism. |
| [Codecov April 2021 postmortem](https://about.codecov.io/apr-2021-post-mortem/) | A modified Bash uploader extracted environment variables and Git remote URLs. | Four Varve workflows executed an unversioned remote WASM installer script. Replace it with a SHA-pinned installer action, exact wasm-pack 0.13.1, required checksum verification, and no fallback. Verify the downloaded Linux archive against the pinned action's manifest. Add a policy regression against remote installer piping and weakened verification. |
| [GitHub advisory CVE-2025-30066](https://github.com/advisories/GHSA-mrrh-fwg8-r2c3), March 2025 | A compromised third-party action exposed secrets through job logs. | Preserve reviewed action SHA pins and least-privilege boundaries; keep fork-capable jobs free of production secrets. Existing policy fixtures reject unsafe triggers, secret inheritance, credential persistence, and excessive token scopes. Diagnostic URLs are scrubbed and public client artifacts audited. No evidence of Varve exposure was found by this review. |
| [CircleCI January 2023 incident report](https://circleci.com/blog/jan-4-2023-incident-report/) | A stolen authenticated session enabled access to production systems and secrets. | Keep signing credentials scoped to their exact release steps and environments, never persisted via GITHUB_ENV or propagated into PR jobs. A retry must preserve those gates. Existing signing-policy tests distinguish permitted unsigned installers from expected signing, which fails closed. This review does not infer that Varve credentials require incident-driven rotation. |
| [Cloudflare July 2019 postmortem](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/) | Functional checks did not prevent a CPU-exhausting rule from being globally deployed; impaired internal tooling complicated recovery. | Retain performance gates separately from functional checks and compare real canvas pixels against a forced full redraw. Require exact-SHA candidate evidence before release. Keep website recovery independent of installer publication and bind recovery to verified release bytes. These controls address analogous failure mechanisms, not Cloudflare's scale or service architecture. |

## Demonstrated retry defects and repairs

GitHub reruns retain the original SHA, ref, and triggering actor's privileges.
They can rerun failed or specific jobs; a source repair therefore needs a new
commit rather than another attempt of the old run.
[GitHub rerun documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs).

1. **Artifact collisions and overwritten evidence.** Upload names now include
   the attempt and matrix identity. Producer outputs expose immutable artifact
   IDs, and consumers use the explicit same-run REST download path. Receipt
   downloads keep separate directories rather than flattening identically
   named JSON files from different attempts.
2. **Older successful receipts hiding newer failures.** Aggregation chooses
   the newest receipt for each category, matrix cell, and shard. It retains
   untouched successful cells but rejects a newer failure, duplicate latest
   receipt, invalid or future attempt, unknown category, malformed JSON, wrong
   workflow run, and mismatched source or validation plan. Superseded receipts
   remain recorded for diagnosis. Exact platform identities and complete
   per-platform lane coverage are required; three arbitrary platform labels
   cannot substitute for the promised Linux, macOS, and Windows matrix.
3. **Older green checks certifying a failed retry.** Certification selects the
   newest trusted Actions check and binds built-in checks to their actual job
   and run through the API. Candidate custom checks identify the run and
   attempt explicitly. Evidence must match the exact SHA, policy, workflow,
   and unexpired attempt-specific artifact; pending or failed newer checks
   block certification.
4. **Stale package selection.** The release collector queries actual producer
   jobs before selecting artifacts. If a newer producer attempt failed,
   remains pending, or did not upload its package, older package bytes are
   refused. Downloaded packages still pass the existing checksum, sidecar,
   provenance, signing, size, and required-target checks.
5. **Misleading failure classification.** The diagnostic repair recognizes
   timestamped and ANSI-prefixed Rust compiler errors. Successful downloads
   of a crate named wait-timeout and embedded older diagnostic reports must
   not outrank the current compiler failure. Recommendations use the planner
   and exact failing lane, and a long queue is reported as observed delay
   rather than proof of a runner outage.
6. **Cancelled jobs concealing executed failures.** At the 14:15 UTC inspection,
   four cancelled browser shards in run
   [37007931934](https://github.com/K-Arthur/varve/actions/runs/37007931934)
   contained 30 completed Playwright failure summaries before cancellation,
   plus interrupted retries. Diagnostics now inspect cancelled jobs with
   recorded execution and retain their cancellation outcome while exposing
   executed assertion, timeout, or visual failure evidence and exact test
   locations. Clean or never-started cancellations acquire no fabricated
   assertion, governed exemption, or automatic retry recommendation. These
   observed failures came from the older `fe5ec0e99` source and require focused
   confirmation against the repaired candidate; they are not 30 independently
   proven product defects. The probe writes an explicit report decision only
   after successful classification; an API/probe error leaves that decision
   unknown and still attempts diagnostics rather than claiming no evidence.
   Debug artifact names include the source run and reporting run/attempt;
   the PR consumer requires a nonempty immutable artifact ID before downloading.
7. **Bounded recovery for a verified upstream setup race.** Dependabot PR 58
   proposed two action updates. The reviewed
   [rust-toolchain change](https://github.com/dtolnay/rust-toolchain/commit/7e38f4b43b4db5c8dd498af069a4f6196df1d067)
   retries installation only when rustup reports both a failed checksum and
   an ongoing update of the official release server. All eleven uses now pin
   this revision. Five attempts, separated by 30 seconds, still enforce
   checksums; other failures and the final failed attempt exit unsuccessfully.
   The install-action update changes tool manifests unused by Varve's pinned
   tools and remains deferred. Neither update was identified as a security
   advisory fix; this is a reviewed setup reliability improvement.
8. **Cancelled local validation leaving expensive processes alive.** Stopping
   one affected run left its detached Editor Vitest descendants running for
   eleven minutes. Their output descriptors identified the stopped run;
   cleanup was limited to that process tree. The synchronous command runner
   blocked JavaScript signal handling, consistent with the
   [Node child-process contract](https://nodejs.org/api/child_process.html).
   Replace it with asynchronous execution that tracks only owned process
   identities, terminates descendants within a bounded grace period, and
   preserves cancellation status. Keep the lease while cleanup is incomplete.
   Full-gate journals distinguish cancellation from a completed failure;
   interrupted lanes cannot reuse an earlier passing receipt.
9. **Concurrent admission and unsafe memory recovery.** The local lease used
   a read-then-write sequence without exclusive creation. Exclusive creation
   alone still leaves a race when two contenders reclaim the same dead owner.
   Serialize the whole read/reclaim/create transaction, retain owner identity
   on release, and refuse malformed or ambiguous ownership metadata. Real
   parallel free-lease and stale-lease fixtures reproduce both previous races.
   A memory deadline must report failure rather than launch a browser below
   the configured floor; the documented explicit parallelism opt-out remains
   available. These local controls complement remote attempt-bound receipts.
10. **A cold build repeated after every local push timeout.** The isolated
    outgoing-tree checkpoint discarded Cargo artifacts when it removed its
    temporary worktree. A 300-second attempt compiled dependencies without
    reaching the selected tests, then deleted that work. Retain a dedicated
    repository-local Cargo target cache under the common Git directory across
    snapshots and pass its canonical path into Cargo so temporary symlink
    spellings cannot invalidate build-script fingerprints. Committed source
    still comes from the exact detached tree;
    Cargo fingerprints and artifact locks govern reuse, and every selected
    check still executes. Keep the generic timeout. A later exact-tree push
    showed that persistent test artifacts do not eliminate the separate cold
    Clippy C++ build: the helper's tests passed after 289 seconds, then its
    Clippy profile hit the 300-second deadline. Per-lane helper estimates now
    account for cold native work and explicitly defer those profiles to
    required exact-SHA CI, while keeping the selected Print checks local.
    A local push pass cannot satisfy the deferred native certification.
    The snapshot regression
    verifies cache survival and dirty-source exclusion; its `--cargo` probe
    builds two different committed programs offline through the same cache,
    verifies that the second executes the changed source, and proves an
    unchanged dependency is reused while a changed dependency rebuilds.
11. **Workspace imports escaped the exact validation tree.** Linking each
    entire installed `node_modules` directory also preserved pnpm's workspace
    links to the caller's checkout. A real snapshot resolved `@varve/scene`
    there, allowing dirty dependency source to influence a supposedly committed
    target. Build a snapshot-local dependency directory with workspace links
    pointing to its committed packages; share third-party installations and
    keep Vite/configuration caches local. A regression resolves and executes a
    committed dependency while the caller contains a different implementation.
12. **macOS path aliases defeated snapshot isolation.** At `3b846efa6`,
    packaging exposed `/var` versus `/private/var` assumptions. Canonicalize
    the caller root before rebasing workspace dependencies and CLI links.
    The symlinked-temporary-root regression checks actual CLI execution:
    the original implementation executes dirty caller code and fails.
13. **Windows command fixtures concealed a runner defect.** The same candidate
    used POSIX PATH separators and directly spawned package-manager shims.
    [Node documents the `.cmd` boundary](https://nodejs.org/api/child_process.html#spawning-bat-and-cmd-files-on-windows).
    Use native path delimiters and the pinned command adapter; reject batch
    arguments containing line breaks or NUL before spawning, because the
    [upstream newline report](https://github.com/moxystudio/node-cross-spawn/issues/179)
    remains open. Simulated adapter tests supplement required native Windows
    execution; they do not certify Windows packages.
14. **A successful website build never deployed.** Run
    [37068845426](https://github.com/K-Arthur/varve/actions/runs/37068845426)
    built its Pages artifact, but deployment had zero steps. The unused
    release-data ancestor was deliberately skipped; GitHub's implicit
    `success()` propagated that skip. Require a successful build and an
    uncancelled workflow explicitly, retaining source-quality and published
    tag/SHA validation. Regression cases reject failed, skipped, or cancelled
    builds and a workflow cancelled after its build.
15. **A stopped launcher left its supervisor running.** Another interrupted
    local run left a detached browser wrapper alive without a delivered
    cancellation signal. The original sender is unknown. Watch the original
    POSIX parent identity during owned-command execution; confirmed parent
    loss invokes bounded cleanup and returns failure. A real controller exits
    normally without signalling its supervisor; the regression verifies
    detached descendant cleanup and survival of an unrelated sentinel.

## Validation evidence and boundaries

- `aggregate-ci.test.mjs` reproduces a previously rejected successful partial
  retry, an older green/newer failed cell, retained untouched matrix cells,
  invalid receipts, and artifact-name collisions across attempts. The first
  retry fixture failed against the previous implementation before repair.
- `certification.test.mjs` covers wrong app, job, SHA, attempt, workflow,
  missing custom binding, and a newer pending check on a later API page.
- `select-run-artifacts.test.mjs` covers retry producer selection, missing or
  failed latest uploads, duplicate and expired artifacts, cross-run/SHA
  mismatches, and strict attempt parsing.
- Workflow policy and diagnostics have direct regressions. YAML parsing and
  the separately installed checksum-verified actionlint validate workflow
  structure and expressions; YAML parsing alone is insufficient.
- Cancelled-job diagnostics cover the actual per-job log collection branch,
  ANSI/timestamp normalization, credential redaction, clean and zero-step
  cancellations, and exact spec/line reproduction through the browser lease
  with one worker. Compiler causes retain their owning crate or desktop check;
  absent failure evidence falls back to the impact planner rather than a
  broad test suite. Assertions and screenshot failures take precedence over
  incidental download words in their context.
- Local cancellation tests launch real detached grandchildren and an unrelated
  sentinel, check that cancellation stops the owned tree while preserving the
  sentinel, and verify that no following validation lane starts. Admission
  tests run actual concurrent wrapper processes; scheduling barriers reproduce
  the earlier races without fabricating filesystem results. Windows process
  cleanup requires separate native certification; injected failure handling
  does not establish Windows installation or GUI behavior.
- The verified wasm-pack Linux archive receipt is local diagnostic evidence,
  not a remote CI or cross-platform release certification.
- Real browser performance validation passed 48 full-redraw pixel oracles
  before and after the RGB conversion repair, with identical surface hashes.
  The historical benchmark also measured growing Vitest mock call-history
  arrays. A benchmark-local repair unwraps those mocks' original
  implementations, preserving return values and draw side effects while
  leaving functional-test mocks unchanged. All four node tiers pass the
  unchanged historical thresholds with this explicit instrumentation change.
  Because the historical baseline includes recording overhead, this is a
  conservative compatibility check, not a comparable measurement of
  historical engine speed. Original failing receipts and real raster evidence
  are retained; no baseline or threshold was changed.

At authoring time, these repairs are undergoing progressive local validation.
The final clean-SHA full gate, exact-SHA integration/candidate runs, all native
package targets, fresh product captures, release publication, and live website
checks remain separate requirements. Earlier run 37007931934 demonstrated a
shared Rust Clippy error and macOS/Windows native compiler errors; their fixes
must be certified by a new run at the repaired SHA. A queued run is not evidence
of a billing block, outage, or product test failure.

## Recovery procedure

Inspect the failed job and its exact SHA first. Save sanitized diagnostics and
classify source failure, runner/setup failure, billing annotation, cancellation,
or queue delay. Resolve source failures with focused compiler/spec checks and a
reviewed commit; freeze the resulting candidate before its final full gate.
For a resolved external failure with unchanged source, rerun the failed job or
failed jobs and retain valid unchanged producers. Do not retry active work,
create empty commits for retries, delete immutable tags, or weaken checks.

Use `pnpm workflow:status`, `pnpm workflow:history`, `pnpm release:status`, and
the [candidate runbook](../release/release-candidate-runbook.md) to find the
current state and required evidence. Publish only after exact-SHA certification
and actual draft verification; recover Pages from the already verified
published tag without republishing the release.

## Retry amplification and failure history

Integration run [37068845264](https://github.com/K-Arthur/varve/actions/runs/37068845264)
ran source `3b846efa63476def3935c8d5f762ca6e380c780f`. All eight browser
shards reached their configured 40-minute budget. The retained logs contain
94 cases with completed failure evidence and four observed retry passes;
unfinished cases remain uncertified. These are observations from that source,
not 94 independently diagnosed defects or proof that all four retry passes
were caused by the same problem. The previous two-retry configuration repeated
assertion, locator, and baseline failures before collecting the next case.

Strict integration, candidate, and local final browser commands now specify
one worker, zero retries, unchanged snapshots, failure on flaky tests, and
first-attempt failure traces. A real browser-free Playwright fixture confirms
that an initial failure followed by a retry pass was previously exit 0, while
the strict command fails. A separate explicit diagnostic retry also fails
under `--fail-on-flaky-tests`. A local `describe.configure` retry override can
still supersede the global zero-retry CLI setting; a TypeScript source guard now prohibits
positive or dynamic overrides in release-selected specs, and producer evidence
rejects observed retry attempts. Independent browser lanes await their actual WASM and
pipeline prerequisites, while final certification still requires every native
Rust matrix cell.

The receipt extension consumes actual Playwright JSON reports, keeps
stable case identities and per-attempt status, retry index, duration, and error
fingerprints with the existing SHA/run/attempt receipt, and verifies counts
against the case history. Missing, malformed, unexpected, flaky, retried, or
policy-drift evidence cannot become successful certification even if a command
returns 0. Raw error/stdout text is not copied into the compact receipt.
Cancelled runs retain their outcome and incomplete evidence; valid GPU skips
remain explicit. Producer, runner, and consumer regression checks passed, including real
retained Playwright reports with exit-0 retry passes. The current targeted
35-case report also exercised the parser: its 34 passes and one failed case
correctly remain failed evidence.

[Google's 2016 flaky-test report](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html?m=1)
describes the cost of recurring false alarms and discusses retries,
quarantine, and detecting changes in flakiness. Varve applies the diagnostic
part through durable attempt history rather than treating a retry pass as a
release success. Stable IDs permit comparisons across commits, but a single
pass or failure is not enough to establish a change in flakiness; a commit is
a candidate association, not proven cause. No automatic quarantine is enabled.
Any future noncritical diagnostic quarantine requires an explicit owner,
reason, expiry, and continued visible execution. Release blockers stay blocking.

## Additional primary-source lessons

| Evidence | Failure mechanism | Concrete application and limits |
| --- | --- | --- |
| [Slack's flaky-test investigation](https://slack.engineering/handling-flaky-tests-at-scale-auto-detection-suppression/) | Blind retries cost time and can conceal defects; an early automatic suppression approach was rolled back after genuinely failing new tests reached the main branch. | Keep failure history and separate diagnostic attempts; do not suppress a release-selected assertion or infer flakiness from one retry pass. The strict gate and report guard address the demonstrated Varve gap. |
| [Slack's circuit-breaker report](https://slack.engineering/circuit-breakers/) | Repeated CI requests amplified queues, and scaling executors overloaded downstream search capacity. | The implemented lease, memory admission floor, bounded owned-process cleanup, and first-failure collection constrain work before launch. Retry only a classified, resolved transient condition; avoid increasing local worker count or repeatedly submitting active work. Varve does not need Slack's distributed service architecture. |
| [GitHub's March 2024 availability report](https://github.blog/news-insights/company-news/github-availability-report-march-2024/) | A production SQL proxy rejected syntax missed by misconfigured development/CI environments; separate network rollback failed because a required configuration field was absent. | Retain the demonstrated Windows command-shim and macOS path-alias negative fixtures, plus native matrix certification. Portable simulations and source checks do not certify installer launch or native GPU behavior. |
| [GitHub's May 2024 availability report](https://github.blog/news-insights/company-news/github-availability-report-may-2024/) | Uneven cluster traffic delayed Actions run updates even when runner work had completed, leaving stale UI state and a backlog. | This is an operator classification lesson: inspect recorded steps, current attempt, and receipt identity before retrying. Queue duration alone proves neither billing failure nor code failure. No workflow patch can repair an account block or provider outage. |
| [GitLab's January 2017 recovery postmortem](https://about.gitlab.com/blog/postmortem-of-database-outage-of-january-31/) | A backup tool/server version mismatch stopped backups; failed notifications concealed the absence of usable recovery data. | Validate actual recovery paths and failure receipts rather than the presence of a backup command. Varve's restoration, parent-loss, stale receipt, and package-selection negative controls exercise these contracts; this is not a proposal for an unrelated database backup service. |
| [AWS's February 2017 S3 incident](https://aws.amazon.com/message/41926/) | An operational tool allowed excessive capacity removal, large-scale recovery took longer than expected, and the status administration path depended on the impaired service. | Preserve admission floors, bounded cleanup, and independent local journals/diagnostics. A provider outage does not authorize publication without certification; operator recovery uses retained evidence and the existing release-bound Pages path. |
| [CrowdStrike's July 2024 root-cause analysis](https://www.crowdstrike.com/content/dam/crowdstrike/www/en-us/wp/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf) | Validator and runtime assumptions disagreed about input counts; wildcard test data failed to exercise the relevant mismatched input. | Test actual runtime/producer output as well as static command policy. The report guard deliberately tests an exit-0 flaky result, missing JSON, inconsistent counts, and real local retry overrides. Existing installed-package, asset, and native validation requirements remain in force. |
| [Slack's agentic testing investigation](https://slack.engineering/agentic-testing-where-agents-fit-in-the-e2e-testing-stack/) | Exploratory agents supplement deterministic checks rather than becoming the repeated CI assertion oracle. | Keep owning E2E tests deterministic and use agents for bounded failure diagnosis and visual exploration; encode demonstrated gaps as real assertions. Root remains the single staging owner, and the independently inspected 22 UI captures complement actual passing test receipts. Agent statements do not certify release behavior. |
| [Slack's long-running agent context investigation](https://slack.engineering/managing-context-in-long-run-agentic-applications/) | Long tasks need curated durable state and output-aware review; unverified agent conclusions can obscure missing evidence. | Preserve decisions, findings, hypotheses, and evidence separately in the existing operation history and failure queue. Independent review checks actual outputs. The next three evidence gaps are final exact-SHA certification, complete native package qualification, and published release/site verification; none becomes complete through a progress estimate. |
| [Slack's E2E speed investigation](https://slack.engineering/speedup-e2e-testing/) | Rebuilding equivalent frontend assets repeated work; reuse depended on identifying equivalent change/build inputs. | Reuse only valid unchanged evidence whose complete source/policy/input identity still matches. Existing affected planning and exact-SHA receipts provide this boundary. Do not promise Slack's measured speedup or add a cross-SHA cache without a complete dependency/input closure and digest. |

These findings complement the existing supply-chain and attempt-identity
repairs above. They do not waive the final exact-SHA gate, native package
qualification, signing policy, screenshot review, or post-publication checks.

## Reuse the certified full gate

`pnpm verify:full --remote` adopts existing full integration and final candidate
evidence for clean local `master` at the accepted remote tip. It reads the actual
immutable archives and validates their SHA256 digests, expiry, complete plans,
platform/shard execution, and latest producer identities. It then runs only the
missing local Emoji, Health, and Architecture audits, with unchanged receipt
reuse available through `--resume`. It rechecks source and remote identities
before passing. The adapter never starts or reruns a workflow; pending,
incomplete, and external startup blocks remain distinct non-pass outcomes.
Its focused regressions cover stale runs, partial plans, missing matrix
cells, expiry, corrupt archives, credential isolation, and a newer queued
dispatch appearing during verification. A real historical GitHub plan archive
also passed digest verification and decoding; that reader check does not
certify the historical failed source.

[GitHub's rerun documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs)
supports keeping unchanged successful jobs and rerunning failed jobs after a
resolved infrastructure condition. Code repairs require a new SHA.
[Concurrency groups](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
do not deduplicate equivalent requests, so one release owner adopts existing
runs and controls any dispatch. [Artifact metadata and downloads](https://docs.github.com/en/rest/actions/artifacts?apiVersion=2022-11-28)
provide immutable IDs, digests, expiry, and signed redirects; matching names
alone are insufficient proof. The reader permits only bounded JSON entries,
never extracts paths, and never forwards the GitHub token to signed storage.

Frontend production-preview substitution remains unimplemented: current app
tests use development-only diagnostics and some model parity tests import
actual Vite `/@fs` source. The existing exact-SHA WASM artifact is shared across
browser lanes. A future dependency-optimizer cache needs compatible tool,
source, lockfile, configuration, and environment inputs plus measured benefit.
[Slack's cache lessons](https://slack.engineering/keep-webpack-fast-a-field-guide-for-better-build-performance/)
include failures from stale or incompatible intermediates; its reported speed
improvements are not Varve measurements.
