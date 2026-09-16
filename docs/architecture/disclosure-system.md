# Disclosure / Accordion System

Canonical contract for every collapsible section surface in the two
applications (`apps/desktop` editor frontend and `apps/website`). Review
evidence and the issue register live in
`docs/audits/disclosure-review-2026-09-15.md`; the research ledger is
`docs/research/disclosure-review-2026-09-15.md`.

## Taxonomy (choose the right host before styling anything)

| Host | Used by | Why |
|---|---|---|
| Shared `Disclosure` / `Accordion` (`packages/ui/src/components/`) | `@varve/home` dialogs and sidebar, editor legacy inspector sections, editor standalone sections (gradient options, preflight findings, import results, minimap) | One focus/keyboard/persistence contract; React state can be coordinated with the editor |
| Registry `DisclosureSection` (`packages/editor/src/components/Inspector/controls/DisclosureSection.tsx`) | Every Inspector section with a `sectionId` | State lives in `EditorState.sectionVisibility` so it survives selection changes, workspace switches, and reload; supports hide/reorder/section manager |
| `SectionCollapseToggle` + local section state (`packages/editor/src/components/SectionCollapseToggle.tsx`) | Left sidebar sections (variables, masters, pages, design canvases, spreads) | The section header is a title row, not a heading button; the toggle is a sibling affordance. Persistence via `usePersistedDisclosure` |
| Native `<details>/<summary>` | Website FAQ/compare/changelog, demo banner, many editor detail panes | Native button semantics, Enter/Space, true hiding, find-in-page support; no JS state to get wrong |

Do not introduce a fifth implementation. If a surface needs a new contract,
extend one of these and record it here.

## Behavioural contract (all custom hosts)

1. **Trigger** is a real `<button>` (or `summary`). Enter and Space activate it
   natively — no manual key handlers (a duplicate handler can double-toggle
   with assistive technology).
2. **State** is exposed with `aria-expanded` on the trigger. `aria-controls`
   points at the panel **only while that panel exists**; registry sections are
   unmounted while collapsed, so their `aria-controls` is conditional.
3. **Hidden means gone.** Closed content unmounts or carries `hidden`
   (`display: none`). Nothing inside collapsed content is focusable or
   reachable by Tab or a screen reader.
4. **Focus is never dropped.** When a close removes or hides the focused
   control, focus returns to the trigger. It never steals focus from a
   deliberate destination (another control, another accordion item, an outside
   click). Implemented once in `useDisclosureFocusRestore`
   (`packages/ui/src/components/Disclosure.tsx`) and consumed by the shared
   primitives and the registry host.
5. **Keyboard parity with the primitive.** Buttons keep native activation;
   Space must not be captured by editor shortcuts. The global Play/Pause Space
   binding defers to any focused element that activates with Space
   (`isNativeActivationKeyTarget` in `shortcuts/ShortcutManager.ts`). This
   applies to every button, not only disclosures.
6. **Headings for lists.** A set of inspector/sidebar sections or FAQ entries
   exposes a heading per item so heading navigation reaches them. The
   Inspector does this with `h3 > button`; the website FAQ with `h3` inside
   `summary`. A standalone disclosure does not need a heading.
7. **Chevron direction is one contract.** Collapsed reads right, expanded reads
   down, everywhere (shared primitive indicator, `SectionCollapseToggle`, FAQ,
   compare, changelog). The shared CSS rotates a right-chevron +90° when open;
   consumers must not pass a down-chevron and rotate it independently.
8. **Toggling never scrolls the page.** Opening/closing must not move the
   reader: no `scrollIntoView`, no forced scrolls, and the sticky inspector
   header keeps the section identity reachable while the body collapses.
   Measurement: `tests/e2e/disclosures/disclosure-contract.spec.ts`.
9. **No animation by default.** Only the chevron transitions. The
   measured-height/max-height animation class of defects (scroll jumps,
   clipped content, focus loss) is deliberately avoided in the editor and on
   the website. Respect `prefers-reduced-motion` for the chevron.
10. **Print reveals content.** Website disclosures carry a print override
    (`::details-content { content-visibility: visible }` plus a
    `display: block` fallback) so printing never drops closed answers.

## Persistence contract

| Surface | Store | Key | Scope |
|---|---|---|---|
| Registry inspector sections | `EditorSettings` in `localStorage` via `settings.ts` | `varve-editor-settings` → `sections.sections.<sectionId>.collapsed` | Persists across reload; document-independent user preference |
| Legacy inspector sections | `sessionStorage` | `strata:inspector:disclosure:<slug>` | Per-tab only; migrated once into the registry (`migrateLegacyDisclosureState`) |
| Sidebar sections | `localStorage` via `usePersistedDisclosure` | `varve:disclosure:<key>` | `variables`, `masters`, `pages`, `design-canvases`, `spreads` |
| Website FAQ/compare/changelog | none | — | Native `<details>` resets per page load by design |

Rules:

- Collapse state must never change as a side effect of editing a document,
  changing selection, undo/redo, or reordering sections. This is the single
  most-reported editor panel failure in comparable products (Blender
  #123653/#141506, Godot #81481) and is pinned by the E2E contract spec.
- Registry `defaultExpanded` wins over the `DisclosureSection` prop; the prop
  is legacy-mode only and must not be treated as an override.
- **Subsection defaults live in the registry too**
  (`SectionDefinition.subsections.<subsectionId>.defaultExpanded`); a missing
  declaration means expanded. The toggle inverts the *effective* default, so a
  default declared anywhere else would make the first click write a redundant
  value instead of opening the panel.
- Section state is user preference, not document content — it must never enter
  the undo stack or document JSON.
- Registry section roots carry `data-section-id` (and `data-subsection-id` for
  registry subsections) so tests, diagnostics, and visual captures can address
  a section without matching its display title.

## Sizing, spacing, and text

- Trigger minimum block size is 24 px (`WCAG 2.2 SC 2.5.8`); stacked headers
  get no spacing exception. `SectionCollapseToggle` is 24×24.
- Spacing comes from the shared 4/8 token scale (`--space-*`), never literals.
- Inspector sections are cards with a subtle border; sidebar sections are flat
  rows. Do not add a nested card per disclosure inside the inspector
  (ADR-0230 discourages nested section disclosures).
- Labels wrap or truncate per surface: the primitive label truncates with a
  full-name tooltip path; inspector section titles wrap. Never shrink essential
  text to fit a header.

## Known gaps (recorded, not silently accepted)

- **Two inspector persistence models coexist** (registry + legacy
  sessionStorage). The legacy branch is migration-compatible; new sections
  must use `sectionId`. A future pass should inventory and retire the legacy
  branch.
- **`mask` stays legacy by decision.** Its default depends on whether the
  selected node already has a mask (`defaultExpanded={!!mask}`), which
  registry state cannot express; wiring it to the registry would close the
  section for mask users or open it for everyone. Revisit if the registry
  gains conditional defaults.
- **No section-level collapse for `interaction`, `mockups`, and
  `align-distribute`.** Those registry entries govern availability, hide, and
  order through `composeSections`; `interaction` and `mockups` render inside
  their panel without a collapsible wrapper, and the align bar is anchored.
  They must not be listed as collapsible in new UI.
- **`Accordion` has no production consumer yet**; it is exported for future
  coordinated groups and carries the same focus/aria contract as `Disclosure`.
- **Legacy-mode sections still keep their own sessionStorage state**
  (`strata:inspector:disclosure:<slug>`), migrated once into the registry.
  `restoreDefaultCollapsed` resets registry entries only.
