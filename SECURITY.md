# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Varve, please report it
privately. Do not create a public GitHub issue, and do not disclose
the details publicly before we have coordinated a fix.

Contact: open a private advisory at
https://github.com/K-Arthur/varve/security/advisories

You should receive a response within 48 hours. If you do not, please
follow up via the same channel.

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest stable release | Yes |
| Previous stable release | Best effort, security fixes only |
| Prereleases (alpha/beta) | Best effort |
| Unreleased `master` | Yes (as source) |

The latest stable release is the only release guaranteed to receive
security patches. See `docs/release/release-checklists.md` for the
release cadence.

## What to include

- A clear description of the vulnerability
- Steps to reproduce (if applicable)
- The version(s) affected
- Any potential impact you have identified

## Scope

The following are in scope:
- The Varve application code (Rust, TypeScript)
- Build and distribution infrastructure (GitHub Actions, release/signing
  pipeline, the website deployment)
- Authentication and authorisation mechanisms (if any)

The following are out of scope:
- Third-party dependencies (report to their maintainers)
- Vulnerabilities in the Rust or Node.js ecosystems (report upstream)
- Theoretical attacks without practical exploit

## Handling process

1. **Acknowledge** the report within 48 hours via the advisory.
2. **Triage**: confirm severity, affected versions, and whether a fix is
   feasible.
3. **Fix and release**: a fix lands on `master`, then in the next stable
   release (or a patch release for critical issues).
4. **Disclosure**: once the fix is released, we coordinate public disclosure
   with the reporter and credit them unless they request anonymity.

We follow the coordinated-disclosure model: no public details before a
fix is available.

## Supply-chain and secret handling notes

- A compromised credential (signing key, token, CI secret) is treated as
  compromised even if the exposure was private or masked; see
  `docs/security/security-hardening.md` → Credential compromise response.
- The updater signing key, if ever created, is a critical release-security
  asset: losing or leaking it affects every installed client that trusts it.
  See `docs/release/update-strategy.md`.
- All third-party GitHub Actions are pinned to full commit SHAs and the
  pin table is verified in CI (`scripts/pin-github-actions.mjs`).
- Secret scanning is enabled on this repository (repository settings);
  suspected leaked credentials should be reported through an advisory
  even if GitHub's scanning has already flagged them.
