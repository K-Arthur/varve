# GPU rendering repair — ownership record

**Started:** 2026-09-24
**Base:** `master` at `3b223b5d3c4c34cb11d058e541884ab234dfba55`
**Coordinator:** Codex GPU rendering task

## Scope and boundaries

This task owns the WebGPU compositor correctness and reporting changes, their
targeted tests, the rendering architecture and verification docs, and the
corresponding website explanation. The Linux Tauri/WebKitGTK Canvas2D path
remains the primary desktop validation target. Browser WebGPU evidence is
reported separately from native WebView evidence.

Expected edited paths are `packages/compositor/src/webgpu/`,
`packages/compositor/src/structuralRenderPlan.*`,
`packages/compositor/src/types.ts`, `packages/editor/src/StatusBar.tsx`,
`tests/e2e/webgpu/`, `docs/architecture/render-pipeline.md`,
`docs/architecture/webgpu-manual-verification.md`, this ownership record,
`docs/audits/gpu-rendering-2026-09-24.md`, and rendering copy under
`apps/website/src/pages/`. Any additional file is recorded before editing.

Three read-only collaborators were assigned current source/user research,
pipeline reachability, and validation discovery. The coordinator is the only
writer and serializes Git index operations and commits.

## Existing work to preserve

At start, `master` is one commit ahead of `origin/master`. An unstaged edit to
`docs/audits/validation-repair-progress-2026-09-24.md`, staged edits to
`tests/e2e/menus/overlay-reliability.spec.ts` and the GPU visual replay PNG,
and untracked installation, diagnostic E2E, reference, and visual-validation
files already existed. The detached `/var/tmp/varve-quality-gate-final`
worktree also existed. None belongs to this task; no branch switch, stash,
reset, clean, broad `git add`, or full-index commit is authorized. Commits use
explicit owned paths. Recheck status and diffs immediately before each edit
and commit.

Use an isolated E2E port and artifact directory, and the repository's heavy
lease for Playwright/GPU work. Do not modify visual baselines without inspecting
matched artifacts.
