# Guide layouts implementation ownership

**Scope:** frame-owned layout guides, publishing page/master layout geometry,
guide persistence/lifecycle, transformed snapping, editor workflow, visual
coverage, and website truthfulness.

**Execution branch:** `master` (no branch or reset permitted).

**Baseline:** `3b6c26a8ff133503ee6ec84c2b51288fc8149185` with a pre-existing
shared-worktree diff. Existing edits in Inspector, clipboard, website, and
unrelated packages remain outside this change unless a later commit stages an
explicitly reviewed hunk.

**Commit ownership:** only guide-layout paths and intentional hunks are staged;
each commit is checked with `git diff --cached` before creation.

**Current checkpoint:** scene-level v2.30-compatible geometry and migration
adapter are under implementation. No authored content is moved by this work.
