# Varve — Update and Release Channel Strategy

**Date:** 2026-08-03
**Current state:** no updater is configured, and that is deliberate for v1.

---

## 1. What exists today

Audited, not assumed:

- `apps/desktop/src-tauri/tauri.conf.json` has **no `plugins.updater` block**.
- `apps/desktop/src-tauri/Cargo.toml` has **no `tauri-plugin-updater` dependency**.
- No update signing keypair exists anywhere in the repository or CI secrets.
- No update manifest endpoint is served.

So there is no updater to audit for safety, and no key that could leak. The
decision to make is whether to add one for the first release.

---

## 2. Recommendation for v1: manual updates

**Do not enable the Tauri updater for the first release.** Reasons, in order of
weight:

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

**What to ship instead:** the release notes and download page tell users to
check the releases page, and the app can (later) do a version check against a
static JSON file and *link* to the download page without downloading anything.
A notification is not an update channel and carries none of the risk.

**What exists today (audited 2026-08-06):**

- No updater plugin, no update keypair, no update endpoint — confirmed in
  `tauri.conf.json` and `Cargo.toml`.
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

## 3. When to add the updater

All of these should be true first:

- [ ] At least two releases exist, and a manual upgrade between them has been
      performed on Linux, Windows and macOS.
- [ ] Document migration has been tested: a file saved by version N opens
      correctly in N+1, and the failure mode when it cannot is a clear message
      rather than data loss.
- [ ] Downgrade behaviour is defined — what happens when a user installs an
      older version over a newer document store.
- [ ] Installers are code-signed on Windows and macOS.
- [ ] A key-management procedure exists and has been rehearsed (§5).

---

## 4. Channel design (for when it lands)

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

Downgrade protection: the client refuses any manifest version that does not
compare greater than the running version under semver. Both sides must apply
this — the server manifest can be replaced, the client check cannot.

---

## 5. Key management (procedure to rehearse before use)

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

`.gitignore` already excludes `.env*`; add `*.key` before generating anything.

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

## 6. Failure modes the updater must handle

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

## 7. Interim: version-check-only

A safe first step that is not an updater:

- The release pipeline already publishes `release-manifest.json` per release.
- A client can fetch the latest one, compare versions, and show a link.
- No download, no execution, no signing key, no new attack surface.
- Requires a privacy note: it is a network request that reveals an IP and a
  version. Make it opt-in, or at minimum disclose it.

This is the recommended v1.1 behaviour, after the first release exists.
