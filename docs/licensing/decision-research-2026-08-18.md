# Licensing, Grants & Relicensing Decision Research

**Date:** 2026-08-18
**Status:** Decision support for the founder — not legal advice
**Scope:** Rights inventory, official-eligibility verification, licensing options
(A–D), dependency boundaries, grant-readiness material, founder memo.
**Hard rule honored:** no license file or license metadata was changed by this
research. This document is input to the licensing decision (Prompt 15).

Companion documents: `docs/licensing/review.md` (2026-07-21 BSL-era review,
superseded on the license choice by the 2026-07-25 FSL decision, still the
reasoning trail), `docs/CLA-DECISION-RECORD.md` (CLA plan), `CLA.md` /
`ICLA.md` / `CCLA.md` (drafts, not in effect), `COMMERCIAL.md` (edition model).

---

## 1. Rights inventory

Verified 2026-08-18 against the working tree at `master`
(`git status`: unrelated in-flight workstreams exist on master — analytics,
browser demo, screenshots. Nothing in this inventory touches them.)

### 1.1 Top-level documents

| File | Content | Status |
|---|---|---|
| `LICENSE` | FSL-1.1-MIT full text, `Copyright 2024-2026 K-Arthur` | In force |
| `NOTICE` | Copyright 2024-2026 K-Arthur; pointer to THIRD_PARTY_NOTICES; trademark note | In force |
| `THIRD_PARTY_NOTICES` | Attribution for npm deps, Rust deps, ONNX models, ONNX Runtime binaries, icon sets, fonts, offline icon starter pack | In force; self-described as generated + manually audited |
| `COMMERCIAL.md` | Community Edition (FSL) now; future Pro edition; "Pro features compiled into separate binaries, not gated by licence keys" | In force |
| `TRADEMARKS.md` | "Varve" trademark of K-Arthur; fork/rebrand rules | In force |
| `CLA.md` / `ICLA.md` / `CCLA.md` | Drafts for legal review; **not in effect**; governing-law placeholders; CLA Assistant workflow never created (2026-07-25 correction in CLA-DECISION-RECORD.md) | Draft |
| `CONTRIBUTING.md` | States external contributions are **not yet open** | In force |

### 1.2 Component table

| Component | Current license | Copyright holder(s) | External contributions? | Relicensing authority clear? | Third-party constraints |
|---|---|---|---|---|---|
| Root `LICENSE`, root `package.json`, root `Cargo.toml` (workspace) | FSL-1.1-MIT | K-Arthur | No | **Yes — sole author** | None |
| 20 `packages/*/package.json` + `apps/desktop`, `apps/web`, `apps/website` | FSL-1.1-MIT | K-Arthur | No | Yes | None |
| 12 `crates/*/Cargo.toml` (`license.workspace = true`) + `apps/desktop/src-tauri` (direct) | FSL-1.1-MIT | K-Arthur | No | Yes | None |
| All TypeScript/Rust/app source | FSL-1.1-MIT (no per-file headers) | K-Arthur (single human author; see 1.3) | No | Yes | None |
| Docs (`docs/`, `README`, AGENTS.md, website content) | FSL-1.1-MIT by declaration | K-Arthur (some agent-authored under owner direction) | No | Yes | None |
| Git history | — | Kevin Arthur (1628 commits), prior project identity (583 commits), K-Arthur (10), Cascade Agent (189, AI tool commits under owner direction), github-actions[bot] (1, baseline refresh), dependabot[bot] (1, Actions version bump) | No external humans; no `Co-Authored-By` from external humans | Yes, with documentation caveat (1.4) | — |
| Bundled AI models (`apps/desktop/public/models/`) | u2netp/u2netp-int8 MIT; realesr-general-x4v3(+int8) BSD-3-Clause; font-classify MIT; ddcolor(+tiny) Apache-2.0; yunet MIT; depth-anything-v2-small Apache-2.0 (on-demand) | Third parties (Daniel Gatis; Tencent ARC Lab; storia; DAMO Academy; OpenCV Zoo; Depth Anything authors) | n/a | **No — owner cannot relicense model weights** | Weights keep their own licenses; THIRD_PARTY_NOTICES documents each |
| Bundled fonts | Geist, IBM Plex Sans (SIL OFL 1.1, npm); OpenSans-Regular.ttf fixture (OFL) | Vercel; IBM; Google/SIL | n/a | No (third-party) | OFL attribution + license text included on redistribution |
| Icons | Lucide (ISC), Phosphor (MIT); starter-pack generated from Material Design Icons (Apache-2.0) + Lucide (ISC) | Third parties | n/a | No | Attributed in THIRD_PARTY_NOTICES |
| Generated artifacts (`apps/desktop/public/wasm/`, Tauri icons, starter-pack.json) | FSL-1.1-MIT (generated from owned source); starter-pack content carries upstream icon licenses | K-Arthur (+ icon upstreams) | No | Yes | Icon attribution preserved |
| Test corpora: `tests/fixtures/bg-removal-corpus/`, `semantic-corpus/`, `restore-corpus/`, `tests/e2e/fixtures/*`, `tests/e2e/lut/fixtures/*` | Corpus README states checked-in fixtures are "intentionally small and legally redistributable"; synthetic generator emits CC0 | Mixed — some synthetic/owned, some photos **without recorded provenance** (see 1.5) | n/a | **Unclear for raster photos** | Provenance docs exist only for `scripts/screenshots/fixtures/` (PROVENANCE.md, NASA public domain) |
| `scripts/screenshots/fixtures/` (earth.jpg etc.) | Public domain (NASA), documented in PROVENANCE.md | NASA (public domain); .varve docs owned | n/a | Yes | Documented |
| Third-party npm/Cargo dependencies | MIT, Apache-2.0, ISC, BSD, CC0, OFL, Unlicense only — **no copyleft** | Third parties | n/a | No | Compatible with FSL and with any OSI permissive relicensing of Varve code |

### 1.3 Authorship facts (verified via `git log`)

- All human commits are one person: Kevin Arthur, using several identities
  (the canonical name, an earlier founder alias, "K-Arthur", and AI-tool
  commits authored "Cascade Agent" / co-authored "Claude Sonnet 5" at the
  owner's direction).
- `dependabot[bot]` (1 commit: GitHub Actions bump) and `github-actions[bot]`
  (1 commit: visual baseline refresh) are tooling-only, non-substantive.
- **Zero external human contributors.** There is no one whose permission is
  required to relicense — today.

### 1.4 Caveats on relicensing authority

1. **AI-assisted commits.** The 2026-07-21 review and the CLA decision record
   already classify agent commits as owned by the person who directed the tool.
   Recommended: document this policy in writing (AUTHORS/CONTRIBUTORS note) so
   a future claim cannot dispute it.
2. **Identity hygiene.** Four git identities for one person is a provenance
   weakness for grant applications and any future dispute. A single canonical
   identity plus an AUTHORS file recording the founder's legal name is a cheap,
   high-value fix (do this before Prompt 15).
3. **Model weights and fonts are third-party.** They do not block relicensing
   of Varve code — they simply keep their own licenses in any redistribution.
4. **The window is open only while contributions are closed.** The CLA drafts
   are not in effect; the day the project accepts its first external PR without
   a signed ICLA/CCLA, relicensing freedom for that contribution is lost. The
   license model decision must precede the opening of contributions.

### 1.5 Provenance gaps (must fix before any relicensing claim or grant submission)

| Gap | Where | Why it matters |
|---|---|---|
| Raster photos in `tests/e2e/fixtures/` (flower.jpg, caf-4k.png, subject-photo.png, photo-fixture.jpg, test-image.png, caf-test.png) and `tests/fixtures/semantic-corpus/` (300+ images) and `restore-corpus/` have **no provenance file** | tests/ | Relicensing or republishing the corpus under an open license requires knowing the source of each photo |
| `semantic-corpus` appears to be screenshots-derived or crawled imagery | tests/fixtures/semantic-corpus/ | Same |
| ddcolor model hosting is owner-run (`models-v1` GitHub release) | models-source/, README | Not a license problem (weights are Apache-2.0), but a service dependency to document if crates go open |

Fix: one `PROVENANCE.md` per corpus directory, mirroring
`scripts/screenshots/fixtures/PROVENANCE.md`. This is a documentation task,
not a license change.

---

## 2. Official eligibility — verified against current primary sources (Aug 2026)

Headline: **FSL-1.1-MIT is on the SPDX license list, but is not OSI-approved,
not FSF-free, and not DFSG-compliant.** It is source-available, not open
source, by every official definition that matters.

| Program/channel | License requirement | Current FSL eligible? | Evidence | Non-license blockers | Worth pursuing? |
|---|---|---|---|---|---|
| **OSI** (Open Source Initiative) | OSD compliance | **No** | SPDX review of FSL submission states plainly: "this is not an open source license" (github.com/spdx/license-list-XML/issues/2458). FSL-1.1-MIT *is* accepted onto the SPDX list as a non-OSI license (spdx.org/licenses/FSL-1.1-MIT.html). | Competing Use / Permitted Purpose restriction fails OSD §6 (no discrimination against fields of endeavor) | Not applicable (OSI approval is a badge, not a grant) |
| **FSF** (Free Software Foundation) | FSF Free/Libre list | **No** | Guix maintainer thread (guix-devel, 2026-06): FSL-1.1-MIT "is not actually FSF approved"; Guix treats it as non-free (license field `#f`, nonguix territory) | Field-of-use restriction violates Free Software Definition | No |
| **Debian** | DFSG (main); non-free tolerated | **No for main; non-free at best** | Debian legal: packages with field-of-use restrictions are classified non-free (debian.org/legal/licenses/); FSL's Competing Use restriction fails DFSG §6 | Packaging effort, maintainer sponsorship; the two-year MIT conversion means a *2-year-old release* is genuinely MIT and could enter main — but always lagging the current release | Low for main; possible via non-free if a maintainer wants it |
| **Fedora** | Fedora-approved license list | **No** | Fedora Legal: "The package must be licensed with a Fedora approved license" (Packaging/ReviewGuidelines); FSL is not on the allowed list and its restriction matches the documented "field-of-use restriction" rejection pattern (fedora-license-data; docs.fedoraproject.org/en-US/legal/) | Same as Debian: only an aged, MIT-converted release qualifies; always one release behind | Low |
| **Ubuntu archive** | main/universe follow Debian DFSG | **No** (multiverse at best) | Ubuntu's main/universe admission mirrors Debian policy for licensing; no independent FSL ruling found — mark inference | Snap Store, however, accepts any license today (realistic Ubuntu channel) | Low (Snap yes) |
| **Flathub** | Current Requirements doc: content must allow legal redistribution; license declared in metainfo and matching the source; **"Open source and source-available projects must follow established conventions"** — OSI approval is **not** mandated | **Yes** | docs.flathub.org/docs/for-app-authors/requirements + /metainfo-guidelines (live, 2026). FSL redistribution for Permitted (non-competing) Purposes permits Flathub redistribution; FSL-1.1-MIT is a valid SPDX expression for `project_license` | AppStream classifies FSL as non-FLOSS (`license_is_free_license` is false) → the storefront will show a "Proprietary code"/non-FLOSS badge (discourse.flathub.org/t/8062 pattern); reviewers verify license accuracy; must build from source in Flathub infra (Tauri+WebKit runtime exists, but expect work); app id `dev.varve.desktop` — verification via GitHub auth or `dev.varve.desktop` domain token | **Yes — the one distribution channel open to FSL today**, and it is not a grant |
| **AUR** | No license gate for AUR hosting (license field is informational) | **Yes** | Arch policy: AUR accepts packages under any license; official Arch repos require libre licenses (FSL excluded there) | Volunteer maintenance; PKGBUILD must declare `license=('custom:FSL-1.1-MIT')` or similar; same aged-release MIT path for official repos | Yes (distribution), low effort; note AUR users get source builds |
| **NixOS / Guix** | Guix is FSDG-strict | **No** (Guix); Nixpkgs possible as unfree | guix-devel 2026-06 thread treats FSL as non-free; Nixpkgs has an `allowUnfree` escape hatch | — | Low |
| **NLnet / NGI Zero** (Core, Commons Fund, Green Web) | "Any software and hardware must be published under a recognised free and open source license **in its entirety**" | **No** | nlnet.nl/commonsfund/faq/ + eligibility pages (live): FLOSS "non-negotiable"; NLnet FAQ also allows partial openness *if the funded part is FLOSS and independent of proprietary tech* | EU/Horizon Europe residents get priority; non-EU needs exceptional quality + "clear European dimension"; grants ≤ €50k first round; deliverables need WCAG + security audit | **Yes, but only for Option B/D scope** (see §6) — the funded *deliverable* must be open, not the whole app |
| **Sovereign Tech Fund / Sovereign Tech Agency** | "OSI-approved or FSF Free/Libre licenses are acceptable" for code | **No** | sovereign.tech/programs/fund (live): also ≥ €50k per contract, "open digital base technologies" only, and explicitly "We do not finance the development of prototypes" | Design app = not base technology; prevalence criterion = "widely used for or within other technologies" | No (license + theme both fail today; revisit only if open crates gain real dependents) |
| **Prototype Fund** (Germany, BMBF) | "The software must be published under an Open Source license" | **No** | prototypefund.de/en/faq + /en/funding (live): up to €47.5k individual / €95k team; German residence (individuals) or German GbR (teams, members EU-wide); **prototype-stage only**; 2025+ focus is data security + software infrastructure; double-funding criterion: "similar product already available" is disqualifying | Past prototype stage; domain mismatch; residence | No |
| **Digital Public Goods Alliance** (DPG registry) | OSI-approved (or FSF) license for registration | **No** | DPG standard requires OSI/FSF licenses; also targets public-interest goods | Domain fit is weak | No |
| **GitHub Accelerator** | "Open source license" required (2024 cohort theme: open-source AI) | **No** (program dormant) | accelerator.github.com + github.com/open-source/accelerator show only the 2024 cohort; no 2025/2026 cycle published — **appears discontinued; mark as ambiguous** | — | No until a new cycle appears |
| **GitHub Sponsors** | No license requirement | **Yes** | Sponsors accepts any public repo | Requires audience/promotion; not a grant | Yes as ongoing income channel (works today, zero license change) |
| **GSoC / Outreachy / OSS-Fuzz** | GSoC/Outreachy: orgs must use OSI-approved licenses | **No** (GSoC/Outreachy); OSS-Fuzz has no license gate | Standard program rules; OSS-Fuzz accepts any project | These fund contributors/security work, not the founder | Only under Option B/C for the contributor pipeline |
| **Creative-software / design grants** | — | **No dedicated program identified** | Honest finding: no grant program for design applications was found. The field funds via ecosystem foundations (Blender Foundation, Krita Foundation, Inkscape via Software Freedom Conservancy, GNOME/KDE for their apps) that are donation-based or ecosystem-bound — not external grants. NLnet/NGI0 has funded design-adjacent *infrastructure* (fonts, creative-coding tooling); the credible route is to pitch the engine as infrastructure | — | Only via infrastructure framing (Option B/D) |

### 2.1 Interpretation

- Under FSL as-is, the grant landscape is essentially **zero** — every
  meaningful program requires an OSI/FSF-approved license for the funded scope.
- The one genuine channel win available today is **Flathub** (source-available
  accepted), plus AUR and Snap as Linux packaging channels — all distribution,
  none funding.
- Every distro (Debian/Fedora/Ubuntu main/Guix) has a **built-in path** through
  FSL's own design: a release that is two years old is MIT and therefore fully
  eligible. The cost is permanent lag: distros would always ship the aged
  release, never the current one. That is a real but honest compromise
  available with zero license change.
- If the founder's goal is *grant money*, the research says the only credible
  target is **NLnet/NGI Zero for an open, standalone infrastructure component**
  (Option B/D scope), not the application.

---

## 3. Model licensing options

### A — Keep FSL-1.1-MIT everywhere (status quo)

| Dimension | Assessment |
|---|---|
| Commercial protection | Strongest option. Competing Use clause blocks competing products/services on current code; Pro edition unconstrained (owner can dual-license privately). |
| Grants | Zero eligible programs (§2). |
| Distro eligibility | Non-free/lagging-only (Debian non-free, Fedora none, aged-release MIT path everywhere). |
| Contributor attraction | Weakest. "Source-available + CLA draft" deters contributors who refuse non-OSI projects; contributions must remain closed or CLA-gated. |
| Ecosystem reuse | Minimal; FSL packages are not consumable by open-source products with commercial ambitions. |
| Future monetization | Unconstrained: Pro edition, hosted services, commercial licenses all open. |
| Reversibility | **Partially irreversible by design**: each release becomes MIT after 2 years — that version is then open forever. New releases reset the clock. Full relicensing remains unilateral while solo (but closes at first CLA-less contribution). |
| Verdict | Rational if commercial protection outranks everything else. Note it is already a "deferred MIT" strategy — the question is only *when* each release opens. |

### B — Open reusable engine/infrastructure crates, keep app shell FSL

Candidate set (from §4 dependency analysis) — the genuinely separable layer:

- **Rust:** `varve-core` (geometry, SceneNode, hit-test), `varve-colour`
  (ICC/color science), `varve-layout` (flex/grid), `varve-media` (image
  codecs), `varve-effects` (effect IR + presets), `varve-upscale`,
  `varve-bgremove` (standalone, `ort` optional), `varve-trace` (raster-to-
  vector), `varve-engine` (IR builder), `varve-print` (PDF/PDF-X). All have
  zero or minimal intra-workspace coupling (§4.1) and zero app-schema imports.
- **TS:** `@varve/shared` (ordering/debounce/easing/units), `@varve/tokens`
  (DTCG token engine), `@varve/crash` (standalone crash core). Borderline:
  `@varve/codegen` and `@varve/import` are valuable generically but import the
  app-specific scene schema today (§4.2) — require refactor first.
- **Excluded:** `varve-bridge` (app wire format), `varve-wasm` (app glue),
  `@varve/scene` (the document model — the app's data heart), `@varve/engine`
  (mixed: facade + replay IR are generic, but it also contains app-coupled
  model catalogs/on-demand downloads), `@varve/editor`, `@varve/ui`,
  `@varve/home`, `@varve/ai`, `@varve/collab`, `@varve/history`,
  `@varve/prototype`, `@varve/layout`, `@varve/print`, `@varve/compositor`
  (compositor is generic-ish but coupled to engine IR).

License choice for the open layer: **MIT OR Apache-2.0 dual** for crates
(Rust ecosystem norm — matches kurbo/image/serde) and **MIT** for TS packages
(identical to the FSL future-license, so consumers get the same terms the app
will eventually carry, and no patent-grant asymmetry questions).

| Dimension | Assessment |
|---|---|
| Commercial protection | App shell stays protected (UI, workflows, scene model, AI features, model catalog, service integrations). But the crates ARE part of the moat (trace, print, colour) — competitors may reuse them to build a rival app; they must still build the editor, document model, and UX themselves. |
| Grants | **The only option with a real grant story**: NLnet/NGI0 will fund FLOSS infrastructure; STF becomes conceivable if the crates gain real dependents. |
| Distro eligibility | Crates land on crates.io (Fedora/Debian can package libraries regardless of the FSL app). The app itself stays non-free in distros. |
| Contributor attraction | Good for the library layer (well-scoped, CI'd, documented crates attract niche maintainers); still weak for the app itself. |
| Ecosystem reuse | Real: color science, tracing, PDF, layout are generic problems; reuse is plausible (and *desirable for the grants story*). |
| Future monetization | Unaffected for the app; possible secondary revenue (paid support/consulting on the open crates) — do not overstate. |
| Reversibility | Crates are irreversibly open once published; app remains fully flexible. |
| Risk | Divergence cost: open crates need public API stability, semver, docs, changelogs — a real maintenance tax for a solo dev. Mitigate by choosing the smallest credible set (start with varve-core + varve-colour + varve-trace). |

### C — Fully open Community Edition under a recognized OSI license

| Dimension | Assessment |
|---|---|
| Commercial protection | **Lost.** Anyone may fork the current code immediately, strip branding (trademark law still forbids *passing off*, but rebrands are legal), and sell a competing product — including as a hosted service. This is the whole point of OSI licensing. |
| Grants | Eligible in principle for everything in §2, but the realistic funding ceiling for a design app remains low: NLnet would still want an infrastructure framing; STF still requires "base technology" + prevalence. Do not assume open = funded. |
| Distro eligibility | Full and immediate: Debian main/universe, Fedora, Ubuntu, Guix — with the usual maintainer-sponsorship and packaging work. Flathub badge becomes "FLOSS". |
| Contributor attraction | Strongest. MIT (or MIT/Apache dual) is the least-friction license in the design-tool community; no CLA needed (inbound = outbound), DCO optional. |
| Ecosystem reuse | Maximum: plugins, forks, educational use, embedding in other tools — all lawful. |
| Future monetization | **Restricted to what cannot be forked**: services (collaboration/sync/cloud), hosted AI, enterprise support/SLA, brand, and genuinely-server-side features. COMMERCIAL.md's stated Pro plan (PDF/X, team sync, SSO, batch) — the non-service items are exactly what a fork can replicate. The open-core escape valve (Pro = separate proprietary modules) requires Pro to be built on server-side value or genuinely novel components. |
| Reversibility | **Irreversible in practice.** MIT grants are perpetual; a fork can persist forever. Only trademark remains. |
| Verdict | This is a business-model decision, not a license decision. It only makes sense if the monetization thesis is services-first. |

### D — Genuinely independent open infrastructure

Create separate, standalone open projects (own repos/crates.io packages,
own CI, own versioning) for the generic engine layer — deliberately **not**
shaped to win grants ("grant bait" fails review and wastes credibility).
Options B and D differ in governance: B keeps the crates inside the Varve
workspace; D extracts them into independently governed projects.

| Dimension | Assessment |
|---|---|
| Commercial protection | Same as B, plus cleaner: the FSL app depends on open crates by version, not by path — no accidental FSL code in the open layer. |
| Grants | Best-fit story for NLnet (independent infrastructure, clear deliverables, community governance) — but only after the projects exist and have users; grants fund maintenance/audits of existing infrastructure, not aspirational repos. |
| Distro/ecosystem | Same as B; independent versioning makes distro packaging of the libraries natural. |
| Cost | Highest maintenance overhead of all options (separate repos, governance, releases). |
| Reversibility | The open layer is irreversibly open; the app stays FSL. |
| Verdict | The right long-term endgame if B's crates gain traction — do not start here. Sequence: B's smallest set → publish → observe usage → graduate to D if warranted. |

---

## 4. Dependency boundaries

### 4.1 Rust crate graph (workspace, verified 2026-08-18)

```
varve-core ─┬─ varve-layout
            ├─ varve-trace (features: wasm)
            ├─ varve-colour ─ varve-print
            ├─ varve-engine
            └─ varve-bridge ─ varve-wasm
                                └─ varve-engine, varve-trace, varve-media
varve-sync, varve-upscale, varve-bgremove, varve-media, varve-effects — standalone (no workspace deps)
```

- `varve-core` is the only dependency root. Everything above it that does not
  touch `varve-bridge`/`varve-wasm` is app-schema-free.
- **Coupling to FSL-only/app-specific modules:** none inside the candidate
  set — no app schemas, no model catalogs, no internal services.
- **Coupling to bundled models:** `varve-upscale`/`varve-bgremove` use `ort`
  optionally but not the model manifest (manifests live in the TS layer).
  Their crates are model-agnostic.
- **Publishability:** crates currently inherit `license.workspace = true` —
  an open subset requires per-crate `license = "MIT OR Apache-2.0"` overrides
  plus per-crate LICENSE/NOTICE files (metadata change only, still no
  license-file change at root).

### 4.2 TS package graph (workspace, verified 2026-08-18)

```
standalone: shared, tokens, platform, crash, help
scene → shared, engine, tokens          ← document model (app heart)
engine → platform, shared               ← facade/replay generic; inference/model-catalog app-coupled
ui → scene, shared
compositor → engine, shared
codegen → engine, scene, shared         ← generic output, app-schema-coupled input
import → engine, scene, shared          ← generic parsers, app-schema-coupled output
layout → engine, shared, scene
print → engine, platform, scene
prototype → engine, scene, shared
history → scene  |  collab → scene  |  ai → scene
home → engine, platform, scene, shared, ui
editor → (everything)
desktop → editor, engine, home, platform, scene, shared, ui
```

- **Genuinely separable today:** `shared`, `tokens`, `crash` (standalone).
- **Separable after a refactor:** `import` (emit a neutral IR instead of the
  scene Document), `codegen` (consume a neutral IR), `engine` (extract
  inference/model-catalog/background-removal providers into an app-owned
  module — engine's own `traceDispatch.ts`/`rasterTrace.ts` provider chain is
  exactly this split, already started), `compositor` (depends only on engine
  IR + shared — separable with engine).
- **Not separable without re-architecting:** `scene`, `editor`, `ui`, `home`,
  `ai`, `collab`, `history`, `prototype`, `layout`, `print`.

### 4.3 Non-license refactors that pay off regardless of the decision

1. **Move inference providers/model catalogs out of `@varve/engine`** into an
   editor-owned module. Engine becomes a clean facade (IR, replay, thumbnail)
   — better architecture for everyone, prerequisite for ever opening it.
2. **Document test-corpus provenance** (1.5) — needed for any OSI relicensing,
   grant applications, or simply defending the corpus against takedown claims.
   Zero license change; do it regardless.
3. **Unify git identity + AUTHORS file** (1.4) — prerequisite for grants and
   clean relicensing documentation.
4. **SPDX identifiers** (REUSE-style headers) on new files only — cheap,
   improves grant/corp review optics; not required.
5. **If B/D: publish the smallest credible crate set** (start varve-core +
   varve-colour + varve-trace) with semver, changelogs, docs, benches —
   the maintenance bar is the real cost, so start small.
6. **`license.workspace = true` → per-crate overrides** in the open subset
   (metadata only) — no root license change.

---

## 5. Grant-readiness packets

Honest position: **under the current FSL there are no genuinely eligible grant
programs.** The packets below are therefore prepared for the two cases that
change the answer: (1) the founder opens the engine layer (B/D) — the NLnet
packet is ready to adapt; (2) no license change — the only actionable items
are distribution channels (Flathub/AUR/Snap) and GitHub Sponsors. Nothing in
this section fabricates users, stars, downloads, press, retention, or
endorsements; all facts are from this repository or primary program sources.

### 5.1 Packet: NLnet / NGI Zero Commons Fund (conditional on Option B/D)

**Case:** "Open, audited color + tracing infrastructure for the open web"
(based on `varve-core`, `varve-colour`, `varve-trace`, published MIT OR
Apache-2.0 with WASM bindings).

- **Problem statement:** Color management and raster-to-vector tracing in the
  open-source ecosystem are either GPL-bound (ImageMagick stack), abandoned,
  or coupled to monolithic apps. Creative tooling on the open web lacks a
  small, auditable, permissively-licensed geometry/color/trace core.
- **Public benefit:** free libraries for image editors, font tools,
  print pipelines, accessibility tooling; WASM build lowers the barrier for
  web apps; independent audit benefits downstream users.
- **Technical approach:** extract the three crates from the Varve workspace
  (already dependency-clean: §4.1), publish to crates.io + npm (wasm),
  pin model-free pure-Rust paths, add benchmarks + property tests.
- **Milestones:** (M1) extract + publish core geometry; (M2) publish colour
  science + ICC transforms; (M3) publish trace (silhouette/centerline/pixel-
  art) + WASM; (M4) security audit (NLnet-required) + WCAG-compliant demo
  pages; (M5) docs + adoption outreach.
- **Deliverables:** three crates + three npm wasm packages + demo +
  audit report + benchmark corpus.
- **Budget skeleton:** €30–50k for the first grant round (NLnet caps first
  requests at €50k): ~0.7 FTE equivalent over 10–12 months incl. audit
  (~€8–15k) and demo work; second-round (Commons Fund follow-up) possible
  after successful delivery.
- **Governance/maintenance:** maintainer = founder; decision record +
  contribution policy (DCO) published at extraction time; repository under
  the Varve GitHub org, per-project issue trackers; bus-factor mitigation:
  docs-first design, one full-time-equivalent budget line only if funded.
- **Measurable outcomes:** crate downloads (crates.io), dependent packages,
  npm wasm downloads, audit findings fixed, demo page WCAG conformance —
  all verifiable, none pre-supplied.

**Explicit blockers before applying:** (a) the funded scope must be
OSI-approved → requires the B/D license step for those crates;
(b) NLnet prioritizes EU/Horizon Europe residents; non-EU requires
exceptional quality + a "clear European dimension" — the founder must
resolve or address this honestly in the application;
(c) deliverables must be WCAG-compliant (existing a11y gates in this repo
help); (d) one AUTHORS/entity record (§1.4).

### 5.2 Packet: channels that need no license change

- **Flathub:** metainfo with `project_license=FSL-1.1-MIT`, source build of
  the Tauri app against the FreeDesktop runtime; expect the non-FLOSS badge;
  submit as upstream author (avoids third-party redistribution questions).
- **AUR:** PKGBUILD + `license=('custom:FSL-1.1-MIT')`; recommend official
  maintenance by the founder to prevent drift.
- **Snap Store:** any license accepted; Tauri snap exists upstream.
- **GitHub Sponsors:** activate; eligibility is repo-public, not license-
  based. The COMMERCIAL.md/Pro narrative is the pitch material.

### 5.3 Programs explicitly not worth pursuing (reasons on record)

STF (license + theme), Prototype Fund (license + stage + residence + domain),
DPGA (license + domain), GitHub Accelerator (no new cycle observed),
GSoC/Outreachy (license gate for orgs; only relevant under B/C).

---

## 6. Founder memo — decision matrix

| Decision criterion | A. FSL everywhere (status quo) | B. Open crates, FSL app | C. Full OSI (MIT/Apache) | D. Independent open infra |
|---|---|---|---|---|
| **Commercial protection** | Strongest — current code protected from competitors | App protected; core libraries reusable by rivals (trace/print/colour are part of the moat) | None for the code — competitors can fork and sell today; trademark only | Same as B, cleaner boundary |
| **Grant access** | None eligible | NLnet realistic; STF conceivable later; Prototype Fund no | Eligible in principle, but ceiling stays low for a design app | Best structural fit for NLnet/STF once adopted |
| **Distro eligibility** | Non-free/lagging-only; aged releases MIT | Libraries in Fedora/Debian today; app never | Full, immediate | Libraries only (same as B) |
| **Contributor attraction** | Weak; contributions must stay closed or CLA-gated | Moderate (libraries), weak (app) | Strongest; no CLA needed (inbound=outbound) | Moderate; governance adds credibility |
| **Ecosystem reuse** | Minimal | Real for the open layer | Maximum | Maximum for the layer |
| **Future monetization** | Unconstrained (Pro, services, commercial licenses) | App monetization unaffected; services still the durable moat under B/C | Forced toward services/enterprise/support — COMMERCIAL.md's client-side Pro features are forkable | Same as B |
| **Reversibility** | Partial (each release MITs after 2 years); full while solo | Open layer irreversible; app flexible | Irreversible in practice | Open layer irreversible; app flexible |
| **Costs** | Zero (today) | Maintenance tax on public crates (semver/docs/CI) | Brand/revenue restructuring; packaging work; the Pro plan must be re-thought | Highest (separate governance) |

**The three facts that dominate the decision:**

1. **Relicensing is unilateral today and only today.** One human owns 100% of
   the substantive code. That freedom dies with the first CLA-less external
   PR. Decide before opening contributions, and get the CLA machinery
   (or inbound=outbound policy) live first.
2. **FSL-1.1-MIT is already a deferred-open-source license.** Every release
   becomes MIT after two years. Option A is not "closed forever" — it is
   "closed until each version ages," and every distro can already ship the
   aged releases. The real question is whether *current* code being open
   (C) or open-with-boundaries (B/D) is worth the protection it costs.
3. **Grants do not justify open-sourcing.** No program pays a design
   application meaningfully; the one credible grant path (NLnet) pays for
   *infrastructure* — which points to B/D on a small, genuinely reusable set,
   or to nothing at all. If the founder wants grant money, open the crates
   and apply with an honest infrastructure pitch; if the founder wants
   protection, none of the grant programs change the calculus.

**Sequencing suggestion (not a decision — a decision-support path):**

1. Fix identity/AUTHORS + corpus provenance (§1.4–1.5) — needed in every
   scenario, zero license risk.
2. Decide the Pro-edition monetization thesis first (services vs. client
   features). If services-first, C becomes viable; if client-feature-first,
   A or B.
3. If protection is the priority: keep A, fix CLA enforcement before opening
   contributions, and treat Flathub/AUR/Snap/Sponsors as the distribution
   layer.
4. If ecosystem/grant pull outweighs protection on the engine layer: do B
   on the smallest set (varve-core, varve-colour, varve-trace), publish
   MIT OR Apache-2.0, then adapt §5.1 for the next NLnet call.
5. Do not start D; D is what B becomes if adoption justifies it.
6. If revenue thesis is services-first and brand strength is high: consider
   C in one clean cut (license files + metadata + website + corpus
   provenance + inbound=outbound policy), accepting that current-code
   competitors become legal.

---

## 7. Prerequisite list for Prompt 15 (if a license change is chosen)

1. **Decision record** on A/B/C/D with the monetization thesis written down
   (services vs client-side Pro), because the license choice is subordinate
   to it.
2. **AUTHORS/CONTRIBUTORS file** with the founder's legal identity and the
   AI-tool ownership policy; unify git author identity going forward.
3. **Provenance documentation** for every raster fixture in
   `tests/e2e/fixtures/`, `tests/fixtures/semantic-corpus/`,
   `tests/fixtures/restore-corpus/` (single PROVENANCE.md per corpus;
   replace or document each photo's source and license).
4. **Legal counsel sign-off** on ICLA/CCLA drafts (placeholders in §§11/13,
   governing law, patent scope) — or an explicit inbound=outbound policy if
   the chosen model needs no CLA.
5. **Contribution policy activation order:** license decision → CLA or
   inbound=outbound live → then open external contributions. Never the
   reverse.
6. **Scope list for B/D:** exact crates/packages with their dependency graph
   (§4.1–4.2) frozen at the change date; per-crate license overrides +
   LICENSE/NOTICE files; CI for publish (crates.io + npm); semver policy.
7. **Third-party re-check:** model weights and fonts keep their own licenses;
   no copyleft in the dependency tree (THIRD_PARTY_NOTICES still accurate);
   re-run the license scan at change time.
8. **Website/README/docs truth sweep:** every "open source"/"source-available"
   claim must match the chosen terms (existing marketing-copy audit and
   docs/licensing/review.md provide the checklist).
9. **If C:** decide MIT vs Apache-2.0 vs dual per-package; update LICENSE,
   root + 20 package.json + 12 Cargo.toml license fields, NOTICE,
   THIRD_PARTY_NOTICES header, COMMERCIAL.md, CLA.md/ICLA.md/CCLA.md
   (supersede), website pages; confirm trademark policy (TRADEMARKS.md)
   covers forks; accept irreversibility in writing.
10. **If B/D:** confirm the open crates do not import app schemas (they
    don't today, §4.1), keep `varve-bridge`/`varve-wasm`/scene-model code
    out of the open set, and document the model-download service dependency
    (owner-hosted `models-v1` release assets) as an external service of the
    app, not of the libraries.
