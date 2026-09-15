# Git Provenance Report

## Summary

| Identity | Type |
|----------|------|
| Kevin Arthur `<hello@kevinarthur.design>` | Human (canonical) |
| Strata Founder `<founder@strata.local>` | Human (early alias) |
| K-Arthur `<58142087+K-Arthur@users.noreply.github.com>` | Human (GitHub web interface) |
| github-actions[bot] | CI tooling (visual baseline refresh) |
| dependabot[bot] | CI tooling (dependency updates) |

**All commits are authored by one human: Kevin Arthur.** There are no
external contributors.

## Identity mapping

### Strata Founder → Kevin Arthur

The `Strata Founder <founder@strata.local>` identity is the same
person as `Kevin Arthur <hello@kevinarthur.design>`. Evidence:

- Copyright in `NOTICE`: "Copyright 2024-2026 K-Arthur (Strata Founder)"
- `TRADEMARKS.md`: "Strata is a trademark of K-Arthur"
- All CLA/licensing docs refer to the project owner as K-Arthur
- The founder@strata.local email was used before the canonical
  hello@kevinarthur.design was adopted

A `.mailmap` maps these identities for display tools.

### K-Arthur — GitHub web interface

`K-Arthur <58142087+K-Arthur@users.noreply.github.com>` is the
same person, using GitHub's web UI commit identity.

A `.mailmap` maps this identity to the canonical form for display tools.

### Attribution policy

- The project maintainer (Kevin Arthur) is responsible for all code in the
  repository, whether written directly or reviewed from AI-generated output.
- AI-generated commits are not separate legal contributions.
- No AI tooling, assistant, bot, or model identity may appear as commit
  author, co-author, or generation attribution. The commit-msg hook and
  CI check enforce this (see `.githooks/commit-msg` and
  `.github/workflows/ci.yml`).

## Key observations

### No unsigned or unverified commits
Every commit shows clear author and committer metadata. There are no anonymous
or malicious-looking commits.

### Single author chain
All commits trace to one human (Kevin Arthur) either directly or via a
mailmap-normalized alias.

### No AI attribution in commit metadata
Co-authored-by trailers and generation signatures from AI tools
(Claude, Devin, Cursor, opencode, etc.) have been removed from commit
history via `git-filter-repo`. The commit-msg hook and CI check prevent
future attribution.

## Diligence notes

### For relicensing
The project is sole-authored by Kevin Arthur (Strata Founder). All AI-generated
code was produced under his direction and reviewed by him before merge. No
external CLA or additional assignment is needed for AI-generated contributions.

### For contribution audit
If external contributors join, their commits will have a DCO sign-off. All
commits in the repository are from the maintainer.

## Recommendations

1. External contributors must use `git commit -s` for DCO compliance.
2. Consider adding GPG signing for the canonical identity once external
   contributors join.
