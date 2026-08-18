# Contributing to Varve

Thank you for your interest in contributing to Varve.

## Current status: external code contributions are paused

Varve is currently stabilizing its build, release, and documentation
foundations, so external code pull requests are paused. The issue and pull
request templates describe the workflow we intend to use when code opens
again; they are not an invitation to implement an uncoordinated change today.

The best current contributions are reproducible bug reports, workflow and
architecture discussions, cross-platform testing, documentation, examples,
and design feedback. See the [current contributor guide](docs/development/contributing.md)
for the project map, channel guide, validation expectations, and future PR
workflow. Use [GitHub Issues](https://github.com/K-Arthur/varve/issues) for
reproducible bugs and [GitHub Discussions](https://github.com/K-Arthur/varve/discussions)
for questions, proposals, and workflows.

## Code of Conduct

This project follows a standard Code of Conduct. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Licensing and DCO

Varve uses a **mixed-license model**. The application (editor, scene model,
UI, AI features) is licensed under the **Functional Source License, Version
1.1, MIT Future License (FSL-1.1-MIT)**, with a change licence of **MIT**
after two years. Several engine crates (`varve-core`, `varve-colour`,
`varve-trace`, etc.) are licensed under **MIT OR Apache-2.0**. See
[LICENSE](LICENSE) for the app terms and
[mixed-license model](docs/licensing/mixed-license-model.md) for the full
picture.

Once contributions open, all contributions will need to include a
**Developer Certificate of Origin** (DCO) sign-off. This certifies that you
have the right to submit the work and that you understand it will be
distributed under the project's licence.

To sign off a commit, add the following line to your commit message:

```
Signed-off-by: Your Name <your.email@example.com>
```

Use `git commit -s` to add this automatically. By signing off, you certify
the following (from [developercertificate.org](https://developercertificate.org/)):

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.

Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I have
    the right to submit it under the open source license indicated in
    the file; or

(b) The contribution is based upon previous work that, to the best of
    my knowledge, is covered under an appropriate open source license
    and I have the right under that license to submit that work with
    modifications, whether created in whole or in part by me, under the
    same open source license (unless I am permitted to submit under a
    different license), as indicated in the file; or

(c) The contribution was provided directly to me by some other person
    who certified (a), (b) or (c) and I have not modified it.

(d) I understand and agree that this project and the contribution are
    public and that a record of the contribution (including all personal
    information I submit with it, including my sign-off) is maintained
    indefinitely and may be redistributed consistent with this project
    or the open source license(s) involved.
```

### First-time contributors

Once contributions open, first-time contributors will also be asked to sign
a lightweight Contributor Licence Agreement (CLA) granting the project owner
the right to distribute your contribution under the project's licence
(including any future commercial licence for the Pro edition). This will be
a one-time process. See [CLA.md](CLA.md), [ICLA.md](ICLA.md), and
[CCLA.md](CCLA.md) — note that the CLA/ICLA/CCLA documents are still drafts
awaiting legal review and are not yet in effect.

## Ways to help today

- Report a reproducible bug with the release, platform, exact steps, expected
  result, actual result, and any relevant screenshots or logs.
- Share a workflow, feature, or architecture proposal in Discussions before
  turning it into an implementation plan.
- Test Varve on Linux, macOS, or Windows and report the exact environment and
  action that succeeded or failed.
- Improve documentation, tutorials, examples, translations, or accessibility
  guidance through an Issue or Discussion.
- Help other users in Discussions. Report security vulnerabilities privately
  using [SECURITY.md](SECURITY.md), never in a public issue.

## When code contributions reopen

When external code contributions reopen, start with a Discussion for any
non-trivial change so scope and ownership are clear. Then:

1. Fork the repository and create a focused branch from `master`.
2. Make the smallest coherent change, preserving unrelated worktree changes
   and following the project's architecture and design-token rules.
3. Add or update the narrowest useful tests. Changes involving the canvas,
   pointer events, dragging, or rendering require a real Playwright E2E test;
   unit tests alone are not sufficient.
4. Run the impact-aware plan and affected checks:
   ```bash
   pnpm verify:plan
   pnpm verify:affected   # impact-aware validation (default)
   ```
5. Submit a focused pull request describing the problem, design choice,
   compatibility or migration impact, exact validation commands, and any
   screenshots or recordings that make the result easier to review.

The full repository gate (`pnpm verify:full`) is reserved for workspace or
toolchain changes, test-runner configuration, serialization migrations,
foundational API changes, release checkpoints, or an explicit escalation. It
requires `VARVE_FULL_GATE_REASON`. See the
[validation strategy](docs/quality/validation-strategy.md).

## Development setup

See [docs/development/setup.md](docs/development/setup.md) for full setup
instructions, running, testing, and quality gates.
The [current contributor guide](docs/development/contributing.md) explains
where the major packages live and how the validation policy applies to each
kind of change.

## Project governance

For licensing questions, see the [licensing docs](docs/licensing/). Varve is
source-available under FSL-1.1-MIT and is not currently OSI-approved; review
[LICENSE](LICENSE) before reusing code. The DCO and CLA documents are drafts
and are not active while external code contributions are paused.

Varve uses AI-assisted development tooling. Contributors remain responsible
for the provenance, license compatibility, security, tests, and quality of
anything they submit. Do not include secrets, private data, or unlicensed
material in issues, discussions, commits, or pull requests.

## Questions?

Ask in [GitHub Discussions](https://github.com/K-Arthur/varve/discussions).
Use [GitHub Issues](https://github.com/K-Arthur/varve/issues) for
reproducible bugs.
