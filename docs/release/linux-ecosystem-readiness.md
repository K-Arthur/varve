# Linux Ecosystem Readiness

**Date:** 2026-08-18
**Scope:** Per-channel assessment of external package ecosystems for Varve Linux distribution.
**Related:** `distribution-decision-matrix.md` (scoring and sequencing), `platform-support-matrix.md` (tested statuses).
**Hard rule:** Varve is source-available under FSL-1.1-MIT. Never mark it "open source" or "free software" to fit package metadata.

---

## 1. AUR — `varve-desktop-bin`

| Field | Assessment |
|---|---|
| **Eligibility** | Ready — Arch allows any registered user to publish. No approval gate. |
| **License constraint** | `LicenseRef-FSL-1.1-MIT` is valid SPDX custom syntax; Arch makepkg ≥ 6.1 accepts it. The license text is now shipped under `/usr/share/licenses/varve-desktop-bin/LICENSE`. |
| **Technical prerequisites** | `packaging/aur/varve-desktop-bin/PKGBUILD` + `.SRCINFO` already validate under `makepkg --verifysource` (with SHA-256 filled in). Requires an AUR account and `aur.git` push access. |
| **AI can prepare** | PKGBUILD is prepared (done above). Release automation could bump `pkgver`/`sha256sums` in CI — the `sha256sums` field must be filled from the published `SHA256SUMS.txt` before submission. |
| **Human must do** | (1) Create AUR account (identity verification, requires real name/email). (2) Initialize `aur.git` repo. (3) Push `PKGBUILD` + `.SRCINFO`. |
| **Maintenance cost** | Low — bump `pkgver` + `sha256sums` per release. A future CI script can automate the diff. |
| **Recommend** | **Now** — submit after v0.1.3 (first release shipping AppStream metainfo). No additional technical work needed. |

### AUR prep checklist (human steps)

```
# 1. Create AUR account at https://aur.archlinux.org/account/register
#    (requires real name for the maintainer field)

# 2. Initialize the AUR repo
git clone ssh://aur@aur.archlinux.org/varve-desktop-bin.git /tmp/varve-aur
cd /tmp/varve-aur
cp /path/to/varve/packaging/aur/varve-desktop-bin/{PKGBUILD,.SRCINFO} .
git add PKGBUILD .SRCINFO
git commit -m "varve-desktop-bin 0.1.3"
git push

# 3. After each release, update pkgver + sha256sums:
#    sha256sums=('abc123...')
#    updpkgsums  (if paru is available)
#    makepkg --verifysource
```

---

## 2. Flathub

| Field | Assessment |
|---|---|
| **Eligibility** | **Blocked by Flathub AI policy.** Flathub's generative AI policy (2026-05-29) bans AI-generated application code, documentation, submission PRs, and reviewer comments. Varve's codebase is substantially AI-assisted. The policy permits exceptions for "mature, well-maintained projects" — Varve (1600+ commits, multi-year development) may qualify, but an exception must be explicitly requested and granted. |
| **License constraint** | Flathub does not require OSI approval. FSL-1.1-MIT is acceptable if the source builds from the manifest. |
| **Technical prerequisites** | Complete Flatpak manifest (`packaging/flatpak/dev.varve.desktop.yml`) with offline build sources (cargo-sources.json, pnpm-sources.json via `flatpak-cargo-generator` / `flatpak-node-generator`). The current manifest is a stub that `exit 1`s. Runtime: `org.gnome.Platform//47` + webkit2gtk-4.1 extension. Sandbox: Wayland, X11 fallback, DRI, filesystem=home (for document access). |
| **AI can prepare** | **Nothing that touches the submission or manifest.** Under the AI policy, I cannot author the manifest, metadata, patches, build scripts, or PR for Flathub. I can only produce this technical readiness report and the human steps below. |
| **Human must do** | (1) Decide whether to request a "mature, well-maintained" exception. (2) Generate `cargo-sources.json` + `pnpm-sources.json` on a local machine. (3) Complete the manifest. (4) Test with `flatpak-builder`. (5) Fork `flathub/flathub`, add `dev.varve.desktop.yml`, submit PR. (6) Respond to reviewer feedback (all responses must be human-authored). |
| **Maintenance cost** | High — runtime version bumps (~every 6 months), sandbox permission reviews, security updates. Flathub expects active maintenance. |
| **Recommend** | **Defer — v0.2+** after exception decision and real build verification. |

### Flathub human steps (exact)

1. **Exception request**: Open an issue at `flathub-infra/documentation` (or email flathub maintainers) explaining:
   - Varve is a long-running project (2024–present) with 1600+ human-authored commits
   - AI assistance was used under founder direction (per `docs/licensing/review.md` authorship facts)
   - Request exception to submit under the "mature, well-maintained" clause
   - Provide evidence: commit history, release cadence, CI infrastructure, test suite

2. **If granted**: Generate the offline build manifests locally:
   ```bash
   # From a clean checkout on a system with flatpak-builder:
   flatpak-cargo-generator -p apps/desktop/src-tauri/Cargo.lock -o cargo-sources.json
   # For pnpm, use flatpak-node-generator or equivalent for pnpm lockfiles
   flatpak-node-generator -r apps/desktop/pnpm-lock.yaml -o pnpm-sources.json
   ```

3. **Complete manifest**: Fill in `packaging/flatpak/dev.varve.desktop.yml` — remove the stub `exit 1`, add actual build commands, cargo/pnpm sources, finish-args. Test:
   ```bash
   flatpak-builder --force-clean build-dir packaging/flatpak/dev.varve.desktop.yml
   ```

4. **Submit PR**: Fork `flathub/flathub`, add `dev.varve.desktop.yml` to the root, open PR. All PR content (description, reviewer responses) must be human-authored.

---

## 3. Snap

| Field | Assessment |
|---|---|
| **Eligibility** | Technically possible. |
| **License constraint** | Same as AUR. |
| **Technical prerequisites** | snapcraft.yaml, classic or confined. Classic needs manual review. |
| **AI can prepare** | Nothing — already rejected in `distribution-decision-matrix.md`. |
| **Human must do** | N/A. |
| **Maintenance cost** | High — confinement fights CUPS printing and system font enumeration, two core Varve features. |
| **Recommend** | **Reject** — no benefit over AppImage; confinement actively breaks printing/font features. |

---

## 4. winget (Windows)

| Field | Assessment |
|---|---|
| **Eligibility** | Requires Windows Package Manager Community Repository contributor enrollment. Open-source, no approval gate beyond PR review. |
| **License constraint** | No license restrictions — accepts any license. |
| **Technical prerequisites** | NSIS installer (already built by CI). winget manifest is a YAML file referencing the GitHub release URL + SHA-256 + installer switches. |
| **AI can prepare** | The manifest YAML (winget-pkgs format). This is packaging content, not application code — technically preparable. |
| **Human must do** | Fork `microsoft/winget-pkgs`, add manifest under `manifests/k/K-Arthur/Varve/`, submit PR. Requires Windows machine or CI for validation. |
| **Maintenance cost** | Low — bump version per release. |
| **Recommend** | **Later** — defer until Windows NSIS build is verified and code-signed. winget gives the best Windows discovery path. |

---

## 5. Homebrew Cask (macOS)

| Field | Assessment |
|---|---|
| **Eligibility** | Requires macOS DMG installer and Homebrew Cask PR submission. |
| **License constraint** | Homebrew Cask does not require OSI approval — accepts source-available. FSL-1.1-MIT is acceptable. |
| **Technical prerequisites** | macOS DMG (ARM64 only; Intel x86_64 DMG blocked — ONNX Runtime discontinued macOS Intel binaries at v1.24.1). Code signing + notarization recommended for clean UX (no Gatekeeper warning). |
| **AI can prepare** | The cask definition (Ruby DSL: `cask "varve" do ...`). |
| **Human must do** | (1) Acquire Mac hardware (borrowed/rented) for DMG smoke test. (2) Obtain Apple Developer Program ($99/yr) for code signing + notarization. (3) Verify DMG launches. (4) Submit PR to `Homebrew/homebrew-cask`. |
| **Maintenance cost** | Low once stable. |
| **Recommend** | **Later** — defer until Mac available + notarized DMG. |

---

## 6. AlternativeTo (directory listing)

| Field | Assessment |
|---|---|
| **Eligibility** | Directory — anyone can suggest an app. No technical prerequisites. |
| **License constraint** | None — listing only, not a package manager. |
| **Technical prerequisites** | None. |
| **AI can prepare** | Listing content (description, screenshots, links). Could prepare draft text. |
| **Human must do** | Create account, submit listing, verify screenshots load. |
| **Maintenance cost** | Negligible — update when URLs change. |
| **Recommend** | **Now** — free discovery, no maintenance burden. List as alternative to Figma, Inkscape, Sketch. |

---

## 7. Debian / Fedora official repositories

| Field | Assessment |
|---|---|
| **Eligibility** | Requires a Debian/Fedora developer to package and sponsor. External projects cannot directly submit. |
| **License constraint** | **Hard blocker.** Debian requires DFSG-free software (equivalent to OSI Open Source Definition). FSL-1.1-MIT includes field-of-use restrictions (no commercial use in the FSL grant) that may not qualify. Fedora Licensing Guidelines have a similar approval process. The final answer depends on Prompt 15 licensing findings — if the license is found DFSG-non-free, official repos are permanently blocked. |
| **Technical prerequisites** | Debian: `debian/` directory (rules, control, changelog), policy-compliant packaging. Fedora: `.spec` file. Both need a sponsoring packager. |
| **AI can prepare** | Nothing — requires human maintainer relationships and months of review. |
| **Human must do** | Contact Debian/Fedora packaging teams, find a sponsor, prepare compliant package, respond to NMU/security processes. |
| **Maintenance cost** | High — must track upstream, respond to security issues, coordinate with release cycles. |
| **Recommend** | **Defer** — wait for Prompt 15 licensing findings. If FSL qualifies as DFSG-free, this becomes a long-term goal for v0.5+. |

---

## 8. Summary matrix

| Channel | Status | Blocker | Next step | When |
|---|---|---|---|---|
| **AUR** | Ready (internal prototype) | AUR account creation | Submit PKGBUILD | v0.1.3 |
| **Flathub** | Blocked (AI policy) | Exception request + human manifest authoring | Founder decision on exception | v0.2+ |
| **Snap** | Rejected | Confinement vs. print/fonts | — | — |
| **winget** | Ready (manifest draftable) | Windows build verification + PR submission | After Windows CI stable | v0.2+ |
| **Homebrew Cask** | Blocked (no Mac) | Mac hardware + notarization | Acquire Mac + Apple Dev Program | v0.2+ |
| **AlternativeTo** | Ready | Account creation | Submit listing | Now |
| **Debian/Fedora official** | Blocked (license) | FSL-1.1-MIT DFSG qualification | Prompt 15 findings | v0.5+ |

---

## 9. Source-available language rule

Never mark Varve "open source" or "free software" in any package metadata, directory listing, or ecosystem submission. The license identifier `LicenseRef-FSL-1.1-MIT` communicates the correct legal status: source-available with field-of-use restrictions.

- AUR: `license=('LicenseRef-FSL-1.1-MIT')` — correct.
- Flathub: `<project_license>LicenseRef-FSL-1.1-MIT</project_license>` — correct.
- Debian: if DFSG-non-free, place in `contrib` or `non-free`, never `main`.
- Fedora: if not on approved list, cannot be in base repos.
- AlternativeTo: description must say "source-available", not "open source".
