# Inspector Panel UI/UX Review & Repair — Ownership and Handoff (2026-09-15)

**Task:** Comprehensive review, diagnosis, repair, and verification across the actual app's Inspector panel (all sections, components, text legibility, spacing, disclosure contracts, and accessibility) on `master`, with real-world scenarios, measured evidence, progressive commits, docs and website alignment, and visual validation.
**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve` (per task instructions; no branch or worktree created).
**Research/Evidence Ledger:** `docs/research/inspector-panel-ux-repair-2026-09-15.md`.
**Audit & Verification Report:** `docs/audits/inspector-panel-ux-repair-2026-09-15.md`.
**Rendered Audit Spec:** `tests/e2e/inspector/design-tab-audit.spec.ts`.

---

## 1. Why this Record Exists

The working tree contains concurrent uncommitted changes from other streams (font pipeline, generative editing, etc.). This document establishes explicit ownership boundaries so edits are cleanly isolated and can be safely validated and committed on `master`.

---

## 2. Owned Paths (This Task)

| Path | Responsibility / Change |
|---|---|
| `packages/editor/src/components/Inspector/sectionRegistry.ts` | Add `'snapping'` to `SectionId` & `SECTION_DEFINITIONS` (order 605, category 'canvas'); add `layoutGuides` subsection to `layout`; add `settings` subsection to `warp`. |
| `packages/editor/src/components/Inspector/featureOwnership.ts` | Add `'snapping'` ownership definition to `FEATURE_OWNERSHIP`. |
| `packages/editor/src/components/Inspector/sections/MockupsSection.tsx` | Wrap mockup inspector surface in `<DisclosureSection title="Mockup" sectionId="mockups">`. |
| `packages/editor/src/components/Inspector/sections/MaskSection.tsx` | Connect `<DisclosureSection>` to `sectionId={sectionId ?? 'mask'}` for registry state and customization. |
| `packages/editor/src/components/Inspector/sections/InteractionSection.tsx` | Connect `<DisclosureSection>` to `sectionId={sectionId ?? 'interaction'}` for registry state and customization. |
| `packages/editor/src/components/Inspector/sections/LayoutSection.tsx` | Connect nested `LayoutGuidesSection` to `sectionId="layout" subsectionId="layoutGuides"`. |
| `packages/editor/src/components/Inspector/sections/WarpSection.tsx` | Connect nested settings disclosure to `sectionId="warp" subsectionId="settings"`. |
| `packages/editor/src/components/Inspector/panels/DocumentPanel.tsx` | Change Snapping disclosure from legacy `id="snapping"` to `sectionId="snapping"`. |
| `packages/editor/src/components/Inspector/panels/AuditPanel.tsx` | Clean up redundant `defaultExpanded={false}` on Cognitive Load disclosure; rely on registry default. |
| `packages/editor/src/components/Inspector/SelectionSourcesPanel.tsx` | Add `wrapLabel` prop to "Estimate quality" `FieldRow` to eliminate label truncation in 38% grid track. |
| `packages/editor/src/components/Inspector/sections/DepthMaskSection.tsx` | Add `wrapLabel` to "Near transition" and "Far transition" `FieldRow`s. |
| `packages/editor/src/components/Inspector/sections/LensBlurSection.tsx` | Add `wrapLabel` to "Focal Distance" and "Transition Range" `FieldRow`s. |
| `apps/website/src/pages/docs/getting-started/interface.astro` | Update documentation for Snapping, Mockups, Masks, Prototype Interactions, and Section Manager customization. |
| `tests/e2e/inspector/design-tab-audit.spec.ts` | Remove exception filter for `'Estimate quality'` and assert zero truncated labels across all inspected layers. |
| `docs/research/inspector-panel-ux-repair-2026-09-15.md` | Comprehensive research ledger (competitor failures and Varve resolutions). |
| `docs/audits/inspector-panel-ux-repair-2026-09-15.md` | Verification and audit report with before/after evidence. |
| This record (`docs/agents/inspector-review-2026-09-15-ownership.md`) | Ownership declaration and handoff ledger. |

---

## 3. Invariants & Architecture Contracts

1. **Disclosure Single Source of Truth:**
   All disclosure sections that represent registry-managed features MUST pass `sectionId` (and optional `subsectionId`). Defaults MUST be declared in `sectionRegistry.ts` (`defaultExpanded` or `subsections[subId].defaultExpanded`), not via legacy ad-hoc `defaultExpanded` props on `<DisclosureSection>`.
2. **Dense Desktop Token Floor:**
   All labels must maintain minimum 11px font size; inputs must maintain minimum 12px font size and 24px height.
3. **No Clipped Text in Label Tracks:**
   Every multi-word label subject to variable sidebar widths must use `wrapLabel` (`.insp-field__label--wrap` with `overflow-wrap: anywhere`) to prevent truncation into ellipses.
4. **Target Size Compliance:**
   All interactive buttons and switches must meet the 24×24px minimum touch/pointer target size (WCAG 2.2 SC 2.5.8).
5. **No Regressions on Concurrent Work:**
   Only touch and stage files in the owned table above.
