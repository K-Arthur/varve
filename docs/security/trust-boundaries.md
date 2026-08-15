# Varve Trust Boundaries

This document is the architectural contract for Varve's security trust
separation: what is public, what is privileged, who may consume which
credential, and how a future backend fits without sharing trust with the
clients that share this repository.

**The governing principle:**

> Code may be shared. Trust must not be shared implicitly.

Varve is several systems that happen to share one Git repository:

```
SOURCE SHARING != TRUST SHARING
```

A GitHub Secret is a mechanism for safely giving a **workflow operation** a
credential. It is **not** a mechanism for secretly distributing that
credential to end users. If a website bundle or a Varve desktop binary needs a
value in order to function, assume the user can obtain the value.

Companion documents: [Security Hardening](security-hardening.md) (classification,
compromise response, release trust), [CI Secrets, Permissions and Release
Environment](../release/ci-secrets.md) (secret inventory + rotation),
[SECURITY.md](../../SECURITY.md) (vulnerability reporting).

**No real credential value appears anywhere in this repository, and none ever
may.**

---

## 1. Trust zones

### Zone A — Public / shared source (`packages/`)

Code that is safe for any client to consume: types, schemas, DTOs, validation,
constants, design tokens, icons, pure utilities, formatting functions, public
cryptographic verification helpers.

It must never contain: private credentials, backend secrets, signing private
keys, privileged API clients initialized with secret keys, account passwords,
infrastructure credentials.

### Zone B — Static website (`apps/website/`)

An **untrusted public client**. Everything generated into the deployed site is
public: URLs, feature flags, analytics IDs, OAuth client IDs, API base URLs,
download URLs, public verification keys. It must not contain confidential
credentials.

### Zone C — Desktop client (`apps/desktop/`)

Another **untrusted public client**. A native binary is not a secret store:
assume motivated users can inspect bundled JavaScript, Rust binary strings,
resources, archives, update metadata, network requests, runtime storage,
source maps and configuration files.

### Zone D — Ordinary CI

PR/push validation with little or no privilege: checkout, lint, typecheck,
unit/integration/E2E tests, non-production builds, security scanning. It must
not possess production signing credentials, registrar credentials, cloud or
database credentials, production API keys, or release publishing authority.

### Zone E — Website deployment

One responsibility: build and deploy the static website. Receives only the
permissions needed for GitHub Pages (`contents: read`, `pages: write`,
`id-token: write` on the deploy job). Zero desktop signing secrets.

### Zone F — Application release/signing

The privileged production boundary: packaging, Windows signing, macOS
signing/notarization, future updater signing, provenance, attestations,
checksums, draft/release publication. Its credentials must never become
available to ordinary CI, website builds, fork PRs, or unrelated workflows.

### Zone G — Future backend (does not exist yet)

When Varve needs confidential server-side functionality, it gets its own trust
domain (`api.varve.studio`). Only the backend may hold service secrets. See
§10.

---

## 2. Trust-boundary diagrams

```
                  PUBLIC / UNTRUSTED CLIENTS
        +--------------------+--------------------+
        |                                         |
   apps/website                            apps/desktop
        |                                         |
        +------------- packages/ (shared) --------+
                         |
                         | HTTPS (future)
                         v
                api.varve.studio  (future)
                         |
                  TRUSTED SERVER
                         |
          +--------------+---------------+
          v              v               v
      Database      Private APIs     Service secrets
```

```
                    GITHUB ACTIONS

PR / CI (ci.yml, build.yml, ...)
  |  contents: read only; no production secrets of any class
  |
Website Deploy (website-deploy.yml)
  |  Pages authority only (contents: read, pages: write, id-token: write)
  |  zero signing/backend/DNS credentials
  |
Application Release (release.yml)
  |  tags + manual dispatch only; draft never auto-published
  |  signing credentials on the signing steps only (never $GITHUB_ENV)
  |  publish requires the release-publish environment approval
  |
Backend Deploy (future)          -> backend/cloud authority only
DNS Automation (only if needed)  -> DNS authority only
```

---

## 3. The most important rule

```
GitHub Secret
      |
      v
GitHub Actions
      |
      v
website JS / desktop binary
      |
      v
end user
```

If a value crosses that path, **it is public**. This is appropriate for
*operations* (sign → distribute the signature), never for *distribution* of
the secret itself:

```
GitHub Secret -> release runner -> codesign/notarize artifact -> secret discarded -> signed artifact distributed
```

is legitimate. The following is a security failure:

```
GitHub Secret -> Vite/Astro/Tauri build variable -> application bundle -> "user cannot see it"
```

Varve therefore enforces: clients receive **public configuration only**
(§5), private credential classes are denied from client build environments
(§6), and client artifacts are scanned after every build (§7).

---

## 4. Environment-variable ingress audit (2026-08-12)

Every path by which environment values can enter a build:

| Source | Consumers | Sanctioned values | Notes |
|---|---|---|---|
| `process.env` | `apps/website/astro.config.mjs` | `SITE_URL`, `SITE_BASE` | Validated by the env guard before the build |
| `import.meta.env` | `apps/website/src` (Layout.astro, SiteHeader, siteUrl.ts) | `ANALYTICS_DOMAIN`, `BASE_URL`, `SITE` (Astro-injected) | Only Astro-injected or guard-validated values |
| `import.meta.env` | `apps/desktop/src/security/cspDiagnostics.ts` | `DEV` (Vite built-in) | Stripped from production builds |
| `process.env` | `apps/desktop/vite.config.ts` | `VITE_BASE_URL`, `VARVE_APP_VERSION`, `VARVE_BUILD_CHANNEL`, `VARVE_RELEASE_ID`, `VARVE_GIT_COMMIT` | Public metadata only; `envPrefix: ['VITE_', 'TAURI_']` |
| `env!` / `option_env!` | Rust crates + `apps/desktop/src-tauri` | `CARGO_MANIFEST_DIR`, `CARGO_PKG_VERSION` only | Cargo metadata, not secrets; no `option_env!` in use |
| `beforeBuildCommand` | `apps/desktop/src-tauri/tauri.conf.json` | runs `pnpm build` (guard-validated) | The signed release step re-runs it with signing credentials in env — guarded by the documented `VARVE_SIGNING_STEP_ALLOWED` exception (§6) and re-scanned (§7) |
| `${{ secrets.* }}` / `${{ vars.* }}` | workflows | see the Workflow matrix (§9) | Policy-enforced deny-list per trust zone (§8) |
| `.env` loading | none (no dotenv in the workspace) | — | `.env*` is gitignored; only `.env.example` is committed |

**Dataflow for sensitive configuration:** repository secrets → the exact
release step that needs them → signing tool → destroyed. Nothing sensitive is
declared at workflow or job scope in release.yml except on the signing steps
themselves, nothing is persisted through `$GITHUB_ENV`, and nothing is passed
to any client build.

---

## 5. Client-safe configuration schema

Client builds consume **only** the variables below. Everything else in the
build environment is either tolerated CI infrastructure (never consumed) or a
policy violation.

| Variable | App | Purpose | Valid values |
|---|---|---|---|
| `SITE_URL` | website | Canonical origin | absolute http(s) URL |
| `SITE_BASE` | website | Deployment base path | path starting with `/` |
| `ANALYTICS_DOMAIN` | website | Analytics host (empty = disabled) | empty or bare hostname |
| `VITE_BASE_URL` | desktop | Asset base path | path starting with `/` |
| `VARVE_APP_VERSION` | desktop | Version metadata | semver or empty |
| `VARVE_BUILD_CHANNEL` | desktop | `dev` / `stable` … | `[a-z0-9-]+` or empty |
| `VARVE_RELEASE_ID` | desktop | Release identifier | `[A-Za-z0-9_.-]+` or empty |
| `VARVE_GIT_COMMIT` | desktop | Commit metadata | 40-hex SHA or empty |
| `TAURI_DEBUG` | desktop | Debug build flag | `true`/`false`/empty |

Naming conventions (`PUBLIC_`, `VITE_`, `ASTRO_PUBLIC_`) are documentation
aids, **not** the source of truth: a variable is safe only if it is on this
table, and forbidden if denied, regardless of its prefix.

### Forbidden in every client build

| Class | Examples |
|---|---|
| Signing | `APPLE_*`, `WINDOWS_SIGNING_*`, `AZURE_SIGNING_*`, `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_UPDATER_PRIVATE_KEY*`, `AZURE_CLIENT_SECRET` |
| Backend | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DATABASE_*`, `REDIS_*`, `STRIPE_SECRET_KEY`, `SMTP_PASSWORD`, `WEBHOOK_SECRET`, `JWT_*`, `AWS_*`, `GOOGLE_APPLICATION_CREDENTIALS`, `SENDGRID_*`, `GITHUB_PAT` |
| DNS | `PORKBUN_*` |
| Naming families | `PRIVATE_*`, `SIGNING_*`, `DNS_*` |

Tauri itself injects the exact `TAURI_UPDATER_PLUGIN_CONFIG` variable while
running a native frontend build. It contains public updater metadata from
`tauri.conf.json` and is accepted only as valid JSON without private-key,
password, secret, token, or credential fields. Updater private keys remain
forbidden (`TAURI_UPDATER_PRIVATE_KEY*`).

### Documented exceptions

1. **`VARVE_PRIVATE_TEST_CANARY`** — the trust-boundary canary. CI sets it on
   client build steps on purpose so the artifact scan can prove the build
   embeds nothing it is not told to (§7). It carries no credential meaning.
2. **`VARVE_SIGNING_STEP_ALLOWED=1`** — set only on release.yml's Tauri build
   steps, which legitimately hold signing credentials in their process
   environment (Tauri re-runs the frontend build via `beforeBuildCommand`).
   The client-env guard yields for the **signing family only** when this flag
   is set; the resulting dist is always artifact-scanned. The flag may appear
   in no other workflow (enforced by `scripts/security/workflow-policy.mjs`).

### Enforcement

`scripts/security/validate-client-env.mjs` runs inside the app build scripts
(`apps/website` and `apps/desktop` `build`/`build:pages`), so every CI path and
every local build is covered. It fails the build on any forbidden class, and
validates allowlist values. It also audits the app's untracked `.env`,
`.env.local`, `.env.production` and `.env.development` files (Vite/Astro read
them at build time and they never enter `process.env`) — `.gitignore` is not
the only safeguard. `pnpm audit:clientenv` runs it for both apps.

---

## 6. Client-artifact secret scans

`scripts/secret-scan.mjs` gained two modes alongside the tracked/staged scans:

- `--dir <path>` — recursively scan build output (website `dist` +
  `dist-pages`, desktop `dist`) with the same credential rules. Binaries are
  skipped; the base64-certificate rule is length-bounded (500–32 000 chars)
  so bundler-inlined binary data (e.g. the wawoff2 WASM decoder) is not a
  false positive.
- `--canary <value>` — fail if the value appears anywhere in the scanned
  output.

Scans run in: `ci.yml` website-e2e (both modes + canary), `website-deploy.yml`
test and build jobs (canary on test, plain on the uploaded artifact),
`release.yml` bundle job (frontend dist after the Tauri build, + canary), and
locally via `pnpm audit:artifacts`.

### Canary tests

During CI, `VARVE_PRIVATE_TEST_CANARY=VARVE_PRIVATE_TEST_CANARY_DO_NOT_SHIP`
is deliberately present on client build steps; the artifact scan then asserts
the value is **absent** from the output. This is the ongoing proof that the
build systems embed only the allowlisted configuration — a regression in
`define`, `import.meta.env` exposure, or a new `.env` loader would trip it.
The canary value is deliberately not credential-shaped so external scanners
do not produce meaningless alerts.

---

## 7. Credential ownership matrix

Names and classes only — no values.

| Credential | Trust domain | Consumer | Embedded in client? |
|---|---|---|---|
| `SITE_URL`, `SITE_BASE`, `ANALYTICS_DOMAIN` | Public | Website build | Yes (by design) |
| `VITE_BASE_URL`, `VARVE_APP_VERSION`, `VARVE_BUILD_CHANNEL`, `VARVE_RELEASE_ID`, `VARVE_GIT_COMMIT` | Public | Desktop build | Yes (by design) |
| Updater public key (`TAURI_SIGNING_PUBLIC_KEY` class) | Public | Desktop | Yes (by design, future) |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_P8_BASE64`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Signing | `release.yml` bundle job (macOS) | Never |
| `AZURE_SIGNING_CLIENT_ID`, `AZURE_SIGNING_CLIENT_SECRET`, `AZURE_SIGNING_TENANT_ID` | Signing | `release.yml` bundle job (Windows) | Never |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (future updater) | Signing | Future updater signing step | Never |
| `RELEASE_EXPECT_SIGNED`, `AZURE_SIGNING_ACCOUNT/PROFILE/ENDPOINT` | Signing (repository variables, non-secret) | `release.yml` | Never |
| `GITHUB_TOKEN` | Runtime | Every workflow (default, read-only) | Never |
| `OPENAI_API_KEY` class, `DATABASE_*`, `STRIPE_*`, `SMTP_*`, `JWT_*`, `AWS_*` … | Backend | Future API server | Never |
| `PORKBUN_*` | DNS | None today; future DNS automation only | Never |

### Blast radius

| Credential | If compromised |
|---|---|
| Apple signing material | Attacker signs malicious binaries as Varve (gatekeeper trust) |
| Azure signing material | Same, on Windows |
| Updater private key | Attacker signs malicious updates for existing installs |
| Porkbun credential | Attacker alters DNS for `varve.studio` — redirects users |
| GitHub PAT | Depends entirely on token scopes; none should exist (use `GITHUB_TOKEN`/OIDC) |
| Backend secrets (future) | Data access, fraud, cost abuse — see §11 |

Blast radius decides protection strength: signing and DNS material get the
strongest controls (environment approval, minimal scope, rotation runbooks,
offline backup); a future backend key never enters this repository at all.

---

## 8. Workflow policy — machine-enforced deny-lists

`scripts/security/workflow-policy.mjs` encodes the trust-zone rules as
structural checks over every workflow (regression tests in
`workflow-policy.test.mjs`, run in `ci.yml` pipeline-validate):

1. No `pull_request_target` triggers.
2. No `secrets: inherit`.
3. Signing secrets live only in `release.yml`, on steps gated on signed mode.
4. PR-capable workflows reference only the default `GITHUB_TOKEN`.
5. `id-token: write` only where attestation/Pages needs it.
6. `attestations: write` only on the release verify job.
7. `actions: write` never.
8. `pages: write` only on the website-deploy deploy job.
9. `contents: write` only on release draft/publish and manual visual-baselines.
10. Debug-comment write scopes only on the ci.yml jobs that post them.
11. Signing credentials are never persisted through `$GITHUB_ENV`.
12. `publish` requires the `release-publish` environment + `publish=yes`
    dispatch input; website deploy requires `github-pages`.
13. Tag provenance: release preflight verifies the tag's commit is reachable
    from the default branch.
14. Every workflow declares explicit permissions.
15. Website-deploy checkouts persist no credentials.
16. **Backend/service and DNS credential classes are referenced by no
    workflow** — not even by name in `vars.` (DNS). A future
    `backend-deploy.yml` must extend the rule's explicit allowlist, never the
    denial. Signing, updater-private-key (`TAURI_SIGNING_PRIVATE_KEY` /
    `TAURI_UPDATER_PRIVATE_KEY`) and `WINDOWS_SIGNING_*` names are denied
    outside `release.yml`.
17. `permissions: write-all` never.
18. `VARVE_SIGNING_STEP_ALLOWED` may only be set inside `release.yml`.

The website and ordinary CI therefore cannot reference Apple/Windows signing
credentials, DNS credentials, or backend secrets — a future edit that tries
(e.g. a malicious website PR echoing `${{ secrets.APPLE_CERTIFICATE }}`) fails
`pipeline-validate` before any of it runs.

---

## 9. Workflow matrix

| Workflow | Triggers | Trust level | Permissions | Environment | Secrets | Output / capability |
|---|---|---|---|---|---|---|
| `ci.yml` | push, PR, schedule, dispatch | D — ordinary CI | `contents: read`; `issues: write` on 4 debug-comment jobs | — | `GITHUB_TOKEN` only | Test/lint/typecheck/E2E results, artifacts, PR comments. No publish |
| `build.yml` | push, PR (paths), dispatch | D | `contents: read` | — | none | WASM + dev bundles |
| `ci-smoke.yml` | dispatch only | D | `contents: read` | — | none | Pipeline health smoke |
| `e2e-keyboard-nav.yml` | push, PR (paths) | D | `contents: read` | — | none | Keyboard-nav E2E |
| `model-validation.yml`, `quantize.yml` | push, PR (paths), schedule, dispatch | D | `contents: read` | — | none | Model supply-chain validation |
| `visual-baselines.yml` | dispatch only | D+ | `contents: write` | — | none | Commits refreshed PNG baselines to master |
| `ci-debug.yml` | `workflow_run` (8 upstreams), completed | D | `contents: read`, `actions: read` | — | none | Failure reports (redacted) |
| `website-deploy.yml` | push (website paths), `workflow_run` (Release success), dispatch | E — website deploy | `contents: read`; deploy job: `pages: write`, `id-token: write` | `github-pages` (deploy job) | `GITHUB_TOKEN` only | Publishes the static site to GitHub Pages. **Cannot sign, cannot publish releases** |
| `release.yml` | tags `v*`, dispatch (tag + publish input) | F — release/signing | `contents: read` base; `verify`: `id-token`, `attestations`; `draft`/`publish`: `contents: write` | `release-publish` (publish job, required reviewers) | signing secrets on the signing steps only | Draft release + assets; publication only via human-approved dispatch. **Never triggered by website code paths** |

### Triggers and privilege escalation (§66–68)

- `ci.yml` has no path-based release trigger and references no production
  secrets, so website changes cannot cause signing.
- `release.yml` runs only on version tags (which require a protected-tag push)
  or manual dispatch with an explicit tag; desktop code landing on master
  never publishes anything by itself.
- `website-deploy.yml` never touches signing, DNS, or backend credentials.
- `ci-debug.yml` reads run metadata only; `scripts/ci-debug.mjs` redacts
  credential-shaped strings before snippets reach reports or PR comments.

### `workflow_run` audit (§29–30)

- `website-deploy.yml`'s `workflow_run` on **Release**: gated on
  `conclusion == 'success'`, and the job checks out `ref: master` — the
  protected default branch — never the tag or the triggering run's workspace.
  The site is built from master; release data comes from the GitHub API.
- `ci-debug.yml`'s `workflow_run`: reads metadata only, never checkout
  content. Both are covered by the policy test pass.

### Caches and reusable workflows (§31–32)

- No `workflow_call` reusable workflows exist; the policy rejects
  `secrets: inherit` should one appear.
- Release caches are keyed by tag (`gate-<tag>`, `bundle-<platform>-<tag>`),
  so a release never restores cache entries written by untrusted refs.
- No credential files are ever cached; signing material lives on the exact
  step's env, never `$GITHUB_ENV` (policy rule 11).
- Preferred policy where security matters more than speed: rebuild.

### Fork PRs (§33)

- No `pull_request_target` anywhere (policy rule 1).
- PR-capable workflows can reference only `GITHUB_TOKEN` (policy rule 4) —
  forked code never sees a repository secret.
- `actions/checkout` uses `persist-credentials: false` on website workflows
  and fetch depths tuned to need; release checkouts fetch full history only
  in preflight for the ancestry gate.

---

## 10. Future backend (Zone G)

Varve has no server-side functionality today, and this document does not
create any. When confidential server-side functionality is actually needed:

- **Location:** `apps/api/` (or `services/api/`) in this monorepo, with its
  own `backend-deploy.yml` workflow, own environment (e.g. `production-backend`),
  own secrets, and OIDC/workload identity where the host supports it.
- **Boundary:** `website -> contracts`, `desktop -> contracts`,
  `backend -> contracts` — clients never import backend implementation.
  `packages/contracts/` (or `packages/shared/` kept deliberately narrow)
  holds schemas, DTOs, enums and validation; the import-boundary audit
  already forbids client → `apps/api` and package → app imports, and
  `apps/api` would be added to it the day it exists.
- **Clients are public:** browser and desktop clients authenticate with a
  public-client scheme (Authorization Code + PKCE, short-lived access tokens,
  refresh rotation, device flow where appropriate, passkeys). Never ship a
  confidential OAuth client secret in the app.
- **`api.varve.studio` is a service, not a proxy:** authenticated,
  authorized, rate-limited, quota-enforced endpoints. Never a generic
  unauthenticated relay that hides an API key.
- **CORS is not security:** `Access-Control-Allow-Origin: https://varve.studio`
  proves nothing; the API enforces real auth and per-user resource ownership,
  and assumes requests can be handcrafted.
- **Server-side only:** `OPENAI_API_KEY`, `STRIPE_SECRET_KEY`, `DATABASE_URL`,
  `SMTP_*`, `JWT_*`, webhook secrets live in the server's secret store and its
  protected deployment environment — never in `.env.example`, source control,
  Docker images, frontend bundles or desktop binaries. The workflow policy
  and the client-env guard deny them in every client context today, so the
  boundary already exists before the backend does.
- **Abuse controls from day one:** per-user and global rate limits,
  request-size limits, cost controls on expensive AI calls, idempotency,
  webhook replay protection, account deletion/data retention, redacted logs
  (never `Authorization` headers, cookies, tokens, provider secrets).
- **Response schemas:** backend endpoints return only intended fields; never
  `return process.env` or raw provider objects.

### When a separate repository becomes worthwhile

Keep the monorepo while one team owns both clients and the boundary rules
above hold (they are machine-enforced). Reconsider a separate
backend/infrastructure repository when: separate teams need different
repository access; sensitive infrastructure config must not be editable by
all application contributors; compliance demands organizational separation;
release velocities diverge; or privileged workflow protection becomes
unmanageable inside the monorepo. A split is justified by an actual security
benefit, never by "security means separate repos".

---

## 11. Local development vs production

| Component | Local dev | CI | Production |
|---|---|---|---|
| Website | public config only | public config only | public config only |
| Desktop | public config only | public config only | public config only |
| App signing | none (unsigned dev builds) | none | protected signing secrets in `release.yml` only |
| Backend (future) | local/dev secrets, mock endpoints | test credentials | backend deployment environment |
| DNS | none | none | isolated DNS credentials if automation is ever added; manual DNS is the default |

Developers can clone and run website dev, desktop dev, tests and most CI
checks with zero production secrets. `apps/website/.env.example` documents the
three public website variables; desktop needs no env at all to build. There is
no root `.env` that aggregates credentials (and none may be added — a root
`source .env` would leak variables across every package; env is always
scoped to the consuming app).

---

## 12. GitHub settings that only the owner can configure

The rulesets, environments and protection settings below live in GitHub, not
in git. They are part of the model:

- Default Actions token: read-only.
- Branch ruleset on `master`: block force-push and deletion; require
  `pipeline-validate` and the other CI checks.
- Tag ruleset: block force-updates and deletion; release tags only.
- `github-pages` environment (exists; used by website-deploy deploy job).
- `release-publish` environment with **required reviewers** (exists; the
  required-reviewer checkbox is owner UI — see
  [ci-secrets.md](../release/ci-secrets.md) §7).
- Secret scanning + push protection, Dependabot alerts + auto-security-fixes.
- `varve.studio` external controls: Porkbun account MFA, transfer lock,
  registrar/domain lock, DNSSEC, HTTPS enforcement, GitHub Pages custom-domain
  verification (see [custom-domain-runbook](../release/custom-domain-runbook.md)).

## 13. Residual risks

- **Workflow definitions are editable by any contributor with push access.**
  A merged change to `release.yml` that passes the policy gates still runs
  with release privileges. The policy gates make privilege escalation
  structurally hard; CODEOWNERS and the required checks make it reviewable;
  but with a single maintainer, "required review" is not a hard gate.
- **Signing secrets are repository-level** today (documented decision,
  2026-08-08 in ci-secrets.md §7): a `production-signing` environment with
  required reviewers is the planned upgrade once a second maintainer exists.
- **`ci-debug.yml` runs on workflow completion of Release**: it reads
  metadata only and redacts, but it is a `workflow_run` consumer — its
  behavior is pinned by the exact workflow-name list, which must stay in sync
  if workflows are renamed.
- **GitHub environment branch/tag policies** are owner-configurable; nothing
  in git can force them to exist.
- **The canary and artifact scans cover text artifacts**; binary-string
  scanning of installers is a future forensic step (see
  [production-build.md](../release/production-build.md) debug-symbol plan).
