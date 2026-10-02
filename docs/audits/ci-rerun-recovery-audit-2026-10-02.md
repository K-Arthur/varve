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
