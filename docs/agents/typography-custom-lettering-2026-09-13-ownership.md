# Typography, ligatures, and artistic text ownership

**Task:** `typography-custom-lettering-2026-09-13`
**Coordinator / integration owner:** Codex
**Started:** 2026-09-13
**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve` (the user
requested master; no branch or worktree is being created)

## Scope

This task owns the shared shaping/outline fidelity contract, feature-value and
source-range handling, live renderer integration that can be completed without
breaking the existing engine boundary, artistic-text/path-text correctness,
focused regression tests, and the related current-state documentation and
website claims.

The work preserves logical Unicode text as the source of truth. Shaped glyphs,
outline geometry, path placement, and deformation are derived data. It will not
edit installed fonts or claim that a project-local vector replacement is a new
OpenType font feature.

## Shared-file coordination

| Surface | Owner / status | Coordination rule |
|---|---|---|
| `packages/editor/src/CanvasArea.tsx`, `Shell.tsx`, `context.tsx` | Shared hubs / active owners | No new imports or responsibilities; integrate through existing engine/editor adapters. |
| `packages/editor/src/components/Inspector/sections/TypographySection.tsx`, `FloatingTextBar.tsx`, font registry files | Existing font/frontend work is dirty | Re-read immediately before any edit; prefer an additive leaf component and a small integration patch after the active changes settle. |
| `packages/scene/src/types.ts`, document codec, conversion commands | Shared schema / active changes | Preserve existing staged work; use backward-compatible fields and explicit migration tests; coordinate before altering shared types. |
| `packages/engine/src/shaping*`, `textOutlines.ts`, `pathText.ts`, replay adapters | This task’s primary implementation surface | Extend existing contracts; no competing layout engine. |
| `apps/website/` and typography architecture/audit docs | This task, with dirty unrelated website/docs files present | Re-read each file and patch only typography claims; do not overwrite other agents’ sections. |

The worktree already contains unrelated staged, unstaged, and untracked
changes plus active validation processes. Commits will use explicit owned paths
only; no broad staging, reset, stash, or lock-file manipulation.

## Integration decisions

- Feature settings use UTF-16 source ranges at the scene/editor boundary,
  preserving absent/inherit, explicit off, Boolean on, and indexed values.
- Backend shaping returns actual glyph IDs, cluster source spans, direction,
  metrics, font identity, and warnings. Glyph indices are never persisted as a
  standalone identity after a font changes.
- Browser Canvas2D remains an honest fallback for painting text when the
  renderer cannot address glyph IDs; it must paint shaped source runs rather
  than re-measure and paint isolated characters.
- Outline conversion must refuse missing/unshapable font data and must never
  report placeholder rectangles as successful vectorization.
- Text-on-path is baseline placement, not outline bending; that distinction is
  exposed in capability and documentation text.

## Validation status

The initial affected plan (`pnpm verify:plan`) sees the pre-existing shared
worktree changes and reports a full-suite escalation. Baseline runtime and
export evidence will be recorded in the typography audit before implementation;
feature slices will add semantic, geometry, visual, persistence, and export
checks as their interfaces become reachable.
