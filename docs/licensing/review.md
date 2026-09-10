# Strata Licensing Strategy Review

**Date:** 2026-07-21
**Status:** Decision-support document — not legal advice
**Reviewer:** Cascade Agent

---

## Migration Decision — 2026-07-25

**Superseding decision:** Strata has moved from BSL-1.1 to the **Functional
Source License, Version 1.1, MIT Future License (FSL-1.1-MIT)**, with a
**two-year** change date (not BSL's four-year window). This supersedes the
"Primary Recommendation: Option B — Source-Available with BSL 1.1" section
below; the analysis there remains useful context for *why* a source-available
license was chosen at all, but every reference to BSL 1.1 specifically, the
Additional Use Grant mechanism, and the four-year (or "3 years" / "3-4 years")
change-date figures appearing later in this document reflects the prior
BSL-era decision, not the current license.

**Why FSL over BSL:** BSL's Additional Use Grant is bespoke text written per
adopter, which undermines the predictability that made BSL-style licensing
attractive in the first place — this is precisely the flaw Sentry built FSL
to fix by freezing the Permitted Purpose / Competing Use language. FSL's
default two-year window (vs. BSL's four) was adopted as-is, since Strata's
Pro edition does not yet exist and there is no commercial urgency favoring a
longer window; a shorter window also builds more goodwill and is easier to
explain in one sentence.

**What actually changed:** `LICENSE`, all workspace `package.json`/`Cargo.toml`
license fields, and every doc/website page describing the license. See git
history from 2026-07-25 onward for the specific commits. This document's
historical BSL/AGPL analysis (below) has not been line-edited and should be
read as the reasoning trail that led here, not the current state.

**Current facts (verified 2026-08-10):** `LICENSE`, `NOTICE`, and
`THIRD_PARTY_NOTICES` exist; the root `package.json`, root `Cargo.toml`, and
all 20 `packages/*/package.json` declare `FSL-1.1-MIT`; the app identifier is
`dev.varve.desktop` and the repository is `github.com/K-Arthur/varve`. The
"Current Ownership and Licence Audit" section below predates those fixes and
is retained only as the audit trail — its specific findings (missing files,
AGPL declarations, `dev.strata.desktop`, `K-Arthur/Strata`) are **not** the
current state.

---

## Executive Summary

Strata is currently distributed without a licence file. The root `package.json` and
`Cargo.toml` declare `AGPL-3.0-or-later`, but **no `LICENSE` file exists in the
repository**. Under copyright law, this means the default of *all rights reserved*
applies — no one has any granted right to use, copy, modify, or distribute the
code. The website's claim of "Free and open-source (AGPL-3.0)" is factually
incorrect without a corresponding licence file.

The owner ("Strata Founder" / `K-Arthur`) is the sole copyright holder, with 583
of 730+ commits. The remaining commits are from an AI coding agent. There are no
external human contributors. This makes relicensing straightforward — there is
nobody else whose permission must be obtained.

**Critical finding:** The currently declared AGPL-3.0-or-later is incompatible with
the stated commercial goal of selling future paid editions. AGPL-3.0 requires that
anyone who distributes the software (including modified versions) must release
their complete source code under AGPL-3.0, which would prevent selling a proprietary
advanced edition without a separate commercial licence from the copyright holder.

**Primary recommendation:** Source-available licence (BSL 1.1 or FSL) for the
application, with MIT/Apache-2.0 for reusable libraries. This keeps the current
edition free, preserves commercial options, and avoids the contradictions of
AGPL-3.0.

---

## 1. Current Ownership and Licence Audit

### 1.1 Repository Identity

| Property | Value |
|----------|-------|
| GitHub URL | `https://github.com/K-Arthur/Strata` |
| Git authors | `Strata Founder <founder@strata.local>` (583 commits) |
| | `Cascade Agent <agent@strata.dev>` (147+ commits) |
| Package name | `strata` (npm), workspace (Cargo) |
| App identifier | `dev.strata.desktop` |
| Copyright claim | `Copyright 2024-2026 Strata Contributors — AGPL-3.0-or-later` (in tauri.conf.json) |

### 1.2 Existing Licence Files

| File | Present? | Content |
|------|----------|---------|
| `LICENSE` / `LICENCE` | **NO** | Missing — critical gap |
| `COPYING` | NO | — |
| `COPYRIGHT` | NO | — |
| `NOTICE` | NO | — |
| `AUTHORS` | NO | — |
| `THIRD_PARTY_NOTICES` | NO | — |

### 1.3 Declared Licences (metadata only, no legal text)

| Location | Declaration |
|----------|-------------|
| Root `package.json` | `"license": "AGPL-3.0-or-later"` |
| Root `Cargo.toml` workspace | `license = "AGPL-3.0-or-later"` |
| All 11 Rust crate `Cargo.toml` | `license.workspace = true` (inherits AGPL-3.0-or-later) |
| All 18 `packages/*/package.json` | **No licence declared** (property absent) |
| `apps/desktop/package.json` | **No licence declared** |
| `apps/web/package.json` | **No licence declared** |
| `apps/website/package.json` | **No licence declared** |
| `tauri.conf.json` | `"copyright": "Copyright 2024-2026 Strata Contributors — AGPL-3.0-or-later"` |

### 1.4 Website Claims

The landing page (`apps/website/src/pages/index.astro`) states:
> "Free and open-source (AGPL-3.0)"

This is inaccurate without a corresponding `LICENSE` file. The claim must be
corrected or a licence file must be added.

### 1.5 Copyright Ownership Assessment

| Component | Ownership | Confidence |
|-----------|-----------|------------|
| All TypeScript source (`packages/*/`) | Solely owned by Strata Founder (K-Arthur) | High |
| All Rust source (`crates/*/`) | Solely owned by Strata Founder | High |
| All Tauri app code (`apps/desktop/src-tauri/`) | Solely owned by Strata Founder | High |
| Website (`apps/website/`) | Solely owned by Strata Founder | High |
| UI icons & brand assets (`packages/ui/src/icons/`) | Solely owned by Strata Founder | High |
| All scripts (`scripts/`, `*.mjs`) | Solely owned by Strata Founder | High |
| Build config (`.github/`, `justfile`, configs) | Solely owned by Strata Founder | High |
| AI agent commits | Owned by Strata Founder (Cascade Agent is a tool, not a legal entity) | High |
| Third-party npm/Cargo dependencies | Third-party — see inventory below | High |
| ONNX model weights | Third-party — see inventory below | Medium |
| ORT WASM runtime files | Third-party (onnxruntime-web, MIT) | High |
| Native onnxruntime shared libraries | Third-party (MIT) | High |
| Bundled fonts (Geist, IBM Plex Sans) | Third-party (SIL OFL 1.1) | High |
| Lucide icons | Third-party (ISC) | High |
| Phosphor icons | Third-party (MIT) | High |
| Documentation (`docs/`) | Owned by Strata Founder | High |
| Existing AGENTS.md, README, memory files | Owned by Strata Founder | High |

**No code was found whose copyright belongs to another person, employer, school,
client, organisation, or upstream project beyond standard third-party dependencies.**

---

## 2. Third-Party Dependency and Asset Inventory

### 2.1 npm Packages (key dependencies)

| Package | Licence | Copyleft? | Note |
|---------|---------|-----------|------|
| `react` / `react-dom` | MIT | No | — |
| `lucide-react` | ISC | No | Icon library |
| `@phosphor-icons/react` | MIT | No | Icon library |
| `@tauri-apps/api` | MIT/Apache-2.0 | No | Dual |
| `@tauri-apps/cli` | MIT/Apache-2.0 | No | Dual |
| `onnxruntime-web` | MIT | No | WASM inference runtime |
| `@fontsource-variable/geist` | SIL OFL 1.1 | No | Font — requires attribution |
| `@fontsource-variable/ibm-plex-sans` | SIL OFL 1.1 | No | Font — requires attribution |
| `opentype.js` | MIT | No | — |
| `@floating-ui/dom` | MIT | No | — |
| `fractional-indexing` | MIT | No | — |
| `fractional-indexing` (again) | MIT | No | — |
| `@testing-library/*` | MIT | No | Dev only |
| `vitest` | MIT | No | Dev only |
| `playwright` / `@playwright/test` | Apache-2.0 | No | Dev only |
| `typescript` | Apache-2.0 | No | Dev only |
| `jsdom` | MIT | No | Dev only |
| `@biomejs/biome` | MIT/Apache-2.0 | No | Dev only |

No npm packages with GPL/AGPL/LGPL/MPL/EUPL copyleft licences were found.

### 2.2 Rust Crates (key dependencies)

| Crate | Licence | Copyleft? | Note |
|-------|---------|-----------|------|
| `tauri` (all 2.x) | MIT/Apache-2.0 | No | Dual |
| `serde` / `serde_json` | MIT/Apache-2.0 | No | Dual |
| `kurbo` | MIT/Apache-2.0 | No | Dual |
| `lopdf` | MIT | No | PDF generation |
| `image` | MIT/Apache-2.0 | No | Dual |
| `chrono` | MIT/Apache-2.0 | No | Dual |
| `notify` | CC0-1.0 | No | File watcher |
| `reqwest` | MIT/Apache-2.0 | No | Dual |
| `sha2` | MIT/Apache-2.0 | No | Dual |
| `arboard` | MIT/Apache-2.0 | No | Dual |
| `wasm-bindgen` | MIT/Apache-2.0 | No | Dual |
| `ort` (ONNX Runtime) | MIT | No | Native inference |
| `ab_glyph` | MIT/Apache-2.0 | No | Font rendering |
| `base64` | MIT/Apache-2.0 | No | Dual |
| `dirs-next` | MIT/Apache-2.0 | No | Dual |

No Rust crates with GPL/AGPL/LGPL copyleft licences were found. The Rust
dependency tree is entirely permissively licensed (MIT, Apache-2.0, CC0, BSD).

### 2.3 ONNX AI Models

| Model | Source | Licence | Bundled? |
|-------|--------|---------|----------|
| `u2netp.onnx` (4.9 MB) | rembg project (danielgatis/rembg) | MIT | Yes |
| `u2netp-int8.onnx` (1.4 MB) | Quantized from u2netp | MIT (derived) | Yes |
| `realesr-general-x4v3.onnx` (16.6 MB) | Real-ESRGAN (xinntao/Real-ESRGAN) | BSD-3-Clause | Yes |
| `realesr-general-x4v3-int8.onnx` (4.4 MB) | Quantized from realesr | BSD-3-Clause (derived) | Yes |
| `isnet-general-use.onnx` | rembg project | MIT | No (downloaded) |
| `birefnet-general-lite.onnx` | rembg project | MIT | No (downloaded) |
| `birefnet-general.onnx` | rembg project | MIT | No (downloaded) |
| `scunet.onnx` | Heliosoph/scunet-onnx (Hugging Face) | Unknown | No (downloaded) |

**Note on model weight licences:** The legal status of ONNX model weights is
unsettled. Most projects (including rembg and Real-ESRGAN) distribute their
weights under permissive licences. The bundled models (u2netp, realesr) are
compatible with all recommended licence options.

### 2.4 Native ONNX Runtime Binaries

| Platform | File | Licence | Source |
|----------|------|---------|--------|
| Linux x86_64 | `libonnxruntime.so` (23.6 MB) | MIT | ONNX Runtime (Microsoft) |
| macOS ARM64 | `libonnxruntime.dylib` | MIT | ONNX Runtime |
| Windows x86_64 | `onnxruntime.dll` | MIT | ONNX Runtime |

### 2.5 ORT WASM Runtime

All files under `apps/desktop/public/ort-wasm/` are from `onnxruntime-web` (MIT)
version 1.27.0.

### 2.6 Fonts

| Font | Source Package | Licence | Bundled? |
|------|---------------|---------|----------|
| Geist Variable | `@fontsource-variable/geist` | SIL OFL 1.1 | npm dependency |
| IBM Plex Sans Variable | `@fontsource-variable/ibm-plex-sans` | SIL OFL 1.1 | npm dependency |
| Google Fonts (user-installed) | — | Varies (mostly OFL) | Runtime |

**OFL requires:** Attribution text in documentation/credits. The licence text
must be included with redistributions.

### 2.7 Icon Assets

| Set | Package | Licence | Use |
|-----|---------|---------|-----|
| Lucide icons | `lucide-react` | ISC | Outline icons in UI |
| Phosphor icons | `@phosphor-icons/react` | MIT | Filled icons in UI |
| Strata brand icons | Original | Proprietary | Logo, wordmark, app icon |

### 2.8 Website Assets

| Asset | Status |
|-------|--------|
| `og-image.png` | Original/owned |
| `favicon.svg` | Derived from brand |
| `_headers`, `robots.txt`, `sitemap.xml` | Original |

### 2.9 Other Distribution Assets

| Asset | Licence | Note |
|-------|---------|------|
| Linux `.desktop` files | Original | - |
| Flatpak manifest | Original | - |
| Tauri icons (generated from source SVG) | Original | Generated from owned source |
| Playwright test results | - | Ephemeral, not distributed |

---

## 3. Problems and Unresolved Provenance

### 3.1 Critical Issues

1. **No `LICENSE` file exists** — this is the single most important legal gap.
   Without it, no one has any rights to the code. Every distribution or use by
   anyone other than the copyright owner is technically infringement.

2. **Website claims "open-source" without legal basis** — the claim at
   `apps/website/src/pages/index.astro:23` is misleading until a licence file is
   added. This should be corrected immediately regardless of which direction is
   chosen, because it creates a reasonable expectation of open-source rights that
   do not legally exist.

3. **Currently declared AGPL-3.0-or-later contradicts stated commercial goals** —
   the owner wants to sell future paid editions. AGPL-3.0 would require that all
   distributed versions (including any "Pro" edition) have their complete source
   released under AGPL-3.0. While the owner could dual-license (proprietary +
   AGPL), this requires a Contributor Licence Agreement for any external
   contributions and creates confusion about which licence applies to which parts.

4. **`tauri.conf.json` copyright statement is vague** — "Copyright 2024-2026 Strata
   Contributors" implies multiple copyright holders exist ("Contributors" plural),
   but all current contributions are from a single individual. This should be
   corrected to reflect actual ownership.

### 3.2 Moderate Issues

5. **Package-level licence metadata is inconsistent** — root declares AGPL-3.0-or-later
   but all sub-packages have no licence field. npm and crates.io package metadata
   is incomplete for downstream consumers.

6. **No third-party notice file** — dependencies under MIT, Apache-2.0, BSD,
   ISC, and SIL OFL require attribution. These notices must be included in
   source distributions and typically in packaged binary distributions.

7. **ONNX model provenance is partially unclear** — `scunet.onnx` is listed in
   the manifest with source `huggingface.co/Heliosoph/scunet-onnx` but no licence,
   SHA-256, or clear redistribution terms. It is not bundled (download-only), but
   users who download it may have unclear rights.

8. **Model weight legal status** — the law around distributing ML model weights
   is unsettled. They may or may not be "derivative works" of training data.
   Bundling them with the application increases legal surface area.

### 3.3 Minor Issues

9. Font redistribution obligations — if Strata bundles OFL-licensed fonts,
   it must include the OFL licence text and maintain attribution. The
   `fontLicensePolicy.ts` system handles this at runtime but no static notice
   exists in the repository.

10. Enterprise/production-use fonts — if users install commercial fonts and
    embed them in documents, Strata's redistribution of those documents could
    involve the user's font licence, not Strata's.

---

## 4. Decision Matrix

### 4.1 Candidates Evaluated

| Option | Description |
|--------|-------------|
| **A. Proprietary freeware (source closed)** | All rights reserved. Binaries free. Source private or view-only. |
| **B. Source-available (BSL 1.1 / FSL)** | Code viewable. Free use for specified limits. Commercial licence for advanced use. |
| **C. OSI open-source — permissive (MIT/Apache-2.0)** | Full open-source. Anyone can use, modify, sell, relicense. |
| **D. OSI open-source — copyleft (GPL-3.0 / AGPL-3.0)** | Full open-source, but derivative works must use same licence. |
| **E. OSI open-source — weak copyleft (MPL-2.0 / LGPL-3.0)** | File-level copyleft. Permissive for larger works. |
| **F. Dual licence (AGPL + commercial)** | AGPL for community; commercial licence for proprietary use. |
| **G. Open-core (community edition permissive + commercial modules proprietary)** | Separate repos/components. Free edition under MIT; paid features proprietary. |

### 4.2 Requirement Scoring

| Requirement | A. Proprietary | B. Source-avail | C. MIT/Apache | D. AGPL/GPL | E. MPL/LGPL | F. Dual AGPL | G. Open-core |
|---|---|---|---|---|---|---|---|
| Free current edition | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Commercial use by creators | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Redistribute official binaries | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Redistribute modified binaries | ✗ | Limited | ✓ | ✓ (source must follow) | ✓ (source for mods) | ✓ (AGPL) or paid | ✓ (community) |
| Source-code access | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (community) |
| Forking & modification | ✗ | Limited | ✓ | ✓ | ✓ | ✓ (AGPL) | ✓ (community) |
| Third-party commercial resale | ✗ | ✗ | ✓ | ✓ | ✓ | Only AGPL | ✓ (community) |
| Competing hosted services | ✗ | ✗ (BSL) | ✓ | ✗ (AGPL) | ✓ | ✓ (AGPL) or paid | ✓ (community) |
| White-labelling | ✗ | ✗ | ✓ | ✓ (with source) | ✓ | Only AGPL | ✓ (community) |
| Remove Strata branding | ✗ | ✗ | ✓ | ✓ | ✓ | Only AGPL | ✓ (community) |
| Plugin/extension development | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Community contributions | ✗ | Limited | ✓ | ✓ | ✓ | ✓ | ✓ |
| Ability to relicense contributions | N/A | ✓ (CLA) | ✗ | ✓ (CLA) | ✓ (CLA) | ✓ (CLA) | ✓ (CLA) |
| Sell future editions | ✓ | ✓ | ✗ (others can too) | ✓ (dual-licence) | ✓ | ✓ | ✓ |
| Dependency compatibility | ✓ | ✓ | ✓ | ⚠️ (GPL libs) | ✓ | ✓ | ✓ |
| Community adoption/trust | ✗ | Low | High | Medium | Medium | Low | Medium |
| Enforcement complexity | High (piracy) | Medium | Low | Medium | Medium | High | Medium |
| Solo-developer overhead | Low | Low | Low | Low | Low | Medium | Medium |
| App store compatibility | ✓ | ✓ | ✓ | ⚠️ (some restrictions) | ✓ | ✓ | ✓ |

### 4.3 Key Trade-offs

**MIT/Apache-2.0 (Option C)** would immediately make the project genuinely
open-source and eliminate all compliance friction, but would grant competitors
the unfettered right to create competing commercial products from the same code,
including white-labelled versions that remove all Strata branding. This is not
compatible with the stated goal of selling future paid editions, because someone
else could sell the same thing first.

**AGPL-3.0 (current declared choice, Option D)** would prevent competitors
from creating proprietary hosted/network services, which is appealing. But it
would also require any "Pro" edition to be fully source-available under AGPL-3.0,
defeating the commercial model unless paired with a paid commercial licence
(Option F — dual licensing). Dual licensing is viable but adds administrative
overhead (separate commercial licence, CLA for contributions, licensee tracking).

**Source-available (Option B)** avoids both problems: the code is publicly
viewable for learning, auditing, and non-commercial use, but commercial
redistribution, white-labelling, and competing services are restricted. This is
the model used by Sentry (BSL), GitLab (pre-2024), Material UI, and many others.
The change in 2024 by GitLab, HashiCorp, Redis, and others from open-source to
source-available licences indicates this is the dominant trend for
venture-funded/commercial open-core projects.

**BSL 1.1 (Business Source License)** is the most common and well-understood
source-available licence. It:
- Allows free use, modification, and limited redistribution
- Automatically converts to GPL-2.0 (or another chosen licence) after 3-4 years
- Restricts production use for commercial hosting/redistribution
- Is used by MariaDB, Sentry, and CockroachDB

**FSL (Functional Source License)** is newer (2024) and simpler:
- Allows non-commercial use, learning, modification
- Restricts commercial use to a limited number of users/seats
- Converts to Apache-2.0 or MIT after 2 years
- Used by Deno, Astral (Ruff/uv), and others

---

## 5. Primary Recommendation

### Option B: Source-Available with BSL 1.1

**Licence for the free application:** Business Source License 1.1 (BSL 1.1)
with an MIT or Apache-2.0 change licence after 3 years.

**Why BSL 1.1 over the alternatives:**

1. **Free edition stays free** — the BSL grants broad rights for non-production
   use (learning, personal projects) and production use as long as the instance
   is not a commercial distribution or competing hosted service.

2. **Future commercial editions are preserved** — the BSL's Additional Use Grant
   can be tailored to exclude specific commercial activities (e.g., running
   Strata as a hosted competitor service). Selling a "Strata Pro" desktop
   application would not violate this.

3. **Source is publicly viewable** — the repository stays public. Anyone can
   audit, learn from, fork (for non-competing purposes), and contribute.

4. **The "time bomb" conversion to MIT/Apache-2.0** after 3 years provides
   an escape valve: if the project dies or the owner stops maintaining it,
   the code becomes fully open-source. This builds trust.

5. **Massive precedent** — Sentry, MariaDB, CockroachDB, and other commercial
   infrastructure projects use BSL 1.1. The terms are well-understood by the
   legal and developer communities.

6. **Copyleft-free dependency tree** — every direct dependency is MIT, Apache-2.0,
   ISC, BSD, CC0, or SIL OFL. None require disclosure. BSL 1.1 is compatible
   with all of them.

7. **Solo-developer manageable** — no CLA administration, no dual-licence
   tracking for the community edition. Only commercial licensees need a separate
   agreement.

**What BSL 1.1 grants to users:**
- Use, copy, modify, and redistribute (with limits)
- Use the software for any lawful purpose internally
- Modify the source code for personal/internal use
- Contribute improvements back

**What BSL 1.1 does NOT grant:**
- Making the software available as a hosted service to third parties
- Distributing the software commercially without a separate licence
- Removing BSL notices and copyrights
- Any trademark licence

**How future paid editions work legally:**
The same copyright owner can sell separate commercial licences for "Strata Pro"
that permit everything the BSL restricts. The commercial edition can contain the
same code plus additional proprietary modules. This is the standard model used
by every BSL-licensed project.

### Option B variant: Functional Source License (FSL)

FSL is a credible alternative to BSL 1.1. It is simpler (one page) and was
designed by the author of BSL (Adam Wiggins of Heroku/MariaDB fame) in response
to criticisms of BSL's complexity. FSL automatically converts to Apache-2.0 or
MIT after 2 years. It restricts commercial use to a defined number of users
(a "Licensed User" model), which maps well to a subscription commercial edition.

**Recommended change licence:** MIT (maximally permissive, universally compatible)

---

## 6. Alternatives

### Alternative 1: MIT/Apache-2.0 Open-Source (Open-Core Architecture)

**Application:** MIT or Apache-2.0
**Commercial modules:** Proprietary, separate repository

This is the "open-core" model used by VS Code, Git (the CLI), and many others.
The community edition is genuinely open-source (OSI-approved). Commercial features
live in a separate proprietary repository or module.

**Advantages:**
- Unambiguously open-source — maximum community trust and adoption
- Contributors don't need a CLA (just DCO or inbound=outbound)
- Entirely dependency-compatible
- Clear legal separation between free and paid components
- Tested model with many successful examples

**Disadvantages:**
- Competitors can fork the community edition and create competing products
- Competitors can offer the same features as a paid service
- The owner gives up the ability to prevent white-labelling
- The commercial edition must offer genuinely additional value (not just the
  same features with a licence key)

**When this works:** If the commercial edition offers server-side services
(collaboration, cloud storage, team management, AI processing), asset marketplaces,
or enterprise features that cannot be replicated by forking the desktop client.

**Critical note for Strata:** Most of Strata's capabilities are client-side only
(vector editing, typography, print layout, animation). For open-core to work
commercially, the paid features must be things that either:
- Require server infrastructure (collaboration, asset sync, cloud rendering)
- Are genuinely complex and worth paying for (PDF/X-4 advanced colour management,
  enterprise print workflow automation, team libraries)
- Are sold as services rather than code (training, support SLAs, custom plugins)

If the planned "Pro" edition merely adds more inspector panels and canvas
capabilities, those can be trivially forked. Open-core only works when the
paid tier is hard to replicate without the company's infrastructure.

### Alternative 2: Dual Licence (AGPL-3.0 + Commercial)

**Community edition:** AGPL-3.0
**Commercial licence:** Proprietary, negotiated per-licensee

**Advantages:**
- AGPL prevents competitors from offering hosted Strata services without
  releasing their full stack as open-source
- Commercial licence generates revenue from enterprises who cannot comply with
  AGPL (which is most enterprises)
- Maximally protective of the owner's commercial interests
- OSI-approved licence for the community edition

**Disadvantages:**
- Requires a Contributor Licence Agreement for every external contributor
  (the owner must have the right to relicense contributions under the
  commercial licence)
- AGPL is perceived as hostile by many developers and companies
- Dual-licence enforcement is administratively heavier (two sets of licence
  terms, commercial licensing backend, licensee tracking)
- The AGPL'd edition is still open-source — competitors can fork it and offer
  competing AGPL'd services
- The current website claims "AGPL-3.0" which the project doesn't actually
  have a LICENSE file for — this would need to be corrected anyway

---

## 7. Proposed Free vs. Paid Edition Architecture

### 7.1 Structure

```
Strata Community (free)              Strata Pro (paid)
├── @varve/scene                    ├── @varve/scene
├── @varve/engine                   ├── @varve/engine (with Pro features)
├── @varve/editor (community)       ├── @varve/editor-pro (extended)
├── @varve/ui                       ├── @varve/ui
├── @varve/shared                   ├── @varve/shared
├── @varve/platform                 ├── @varve/platform
├── @varve/codegen                  ├── @varve/codegen (extended)
├── @varve/import                   ├── @varve/import
├── @varve/prototype                ├── @varve/prototype (extended)
├── @varve/ai                       ├── @varve/ai
├── @varve/collab (stub)            ├── @varve/collab (full)
├── crates/strata-core               ├── crates/strata-core
├── crates/strata-engine             ├── crates/strata-engine
├── crates/strata-print (basic)      ├── crates/strata-print (full PDF/X)
└── crates/strata-*                  └── crates/strata-*
```

### 7.2 Separation Strategy

1. **Monorepo with edition-specific directories:**
   - `packages/*` — shared packages, BSL-1.1 licensed
   - `packages-pro/*` — Pro-only packages, proprietary
   - `crates/*` — shared Rust crates, BSL-1.1 licensed
   - `crates-pro/*` — Pro-only Rust crates, proprietary
   - `apps/desktop` — builds community edition by default
   - `apps/desktop-pro` — builds Pro edition with all features

2. **Feature gates at build time, not runtime:**
   - Rust: `#[cfg(feature = "pro")]` for Pro-only code
   - TypeScript: separate entry points or build profiles
   - No licence-key checks or feature flags for the community edition
   - Pro features are literally compiled into different binaries

3. **Community edition is always buildable:**
   - `pnpm build` without `--pro` flag produces a fully functional application
   - No hidden "upgrade now" upsells in the community UI
   - Documentation clearly marks which features are Pro

4. **Pro features should be genuinely valuable additions, not arbitrary removals:**
   - Advanced PDF/X export with full ICC profiles
   - Team collaboration with real-time sync
   - Cloud asset library and team templates
   - Enterprise SSO and audit logging
   - Priority support and SLA
   - Batch/automation features (headless CLI processing)
   - Extended cloud rendering and export
   - Version history and branching

### 7.3 What NOT to do

- **Do not** create superficial feature flags that disable basic functionality
  (don't make Select tool Pro-only)
- **Do not** make the community edition silently dependent on unavailable
  Pro services (check for service availability gracefully)
- **Do not** break file format compatibility between community and Pro
- **Do not** claim "open-source" if the primary licence is BSL or proprietary
- **Do not** accept contributions to Pro modules under open-source terms without
  a CLA

---

## 8. Free-Edition Commitment

### 8.1 Proposed Policy

```
Strata Community Edition Commitment

The current edition of Strata (the "Community Edition") will remain free to use
for all lawful purposes. "Free" means:

- Zero purchase price. No payment is required to download, install, and use the
  Community Edition.
- Unrestricted commercial use. You may use the Community Edition to create
  designs for any commercial purpose, including client work, products for sale,
  and corporate branding.
- Unrestricted non-commercial use. Personal projects, education, hobby work,
  and open-source contributions are all permitted.

This commitment applies to all releases within the 0.x and 1.x version lines
of the Community Edition. If a hypothetical "Strata Community 2.0" introduces
a different model, the commitment will be restated at that time.

The Community Edition will continue to receive:
- Bug fixes and stability improvements
- Compatibility updates for new operating system versions
- Security patches
- Performance improvements to existing features
- Updates to supported file import/export formats

New features may be added to the Community Edition. Features introduced in the
paid "Strata Pro" edition will not be removed from the Community Edition after
their introduction, though they may be introduced in Pro first.

Optional paid services (such as cloud storage, team collaboration, or AI
processing credits) may integrate with the Community Edition but are not
required for its core functionality.

You may continue using any installed version of the Community Edition
indefinitely, even if development ceases or the company changes direction.
Features that depend on network services will remain accessible according to
the terms of those services.

The source code for the Community Edition is available at
https://github.com/K-Arthur/Strata under the terms of the licence file
accompanying each release.
```

### 8.2 Key Design Decisions

- **"Community Edition" not "Free Edition"** — avoids the "free forever" trap
  while making the model clear
- **Version-scoped (0.x and 1.x)** — preserves flexibility for a hypothetical
  major architectural change while providing concrete coverage for the foreseeable
  future
- **No vague "free forever"** — precision about what "free" means (price,
  permitted uses, support categories)
- **Infinite fallback** — installed versions work forever without phoning home
- **Optional services are clearly optional** — no required subscriptions

---

## 9. Contributor Governance

### 9.1 Recommendation: DCO + Contributor Assignment

**Approach:** Developer Certificate of Origin (DCO) sign-off with a lightweight
Contributor Assignment Agreement.

**Why:**
- The DCO (used by the Linux Kernel, Git, and thousands of projects) confirms
  the contributor has the right to submit the work. It does not transfer copyright.
- A separate Contributor Assignment Agreement grants the project owner the
  permission needed to:
  - Distribute contributions under the BSL-1.1 community licence
  - Distribute contributions under any future commercial licence
  - Maintain the ability to change the licence
- This is the standard model for dual-licensed and source-available projects.

**Process:**
1. All commits must be signed off with `Signed-off-by: Name <email>` (DCO)
2. First-time contributors also sign a lightweight CLA granting:
   - A non-exclusive, worldwide, royalty-free licence to Strata's owner to
     reproduce, prepare derivative works, distribute, and sublicense the
     contribution under any licence
   - The contributor retains full copyright
   - The licence continues even if the contributor stops contributing
3. The CLA covers: code, documentation, translations, tests, designs
4. Assets (icons, brand materials) are accepted under the same terms

### 9.2 What NOT to Do

- **Do not** accept external contributions without DCO + CLA — without them,
  the owner cannot relicense the project or use contributions in commercial
  editions
- **Do not** request full copyright assignment — it's unnecessary and scares
  away contributors
- **Do not** treat AI-generated code differently from human-written code —
  the submitter takes responsibility for it
- **Do not** accept contributions to Pro/proprietary modules under the community
  CLA — those should be done under a separate commercial contractor agreement

### 9.3 Solo Developer Practicality

As a solo developer, the simplest practical approach:
1. Accept contributions only via GitHub pull requests
2. Require DCO sign-off (`git commit -s`)
3. Use a CLA bot (CLA Assistant or similar) for first-time contributors
4. For small/trivial contributions (typo fixes, one-line changes), a CLA may
   be waived at the owner's discretion
5. Clearly document this in `CONTRIBUTING.md`

---

## 10. Trademark and Branding Policy

### 10.1 Ownership

The "Strata" name, logos, wordmarks, product icons, and related branding are
owned by the project owner. Copyright licensing of the code does not imply any
trademark licence.

### 10.2 Current Usage

The name "Strata" is used for:
- GitHub repository: `K-Arthur/Strata`
- npm packages: `@varve/*`
- Rust crates: `strata-*`
- Application: `Strata`
- Website: `strata.app` (or similar)
- App identifier: `dev.strata.desktop`
- Desktop entry: `dev.strata.desktop.desktop`

### 10.3 Name Conflict Check

"Strata" is a common word and is used in multiple software products:
- **Adobe Stratus** (different name)
- **Stratasys** (3D printing)
- **Strata Decision Technology** (healthcare analytics)
- **Strata Health** (healthcare)
- **Strata Oncology** (healthcare)
- **Strata** — there is a "Strata" design tool by a company called "Strata"
  (formerly known for Strata 3D CX), but this appears to be a legacy product.

A basic trademark search across design software categories is recommended before
heavily investing in the name. The project should register the trademark if the
name is determined to be available for software/services.

### 10.4 Proposed Trademark Usage Policy

```
Strata Trademark Usage Policy

The "Strata" name, logos, and related branding are trademarks of the project
owner. This policy governs their use.

Permitted without permission:
- Accurate, factual references to Strata in text (e.g., "compatible with Strata,"
  "based on Strata", "a plugin for Strata")
- Use in personal/non-commercial projects that are not distributed to others
- Use in educational materials describing the software

Requiring permission:
- Using the Strata name or logo in a commercial product name
- Using the Strata logo as part of another brand or product identity
- Creating domain names containing "strata" related to design software

Prohibited:
- Modified builds branded as "Strata" or using Strata logos
- Implying official endorsement, affiliation, or certification without written
  agreement
- Using the Strata mark in a way that causes confusion with the official product
- Registering the Strata name as a trademark, domain name, or social media
  handle for competing products

Community plugins:
- May reference Strata in their description (e.g., "My Plugin for Strata")
- May not use the Strata logo as their own logo
- May not use "Strata" as their primary product name

Modified builds (forks):
- Must remove or replace all Strata branding (name, logos, wordmarks, icons)
- Must not imply they are official Strata releases
- Must clearly state they are modified versions
```

---

## 11. Required Repository and Website Documents

### 11.1 Documents to Create

| Document | Location | Contents |
|----------|----------|----------|
| `LICENSE` | Repo root | Full BSL 1.1 licence text + Additional Use Grant |
| `NOTICE` | Repo root | Copyright notice + third-party attribution |
| `THIRD_PARTY_NOTICES` | Repo root | Attribution for all bundled dependencies |
| `CONTRIBUTING.md` | Repo root | DCO process, CLA link, PR workflow |
| `CONTRIBUTOR_LICENSE.md` | Repo root | Contributor Assignment Agreement text |
| `SECURITY.md` | Repo root | Security vulnerability reporting process |
| `SUPPORT.md` | Repo root | Where to get help |
| `CODE_OF_CONDUCT.md` | Repo root | Community behaviour guidelines |
| `TRADEMARKS.md` | Repo root | Trademark usage policy |
| `COMMERCIAL.md` | Repo root | Explanation of Community vs Pro editions |
| `FAIR_USE_POLICY.md` | Repo root | What the Additional Use Grant permits/restricts |

### 11.2 Documents to Update

| File | Change |
|------|--------|
| `README.md` | Add licence badge, clear description, link to COMMERCIAL.md |
| `package.json` | Correct `"license"` field to `"BSL-1.1"` (or chosen licence) |
| `Cargo.toml` | Correct `license` field in workspace |
| All `packages/*/package.json` | Add correct `"license"` field |
| `apps/desktop/src-tauri/tauri.conf.json` | Update copyright to individual owner name |
| `apps/website/src/pages/index.astro` | Remove "Free and open-source (AGPL-3.0)" — replace with accurate wording |

### 11.3 Future Documents (when commercial edition launches)

- End-User Licence Agreement (EULA) for commercial edition — requires lawyer
- Commercial licence terms for Pro edition — requires lawyer
- Privacy policy for any online services — requires lawyer
- Terms of service for collaboration/cloud features — requires lawyer

---

## 12. Plain-Language Licensing FAQ

```
Q: Is Strata free?
A: Yes, the Strata Community Edition is free to download, use, and modify for
   any lawful purpose. No payment is required.

Q: Can I use Strata for commercial work?
A: Yes. You can use Strata to create commercial designs, sell your work, and
   run your business. The licence covers your use of the software.

Q: Is Strata open-source?
A: The source code is publicly viewable and modifiable under the Business Source
   License (BSL 1.1). After 3 years from each release, that release's code
   automatically converts to the MIT licence. The BSL has not been approved by
   the Open Source Initiative, so we describe it as "source-available" rather
   than "open-source."

Q: Can I redistribute Strata?
A: You may redistribute unmodified official binaries. You may redistribute
   modified source code for non-commercial purposes. Commercial redistribution
   (selling copies or bundling in a commercial product) requires a separate
   licence.

Q: Can I fork the repository?
A: Yes. You may fork and modify the code for personal use, learning, or
   non-commercial projects. If you want to offer a competing product or
   service, please contact us for a commercial licence.

Q: Can I remove the Strata branding?
A: No. Modified builds must retain the Strata name and branding unless you have
   a separate licence agreement. If you need to create a white-labelled version,
   please contact us.

Q: Can I create a plugin for Strata?
A: Yes. Plugins and extensions are encouraged. Your plugin may reference Strata
   in its description. The plugin itself is your intellectual property.

Q: Will the free edition always exist?
A: The current Community Edition (0.x and 1.x release lines) is committed to
   remaining free. If a future major version (e.g., 2.0) introduces changes,
   the commitment will be restated at that time. Installed versions continue
   working indefinitely.

Q: Can I contribute code?
A: Yes, under the Developer Certificate of Origin (DCO) and a lightweight
   Contributor Assignment Agreement. Sign-offs are required on every commit.

Q: What about fonts and models bundled with Strata?
A: Bundled fonts (Geist, IBM Plex Sans) are under the SIL Open Font Licence 1.1.
   Bundled AI models (u2netp, Real-ESRGAN) are under MIT and BSD-3-Clause
   licences. See THIRD_PARTY_NOTICES for details.

Q: What happens if the project is abandoned?
A: After 3 years from each release, that release's code converts to the MIT
   licence. If the project stops releasing new versions, all previously released
   code becomes MIT-licensed over time, and the community can freely continue
   development.
```

---

## 13. Migration Plan

### Phase 1: Correct the Immediate Gaps (do this first, takes 1-2 hours)

1. Add `LICENSE` file with BSL 1.1 text (from https://mariadb.com/bsl11)
2. Update root `package.json` licence field to `BSL-1.1`
3. Update root `Cargo.toml` licence field to `BSL-1.1`
4. Fix the copyright in `tauri.conf.json` (replace "Strata Contributors" with
   the actual owner name)
5. Correct the website claim from "Free and open-source (AGPL-3.0)" to
   "Free and source-available — view the licence"
6. Run `pnpm install` and `pnpm test` to verify nothing breaks from licence field
   changes

### Phase 2: Attribution and Compliance (takes 1-2 days)

7. Generate a full third-party notice file by scanning:
   - `pnpm licenses list --json` (or similar) for npm dependencies
   - `cargo license` for Rust dependencies
   - Manual entries for ONNX models, fonts, icon sets
8. Create `THIRD_PARTY_NOTICES` with all required attributions
9. Create `NOTICE` with the project's own copyright notice
10. Verify bundled distributions include notices (tauri.conf.json resources)

### Phase 3: Contributor Infrastructure (takes 1 day)

11. Create `CONTRIBUTING.md` with DCO sign-off instructions
12. Create `CONTRIBUTOR_LICENSE.md` with the CLA text
13. Set up CLA Assistant bot (GitHub App) or manual CLA workflow
14. Create `CODE_OF_CONDUCT.md`
15. Create `SECURITY.md`

### Phase 4: Brand and Website (takes 1 day)

16. Create `TRADEMARKS.md`
17. Update website: remove "open-source" from hero text, add licence description
18. Update `README.md` with correct licence badge and descriptions
19. Create `COMMERCIAL.md` explaining edition model
20. Create `FAIR_USE_POLICY.md` clarifying the BSL Additional Use Grant

### Phase 5: Documentation (takes half a day)

21. Write the plain-language FAQ and add to website/docs
22. Review all documentation for inaccurate licence references
23. Ensure `pnpm audit:tokens`, `pnpm audit:emoji`, and other CI checks still pass

### Phase 6: Verification (takes half a day)

24. Run `just gate` to verify format, lint, typecheck, tests, audits
25. Verify `pnpm build` produces a working distribution
26. Confirm `THIRD_PARTY_NOTICES` is bundled in the Tauri resources
27. Push to GitHub and verify the repository now displays BSL licence in header
28. Verify the website deploys with corrected text

### Phase 7: Future (when commercial edition launches)

29. Draft commercial EULA (requires lawyer)
30. Set up payment processing
31. Create separate `strata-pro` repository or build profile
32. Establish commercial licensee tracking

---

## 14. Exact Files to Add or Change

### 14.1 New Files

```
LICENSE                         — BSL 1.1 full text (unmodified, from https://mariadb.com/bsl11)
NOTICE                          — Project copyright + brief attribution
THIRD_PARTY_NOTICES             — Full dependency attribution
CONTRIBUTING.md                 — Contribution guide with DCO
CONTRIBUTOR_LICENSE.md          — CLA text
CODE_OF_CONDUCT.md              — Community standards
SECURITY.md                     — Security reporting
SUPPORT.md                      — Support resources
TRADEMARKS.md                   — Trademark usage policy
COMMERCIAL.md                   — Edition explanation
FAIR_USE_POLICY.md              — BSL Additional Use Grant details
docs/licensing/                 — This review document
```

### 14.2 Modified Files

```
package.json                    — "license": "BSL-1.1"
Cargo.toml                      — license = "BSL-1.1"
apps/desktop/src-tauri/tauri.conf.json  — copyright owner name
apps/website/src/pages/index.astro      — hero text fix
README.md                       — licence badge + description
```

### 14.3 Files to Add Licence Metadata To

```
packages/ai/package.json        — "license": "BSL-1.1"
packages/codegen/package.json   — "license": "BSL-1.1"
packages/collab/package.json    — "license": "BSL-1.1"
packages/compositor/package.json — "license": "BSL-1.1"
packages/editor/package.json    — "license": "BSL-1.1"
packages/engine/package.json    — "license": "BSL-1.1"
packages/help/package.json      — "license": "BSL-1.1"
packages/home/package.json      — "license": "BSL-1.1"
packages/import/package.json    — "license": "BSL-1.1"
packages/layout/package.json    — "license": "BSL-1.1"
packages/platform/package.json  — "license": "BSL-1.1"
packages/print/package.json     — "license": "BSL-1.1"
packages/prototype/package.json — "license": "BSL-1.1"
packages/scene/package.json     — "license": "BSL-1.1"
packages/shared/package.json    — "license": "BSL-1.1"
packages/ui/package.json        — "license": "BSL-1.1"
apps/desktop/package.json       — "license": "BSL-1.1"
apps/web/package.json           — "license": "BSL-1.1"
apps/website/package.json       — "license": "BSL-1.1"
```

---

## 15. Automated Compliance and Verification Plan

### 15.1 Licence Scanning

Add to CI and/or `justfile`:

```bash
# Rust dependency licence scanning
cargo install cargo-license
cargo license --json > /tmp/rust-licenses.json

# npm dependency licence scanning
pnpm licenses list --json > /tmp/npm-licenses.json  # or use license-checker

# Validate against policy
node scripts/audit-licenses.mjs
```

### 15.2 Compliance Checks to Automate

1. **Copyleft detection** — scan all dependency licences for GPL/AGPL/LGPL;
   fail if found (unless intentionally approved)
2. **Attribution coverage** — verify every dependency in the lockfile has a
   corresponding entry in `THIRD_PARTY_NOTICES`
3. **Licence metadata consistency** — verify declared licences in `package.json`
   and `Cargo.toml` match the `LICENSE` file
4. **SPDX compliance** — add SPDX headers to new source files (optional but
   best practice)
5. **Bundled notice verification** — verify `THIRD_PARTY_NOTICES` is included
   in `tauri.conf.json` resources for desktop builds
6. **Website accuracy** — check the website doesn't use incorrect terminology

### 15.3 Proposed Script

Create `scripts/audit-licenses.mjs` that:

1. Reads the project's SPDX expression from root `package.json`
2. Scans `pnpm-lock.yaml` for all dependency licences
3. Groups by category (permissive, copyleft, unknown, missing)
4. Checks for any GPL/AGPL/LGPL dependencies
5. Verifies all `package.json` files in workspace have a `license` field
6. Verifies `LICENSE` file exists
7. Verifies `THIRD_PARTY_NOTICES` exists and is not empty
8. Exits with non-zero if any policy violation is found

### 15.4 Enforcement in CI

Add the audit as a step in `.github/workflows/ci.yml` after the existing tests:

```yaml
- name: Licence compliance audit
  run: node scripts/audit-licenses.mjs
```

---

## 16. Risk Register

| # | Risk | Severity | Likelihood | Mitigation |
|---|------|----------|------------|------------|
| 1 | No `LICENSE` file currently exists — all distributions are technically infringing | Critical | Certain | Add BSL-1.1 `LICENSE` file immediately |
| 2 | Website claims "open-source" without legal basis | High | Certain | Correct website text immediately |
| 3 | AGPL-3.0 declared in metadata without corresponding file or ability to comply with stated goals | High | Certain | Change to BSL-1.1 or appropriate licence |
| 4 | External contributor submits code without CLA — project cannot relicense | High | Unlikely (no external contributors yet) | Implement DCO + CLA before accepting external contributions |
| 5 | AI agent commits — unclear copyright status of AI-generated code | Medium | Already occurred | AI-generated code is owned by the person who directed the tool. Document this policy. |
| 6 | Trademark "Strata" conflicts with existing design software | Medium | Possible | Conduct trademark search before investing further in brand |
| 7 | Model weight legal uncertainty — ONNX weights may have unclear redistribution rights | Medium | Low (bundled models are from permissive projects) | Document sources and licences in manifest.json |
| 8 | SCUNet model licence unclear — distributed via Hugging Face without SPDX | Medium | Low (not bundled, download-only) | Add warning in manifest; do not bundle |
| 9 | OFL font attribution omitted from binary distributions | Low | Low | Add to THIRD_PARTY_NOTICES and verify bundling |
| 10 | Solo developer becomes unavailable — project and commercial commitments are personal | Medium | Low | BSL time-bomb conversion to MIT provides community fallback |
| 11 | BSL-1.1 community perception — some developers reject non-OSI licences | Medium | Medium | Clear communication about why BSL was chosen; MIT time-bomb addresses most concerns |
| 12 | Revenue model fails — Pro edition doesn't sell, but community edition support is still obligated | Low | Medium | Commercial commitment is to features, not indefinite staffing. BSL time-bomb protects community. |

---

## 17. Focused Questions for an Intellectual-Property Lawyer

These are questions specific to Strata's situation that a lawyer should review
before finalising any licence implementation:

### Ownership and Copyright

1. The sole human contributor uses the git identity "Strata Founder
   <founder@strata.local>" with a GitHub handle "K-Arthur." Does this provide
   sufficient copyright ownership documentation for commercial licensing, or
   should the real legal name be on record somewhere?

2. Approximately 17% of commits are from an AI coding agent ("Cascade Agent").
   Does copyright law in the relevant jurisdictions (the owner's country, the US
   where GitHub operates) recognise copyright in AI-generated code? If so, who
   owns it? Does the owner need to do anything to document ownership of these
   contributions?

### Licence Choice

3. BSL 1.1 has been reviewed by lawyers at MariaDB, Sentry, CockroachDB, and
   others. Is there any reason it would be inappropriate for a desktop design
   application distributed via Tauri, npm, and crates.io across Linux, macOS,
   and Windows?

4. The BSL's "Additional Use Grant" defines what is permitted for free. For a
   desktop application like Strata, the grant should permit:
   - Any individual using the software to create designs
   - Any organisation using the software internally
   - Non-commercial redistribution of modified source code
   - Plugin and extension development
   
   Can you confirm this AUG text is adequate, or should it be more/less
   restrictive for Strata's model?

5. If the BSL change licence is MIT, are there any concerns about the
   combination of BSL-licensed Strata code linking to MIT/Apache-2.0/ISC
   dependencies? Does the BSL impose any obligations on the dependency stack?

### Distribution

6. Tauri applications bundle a WebKit rendering engine via the OS. Do the
   LGPL/GPL exceptions for system libraries apply, or does Strata need to
   consider the Tauri/Wry/WebKit licence stack separately?

7. The `onnxruntime` native library is linked dynamically via `load-dynamic`.
   Does this invokve any additional distribution obligations compared to static
   linking, particularly for licence compatibility?

8. ONNX model weights are bundled with the application (u2netp, realesr). Can
   the lawyer confirm that distributing these under MIT and BSD-3-Clause terms
   is sufficient, or is there additional risk around ML model weight redistribution?

### Contributions and CLA

9. Is a DCO plus a lightweight Contribution Licence Agreement (non-exclusive,
   worldwide, royalty-free, sublicensable) sufficient for a solo developer to
   maintain the ability to relicense the project and use contributions in
   commercial editions?

10. Should the CLA explicitly cover AI-generated contributions (code written
    with AI assistance), or is the general representation-and-warranty clause
    sufficient?

### Trademark

11. Can you perform (or recommend a firm for) a trademark search for "Strata"
    in the design-software category (Nice Class 9 and 42) to confirm availability?

### Jurisdiction

12. In which jurisdiction should the project's legal terms be governed? The
    developer appears to be in an unspecified jurisdiction (git user timezone
    is not determinable). What are the implications of choosing, say, the laws
    of [your country] vs. Delaware, USA for the CLA and commercial terms?

---

## Implementation Boundaries

This document is a decision-support and planning document. The following actions
require **owner approval** before implementation:

1. Adding the `LICENSE` file (any licence)
2. Changing licence fields in `package.json`, `Cargo.toml`, or `tauri.conf.json`
3. Correcting the website's "open-source" claim
4. Creating contributor agreements or policies
5. Making any binding legal commitment (including the Free-Edition Commitment)

The following actions can proceed immediately in parallel with legal review:

1. Auditing the repository for missing licence metadata
2. Drafting `THIRD_PARTY_NOTICES` (doesn't change legal terms, only complies)
3. Researching trademark availability
4. Preparing the edition architecture separation
5. Writing the FAQ, trademark policy, and documentation

**Final note:** Once a licence direction is approved, the official unmodified
text of the selected standard licence must be used. Do not modify the BSL 1.1
text — the Additional Use Grant is a separate document. Do not write a custom
EULA or source-available licence and present it as legally complete. Custom
terms require lawyer review.
