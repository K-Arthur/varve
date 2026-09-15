# Varve Layers Panel Organization and Presentation Audit

Status: implementation slice in progress
Audit date: 2026-08-31
Repository: `/home/kevina/CodingProjects/varve`

This is an evidence-backed audit and implementation record. It does not claim
that every Layers workflow or platform scenario is complete.

## Environment

| Field | Observed value |
|---|---|
| Branch | `feat/adjustment-hardening` |
| Commit | `8067c472a33da588eb94e7c38f4bf6a037ad0af5` |
| Worktree | `/home/kevina/CodingProjects/varve` |
| Initial dirty state | Existing Inspector and Layers changes; unrelated concurrent edits preserved |
| OS | Linux `cachyos-x8664`, kernel `7.2.2` |
| Node | `v22.23.2` (repository guidance documents Node 26; mismatch retained and reported) |
| pnpm | `11.9.0` |
| Rust / Cargo | `1.97.1` |
| Renderer | Browser/Vite, Canvas2D path exercised by the Layers E2E |
| Desktop/WebView | Not exercised in this slice |
| Workspace | Design during browser evidence |
| Active surface | Design Canvas 1 during browser evidence |
| Validation policy | `docs/quality/validation-strategy.md` and `scripts/quality/affected-plan.mjs` |

The worktree contained unrelated changes from concurrent work. No reset,
checkout, history rewrite, or broad formatting operation was used.

## Executive diagnosis

Varve has a real, shared Layers implementation rather than a missing panel:
the scene document owns nodes and child order, `useFlatTree` projects that
hierarchy, `LayersTree` virtualizes it, and shared editor commands mutate the
document. The panel is therefore a viable foundation.

The most important current issues are:

1. **Presentation taxonomy was split between row code and scene predicates.**
   A shape with an image fill was visually close to a vector shape, a native
   `rasterLayer` had no dedicated row classification, export regions were
   structurally frames, and component definitions could be confused with
   instances. A canonical row presentation resolver now supplies category,
   subtype, label, and icon.
2. **Masks existed in the scene model and renderer but were not consistently
   legible in Layers.** The row had an unstyled text span for mask state and a
   small source/content badge. Mask form, mode, disabled state, and inversion
   are now presented as an explicit row status; clipping source/content keeps
   its relationship marker.
3. **Layer colors were implemented as document metadata and commands but were
   visually underpowered.** The old 8px dot was easy to miss. A tag now uses a
   restrained row backdrop tint with no additional marker beside the name;
   selected rows retain their selection surface. Assignment remains through
   the existing context-menu and bulk command paths.
4. **Search was coupled to normal disclosure.** The unfiltered tree still
   respects disclosure, while filtered projection now walks collapsed branches
   temporarily, preserves the expansion set, and reports effective expansion
   to ARIA. A real Chromium workflow verifies the descendant reveal and
   restoration path.
5. **Layer States was duplicated in two visible panel surfaces.** The same
   document-backed component was rendered below Layers and in Inspector. The
   Inspector is now the sole UI owner for capture/apply/rename/delete; Layers
   remains focused on hierarchy and retains document commands through the
   shared context and existing menu routes.

The top architectural recommendation is to keep one document model, one
command/history path, one structural tree projection, and a small row
presentation contract derived from the scene. Specialist editing belongs in
Inspector, Timeline, Resources, or other registered owners and should be
opened by contextual deep links rather than duplicated in every row.

## Current-state evidence

| ID | Modality | Source | Finding | Confidence |
|---|---|---|---|---|
| E1 | Source | `packages/scene/src/types.ts`, `document.ts` | `Document.nodes`, `rootChildren`, container `children`, `components`, and `layerStates` are authoritative document data. | High |
| E2 | Source | `packages/editor/src/components/LayersPanel/useFlatTree.ts` | Flattening defines reverse paint-order display and active surface/isolation/page projection. | High |
| E3 | Source | `packages/editor/src/components/LayersPanel/LayersTree.tsx` | Virtualized rows receive sibling ARIA metadata and a mask source/content role derived from the direct parent. | High |
| E4 | Source | `packages/editor/src/components/LayersPanel/LayersRow.tsx` | Existing row included type icons, effects, motion, adjustment, component, visibility, lock, color, and mask status, but in an overloaded and partly ad-hoc presentation. | High |
| E5 | Source | `packages/scene/src/masking-system` docs and `masks.ts` | Masks support child sources, vector masks, raster masks, live mattes, clip/alpha/luminance modes, disabled state, inversion, and hide-source semantics. | High |
| E6 | Source | `packages/editor/src/components/LayersPanel/LayerStatesSection.tsx`, `Inspector/PropertiesPanel.tsx` | The same Layer States component was rendered in both Layers and Inspector. | High |
| E7 | Unit | `useFlatTree.test.ts` | Filtered descendants are projected through collapsed ancestors without mutating expansion state. | High |
| E8 | Unit | `layerPresentation.test.ts`, `LayersRow.test.tsx` | Frame/vector/raster/component/instance/adjustment/mask/color presentation is covered at the pure resolver and row levels. | High |
| E9 | Browser | `tests/e2e/layers/layers.spec.ts` | Search reveal and clear restoration passed in Chromium; layer-color assignment passed after opening the nested Color Tag menu. | High |
| E10 | Screenshot | `test-results/layers-collapsed-search-revealed.png` | Search projection preserves the group and reveals the matching descendant while normal hierarchy remains comprehensible. | High |
| E11 | Screenshot | `test-results/layers-colour-label-{light,dark,high-contrast}.png` | The old dot is gone; the tagged row uses a restrained backdrop in all three explicit themes while the selected row keeps the selection surface. | High |
| E12 | Baseline | `packages/editor/src/components/LayersPanel/__benchmarks__/layers10k.bench.test.ts` | Existing 10,000-node benchmark passed before the projection change; post-change targeted benchmark remains required in the next validation pass. | High |

## Feature ownership matrix

| Capability | Current UI owner | State owner | Command owner | Scene mutation? | Other access paths | Problems | Target owner |
|---|---|---|---|---|---|---|---|
| Hierarchy tree | `LayersTree` | editor selection + local expansion | shared editor context | no for expansion; yes for structure actions | canvas, Inspector | authoritative tree is correct but row taxonomy was split | Layers |
| Active Design Canvas / Page | Shell navigation and surface projection | `Document.activeDesignCanvasId`, page state | workspace/surface commands | sometimes | breadcrumb, canvas | must remain distinct from z-order | Surface navigation + Layers scope indicator |
| Search/filter | `LayerFilterBar`, `useFlatTree`, search index | panel-local filter | filter state update | no | command routes | old E2E class selector was stale; collapsed search needed projection | Layers |
| Rename / batch rename | row/context menu | scene node `name` | shared rename commands | yes | Inspector/name actions | batch rename preview still needs dedicated audit | Layers + command palette |
| Visibility / lock | row and bulk bar | node plus effective ancestor calculation | shared visibility/lock commands | yes | Inspector/context menu | direct vs inherited state needs more full-document coverage | Layers for navigation; Inspector for detailed editing |
| Reorder/reparent | `LayersTree` DnD and keyboard commands | scene child arrays/order keys | shared move/reparent commands | yes | context menu, command palette | cross-surface and advanced constraints remain deferred | Layers |
| Masks/clipping | row status + Inspector mask controls | node `mask`, child relationship | mask commands | yes | Inspector, context menu | old row status lacked complete styling; richer relationship visualization remains | Layers for relationship; Inspector for editing |
| Effects / object filters | row summary/badge + Inspector | node effects/filter arrays | shared stack commands | yes | context menu, Inspector | row must summarize, not become effect editor | Layers summary + Inspector editor |
| Components/instances | row status + Inspector component section | node `componentId`, document components | component commands | yes | Resources/library | old resolver treated every componentId as `component` | Layers identity + Inspector editor |
| Motion/keyframes | motion badge | document motion/timeline data | Motion commands | yes | Timeline/Motion workspace | detailed counts can be expensive in large files | Layers summary + Timeline |
| Selection Sets | `SelectionSetsSection` below Layers | `Document.selectionSets` | selection-set commands | yes | selection commands | compact companion is still below tree; ownership should be revisited after Layer States | Selection/recall surface, contextual Layers entry |
| Layer States | previously Layers and Inspector | `Document.layerStates` | layer-state commands | yes | Inspector section | duplicate visible list reduced tree space and confused ownership | Inspector only |
| Variables / Token Sync | Inspector/registered resource routes | document variable/token stores | variable/token commands | yes | Resources/design-system routes | not a Layers responsibility | Variables/design-system owner |
| Icon browsing / assets | Resources and dialogs | document assets/library | resource commands | yes | Resources, command palette | not a Layers responsibility | Resources |
| Panel detach/reattach | panel registry and drag shell | panel-local state | panel registry | no | all panels | Layers expansion/focus transfer is incomplete | shared panel-local state codec |

## Node presentation matrix

The `dataType` column keeps high-level automation compatibility. The category
and subtype are the canonical differentiation contract for row styling,
accessible text, and future filtering.

| Node / role | User-facing label | Category | Subtype | Icon policy | Container? | Mask presentation | Row priority |
|---|---|---|---|---|---|---|---|
| Frame | Frame | frame | `frame` | frame icon + frame accent | yes | attached mask status; child roles when structural mask exists | P0 |
| Export region | Export region | frame | `export-region` | slice icon; no layout semantics | structurally yes, semantically no | not a child mask container | P0 |
| Group | Group | group | `group` | folder/group icon + group accent | yes | attached mask status; source/content roles | P0 |
| Component definition | Component | component | `component-definition` | component icon + component accent | yes | attached mask status | P0 |
| Component instance | Component instance | instance | `component-instance` | component icon with instance treatment | yes | attached mask status | P0/P1 |
| Detached plain frame | Frame | frame | `frame` | frame icon | yes | ordinary frame rules | P0 |
| Vector rectangle/ellipse/polygon/star/line/arrow | Vector shape | vector | shape subtype | geometry-specific icon + vector accent | no | attached leaf mask if supported | P0 |
| Vector path | Vector path | vector | `path` | pen icon + vector accent | no | mask status if attached | P0 |
| Image-filled shape | Raster image | raster | `image-fill` | image icon + raster accent; thumbnail when available | no | alpha/raster mask status | P0 |
| Native raster layer | Raster layer | raster | `raster-layer` | image icon + raster accent | no | mask status if supported | P0 |
| Text | Text | text | `text` | text icon + text accent | no | mask status if supported | P0 |
| Adjustment | Adjustment layer | adjustment | adjustment type | adjustment icon + adjustment accent; compact stack summary | no | adjustment scope/mask status | P0/P1 |
| Table | Table | unknown | `table` | table icon | semantic container varies by model | not inferred | P0 |
| Mask source child | Existing node name + clipping source | source relationship | `source` | normal node icon plus source role pill | no additional parentage | `clipping mask source` | P1 |
| Clipped content child | Existing node name + clipped content | source relationship | `content` | normal node icon plus content role pill | no additional parentage | `clipped content` | P1 |
| Vector mask attached to node | Existing node name + vector clipping/alpha/luminance mask | node category | vector mask | mask status pill | no extra row | visible even when disabled | P1 |
| Raster mask attached to node | Existing node name + raster alpha mask | node category | raster mask | mask status pill | no extra row | visible even when disabled | P1 |
| Live matte | Existing node name + live mask | node category | live mask | mask status pill | no extra row | visible even when disabled | P1 |
| Object with effects/filters | Existing node name + summary | underlying category | effect/filter status | one compact action badge | unchanged | deep-link to Inspector | P1/P2 |
| Unknown/future node | Existing name or Layer | unknown | serialized kind | safe fallback icon and label | model-dependent | no unsafe assumptions | P0 |

## Interaction and visual-priority matrix

| Action / datum | Pointer | Keyboard | Touch/stylus | Undoable | Accessible output | Priority |
|---|---|---|---|---|---|---|
| Select row | click | arrows + documented selection keys | tap | no | `aria-selected`; row name remains concise | P0 |
| Focus row | implicit row focus | roving focus | tap/focus | no | visible focus independent of selection | P0 |
| Expand/collapse | disclosure | Left/Right/Enter policy | disclosure tap | no | `aria-expanded` | P0 |
| Search | searchbox | type and Escape/clear | text input | no | result status + ancestry | P0 |
| Color label | context submenu / bulk bar | context menu / command route | context menu route | yes | restrained row backdrop plus color name in row description and menu | P1 |
| Mask relationship | row status and source/content marker | focus/context menu | tap status | no by itself | mask form, mode, role, disabled/inverted | P1 |
| Visibility / lock | row buttons | row action mode/context route | touch target | yes | button label explains direct/effective state | P0/P1 |
| Rename | double click/context | F2, Enter, Escape, Tab | double tap | yes | input label and commit/cancel behavior | P0 |
| Reorder/reparent | row drag | move/indent/outdent commands | long-press route | yes | resolved parent and position announcement | P0 |
| Effects, animation, adjustment detail | compact badge | Enter/context/deep link | tap badge | editor-specific | action opens correct owner | P2 |
| Scroll/density/expansion | wheel/resize | keyboard where supported | drawer gesture | no | no document mutation | P1/P2 |

## Architecture decision

```text
authoritative Document
  ├─ nodes + rootChildren + container.children + components + masks
  ├─ active surface / page / isolation scope
  └─ document selection + command history
          │
          ├── structural projection: ordered ids, parent, depth, siblings,
          │                         temporary filter ancestry, effective expansion
          │
          ├── windowed row presentation: category, subtype, icon, name,
          │                              direct/effective state, mask status,
          │                              color label, accessible description
          │
          ├── Layers virtualizer → DOM tree/treeitems → canvas/Inspector sync
          │
          ├── search index/filter projection
          └── DnD resolver → validated shared hierarchy command → history

Inspector owns property/state editing and deep-linked specialist workflows.
Timeline owns keyframes. Resources owns assets/components/icons.
```

The row resolver added in this slice is
`packages/editor/src/components/LayersPanel/layerPresentation.ts`. It is
derived from scene data; it does not create UI-only hierarchy state. The row
uses `data-layer-category` and `data-layer-subtype` for styling and testing,
while `data-layer-type` retains the existing high-level automation contract.

## Decisions and rationale

### Tree versus treegrid

Keep the Layers surface as an ARIA tree. Rows are primarily hierarchical
selectable items; visibility, lock, solo, badges, and specialist actions are
contextual controls rather than independent spreadsheet columns. A treegrid
would require a complete cell-navigation model and would increase Tab/focus
cost without evidence that Layers needs independently navigable columns.

### Canonical node presentation

Use `resolveLayerPresentation(node, document)` rather than ad-hoc switches in
each row. Component definitions are recognized by a document component's
`masterRootId`; instances by `componentId`. Image-filled shape nodes and native
raster layers share the raster category but retain different subtypes. Vector
shape geometry keeps its subtype so rectangle, ellipse, path, and other shapes
remain visually and semantically distinguishable.

### Mask presentation

Masks are not promoted to synthetic tree nodes. The document's mask attachment
and child relationships remain authoritative. Layers shows a stable status pill
for layer/vector/raster/live mask form, mode, and inactive/inverted state, plus
source/content relationship markers when a container uses a child source.
Detailed editing remains in Inspector.

### Color labels

Color is an author-assigned organization label, not a node type. It therefore
gets a visually clear but subordinate row backdrop tint. No extra colored
shape is inserted beside the name: the identity lane is already dense. The
type icon and leading type rail remain independent, so color does not replace
semantic type or selection. Existing seven-color document values and command
routes are preserved.

### Selection indicator

Selection uses a restrained theme-aware row tint, a stable inset boundary, and
a leading selection rail. This keeps selection unmistakable without turning
every selected item into a saturated teal card or erasing the type icon. The
pointer/touch selection affordance changes to a check-circle only for selected
or actively inspected rows; it remains available on touch and is hidden from
the accessibility tree because the treeitem's `aria-selected` is authoritative.
High-contrast retains the stronger system selected surface, and forced-colors
falls back to system colors.

### Layer States ownership

Inspector is the sole visible owner. Layer States captures and applies
selection-dependent appearance/visibility/transform state, which is an
editing/state-management task rather than hierarchy navigation. Layers no
longer spends tree height on a second list. The same document-backed
`LayerStatesSection` and editor commands remain in use, so no data migration or
scene fork is introduced. A future contextual Layers entry may deep-link to
Inspector if user testing shows direct discovery is insufficient.

## Hypothesis review

| Starting hypothesis | Result | Evidence / consequence |
|---|---|---|
| Layers combines many unrelated utilities | Partially rejected | Selection Sets and Layer States are below Layers; Variables, Token Sync, icon browsing, and master/page navigation have separate owners in the current tree. Layer States was nevertheless duplicated and is now removed from Layers. |
| Row metadata exceeds visual hierarchy | Confirmed | Row contains type, color, thumbnail, component, adjustment, motion, mask, effects, filter, blend/opacity, presence, visibility, lock, and solo affordances. Progressive disclosure remains a follow-up slice. |
| Virtualization bounds all computation | Rejected | `useFlatTree` flattens the logical view before virtualization; expensive metadata such as motion counts and thumbnails requires further profiling. |
| All containers initially expand aggressively | Confirmed in code | `LayersTree` initializes non-empty frame/group ids expanded; a documented expansion policy and view-state scope remain required. |
| Expansion/search coupling is wrong | Confirmed and first fix implemented | Search now projects collapsed descendants temporarily and restores the unfiltered expansion set. |
| Component and instance presentation is conflated | Confirmed | Previous row resolver mapped any componentId to `component`; canonical resolver separates definition and instance when document data is available. |
| Selection has competing checkbox/ARIA semantics | Partially addressed | The pointer/touch checkbox remains available but is aria-hidden; `aria-selected` plus tree keyboard Space is the single assistive-technology selection model. Full screen-reader walkthrough remains required. |
| Tree carries treegrid-like controls | Tree decision retained | Keep tree semantics and bound secondary actions; do not change to treegrid without a full cell keyboard model. |
| Filter taxonomy is incomplete | Confirmed | Existing filter kinds omit rasterLayer, export region, masks, animation, and several category distinctions. Presentation resolver is a foundation; filter expansion remains follow-up. |
| Panel-local state survives detach safely | Partially rejected | Filter uses panel-local state, but expansion/focus/density/thumbnail preferences are not yet a complete transferable codec. |

## Implementation slice delivered

1. Collapsed-descendant search projection in `useFlatTree`, with effective
   expansion metadata and unit tests.
2. Canonical row presentation resolver for structure, vector/raster identity,
   component/instance distinction, export regions, adjustments, tables, and
   masks.
3. Row data attributes, semantic descriptions, category-based icon/rail
   styling, and explicit mask status pills.
4. Stronger layer-color backdrop treatment using the existing document
   `LayerColor` values and command paths; the redundant marker shape was
   removed from the row identity lane.
5. Refined selection treatment with a stable rail/inset boundary, a compact
   selected check-circle, and reveal-on-interaction secondary controls.
6. Layer States removed from the Layers render tree; Inspector remains the
   sole visible owner and ownership rationale is updated.
7. E2E search locator corrected to the actual shared SearchField semantic
   `searchbox`, and a real color-label workflow added.

## Validation evidence

| Command / artifact | Result |
|---|---|
| `pnpm exec vitest run packages/editor/src/components/LayersPanel --exclude '**/__benchmarks__/**' --reporter=dot` | Baseline: 23 files, 299 tests passed |
| `env VARVE_HEAVY_TASK_PARALLELISM=0 pnpm exec vitest run packages/editor/src/components/LayersPanel/__benchmarks__/layers10k.bench.test.ts --testTimeout=60000 --reporter=dot` | Baseline: 12 tests passed; drop resolver about 43.6ms total / 4.4µs per sample |
| Focused presentation/row/tree/Inspector Vitest run | 5 files, 96 tests passed after the slice |
| `tests/e2e/layers/layers.spec.ts` search descendant workflow | Chromium passed; 1 test, about 48s including startup |
| `tests/e2e/layers/layers.spec.ts` color-label workflow | Chromium passed; 1 test, about 24s including startup |
| `test-results/layers-collapsed-search-revealed.png` | Manually opened and inspected |
| `test-results/layers-colour-label-{light,dark,high-contrast}.png` | Manually opened and inspected; backdrop is visible without a marker shape and selected-row contrast remains intact |
| Full Layers Playwright baseline | Started 87 tests; first 5 accessibility tests passed, then stopped after the suite became a multi-minute run. Not a full-suite pass. |
| First targeted search E2E attempt | Failed in setup on Home with stale `.layers-panel__filter-input` selector; corrected to the actual semantic searchbox and reran successfully |

## Remaining risks and next slices

- Run the post-change 10,000-node benchmark and compare flatten, projection,
  mounted rows, metadata derivation, and memory rather than relying on the
  passing functional test.
- Audit and potentially extract expensive row metadata so thumbnails,
  timeline counts, effective state, and accessible summaries are windowed.
- Define expansion persistence scope and transfer valid expansion/focus/scroll
  state across panel detach without persisting it as document artwork.
- Repair direct versus inherited visibility/lock display and add the exact
  ancestor-reveal explanation.
- Resolve checkbox versus `aria-selected` semantics with a complete APG
  keyboard/screen-reader walkthrough.
- Expand filter taxonomy to canonical presentation categories and define safe
  filtered-view drag policy.
- Verify one canonical drop resolver for before/after/into preview, keyboard
  movement, multi-selection deduplication, invalid reasons, and Tauri input
  adapters.
- Add deterministic mixed, mask, raster, component, deep, wide, corrupt, and
  localization fixtures plus visual baselines at narrow, dark, high-DPI, and
  200% scale.
- Browser Chromium is covered for this slice. Tauri/WebKitGTK, Wayland input
  capture, touch/stylus, real screen readers, and forced-colors verification
  remain untested here.

## Residual-risk classification

| Risk | Classification | Impact | Owner / follow-up |
|---|---|---|---|
| Layer States discoverability after removal | Open UX risk | Users may look below Layers for a saved-state list | Inspector deep-link affordance/user test |
| Color backdrop contrast in unusual theme/forced-color combinations | Open visual risk | User labels may be intentionally suppressed by the OS, or a browser may differ in color-mix rendering | responsive + forced-colors screenshot slice |
| Mask chains with non-child live/vector sources | Open semantic risk | Current source/content marker applies only to direct structural child source | mask projection contract |
| Full-document metadata cost | Open performance risk | Large files may still compute more than the virtual window | profiler + 10K/50K benchmark |
| Screen-reader output | Open accessibility risk | Current tree state is improved but nested control model is not fully audited | APG + AT slice |
| Desktop drag parity | Untested platform risk | Tauri/WebKit may differ in pointer capture and context menu behavior | actual Tauri E2E |
| Existing dirty concurrent files | Integration risk | Other work may alter shared owners during this audit | re-check status/diff before commit |
