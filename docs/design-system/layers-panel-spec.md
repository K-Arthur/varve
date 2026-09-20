# Layers Panel — Design System Specification (2026-09-19)

Status: current-state specification (supersedes the implicit contract in
`docs/plans/layers-panel-deferred.md`). Canonical for the Layers panel's row
anatomy, shared core behavior, and per-workspace projection.

Companion evidence: `docs/research/layers-panel-research.md`,
`docs/audits/layers-panel-audit-2026-09-19.md`,
`docs/plans/layers-panel-workspace-evolution.md`.

Implementation phase status is tracked in the plan file; this document is the
contract, not a progress log.

---

## 0. Principles

1. **One scene, many views.** A workspace changes the panel's *projection*
   (badges, filters, presets, default emphasis) — never the document, never
   the tree's identity, never selection or expansion state.
2. **Nothing is lost to save space.** Every control that is hover-revealed or
   workspace-suppressed remains reachable by pointer hover/focus, context
   menu, bulk bar (multi-selection), keyboard, and command palette.
3. **A configured field must have a runtime consumer.** No decorative config
   (workspace-system invariant 9).
4. **Tokens only.** No new hardcoded colour/space/type value.
5. **The panel never blocks the canvas.** Projections are memoized on
   document revision + workspace + filter; no per-frame work.

---

## 1. Shared core (all workspaces)

### 1.1 Row anatomy

```
[indent guides] [drag] [disclose] [selection dot] [thumb] [type icon] [name (ghost/rename)]
[baptism cluster → badges, workspace-ordered]
[presence] [workspace row actions] [visibility] [lock] [(solo*)]
```

- Indent step is `--space-3` per level up to `MAX_VISUAL_INDENT_DEPTH = 8`,
  then a flat indent plus indent guides (`layers-row__indent-guide`) so a
  24-level document stays readable.
- Row height is density-driven: `--density-rows-min-height` (34 px default,
  28 px compact). No new fixed row heights.
- The row remains one `role="treeitem"`; controls inside are
  `tabIndex={-1}` pointer affordances, per the APG roving-tabindex model.
  Accessible names carry state (hidden, locked, hidden by ancestor, mask
  role, instance/override) so a screen-reader user never depends on a badge.

### 1.2 Badge contract

Badges are grouped; a group is either **pinned** (always rendered when the row
carries the state) or **revealed** (rendered on row hover or when the row
contains focus). Pinned vs revealed comes from the workspace configuration
(§2). A revealed badge is never removed from the accessible name — the row's
`aria-label` composes the same facts in every workspace.

`data-badge-group` attributes expose the grouping for CSS and E2E; the
existing `.layers-row__badges` wrapper continues to absorb overflow at narrow
widths.

**Capacity rules at narrow rails (container query, `layers` container).**

| Width | Rule |
|---|---|
| Any | The identity column takes the leftover width (`flex: 1 1 0`) and the badge cluster is bounded (`max-width: min(42%, 12rem)`) so a dense status stack cannot reserve a rail on every row. The cluster keeps `min-width: 0` + `overflow: hidden`, and the shrink:0 visibility/lock/solo toggles never move (`AUD-010`) |
| ≥ 220px | The label floor is 8ch: a wide panel does not render every name at its minimum |
| ≤ 219px | The label floor is 0. At the documented 180px minimum the fixed controls plus the cluster's 1.5rem floor already fill the row's inner width, so any name floor pushes the toggles past the panel edge (`layers-row-badge-overflow.spec.ts` asserts `scrollWidth <= clientWidth`). The name renders whenever there is free space; the accessible name and tooltip carry it otherwise |
| ≤ 340px | Chips cap at 4.5rem and ellipsize |
| ≤ 260px | The blend/opacity chip keeps a 1.5rem minimum; effect and object-filter chips yield; mask-role chip yields; revealed (non-pinned) groups stay hidden so a hover reveal cannot displace a pinned chip. The cluster yields to its 1.5rem floor before the label is displaced |
| ≤ 260px, hover-capable | The unpinned solo control's slot collapses. Solo stays in the context menu, the bulk bar, the command palette, and on touch devices and the Photo workspace (pinned slot) |

**Labels never hard-clip.** A badge that can truncate owns
`overflow: hidden` + `text-overflow: ellipsis` on the element that carries the
text (`.layers-row__effect-stack-badge-label` for action badges, the chip
itself for state badges). The full value is always available in the chip's
tooltip and `aria-label`, and the row's accessible name states it in text:
blend mode, opacity, layer-effect count, object-filter count, mask type/role.
A chip hidden by a capacity rule is therefore never the only carrier of its
state.

### 1.3 Virtualized tree

- `@tanstack/react-virtual` with `overscan: 10`, `measureElement` per row,
  density-aware `estimateSize`.
- Stable keys: `entries[i].node.id`.
- Virtualization must not change `aria-level`/`aria-posinset`/`aria-setsize`;
  rows declare them explicitly (APG: browsers may not compute them).
- Long-jump focus retry (`FOCUS_RETRY_FRAMES`) is part of the contract.

### 1.4 Selection and reveal

- Selection is editor state (`state.selection`, `primaryId`); the panel reads
  it and writes through `setSelectionRefs` with `origin: 'layers'`.
- Canvas→panel auto-reveal respects `settings.layers.autoReveal` and skips
  panel-originated/navigation-originated changes (no jump loops).
- Panel→canvas activation navigates per `settings.layers.selectionNavigation`
  (`select-only | reveal | center | fit`), unchanged.
- Drag to canvas is owned by `DnDShell`; the panel publishes one drop target.

### 1.5 Search and filter

- Search narrows with **ancestry preserved** and reveals matching descendants
  without mutating the user's expansion set (existing behavior — keep).
- Filters are AND-combined across dimensions: kinds, attributes, blend modes,
  and (new) workspace presets.
- The search field gains a **Select matches** action (§2.6) enabled whenever a
  filter is active and matches ≥ 1 row.
- The header shows `Filtered` and the filter bar shows `N of M layers`.
- Empty states: "No layers yet" (empty document) vs "No results found"
  (filter) remain distinct.

### 1.6 Rename

- Inline rename via double-click name, F2, or context menu. Containers toggle
  expansion on double-click of the row; renaming happens on the name.
- Enter commits, Escape cancels (and does not exit isolation), Tab commits and
  cycles to the next/previous row.
- Blank input commits the ghost auto-name; explicit names are stored.
- Batch rename stays a dialog over the current selection (find/replace,
  regex, case, whole word). Batch rename is exactly one undo entry.

### 1.7 Visibility, lock, solo

- Visibility and lock are always pinned row controls. Their aria names carry
  direct vs inherited state.
- Solo is pinned only in workspaces that configure it (§2.3); otherwise
  hover/focus-revealed, and never removed from the context menu or bulk bar.
- Bulk toggles act on the whole selection with mixed-state semantics.

### 1.8 Drag rules

- One authoritative `LayerDropTarget` resolves the preview, auto-expand,
  announcement, and commit.
- 5 px activation distance; a click after a drag is swallowed exactly once.
- Before/after/into zones with the container middle band at 0.3–0.7.
- Cycle and effective-lock refusals are previewed as `--invalid`, not
  discovered on drop.
- Auto-expand after 500 ms; expansions spring back on cancel unless the drop
  landed inside.
- Auto-scroll at 56 px edge bands, ≤ 32 ms frames, squared ramp.
- Reparenting releases a mask when the matte leaves its container (scene
  invariant; the panel never mutates masks itself).
- Multi-selection drag moves the canonicalized selection; a no-op move
  creates no undo entry.

### 1.9 Keyboard model (APG tree)

Unchanged from `useTreeKeyboardNavigation.ts`: arrows, Home/End,
Shift+Arrow range, Enter activate, Space toggle, Ctrl+A, F2, Shift+F10/Menu,
Escape, type-ahead, `Ctrl+]`/`Ctrl+[` reorder, `Ctrl+Alt+]`/`Ctrl+Alt+[`
indent/outdent, and APG optional `*` (expand all closed container siblings at
the focused row's level; focus does not move, no undo entry, no-op on the
isolation root). New keys must not shadow typing contexts; the ShortcutManager
already treats tree items as non-typing.

### 1.10 Context menu

Capability-gated, workspace-agnostic menus with state-aware labels. New
workspace entries are additive and appear only when they can apply.

### 1.11 Collapse persistence

Expansion is in-memory (per session) plus panel-transfer codec; the workspace
switch must preserve it (invariant: no remount). Collapse-all keeps ancestors
of the primary selection visible.

### 1.12 Empty and loading states

- Loading: the tree renders nothing until the first projection; the header
  count renders `0` during load and the panel shows the existing empty-state
  block only after the document is present.
- Empty document: "No layers yet" with the create hint.
- Filtered-empty: "No results found" plus a "Clear filters" action.

---

## 2. Per-workspace configuration

The panel reads `useEffectiveWorkspaceConfig(state.workspaceMode).layersPanel`.
The field is optional; an absent field resolves to the Design defaults, so
persisted payloads and future modes need no migration.

### 2.1 The field

```ts
// workspaceTypes.ts — declarative, no panel imports
export type LayersBadgeGroup =
  | 'component'   // component/instance/sync/variant
  | 'layout'      // grid layout indicator, linked style
  | 'motion'      // animated media, motion dot, keyframe count
  | 'mask'        // mask type, mask role, adjustment stack/scope
  | 'appearance'  // blend mode / opacity, effects, object filters
  | 'media'       // animated-media frame count
  | 'email'       // mobile-hidden / desktop-hidden projection
  | 'print'       // story thread, master origin, export region
  | 'trace';      // trace-group provenance

export interface LayersPanelWorkspaceConfig {
  /** Badge groups rendered persistently. Every other group is hover/focus-revealed. */
  pinnedBadgeGroups: LayersBadgeGroup[];
  /** Row actions rendered persistently. Others reveal on hover/focus and stay in the menu. */
  pinnedRowActions: Array<'solo'>;
  /** Filters/presets shown as one-click chips in the filter bar. */
  quickFilters: LayersQuickFilter[];
  /** Placeholder for the search field. */
  searchPlaceholder: string;
}

export type LayersQuickFilter =
  | 'animated'
  | 'mobile-hidden'
  | 'threaded-text'
  | 'export-regions'
  | 'masks'
  | 'components';
```

**Runtime consumers (one per field).**

| Field | Consumer |
|---|---|
| `pinnedBadgeGroups` | `LayersRow` badge-slot `data-badge-pinned` + `layers.css` reveal rules |
| `pinnedRowActions` | `LayersRow` solo `data-row-action-pinned` + `layers.css` reveal rules |
| `quickFilters` | `LayerFilterBar` chip row (maps each preset onto one attribute dimension) |
| `searchPlaceholder` | `LayerFilterBar` input `placeholder` |

There is deliberately no `defaultFilter`: entering a workspace must not
silently change what the user is looking at, and the quick-filter chips give
the same one-click access without a hidden state change.

### 2.2 Built-in values

| Workspace | Pinned badge groups | Quick filters |
|---|---|---|
| Design | component, layout, appearance | components |
| Print | print, appearance | threaded-text, export-regions |
| Draw | mask, appearance | masks |
| Photo | mask, appearance, media | masks |
| Motion | motion | animated |
| Logo | component, appearance | components |
| Email | email, appearance | mobile-hidden |
| Codegen | component, layout | components |

Solo pinned only in Photo (the workspace where auditioning variants is the
core workflow); hover/focus-revealed elsewhere, always in the context menu.

`trace` is the one consumed group no workspace pins: a group produced by
Image Trace shows `.layers-row__trace-badge` (tooltip with mode/trace mode,
`traced artwork` in the accessible name) on hover/focus in every mode. The
vocabulary member without a pin is deliberate — pinning it in one workspace
would be emphasis without evidence.

### 2.3 Construct → data source

| Construct | Workspace | Source | Schema change? |
|---|---|---|---|
| Mobile-hidden badge/filter | Email | `doc.emailSemantics.nodes[id].hideOnMobile` | **No — projection** |
| Thread badge/filter | Print | `TextNode.storyBinding` + `doc.stories` | **No — projection** |
| Master-origin badge | Print | `masterEditId` + `doc.masters[].contentRoot` ancestry | **No — projection** |
| Export-region filter | Print | `isExportRegion(node)` | **No — projection** |
| Animated filter | Motion | keyframe counts (`computeKeyframeCounts`) + animated media assets | **No — projection** |
| Mask filter | Photo, Draw | `node.mask != null` (existing `isMasked` attribute) | **No — projection** |
| Component filter | Design, Logo, Codegen | existing `isComponent`/`isInstance` attributes | **No — projection** |
| Trace provenance badge | all (unpinned) | `GroupNode.traceMetadata` (schema 2.16) | **No — projection** |
| Blend/effects badges | Photo | existing `blendMode`, `effects` | **No — projection** |
| Non-printing flag | Print | would need `NodeBase.printExcluded` | **Yes — deferred (REQ-010)** |
| Granular locks / alpha lock | Photo, Draw | would need per-node lock flags | **Yes — deferred (REQ-011)** |

### 2.4 Mobile-hidden projection

- Badge: `hideOnMobile` → `mobile hidden` chip, `hideOnDesktop` →
  `desktop hidden`. Accessible name carries the same words.
- Filter: `attributes.mobileHidden` (email quick filter). It composes with
  search and kinds by existing AND semantics.
- The badge only renders when the document has `emailSemantics` (a design
  document never shows email chrome).

### 2.5 Motion projection

- Quick filter `animated` activates `preset: 'animated'`.
- The panel computes the animated id set once per document revision (the same
  memoized `computeKeyframeCounts` result the rows use) and passes it to the
  projection; `flattenTree` consults it only when the preset is active.
- Cost: one Set lookup per node — measured by the 1k/10k/50k benchmark.

### 2.6 Select matches

- A `Select matches` button in the filter bar (icon + text, not icon-only),
  plus a command-palette action (`layersSelectMatches`).
- Selects every id in the current filtered projection, sets `primaryId` to
  the first, and announces `N layers selected`.
- Selection is not an undo entry (editor selection is not artwork history).

---

## 3. Adopt / adapt / reject decisions

| Decision | Choice | Rationale (research) |
|---|---|---|
| Search keeps ancestry | Adopt (have) | Photoshop's filter losing parent groups is the #1 documented filter failure. |
| Multi-condition filtering | Adopt (have) | Photoshop cannot combine conditions; Varve already AND-composes labelled chips. |
| Inherited visibility distinct from direct | Adopt (have) | Photoshop's grey-eye ambiguity is a documented accessibility failure. |
| Non-printing layer flag | Adapt, schema-gated | InDesign's flag is a real professional need and is independent of visibility; but it is a document-model change and must ship with migration + export honoring. Deferred with a spec, not faked. |
| Document-wide layer concept | Reject | Incompatible with a scene tree; users already confuse InDesign's global layers with page content. |
| Articles / reading order panel | Reject (for Layers) | No model exists; belongs in its own panel. |
| Reusable block library in the tree | Reject (entry point only) | The library data model exists; browsing belongs in a Library panel. |
| Layer comps | Reject (point to Layer States) | A second snapshot system would duplicate an existing, wired surface. |
| Granular locks | Adapt, schema-gated | Krita/Procreate/Photoshop all separate edit lock from alpha lock; Varve's raster model is the right home. Deferred. |
| Reference layer | Reject | No Varve fill semantics to bind it to. |
| Hover-revealed row controls | Adapt | Procreate reveals layer actions on swipe; Varve uses hover/focus plus context menu, and always shows on touch. |
| Badge emphasis per workspace | Adopt | Photoshop's "most people don't know the filters exist" argues for showing the workspace's two or three relevant facts, not all eleven. |
| Rive "show only selected/animated" | Adapt | Proven motion pattern; implemented as the `animated` quick filter. |
| Auto-name ghost + batch rename | Adopt (have) | Name quality is the only Layers-side lever for Codegen handoff. |
| `*` expand siblings | Adopt | APG optional tree key; keyboard-only (zero clutter or discoverability cost), so the earlier "low value" rejection was outweighed by standards completeness. Implemented: `useTreeKeyboardNavigation` + `LayersTree.handleExpandSiblings`. |
| Context-menu workspace gating | Reject | No menu entry is workspace-inapplicable: every entry is already capability/state-gated on the right-clicked node. A workspace gate would be decorative configuration (invariant 9). |

---

## 4. Clutter-reduction decisions

| Control | Before | After | Still reachable via |
|---|---|---|---|
| Solo | Always visible on every row | Pinned in Photo; hover/focus-revealed elsewhere; always visible on touch | Context menu, bulk bar, command palette |
| Component/instance/sync/variant | Always | Pinned in Design/Logo/Codegen; hover/focus elsewhere | Row aria name, Inspector, context menu |
| Motion dot + keyframes | Always | Pinned in Motion; hover/focus elsewhere | Row aria name, Timeline |
| Mask type + role | Always | Pinned in Photo/Draw; hover/focus elsewhere | Row aria name, Inspector Mask section, context menu |
| Blend/opacity, effects, filters | Always | Pinned in Photo/Draw; effects stay visible when they are transfer sources | Row aria name, Inspector, effect-stack badges |
| Animated-media frame count | Always | Pinned in Photo/Motion; hover/focus elsewhere | Row aria name, Image inspector |
| Grid-layout / linked-style | Always | Pinned in Design/Logo/Codegen; hover/focus elsewhere | Tooltip, Inspector |
| Email mobile-hidden | Absent | Pinned in Email only | — (new) |
| Print thread / master origin | Absent | Pinned in Print only | — (new) |

Hover/focus revelation is CSS-only (`:hover`, `:focus-within`) with
`pointer-events: none` while hidden and `@media (hover: none)` always-visible
— no layout shift, no target-size change, no JS per row.

---

## 5. Accessibility contract

- New badges/chips: `role="img"` with `aria-label` when they are pure state;
  buttons with visible text or an accessible name when they act.
- New filter chips: toggle buttons in a labelled group (no fake listbox).
- `Select matches` is a labelled button with a tooltip; it announces the
  result through the existing live region.
- Target size: any new interactive control is ≥ 24×24 CSS px or satisfies the
  2.5.8 spacing exception.
- Contrast: no new literal colours; the workspace accent tokens already pass
  `audit:tokens`.
- Keyboard walkthrough and axe must pass on every state added here.

---

## 6. Performance contract

- Projection memoized on `[document, workspaceMode, filterSpec, animatedIds,
  expanded]` with the existing `useFlatTree` fast paths preserved.
- `flattenTree` gains at most one optional parameter; no per-row document
  scan beyond existing O(1) maps.
- Benchmarks recorded at 1k/10k/50k (`layersScaleProjection.bench.test.ts`).
  No regression beyond noise against the baseline record; the 50k
  unfiltered budget is < 60 ms.
- No projection work on canvas frames; the panel re-renders on document
  changes only.

---

## 7. Sequencing roadmap (value / risk ordered)

| Phase | Unit | Schema | Gate | Status |
|---|---|---|---|---|
| 1 | Config field + resolver consumer + badge gating + solo reveal | — | unit + E2E + screenshots | Done |
| 2 | Email mobile-hidden badge + filter | — | unit + E2E | Done |
| 3 | Motion animated quick filter | — | unit + bench | Done |
| 4 | Print thread/master/export-region badges + filters | — | unit + E2E | Done |
| 5 | Select matches (button + command) | — | unit + E2E | Done |
| 6 | Context-menu workspace gating | — | unit | Rejected — see §3 (no inapplicable entries; would be decorative config) |
| 7 | Non-printing flag (`printExcluded`) | **schema** | full gate | Deferred — specified here, not implemented |
| 8 | Alpha lock for raster layers | **schema** | full gate | Deferred — specified here, not implemented |
| 9a | Trace-group row badge | — | unit + E2E | Done (`data-badge-group="trace"`, revealed everywhere) |
| 9b | Frame/group 28×28 thumbnails | — | perf-gated | **Done** — bounded content previews, measured (see §9) |
| 10 | `*` expand-siblings key | — | unit + E2E | Done |

Phases 7 and 8 remain specified but not implemented: they require a document
version bump, migration, codec normalization, print/codegen consumers, and a
justified full-gate escalation. A turnkey checklist for both is in §10; they
are **blocked on the concurrent comic-workflow schema migration** taking
`packages/scene/src/types.ts` + `version.ts` (implementing a second migration
in the same files concurrently is prohibited by the coordination protocol).

## 8. Implementation follow-up — 2026-09-19

The closure implementation keeps one protected identity column in each row.
The label uses the available width (`flex: 1 1 0`) with a four-character floor
at the 180px minimum and an eight-character floor from 220px upward. The
secondary status cluster sizes from the badges it actually contains and is
bounded to 42% / 12rem; it no longer reserves an empty percentage-based rail.
This keeps long names readable in a wide panel while preserving the fixed
visibility, lock, solo, and disclosure targets. Indentation remains adaptive
and the real `aria-level`/drop ancestry is unchanged.

Layer details are available from the focused row, the selected-layer header
action, and the row context menu. The shared popover exposes the full name,
ancestry, direct/effective visibility and lock state, masks, component sync,
effects, object filters, and motion facts; ancestor buttons reuse selection
navigation without moving the canvas camera.

Image previews are a panel-local `images | off` preference. Turning them off
cancels pending preview work and stale asynchronous completions cannot publish
back into a row. Disclosure transfer uses a tagged compact encoding so an
explicitly empty expansion set is distinct from missing state and large sets
are not truncated by the generic panel codec.

## 9. Container previews (phase 9b, implemented 2026-09-19)

Frames and groups with drawable descendants render a bounded content layout
in the 28×28 row preview instead of the container-outline glyph
(`containerPreview.ts`):

- **Bounded**: at most 64 leaf primitives per container; a cheap
  `containerHasContent` probe (early exit, 256-node scan cap) gates the row's
  request, so an empty container keeps its type icon and never renders a
  redundant outline.
- **Parent-index mandatory**: `collectContainerPreview` takes the panel's
  `ParentIndexCache`; without it every world transform falls back to an
  O(document) parent scan. Measured on an 11 k-node document:
  **41.6 ms → 0.078 ms per container** with the cache (533×).
- **Measured scale** (`reports/layers-evolution/closure/perf/containerPreview.json`):
  10 k-child container (64-cap) 0.57 ms; 200-deep nesting 0.18 ms; 30-row
  visible window 2.34 ms; 1 000 containers 26.7 ms; empty-but-huge probe
  0.04 ms.
- **Cache identity**: the thumbnail key gains a content signature derived
  from the collected primitives (rounded), so editing a descendant
  invalidates the parent's preview without hashing the whole subtree.
- **Documented simplifications**: axis-aligned bounds (transformed AABB for
  rotated children), solid fills only (gradient/image fills use the theme
  placeholder ink), live-boolean nodes contribute nothing, absolute position
  inside the container is not part of the preview (normalized to the content
  union, aspect preserved and centered).

Evidence: `containerPreview.test.ts` (10 tests), the bench block above, and
the E2E "container rows with content render a bounded content preview"
(`layers-panel-real-world.spec.ts`) with capture
`reports/layers-evolution/after/container-preview-rows.png`.

## 10. Schema checklist (phases 7–8, blocked)

Both changes are additive, optional node fields. They are **blocked on the
concurrent comic-workflow migration** owning `types.ts` + `version.ts`; run
this list only after that work commits and the files are clean.

Common steps:

1. `packages/scene/src/version.ts`: bump `CURRENT_SCHEMA_VERSION`; add the
   normalizer (omit/`false` for the default; strip `false` on write so old
   and new documents canonicalize identically) following the `traceMetadata`
   v2.16 precedent.
2. `packages/scene/src/types.ts`: add the optional field to `NodeBase`.
3. `packages/scene/src/version.test.ts`: migration round-trip (old document
   loads, new field survives serialize→parse→serialize byte-stable).
4. Undo: toggles go through the standard `updateNode` transaction (one entry
   per action; no-op when unchanged).
5. Layers surface: badge group (`print` / `mask`), quick filter, context-menu
   item with state-aware label, and the row's accessible name.
6. Full gate: `VARVE_FULL_GATE_REASON` stating the schema migration; include
   the cross-version load test and import/export checks.

Phase 7 — non-printing (`NodeBase.printExcluded?: boolean`):

- Print/PDF export skips the node (and its subtree) in the print IR; canvas
  rendering is unchanged.
- SVG export and codegen follow the print policy; the decision is recorded in
  the print spec, not in Layers.
- Print workspace: `non-printing` quick filter + badge; no canvas dimming in
  v1 (an intentional scope cut, not an omission).

Phase 8 — alpha lock (`NodeBase.alphaLock?: boolean`, raster-capable kinds):

- The paint pipeline confines strokes to existing non-transparent pixels;
  the kernel change lives with the raster/paint owner, not the panel.
- Inspector toggle is owned by the Inspector agent — coordinate before
  touching `components/Inspector/**`.
- Draw/Photo badge + filter; eraser behavior is explicitly unchanged.
