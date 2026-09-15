# CLA Implementation — Decision Record

**Date:** 2026-07-21  
**Status:** Agreement documents (CLA.md/ICLA.md/CCLA.md) drafted, awaiting
legal review. The GitHub Actions workflow, PR template, and issue templates
described in §4 below were planned but were **not actually created** — see
the 2026-07-25 correction note. Varve is not currently accepting external
contributions.  
**Author:** Project automation agent

---

## 1. Repository Model Decision

### Current state

| Dimension | Value |
|-----------|-------|
| License | FSL-1.1-MIT (source-available, converts to MIT after 2 years) |
| Repository | Single public repo at `github.com/K-Arthur/varve` (renamed from the pre-release "Strata" repo identity) |
| Ownership | Personal GitHub account (K-Arthur) |
| Editions | Free edition now; future Pro edition planned |

### Options considered

| Model | Description | Pros | Cons |
|-------|------------|------|------|
| **A. Single repo, FSL-1.1-MIT + CLA** (chosen) | All code in one repo under FSL. CLA grants relicensing rights for Pro edition. | Simple; no repo split; FSL already separates free use from commercial redistribution; contributor code flows to all editions via CLA. | Requires CLA enforcement; FSL is not OSI-approved open source. |
| **B. Open core + proprietary extensions** | Core in public repo (MIT/FSL); Pro features in private repo. | Clear boundary between free and paid features. | Coordinating cross-repo development is complex; core contributors cannot see Pro extension APIs. |
| **C. Dual license (FSL + commercial)** | Same codebase; users choose license. | Well-understood model (MySQL, etc.). | Adds friction for free users; FSL already achieves the same effect via its Permitted Purpose/Competing Use terms. |
| **D. Fully proprietary + selected contributions** | Private repo; accept only hand-picked external contributions. | Full control. | No community; defeats the purpose of a public repository. |

### Recommendation: Single repo, FSL-1.1-MIT + CLA

**Rationale:**
- FSL-1.1-MIT already restricts commercial redistribution and hosted services,
  while permitting internal use, personal projects, and plugin development.
  This separates free and paid use at the license level without needing a
  separate repository.
- A CLA adds the relicensing right needed for the future Pro edition. Without
  it, community contributions could not be included in a proprietary release.
- A single repository is simpler to maintain, easier for contributors to
  navigate, and avoids the overhead of coordinating cross-repo changes.
- If the project later moves to an organisation account, the CLA system
  transfers with the repository.

**Not recommended: Copyright assignment.** Copyright assignment (where the
contributor transfers ownership) is unnecessary. A broad contribution license
(CLA) provides all the rights the project owner needs while letting
contributors keep their copyright — a more contributor-friendly approach.

**Third-party code boundaries:** Third-party code and clearly separate
original code must remain identifiable. The CLA requires contributors to
disclose third-party material in their commits.

---

## 2. CLA Solution Decision

### Options evaluated

| Solution | Type | Maintained | License | Cost | Key Limitation |
|----------|------|------------|---------|------|----------------|
| **CLA Assistant (hosted)** | GitHub App / SaaS | Yes (SAP) | Apache 2.0 | Free | Data stored in Azure Cosmos DB (Europe); requires external service |
| **CLA Assistant (GitHub Action)** | GitHub Action | **Archived** (Mar 2026) | Apache 2.0 | Free | No longer actively maintained; v2.6.1 still functional |
| **EasyCLA (Linux Foundation)** | GitHub App / SaaS | Yes | Proprietary | Paid | Enterprise-focused; requires LF membership |
| **Custom bot** | Custom | N/A | Project license | High dev cost | Full control but significant maintenance burden |
| **DCO only** | `git commit -s` | N/A | N/A | Free | Does NOT grant relicensing rights; insufficient for dual-licensing |

### Recommendation: CLA Assistant (GitHub Action) with in-repo signature storage

**Why the GitHub Action (not the hosted service):**
- Signatures are stored in the repository itself (`_clasignatures` branch) —
  version-controlled, auditable, and independent of any external service.
- No third-party database, no API keys, no vendor lock-in.
- The workflow runs entirely within GitHub's infrastructure.
- If the action stops working, the signature data is still accessible and can
  be migrated to another system.

**Mitigation for archival status:**
- The action (v2.6.1) is feature-complete and stable. It has been in
  production use by thousands of repositories for years.
- The signature storage format is a simple JSON file on a branch — trivially
  portable to any future system.
- Documented fallback: migrate to the CLA Assistant hosted service
  (cla-assistant.io) if the action becomes incompatible.

**Why not a custom bot:**
- The requirements (signing flow, status checks, signature storage, re-signing
  on agreement changes) are all met by the existing action.
- A custom bot would require ongoing maintenance for GitHub API changes,
  rate limiting, webhook security, and data storage — disproportionate effort
  for a solo-maintained project.

---

## 3. Agreement Structure

### ICLA + CCLA (chosen)

- **Individual CLA (ICLA):** For contributions made on personal time. The
  contributor signs as an individual.
- **Corporate CLA (CCLA):** For contributions made as part of employment or
  using employer resources. The employer signs, and employees confirm
  authorisation individually.

Both agreements grant:
- Perpetual, worldwide, royalty-free copyright license
- Patent license (with termination clause)
- Right to sublicense and relicense under any licensing model

Both agreements clearly state:
- The contributor/employer retains copyright (this is a license, not an
  assignment)
- No obligation to accept or use contributions
- "AS IS" disclaimer and limitation of liability

**Why not a combined single agreement:**
- Some contributors contribute independently, others on behalf of employers.
- A single agreement either imposes corporate terms on individuals or lacks
  the employer-authorisation provisions needed for corporate contributions.
- The ICLA/CCLA split is the industry standard (Apache, Kubernetes, etc.).

---

## 4. Implementation Summary

**Correction (2026-07-25):** The three rows marked "Implemented" below for
the GitHub Actions workflow, PR template, and issue templates were never
actually created — `.github/` contains no `workflows/cla.yml`,
`pull_request_template.md`, or `ISSUE_TEMPLATE/` directory. This table
originally overstated implementation status. Corrected below.

| Component | Status | File |
|-----------|--------|------|
| CLA overview (plain language + FAQ) | Implemented | `CLA.md` |
| Individual CLA (draft for legal review) | Implemented | `ICLA.md` |
| Corporate CLA (draft for legal review) | Implemented | `CCLA.md` |
| CLA workflow (GitHub Actions) | **Not created** | `.github/workflows/cla.yml` (does not exist) |
| Pull request template | **Not created** | `.github/pull_request_template.md` (does not exist) |
| Issue templates | **Not created** | `.github/ISSUE_TEMPLATE/*.md` (does not exist) |
| Maintainer guide | Implemented (describes intended future operation) | `docs/CLA-MAINTAINER.md` |
| CONTRIBUTING.md update | Implemented (now states contributions are not yet open) | `CONTRIBUTING.md` |
| DCO requirement | Already documented | Kept in `CONTRIBUTING.md` |

---

## 5. What Remains for Legal Counsel

The following items in the CLA drafts require qualified legal review:

1. **Governing law clause** — `ICLA.md` Section 11 and `CCLA.md` Section 13
   contain `[Jurisdiction — TO BE DETERMINED BY LEGAL REVIEW]` placeholders.
2. **Patent clause scope** — Sections 3 in both agreements. Counsel should
   verify that the patent grant is appropriately scoped for this project's
   risk profile.
3. **Disclaimer wording** — Sections 5 and 7. Standard forms that should be
   validated against local law.
4. **Corporate signatory authority** — `CCLA.md` Section 4.1. Counsel should
   confirm the representation is sufficient.
5. **Data privacy compliance** — Record-keeping provisions in Section 10
   should be reviewed against GDPR, CCPA, and other applicable regulations.
6. **Agreement versioning mechanism** — The mechanism for updating agreements
   and requiring re-acceptance should be reviewed.

---

## 6. Pre-existing Issues Found During Audit

| Issue | Severity | Details |
|-------|----------|---------|
| `apps/desktop/src-tauri/Cargo.toml` missing license field | Resolved 2026-07-25 | Was the only package without a `license` field; now declares `FSL-1.1-MIT`. |
| No per-file license headers | Low | No Rust or TypeScript source files carry license headers. |
| No REUSE compliance | Low | No `.reuse/dep5` or `REUSE.toml` configuration. |
| No branch protection codified | Medium | Branch protection rules exist only in GitHub UI settings, not in repository configuration. |

These are separate from the CLA implementation and were discovered during
the initial repository audit. They do not block the CLA workflow.
