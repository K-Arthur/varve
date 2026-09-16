# Disclosure / Accordion review — ownership (2026-09-15, session H)

**Task (user directive):** "focus on all the actual apps' disclosures, reviewing
all its sections and components, text, spacing etc." — across the desktop
editor frontend and the marketing website, with research into what other
products got wrong that users complained about, progressive commits on
`master`, docs updates, website changes, visual validation, and real-scenario
testing (not fixtures alone).

**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve` (per the
task instruction; no branch or worktree created).
**Base HEAD at start:** `b04e69218`.

**Research ledger:** `docs/research/disclosure-review-2026-09-15.md`.
**Audit + verification:** `docs/audits/disclosure-review-2026-09-15.md`.

## Why this record exists

The working tree contains many other writers' uncommitted changes (font
pipeline, generative edit, selection routing, SAM2, background removal, export
inspector, layers panel, menus, popovers, separators, toolbar follow-up). This
record names the paths this session owns so a later integration pass can tell
them apart. Commits from this session stage only disclosure-owned paths.

## Owned paths (this session edits)

| Path | Change |
|---|---|
| `packages/ui/src/components/Disclosure.tsx` | Shared disclosure primitive repairs |
| `packages/ui/src/components/Accordion.tsx` | Shared accordion primitive repairs |
| `packages/ui/src/components/disclosure.css` | Shared disclosure/accordion styles |
| `packages/ui/src/components/__tests__/Disclosure.test.tsx` | Primitive regression tests |
| `packages/ui/src/components/__tests__/Accordion.test.tsx` | Primitive regression tests |
| `packages/ui/src/components/Disclosure.stories.tsx`, `Accordion.stories.tsx` | Story coverage (only if needed) |
| `packages/editor/src/components/Inspector/controls/DisclosureSection.tsx` | Inspector section host repairs |
| `packages/editor/src/components/SectionCollapseToggle.tsx`, `section-collapse.css` | Sidebar collapse control |
| `packages/editor/src/components/Inspector/inspector.css` | Disclosure-related rules only (`.insp-disclosure*`) |
| `packages/home/src/FormatMigration.tsx`, `NewDesignDialog.tsx`, `SidebarNav.tsx` | Shared-primitive consumers |
| `packages/editor/src/components/Export/PreflightFindingsPanel.tsx` | Shared-primitive consumer |
| `apps/website/src/pages/support/faq.astro` | FAQ disclosure surface |
| `apps/website/src/pages/compare.astro`, `changelog.astro` | Native `<details>` surfaces |
| `tests/e2e/disclosures/**` | New rendered-scenario specs |
| `docs/research/disclosure-review-2026-09-15.md` | Research ledger |
| `docs/audits/disclosure-review-2026-09-15.md` | Audit + verification evidence |
| `docs/architecture/disclosure-system.md` | Canonical contract (new) |
| `AGENTS.md` | Disclosure-system section truth pass |

## Explicitly not touched

- `packages/editor/src/components/Inspector/PropertiesPanel.tsx` and
  `sectionRegistry.ts`/`sectionState.ts` unless a disclosure defect is proven to
  require it (the Inspector Design tab session currently owns section content).
- `packages/editor/src/components/LayersPanel/**` (layers panel session).
- `packages/editor/src/components/SpecPanel/**`, `ExportDialog.tsx`,
  `PropertiesPanel.tsx` (export inspector session).
- Other sessions' in-flight files (font pipeline, menus, popovers, separators,
  toolbar, generative editing).
- `tests/e2e/shared.ts` unless a new spec genuinely needs a shared helper change
  (currently owned by another batch); new specs should reuse it read-only.

## Shared interfaces and coordination rules

- The shared `Disclosure`/`Accordion` primitives are consumed by the editor,
  `@varve/home`, and the website docs surfaces. Changes must remain
  backward-compatible: props are additive, DOM structure/attributes may be
  strengthened but not renamed (`varve-disclosure__*`, `data-state`,
  `aria-expanded`, `aria-controls` are load-bearing in CSS and E2E tests).
- Inspector half of the stack keeps two implementations (registry + legacy
  sessionStorage). Both must receive the same behaviour fixes; the canonical
  contract lives in `docs/architecture/disclosure-system.md`.
- No new dependencies.
