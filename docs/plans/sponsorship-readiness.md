# Sponsorship Surface Readiness

Status: ready for human activation. This document records the current state
of the sponsorship surface, the copy that is live, the constraints the
project has set on sponsor relationships, and the remaining manual steps.

## Current state (verified 2026-08-18)

| Surface | Status | Location |
|---|---|---|
| `.github/FUNDING.yml` | Configured | `github: K-Arthur` only |
| Sponsorship page | Live, 4 tiers | `apps/website/src/pages/support-project.astro` |
| Sponsor CTA in README | Live | Sponsor badge + link in the links bar (`README.md`) |
| Sponsor link in footer | Live | `apps/website/src/components/SiteFooter.astro` -> `/support-project` |
| Release-note recognition | Documented | Tier description: name/linked listed in release notes (with permission) |
| Use-of-funds transparency | Documented | "What Support Enables" section + Transparency section on support page |
| GitHub Sponsors profile | Manual | https://github.com/sponsors/K-Arthur — must be activated by the account owner |

## Live copy (sponsorship page)

The sponsorship section on `/support-project` states:

> There is no paid edition, and sponsorship does not buy features, early
> builds, or support contracts -- it keeps development funded and pays for
> the work that benefits every user. What you can expect in return is
> recognition and transparency.

This is the binding constraint: sponsorship is recognition and transparency,
not control, access, or roadmap guarantees.

## Tier wording (with guardrails added 2026-08-18)

| Tier | Price | Promise | Guardrail |
|---|---|---|---|
| Bronze | $5-10/mo | Name in release notes (with permission) | Recognition only |
| Silver | $25-50/mo | Larger entry with link to your site/project | Recognition only |
| Gold | $100-500/mo | Featured placement + conversation about what to build next | "Input, not a roadmap guarantee" (explicit in copy) |
| Corporate | $500+/mo | Company logo + conversation about your team's needs | "How Varve could serve them (no roadmap or decision guarantees)" (explicit in copy) |

One-time support is also accepted.

## Use-of-funds breakdown

The Transparency section says:

> Support funds are used for development work, and how they are spent is
> discussed openly in GitHub Discussions. Supporters are acknowledged in
> release notes (with their permission).

The "What Support Enables" section lists four categories: Platform Support,
Feature Development, Stability Work, Infrastructure. These are directional
descriptions, not guaranteed allocations. No tier promises specific spending
percentages.

## Constraints (must not be violated)

1. No sponsor may control the security, privacy, licensing, roadmap, or
   editorial decisions of the project. This is stated in the sponsorship
   page and must remain stated.
2. Sponsorship does not create a support contract. The Gold/Corporate
   "conversation" is a dialogue, not a SLA.
3. No sponsor may skip or weaken a quality gate, a security audit, or a
   licensing obligation.
4. No sponsor may demand removal of negative information, known issues, or
   bug reports from public surfaces (issues, docs, release notes).
5. Sponsor recognition in release notes is opt-in and subject to the
   maintainer's discretion. The maintainer may decline to list a sponsor
   without explanation.

## Manual steps (not automated, do not do in a session)

- [ ] Activate GitHub Sponsors profile at
      https://github.com/sponsors/K-Arthur (requires account owner login).
- [ ] Create the sponsor tiers in GitHub Sponsors matching the pricing and
      benefits listed above.
- [ ] Verify the funding button renders correctly on the repository page
      (after merging the README badge).
- [ ] Post a pilot discussion in GitHub Discussions explaining the
      sponsorship model (reuse the Transparency section copy as a starting
      point).
- [ ] After the first sponsor joins: add their name (with permission) to
      the next release notes draft.
- [ ] Consider posting a "Use of funds" update quarterly in GitHub
      Discussions (transparency policy); this is voluntary and not gated on
      any minimum funding level.
- [ ] Review this document after any change to the sponsorship tiers or the
      `.github/FUNDING.yml` configuration.

## Relationship to other documents

- Brand/entity consistency: `docs/plans/social-surface-plan.md`
- GitHub presence: `docs/brand/github-repository-presence.md`
- Content architecture: `docs/plans/discovery-content-plan.md`
- Directory packet: `docs/release/directory-listing-packet.md`
- License wording: `docs/licensing/` (source-available, not open source)
