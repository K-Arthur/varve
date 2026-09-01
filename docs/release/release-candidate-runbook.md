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
   A direct `master` push with 50 or more outgoing commits is refused with the
   exact integration-branch command; no commits are rewritten or discarded.
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
pnpm release:prepare 0.12.0
# review and commit the version/changelog change
pnpm release:status
pnpm release:certify -- --sha "$(git rev-parse HEAD)" --mode triage
```

`release:prepare` updates the canonical version targets through
`scripts/release/version.mjs`, requires the changelog section, refuses a dirty
state, and never creates a tag. The version commit must pass integration CI.

After the exact `master` SHA is frozen, request final certification:

```bash
SHA="$(git rev-parse origin/master)"
pnpm release:certify -- --sha "$SHA" --mode final
gh workflow run release-candidate.yml -f sha="$SHA" -f mode=final
```

The candidate workflow requires the SHA to be reachable from `master`, runs
the prior exact-SHA `CI / certification` check and policy-bound integration
artifact, then runs the extended matrix once and records `POLICY_VERSION` plus
the policy hash.
The final evidence artifact is named
`varve-release-candidate-<sha>-<policy-hash>`. A candidate from any other SHA
or policy is invalid, even when its tests were green.

Only after the final candidate check is green may an authorized maintainer
create and push the tag. This work does not create tags or change GitHub
settings:

```bash
git tag -a v0.12.0 <certified-master-sha> -m "Varve 0.12.0"
git push origin master refs/tags/v0.12.0
```

The local pre-push driver also requires release-tag provenance and matching
candidate evidence. If the evidence is only in GitHub, download an exact local
copy and expose it through `VARVE_CANDIDATE_EVIDENCE=/path/to/evidence.json`
when performing the authorized tag push (or validate it first with
`pnpm verify:push --candidate-evidence <path>`); the hook receives no arbitrary
driver arguments. It must contain the same commit SHA, policy hash, and passed
status.

## Release workflow and resume

`release.yml` first verifies tag format/version/changelog/reachability and then
calls `scripts/release/verify-certification.mjs`. If either exact stable check,
policy-bound integration evidence, or matching unexpired candidate evidence is
absent, it fails before large dependency installation and prints the recovery
action. It does not rerun the ordinary product suite.

Platform jobs write artifacts and an exact-SHA provenance sidecar containing:

- release version and commit SHA;
- validation-policy hash;
- platform/architecture;
- artifact filename and SHA-256.

If one platform fails, retain the successful outputs and rerun only the failed
job. Before final merge, collect all outputs into one directory and run:

```bash
pnpm release:resume -- \
  --dir dist/release \
  --version 0.12.0 \
  --sha <certified-master-sha> \
  --policy-hash <candidate-policy-hash>
```

The collector rejects missing, modified, out-of-tree, wrong-version,
wrong-SHA, wrong-platform, or wrong-policy artifacts. It writes the final
manifest only after every required release target is present, so artifacts from
different commits cannot be combined. The normal release verification still
performs signing, checksums, SBOM, provenance/attestation, naming, and draft
integrity checks. Publishing remains a separate human action through the
protected release environment:

```bash
gh workflow run release.yml \
  -f tag=v0.12.0 -f platforms=all -f publish=yes
```

The publish job emits the protected `varve-release-published` event only after
GitHub reports the release as non-draft. The website workflow excludes the
publish run's `workflow_run` fallback, preventing a duplicate deployment, and
binds the event tag to its exact commit before fetching release data.

## Website publication

Website source changes run the normal website unit/functional/a11y/visual
certification selected by the canonical planner. A successful release
publication sends a protected `varve-release-published` dispatch with the
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
