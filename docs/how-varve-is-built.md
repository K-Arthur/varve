# How Varve is built

Varve is developed independently by one designer-developer. Architecture
decisions, quality gates, licensing, and what ships stay human-owned.

## AI coding assistants

A solo maintainer uses AI coding assistants as a force multiplier:
Claude Code, Codex, Cursor, Devin, opencode, and Windsurf. They draft,
search, refactor, and make mechanical edits. Assisted output is reviewed
before it is committed. Generated text is not a separate legal
contribution. Where a change is wrong, the maintainer is responsible for
the repair.

This is not an AI-generated product and not an unattended codegen
pipeline. There is no claim that every line was typed by hand, and no
claim that assistants replace review. No contributor is required to use
any specific AI tool.

## Commit history

Co-authored-by trailers and generation signatures from AI tools (Claude,
Codex, Cursor, Devin, opencode, Windsurf, and others) have been removed
from commit history with `git-filter-repo`. The commit-msg hook and CI
check prevent them from returning. Commits are authored by the
maintainer. AI tool names are not added to commit messages or author
metadata.

## AI features in the application

Optional local workflows can use on-device models: background removal,
image enhancement, object selection, depth-aware effects, and promptless
fill, remove, and expand. Some small baseline models ship with the app;
larger models are downloaded on demand, verified against a checksum when
one is available, and run locally.

There is no Varve-hosted inference service. Design documents are not
uploaded for training. Prompt-conditioned fill, replace, and expand stay
gated until a local model passes compatibility and real-photo review.

## Marketing samples

Reviewed before/after photographs on the website are labeled when a
region was synthesized. The landscape expand sample uses a public-domain
photograph; the added border was generated locally with LaMa. The
retained source pixels are unchanged. Unreviewed generations are not
used as product proof.
