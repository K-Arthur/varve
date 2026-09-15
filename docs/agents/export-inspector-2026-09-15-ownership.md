# Inspector Export Tab Review & Repair — Ownership (2026-09-15)

## Scope

The Inspector's **Export tab** (all sections and components):

- `packages/editor/src/components/Inspector/PropertiesPanel.tsx` — export tab
  host, Format/Code sub-tabs, empty state, selection routing.
- `packages/editor/src/components/SpecPanel/AssetExportControls.tsx` — Quick
  export (format, scale, download, SVG copy) and Export configurations
  (preflight, preset rows, add-configuration fieldset, advanced-workspace entry).
- `packages/editor/src/components/SpecPanel/CodeGenView.tsx` — code sub-tab.
- `packages/editor/src/components/SpecPanel/export.ts` — helpers the tab uses
  (filename, raster/PDF export, download).
- `packages/editor/src/components/SpecPanel/SpecPanel.css` — export/code styles.
- Tests: `AssetExportControls.test.tsx`, `tests/e2e/spec/export*.spec.ts`,
  new focused specs under `tests/e2e/inspector/`.
- Docs: this report, `docs/audits/export-inspector-*`,
  `docs/architecture/export-system*` if it exists, website
  `apps/website/src/pages/docs/tools/export.astro` (accuracy only).

Out of primary scope (adjacent, only touched if the Export tab's honesty
depends on it): `ExportDialog.tsx` (advanced workspace) — already carries
uncommitted work from another session; not modified here.

## Owner

Single agent session (master), 2026-09-15.

## Files explicitly NOT touched (other agents' uncommitted work)

The working tree contains extensive uncommitted changes owned by other
sessions (font pipeline, generative edit, selection routing, SAM2,
background removal, effects, layers panel). This session does not commit,
revert, or reformat any of those files. Commits stage only the paths above.

## Shared contracts consumed (do not modify)

- `@varve/scene/export` capability catalog (`capabilitiesForFormat`,
  `formatSupportedOnPlatform`, preset materialization) — read-only.
- `@varve/ui` `Select` / `Tabs` / `CopyButton` / `Tooltip` — consumed; a
  defect root-caused in the primitive is reported, not silently re-scoped.
- `context.tsx` editor facade (`addPreset`/`updatePreset`/`removePreset`) —
  read-only; doc-mutation history semantics observed, not changed.
- `NumberField` (Inspector controls) — read-only reference; the export scale
  field stays a compact inline control unless evidence requires the full field.

## Deliverables

1. Evidence-based audit of every Export-tab section with real-world runs
   (realistic multi-layer documents, image/text/vector nodes, batch presets,
   long names, narrow panel, dark theme, enlarged text).
2. Repairs for real defects, each with regression tests.
3. Visual validation via Playwright with before/after screenshots.
4. Docs updated (audit + user-facing website page accuracy).

## Progress log

- 2026-09-15 — audit, repairs, and unit coverage land as `63f6eac28`
  (`fix(export): honest Inspector export tab — naming, scale bounds, undo, SVG
  parity`). Evidence: `docs/audits/export-inspector-audit-2026-09-15.md`,
  `docs/screenshots/2026-09-15-export-inspector/`, and
  `tests/e2e/inspector/export-tab.spec.ts` (run locally with
  `--config=playwright.export-inspector.local.config.ts`; see the audit's
  verification section for why that local config exists).
- Environment note: browser verification on this machine ran against a
  shared checkout in which several concurrent sessions were editing
  `packages/engine` and the Inspector controls between runs. Transient Vite
  import/parse errors and a full 12 GB `/tmp` tmpfs (Chromium's shared memory
  is relocated there by Playwright's default `--disable-dev-shm-usage`) caused
  page crashes that are unrelated to this change; every scenario that was
  re-run once the tree was coherent passed. The audit records exactly which
  scenarios were verified in-browser and which were blocked.


