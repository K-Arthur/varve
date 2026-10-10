# Linux Ecosystem Readiness

**Initial assessment:** 2026-08-18
**Current package snapshot:** 2026-10-09 (v0.5.0)
**Scope:** Per-channel assessment of external package ecosystems for Varve Linux distribution.
**Related:** `distribution-decision-matrix.md` (scoring and sequencing), `platform-support-matrix.md` (tested statuses).
**Hard rule:** Varve is source-available under FSL-1.1-MIT. Never mark it "open source" or "free software" to fit package metadata.

The v0.5.0 release currently publishes direct AppImage, DEB, and RPM
downloads. The local AUR package definition now targets the published v0.5.0
x86_64 and aarch64 AppImages and passes source-checksum verification, but
has not been submitted to AUR. The Flatpak manifest remains an intentional failing stub;
generated Cargo/pnpm source inventories are present but are not wired into it.

---

## 1. AUR — `varve-desktop-bin`

| Field | Assessment |
|---|---|
| **Eligibility** | Ready — Arch allows any registered user to publish. No approval gate. |
| **License constraint** | `LicenseRef-FSL-1.1-MIT` is valid SPDX custom syntax; Arch makepkg ≥ 6.1 accepts it. The license text is now shipped under `/usr/share/licenses/varve-desktop-bin/LICENSE`. |
| **Technical prerequisites** | The local `PKGBUILD` + `.SRCINFO` target the v0.5.0 x86_64 and aarch64 AppImages; `makepkg --verifysource` passed against the published SHA-256 values. No AUR package has been submitted. Publishing requires an AUR account and `aur.git` access. |
| **AI can prepare** | The local package files and release checksum are prepared. Recheck the published `SHA256SUMS.txt` and regenerate `.SRCINFO` after each release. |
| **Human must do** | (1) Create AUR account (identity verification, requires real name/email). (2) Initialize `aur.git` repo. (3) Push `PKGBUILD` + `.SRCINFO`. |
| **Maintenance cost** | Low — bump `pkgver` + `sha256sums` per release. A future CI script can automate the diff. |
| **Recommend** | **Now** — AppStream metainfo has shipped since v0.2.0. No additional technical work needed; blocked only on the human AUR account/push steps below. |

### AUR prep checklist (human steps)

```
# 1. Create AUR account at https://aur.archlinux.org/account/register
#    (requires real name for the maintainer field)

# 2. Initialize the AUR repo
git clone ssh://aur@aur.archlinux.org/varve-desktop-bin.git /tmp/varve-aur
cd /tmp/varve-aur
cp /path/to/varve/packaging/aur/varve-desktop-bin/{PKGBUILD,.SRCINFO} .
git add PKGBUILD .SRCINFO
git commit -m "varve-desktop-bin 0.5.0"
git push

# 3. After each release, update pkgver + per-arch sha256sums:
#    sha256sums_x86_64=('abc123...')
#    sha256sums_aarch64=('def456...')
#    updpkgsums  (if paru is available)
#    makepkg --verifysource
```

---

## 2. Flathub

| Field | Assessment |
|---|---|
| **Eligibility** | **Unconfirmed; reviewer decision required.** Flathub's current [Generative AI policy](https://docs.flathub.org/docs/for-app-authors/requirements#generative-ai-policy) requires disclosure of AI-generated or AI-assisted code, documentation, packaging, and other included material. Reviewers may reject disclosed material based on its extent, role, quality, or maintainability. The manifest itself must not contain AI-generated or AI-assisted content. Varve is substantially AI-assisted, so do not promise acceptance or describe it as categorically blocked; a human maintainer must make a complete disclosure and seek a reviewer decision. Policy checked 2026-10-09. |
| **License constraint** | Flathub does not require OSI approval. FSL-1.1-MIT is acceptable if the source builds from the manifest. |
| **Technical prerequisites** | The checked-in manifest is a stub that exits with failure. Cargo/pnpm source inventories exist but are not connected to the manifest. No Flatpak build or sandbox run is verified. The draft currently names `org.gnome.Platform//47` and webkit2gtk-4.1; its proposed permissions still need review against actual file, printing, font, model, and update behavior. |
| **AI can prepare** | Research and technical drafting may be assisted, but AI-generated or AI-assisted app and packaging material must be disclosed. The Flathub manifest and all submission PR text, commit messages, review comments, and replies must be authored by a human; AI agents must not open or automate the submission PR. |
| **Human must do** | (1) Review the current policy and decide whether to pursue submission. (2) Identify and disclose the AI-generated or AI-assisted material in the app and packaging. (3) Human-author the manifest and submission text. (4) Complete the manifest and verify an offline `flatpak-builder` build plus sandbox behavior. (5) Submit the PR and handle reviewer feedback personally. |
| **Maintenance cost** | High — runtime version bumps (~every 6 months), sandbox permission reviews, security updates. Flathub expects active maintenance. |
| **Recommend** | **Defer** until the manifest is human-authored, an offline build and sandbox run pass, the AI-assistance disclosure is complete, and Flathub maintainers have reviewed eligibility. No submission date is set. |

### Flathub human steps (policy checked 2026-10-09)

1. **Review and disclose**: Read Flathub's current [author requirements](https://docs.flathub.org/docs/for-app-authors/requirements#generative-ai-policy). Inventory AI-generated or AI-assisted code, documentation, packaging, and other included material, then make a complete, accurate disclosure. Ask Flathub maintainers for a decision if eligibility is unclear; do not assume an exception or acceptance.

2. **Prepare source inventories** using the documented generators from the
   upstream `flatpak-builder-tools` project. The repository uses the root
   `pnpm-lock.yaml` and the Tauri `Cargo.lock`; the generated files are inputs
   only and do not make the current stub buildable:
   ```bash
   python3 /path/to/flatpak-builder-tools/cargo/flatpak-cargo-generator.py \
     apps/desktop/src-tauri/Cargo.lock -o packaging/flatpak/cargo-sources.json
   flatpak-node-generator pnpm pnpm-lock.yaml \
     -o packaging/flatpak/pnpm-sources.json
   ```
   See the upstream [`flatpak-cargo-generator`](https://github.com/flatpak/flatpak-builder-tools/tree/master/cargo)
   and [`flatpak-node-generator`](https://github.com/flatpak/flatpak-builder-tools/tree/master/node)
   usage guides. These commands have not been run as part of a Flatpak build.

3. **Human-author and complete the manifest**: `packaging/flatpak/dev.varve.desktop.yml` must not contain AI-generated or AI-assisted content. Remove the stub `exit 1`, add actual build commands, cargo/pnpm sources, finish-args, and test:
   ```bash
   flatpak-builder --force-clean build-dir packaging/flatpak/dev.varve.desktop.yml
   ```

4. **Submit and maintain manually**: A human must fork `flathub/flathub`, add `dev.varve.desktop.yml` to the root, author the PR content, and respond to reviewers. Do not use an AI agent to open or automate the PR or generate submission and review text.

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
| **Human must do** | Fork `microsoft/winget-pkgs`, add manifest under `manifests/v/VarveStudio/Varve/` with package ID `VarveStudio.Varve` (not `K-Arthur.Varve`), submit PR. Requires Windows machine or CI for validation. |
| **Maintenance cost** | Low — bump version per release. |
| **Recommend** | **Later** — defer until Windows NSIS build is verified and code-signed. winget gives the best Windows discovery path. |

---

## 5. Homebrew Cask (macOS)

Policy checked 2026-10-09 against Homebrew's [acceptable cask requirements](https://docs.brew.sh/Acceptable-Casks)
and [security guidance](https://docs.brew.sh/Homebrew-Security-and-Supply-Chain).

| Field | Assessment |
|---|---|
| **Eligibility** | No cask has been submitted. Official macOS casks must pass Homebrew's Gatekeeper checks on the default configuration without asking users to bypass Gatekeeper or System Integrity Protection. |
| **License constraint** | Homebrew Cask does not require OSI approval — accepts source-available. FSL-1.1-MIT is acceptable. |
| **Technical prerequisites** | The current v0.5.0 Apple Silicon DMG is unsigned and not notarized, so it does not meet the official cask Gatekeeper requirement. A future artifact must pass Homebrew's audit on default macOS settings; a hosted CI smoke check alone does not prove this. |
| **AI can prepare** | The cask definition (Ruby DSL: `cask "varve" do ...`). |
| **Human must do** | Coordinate a signed and notarized release artifact through the signing process, verify it passes Gatekeeper and launches on supported macOS, then author and submit the cask PR. The project has hosted macOS release checks, but they do not replace Gatekeeper verification. |
| **Maintenance cost** | Low once stable. |
| **Recommend** | **Defer** until a signed and notarized artifact passes the official Gatekeeper check. No release date is set. |

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
| **License constraint** | The current FSL-1.1-MIT application is not eligible for Debian `main` or Fedora's approved-license channel under the project's licensing research. The MIT OR Apache-2.0 engine crates are separately licensed, but are not the Varve desktop app. A particular app release may become MIT after the FSL conversion period; any future package still needs sponsor and distro-license review. See [`mixed-license-model.md`](../licensing/mixed-license-model.md) and the dated [`decision research`](../licensing/decision-research-2026-08-18.md). |
| **Technical prerequisites** | Debian: `debian/` directory (rules, control, changelog), policy-compliant packaging. Fedora: `.spec` file. Both need a sponsoring packager. |
| **AI can prepare** | Nothing — requires human maintainer relationships and months of review. |
| **Human must do** | Contact Debian/Fedora packaging teams, find a sponsor, prepare compliant package, respond to NMU/security processes. |
| **Maintenance cost** | High — must track upstream, respond to security issues, coordinate with release cycles. |
| **Recommend** | **Defer** — no current app package is planned for these repositories. Revisit only for a specific MIT-converted release and a willing distro sponsor. |

---

## 8. Summary matrix

| Channel | Status | Blocker | Next step | When |
|---|---|---|---|---|
| **AUR** | Prepared locally for v0.5.0 x86_64 and aarch64; not published | AUR account and push access | Human review, then submit if desired | No release date set |
| **Flathub** | Not buildable; eligibility is unconfirmed under the current disclosure/reviewer policy | Complete and validate the human-authored manifest; disclose AI-assisted content and obtain a reviewer decision | Decide whether to pursue after technical qualification | No release date set |
| **Snap** | Rejected | Confinement vs. print/fonts | — | — |
| **winget** | Not submitted; Windows release workflow qualification exists, installer remains unsigned | Human-authored manifest and repository review | Decide whether to submit | No release date set |
| **Homebrew Cask** | Not submitted; current DMG is unsigned and unnotarized | Official Gatekeeper check must pass | Qualify a signed/notarized artifact, then prepare a human-reviewed cask | No release date set |
| **AlternativeTo** | Ready | Account creation | Submit listing | Now |
| **Debian/Fedora official** | Current FSL app is not eligible for the primary free-software repositories; no package planned | Specific MIT-converted release and distro sponsor/license review | Revisit if a sponsor wants to package an eligible release | No release date set |

---

## 9. Source-available language rule

Never mark Varve "open source" or "free software" in any package metadata, directory listing, or ecosystem submission. The license identifier `LicenseRef-FSL-1.1-MIT` communicates the correct legal status: source-available with field-of-use restrictions.

- AUR: `license=('LicenseRef-FSL-1.1-MIT')` — correct.
- Flathub: `<project_license>LicenseRef-FSL-1.1-MIT</project_license>` — correct.
- Debian: if DFSG-non-free, place in `contrib` or `non-free`, never `main`.
- Fedora: if not on approved list, cannot be in base repos.
- AlternativeTo: description must say "source-available", not "open source".
