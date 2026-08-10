# Contributing to Varve

Thank you for your interest in contributing to Varve.

## Current status: not yet open to external contributions

Varve is not currently accepting external code contributions. The project
is still stabilizing its own foundations (build, CI, and documentation), and
the CLA/DCO infrastructure described below is not yet active. Everything in
this document describes the process we intend to use once the project opens
to outside contributors — treat it as a preview, not a live workflow.

In the meantime, feedback, bug reports, and ideas are welcome via
[GitHub Issues](https://github.com/K-Arthur/varve/issues). (GitHub
Discussions is not enabled on this repository.)

## Code of Conduct

This project follows a standard Code of Conduct. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Licensing and DCO

Varve is licensed under the **Functional Source License, Version 1.1, MIT
Future License (FSL-1.1-MIT)**, with a change licence of **MIT** after two
years. See [LICENSE](LICENSE) for full terms.

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

## How to contribute

1. Fork the repository.
2. Create a feature branch.
3. Make your changes, following the project's code standards.
4. Add or update tests for your changes.
5. Ensure all quality gates pass:
   ```bash
   just gate
   ```
   See [docs/development/setup.md](docs/development/setup.md) for tooling setup.
6. Submit a pull request with a clear description of your changes.

## Development setup

See [docs/development/setup.md](docs/development/setup.md) for full setup
instructions, running, testing, and quality gates.

## Project governance

For licensing questions, see the [licensing docs](docs/licensing/).
Varve uses AI-assisted development tooling. AI-generated contributions
are reviewed and committed by the project maintainer.

## Questions?

Ask in [GitHub Issues](https://github.com/K-Arthur/varve/issues).
