# Typography + Insights inspector review — Ownership and Handoff (2026-09-16)

**Task:** Review and improve the Design tab's **Typography** section (including
its popovers) and **Insights** section on `master`: more user-friendly,
clutter-reduced, progressive disclosure where warranted, descriptive control
labels, real-world validation, progressive commits, docs and website aligned,
and competitor failure modes researched (what works and what users complain
about).

**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve` (per task
instructions; no branch or worktree created).

**Research ledger:** `docs/research/typography-insights-ux-research-2026-09-16.md`
**Rendered audit spec:** `tests/e2e/inspector/typography-insights-review.spec.ts`
**Verification report:** `docs/audits/typography-insights-review-2026-09-16.md`
**Website updates:** `apps/website/src/pages/docs/getting-started/interface.astro`,
`apps/website/src/pages/docs/tools/typography.astro`,
`apps/website/src/pages/features/typography.astro`

---

## 1. Why this record exists

The working tree contains concurrent uncommitted changes from other streams
(font browser, effects redesign, generative editing). This record fixes the
ownership boundary for this review and states which pre-existing edits were
carried into the commits.

## 2. Owned paths and changes

| Path | Change |
|---|---|
| `packages/editor/src/components/Inspector/sections/TypographySection.tsx` | Spine + Advanced typography subsection, icon/named controls, conditional vertical align/orientation, descriptive option labels, count badges |
| `packages/editor/src/components/Inspector/sections/TypographySection.css` | Count badge, icon-only segmented sizing |
| `packages/editor/src/components/Typography/AdvancedOpenTypeFeaturesSection.tsx` | Shared `Select`, required shaping tags hidden, active-count badge |
| `packages/editor/src/components/Inspector/controls/SegmentedControl.tsx` | `tooltip` + `hideLabel` options with accessible names |
| `packages/editor/src/components/Inspector/sectionRegistry.ts` | Typography subsections declared; `insights` section id |
| `packages/editor/src/components/Inspector/featureOwnership.ts` | `insights` ownership entry |
| `packages/editor/src/components/Inspector/PropertiesPanel.tsx` | Insights disclosure registry-managed |
| `packages/editor/src/components/Inspector/panels/AuditPanel.tsx` | CognitiveLoadSection; composition comment |
| `packages/editor/src/components/Inspector/sections/CognitiveLoadIndicator.tsx` | `CognitiveLoadSection` renders only when score > 0 |
| `packages/editor/src/panels/IntelligencePanel.tsx` | Human tab labels, applicability gating, severity filters, suppression restore, dead auto-fix removed, Names reachable from the Quality group |
| `packages/editor/src/components/Inspector/inspector.css` | Intelligence chip accents and inline action link styles (staged as a partial patch; the rest of the file belongs to the effects stream) |
| `packages/editor/src/components/Inspector/sections/__tests__/TypographySection.test.tsx` | Progressive-disclosure, naming, conditional-row, badge tests |
| `packages/editor/src/components/Inspector/__tests__/sectionRegistry.test.ts` | Declared subsection defaults; corner-radius multi-select expectation aligned with the committed 2026-09-15 redesign |
| `packages/editor/src/panels/IntelligencePanel.test.tsx` | Contrast tab label, Names via More menu, applicability gating tests |
| `tests/e2e/inspector/typography-insights-review.spec.ts` | Real-world rendered validation + screenshots |
| `docs/research/typography-insights-ux-research-2026-09-16.md` | Research ledger |
| `docs/audits/typography-insights-review-2026-09-16.md` | Verification report |
| This record | Ownership declaration |

## 3. Invariants

1. **Section defaults live in the registry.** Typography subsection collapse
   defaults are declared in `sectionRegistry.ts`; no call-site
   `defaultExpanded` is used in registry mode.
2. **No native `<select>`.** Every typography control routes through the
   shared `@varve/ui` Select/SegmentedControl primitives.
3. **Applicability gates hide, they do not disable.** Tabs and rows that
   cannot act on the current target are absent, not inert.
4. **No aspirational actions.** A control that changes the document is kept;
   a control that only announces is removed.
5. **Advanced rows stay reachable.** Nothing was deleted from the Typography
   model: every moved control is one labeled subsection away, and a badge
   reports when the layer already uses it.
6. **Concurrent streams are not owned.** Two foreign hunks ride in the
   commits: the image-placement order change in `sectionRegistry.ts` and the
   range-selection/live-preview status rows in
   `AdvancedOpenTypeFeaturesSection.tsx`, both already present in the working
   tree before this review; the rest of `inspector.css` was deliberately left
   unstaged.

## 4. Commit ledger

| Commit | Scope |
|---|---|
| `31cd4bbd1` | feat(typography): progressive disclosure and descriptive controls |
| `834b337dc` | feat(insights): human labels, applicability gating, honest actions |
| `c89c62176` | fix(typography,insights): badge counting, row gating, tab memoization + research/ownership docs |
| `c387cab4d` | refine(typography,insights): quiet OpenType rows, humanized review text, More-tab active state, Spacing reachable in Design |
