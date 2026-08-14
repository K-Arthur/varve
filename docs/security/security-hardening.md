# Varve Security Hardening

This document is the operational security contract for the repository: what
is public, what is secret, where each kind of configuration belongs, what to
do when a credential is compromised, and how release trust is composed.
Companion documents: [CI Secrets, Permissions and Release
Environment](../release/ci-secrets.md) (secret inventory + rotation
procedures), [Trust Boundaries](trust-boundaries.md) (the architectural
trust-zone model: which subsystem may consume which credential, client-safe
config schema, artifact scans, import boundaries, future-backend design),
[signing decision record](../release/signing-decision-record.md)
(why these services were chosen), [SECURITY.md](../../SECURITY.md)
(vulnerability reporting).

**No real credential value appears anywhere in this repository, and none ever
may.** Scripts here reference secret *names* only.

---

## 1. Secret classification

| Class | Examples | Where it may live |
|---|---|---|
| Public configuration | `varve.studio`; application version; feature flags for clients; public OAuth client IDs; the updater **public** verification key; code-signing certificate *information*; Apple Team ID / signing identity string (identifier only); Azure tenant/client **IDs**; analytics identifiers meant for browsers | Source control, website output, desktop bundles — anything shipped is public |
| Sensitive secrets | Private keys; client secrets; passwords; `.p8`/`.p12`/`.pfx` material; GitHub PATs; Porkbun API keys; Azure signing client secret; updater **private** signing key | GitHub Actions secrets only (environment-scoped where available), or developer-local storage. Never in source, never in bundles |
| Ambiguous / service-specific | Public SDK keys, DSNs, anonymous analytics keys | Investigate before deciding; if it ships to clients it is public and must be guarded server-side instead |

Rule of thumb for this project: **neither a static website nor a desktop
binary can conceal a true server-side secret.** Anything compiled into the
website's JavaScript or embedded in the Tauri bundle is recoverable by an end
user. If a privileged operation needs a confidential service credential at
runtime, it must move behind an authenticated backend, not into the binary.

### Where configuration lives

| Scope | Content | Location |
|---|---|---|
| Committed public config | `SITE_URL`, `SITE_BASE`, `ANALYTICS_DOMAIN` | `apps/website/astro.config.mjs` / `.env.example` |
| Developer-local | Anything a developer needs that must not ship | Untracked `.env` files (gitignored), local keychains, `~/.config` |
| GitHub Actions variables | Non-secret build configuration (`RELEASE_EXPECT_SIGNED`, `AZURE_SIGNING_ACCOUNT/PROFILE/ENDPOINT`) | Settings → Secrets and variables → Actions → Variables |
| GitHub Actions secrets | Everything in the sensitive class | Settings → Secrets and variables → Actions → Secrets |
| Environment secrets | Future: signing material in a `production-signing` environment once a second maintainer exists | Settings → Environments |

See [ci-secrets.md](../release/ci-secrets.md) for the exact names the release
pipeline reads.

---

## 2. Production secret inventory (names only)

| Secret name | Provider / purpose | Owned by | Rotation procedure | Expected exposure |
|---|---|---|---|---|
| `APPLE_CERTIFICATE` | Developer ID `.p12` (base64) | `release.yml` bundle job (macOS) | [signing-rotation-runbook.md](../release/signing-rotation-runbook.md) | Never |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` password | same | same | Never |
| `APPLE_SIGNING_IDENTITY` | Exact identity string (contains Team ID; treated as secret for convenience) | same | update when cert rotates | Never |
| `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_P8_BASE64` | App Store Connect API key trio (notarization) | same | revoke/recreate API key in App Store Connect | Never |
| `APPLE_ID`, `APPLE_PASSWORD` | Fallback notarization auth (app-specific password) | same | revoke app-specific password | Never |
| `APPLE_TEAM_ID` | Team ID (identifier) | same | only when team changes | Publicly visible in signed binaries — harmless |
| `AZURE_SIGNING_CLIENT_ID`, `AZURE_SIGNING_CLIENT_SECRET`, `AZURE_SIGNING_TENANT_ID` | Azure Artifact Signing service principal | `release.yml` bundle job (Windows) | calendar rotation; [signing-rotation-runbook.md](../release/signing-rotation-runbook.md) | Never |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Updater minisign key — **not created until the updater ships** | future updater job | separate, offline-backup rotation; rotating breaks existing installs' update trust | Never |
| `GITHUB_TOKEN` | Default actions token | every workflow | automatic per run; repo default is read-only | Never (runtime only) |

Repository variables (not secrets): `RELEASE_EXPECT_SIGNED`,
`AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE`,
`AZURE_SIGNING_ENDPOINT`.

---

## 3. Credential compromise response

Order matters. Deleting a leaked secret from the current branch is **not**
remediation; rotation is.

1. **Identify and classify.** Which provider, which file/commit/run, still
   valid?
2. **Revoke/rotate/invalidate.** Treat any secret that entered Git history or
   a CI log as compromised. GitHub PATs → revoke; Apple certs → revoke via
   Apple; App Store Connect keys → revoke; Azure client secret → rotate;
   Porkbun API keys → regenerate; updater key → treat as a critical incident
   (existing installs trust the public half — see
   [update-strategy.md](../release/update-strategy.md)).
3. **Replace.** Install the new value in the legitimate store (GitHub
   secrets, provider console). Verify the replacement works (e.g. a real
   signed release or a documented unsigned-dev mode).
4. **Clean the current tree.** Remove the material; run
   `pnpm audit:secrets` and gitleaks.
5. **Clean history where warranted.** Rewriting shared history is a
   destructive, exceptional operation: never before rotation, never without
   explicit approval, and never by force-pushing shared refs blindly. Use
   `git filter-repo`, account for branches/tags/signed commits/forks, and
   re-scan after. For the solo-maintainer model, an approved rewrite is
   `git filter-repo --invert-paths --path <file>` on all refs, then
   `git push --force --all` + `--force --tags` from the rewritten clone.
6. **Rescan.** gitleaks `--log-opts="--all"` + `pnpm audit:secrets`.
7. **Repair downstream clones.** Collaborators re-clone or carefully rebase;
   forks cannot be erased retroactively.
8. **Close alerts.** In GitHub secret scanning, resolve alerts with the
   correct reason only after containment (rotated + removed).

### Historical audit status

As of 2026-08-12 the full reachable history (all branches + tags) has been
scanned with gitleaks (default ruleset) plus targeted pickaxe searches:
**no real credentials were found.** The only hits are documented synthetic
fixtures (crash/privacy tests, MDI icon metadata, example keys) — allowlisted
by path in `.gitleaks.toml` and `scripts/secret-scan.mjs`, never by value.
No history rewrite is warranted today.

---

## 4. Release trust model

The release pipeline composes **five independent trust mechanisms**. Do not
confuse them:

| Mechanism | Answers | Produced by |
|---|---|---|
| Authenticode (Windows) / Developer ID + notarization + staple (macOS) | "This binary was signed by a trusted developer identity" | `bundle` job; *verified on the actual bytes* by `verify-windows-signature.ps1` / `verify-macos-signature.sh` |
| `SHA256SUMS.txt` | "These are the bytes of the release" | `verify` job, only **after** the trust gate |
| SBOM (CycloneDX) | "What components are in the release" | per-platform + combined, validated |
| GitHub artifact attestations | "GitHub built this artifact from commit X of repo Y" | `verify` job, on the **final** bytes |
| Updater signatures (future) | "This update manifest was signed by Varve's minisign key" | future updater pipeline, separate key |

Pipeline invariants (enforced by `scripts/validate-workflows.mjs` +
`scripts/security/workflow-policy.mjs`):

- A tag never releases by itself: it builds a **draft**; a human publishes.
- The tag must match the application version **and** point at a commit
  reachable from the protected default branch (provenance gate).
- Signing credentials are validated **before** any platform build
  (`signing-preflight`, presence booleans only).
- `signed=true` in the release manifest derives **only** from the post-build
  verification reports, never from workflow text.
- Checksums and attestations describe the **final verified bytes**, never
  pre-signing intermediates.
- Signing secrets are passed to the exact build step that needs them — never
  persisted through `$GITHUB_ENV`.

---

## 5. Maintainer onboarding (no production secrets required)

1. Install the toolchain (see `docs/development/setup.md`). No GitHub
   secrets are needed to build, test, or run Varve locally.
2. `pnpm install` installs the git hooks (pre-commit includes the staged
   secret scan; install gitleaks for the deeper staged check:
   `go install github.com/gitleaks/gitleaks/v8@latest` or the release
   binary).
3. Local signing: on Linux, the app builds and bundles unsigned
   (`RELEASE_EXPECT_SIGNED` unset → `signing-preflight` resolves to
   unsigned; the pipeline drafts unsigned releases that fail-closed only if
   `RELEASE_EXPECT_SIGNED=true` with missing credentials). The unsigned
   prerelease path is the documented development mode.
4. Website dev: `apps/website/.env.example` documents `SITE_URL`/`SITE_BASE`/
   `ANALYTICS_DOMAIN` — all public.
5. Only the maintainer (or an explicitly delegated release lead) sets the
   signing secrets, in GitHub repository settings per
   [ci-secrets.md](../release/ci-secrets.md).

---

## 6. CI permission matrix (summary)

See the per-workflow `permissions:` blocks; `scripts/security/workflow-policy.mjs`
enforces the whitelist. The full trust-zone model (which workflow may consume
which credential class, and the machine-enforced deny-lists for backend/DNS
secrets) lives in [trust-boundaries.md](trust-boundaries.md).

| Workflow | Privileged surfaces | Why |
|---|---|---|
| `ci.yml` | `issues: write` on the four debug-comment jobs | Posting PR debug comments; nothing else |
| `build.yml`, `e2e-keyboard-nav.yml`, `model-validation.yml`, `quantize.yml`, `ci-smoke.yml` | none (`contents: read`) | Test/build only |
| `ci-debug.yml` | `actions: read` | Reading run/job metadata for the failure report |
| `website-deploy.yml` | `pages: write` + `id-token: write` **only on the deploy job** | Pages deployment; the test/build jobs stay read-only |
| `visual-baselines.yml` | `contents: write` (manual dispatch only) | Commits refreshed PNG baselines to master |
| `release.yml` | `draft`/`publish`: `contents: write`; `verify`: `id-token` + `attestations`; `release-publish` environment approval | Draft creation + gated publication; attestation of final bytes |

Deliberately absent: `pull_request_target` triggers (none), `secrets: inherit`
(none), signing secrets outside `release.yml` (none), signing material in
`$GITHUB_ENV` (none — enforced by policy).

## 7. GitHub settings

The following repository settings are part of the security model and live in
GitHub, not in git: secret scanning + push protection, vulnerability alerts
+ automated security fixes (Dependabot), CodeQL default setup, the default
Actions token (read-only), branch/tag rulesets (block force-push and
deletion; tag ruleset blocks force-updates), and the `release-publish`
environment's required reviewers. Owner checklist: `docs/release/ci-secrets.md`
§9 plus the rulesets under Settings → Rules.

## 8. Client-build and artifact gates (defense-in-depth)

Every client build now fails closed on secret ingress and every client
artifact is scanned after the build:

- **Environment guard** (`scripts/security/validate-client-env.mjs`, run
  inside the website and desktop build scripts): client-safe allowlist
  (SITE_URL, SITE_BASE, ANALYTICS_DOMAIN; VITE_BASE_URL, VARVE_* metadata,
  TAURI_DEBUG) with value validation, plus a hard deny-list for signing,
  backend, DNS and PRIVATE_/SIGNING_/DNS_ credential classes. The two
  documented exceptions — the CI canary and the release signing-step flag —
  are described in [trust-boundaries.md](trust-boundaries.md) §5.
- **Artifact scans** (`scripts/secret-scan.mjs --dir`, wired into ci.yml,
  website-deploy.yml and release.yml): the built website and desktop dist
  are scanned for credential-shaped content after every build, including
  binaries' text content as far as text files go.
- **Canary tests**: CI sets `VARVE_PRIVATE_TEST_CANARY` on build steps and
  asserts it never appears in the output.
- **Import boundaries** (`scripts/security/import-boundaries.mjs`): apps
  never import each other; packages never import apps; the reserved future
  backend location is unreachable from client code.
- Run locally with `pnpm audit:secrets`, `pnpm audit:clientenv`,
  `pnpm audit:artifacts`, `pnpm audit:boundaries`.
