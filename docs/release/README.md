# Strata — Release Engineering

Everything about turning a commit into something a stranger can install and
trust. Start with the audit; it explains why the rest of these exist.

| Document | What it answers |
|---|---|
| [release-readiness-audit.md](release-readiness-audit.md) | Can this repository ship today? Evidence-backed findings, severity scorecard, and Phase 1 command results |
| [platform-support-matrix.md](platform-support-matrix.md) | Which OSes and architectures we actually support, and which we only claim to |
| [distribution-decision-matrix.md](distribution-decision-matrix.md) | Which channels to use now, later, and never — scored, with reasons |
| [budget-plan.md](budget-plan.md) | Exactly what to spend of the CAD $200, what not to, and why |
| [production-build.md](production-build.md) | Every build command, marked VERIFIED or UNVERIFIED, with real measurements |
| [update-strategy.md](update-strategy.md) | Why there is no updater yet, and the key-management procedure for when there is |
| [release-checklists.md](release-checklists.md) | Alpha / beta / RC / stable, plus hotfix, rollback and incident runbooks |
| [ci-secrets.md](ci-secrets.md) | Secret names, job permissions, and the enrolment steps a human must do |
| [website.md](website.md) | Site architecture, the generated download-manifest flow, hosting and launch checklist |
| [implementation-plan.md](implementation-plan.md) | P0–P3, with verification, risk, effort and cost per task |

## Tooling

`scripts/release/` — all zero-dependency Node, all runnable locally:

| Script | Purpose |
|---|---|
| `version.mjs` | Single-source the version across five manifests; CI gate on tag agreement |
| `check-bundled-assets.mjs` | Fail on LFS pointers, catalog disagreement, and unpinned model downloads |
| `prune-foreign-runtimes.mjs` | Drop other platforms' ONNX Runtime libraries before packaging |
| `collect-artifacts.mjs` | Rename to a predictable scheme, hash, write manifest + `SHA256SUMS.txt` |
| `merge-manifests.mjs` | Merge per-runner manifests, re-hashing from bytes on disk |
| `verify-artifacts.mjs` | Verify the exact files about to be uploaded |
| `generate-sbom.mjs` | CycloneDX 1.5 from both Cargo workspaces + pnpm + bundled binaries |
| `release-notes.mjs` | Notes from `CHANGELOG.md` + the manifest |
| `update-website-manifest.mjs` | Point the download page at a published release |

## The shape of a release

```
tag v0.1.0
   │
   ├── preflight   tag == version == changelog entry, or stop
   ├── gate        lint, typecheck, tests, clippy, cargo test
   ├── bundle      native runners; LFS fetch; prune; build; collect; hash
   ├── draft       merge, SBOM, verify, release notes, DRAFT release
   └── publish     manual approval, then public
```

A tag never publishes anything by itself. See
[.github/workflows/release.yml](../../.github/workflows/release.yml).

## Before you touch any of this

Two things that are easy to get wrong:

1. **Never ship a Linux package built on a dev machine.** The AppImage bundler
   copies the host's libraries, glibc included. A CachyOS build cannot run on
   the Ubuntu 22.04 baseline. Local packages are smoke tests only.

2. **Never label an artifact signed unless it was signed.** The
   `RELEASE_EXPECT_SIGNED` variable exists so a stable release fails loudly
   rather than shipping unsigned under a signed banner.
