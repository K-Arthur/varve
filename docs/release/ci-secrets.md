# Varve — CI Secrets, Permissions and Release Environment

**Date:** 2026-08-03

Nothing in this document has been configured. It specifies what `release.yml`
expects, so that when signing is eventually paid for, the names already match.

**No real credential appears here, and none should ever be committed anywhere in
this repository.**

---

## 1. Secrets currently required: none

`release.yml` builds, checksums, SBOMs and drafts a release using only
`github.token`. That is deliberate — the unsigned alpha path must work with zero
configuration, so that a missing secret is never the reason a release fails.

---

## 2. Repository variables

Set under **Settings → Secrets and variables → Actions → Variables**.

| Name | Values | Effect |
|---|---|---|
| `RELEASE_EXPECT_SIGNED` | `true` / unset | When `true`, a bundle job **fails** if its platform's signing secrets are absent. Leave unset for unsigned alphas; set to `true` before the first stable release so a signed release can never silently ship unsigned |

This is the safety interlock. Without it the failure mode is a release whose
notes claim a signature the artifact does not carry.

---

## 3. Secrets — macOS (needs Apple Developer Program, USD $99/yr)

| Secret | What it is |
|---|---|
| `APPLE_CERTIFICATE` | Developer ID Application certificate, `.p12`, base64-encoded |
| `APPLE_CERTIFICATE_PASSWORD` | Password for that `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID` | Apple ID used for notarisation |
| `APPLE_PASSWORD` | **App-specific password**, never the account password |
| `APPLE_TEAM_ID` | 10-character team identifier |

Prefer an App Store Connect API key (`APPLE_API_KEY`, `APPLE_API_ISSUER`,
`APPLE_API_KEY_ID`) over the Apple ID + app-specific password pair: it is
scoped, revocable, and does not sit next to an account password.

**Not obtainable without a paid membership.** There is no free tier for
Developer ID signing or notarisation.

---

## 4. Secrets — Windows (only if not using the Microsoft Store)

Azure Artifact Signing (formerly Trusted Signing), USD $9.99/mo, requires a
**paid** Azure subscription:

| Secret | What it is |
|---|---|
| `AZURE_SIGNING_CLIENT_ID` | Service principal application ID |
| `AZURE_SIGNING_CLIENT_SECRET` | Service principal secret |
| `AZURE_SIGNING_TENANT_ID` | Entra tenant ID |
| `AZURE_SIGNING_ACCOUNT` | Artifact Signing account name |
| `AZURE_SIGNING_PROFILE` | Certificate profile name |
| `AZURE_SIGNING_ENDPOINT` | Regional endpoint URL |

**The recommended path avoids all of this.** Microsoft Store distribution is
free and Microsoft re-signs the submission, which also eliminates the SmartScreen
prompt that a certificate alone does not
(see `docs/release/distribution-decision-matrix.md` §3.1).

---

## 5. Secrets — updater (not yet applicable)

| Secret | What it is |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Minisign private key for update manifests |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Its password |

Do not create these until the updater is actually being enabled — see
`docs/release/update-strategy.md`. An unused signing key is a liability with no
offsetting benefit.

---

## 6. Workflow permissions

`release.yml` follows least privilege, and build is separated from publish:

| Job | Permissions | Why |
|---|---|---|
| `preflight` | `contents: read` | Only reads the tag |
| `gate` | `contents: read` | Runs tests |
| `bundle` | `contents: read` | Builds. **Cannot write a release** — a compromised build step cannot publish |
| `draft` | `contents: write` | Creates the draft and uploads assets |
| `publish` | `contents: write` + environment approval | Flips the draft public |

The top-level default is `contents: read`; jobs escalate individually.

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

---

## 8. Rules for handling secrets

- Never `echo` a secret. `release.yml`'s signing precondition check prints only
  booleans (`secrets.X != ''`), never values.
- Never pass a secret as a command-line argument — arguments appear in process
  listings. Use the environment.
- Never add a secret to a workflow triggered by `pull_request_target` or
  otherwise reachable from a fork.
- Rotate anything that appears in a log, even if the log was private, and even
  if it was masked — masking is best-effort.
- `.gitignore` already excludes `.env*` (except `.env.example`) and
  `.act-secrets`. Add `*.p12`, `*.key`, `*.pem` before any certificate exists
  locally.

---

## 9. Enrolment steps that require a human

Each involves payment, identity verification, or accepting a legal agreement,
and is outside what automation should do:

- [ ] Microsoft Store developer account — free, requires government ID
      verification. Decide **Individual vs Company** first; it cannot be changed
      later, and the commercial path needs Company
- [ ] Apple Developer Program — USD $99/yr. Defer until a Mac exists to validate on
- [ ] Azure subscription for Artifact Signing — only if the Store path proves
      insufficient
