# Marketing website product alignment audit

Status: current-state checkpoint, 2026-08-13

The marketing site must describe the product users can actually download and
use. This audit is the website-facing companion to the product-design
capability map and the product truth matrix.

## Current website coverage

| Product story | Website surface | Decision |
|---|---|---|
| Local-first, no account, offline editing | Homepage, product page, local-first feature page | Keep prominent; distinguish optional consented aggregate analytics from design content |
| Native filesystem and packaged-build storage | Local-first feature page and filesystem docs | Keep as an implementation-backed beta capability; retain backup guidance |
| Workspace modes and customization | Workspace docs page and keyboard/interface docs | Keep discoverable from the documentation hub; describe modes as one shared document workflow |
| Native color/precision and print workflow | Color/effects feature page, release notes, known issues | State the native document/working-value path separately from browser display precision |
| Download availability and signing | Download page and generated release manifest | Never hand-type versions, artifact names, sizes, checksums, or signing status |
| AI/model features | Settings/help and existing product docs | Do not make these the lead product story; label model-backed features as optional and local when marketed |

## Corrections made in this checkpoint

- The documentation hub now links the dedicated `/docs/workspaces` page.
- The existing `/docs/tools/*` links were verified against the generated
  static routes and remain the correct documentation destinations.

## Ongoing content rules

1. Prefer evidence-backed claims from code, mounted UI, and passing tests.
2. Say “beta”, “partial”, or “coming soon” when a capability is not complete.
3. Keep local-first claims specific: document content is local by default;
   optional aggregate analytics require consent and contain no document data.
4. Keep release facts generated from `release-manifest.json` and do not invent
   download availability.
5. Treat privacy, filesystem, accessibility, and known-issues pages as part of
   the product—not secondary marketing copy—and update them with feature work.
