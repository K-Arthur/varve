# Inspector systems redesign — audit and implementation record

**Date:** 2026-09-17
**Branch:** `master`
**Scope:** Inspector composition architecture, section registry coherence,
collapsed-section summaries, section-manager coverage, restriction recovery,
and measured before/after evidence.
**Ownership:** [docs/agents/inspector-systems-redesign-2026-09-17-ownership.md](../agents/inspector-systems-redesign-2026-09-17-ownership.md)

## 1. Method and sources

This pass started from the previous 2026-09-15/16/17 Inspector passes (Design-tab
rewrite, paint-stack unification, contextual ordering, input-surface contract,
responsive geometry — see their dated audits and ownership records) and asked
what they had recorded but not yet owned. External sources consulted before
implementation (source type noted):

| Source | Finding | Type |
| --- | --- | --- |
| [WCAG 2.2 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | 24×24 CSS px floor with a spacing exception; the panel already honors this for section headers. | Standard |
| [NN/g — Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) | More than two disclosure levels has low usability; secondary layers need obvious paths and strong information scent. | Human-factors research |
| [Figma UI3 feedback (forum)](https://forum.figma.com/share-your-feedback-26/ui3-feedback-3058/index2.html) | Users objected when high-frequency actions moved behind extra clicks or lost muscle memory — moving/hiding without a discoverable trail is the failure mode. | User-reported failure |
| [Figma Dev Mode Inspect panel feedback](https://forum.figma.com/t/most-functionality-removed-from-inspect-properties-panel-now-that-dev-mode-is-out-of-beta/63492) | Functionality that exists but becomes unreachable in an untested state generates the loudest complaints. | User-reported failure |
| [Blender Properties editor design task](https://archive.blender.org/developer/maniphest/0054/0054951/index.html) | Dense property collections need one scannable spine plus a recovery/search path. | Observed product behavior |
| Prior repository research (`docs/research/inspector-design-tab-review-2026-09-15.md`, `inspector-panel-cross-panel-ia-2026-09-16.md`) | Cross-panel IA is settled; the remaining gaps are coherence and reachability, not placement. | Repository evidence |

## 2. Measured before-state (task budgets)

`tests/e2e/inspector/inspector-redesign-baseline.spec.ts` measures the real
editor (Chromium, 1440×900, 320px inspector rail, every section expanded):

| Scenario | Sections | Content height (px) | Viewport (px) | Scroll ratio | Fill offset (px) | Stroke offset (px) | Effects offset (px) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| No selection | 7 | 1603 | 631 | 2.5× | — | — | — |
| Rectangle | 12 | 2219 | 665 | 3.3× | 256 | 580 | 1219 |
| Frame | 14 | 2723 | 665 | 4.1× | 1019 | 1343 | 1981 |
| Text | 17 | 4582 | 665 | 6.9× | 2562 | 2886 | 3524 |
| Image | 21 | 4137 | 665 | 6.2× | 359 | 2220 | 2654 |
| Multi (same) | 11 | 1910 | 665 | 2.9× | 223 | 547 | 762 |
| Multi (mixed) | 11 | 1828 | 665 | 2.7× | 223 | 547 | 762 |

Screenshots committed under
`docs/screenshots/2026-09-17-inspector-review/post-redesign-*.png` show the
panel **after** this pass (the spec's fixed output names mean the pre-
implementation captures were overwritten by later runs of the same spec);
the before-state is preserved numerically in the table above. Expanded
heights are unchanged by this pass — the redesign targets composition
coherence, collapsed-state scannability, and reachability, not compressed
expanded content.

## 3. Repository findings (root causes, not symptoms)

1. **Membership was not registry-driven.** `composeSections` applied registry
   availability/order, but the *set* of sections per composition was three
   hardcoded JSX sequences in `PropertiesPanel.tsx`. This single fact caused
   most of the drift below.
2. **Registered but never rendered:** `frame-resize`, `table-rows`,
   `adjustment`, `ai-tools-hint` had definitions (and feature-ownership
   entries) but no composition ever rendered them. `adjustment` additionally
   had a dead special case in `getAvailableSections`.
3. **Rendered but not registered:** Align & Distribute and Pathfinder
   (Boolean) were bare JSX; the section manager could not hide, restore, or
   list them.
4. **Availability duplicated in JSX guards.** Corner radius, warp,
   image-placement, effects, and smart-filters each re-implemented (or
   narrowed) their registry predicate inline. `smart-filters` needed
   `canHaveSmartFilters` *on top of* the registry predicate; `effects` needed
   the kind list *and* `canHaveLayerEffects`.
5. **Three label sources.** Registry `title`, rendered `DisclosureSection`
   titles, and a third override map in `SectionManagerTrigger` ("Frame
   layout", "Child layout", "Position & size") drifted from each other. Two
   registry entries were both titled "Adjustment Layer".
6. **Duplicate order values.** `layout`/`layout-child` (120),
   `typography`/`blend-images` (300), `text-on-path`/`adaptive-contrast` (310),
   `blend-images`/`palette` (301 after renumber) — resolvable only by
   declaration order, so composition ordering depended on source layout.
7. **Two persistence paths.** Layer States kept a private localStorage
   disclosure, so the registry's documented `defaultExpanded: false` never
   applied and the section manager could not see its state.
8. **Section-state version flag lied.** `settings.ts` wrote `version: 1`
   while `sectionState.ts` declares `SECTION_STATE_VERSION = 2`.
9. **Stale ownership surfaces.** Six sections rendered in the Design tab
   reported ownership surface `appearance` (a merged tab), so the section
   manager omitted them from its list.

## 4. Decisions

### Decision 1 — Membership becomes data in one surface (`sectionComposition.tsx`)

Problem: membership spread across three JSX sequences; registered sections
orphaned; unregistered sections unmanaged.
Alternatives: (a) put React component references in the registry (import
cycles — sections import the registry for types); (b) keep JSX, add tests that
assert every registered section is rendered somewhere; (c) a dedicated
membership module the panel consumes.
Selected: (c). The registry keeps availability/order/labels/state (pure,
UI-free); `sectionComposition.tsx` declares, per composition kind
(single / single-table / multi / tool), the member list and prop wiring and
nothing else. Both files have one job; together they are the minimum
practical number of authoritative sources.
Tradeoff: two files must agree that a section exists (enforced by the
feature-ownership parity test and the registry integrity test).

### Decision 2 — Retire genuinely dead entries instead of rendering them

- `adjustment`: the Adjustments tab is the canonical editor (auto-switched on
  selection); the Design tab deliberately renders nothing for adjustment
  nodes. Retired (`RETIRED_IDS`), special case removed.
- `table-rows`: `TableTracksSection` renders one combined "Columns & Rows"
  section under `table-columns`. Retired.
- `frame-resize`: **not restored** — investigation found the compact
  `FramePresetDropdown` inside Position & Size already owns preset resizing,
  *including* "Save current size as preset". Rendering the full section would
  duplicate the affordance (the failure pattern the Figma/Adobe research
  warns about). Retired with rationale. The E2E locator collision this
  surfaced (two "Resize to Preset" buttons) is resolved by the retirement.
- `ai-tools-hint`: **wired in** for image selections outside Photo workspace
  (its documented purpose — the mirror image of the Photo-mode AI cluster),
  defaulting collapsed so it costs one header row, not expanded height.

### Decision 3 — Availability nuance moves into the registry predicates

The effective old predicates were the *intersection* of the JSX guard and the
registry check. The intersection is now the registry predicate itself:
`smart-filters` requires `every(canHaveSmartFilters)`; `effects` requires the
kind list AND `every(canHaveLayerEffects)`; `layout` excludes export regions
(stored as frames, but childless — layout controls would be inert switches);
`boolean` uses `isLiveBooleanNode`. Rendered availability is unchanged (the
adjustments-tab audit E2E now passes against the same section identity).

### Decision 4 — One title per section

Registry `title` is canonical: rendered names ("Stack / Grid", "Layout child")
became the registry values; the manager's override map was deleted;
`table-columns` → "Columns & Rows"; `content-aware-fill` → "Generative Edit";
`cognitive-load` → "Cognitive load" (matching rendered); "Adjustment Layer"
duplication resolved by the `adjustment` retirement.

### Decision 5 — Unique orders, enforced

All colliding orders renumbered (`layout-child` 121, `blend-images` 301,
`palette` 302, `adaptive-contrast` 311, `ocr` already fractional) and the
registry integrity checker now fails on duplicate orders.

### Decision 6 — Collapsed summaries as accessible descriptions

Research basis: NN/g's two-level disclosure guidance and the input-surface
contract's rule that advanced sections "expose a summary/count when a
non-default value is hidden". Seven high-value sections (Fill, Stroke,
Typography, Layer Effects, Corner Radius, Stack/Grid, Image Placement) render
a text-only summary in the header row while collapsed. First implementation
put the summary inside the trigger button (part of the accessible name); that
polluted `textContent` for downstream consumers (the adjustments-tab audit
reads it), so the final design renders the summary beside the title and wires
it via `aria-describedby` — announced by assistive technology as the
trigger's description, without widening its name. Mixed states say "Mixed" in
words; nothing is colour-encoded; long summaries ellipsize.

### Decision 7 — Locked selections gain a recovery path

Locked selections stay inspectable (values visible, editing inert — an
explicitly tested contract). The restriction notice now offers an inline
"Unlock layer(s)" action that routes through `bulkSetNodeLocked` (one undo
step), giving locked states the "navigation to restriction source" the
comparative research shows is the difference between a restriction and a dead
end. The axe-core locked-selection scan passes with zero violations.

## 5. Validation

Commands and results are recorded in the final report below. Summary:
registry/ownership/panel unit suites, six E2E spec files, four regenerated
visual baselines (each opened and inspected before accepting — diffs match
the intended redesign: summaries in headers, unlock action in the lock
notice, Pathfinder/section-manager coverage), axe-core scans including a new
locked-selection scan, and the after-state measurement run.

## 6. Remaining work (recorded, not repaired)

- Adjustments-tab launcher IA (08-30 audit) — the longest single surface.
- `pluginSections.ts` remains an unwired extension point.
- Inspect-mode axe specs fail at *setup* on the current shared tree (the
  "Inspect" toolbar button is not findable under its old name after concurrent
  toolbar work) — the scans never reach axe; unrelated to this pass but
  blocks that coverage until reconciled by the toolbar owner.
- propertyState's `inherited`/`overridden`/`calculated` vocabulary remains
  unconstructed (documented migration-in-progress by its owner).
