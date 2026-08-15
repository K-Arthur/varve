# Contributing to Varve

Varve is a public-beta, local-first design suite built in the open. The
project is maintained by a small team, so clear reports, thoughtful product
feedback, and practical examples are especially valuable.

## Current contribution status

External code pull requests are temporarily paused while the project
stabilizes its build, release, and documentation foundations. The repository's
issue and pull-request templates describe the intended workflow, but they are
not an invitation to start an uncoordinated implementation yet.

You can still help today. Use the channel that matches the kind of help:

| Contribution | Best place | What makes it useful |
|---|---|---|
| Reproducible bug or regression | [GitHub Issues](https://github.com/K-Arthur/varve/issues) | Steps, expected/actual result, platform, release or commit, and screenshots/logs |
| Feature idea or workflow proposal | [GitHub Discussions](https://github.com/K-Arthur/varve/discussions) | The user problem, a concrete workflow, and why existing tools do not solve it |
| Architecture or API question | [GitHub Discussions](https://github.com/K-Arthur/varve/discussions) | Constraints, trade-offs, and links to the relevant architecture document |
| Documentation correction | An Issue or Discussion | The page, the confusing passage, and a suggested replacement |
| Cross-platform testing | Issues or Discussions | OS/version, package type, hardware, exact action, and whether it reproduces on a clean document |
| Tutorial, example, or workflow | Discussions | A concise explanation, source file or steps, and the Varve version used |

Please search existing Issues and Discussions before opening a new thread. A
short confirmation on an existing report is useful evidence; duplicate
implementations and duplicate reports consume scarce review time.

Security vulnerabilities should go through the private process in
[SECURITY.md](../../SECURITY.md), not a public issue.

## Read these first

- [Code of Conduct](../../CODE_OF_CONDUCT.md)
- [Development setup](setup.md)
- [Architecture index](../README.md)
- [Quality and validation strategy](../quality/validation-strategy.md)
- [Release engineering](../release/README.md)
- [Repository and public-content guidance](../brand/github-repository-presence.md)

## Project map

Varve is a monorepo. Most work belongs in one of these areas:

| Area | Location | Scope |
|---|---|---|
| Desktop application | `apps/desktop/` | Tauri shell, Vite entrypoint, native IPC |
| Website | `apps/website/` | Astro marketing/docs site and release/download surfaces |
| Editor | `packages/editor/` | Canvas, tools, panels, state, shortcuts, and interaction workflows |
| Scene model | `packages/scene/` | Immutable document model, nodes, pages, and operations |
| Engine | `packages/engine/`, `crates/varve-*` | Render IR, native/WASM facades, geometry, import/export, and native systems |
| Shared/UI | `packages/shared/`, `packages/ui/` | Cross-package utilities, design tokens, icons, and accessible components |
| Documentation | `docs/`, root Markdown, website docs pages | Current contracts, runbooks, tutorials, and public product truth |

Read the nearest architecture document before changing a boundary. In
particular, do not introduce a package cycle, bypass the editor command/history
path, or describe a planned capability as shipped.

## Development workflow when code contributions reopen

1. Start a Discussion for a new feature, architecture change, or significant
   UX change. Wait for the scope to be accepted before implementing it.
2. Fork the repository and branch from `master` using a focused name such as
   `fix/text-alignment` or `docs/export-guide`.
3. Make the smallest coherent change. Preserve unrelated worktree changes and
   avoid drive-by formatting.
4. Add or update the closest unit test. Canvas, pointer, drag, and rendering
   changes also need a real Playwright E2E test; unit tests alone do not cover
   browser event/layout regressions.
5. Run the impact-aware validation described below and record the commands in
   the pull request.
6. Open a focused pull request against `master`. Explain the user problem,
   the chosen approach, compatibility or migration impact, and how it was
   tested. Include before/after screenshots for visual changes.

## Validation

Validation is selected by impact, not by habit. From the repository root:

```bash
pnpm verify:plan       # inspect the selected checks first
pnpm verify:affected   # default Tiers 0–4 gate
```

Use the feature-specific checks selected by the plan. Typical examples are:

```bash
pnpm test:website
pnpm --filter @varve/website typecheck
pnpm audit:docs
pnpm audit:emoji
pnpm audit:tokens
npx playwright test tests/e2e/canvas/tools.spec.ts --project=chromium --reporter=list
```

Do not run the full repository suite by default. `pnpm verify:full` is for
workspace/toolchain changes, test-runner or serialization changes,
cross-package foundational API changes, release checkpoints, or an explicit
request. It requires a reason:

```bash
VARVE_FULL_GATE_REASON="explain the escalation" pnpm verify:full
```

If a check fails, include the failure and the exact command in the pull
request rather than silently omitting it.

## Pull request quality bar

When external code contributions reopen, maintainers will prioritize changes
that are:

- focused on one problem and small enough to review;
- consistent with the existing architecture and design tokens;
- covered by the narrowest useful automated test;
- honest about platform support, privacy, release state, and feature maturity;
- accessible in keyboard, focus, contrast, and screen-reader behavior;
- documented when they change a public workflow, command, file format, or
  contributor-facing process.

Use the repository pull-request template. Review may ask for a smaller scope,
an architecture note, a regression test, or a screenshot before merging.

## Commits

Use Conventional Commit prefixes where practical:

```text
feat: add gradient fill support
fix: preserve selection after page switch
docs: clarify print export setup
test: cover rotated canvas hit testing
chore: update release tooling
```

Keep commits and pull requests easy to review. A commit may contain a focused
implementation and its tests; unrelated cleanup belongs in a separate change.

## Licensing and sign-off

Varve is source-available under FSL-1.1-MIT, with the MIT change licence after
the applicable period. It is not currently presented as OSI-approved open
source. Read [LICENSE](../../LICENSE) before contributing.

The DCO and CLA documents in the repository are drafts and are not active
while external code contributions are paused. When the project opens, the
maintainer will publish the active sign-off and contribution terms before
accepting outside code.

## AI-assisted contributions

AI-assisted work is allowed as a tool, not as a substitute for ownership.
Contributors remain responsible for the provenance, licenses, tests, security,
and behavior of submitted work. Explain generated or substantially
AI-assisted changes when that context helps review, and never include secrets,
private documents, or unlicensed source material in prompts or commits.
