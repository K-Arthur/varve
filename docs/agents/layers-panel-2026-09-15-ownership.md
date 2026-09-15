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
