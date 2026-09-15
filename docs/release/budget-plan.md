# Varve — Launch Budget Plan (CAD $200 hard cap)

**Prepared:** 2026-08-03
**Exchange rate used:** 1 USD = **1.4036 CAD** (spot, 2026-08-03). All conversions add a
**10% buffer** to absorb rate movement and card FX fees.
**Tax assumption:** 13% HST (Ontario). Where a vendor bills in USD from outside Canada, GST/HST
may be self-assessed rather than charged at point of sale; the buffer covers either case.

> Prices were read from primary vendor documentation on the dates shown. Prices change; re-verify
> before purchasing.

---

## 1. Verified price table

| Item | Vendor | Price (native) | Verified | Source |
|---|---|---|---|---|
| Apple Developer Program | Apple | USD $99 / yr | 2026-08-03 | [developer.apple.com/support/compare-memberships](https://developer.apple.com/support/compare-memberships/) |
| Microsoft Store developer account | Microsoft | **USD $0** (Individual **and** Company) | 2026-08-03 | [Partner Center — open a developer account](https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/open-a-developer-account) |
| Azure Artifact Signing — Basic | Microsoft | USD $9.99 / mo (5,000 sigs) | 2026-08-03 | [Artifact Signing pricing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/) + FAQ |
| GitHub Actions — public repos | GitHub | **USD $0**, unmetered | 2026-08-03 | [Actions billing](https://docs.github.com/en/billing/managing-billing-for-your-products/about-billing-for-github-actions) |
| GitHub Actions — private, Free | GitHub | 2,000 min/mo included | 2026-08-03 | same |
| GitHub Actions — private, Pro | GitHub | 3,000 min/mo included | 2026-08-03 | same |
| Actions overage — Linux / Win / macOS | GitHub | USD $0.006 / $0.010 / $0.062 per min | 2026-08-03 | same |
| Git LFS storage / bandwidth (Free & Pro) | GitHub | 10 GB storage + 10 GB/mo bandwidth free | 2026-08-03 | [Git LFS billing](https://docs.github.com/billing/managing-billing-for-git-large-file-storage/about-billing-for-git-large-file-storage) |
| Git LFS overage | GitHub | USD $0.07/GiB storage, $0.0875/GiB bandwidth | 2026-08-03 | same |
| GitHub Pages | GitHub | **USD $0** (public repos; 1 GB site, 100 GB/mo soft) | 2026-08-03 | GitHub Pages limits |
| Cloudflare Pages | Cloudflare | **USD $0** (500 builds/mo, unlimited bandwidth) | 2026-08-03 | Cloudflare Pages free tier |
| `.com` domain | Cloudflare Registrar | USD $10.44 / yr, **no renewal markup** | 2026-08-03 | [Cloudflare Registrar](https://www.cloudflare.com/products/registrar/) — at-cost model |
| `.app` / `.dev` domain | Cloudflare Registrar | ~USD $14 / yr at cost | 2026-08-03 | same |
| `.design` domain | various | ~USD $40–50 / yr | 2026-08-03 | retail registrars |
| Plausible Analytics | Plausible | from USD $9 / mo | 2026-08-03 | plausible.io pricing |

---

## 2. Scenario A — Near-zero-cost technical preview

**Total: CAD $0.00**

| Component | Choice | Cost |
|---|---|---|
| Artifact hosting | GitHub Releases | $0 |
| Linux packages | AppImage + `.deb` + `.rpm` | $0 |
| Windows | Unsigned NSIS, documented SmartScreen steps | $0 |
| macOS | **Omitted** (no Mac to validate on) | $0 |
| Website | Astro → GitHub Pages at `https://varve.studio` (Porkbun custom domain) | $0 hosting + domain cost (see §3) |
| Integrity | SHA-256 manifest + SBOM, published alongside | $0 |
| Updates | Manual — "check the releases page" | $0 |
| Analytics | None (GitHub download counts only) | $0 |
| CI | GitHub Actions | $0 — repo is public |

This scenario is genuinely free: the repository went public on 2026-08-04, so
GitHub-hosted runners are unmetered and GitHub Pages is available. The workflow
restructuring in `build.yml` was done anyway — a three-OS Tauri build on every PR
is slow feedback regardless of who pays for it.

**Confirmed executed 2026-08-04:**

- Repository made public (secret-audited first — see §4).
- GitHub Pages enabled for the repo with build source `workflow`
  (`gh api -X POST repos/K-Arthur/varve/pages -f build_type=workflow`);
  the site deploys via `website-deploy.yml` (originally to
  `https://k-arthur.github.io/varve/`). The earlier `HttpError: Not Found`
  deployment failures were the Pages-not-enabled state, not a workflow defect.
- **2026-08-12:** custom domain purchased (Porkbun) and the site moved to
  `https://varve.studio` — see `docs/release/custom-domain-runbook.md`.
- Container install-test tooling (`just verify-packages`) verified working with
  podman (rootless) against `ubuntu:22.04` and `fedora:38`.
- The Model Supply Chain Validation gate (previously failing on every push) is
  fixed; remaining red runs at the time of writing were rename-in-progress
  failures, not cost or infra issues.

Scenario A is honest as long as unsigned artifacts are labelled unsigned, with an accurate
description of the OS warnings and the supported way through them. It must never imply a trust
level the artifact does not have.

---

## 3. Scenario B — Recommended CAD $200 launch ✅

The recommendation is **spend almost nothing now**, because every paid item is currently
blocked on something money cannot fix.

| # | Item | Provider | Status | Native | CAD est. | Tax+buffer | CAD total | Renewal | When | Why | If deferred |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `.com` or `.app` domain | Cloudflare Registrar | **Done 2026-08-12** — `varve.studio` via Porkbun (see `custom-domain-runbook.md`) | USD $10.44–14 | $14.66–19.65 | +23% | **$24.17** | same, no markup | At public beta | Own the namespace; enables project email; prerequisite for a Store **Company** account | N/A — purchased |
| 2 | Real-device test time | Local shop / friend / rental | **Optional** | — | ~$50 | — | **$50.00** | one-off | Before any macOS or Windows claim | The one thing that actually unblocks macOS and Windows tiers | Windows/macOS stay Tier 3 forever |
| 3 | Contingency reserve | — | **Mandatory** | — | — | — | **$125.83** | — | Held | LFS/Actions overage, domain renewal, unforeseen | No cushion for a surprise bill |
| | **TOTAL COMMITTED** | | | | | | **$74.17** | | | | |
| | **RESERVE** | | | | | | **$125.83** | | | | |
| | **BUDGET** | | | | | | **$200.00** | | | | |

### Explicitly NOT purchased now

| Item | CAD/yr | Why not |
|---|---|---|
| Apple Developer Program | $139 + tax ≈ **$157** | No Mac to validate on. Buying it would produce a *trusted* build of *unverified* quality — a signature implies testing that has not happened. 78% of budget |
| Azure Artifact Signing | $168/yr | Decision record 2026-08-08 re-evaluated this: it is now the **recommended** Windows path once the Store integration time is weighed; the budget order below still says: validate on hardware first |
| Microsoft Store account | $0 | Free — no budget line. Costs *time* (identity verification, MSIX work), not money |
| Plausible Analytics | ~$152/yr | GitHub download counts answer the only question that matters at alpha |
| Paid crash reporting | $0–300/yr | Sentry's free tier is sufficient if crash reporting is added at all; do not add before consent UX exists |
| `.design` domain | ~$70/yr | 3–5× a `.com` for a vanity TLD, at alpha, with no traffic |

### Opportunity cost, stated plainly

The budget buys **one** of these:
- Apple membership (CAD ~$157), **or**
- Windows signing for ~14 months (CAD ~$168/yr), **or**
- a domain for ~8 years (CAD ~$24/yr), **or**
- real-device testing plus a domain plus a CAD $126 cushion.

The fourth is recommended, because signing and notarisation solve *trust* problems, and Varve
does not have a trust problem yet — it has a **verification** problem. Nobody has run this
application on Windows or macOS. Money spent on signatures before that is spent making an
untested build look trustworthy.

**Update 2026-08-08 (signing engineering):** this reasoning stands, and the
release pipeline is now certificate-ready (see `signing-decision-record.md` and
`code-signing-setup.md`). The acquisition order is unchanged: hardware
validation first, then Apple membership, then Azure Artifact Signing — the
pipeline fails closed in `signing-preflight` until then, and every unsigned
artifact remains honestly labelled.

---

## 4. The largest cost lever — DONE (2026-08-04)

The repository is now **public**. This was the single highest-value zero-cost
action available and it has been taken. Everything below is retained as the
reasoning, now settled.

**What it unlocked:** CI is free and unmetered, GitHub Pages is available on the
free tier, the `NOTICE` claim about published source became true, and Discussions
are available for support. The Actions-overage risk in §6 is closed.

The repository was previously **private**. GitHub Actions is **free and unmetered for public
repositories**; on private repos it draws down 2,000–3,000 included minutes/month with macOS at
**10×** and Windows at **2×**.

A single cold three-OS Tauri release build is realistically **400–600 billed minutes**. On a
Free account that is one to one-and-a-half pushes per month.

Making the repository public did:
- remove all CI metering,
- align with the `NOTICE` file, which states *"The source code for this product is
  publicly available"* — previously inaccurate, now true,
- align with FSL-1.1-MIT, a source-available licence whose entire premise is published source,
- enable free GitHub Pages for a project site,
- enable free GitHub Discussions for support (referenced by `SUPPORT.md`).

FSL-1.1-MIT still forbids competing use and converts to MIT after two years, so publishing the
source does not surrender commercial options.

**Done 2026-08-04.** Preceded by a full secret audit: every blob across 1,410
commits was scanned for provider tokens, private keys, certificates, JWTs and
credentialed connection strings — all zero. The one finding, a personal email in
an AUR PKGBUILD maintainer field, was scrubbed from history before publication.

---

## 5. Scenario C — Revenue-funded stable release

Trigger: sustained downloads plus either revenue or validated demand.

| Priority | Item | CAD/yr | Unlocks |
|---|---|---|---|
| 1 | Apple Developer Program | ~$157 | Developer ID signing, notarisation, stapled DMG — removes Gatekeeper friction entirely |
| 2 | Mac hardware (used M1/M2 Mini) | ~$500–800 one-off | The actual blocker. Without it, macOS support is a claim, not a fact |
| 3 | Domain + email (Fastmail/Migadu) | ~$40–90 | Professional contact that is not a personal address; required for Store Company accounts |
| 4 | Windows ARM64 + Linux ARM64 tiers | CI time | Broader hardware reach |
| 5 | Flathub | $0 + weeks of effort | Best-in-class Linux distribution and auto-updates |
| 6 | Crash reporting (Sentry free → paid) | $0–430 | Real crash data — **only with explicit opt-in consent** |
| 7 | Signed Tauri updater + staged rollout | $0 | Automatic updates once migrations are proven on all three OSes |
| 8 | Payment infrastructure | 5–8% of revenue | Paddle/Lemon Squeezy as merchant of record — handles GST/HST, EU VAT, refunds. Avoids registering for tax in dozens of jurisdictions as a solo developer |

Recommended order: **hardware → validation → signing → stores → payments.** Every step before
hardware produces claims that cannot be verified.

---

## 6. Recurring cost exposure to watch

| Risk | Trigger | Est. cost | Mitigation |
|---|---|---|---|
| Actions overage | ~~Private repo + bundle-on-every-push~~ | **$0 — closed** | Repository is public; runners are free and unmetered |
| LFS bandwidth | Naive `lfs: true` in CI — 1.26 GB × 3 runners/run | 10 GB free exhausted in ~3 runs | Fetch only `font-classify.onnx`; move `ddcolor` out of `public/` |
| LFS storage | 1.26 GB of the 10 GB free tier | $0 today | Do not add more large models to LFS |
| Release bandwidth | GitHub Releases assets are **not** metered | $0 | None needed — a genuine advantage over self-hosting |
| Pages bandwidth | 100 GB/mo soft limit | $0 | Artifacts live on Releases, not Pages |

---

## 7. Purchase checklist (when the trigger fires)

- [x] **Domain** — **executed 2026-08-12**: `varve.studio` registered at Porkbun
      (~$24 CAD with buffer; see §3 row 1). DNS/Pages configured per
      `docs/release/custom-domain-runbook.md`. Remaining checklist items are
      still pending — each requires payment or a legal agreement:
- [ ] **Microsoft Store account** — trigger: a Windows build launches successfully in a VM.
      Free. Decide Individual vs Company first (§3.1 of the distribution matrix) — it cannot be
      changed later.
- [ ] **Apple Developer Program** — trigger: a Mac is available **and** the app has been
      launched on it. Not before.
- [ ] **Azure Artifact Signing** — trigger: Store distribution proves insufficient. Requires a
      paid Azure subscription.
