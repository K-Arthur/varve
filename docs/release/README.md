# Varve — Release Engineering

Everything about turning a commit into something a stranger can install and
trust. Start with the audit; it explains why the rest of these exist.

| Document | What it answers |
|---|---|---|
| [release-readiness-audit.md](release-readiness-audit.md) | Can this repository ship today? Evidence-backed findings, severity scorecard, and Phase 1 command results |
| [platform-support-matrix.md](platform-support-matrix.md) | Which OSes and architectures we actually support, and which we only claim to |
| [distribution-decision-matrix.md](distribution-decision-matrix.md) | Which channels to use now, later, and never — scored, with reasons |
| [signing-decision-record.md](signing-decision-record.md) | The current code-signing strategy per platform, with sources and prices (2026-08-08) |
| [code-signing-setup.md](code-signing-setup.md) | Human-only acquisition checklist: Apple, Azure, GitHub — tick off every step |
| [signing-rotation-runbook.md](signing-rotation-runbook.md) | Certificate/membership/secret expiry calendar: 90/60/30/7-day drill |
| [signing-incident-runbook.md](signing-incident-runbook.md) | Credential-compromise procedure: stop, revoke, scope, remediate, notify |
| [budget-plan.md](budget-plan.md) | Exactly what to spend of the CAD $200, what not to, and why |
| [production-build.md](production-build.md) | Every build command, marked VERIFIED or UNVERIFIED, with real measurements |
| [update-strategy.md](update-strategy.md) | Consent-first updater design, package authority, production gates, and key management |
| [release-checklists.md](release-checklists.md) | Alpha / beta / RC / stable, plus hotfix, rollback and incident runbooks |
| [release-rollback-runbook.md](release-rollback-runbook.md) | Full rollback procedure: detection, containment, website re-pointing, updater recovery, communication, manual-update path |
| [ci-secrets.md](ci-secrets.md) | Secret names, job permissions, and the enrolment steps a human must do |
| [website.md](website.md) | Site architecture, the generated download-manifest flow, hosting and launch checklist |
| [implementation-plan.md](implementation-plan.md) | P0–P3, with verification, risk, effort and cost per task |

## Tooling

`scripts/release/` — all zero-dependency Node, all runnable locally:

| Script | Purpose |
|---|---|
| `version.mjs` | Single-source the version across five manifests; `verify` gate on tag agreement **and on every push** (ci.yml `pipeline-validate`); `bump`/`snapshot` for the post-release bump and dev builds |
| `check-bundled-assets.mjs` | Fail on LFS pointers, catalog disagreement, and unpinned model downloads |
| `prune-foreign-runtimes.mjs` | Drop other platforms' ONNX Runtime libraries before packaging |
| `collect-artifacts.mjs` | Rename to a predictable scheme, hash, write manifest + `SHA256SUMS.txt` |
| `report-installer-size.mjs` | Decompose NSIS installers (7-Zip), compare against `installer-size-baseline.json`, warn/block on unexplained growth, emit the per-release size report (override: `--override-reason`, wired to the `size_gate_override` dispatch input) |
| `merge-manifests.mjs` | Merge per-runner manifests (and signing reports), re-hashing from bytes on disk |
| `verify-artifacts.mjs` | Verify the exact files about to be uploaded |
| `signing-policy.mjs` | The signing rules: channel policy, secret-presence checks, report normalization, fail-closed trust verification |
| `resolve-signing-policy.mjs` | CLI used by `signing-preflight`; consumes presence booleans only, prints per-platform modes |
| `verify-release-trust.mjs` | The trust gate: merge manifests + signing reports, enforce the channel policy, fail closed |
| `verify-windows-signature.ps1` | Authenticode verification (`Get-AuthenticodeSignature` + `signtool verify /pa`) → JSON report |
| `verify-macos-signature.sh` | `codesign` + `spctl` + `stapler` verification of the DMG/.app → JSON report |
| `generate-sbom.mjs` | CycloneDX 1.5 from both Cargo workspaces + pnpm + bundled binaries |
| `release-notes.mjs` | Notes from `CHANGELOG.md` + the manifest (trust section derives from the signing block) |
| `update-website-manifest.mjs` | Point the download page at a published release |
| `product.mjs` | Product identity constants shared by the release scripts |
| `publish-model-assets.mjs` | Upload on-demand AI models to the models release |
| `verify-package-install.sh` | Install-test `.deb`/`.rpm` in clean Ubuntu/Fedora containers |

Signing policy and trust-gate logic is unit-tested by
`scripts/release/signing-policy.test.mjs` (wired into `pnpm test:ci:tools`).

## The shape of a release

```
tag v0.1.0
   │
   ├── preflight          tag == version == changelog entry, or stop
   ├── gate               lint, typecheck, tests, clippy, cargo test
   ├── signing-preflight  resolve signed or manual-download contingency
   ├── bundle             native runners; sign when configured; verify the
   │                      artifact bytes (signing-report-*.json); collect; hash;
   │                      report installer size (Windows, gate v. baseline)
   ├── package-smoke      clean-container install + headless launch (Linux)
   ├── platform-smoke     install/mount + launch + uninstall (Win/macOS)
   ├── verify             merge + trust gate + SBOM + FINAL checksums +
   │                      GitHub attestation of the final bytes + notes
   ├── draft              DRAFT release from the verified set; re-verify upload
   └── publish            manual approval, then public
```

A tag never publishes anything by itself. See
[.github/workflows/release.yml](../../.github/workflows/release.yml).

When `RELEASE_EXPECT_SIGNED` is unset and signing credentials are not yet
available, the release remains publishable as an explicitly unsigned,
manual-download release. The workflow omits updater assets until the updater
private key exists; it never silently downgrades a release that explicitly
requires signatures.

## Before you touch any of this

Two things that are easy to get wrong:

1. **Never ship a Linux package built on a dev machine.** The AppImage bundler
   copies the host's libraries, glibc included. A CachyOS build cannot run on
   the Ubuntu 22.04 baseline. Local packages are smoke tests only.

2. **Never label an artifact signed unless it was signed.** Signedness derives
   exclusively from the post-build verification reports
   (`verify-windows-signature.ps1` / `verify-macos-signature.sh`), merged into
   the manifest by `verify-release-trust.mjs`. `RELEASE_EXPECT_SIGNED=true`
   makes the release fail closed in `signing-preflight` when credentials are
   missing — before any build starts.
