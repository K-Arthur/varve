# Release Rollback Runbook

When a published release is worse than its predecessor — broken installer,
regression that blocks core workflows, signing failure discovered post-publish,
or a security issue — this runbook covers detection, containment, and
recovery without destroying historical integrity.

**Principle:** never delete a published release. Deleting breaks checksum
verification for everyone who already downloaded it, hides evidence, and
makes post-mortem impossible.

## 1. Detect

| Signal | Source |
|---|---|
| Crash reports spike | `pnpm ci:health` (if crash upload is configured) |
| User reports on GitHub Issues / Discord | Manual triage |
| Installer fails to launch on a platform | `just verify-packages` or manual test |
| Signing verification fails post-publish | `verify-downloaded.mjs` against the draft |
| Checksum mismatch reported by user | Compare their SHA-256 against `SHA256SUMS.txt` |
| Updater pushes a broken build | `generate-updater-feed.mjs` + user reports |

## 2. Contain (0-15 minutes)

1. **Mark the release as prerelease** on GitHub Releases so it stops being
   "latest". This prevents `releases/latest` from pointing at the broken
   build and stops the website from recommending it (the download page
   selects the highest stable release).

2. **Do NOT delete the release or its assets.** Users who already downloaded
   need the checksums for verification, and the evidence is needed for
   post-mortem.

3. **If the updater is active and pushing the broken build:**
   - Revoke the updater feed by removing or replacing the feed JSON on the
     website (the updater checks on a cadence; the next check will find no
     newer signed version and stop offering the update).
   - If the updater key itself is compromised, follow the
     [signing-incident-runbook.md](signing-incident-runbook.md) instead.

4. **Post a visible notice** on the release page: what is broken, which
   platforms are affected, and what the workaround is (usually "install the
   previous version").

## 3. Point the website at the last good release (15-60 minutes)

The download page derives all links and checksums from the website release
manifest. Re-point it at the previous good release:

```bash
# Identify the last good tag (e.g. v0.1.0)
GOOD_TAG=v0.1.0

# Rebuild the website release manifest from the published release
node scripts/release/fetch-website-release.mjs \
  --repo K-Arthur/varve \
  --tag "$GOOD_TAG"

# Verify the manifest is correct
node scripts/release/verify-release-data.mjs \
  --manifest apps/website/src/data/release-manifest.json

# Deploy the website (GitHub Actions or manual)
```

After this, `varve.studio/download` serves the good version's installers
and checksums.

**Historical integrity:** the bad release's manifest entry is overwritten
by the good one. The bad release's assets remain on GitHub Releases (and
in git history of the manifest file if committed). The website just stops
advertising it.

## 4. Update the updater feed (if applicable)

If the updater was active, regenerate the feed pointing at the good version:

```bash
# Regenerate the updater feed from the good release's manifest
node scripts/release/generate-updater-feed.mjs \
  --manifest dist/release/release-manifest.json \
  --base-url https://github.com/K-Arthur/varve/releases/download
```

The updater feed is a static JSON file served from `varve.studio/updates/`.
Users whose updater checks before the feed was updated will try the bad
build once and fail; the next check will find the good version.

## 5. Communicate

| Channel | What to post |
|---|---|
| GitHub Release notes (bad release) | Edit to say "BROKEN — do not use. Use vX.Y.Z instead." |
| GitHub Release notes (good release) | Ensure it is the current "latest" |
| Website announcement (if any) | Brief note linking to the release |
| Discord / social (if applicable) | "We pulled vX.Y.Z — use vX.Y.Z instead. Details in the release notes." |

## 6. Fix forward

A rollback is a stopgap. After containment:

1. Root-cause the failure (add a test that would have caught it)
2. Fix on `master`
3. Bump, tag, and release a new version through the normal pipeline
4. The new release becomes "latest" automatically

## 7. Manual-update path when updater is unavailable

If the updater infrastructure is broken (feed unreachable, key lost, CDN
issue), users must update manually:

1. Direct them to `varve.studio/download` which always has the latest good
   release regardless of updater state.
2. For AppImage users: download the new AppImage and replace the old one.
   The old AppImage is a single file; no uninstall needed.
3. For deb/rpm users: download and install the new package. Package managers
   handle the upgrade.
4. For macOS users: download the new .dmg and replace the .app in
   Applications.
5. For Windows users: run the new NSIS installer over the old installation.

## Prevention

These guards prevent most rollback scenarios:

| Guard | What it catches | Where |
|---|---|---|
| `version.mjs verify` | Version drift across manifests | CI on every push |
| `verify-product-truth.mjs` | Cross-source contradictions | CI pipeline-validate |
| `verify-release-trust.mjs` | Signing/integrity violations | Release workflow |
| `verify-artifacts.mjs` | Asset/checksum mismatches | Release workflow |
| `verify-package-install.sh` | Installer failures in clean containers | Release workflow |
| `appimage-smoke` | AppImage launch failure | Release workflow |
| `just verify-packages` | deb/rpm install + launch | Release workflow |
| `audit:docs` | Stale claims in documentation | CI on every push |
| `audit:emoji` | Emoji in codebase | CI on every push |

## Decision record

This runbook was created during the 2026-08-18 product truth audit. The
existing rollback section in `release-checklists.md` was insufficient for
the following scenarios:

- Website still recommending a broken release after it was marked prerelease
- Updater pushing a broken build to users who had enabled auto-update
- Need to communicate a manual-update path when updater infrastructure fails
- Preserving historical integrity of the release record while containing damage
