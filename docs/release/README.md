# Varve — Release Engineering

Everything about turning a commit into something a stranger can install and
trust. Start with the audit; it explains why the rest of these exist.

The [0.5.0 repository inventory and dependency review](../repository-hygiene-progress.md#release-history-and-dependency-review-2026-10-02)
records retained/deleted files, outgoing-history checks, Dependabot disposition,
and the generated Flatpak source inventory. It does not certify release
artifacts; the exact-SHA candidate and publishing gates below still apply.

The [0.5.0 execution log](0.5.0-release-execution.md) records the immutable
product tag, hosted certification, recovery build, and completed October 9
publication. Older checkpoint entries remain historical evidence.

| Document | What it answers |
|---|---|---|
| [release-readiness-audit.md](release-readiness-audit.md) | Historical 2026-08-03 readiness audit; use the current support matrix and execution record for present status |
| [platform-support-matrix.md](platform-support-matrix.md) | Which OSes and architectures we actually support, and which we only claim to |
| [platform-build-requirements.md](platform-build-requirements.md) | Native build/runtime packages, exact tooling pins, dependency ownership and early five-platform contracts |
| [native-acceleration-support.md](native-acceleration-support.md) | Which GPU/NPU workload routes are implemented, verified, experimental, or unavailable |
| [chromeos-linux.md](chromeos-linux.md) | ChromeOS Linux (Crostini) ARM64/x86_64 install, update, uninstall, and hardware-check contract, with the Stage 5 artifact evidence |
| [distribution-decision-matrix.md](distribution-decision-matrix.md) | Which channels to use now, later, and never — scored, with reasons |
| [../distribution/microsoft-store.md](../distribution/microsoft-store.md) | Microsoft Store MSIX build, Partner Center identity placeholders, and listing copy |
| [signing-decision-record.md](signing-decision-record.md) | The current code-signing strategy per platform, with sources and prices (2026-08-08) |
| [code-signing-setup.md](code-signing-setup.md) | Human-only acquisition checklist: Apple, Azure, GitHub — tick off every step |
| [signing-rotation-runbook.md](signing-rotation-runbook.md) | Certificate/membership/secret expiry calendar: 90/60/30/7-day drill |
| [signing-incident-runbook.md](signing-incident-runbook.md) | Credential-compromise procedure: stop, revoke, scope, remediate, notify |
| [budget-plan.md](budget-plan.md) | Exactly what to spend of the CAD $200, what not to, and why |
| [production-build.md](production-build.md) | Every build command, marked VERIFIED or UNVERIFIED, with real measurements |
| [update-strategy.md](update-strategy.md) | Consent-first updater design, package authority, production gates, and key management |
| [release-checklists.md](release-checklists.md) | Alpha / beta / RC / stable, plus hotfix, rollback and incident runbooks |
| [release-candidate-runbook.md](release-candidate-runbook.md) | Exact-SHA candidate certification, tag precondition, resumable packaging, and release-data deployment |
| [release-rollback-runbook.md](release-rollback-runbook.md) | Full rollback procedure: detection, containment, website re-pointing, updater recovery, communication, manual-update path |
| [ci-secrets.md](ci-secrets.md) | Secret names, job permissions, and the enrolment steps a human must do |
| [website.md](website.md) | Site architecture, the generated download-manifest flow, hosting and launch checklist |
| [implementation-plan.md](implementation-plan.md) | Historical 2026-08 release implementation plan; checkboxes and costs describe that plan, not current work |

## Tooling

Identity, artifact and trust helpers under `scripts/release/` use Node built-ins.
Installed-product qualification under `production/` uses the frozen workspace
automation dependencies and runs on each matching native runner. Recovery
uses workflow-pinned adapters beside the certified product checkout, retaining
tagged fixtures and actual installer bytes. Windows uses a temporary,
Varve-specific HKLM debug/profile policy on disposable hosted runners because
current WebView2 ignores elevated environment overrides; prior values are
restored after qualification. This policy never enters shipped configuration:


| Script | Purpose |
|---|---|
| `version.mjs` | Single-source the version across nine manifests (see TARGETS array in source); `verify` gate on tag agreement **and on every push** (ci.yml `pipeline-validate`); `bump`/`snapshot` for the post-release bump and dev builds |
| `certification.mjs` / `verify-certification.mjs` | Verify exact-SHA integration/candidate checks and the policy-bound candidate artifact before release setup |
| `resume.mjs` / `write-artifact-provenance.mjs` | Validate reusable platform artifacts and assemble a complete exact-SHA manifest without mixing releases |
| `select-run-artifacts.mjs` | Select explicit same-run artifact IDs from each newest successful producer attempt, then verify downloaded installer bytes against the certified tag SHA and policy |
| `website-release-data-check.mjs` | Validate published release-data changes without rerunning the website source corpus |
| `check-bundled-assets.mjs` | Fail on LFS pointers, catalog disagreement, and unpinned model downloads |
| `prune-foreign-runtimes.mjs` | Drop other platforms' ONNX Runtime libraries before packaging |
| `collect-artifacts.mjs` | Rename to a predictable scheme, hash, write manifest + `SHA256SUMS.txt` |
| `report-installer-size.mjs` | Decompose NSIS installers (7-Zip), compare against `installer-size-baseline.json`, warn/block on unexplained growth, emit the per-release size report (override: `--override-reason`, wired to the `size_gate_override` dispatch input) |
| `merge-manifests.mjs` | Merge per-runner manifests (and signing reports), re-hashing from bytes on disk |
| `verify-artifacts.mjs` | Verify the exact files about to be uploaded |
| `verify-draft-release.mjs` | Authenticate draft checksums against the tag workflow or an explicit accepted-master recovery build; independently verify certified-tag installer provenance and every downloaded asset before publication |
| `signing-policy.mjs` | The signing rules: channel policy, secret-presence checks, report normalization, fail-closed trust verification |
| `resolve-signing-policy.mjs` | CLI used by `signing-preflight`; consumes presence booleans only, prints per-platform modes |
| `verify-release-trust.mjs` | The trust gate: merge manifests + signing reports, enforce the channel policy, fail closed |
| `verify-windows-signature.ps1` | Authenticode verification (`Get-AuthenticodeSignature` + `signtool verify /pa`) → BOM-free JSON report, retained separately for each architecture |
| `verify-macos-signature.sh` | `codesign` + `spctl` + `stapler` verification of the DMG/.app → JSON report |
| `generate-sbom.mjs` | CycloneDX 1.5 from both Cargo workspaces + pnpm + bundled binaries |
| `release-notes.mjs` | Notes from `CHANGELOG.md` + the manifest (trust section derives from the signing block) |
| `update-website-manifest.mjs` | Point the download page at a published release |
| `product.mjs` | Product identity constants shared by the release scripts |
| `publish-model-assets.mjs` | Upload on-demand AI models to the models release |
| `verify-package-install.sh` | Install-test `.deb`/`.rpm` in clean Ubuntu/Fedora containers |
| `production/` | Qualify installed release payloads against the prior published 0.2.1 disk seed: same-profile upgrade, save/reopen, edit/undo and PNG/SVG/PDF exports; native Linux, Windows, and macOS runner workflows |

Signing policy and trust-gate logic is unit-tested by
`scripts/release/signing-policy.test.mjs` (wired into `pnpm test:ci:tools`).

## The shape of a release

```
freeze exact master SHA
   │
   ├── candidate           extended exact-SHA matrix + policy-bound evidence
   ├── tag preflight       tag == version == changelog + exact certifications, or stop
   ├── signing-preflight  resolve signed or manual-download contingency
   ├── native-contracts   exact native Node/dependency probes on all five targets
   ├── bundle             native runners; sign when configured; verify the
   │                      artifact bytes (signing-report-*.json); collect; hash;
   │                      report installer size (Windows, gate v. baseline)
   ├── package-smoke      container install + native production/upgrade (Linux)
   ├── platform-smoke     native production/upgrade + package trust (Win/macOS)
   ├── verify             merge + trust gate + SBOM + FINAL checksums +
   │                      GitHub attestation of the final bytes + notes
   ├── draft              DRAFT release from the verified set; re-verify upload
   └── publish            explicit dispatch + fresh actual draft verification,
                          then public (environment approval if configured)
```

A tag never publishes anything by itself. v0.5.0 demonstrates that platform
code signing and updater-feed signing are separate: its Windows/macOS
installers are unsigned, while its published Tauri update feeds carry verified
signatures. See
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
