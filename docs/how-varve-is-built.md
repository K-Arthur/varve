# How Varve is built

Varve is developed independently. This page explains how it is made, so you can decide whether to trust it with your work.

## The short version

Varve is built with substantial help from AI coding assistants. Product direction, design, review, and testing stay with the project. AI tools draft a large share of the code and docs. Every change that ships is reviewed and owned by the project.

## Where AI helps

- **Code:** a large share of the code in the TypeScript editor, the Rust engine and the desktop shell was first drafted by AI, then reviewed, reworked and tested.
- **Tests, tooling and docs:** much of the test suite, the build and release scripts and the documentation were made the same way.
- **Tools:** Claude Code, Codex, Cursor, Devin, opencode and Windsurf. The repository's [AI-assisted development notes](https://github.com/varvedesign/varve/blob/master/docs/agents/README.md) describe how they're set up.

Commits don't carry AI co-author tags. Some AI tools add a "Co-authored-by" line or a "Generated with" signature to the commits they help with. Earlier Varve commits had those lines. They were removed from the Git history with git-filter-repo, and a commit hook and a CI check now block them. The project is the author of record and is accountable for every line. This page is the disclosure instead, and the removal is recorded in the repository's [provenance report](https://github.com/varvedesign/varve/blob/master/docs/development/provenance.md).

## What the project does directly

Product decisions, scope, interface design, what ships and when, and hands-on testing on Linux (CachyOS).

## How quality is checked

Nothing is trusted just because a tool wrote it. Every push to the main branch runs CI on the parts it affects: Rust and TypeScript tests, browser tests against the real canvas, visual comparisons and a WebAssembly build. The full suite runs weekly. At the 0.5.0 checkpoint that meant 1,903 browser test cases and 1,909 unit test files.

Releases are built in CI from the exact tagged commit and must pass candidate certification. The installed app is then checked on Linux, Windows and macOS (upgrade, save and reopen, export) before publishing. Every release ships SHA-256 checksums, SBOMs and build provenance. Installers aren't code-signed yet.

## Icons, fonts, logo and images

- Interface icons come from open-source sets (Lucide, Phosphor, Tabler). The fonts are Geist, IBM Plex Sans and Fraunces. Credits and licences are in [THIRD_PARTY_NOTICES](https://github.com/varvedesign/varve/blob/master/THIRD_PARTY_NOTICES).
- The wordmark is outlined from the Fraunces typeface, and a script renders the app icons from one master SVG.
- Screenshots and recordings are captured from the running app and never hand-edited.
- One sample image on this site, the expanded landscape photo on the Generative Editing page, was made with Varve's own on-device AI edit tool. It's labelled that way where it appears.

## Licence and contributions

Varve is source-available under FSL-1.1-MIT, and each release becomes MIT two years after it ships. AI help doesn't change that: the project reviews everything that goes in. External code contributions are paused. When they reopen, contributors will sign off their work (DCO) and be responsible for its provenance, licence, tests and quality, AI-assisted or not.

## The AI inside Varve is separate

Varve's own AI features run on your device and are on by default. A single switch in Settings turns them all off. They include background removal, object selection, image enhancement (denoise, deblur and upscale), and Fill, Remove and Expand in Generative Edit. Larger models download only when you ask. There's no Varve-hosted AI service, and none of these features sends your images to an online service. A desktop prompt-conditioned path exists in code for Fill, Replace, and Expand, but it stays behind a model-required gate until a local model is installed and qualified. Fill, Remove, and promptless Expand reconstruct from the image itself, not from a text prompt.

## Questions

Ask in [GitHub Discussions](https://github.com/varvedesign/varve/discussions) or email hello@varve.studio. If anything here is wrong, report it and it will be fixed.
