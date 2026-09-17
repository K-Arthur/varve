# Inspector systems redesign — ownership (2026-09-17)

**Branch:** `master`
**Trigger:** research-led mandate to audit and complete the Inspector as a
coherent property system. Prior 2026-09-15/16/17 passes landed the Design-tab
rewrite, paint-stack unification, contextual ordering, input-surface contract,
and responsive geometry. This pass owns the remaining coherence gaps those
passes recorded but did not own, plus the measured before/after evidence.

## Coordination

This record was written after reading every
`docs/agents/inspector-*ownership*.md` record (2026-09-15/16) and the audits
they point at. The working tree is shared with concurrent font/native,
toolbar, and export passes (180+ dirty files); none of them claim
Inspector paths right now. Paths this pass will touch, re-checked against
`git status` immediately before editing:

- `packages/editor/src/components/Inspector/PropertiesPanel.tsx` — composer
  consolidation (registry-driven membership).
- `packages/editor/src/components/Inspector/sectionRegistry.ts` — membership
  metadata, unique orders, label disambiguation.
- `packages/editor/src/components/Inspector/sectionState.ts` — retired-id
  migration for any removed registry id.
- `packages/editor/src/components/Inspector/controls/DisclosureSection.tsx` —
  collapsed-summary slot.
- `packages/editor/src/components/Inspector/controls/controls.test.tsx` and
  focused section tests.
- Section components under `sections/` listed in the audit below, each
  re-read immediately before its edit.
- `packages/editor/src/settings.ts` — section-state version flag only.
- Explicitly scoped rules in `inspector.css` (summary row styling).
- New evidence spec `tests/e2e/inspector/inspector-redesign-baseline.spec.ts`
  (already created this pass) plus focused new tests.

Not claimed, preserved as-is: `NumberField.tsx` (contract implemented,
concentric test coverage), `DocumentPanel.tsx` composition internals, the
Adjustments tab's launcher IA (recorded as a follow-up in
`docs/audits/inspector-organization-audit-2026-08-30.md`), and every unrelated
dirty path in the shared worktree.

## Scope

1. Registry-driven membership: the registry gains per-composition membership
   data so `composeSections` is the single composer; unregistered-but-rendered
   and registered-but-never-rendered sections are reconciled with explicit
   decisions in the companion audit.
2. One label per section (registry `title` is the single string source; the
   section manager's override map is removed).
3. Unique registry orders + integrity test; two "Adjustment Layer" labels
   disambiguated.
4. Collapsed-section summaries for high-value sections (text, not
   color-encoded; mixed-aware; truncation-safe).
5. Single persistence path for Layer States collapse state; section-state
   version flag made truthful.
6. Before/after height + scroll budgets measured by
   `inspector-redesign-baseline.spec.ts`; before-state screenshots in
   `docs/screenshots/2026-09-17-inspector-review/`.
7. Evidence audit: `docs/audits/inspector-systems-redesign-2026-09-17.md`.

Out of scope (recorded for future passes): Adjustments-tab launcher IA,
plugin-section host wiring (`pluginSections.ts` remains an unwired extension
point), binding entry-point shortcuts, property search.
