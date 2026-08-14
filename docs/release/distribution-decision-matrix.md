# Varve — Distribution Channel Decision Matrix

**Date:** 2026-08-03 (last updated 2026-08-04)
**Constraint:** solo developer, CAD $200 total budget, no signing assets, no domain, no Mac.

> **Status (2026-08-10):** the §5 sequencing plan below was superseded in
> practice — v0.1.0 shipped directly as a public, non-prerelease release
> (public beta) on GitHub Releases for Linux, Windows, and macOS instead of
> the planned alpha-first rollout. Stage names in this dated record
> ("Public alpha", "Beta") are the plan's vocabulary, not Varve's current
> positioning — the canonical maturity label is **public beta**
> (`PRODUCT_STATUS` in `@varve/shared`). The scoring and per-channel
> analysis (§1–§4) remains current guidance for future channels.

The design goal is the **smallest maintainable release surface**. Every channel added is a
recurring tax: another artifact to build, smoke-test, checksum, document, and support. For a
first release by one person, two channels per platform is the ceiling.

---

## 1. Scoring

Scores are 1–5, higher is better, except *Maintenance* and *Friction* where higher is worse
(marked ↓).

| Channel | Init cost | Recurring | Trust | Friction ↓ | Discovery | Review delay | Signing needed | Updates | Rollback | Maint ↓ | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **GitHub Releases** | $0 | $0 | 4 | 2 | 2 | none | No | manual | 5 (keep old tags) | 1 | **Primary — all platforms** |
| **Static download page** | $0 | $0 | 3 | 1 | 3 | none | No | manual | 5 | 2 | **Primary front door** |
| **AppImage** | $0 | $0 | 3 | 2 | 2 | none | No | manual | 5 | 1 | **Ship (Linux primary)** |
| **`.deb` / `.rpm` direct** | $0 | $0 | 3 | 2 | 1 | none | No | pkg mgr | 4 | 1 | **Ship (Linux fallback)** |
| **AUR (`-bin`)** | $0 | $0 | 4 | 1 | 4 (Arch) | none | No | AUR helper | 4 | 2 | **Later — v0.1.1** |
| **Flathub** | $0 | $0 | 5 | 1 | 5 | 1–4 weeks | No (Flathub signs) | automatic | 4 | 4 | **Later — v0.2** |
| **Microsoft Store** | **$0** | $0 | 5 | 1 | 4 | 1–3 days | **No — MS re-signs** | automatic | 3 | 3 | **Strong candidate — Windows** |
| **Direct unsigned Windows** | $0 | $0 | 1 | 5 | 1 | none | No | manual | 5 | 1 | **Ship with warning (alpha)** |
| **Direct signed Windows** | ~$168 CAD/yr | yes | 3→4 | 3 | 1 | none | Yes | manual | 5 | 2 | **Defer — poor value now** |
| **Direct unsigned macOS** | $0 | $0 | 1 | 5 | 1 | none | No | manual | 5 | 1 | **Preview label only** |
| **Notarised macOS DMG** | $139 CAD/yr | yes | 5 | 1 | 1 | ~15 min | Yes | manual | 5 | 2 | **Defer — no Mac to test on** |
| **Mac App Store** | $139 CAD/yr | yes | 5 | 1 | 4 | 1–7 days | Yes | automatic | 2 | 5 | **Reject — sandbox conflict** |
| **Snap Store** | $0 | $0 | 4 | 2 | 3 | none | No | automatic | 3 | 4 | **Reject — confinement fights print/fonts** |
| **itch.io** | $0 | 0–10% | 3 | 2 | 3 | none | No | via app | 4 | 2 | **Reject — audience mismatch** |
| **Self-hosted apt/yum repo** | $0 | hosting | 2 | 3 | 1 | none | GPG key | pkg mgr | 3 | 5 | **Reject — all cost, no benefit** |
| **Private invite beta** | $0 | $0 | 5 | 3 | 0 | none | No | manual | 5 | 2 | **Use before public alpha** |

---

## 2. Recommendation per platform

| Platform | Primary | Fallback |
|---|---|---|
| **Linux** | GitHub Releases → **AppImage** | `.deb` + `.rpm` on the same release |
| **Windows** | **Microsoft Store** (once a build is verified) | Unsigned NSIS on GitHub Releases, with a documented SmartScreen walkthrough |
| **macOS** | **Nothing published initially** | Unsigned ARM64 DMG labelled *Developer Preview — unsigned, untested on real hardware*, or omitted entirely |

The website download page is the **front door** for all three; GitHub Releases is the
**artifact host**. That split matters: it means the site is a presentation layer over a
generated manifest, and moving artifact hosting later (to R2, to a CDN) does not require
rewriting the site.

---

## 3. The three decisions worth explaining

### 3.1 Microsoft Store is the highest-value Windows move, and it is free

Microsoft's current onboarding flow charges **no registration fee** for either Individual or
Company developer accounts
([Partner Center docs](https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/open-a-developer-account),
accessed 2026-08-03; page last updated 2026-07-17). This replaces the long-standing USD $19
individual / $99 company fees.

Store submissions are **re-signed by Microsoft**, so a Store-distributed Varve gets:

- no SmartScreen warning,
- a trusted publisher identity,
- automatic updates,
- discoverability,

for **CAD $0** and no certificate management. The equivalent via Azure Artifact Signing is
USD $9.99/mo = **CAD ~$168/yr** and still does not eliminate SmartScreen until the file hash
accrues download history.

**Two caveats, stated because they affect the choice:**

1. The **Individual** account type is documented for developers whose distribution is *"not in
   relation to their business, trade, or profession"* — hobbyist/non-commercial. If Varve is
   intended to be sold later, a **Company** account is the correct type. Company registration
   is also free but requires either a D-U-N-S number or business documents, plus a work email
   **on a domain you own** — which makes the domain purchase a dependency of the commercial path.
2. Store distribution requires an **MSIX** package, which Tauri can produce but this repo has
   never built. Budget real integration time.

Registration requires identity verification (government ID + selfie). **This is an enrolment
step requiring identity verification and acceptance of legal agreements — it is outside what
this audit will perform.** See §7.

### 3.2 Do not buy a Windows code-signing certificate now

Cost: USD $9.99/mo (Azure Artifact Signing Basic, 5,000 signatures/mo) ≈ **CAD $168/yr** with
tax — 84% of the entire budget. What it buys:

- Publisher name shown instead of "Unknown publisher"
- **Not** immediate SmartScreen silence (Microsoft's own FAQ, cited above)
- Requires a **paid** Azure subscription — free/trial/sponsored subscriptions are explicitly
  rejected by the service

Individual eligibility in Canada is confirmed and the former 3-year-entity-history requirement
was dropped for self-employed individuals in April 2026, so it is *available* — it is simply
poor value against a free Store path.

### 3.3 Do not buy Apple Developer membership now

USD $99/yr ≈ **CAD $139 + tax**. It is the only route to Developer ID signing and notarisation
(no free tier — [Apple](https://developer.apple.com/support/compare-memberships/), accessed
2026-08-03).

The blocker is not money, it is **validation**. There is no Mac. Spending 70% of the budget to
notarise a build that has never been launched on the target OS buys a *trusted* artifact of
*unknown* quality — which is worse than not shipping, because a signed app carries an implied
warranty of having been tested.

Correct order: get a Mac (borrowed, rented, or a friend's) → verify the app runs → *then* buy
the membership.

---

## 4. Rejected, with reasons

| Channel | Why rejected |
|---|---|
| **Mac App Store** | Requires full App Sandbox. Varve needs arbitrary-path document read/write (`resolve_user_path` spans the home directory) and shells out to `lp`/`lpstat` for printing (`print_macos.rs`). Both are sandbox-hostile. Months of entitlement work for an app that cannot yet be tested on macOS at all |
| **Snap** | Strict confinement breaks CUPS printer enumeration and system font discovery — two features Varve is specifically built around. Classic confinement needs manual review. AppImage delivers the same "works everywhere" property with none of this |
| **itch.io** | Excellent for games; a professional print/design tool is not its audience. Adds a storefront to maintain for near-zero relevant discovery |
| **Self-hosted apt/rpm repository** | GPG key management, repo metadata signing, hosting, and mirror hygiene — full package-maintainer overhead to serve users who can already download a `.deb` |
| **Flathub *now*** | Genuinely the best long-term Linux channel — trusted, sandboxed, auto-updating, great discovery. Rejected only for *first* release: the review cycle is weeks, sandbox permissions for printing and font access need real work, and `packaging/flatpak/dev.varve.desktop.yml` has never been validated. Target v0.2 |

---

## 5. Sequencing

| Stage | Channels | Trigger | Status |
|---|---|---|---|
| **0 — Private beta** | Direct AppImage to a handful of testers | Once RB-1…RB-4 are fixed | **Ready** — all RB blockers fixed and verified |
| **1 — Public alpha** | GitHub Releases (AppImage/deb/rpm) + website download page | Linux smoke tests pass on 2 non-Arch distros | **Next** — container install-tests pass on ubuntu:22.04 + fedora:38; GUI launch on a VM still pending |
| **2 — Windows alpha** | Add unsigned NSIS to the same release | First green Windows CI build + a Windows VM smoke test | Waiting on first green Windows build |
| **3 — Beta** | Add Microsoft Store; consider AUR `-bin` | Store account approved, MSIX builds | Deferred |
| **4 — Stable** | Add Flathub; macOS only if a Mac exists | Revenue or validated demand | Deferred |

**Status snapshot 2026-08-04:** repo public, Pages live at
`k-arthur.github.io/varve` (moved to `https://varve.studio` 2026-08-12, see
§8), CI unmetered, Linux packaging verified in
containers, Model Supply Chain gate fixed. The alpha is blocked only by
the GUI-launch-on-VM smoke test and a first green three-OS CI run.

---

## 6. Analytics and privacy

**Decision: ship with no analytics by default; provide a consent-gated adapter for
deliberate production activation. Updated 2026-08-13.**

`apps/website/src/layouts/Layout.astro` previously hardcoded the Plausible
script, pointed at `strata.design` — a domain not owned, so it cost money and
collected nothing. The website now uses a Varve-owned, consent-gated Events API
adapter behind `ANALYTICS_DOMAIN` (empty by default, so there is no prompt or
analytics request). Desktop usage, diagnostics, and crash reporting are
independent categories with unknown/denied fail-closed defaults. Privacy policy
and the technical disclosure match the implementation.

GitHub Releases still reports per-asset download counts via the API for free. The optional
consent-gated Plausible measurement adds only normalized website routes, release/platform
download categories, and approved outbound categories; it does not use a third-party script,
cookies, personal identifiers, or design data.

The production website deployment sets `ANALYTICS_DOMAIN=varve.studio` and uses
the matching Plausible site. Consent is still required before any request.
Local and unconfigured builds leave the variable empty, so no prompt or request
is emitted. Provider retention, access, deletion, and legal review remain
operational responsibilities.

---

## 7. Actions this audit will not take

Each of these requires payment, identity verification, or a legal agreement, and is left to the
repository owner as an explicit decision:

| Action | Blocked on | Next step for the owner |
|---|---|---|
| Microsoft Store enrolment | Identity verification, legal agreement | Start at `https://storedeveloper.microsoft.com`, choose Individual **or** Company (see §3.1) |
| Apple Developer Program | USD $99 payment, legal agreement | Defer until a Mac is available |
| Azure Artifact Signing | Paid Azure subscription, identity validation | Defer — Store path is free |
| ~~Domain purchase~~ | — | **Done 2026-08-12.** `varve.studio` registered at Porkbun; see budget plan §3 and `custom-domain-runbook.md` |
| ~~Making the repository public~~ | — | **Done 2026-08-04.** Secret-audited first; CI and Pages are now free |
| ~~Enabling GitHub Pages~~ | — | **Done 2026-08-04.** `build_type=workflow`; site at `https://k-arthur.github.io/varve/` until the custom domain landed |
| Publishing any release | Public distribution | All release automation lands as **draft**; publishing stays manual |

## 8. Decisions recorded 2026-08-06 (distribution hardening)

| Decision | Choice | Rationale |
|---|---|---|
| GitHub Pages URL architecture | Project site at `k-arthur.github.io/varve/`; no repository rename | A repo named `K-Arthur.github.io` would be the owner-level site and is not required. All URLs derive from `SITE_URL`/`SITE_BASE`; a domain switch is configuration, not migration |
| Custom domain | **Done 2026-08-12.** `https://varve.studio` (Porkbun) — `SITE_URL`/`SITE_BASE` + Pages settings + DNS | Runbook executed: `docs/release/custom-domain-runbook.md`; no committed `CNAME` (Actions deployments use repository settings) |
| Security headers on Pages | Only what the host supports: CSP via `<meta>`; `_headers` file removed | GitHub Pages cannot set arbitrary headers; claims of X-Frame-Options/HSTS on this host would be false |
| Release channel policy for the download page | Latest published **stable**; if none, latest published **prerelease**; drafts/deleted never | `fetch-website-release.mjs`; "latest release" endpoint alone is wrong when the first public release is a prerelease |
| Website analytics | None by default; `ANALYTICS_DOMAIN` opt-in; GitHub download counts as aggregate metrics only | Existing decision (§6) reaffirmed; counts are not unique users/retention |
| Release integrity order | Installers → manifests → SBOMs → `SHA256SUMS.txt` last → upload → re-download → re-hash → publish | `generate-final-checksums.mjs` + `verify-downloaded.mjs`; the checksum file covers every public asset except itself |
| SBOM scope | Per-platform CycloneDX 1.5 SBOMs (bundle contents differ by OS) + explicit all-platforms combined SBOM | `generate-sbom.mjs --os/--arch/--scope`; structural validator `validate-sbom.mjs` |
| Signing claims | `signed`/`notarized` stay false until signature verification succeeds; release notes derive from the manifest | No certificates owned; no aspirational labels; checksums ≠ code signing (stated on the download page) |
| Update mechanism | Consent-first updater for supported self-managed desktop packages; package-managed, unsupported, and development builds remain manual | `update-strategy.md`; `update-system-audit-2026-08-13.md` |

## 9. Decisions recorded 2026-08-08 (code signing engineering)

| Decision | Choice | Rationale |
|---|---|---|
| Windows signing solution | **Azure Artifact Signing, Basic, Public Trust** (when acquired) | Only option combining Microsoft-trusted identity, no hardware token, official Tauri `signCommand` integration, CI-friendly. ~$9.99/mo. EV rejected (no longer affects SmartScreen, per Microsoft Learn 2026-08-08); conventional OV rejected (token friction, legacy-only Tauri path); Store/MSIX remains the future $0 option and needs an MSIX build first |
| macOS signing solution | Apple Developer Program + **Developer ID Application** + notarization + stapling via App Store Connect API key | Direct DMG distribution requirement; no free tier; Developer ID Installer NOT needed (no `.pkg`) |
| Linux trust | Checksums + SBOM + **GitHub artifact attestations** on final bytes; GPG/AppImage signing deferred | AppImage does not verify embedded signatures automatically; attestations give users a simpler verification story until Flathub/real repos exist |
| Tauri updater keys | Not created | No updater (`update-strategy.md`); kept separate when it lands |
| Signing auth for Azure | Client secret via `artifact-signing-cli` (official Tauri path) | OIDC/workload identity NOT supported by that tool (source audited 2026-08-08); mitigated by rotation, least-privilege role, tag-only workflow |
| Fail-closed policy | `RELEASE_EXPECT_SIGNED` + channel policy encoded in `signing-policy.mjs`; preconditions checked before build; signedness from post-build verification only | A stable release never silently ships unsigned |

Full reasoning with sources: [signing-decision-record.md](signing-decision-record.md).
