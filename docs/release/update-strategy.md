# Varve — Update and Release Channel Strategy

**Date:** 2026-08-03
**Current state:** the repository audit found no updater configured before the
2026-08-13 implementation. The implementation is being introduced behind the
consent, package-authority, release-signing, and acceptance-test gates recorded
in [the update-system audit](../architecture/update-system-audit-2026-08-13.md).

---

## 1. What existed before the updater implementation

Audited, not assumed:

- `apps/desktop/src-tauri/tauri.conf.json` has **no `plugins.updater` block**.
- `apps/desktop/src-tauri/Cargo.toml` has **no `tauri-plugin-updater` dependency**.
- No update signing keypair exists anywhere in the repository or CI secrets.
- No update manifest endpoint is served.

That was the pre-implementation state. The current capability matrix and
threat model are maintained in
[update-system-audit-2026-08-13.md](../architecture/update-system-audit-2026-08-13.md).

---

## 2. Previous manual-update decision

The following was the correct pre-updater decision for the first release:

1. **Upgrade paths have never been tested.** Nobody has installed Varve `0.1.0`
   and upgraded it to `0.1.1` on any operating system. An auto-updater's entire
   job is to perform an untested operation unattended, on a user's machine,
   against their documents. The document format is explicitly still changing.

2. **An updater is a code-execution channel.** It downloads a binary and runs
   it. That is a valuable target, and it is secured by a private key that a solo
   developer must generate, back up offline, store in CI, and rotate. Getting
   that wrong is worse than having no updater.

3. **The unsigned problem compounds.** Varve's installers are not code-signed.
   Adding an auto-updater to unsigned software means a user who cannot verify
   the first install also cannot verify any subsequent one — and now the
   unverified updates arrive silently.

4. **There is nothing to update to yet.** Update infrastructure built before the
   first release is infrastructure built against guesses.

That decision remains useful as the fallback for unsupported, externally
managed, development, and not-yet-validated builds. It is no longer the whole
product requirement: the consent-first updater is being added incrementally.

**Historical v1 snapshot (audited 2026-08-06):**

- No updater plugin, no update keypair, no update endpoint — confirmed in the
  then-current `tauri.conf.json` and `Cargo.toml`.
- No in-app "Check for updates" action exists in the editor, and none is being
  added at alpha: an update check that is not an update is a button that opens
  the release page, and the download page already links the GitHub Releases
  page from both the no-release state and every release state.
- The website `/download` and `/releases` pages show the current published
  version, tag, release date, channel (stable/prerelease) and full release
  notes rendered from `CHANGELOG.md` — a manual check is: open the download
  page and compare against the installed version shown in the app's About
  dialog.
- If an in-app check is added later it must (per the failure modes below) run
  only when invoked, handle offline/rate-limit/prerelease/malformed/withdrawn
  cases, and never download or execute anything.

---

## 3. Production enablement gates

All of these should be true first:

- [ ] At least two releases exist, and a packaged upgrade has been performed on
      every self-managed package that will be enabled.
- [ ] Document migration has been tested: a file saved by version N opens
      correctly in N+1, and the failure mode when it cannot is a clear message
      rather than data loss.
- [ ] Downgrade behaviour is defined — what happens when a user installs an
      older version over a newer document store.
- [ ] Platform signing/notarization policy passes for the release; this remains
      separate from Tauri updater signing.
- [ ] A dedicated updater key-management procedure exists and has been
      rehearsed (§5 and the signing runbooks).

The audit and capability matrix are maintained separately so this historical
decision record does not silently become a claim that package-specific
self-update is safe before its acceptance tests pass.

## 4. Current implementation boundary

The first implementation increment is deliberately conservative:

- Tauri v2.10.1 updater and v2.3.1 process plugins are registered only for the
  desktop app. The embedded public key is a dedicated updater key, separate
  from Windows Authenticode and Apple Developer ID trust.
- Stable and beta feeds are static JSON files generated from the exact signed
  updater artifacts after the existing release trust gate. Website deployment
  mirrors published feeds to `/updates/stable.json` and `/updates/beta.json`;
  drafts are never mirrored.
- AppImage self-update is offered only when native runtime detection sees a
  non-development AppImage at a non-empty, writable location. Non-AppImage
  Linux installs are never self-replaced: conventional system locations are
  presented as package-manager managed, and other extracted binaries are
  manual-only.
- Windows NSIS and an installed writable macOS `.app` use Tauri's updater
  artifacts. A mounted/read-only DMG is not an update target.
- Manual checking remains available without background consent. Download and
  install are separate state-machine operations; signature verification occurs
  inside Tauri's updater download boundary before the coordinator can expose
  `ready-to-install`.
- Multiple desktop windows share update state and preferences through a
  same-origin broadcast channel and an expiring operation lease, so only one
  window owns a check/download/install transaction. A stale lease returns the
  remaining windows to a recoverable settled state.
- The ready-to-install UI does not bypass Varve's canonical termination/save
  coordinator. “Install and Restart” enters the existing restart transaction;
  install-on-quit enters the same transaction on a native quit request. A
  normal quit installs and exits; an explicit restart installs and relaunches.
  Neither path can discard unsaved documents.

Hardening added on top of the first increment (2026-08-13, second pass):

- **Least-privilege updater capability.** `capabilities/default.json` grants
  `updater:allow-check`, `updater:allow-download` and `updater:allow-install`
  explicitly and never `updater:default` or `allow-download-and-install`, so
  webview JavaScript cannot bypass the consent/state machine with one combined
  call. The frontend only ever receives opaque downloaded/verified tokens and
  never an executable path.
- **Channel gating per build.** The feed endpoint is embedded at build time
  (`tauri.update.channel.json` in release CI). The provider resolves the native
  packaging context and refuses to check a channel the build was not compiled
  for, so a stable build cannot be pointed at the beta feed by configuration
  tampering in the webview.
- **macOS translocation.** A Gatekeeper-translocated app (running from
  `/private/var/folders/...`) is detected as `manual-only` with
  `installLocation: "translocated"`: updating the quarantine copy would be
  silently undone on the next launch. The Settings UI explains that Varve must
  be moved into Applications.
- **Background cadence.** The scheduler runs from any settled state, not only
  idle: after an up-to-date check the next eligible check is 24 h later, after
  a failure 6 h later (backoff). Manual mode never schedules. Manual checks
  remain available in every consent mode.
- **Skip semantics.** Skipping a version records it against
  `channel + exact version`, transitions the offer to `deferred` instead of
  leaving the download button live, and the next check suppresses only that
  version.
- **Release notes surface in Settings** with keyboard-focusable scroll and a
  polite live region for status; the download status line is a live region,
  not a color-only signal.
- **Cancel.** An in-flight download or verification can be cancelled from
  Settings. Tauri's updater exposes no transport abort, so cancel is a soft
  cancel: the coordinator discards the completed transfer (never verifying or
  installing it) and Tauri's byte cache is re-verified against the embedded
  public key before any later reuse.

The implementation is still not a production-enablement claim. The gates in
§3 remain release-blocking until the packaged upgrade matrix and the actual
release feed have been exercised on the supported runners.

---

## 5. Channel design

Channels derive from the tag shape, which `release.yml` already implements:

| Channel | Tag | Prerelease | Audience |
|---|---|---|---|
| `stable` | `v0.2.0` | no | Everyone |
| `beta` | `v0.2.0-beta.1` | yes | Opt-in testers |
| `nightly` | not tagged | n/a | Built on demand; never auto-updated |

**Channels must never cross.** The rule that prevents it: a client on channel X
only ever reads the manifest at `updates/X.json`. A stable client does not know
the beta manifest's URL. This is stricter than filtering a combined manifest by
a `prerelease` flag, because a bug in the filter silently promotes every beta
user's install to... whatever shipped last.

**Nightly today.** No nightly builds are tagged or published, so no nightly
feed is ever mirrored to the website (`fetch-website-release.mjs` handles only
`stable` and `beta`). The generator accepts a `nightly` channel so the day a
nightly pipeline exists it is a configuration change, not a new mechanism, and
clients built with `VARVE_UPDATE_CHANNEL=nightly` already resolve only the
nightly endpoint from their build-time config. The client-side channel gate
(`update_packaging_context` + provider) refuses any channel the build was not
compiled for, so a nightly build cannot be repointed at stable by webview
configuration tampering.

Downgrade protection: the client refuses any manifest version that does not
compare greater than the running version under semver. Both sides must apply
this — the server manifest can be replaced, the client check cannot.

---

## 5a. Document format migrations

An updater can make a document incompatible with older Varve versions even
when the install itself is flawless. Policy for any release whose persistent
document format (scene schema, project metadata, trace metadata, tokens) is
changed:

1. **Verify the migration round trip before publishing an update feed entry:**
   old Varve file → new Varve → open → save → reopen in new Varve. If the
   migration is one-way (the saved file can no longer be opened by the old
   version), that is acceptable only with the steps below — it is never a
   silent side effect of auto-update.
2. **State it in the release notes and the feed `notes` field.** The in-app
   "Version X is available" panel renders the feed notes, so a one-way
   migration warning reaches users *before* they download. A stable feed entry
   whose notes mention a destructive migration is a release-notes
   responsibility; the feed generator does not invent one.
3. **Additive changes must keep old files openable.** Only genuinely
   destructive migrations may rely on user-visible backup/versioning. Varve's
   existing version history and recovery snapshots are the safety net for
   those; they are not a substitute for the migration test in (1).
4. **Rollback is a version-compat problem, not an installer problem.** The
   updater can reinstall an older application, but a one-way migrated document
   will not open in it. Reinstalling the previous version is therefore only
   advertised when the document format is backward compatible.

There is no central scene `schemaVersion` today; the migration test in (1) is
the gate, and each release is responsible for running it on the artifact pair
it publishes.

---

## 10. Packaged AppImage vertical slice

`scripts/update-test/` runs a real packaged upgrade on the developer machine:

```
build-fixtures.sh   # builds OLD (0.1.1-test) + NEW (0.1.2-test) RELEASE
                    # AppImages, wdio feature for automation, TEST-ONLY key
                    # ~/.varve/updater-test.key, localhost feed on :8899
run-slice.sh        # wdio on the OLD AppImage: consent -> manual check ->
                    # download -> unsaved-work guard -> install -> restart;
                    # byte-level replacement check; then an INVALID-signature
                    # feed must fail closed on the relaunched NEW AppImage
```

Both AppImages embed the test public key and a localhost endpoint with
`dangerousInsecureTransportProtocol` (allowed only by
`apps/desktop/src-tauri/tauri.update.test.json`, which release CI never
reads). The fixtures differ only by version, and the same WebDriver (embedded
via the wdio Cargo feature) drives the native webview, so the consent dialog,
the Settings > Updates flow, the termination/save guard and the relaunch are
exercised against real packaged bytes — not mocks.

Covered assertions:

- first launch shows the consent dialog and never pre-checks consent;
- declining consent reports manual mode and still allows a manual check;
- the update is discovered with its feed notes, download reaches
  `ready-to-install` only after Tauri's signature verification;
- "Install and Restart" is blocked by the canonical unsaved-document guard
  until it is resolved;
- after restart the AppImage at the original path is byte-identical to the
  new fixture, still executable, and reports `0.1.2-test` via
  `update_packaging_context`;
- preferences survive the upgrade (no re-consent prompt);
- a feed whose signature does not match the payload fails closed: error
  state, no install offer, app still running.

Not covered by the slice (documented gaps): the read-only/disk-full install
failure paths, Windows NSIS and macOS installed-app upgrades (require
platform runners), and the production feed (never used for tests).

---

## 6. Key management

Tauri's updater signs manifests with a minisign keypair. Expiry/rotation
calendar and compromise procedure: [signing-rotation-runbook.md](signing-rotation-runbook.md)
and [signing-incident-runbook.md](signing-incident-runbook.md) (this key is
handled separately from the Apple/Windows certificate material).

**Generation** — on an offline or trusted machine, never in CI:

```sh
pnpm tauri signer generate -w ~/.varve/updater.key
```

**Handling rules:**

| Asset | Where it lives | Where it must never live |
|---|---|---|
| Private key | Offline backup (two physical media, different locations) | The repository, any build log, any chat |
| Private key (CI copy) | `TAURI_SIGNING_PRIVATE_KEY` secret | A workflow `run:` block that echoes it |
| Key password | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secret | Anywhere alongside the key |
| Public key | `tauri.conf.json`, committed | — |

`.gitignore` excludes updater key files. The working key generated during this
implementation is outside the repository at `~/.varve/updater.key`; it is not
committed or used as a CI credential. A protected release secret must be
provisioned before the release workflow can build updater artifacts.

**Rotation** is a slow operation and must be planned as one: the public key is
compiled into every already-installed client, so a rotated key cannot sign
updates that existing clients will accept. The only path is to ship a release
signed with the *old* key that contains the *new* public key, wait for adoption,
then switch. Budget two release cycles.

**Key loss** — no private key, no updates, ever, for every existing install.
Recovery is: publish a new release with a new key, and tell every user to
manually download and reinstall. This is why the offline backup is not optional.

**Key compromise** — assume every update ever signed is suspect. Revoke by
shipping a manually-installed release with a new key, publish a security
advisory, and treat it as the incident it is. See
`docs/release/release-checklists.md`.

---

## 7. Failure modes the updater must handle

Listed because "it downloaded and installed" is the easy path and the other
eleven are where users lose work:

| Scenario | Required behaviour |
|---|---|
| No network / captive portal | Silent no-op. Never block app start on an update check |
| Proxy or firewall blocks the endpoint | Same. Time out fast, do not retry aggressively |
| Interrupted download | Discard the partial file; never install a truncated binary |
| Corrupt download | Signature check fails → discard, report, keep the current version |
| Insufficient disk space | Detect *before* replacing anything; fail with a clear message |
| Install fails partway | The previous version must still launch. Never leave the app unbootable |
| Update to an incompatible document version | Warn before installing, not after the user opens a file |
| Unsupported old version | An old client must be told it is too old to update, not fed a manifest it cannot parse |
| Manifest served over a hijacked endpoint | Signature verification is the only defence; endpoint must be HTTPS and pinned |
| User declines | Remember the choice; do not re-prompt every launch |
| Rollback needed | Previous installers stay downloadable on the releases page permanently |
| Staged rollout | Ship to a fraction first. Without telemetry, "staged" means: publish as prerelease, wait, promote |

---

## 8. Historical interim: version-check-only

A safe first step that is not an updater:

- The release pipeline already publishes `release-manifest.json` per release.
- A client can fetch the latest one, compare versions, and show a link.
- No download, no execution, no signing key, no new attack surface.
- Requires a privacy note: it is a network request that reveals an IP and a
  version. Make it opt-in, or at minimum disclose it.

This is the recommended v1.1 behaviour, after the first release exists.
