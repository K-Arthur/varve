# How Varve is built

Public disclosure of how Varve is developed and where AI is used. The
website page is [`/about/how-its-built`](https://varve.studio/about/how-its-built).

## Who writes the product

Varve is developed independently by one designer-developer. Architecture
decisions, quality gates, licensing, and what ships stay human-owned.
Commits are authored by the maintainer. AI tool names are not added to
commit messages or author metadata.

## AI coding assistants

The repository is large enough that a solo maintainer uses AI coding
assistants as a force multiplier: drafting, searching, refactoring, and
mechanical edits. Agent instructions live in `AGENTS.md` and
[`docs/agents/README.md`](agents/README.md). No contributor is required to
use any specific AI tool.

Assisted output is reviewed before it is committed. Generated text is not
treated as a separate legal contribution. Where a change is wrong, the
maintainer is responsible for the repair.

This is not an AI-generated product and not an unattended codegen
pipeline. There is no claim that every line was typed by hand, and no
claim that assistants replace review.

## AI features in the application

Optional local workflows can use on-device models: background removal,
image enhancement, object selection, depth-aware effects, and
promptless fill, remove, and expand. Some small baseline models ship
with the app; larger models are downloaded on demand, verified against a
checksum when one is available, and run locally.

There is no Varve-hosted inference service. Design documents are not
uploaded for training. Prompt-conditioned fill, replace, and expand stay
gated until a local model passes compatibility and real-photo review.
See the [generative editing contract](architecture/generative-editing-system.md).

## Marketing samples

Reviewed before/after photographs on the website are labeled when a
region was synthesized. The landscape expand sample uses a public-domain
photograph; the added border was generated locally with LaMa. The
retained source pixels are unchanged. Unreviewed generations are not
used as product proof.

## Third-party credits

Tabler Icons (MIT) and Fraunces (SIL OFL 1.1) are used in the product
and marketing site. Full attribution is in `NOTICE` and
`THIRD_PARTY_NOTICES`.
