# Varve — Release Checklists

**Date:** 2026-08-03

These are working checklists, not ceremony. Anything that can be automated has
been; what remains is the judgement a script cannot make — mostly "did you
actually run the thing you are about to hand to strangers."

---

## Alpha (first external testers)

Goal: a small number of people can install Varve on Linux and it does not
destroy their work.

**Blockers — none of this ships until every box is ticked**

- [ ] `node scripts/release/check-bundled-assets.mjs` passes
      (no LFS pointers where models should be; the two model catalogs agree)
- [ ] `node scripts/release/version.mjs verify v<X.Y.Z>` passes
- [ ] `CHANGELOG.md` has a `## [X.Y.Z]` section written for users, not for git
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` pass
- [ ] `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace` pass
- [ ] A Linux package built **in CI** (not on the dev machine — glibc)
- [ ] The release workflow's automated gates all pass before a draft exists:
      gate job (frontend built before desktop compile), bundle matrix,
      `package-smoke` (`.deb`/`.rpm` install into clean ubuntu:22.04 and
      fedora:38 containers; AppImage launches headlessly under Xvfb),
      `platform-smoke` (Windows NSIS silent install + launch + uninstall on a
      Windows runner; macOS DMG mount + structure/arch checks + launch +
      unmount on a macOS runner)
- [ ] Draft release created with: installers, `release-manifest.json`,
      per-platform + combined SBOMs, `SHA256SUMS.txt` generated **last** from
      the final upload set
- [ ] `node scripts/release/verify-artifacts.mjs --dir dist/release` passes
- [ ] `node scripts/release/verify-downloaded.mjs` passes against the draft's
      re-downloaded assets (uploaded bytes reproduce every published hash)
- [ ] SHA-256 checksums published and independently verified from a second machine
- [ ] SBOM validated with `node scripts/release/validate-sbom.mjs`

**Install verification — on a machine that has never built Varve**

- [ ] Fresh install from the artifact, not the build tree
- [ ] First launch: window appears, no crash, no console spew
- [ ] Create a document, draw something, save it
- [ ] Quit, relaunch, reopen the saved document — content intact
- [ ] Save As to a path containing a space and a non-ASCII character
- [ ] Export to at least one format
- [ ] Launch with networking disabled — must work; Varve is local-first
- [ ] Uninstall: application removed, **user documents preserved**

**Honesty**

- [ ] Download page trust labels derive from the manifest `signing` block
      (verified state), never from intent
- [ ] Unsigned platforms say so, with the OS warning per platform
- [ ] No platform is listed that has not actually been launched
- [ ] Data-loss warning is visible before the download button, not below it
- [ ] Release notes describe real changes

---

## Beta (public, still early)

Everything in Alpha, plus:

- [ ] Tested on **two non-Arch distributions** (Ubuntu LTS + Fedora) in VMs
- [ ] Tested on Wayland **and** X11/XWayland
- [ ] Windows build launched on real Windows 10 or 11
- [ ] macOS build launched on a real Mac, or macOS is **not advertised**
- [ ] Upgrade from the previous version tested on each supported OS
- [ ] Downgrade behaviour known and documented
- [ ] `.varve` file association works: double-click opens the document
      (legacy `.strata` association also registered — both must open)
- [ ] High-DPI: 125%, 150%, 200% scaling checked on Windows
- [ ] Light, dark, and high-contrast themes checked
- [ ] Keyboard navigation and visible focus checked on primary flows
- [ ] Runs on a 4 GB RAM machine (or VM constrained to 4 GB)
- [ ] Behaviour without GPU acceleration verified (software rendering)
- [ ] Corrupt-config recovery: delete/garble the config, app still starts
- [ ] Privacy policy matches actual behaviour — every network request accounted for
- [ ] `THIRD_PARTY_NOTICES` covers every shipped model, font, icon set and binary
- [ ] Security contact tested: send a report to it and confirm it arrives

---

## Release candidate

- [ ] No known data-loss bug, open or closed-but-unverified
- [ ] All P0 and P1 items in the audit closed
- [ ] Full install/upgrade/uninstall matrix passed on every supported OS
- [ ] Artifacts built from a clean checkout at the exact tag
- [ ] Checksums verified from a machine that did not build them
- [ ] Rollback rehearsed: previous version reinstalled over this one successfully

---

## Stable

- [ ] Everything above
- [ ] `RELEASE_EXPECT_SIGNED=true` is set (repo variable)
- [ ] `signing-preflight` resolved `signed` for every platform being built
- [ ] Windows: installer carries a valid Authenticode signature —
      `signing-report-windows.json` says `verification: valid`, and the
      publisher shown in UAC matches the verified legal name
- [ ] macOS: signed with **Developer ID Application**, notarised, and
      **stapled** — `signing-report-macos.json` shows signed/notarized/stapled
      all true, hardened runtime present, Team ID correct
- [ ] `release-manifest.json` `signing` block matches the reports; `signed`
      reflects evidence, never intent
- [ ] Checksums were generated after signing (they always are — the trust gate
      runs before `generate-final-checksums`)
- [ ] Final bytes attested (`gh attestation verify <file> -R K-Arthur/varve`)
- [ ] Notarisation verified on a real Mac: `spctl -a -vv -t exec Varve.app`
      and `xcrun stapler validate Varve.dmg`
- [ ] Windows: installed-app signature status checked and recorded (NSIS
      payloads are unsigned — expected and documented)
- [ ] Support channel staffed — someone is actually reading it
- [ ] Previous release remains downloadable (rollback target)

---

## Emergency hotfix

1. [ ] Branch from the **release tag**, not from `master`
2. [ ] Fix only the one thing. Resist everything else
3. [ ] Add a regression test that fails without the fix
4. [ ] `just release-bump patch` (or `node scripts/release/version.mjs set <X.Y.Z+1>` for a specific number), then `cargo check --workspace && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` to refresh the lockfiles, and update `CHANGELOG.md`
5. [ ] Run the full quality gate — a hotfix is not an excuse to skip it
6. [ ] Tag, let `release.yml` build the draft
7. [ ] Verify the specific fix in the built artifact, on the affected platform
8. [ ] Publish, then update the website manifest
9. [ ] Tell affected users directly; do not rely on them noticing

---

## Rollback

Triggered when a published release is worse than its predecessor.

1. [ ] **Do not delete the bad release.** People have already downloaded it;
       deleting it breaks their checksum verification and hides the evidence.
       Mark it as a prerelease so it stops being "latest", and edit the notes to
       say plainly what is wrong.
2. [ ] Confirm the previous release's assets are still downloadable
3. [ ] `node scripts/release/update-website-manifest.mjs --manifest dist/release/release-manifest.json --tag <previous>` and
       redeploy the site, so the download page points at the good version
4. [ ] Post the reason and the workaround where users will see it
5. [ ] Then fix forward — a rollback is a stopgap, not a resolution

---

## Signing-key compromise (Windows/macOS)

Follow [signing-incident-runbook.md](signing-incident-runbook.md) — stop the
workflow, disable the environment, revoke, rotate. Summary:

1. [ ] Treat every artifact signed with that key as untrusted
2. [ ] Revoke the certificate with the issuer (Apple / Azure Artifact Signing)
3. [ ] Publish a security advisory naming affected versions and hashes
4. [ ] Obtain a new identity; re-sign and re-release current versions
5. [ ] Tell users how to identify the bad signature — do not just say "update"
6. [ ] Post-mortem: how did the key leave its intended storage?

---

## Updater-key loss or compromise

**Loss** (no compromise): every existing install is permanently un-updatable.

1. [ ] Confirm the offline backups really are gone before acting
2. [ ] Generate a new keypair; store it correctly this time
3. [ ] Publish a release with the new public key
4. [ ] Notify every user that a **manual** reinstall is required
5. [ ] Keep the old release downloadable

**Compromise:** as above, plus assume any update the key could have signed is
suspect, publish an advisory, and check whether a malicious update was actually
served before concluding it was not.

---

## Compromised release artifact

Someone replaced or tampered with a published file.

1. [ ] Take the artifact down and record its hash before deleting anything
2. [ ] Compare against `SHA256SUMS.txt` from the build — this is the whole point
       of publishing checksums
3. [ ] Determine the blast radius: download count, time window
4. [ ] Publish an advisory with both hashes (good and bad) so users can check
5. [ ] Rebuild from the tag in clean CI; verify the rebuild matches the original
       good hash
6. [ ] Rotate every credential that could have been used to upload
7. [ ] Review who and what has release-publishing permission
