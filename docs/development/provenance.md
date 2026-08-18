# Git Provenance Report

## Summary

| Identity | Commits | Type |
|----------|---------|------|
| Kevin Arthur `<hello@kevinarthur.design>` | 1638 | Human (canonical) |
| Strata Founder `<founder@strata.local>` | 583 | Human (early alias) |
| K-Arthur `<58142087+K-Arthur@users.noreply.github.com>` | 10 | Human (GitHub web interface) |
| Cascade Agent `<agent@strata.dev>` | 189 | AI automation |
| github-actions[bot] | 1 | CI tooling (visual baseline refresh) |
| dependabot[bot] | 1 | CI tooling (Actions version bump) |

**Total commits:** ~2422 across all branches. All human commits are one
person: Kevin Arthur.

## Identity mapping

### Strata Founder → Kevin Arthur

The `Strata Founder <founder@strata.local>` identity (583 commits) is the same
person as `Kevin Arthur <hello@kevinarthur.design>`. Evidence:

- Copyright in `NOTICE`: "Copyright 2024-2026 K-Arthur (Strata Founder)"
- `TRADEMARKS.md`: "Strata is a trademark of K-Arthur"
- All CLA/licensing docs refer to the project owner as K-Arthur
- The founder@strata.local email was used before the canonical
  hello@kevinarthur.design was adopted

A `.mailmap` maps these two identities for display tools.

### K-Arthur — GitHub web interface

`K-Arthur <58142087+K-Arthur@users.noreply.github.com>` (10 commits) is the
same person, using GitHub's web UI commit identity. This is the same human
as Kevin Arthur. The noreply address is a GitHub-provided forwarding
address.

A `.mailmap` maps this identity to the canonical form for display tools.

### Cascade Agent — AI automation

`Cascade Agent <agent@strata.dev>` (202 commits) is an automated AI coding
assistant. These commits fall into two categories:

1. **Agent-authored** (189 commits): Tool-generated code, typically for
   mechanical tasks like fixing lint errors, updating test thresholds, or
   implementing well-scoped features under human direction.
2. **Agent-committed** (13 commits): The human `Kevin Arthur` authored the
   content but the commit was performed by the agent tooling. These are
   visible as `Author: Kevin Arthur, Committer: Cascade Agent` in git metadata.

### Attribution policy

- The project maintainer (Kevin Arthur) is responsible for all code in the
  repository, whether written directly or reviewed from AI-generated output.
- AI-generated commits are not separate legal contributions.
- All contributions from external humans require a DCO sign-off (see
  [CONTRIBUTING.md](../../CONTRIBUTING.md)).

## Key observations

### No unsigned or unverified commits
Every commit shows clear author and committer metadata. There are no anonymous
or malicious-looking commits.

### Single author chain
All commits trace to one human (Kevin Arthur) either directly or via an alias
or through AI tooling acting on his behalf.

### AI commits are documented
The Cascade Agent identity is consistent and identifiable. It never masks as a
human contributor.

## Diligence notes

### For relicensing
The project is sole-authored by Kevin Arthur (Strata Founder). All AI-generated
code was produced under his direction and reviewed by him before merge. No
external CLA or additional assignment is needed for AI-generated contributions.

### For investment review
The commit graph shows a solo developer working with AI acceleration over a
~2-year period. The volume (873 commits) is achievable by a solo developer
with tooling support.

### For contribution audit
If external contributors join, their commits will have a DCO sign-off. The
existing Cascade Agent commits are not external contributions — they are
the maintainer's tooling.

## Recommendations

1. The `.mailmap` maps `Strata Founder`, `K-Arthur`, and `Cascade Agent`
   to the canonical `Kevin Arthur <hello@kevinarthur.design>` identity.
2. Future automated commits should use `Co-authored-by: Kevin Arthur <hello@kevinarthur.design>`
   trailer when the agent commits on behalf of the human.
3. External contributors must use `git commit -s` for DCO compliance.
4. Consider adding GPG signing for the canonical identity once external
   contributors join.
