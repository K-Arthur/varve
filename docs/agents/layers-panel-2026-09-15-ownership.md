# Layers Panel Review & Repair — Ownership (2026-09-15)

## Scope

App-wide Layers Panel review: all sections and components under
`packages/editor/src/components/LayersPanel/`, plus layer-related E2E under
`tests/e2e/layers/`, docs, and the marketing website surfaces that describe
layer workflows.

## Owner

Single agent session (master), 2026-09-15.

## Files owned (edit authority)

- `packages/editor/src/components/LayersPanel/**`
- `tests/e2e/layers/**` (new specs only unless repairing an existing spec this session broke)
- `docs/audits/layers-panel-*`, `docs/plans/layers-panel-*` (this session's evidence docs)
- `apps/website/src/pages/**` layer-related copy only

## Files explicitly NOT touched (other agents' uncommitted work)

The working tree contains extensive uncommitted changes owned by other
sessions (font pipeline, generative edit, selection routing, SAM2,
background removal, effects). This session does not commit, revert, or
reformat any of those files. Commits from this session stage only
LayersPanel-owned paths.

## Shared contracts consumed (do not modify)

- `context.tsx` editor facade — **read-only** for this session. Any needed
  context behavior is either already exposed or implemented via new local
  helpers in LayersPanel-owned files.
- `@varve/ui` Menu/ContextMenu — consumed; changes only if a LayersPanel
  defect is root-caused in the shared primitive, in which case it is
  reported rather than silently re-scoped.
- `.health-baseline.json` is already modified by another session and is not
  staged by this session's commits.

## Deliverables

1. Evidence-based audit of every Layers Panel section (header, filter bar,
   tree/rows, bulk bar, context menu, selection sets, batch rename entry,
   isolation). Includes real-world data runs (100–1000+ layers, deep nesting,
   images/text/adjustments/components).
2. Repairs for real defects found, each with regression tests.
3. Visual validation via Playwright against a realistic document, with
   before/after screenshots.
4. Docs updated (audit + architecture + user-facing help where applicable).
5. Marketing website copy checked/updated against actual behavior.

## Status: complete (2026-09-15 session)

Audit and evidence: `docs/audits/layers-panel-review-2026-09-15.md`.
Harness: `tests/e2e/layers/layers-panel-real-world.spec.ts` (13 tests) with
`layers-mobile-app.svg`, `layers-stress-board.svg`, and a real photograph.

Commits (master): `d5ab74313` context-menu state-awareness + arrange parity;
`034e57cd2` filter-chip labels and toggle semantics; `a65eadbdc` token/target/
focus repairs + selection-set semantics; `9b7dab01c` layer-state semantics;
`4860015be` SVG authored layer names; `0f1be321c` docs + website copy;
`110f97653` bulk-bar containment, menu viewport cap, real-world harness and
two spec repairs; plus test/docs follow-ups.

**Scope is free.** Remaining follow-ups (not blocking, recorded in the
audit): remove the stale `.layers-row__media-badge` rule from `editor.css`
when that file has a single owner; refresh the two stale
`effect-stack-transfer` screenshot baselines at the integration checkpoint;
run the DnD trio / `layer-workflows` specs in the combined gate.

## Git-race note (for whoever owns commit 45f6cff1d)

A `git commit -- <layers paths>` raced a concurrent commit from another
session and produced commit `45f6cff1d`, whose message describes Layers work
but whose only content is
`docs/audits/generative-inpainting-model-landscape-2026-09-15.md` (that
session's file, preserved intact). The Layers changes landed correctly in
`fc88740c2`. Nothing was lost; the mismatched message was left in place
rather than rewriting history another session may reference.
