# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Varve, please report it
privately. Do not create a public GitHub issue, and do not disclose
the details publicly before we have coordinated a fix.

Contact: open a private advisory at
https://github.com/K-Arthur/varve/security/advisories

You may also email [security@varve.studio](mailto:security@varve.studio). Do not
send vulnerability details through a public issue or discussion. Do not include
unnecessary personal data or destructive test results.

Reports are reviewed as capacity allows. If you do not receive an acknowledgement,
follow up through the same private channel.

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

1. **Acknowledge** the report via the advisory or security email.
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

## Known dependency advisories and mitigations

The repository is checked against the GitHub Dependabot API and the resolved
dependency graphs. On 2026-08-22, GitHub reported no Dependabot alerts,
`cargo audit` reported no Rust vulnerabilities, and `pnpm audit` reported one
remaining development-only advisory. The remaining advisory is mitigated
locally because its upstream package has not published a fixed release.

- **GHSA-jmr9-qjv8-65gv — extract-zip 2.0.1 (npm, dev-only)**. Unvalidated
  symlink path traversal during archive extraction. No patched release
  exists on npm (2.0.1 remains the latest published version).
  Pulled in only by `@wdio/utils -> @puppeteer/browsers` for downloading
  official browser binaries in the dev/test toolchain — archives are
  trusted, downloads are pinned by checksum, and the code path never runs
  in production. A pnpm patch rejects absolute and out-of-tree symlink
  targets before extraction; the lockfile and
  `scripts/security/dependency-hardening.test.mjs` enforce that patch.
  Tracked upstream; re-check on each alert review.

- **GHSA-ggr8-5vv4-36mx — deepmerge-ts 7.1.5 (npm, dev-only)**. Recursive
  object graphs can exhaust the stack. WDIO still declares the vulnerable
  7.x range, so the workspace pins the compatible patched 8.0.0 release via
  a documented override. The resolved graph no longer contains 7.x; remove
  the override when WDIO widens its dependency range.

- **GHSA-wrw7-89jp-8q8g — glib 0.18.x (cargo, desktop runtime)**.
  Unsoundness in `Iterator`/`DoubleEndedIterator` impls for
  `glib::VariantStrIter`; fixed in glib 0.20.0. The whole gtk-rs 0.18 stack
  (gtk/gdk/gio/pango/atk, pulled by `tao`, `wry`, `tray-icon`, `tauri`)
  is still pinned by Tauri 2.11.x — the latest release — so a fix is
  blocked upstream. Exploitability here is minimal: GVariant string
  iteration is not reachable from user-controlled IPC data (Tauri IPC uses
  its own serialization, not GVariant). Re-evaluate when Tauri migrates to
  the gtk-rs 0.20 line.
