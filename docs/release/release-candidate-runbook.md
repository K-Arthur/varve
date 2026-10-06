# Exact-SHA Release Candidate Runbook

This is the current release path. It separates integration evidence from
release evidence, keeps every commit, and makes a tag a consequence of a
certified frozen commit rather than the start of ordinary test discovery.

## Flow

```text
commit
  │ pre-commit checkpoint
  ▼
exact Git pre-push refs ──> bounded local push checkpoint
  │                         ├─ pass: push; CI deferrals are explicit
  │                         └─ fail/refusal: repair locally
  ▼
integration branch / PR ──> canonical plan ──> staged CI ──> CI / certification
  │                                                         (exact SHA)
  ▼
freeze successful master SHA ──> Release Candidate / certification
  │                              (triage, repair, final; exact SHA + policy hash)
  ▼
human creates immutable vX.Y.Z tag ──> release preflight
  │                                     ├─ exact certification verification
  │                                     ├─ platform packaging/signing
  │                                     ├─ checksum/SBOM/provenance verification
  │                                     └─ draft release
  ▼
human publishes draft ──> release-data-only website deploy ──> live smoke
```

## Ordinary change and a large unpublished history

1. Commit normally. The commit hook remains the cheap staged checkpoint.
2. Push normally. `.githooks/pre-push` invokes `pnpm verify:push`; it reads
   Git's exact update stream, validates the remote-to-local net diff, scans
   every outgoing commit for history-sensitive policy findings, and prints
   expensive lanes deferred to CI.
3. If the branch contains dozens or hundreds of commits, push an integration
   branch and open a PR. Do not squash solely to make validation manageable:
   the push driver accepts the complete range and CI certifies the exact PR
   SHA.
   Commit count is a workload signal only. The push driver accepts a large
   complete range, scans its history once, and validates each distinct target
   tree from a clean snapshot; it does not require squashing or redirecting
   the push solely because of its size.
4. Repair the exact failing lane reported by CI. Use the failure manifest and
   target rerun rather than an empty commit. Merge only after the stable
   `CI / certification` check passes.

Inspect the outgoing plan without running local lanes:

```bash
VARVE_PUSH_DRY_RUN=1 pnpm verify:push -- --pre-push origin "$(git remote get-url origin)"
```

The hook's exit codes are `0` (local checkpoint passed, remote work may be
pending), `1` (local/history failure), `2` (invalid or unsafe comparison), and
`4` (protected-ref or release-provenance refusal). A dirty worktree is only a
warning: unstaged and untracked files are not being pushed.

If a network outage or an already-observed remote incident makes an override
necessary, use a specific reason:

```bash
VARVE_PUSH_OVERRIDE_REASON="GitHub Actions outage; run 33370560082 diagnostics saved" git push
```

History/security checks still run. The reason is recorded in the common Git
directory at `varve-validation/overrides.ndjson`; an override cannot bypass
`master`, a `v*` tag, candidate provenance, or the remote required check.

## Prepare and certify a release

Run from a clean normal branch:

```bash
pnpm release:prepare 0.5.0
# review and commit the version/changelog change
pnpm release:status
pnpm release:certify -- --sha "$(git rev-parse HEAD)" --mode triage
```

`release:prepare` updates the canonical version targets through
`scripts/release/version.mjs`, requires the changelog section, refuses a dirty
state, and never creates a tag. The version commit must pass integration CI.
`release:status` reports local upstream counts and the next required action;
it does not infer publication from a prepared version or a green local test.
The upstream counts describe the locally fetched remote ref, so refresh the
remote before using them to freeze a candidate.

Keep the product work stable before the final full gate. Use the hosted
integration and candidate matrices as the normal release execution owners;
do not run the complete serial local suite before repeating it in GitHub.
`pnpm verify:full` defaults to verifying that hosted evidence. When an explicit
`--local` gate is interrupted or an external condition fails without changing
source, retain the same reason and use `pnpm verify:full --local --resume`.
Its passed lanes and browser shards are
reused only for the same clean commit, policy, command, tool/environment and
dependency/runtime inputs; failed or incomplete lanes run again. A product
repair changes the candidate and invalidates earlier full-gate lane receipts.
Repair each exact failing spec first, then run the final checkpoint once the
new candidate is frozen. Remote certification still runs for that exact SHA.

After the exact `master` SHA is frozen, request final certification:

```bash
SHA="$(git rev-parse origin/master)"
pnpm release:certify -- --sha "$SHA" --mode final
gh workflow run release-candidate.yml --ref master -f sha="$SHA" -f mode=final
```

The candidate workflow requires the SHA to be reachable from `master` and the
dispatched workflow revision to match that SHA. Keep accepted `master` frozen
before dispatch; a mismatch fails planning before expensive jobs start. A
`triage` dispatch deliberately skips the prior integration-certification
prerequisite and produces a bounded, non-certifying failure report so it can
help diagnose a red integration run. A `final` dispatch runs the prior exact-
SHA `CI / certification` check and policy-bound integration artifact, then runs
the extended matrix once. Each candidate matrix cell uploads an exact-source
execution receipt; final aggregation requires every promised lane, platform,
and browser shard before it records `POLICY_VERSION` plus the policy hash.
The final evidence artifact is named
`varve-release-candidate-<sha>-<policy-hash>-run-<run_id>-attempt-<attempt>`.
A candidate from any other SHA
or policy is invalid, even when its tests were green.

When full integration and final candidate validation have already run in
GitHub Actions, complete the full checkpoint without repeating those lanes
locally:

```bash
VARVE_FULL_GATE_REASON="0.5.0 release checkpoint and planner-selected infrastructure/runtime escalation" pnpm verify:full --remote
```

This requires clean local `master` at the accepted remote tip. The adapter
reads and verifies the actual complete certification artifacts, then runs the
missing local Emoji, Health, and Architecture audits. It rechecks the source,
policy, accepted tip, and newest producer identities before passing. Pending,
cancelled, expired, partial, superseded, or failed evidence cannot pass.
`--status` performs read-only diagnosis and returns a non-pass status;
`--resume` can reuse unchanged local audit receipts. Neither option starts or
reruns a workflow.

See [test pipeline efficiency](../quality/test-pipeline-efficiency.md) for the
measured bottleneck, sharding policy, output isolation, failure recovery, and
the boundary between diagnostic reports and release certification.

Only after the final candidate check is green may an authorized maintainer
create and push the tag. This work does not create tags or change GitHub
settings:

```bash
git tag -a v0.5.0 <certified-master-sha> -m "Varve 0.5.0"
git push origin master refs/tags/v0.5.0
```

The local pre-push driver also requires release-tag provenance and matching
candidate evidence. If the evidence is only in GitHub, download an exact local
copy and expose it through `VARVE_CANDIDATE_EVIDENCE=/path/to/evidence.json`
when performing the authorized tag push (or validate it first with
`pnpm verify:push --candidate-evidence <path>`); the hook receives no arbitrary
driver arguments. It must contain the same commit SHA, policy hash, and passed
status.

## Release workflow and resume

### Recover orchestration for an existing tag

When a certified tag exists but its release verifier is broken, repair the
workflow and verifier on `master`, validate and push that repair, then dispatch
the workflow from `master` against the existing tag:

```bash
gh workflow run release.yml --ref master -f tag=v0.5.0 -f platforms=all -f publish=no
```

Preflight uses certification tooling pinned to `github.workflow_sha` (the
immutable revision of the dispatched workflow). Version, changelog, source
SHA, policy hash, build inputs, and packages still come from the tag. The
certified-source job rechecks that same tag SHA and policy using the workflow
tooling. This permits an orchestration repair without moving a release tag.
GitHub documents the workflow revision in its
[contexts reference](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts).

For API-created candidate checks, GitHub may normalize `details_url` to
`/<owner>/<repo>/runs/<check-id>`. The verifier binds the trusted check through
its `external_id` (`<run-id>:<attempt>`), then verifies the producer workflow,
source, successful attempt, and matching unexpired artifact. A browser command
passing does not establish certification: retries or execution-policy drift
still invalidate its receipt. Repair the cause and keep zero-retry validation.

`release.yml` first verifies tag format/version/changelog/reachability and then
calls `scripts/release/verify-certification.mjs`. If either exact stable check,
policy-bound integration evidence, or matching unexpired candidate evidence is
absent, it fails before large dependency installation and prints the recovery
action. It does not rerun the ordinary product suite.

The existing Linux and Windows/macOS smoke jobs also qualify the installed
production application before draft verification. Each target installs the
verified published 0.2.1 package, saves a schema-2.21 document on disk, upgrades
while retaining the same native profile, then requires 0.5.0 save/reopen,
Inspector editing and undo, and actual PNG/SVG/PDF output. Image export checks
compare embedded-asset pixels; saved bytes must retain text, curves and assets
at schema 2.33. Platform execution and receipts, rather than harness unit tests,
establish these results.

Linux uses external Tauri/WebKit WebDriver, Windows uses WebView2 CDP, and
macOS uses external XCTest Accessibility through Mac2. Linux and Windows
substitute only a one-shot Save dialog selection; native filesystem and export
commands remain genuine, so these routes do not certify the native chooser UI.
macOS drives its actual native chooser. Driver, permission, selector or product
failures fail the job and retain logs, screenshots and available accessibility
source. A process staying alive, a successful capability probe, or a debug app
check cannot replace this installed-production gate.

Platform jobs write artifacts and an exact-SHA provenance sidecar containing:

- release version and commit SHA;
- validation-policy hash;
- platform/architecture;
- artifact filename and SHA-256.

If one platform fails, retain the successful outputs and rerun only the failed
jobs in the same workflow run. Release, final-set and debug uploads include
`-attempt-<number>` in their immutable names, preserving prior evidence.
Downstream jobs select explicit artifact IDs from the newest successful
producer attempt for each requested platform. A newer failed producer or a
missing upload blocks reuse of an older success. Whole-workflow reruns select
only their new outputs; unrelated runs, source SHAs and expired uploads fail
the selector.

The API identity uses the workflow run's head SHA, which can differ from the
release tag on a manual dispatch. After downloading, installer sidecars and
hashes must independently match the certified tag SHA, version and policy
before smoke tests, merging or draft creation. Signing, package formats,
updater signatures, SBOM and attestation gates still run normally.

For local recovery, collect verified outputs into one directory and run:

```bash
pnpm release:resume -- \
  --dir dist/release \
  --version 0.5.0 \
  --sha <certified-master-sha> \
  --policy-hash <candidate-policy-hash>
```

The collector rejects missing, modified, out-of-tree, wrong-version,
wrong-SHA, wrong-platform, or wrong-policy artifacts. It writes the final
manifest only after every required release target is present, so artifacts from
different commits cannot be combined. Multiple formats for one platform
(Linux AppImage, deb and rpm) are retained. When a collected release manifest
is present, resume requires its artifact set, platforms and hashes to match
the verified sidecars and preserves its package and signing metadata. Run the
normal final checksum generation and artifact checks after resuming. The normal release verification still
performs signing, checksums, SBOM, provenance/attestation, naming, and draft
integrity checks. Publishing remains a separate authorized dispatch. Its
publish-only path downloads the actual draft again, authenticates the checksum
attestation against the tag workflow or an explicitly verified recovery build,
and verifies required package formats,
policy-bound installer provenance, bytes, SBOM source/version, signing reports,
installer-size reports and updater signatures. An asset inventory change during
verification stops publication. The `release-publish` environment provides an
additional approval only if repository settings configure reviewers (none were
configured at the 2026-10-02 settings check):

```bash
gh workflow run release.yml --ref v0.5.0 \
  -f tag=v0.5.0 -f platforms=all -f publish=yes
```

For a normal tag build, its attestation certificate records the tag SHA.
Recovery builds dispatched from `master` legitimately carry the workflow SHA
in the certificate even though packaging checks out the older product tag.
Publish such a draft from the repaired workflow with its explicit successful
build run ID:

```bash
gh workflow run release.yml --ref master \
  -f tag=v0.5.0 -f platforms=all -f publish=yes \
  -f build_run_id=<successful-master-draft-build-run>
```

Publication tooling is pinned to `github.workflow_sha`; the updater public key
still comes from the product tag. Recovery verification requires a successful
`master` Release dispatch in this repository, and proves tag → build workflow
→ publication workflow → accepted `master` ancestry through GitHub's API.
The cryptographically verified certificate must identify that exact build
workflow SHA, signer, master ref, run and attempt, and the downloaded checksum
digest. Its authenticated checksum inventory then binds installer sidecars to
the certified product tag and policy. Missing recovery inputs do not silently
accept a different signer SHA. A newer build attempt or changed asset inventory
during verification stops publication. No tag moves, certificate spoofing,
custom predicate assertion, or broad acceptance of arbitrary master signatures
is involved.

The pinned attestation action uses GitHub's workflow OIDC claims, rather than
the checked-out repository's HEAD, for source identity. See the official
[attestation provenance implementation](https://github.com/actions/toolkit/blob/main/packages/attest/src/provenance.ts)
and [Fulcio certificate identity fields](https://github.com/sigstore/fulcio/blob/main/pkg/identity/github/principal.go).

The publish job emits the authenticated `varve-release-published` event only after
GitHub reports the release as non-draft. The website workflow excludes the
publish run's `workflow_run` fallback, preventing a duplicate deployment, and
binds the event tag to its exact commit before fetching release data.

## Website publication

Website source changes run the normal website unit/functional/a11y/visual
certification selected by the canonical planner. A successful release
publication sends an authenticated `varve-release-published` dispatch with the
exact tag and SHA. The guarded `workflow_run` fallback does not repeat that
complete corpus when the website source is unchanged. Instead it validates the
published release-data schema, fetches the published release artifacts, builds
the site, scans the build, deploys, and runs the bounded live smoke test. Draft
releases are never treated as published downloads.

## Visual and failure review

`visual-baselines.yml` compares by default. Snapshot updates require both the
explicit reviewed and update inputs. Download and inspect expected, actual,
and diff images, then place only the approved snapshots in a reviewed commit;
the workflow never auto-commits or increases a global tolerance.

Every failed run should have `ci-failure-manifest.json`. Classify it as product,
test/stale assertion, intentional visual change, flaky, platform,
resource/timeout, setup/dependency, runner/billing, cancellation, or release
metadata/signing. `ci-known-failures.json` is a temporary governed exception,
not a skip list: exact test ID, reference, owner, platforms, dates, expiry, and
failure signature are mandatory, and a new or signature-changing failure
blocks candidate certification.

## Required administrator actions

An administrator must require the stable `CI / certification` check for
`master` in the repository ruleset and verify that pull requests cannot update
the branch without it. They must also confirm the candidate/release workflow
permissions, signing secrets, Pages environment protection, and any branch
environment approvals. No secrets, rulesets, tags, releases, or deployments
were changed by this implementation.
