# Layers Panel — Workspace-Evolution Audit (2026-09-19)

Baseline: committed `master`, plus a capture harness at
`tests/e2e/layers/layers-workspace-evolution.spec.ts`. Evidence:
`reports/layers-evolution/baseline/` (screenshots, `matrix/metrics.json`,
`scale/perf.json`, `perf/projection.json`).

Research inputs: `docs/research/layers-panel-research.md`.

---

## 1. Feature matrix — current panel × workspace

Legend: **Y** = works; **P** = partial; **—** = absent. "Workspace-aware"
means the behavior differs by `state.workspaceMode`; the panel's only such
branch today is which surface (page vs design canvas) the tree walks.

| Capability | Design | Print | Draw | Photo | Motion | Logo | Email | Codegen | Workspace-aware |
|---|---|---|---|---|---|---|---|---|---|
| Virtualized APG tree (`aria-level/posinset/setsize`) | Y | Y | Y | Y | Y | Y | Y | Y | — |
| Roving tabindex, arrows/Home/End/Enter/Space | Y | Y | Y | Y | Y | Y | Y | Y | — |
| Type-ahead (500 ms) | Y | Y | Y | Y | Y | Y | Y | Y | — |
| Multi-select, Shift/Ctrl ranges, Ctrl+A, scrub | Y | Y | Y | Y | Y | Y | Y | Y | — |
| Inline rename (F2, Tab-cycle, ghost auto-name) | Y | Y | Y | Y | Y | Y | Y | Y | — |
| Batch rename dialog (find/replace, regex, scope) | Y | Y | Y | Y | Y | Y | Y | Y | — |
| Drag reorder/reparent, auto-expand, auto-scroll | Y | Y | Y | Y | Y | Y | Y | Y | — |
| Non-drag reparent (`Ctrl+Alt+[`/`]`, context menu) | Y | Y | Y | Y | Y | Y | Y | Y | — |
| Mask release on reparent | Y | Y | Y | Y | Y | Y | Y | Y | — |
| Visibility/lock + effective (inherited) state | Y | Y | Y | Y | Y | Y | Y | Y | — |
| Solo | Y | Y | Y | Y | Y | Y | Y | Y | — |
| Collapse all / others / isolation | Y | Y | Y | Y | Y | Y | Y | Y | — |
| Search + kind/attribute/blend filters (AND) | Y | Y | Y | Y | Y | Y | Y | Y | — |
| Search keeps ancestor chain and reveals matches | Y | Y | Y | Y | Y | Y | Y | Y | — |
| "Select all matches" action | — | — | — | — | — | — | — | — | — |
| 28×28 thumbnails (image fills) | Y | Y | Y | Y | Y | Y | Y | Y | — |
| Colour tags + canvas colour cue | Y | Y | Y | Y | Y | Y | Y | Y | — |
| Components / instances / sync / variant badges | Y | Y | Y | Y | Y | Y | Y | Y | — |
| Component publish from tree | Y | Y | Y | Y | Y | Y | Y | Y | — |
| Effect-stack transfer badges | Y | Y | Y | Y | Y | Y | Y | Y | — |
| Adjustment-stack + scope badges | Y | Y | Y | Y | Y | Y | Y | Y | — |
| Mask type + mask-role badges | Y | Y | Y | Y | Y | Y | Y | Y | — |
| Motion dot + keyframe count | Y | Y | Y | Y | Y | Y | Y | Y | — |
| Animated-media frame badge | Y | Y | Y | Y | Y | Y | Y | Y | — |
| Selection sets (bottom section) | Y | Y | Y | Y | Y | Y | Y | Y | — |
| Layer states capture/apply | Y | Y | Y | Y | Y | Y | Y | Y | — |
| Text-thread (story) indication | — | — | — | — | — | — | — | — | — |
| Master-page origin indication | — | — | — | — | — | — | — | — | — |
| Non-printing flag | — | — | — | — | — | — | — | — | — |
| Email mobile-hidden indication | — | — | — | — | — | — | — | — | — |
| Trace-group indication in row | Y | Y | Y | Y | Y | Y | Y | Y | — |
| Workspace default filter / presets | — | — | — | — | — | — | — | — | — |
| Workspace-controlled badges / row actions | — | — | — | — | — | — | — | — | — |

**Deferred items from `docs/plans/layers-panel-deferred.md` and their status
this pass:** canvas-side isolation (closed), cross-page drag (open, still a
product decision), paint-order `order` field (open, sync architecture), Rust
hierarchy mirror (out of scope), library panel (open), diff-duplication (fixed),
long-jump focus retry (fixed), screen-reader walkthrough (partially closed).

---

## 2. UX defects found in the baseline

**AUD-001 — The panel is workspace-blind (highest-value gap).**
`reports/layers-evolution/baseline/matrix/metrics.json` is byte-identical for
all eight workspaces: row height 38 px, min-height 34 px, icon 16 px,
disclosure 24 px, filter chips 1, header actions 4. The only
`workspaceMode` reads under `components/LayersPanel/` are the page/design
surface split (`index.tsx:154`, `LayersTree.tsx:543/546/989/1049`,
`useTreeKeyboardNavigation.ts:24/58/247/297`). Nothing consults
`getEffectiveWorkspaceConfig`. Consequence: a Photo user sees no blend/mask
emphasis beyond generic badges; an Email user sees no mobile-hidden state; a
Motion user cannot filter to animated layers; a Print user sees no
thread/master structure. (Synthesis table rows: mobile-hidden badge, motion
"show only animated", thread badge, print structure.)

**AUD-002 — Three persistent controls on every row, always.**
`LayersRow.tsx` renders visibility, lock, and solo buttons unconditionally
(`persistentRowControls` 48–51 in the matrix captures). At the 288 px default
panel width this forces names to truncate at ~11 characters — the baseline
screenshots show `Cover photog…`, `Headline — f…`, `Guides (non…`. The solo
star is a motion/photo/draw concept, not a Design or Codegen one.
(Research: Photoshop's layer-filter discoverability and icon-overload
complaints; Procreate reveals layer actions on swipe.)

**AUD-003 — Badge explosion with no workspace emphasis.**
`LayersRow.tsx:570-760` conditionally renders up to 11 badge kinds in one
cluster (animated media, grid layout, linked style, instance, sync, variant,
adjustment type, adjustment scope, motion dot, keyframe count, mask type,
mask role, blend/opacity, effects, object filters). Every badge is computed for
every row in every workspace. There is no priority or workspace filter.

**AUD-004 — Search narrows but cannot be acted on.**
Search/filter reveal matches with their ancestry (correct, Figma-like), but
there is no "select all matches" action; a user who filters to 40 locked
layers must still multi-select them by hand. (Synthesis: "Search must reveal +
select".)

**AUD-005 — Email mobile-hidden state exists in the scene and is invisible.**
`EmailSemanticMetadata.hideOnMobile` (`packages/scene/src/emailTypes.ts:119`)
is consumed by `email-compiler.ts:285` and emitted as `mobile-hide`
(`email-html.ts:816`). `grep -rn emailSemantics
packages/editor/src/components/LayersPanel/` → 0 hits. A designer cannot see
or filter the one email-specific layer property that changes the delivered
message. (Synthesis: "Mobile-hidden badge + filter".)

**AUD-006 — Print text threads are invisible in the tree.**
`TextNode.storyBinding` (`packages/scene/src/types.ts`) and `Document.stories`
are used by rendering (`sceneCompositing.ts:211`), missing-font handling
(`documentFontUsage.ts:206`) and page duplication, but not by the panel.
(Synthesis: "Text threads / stories".)

**AUD-007 — Master-page content has no origin indication.**
`useFlatTree.ts:369` supports walking a master's `contentRoot` via
`masterEditId`, but rows carry no indication that they are master content, and
the Print rail stacks `MasterPanel`/`PagesPanel`/`SpreadSettings` above the
Layers panel (Shell.tsx:703-708), pushing the tree below the fold in the
baseline Print screenshot. (Research: InDesign's parent-page visibility
problem, which users consistently misread.)

**AUD-008 — No non-drag path for *bulk* visibility/lock across filter matches.**
The context menu covers a selection; there is no way to act on "all 300
hidden layers" other than selecting them all after a filter (blocked by
AUD-004). Not a WCAG failure (a path exists) but the professional workflow
Photoshop's "Not Visible" filter supports has no equivalent.

**AUD-009 — Blend-mode and effect labels clip or vanish on narrow rails.**
Reported by the maintainer during this pass and confirmed in the baseline:
`.layers-row__badges` (`flex: 0 9999 auto; overflow: hidden`) clips its
children, and the children were mostly `flex-shrink: 0` — so a
blend/opacity chip or an Object-Filter chip was cut mid-glyph with no
ellipsis. At the documented 180px minimum the whole cluster shrank to zero
width: the labels disappeared entirely
(`reports/layers-evolution/baseline/matrix/` and the min-width capture
written by `tests/e2e/layers/layers-row-badge-overflow.spec.ts`).
The effect badge's label was raw text nodes inside an `inline-flex` button, so
`text-overflow` could not apply to it at all. Neither chip had a tooltip; the
row's accessible name did not state blend mode, opacity, effect count, or
filter count. Resolved by IMPL-008 (see the plan file) with the
capacity rules now in the spec §1.2.

---

## 3. Performance findings (baseline)

Data layer, `reports/layers-evolution/baseline/perf/projection.json`
(best-of-3, `flattenTree`):

| Nodes | Unfiltered | Search | Kind filter |
|---|---|---|---|
| 1k | 1.51 ms | 0.67 ms | 1.84 ms |
| 10k | 5.89 ms | 3.50 ms | 5.84 ms |
| 50k | 48.51 ms | 30.21 ms | 40.55 ms |

The 50k unfiltered projection is 48.5 ms — already close to a frame budget if
it ever ran per canvas frame. Any workspace projection added by this pass must
therefore be *memoized on document + workspace + filter*, never recomputed per
frame, and must not add a per-row document scan.

Browser interaction budget, `reports/layers-evolution/baseline/scale/perf.json`
(1k nodes, Playwright-driven, includes test-runner and animation-frame
overhead — the value is the before/after comparison, not the absolute):

| Measurement | Baseline |
|---|---|
| Import 1k SVG | 3 480 ms |
| First tree paint | 182 ms |
| Select one row | 1 636 ms |
| Expand subtree | 859 ms |
| Scroll 20 wheel steps | 3 073 ms |
| Deep nesting rows (24 levels) | 14 (clipped by the panel viewport) |

No O(n²) behavior was observed in flatten/filter; the panel's existing
incremental search-index patch and `precomputedDiff` are the right foundation.

---

## 4. Hardcoded values and one-off controls

| Finding | Evidence | Disposition |
|---|---|---|
| `layers.css` contains 89 raw `px` literals | `packages/editor/src/components/LayersPanel/layers.css` | Sampled: 1px borders, 2px focus outlines, 3px indent guides, small geometry. Structural pixels are acceptable; spacing values that map to `--space-*` should be migrated opportunistically. **No hex colours** (the only match is a comment). |
| Row type icon sizes are literals in TSX (`size={16}`, `size="0.85em"`) | `LayersRow.tsx` | Keep (icon sizing is a prop API, not a token consumer); new controls must use the same convention as neighbours. |
| `THUMB_W/H = 28` literal | `useThumbnail.ts:24-25` | Documented 28×28 node profile per `thumbnail-system.md`; keep. |
| Solo star, colour-tag picker, filter chips are panel-local one-offs | `LayersRow.tsx`, `LayerColorTagPicker.tsx`, `LayerFilterBar.tsx` | The chips already use `@varve/ui` buttons. The colour picker duplicates the Inspector's swatch vocabulary but with layer-tag semantics; leave as panel-local, note in spec. |
| Filter bar advanced group is collapsed by default | `LayerFilterBar.tsx` | Baseline screenshot shows a single filter icon button; the advanced chips are one click away. Keep, but workspace presets must be visible without opening the group. |

---

## 5. Clutter inventory

Counted from the baseline Print/Design captures at the default 288 px width.

| Control | Location | Frequency | Needed how often | Disposition |
|---|---|---|---|---|
| Drag handle | Row left | Every row (16+) | Occasionally | Keep, but it is already `aria-hidden` + `tabIndex=-1` (pointer affordance only); non-drag path exists. |
| Disclosure | Containers only | ~5 per screen | Often | Keep. |
| Selection dot | Selected rows | Occasional | Keep. |
| 28×28 thumbnail | Image-filled shapes | Occasional | **Extend**: currently only image shapes; frames would benefit in Photo/Design (documented thumbnail profile). Deferred (perf). |
| Type icon | Every row | Always | Keep (target for zoom). |
| Name + ghost name | Every row | Always | Keep. |
| Adjustment summary chip | Adjustment rows | Occasional | Keep. |
| Animated-media badge | Animated image rows | Rare | Reveal on hover/focus where workspace ≠ Motion/Photo. |
| Grid-layout indicator | Grid frames | Occasional | Reveal on hover/focus where workspace ≠ Design. |
| Linked-style indicator | Styled rows | Occasional | Reveal on hover/focus where workspace ≠ Design/Logo. |
| Instance / variant / sync badges | Component rows | Often in Design | Keep in Design/Logo; collapse into one badge elsewhere. |
| Adjustment + scope badges | Adjustment rows | Photo-heavy | Keep in Photo; hover-reveal elsewhere. |
| Motion dot + keyframe count | Animated rows | Motion-heavy | Keep in Motion; hover-reveal elsewhere. |
| Mask type + mask role | Masked rows | Photo/Draw-heavy | Keep in Photo/Draw; hover-reveal elsewhere. |
| Blend/opacity badge | Non-normal rows | Photo-heavy | Keep in Photo; hover-reveal elsewhere. |
| Effects / object-filter badges | Rows with stacks | Occasional | Keep when present (they are actionable transfer sources) but they are the widest badge; allow truncation. |
| Visibility toggle | Every row | Very often | Keep always. |
| Lock toggle | Every row | Often | Keep always. |
| Solo toggle | Every row | Rarely | **Hover/focus-reveal** outside workspaces that configure it persistent; always visible on touch devices; always in the context menu. |
| Bulk bar | ≥2 selected | Occasional | Keep. |
| Selection sets | Panel bottom | Rarely | Keep (collapsed by default). |

**Where hidden functions still live (contract for this pass):** every
hover-revealed row control remains reachable by
(a) hovering or keyboard-focusing within the row, (b) the row context menu,
(c) the bulk bar for multi-selection, and (d) the command palette where a
command exists. Touch devices always show the controls (`@media (hover: none)`).

---

## 6. Accessibility defects

| Check | State | Evidence / gap |
|---|---|---|
| APG roles/level/setsize/posinset | Pass | `LayersRow.tsx` declares them explicitly; `tests/e2e/layers/axe.spec.ts` runs axe. |
| Roving tabindex + one tab stop | Pass | `useTreeKeyboardNavigation`, `useTreeFocus`. |
| Type-ahead | Pass | `useTypeAhead` + E2E. |
| Non-drag reorder/reparent (2.5.7) | Pass | Keyboard move + context menu; `layerIndentPlan.test.ts`. |
| Live-region announcements for moves | Pass | `announce(describeDrop(...))` in `useLayersDnD.ts`. |
| Target size 24×24 (2.5.8) | Pass for existing toggles (24 px measured) | Any new chip/badge action must meet it or use the spacing exception. |
| Focus not obscured (2.4.11) | Pass | `scrollToIndex` reveals the focused row; drop indicators are pseudo-elements. |
| `*` expand-siblings (APG optional) | Pass | Expands closed siblings at the focused level without moving focus or creating history. |
| Physical screen-reader session | **Absent** | Cannot be claimed; noted in `layers-panel-deferred.md` and repeated in the spec. |
| Reduced-motion | Pass | Existing E2E covers it. |

**No WCAG failure was found in the baseline.** The accessibility work in this
pass is therefore regression protection (axe + keyboard walkthrough on new
surfaces), not defect repair.

---

## 7. Missing frontend — scene capability with no panel surface

| Scene capability | Panel surface | Evidence |
|---|---|---|
| `EmailSemanticMetadata.hideOnMobile/hideOnDesktop` | row badges + filters | `emailTypes.ts:119`, `LayersRow.tsx`, `layerFilterTypes.ts` |
| `TextNode.storyBinding` + `Document.stories` | threaded-text badge + filter | `types.ts`, `LayersRow.tsx`, `layerFilterTypes.ts` |
| `FrameNode.frameRole === 'exportRegion'` | type icon only, no filter | `layerPresentation.ts` maps it to `export-region` |
| `GroupNode.traceMetadata` | revealed provenance badge + context action | `LayersRow.tsx`, `layerContextMenu.ts` |
| `Document.masters` + `masterEditId` | tree can edit a master, no origin badge | `useFlatTree.ts:369` |
| `AdjustmentNode.scope` | badge exists (`layer-row__scope-badge`) | `LayersRow.tsx` |
| `NodeBase.mask` | badge + role chips exist | `LayersRow.tsx` |
| Motion tracks | dot + keyframe badge exist, no filter | `LayersRow.tsx`, `computeKeyframeCounts` |
| Layer previews for frames/groups | image fills only; preference can disable generation | `useThumbnail.ts`, `LayersRow.tsx` |

No UI was found that is wired to nothing inside the panel (the orphaned
`PageStrip.tsx` and `fuzzySearch.ts` were already removed by earlier passes).

---

## 8. Honest scoping — Layers panel vs adjacent panels

| Concern | Belongs in | Why |
|---|---|---|
| Page management, master pages, spreads | Page Nav + MasterPanel (already mounted above the tree in the Print rail) | Already exists; duplicating it inside the tree would repeat InDesign's layers/pages confusion. The tree should only *badge* origin. |
| Reading/export order (InDesign Articles) | Its own panel + document model | No Varve model exists; a tree-only imitation would be dishonest. Rejected. |
| Threaded-story editing (continue story, overflow) | Canvas tools + a Story/Text panel | The tree can badge a thread; editing flows across frames is a text-tool concern. |
| Asset links/status (InDesign Links) | Resources/Library panel | Assets already have a panel; the tree should not grow a second link list. |
| Email block library | Resources/Library panel | `packages/scene/src/library.ts` exists; a browse UI is panel-sized work, not a tree feature. Entry point from the tree is acceptable. |
| Timeline tracks | Timeline panel (already exists) | The tree only indicates animated state and offers a filter preset. |
| Layer comps | Existing Layer States surface | Do not build a second snapshot system. |
| Adjustment/mask parameters | Inspector | The tree badges, the Inspector edits. |

---

## 9. Audit conclusions → requirements

| Requirement | Resolves | Priority |
|---|---|---|
| REQ-001 A single `layersPanel` workspace configuration, resolved through `getEffectiveWorkspaceConfig`, with a runtime consumer for every field | AUD-001 | P1 |
| REQ-002 Workspace badge selection: only the workspace's primary badge groups render persistently; others appear on hover/focus and remain in aria names | AUD-002, AUD-003 | P1 |
| REQ-003 Solo is hover/focus-revealed where not configured persistent; always visible on touch; context menu unchanged | AUD-002 | P1 |
| REQ-004 Email mobile-hidden badge + filter, projected from `emailSemantics` | AUD-005 | P1 |
| REQ-005 Motion "Animated only" preset filter | AUD-001, synthesis | P1 |
| REQ-006 Print thread badge + threaded-text filter; master-origin indication where a master is being edited | AUD-006, AUD-007 | P2 |
| REQ-007 "Select matches" action for the active filter/search | AUD-004, AUD-008 | P1 |
| REQ-008 Performance: projection memoized on document/workspace/filter; benchmarked at 1k/10k/50k; no regression against baseline | §3 | P1 |
| REQ-009 Validation: unit tests, E2E (badges, preset, select-matches, hover reveal, axe), before/after screenshots, benchmark record | all | P1 |
| REQ-014 Appearance labels (blend/opacity, layer effects, object filters) ellipsize with their full value in a tooltip and the row's accessible name; a readable minimum width at the 180px panel minimum; capacity rules documented | AUD-009 | P1 |
| REQ-010 Non-printing flag (Print) | AUD-001, synthesis | P2 — **schema change, specified and deferred** |
| REQ-011 Granular locks / alpha lock (Photo, Draw) | synthesis | P3 — schema change, deferred |
| REQ-012 Trace-group badge | §7 | P3 |
| REQ-013 Frame thumbnail previews | §5 | P3 (perf-gated) |

Schema-changing items (REQ-010, REQ-011) are specified in
`docs/design-system/layers-panel-spec.md` §7 with migrations and export
considerations, and are **not** implemented in this pass; the scene files are
dirty from another agent and a full-gate escalation would be required.

---

## Addendum — 2026-09-19 closure pass

**AUD-010 — The badge cluster collapsed to zero width on rows with long
names, clipping every badge.** Found while validating the new trace
provenance badge (IMPL-011). `.layers-row__badges` carried
`flex-shrink: 9999`; because flex shrink is proportional, a row with a long
label (a trace group's auto-name is `<file>.png trace`) let the cluster absorb
nearly all overflow until its width reached 0. Its own `overflow: hidden` then
clipped every badge inside it — including one the user had just revealed by
hover — while Playwright's `toBeVisible` still reported visible, because the
element's own box was non-empty and ancestor `overflow` clipping is not part
of that check. The documented capacity contract (spec §1.2: the name yields
before the badges) was therefore inverted in practice.

Resolved in the closure pass (final merged design): the identity column takes
the leftover row width (`flex: 1 1 0`) with container-query name floors (8ch
at ≥220px, 0 at ≤219px), and the badge cluster is content-sized
(`flex: 0 1 auto`, capped at `min(42%, 12rem)`) with a 1.5rem floor that it
yields to before the shrink:0 visibility/lock/solo toggles can move. At the
documented 180px minimum the name floor is 0 — the fixed controls plus the
cluster floor already fill the row's inner width, and any name floor pushes
the toggles past the panel edge (asserted by
`layers-row-badge-overflow.spec.ts`). Verified by computed-style diagnostics
(cluster width 0px → full chip width on a long-name row) and the 180px
overflow E2E. New requirement mapping: AUD-010 → spec §1.2 capacity rules.

Also resolved in the closure pass, without code changes:

- **REQ-012 trace badge: implemented** (`data-badge-group="trace"`; the one
  consumed badge group no workspace pins).
- **Spec §7 phase 6 (context-menu workspace gating): rejected** — every entry
  is already capability/state-gated on the right-clicked node; there is no
  workspace-inapplicable entry, so workspace gating would be decorative
  configuration (invariant 9).
- **Spec §7 phase 10 (APG `*`): implemented** with an E2E.
- **Spec §7 phase 9b (frame thumbnails): still deferred** — needs a measured
  preview cache and `useThumbnail.ts` is concurrently owned.

## Addendum — 2026-09-19 follow-up (reported wide-panel clipping)

The maintainer reported that names such as `Sakuya Ta…` and `clipboard…`
were still clipped while the panel had unused space, and that the resize
affordance no longer appeared. The remaining layout defect was the badge
cluster's percentage flex basis: `max-width: 42%` was paired with a percentage
basis, so rows with few or no badges reserved an empty status rail. The final
rule uses `flex: 0 1 auto` with the same 42% / 12rem cap; the name is
`flex: 1 1 0` with the documented 4ch/8ch floors. This restores the name
budget at widths above 220px while keeping the state controls stable.

The desktop splitter remains the existing APG separator (`Resize layers
panel`, 180–480px, pointer and keyboard controls). A new regression spec
checks both computed name width and keyboard expansion. The browser run was
queued through the heavy-task lease but cancelled while another session held
the lease, so a fresh screenshot and physical pointer trace remain pending.
