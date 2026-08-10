# Varve — CI Secrets, Permissions and Release Environment

**Date:** 2026-08-03 (last updated 2026-08-08)

This document is the contract between `release.yml` and the repository
settings: the names here are the names the workflow reads. See
[code-signing-setup.md](code-signing-setup.md) for the human acquisition
checklist and [signing-decision-record.md](signing-decision-record.md) for why
these services were chosen.

**No real credential appears here, and none should ever be committed anywhere in
this repository.**

---

## 1. Secrets currently required: none

Until signing is acquired, `release.yml` builds, checksums, SBOMs and drafts a
release using only `github.token`. The unsigned prerelease path must work with zero
configuration, so that a missing secret is never the reason a release fails —
until `RELEASE_EXPECT_SIGNED=true`, at which point missing signing credentials
fail the release in `signing-preflight` BEFORE any platform build.

---

## 2. Repository variables

Set under **Settings → Secrets and variables → Actions → Variables**.

| Name | Values | Effect |
|---|---|---|
| `RELEASE_EXPECT_SIGNED` | `true` / unset | When `true`, signing is REQUIRED for any platform being built: `signing-preflight` fails if credentials are absent, and the `verify` trust gate fails if the post-build verification reports do not confirm signatures/notarization/stapling. Set to `true` before the first stable release. |
| `AZURE_SIGNING_ACCOUNT` | e.g. `varve-signing` | Artifact Signing account name (non-secret configuration) |
| `AZURE_SIGNING_PROFILE` | e.g. `varve-public-trust` | Public Trust certificate profile name (non-secret) |
| `AZURE_SIGNING_ENDPOINT` | e.g. `https://wus2.codesigning.azure.net` | Regional Artifact Signing endpoint (non-secret) |

The Windows signing command contains NO secrets: Tauri's `signCommand` is built
from these variables at release time and merged via `--config`; authentication
comes from the `AZURE_SIGNING_CLIENT_*` secrets via the process environment.

---

## 3. Secrets — macOS (needs Apple Developer Program, USD $99/yr)

| Secret | What it is |
|---|---|
| `APPLE_CERTIFICATE` | Developer ID Application certificate, `.p12`, base64-encoded |
| `APPLE_CERTIFICATE_PASSWORD` | Password for that `.p12` |
| `APPLE_SIGNING_IDENTITY` | Exactly `Developer ID Application: <Legal Name> (TEAMID)`. The workflow refuses identities that do not start with `Developer ID Application:` — Apple Development / Apple Distribution certs are the wrong type for direct DMG distribution |
| `APPLE_API_ISSUER` | App Store Connect API **Issuer ID** |
| `APPLE_API_KEY` | App Store Connect API **Key ID** |
| `APPLE_API_KEY_P8_BASE64` | The `.p8` private key file, base64-encoded (decoded to a temp file in CI; `APPLE_API_KEY_PATH` points at it) |
| `APPLE_TEAM_ID` | 10-character Team ID (used only when falling back to Apple ID auth) |
| `APPLE_ID` / `APPLE_PASSWORD` | Fallback notarization auth (Apple ID + **app-specific password**). Prefer the API key trio above — scoped, revocable, no account password |

Notarization auth is satisfied by **either** the API key trio **or** the
Apple ID trio; `signing-preflight` checks both and fails a signed macOS build
if neither is complete.

**Not obtainable without a paid membership.** There is no free tier for
Developer ID signing or notarisation.

---

## 4. Secrets — Windows (Azure Artifact Signing, Public Trust)

Paid Azure subscription required (free/trial/sponsored are rejected by the
service). Basic SKU ≈ USD $9.99/mo. Identity validation (individual or
organization) is a human step — see `code-signing-setup.md` §A.2.

| Secret | What it is |
|---|---|
| `AZURE_SIGNING_CLIENT_ID` | Service principal application (client) ID |
| `AZURE_SIGNING_CLIENT_SECRET` | Service principal secret (rotate on a calendar; see `signing-rotation-runbook.md`) |
| `AZURE_SIGNING_TENANT_ID` | Entra tenant ID |

The identity needs exactly one role on the certificate profile: **Artifact
Signing Certificate Profile Signer**. Nothing more.

**Auth chain (audited 2026-08-08):** Tauri's official integration uses
`artifact-signing-cli` (pinned 0.11.0), which authenticates by running
`az login --service-principal` with the client secret and drives `signtool`
with `Microsoft.ArtifactSigning.Client`. **OIDC/workload-identity federation is
not supported by that tool today** — a client secret is required. Mitigations:
short-lived-ish secrets with calendar rotation, a dedicated app registration,
least-privilege role, and secrets that exist only for the tag-only release
workflow. Re-evaluate OIDC when Microsoft or the CLI supports it.

---

## 5. Secrets — updater (not yet applicable)

| Secret | What it is |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Minisign private key for update manifests |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Its password |

Do not create these until the updater is actually being enabled — see
`docs/release/update-strategy.md`. When it lands, this key is stored, backed up
and rotated **separately** from the Apple/Windows material above; installed
clients trust the embedded public key, so losing the private key makes future
updates impossible for existing installs.

---

## 6. Workflow permissions

`release.yml` follows least privilege, and build is separated from publish:

| Job | Permissions | Why |
|---|---|---|
| `preflight`, `gate` | `contents: read` | Read-only checks |
| `signing-preflight` | `contents: read` | Presence-boolean policy resolution — secret VALUES never enter this job |
| `bundle` | `contents: read` | Builds + signs. **Cannot write a release** — a compromised build step cannot publish |
| `package-smoke`, `platform-smoke` | `contents: read` | Install/launch/signature verification |
| `verify` | `contents: read`, `id-token: write`, `attestations: write` | Trust gate + GitHub artifact attestation of final bytes. No `contents: write` |
| `draft` | `contents: write` | Creates the draft and uploads assets |
| `publish` | `contents: write` + environment approval | Flips the draft public |

The top-level default is `contents: read`; jobs escalate individually.
`id-token: write` exists only on `verify` (for attestation).

---

## 7. The `release-publish` environment

`release.yml`'s `publish` job declares `environment: release-publish`.

**Two gates protect publication, and neither depends on the other:**

1. **Explicit dispatch input.** The publish job only runs on a manual
   `workflow_dispatch` with `publish=yes`. A tag push always stops at a draft;
   nothing in the pipeline auto-publishes, even if the environment below is
   unconfigured.
2. **Environment approval.** Settings → Environments → `release-publish` →
   enable **Required reviewers** and add yourself. This is the second,
   independent human checkpoint (the owner UI step — the REST API returns 404
   for this rule type with a repo-scoped token).

The exact publish command:

```sh
gh workflow run release.yml --ref master \
  -f tag=v0.1.0 -f platforms=all -f publish=yes
```

Checklist (repo settings):

- [x] Create the `release-publish` environment
- [ ] Add at least one required reviewer
- [ ] Verify by running a release and confirming the workflow waits

**Why signing secrets are repository-level (decision, 2026-08-08):** GitHub
only exposes environment-scoped secrets to jobs that statically declare that
environment, and environment names cannot be conditional on policy output —
attaching `production-signing` to the bundle job would require human approval
for unsigned prerelease builds too. For a solo maintainer the effective controls
are: the workflow triggers only on tags / explicit `workflow_dispatch` (never
`pull_request` — enforced by `scripts/validate-workflows.mjs`), the draft is
created only after the fail-closed trust gate, and publication requires
approval in `release-publish`. **Revisit when a second maintainer exists:**
move signing secrets into a `production-signing` environment with required
reviewers and tag restriction, and declare it on the bundle job.

---

## 8. Rules for handling secrets

- Never `echo` a secret. `release.yml`'s signing preflight prints only
  presence booleans (`P_APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE != '' }}`),
  never values.
- Never pass a secret as a command-line argument — arguments appear in process
  listings. Use the environment.
- Never add a secret to a workflow triggered by `pull_request_target` or
  otherwise reachable from a fork. `release.yml` runs on tags only; the
  validator blocks release writes from PR-capable workflows.
- Rotate anything that appears in a log, even if the log was private, and even
  if it was masked — masking is best-effort.
- `.gitignore` excludes `.env*`, `*.p12`, `*.pfx`, `*.p8`, `*.key`, `*.pem`,
  `*.der`, `*.cer`, `*.crt`, `*.csr`, and the CI-generated
  `tauri.signing.windows.json`.
- The App Store Connect `.p8` is decoded to `/tmp` on the runner and the
  keychain is a throwaway `build.keychain` — nothing is uploaded as an
  artifact.
- `verify-windows-signature.ps1` / `verify-macos-signature.sh` never receive
  secrets: they inspect artifact bytes and emit JSON reports.

---

## 9. Enrolment steps that require a human

Each involves payment, identity verification, or accepting a legal agreement,
and is outside what automation should do. Full walkthrough:
[code-signing-setup.md](code-signing-setup.md) §A.

- [ ] Apple Developer Program — USD $99/yr; Developer ID Application
      certificate; App Store Connect API key; offline `.p12`/`.p8` backup
- [ ] Azure subscription (paid) + Artifact Signing account (Basic) +
      identity validation + Public Trust profile + service principal with the
      Certificate Profile Signer role
- [ ] GitHub `release-publish` environment with required reviewers
- [ ] (Future) Microsoft Store developer account if the Store path is taken —
      free, requires government ID verification; Individual vs Company decision
      cannot be changed later
