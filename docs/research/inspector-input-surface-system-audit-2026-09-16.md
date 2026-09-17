# Inspector and input-surface system audit

**Date:** 2026-09-16
**Status:** research and specification gate; implementation follows these decisions
**Repository:** `master`, `/home/kevina/CodingProjects/varve`
**Companion contract:** [`../architecture/inspector-input-surface-system.md`](../architecture/inspector-input-surface-system.md)
**Plan:** [`../plans/inspector-input-surface-system-implementation-2026-09-16.md`](../plans/inspector-input-surface-system-implementation-2026-09-16.md)

This is an evidence record, not a claim that the current Inspector is already
complete. It follows the document model and actual selection composition rather
than treating “shape”, “image”, or “mask” as sufficient categories on their own.

## 1. Coordination and baseline

The work is being performed on `master`, as requested. At the start of this
audit the branch was ahead of `origin/master`; the working tree contained
large, unrelated in-flight changes from other agents (font/native runtime,
photo tools, effects, website docs, selection infrastructure, and Inspector
subsystems). The following paths are owned by this audit until a later handoff:

- New audit, contract, plan, and ownership files named in this record.
- New non-overlapping shared input primitives and their tests.
- New audit fixtures/specs under a new path, unless a shared helper is required.

The following active paths are not silently edited by this work:
`PropertiesPanel.tsx`, `sectionRegistry.ts`, `DocumentPanel.tsx`,
`NumberField.tsx`, `FillSection.tsx`, shared disclosure/popover primitives, the
existing Design-tab audit, and website pages already listed in another
ownership record. The section-order implementation will be coordinated at the
handoff boundary because those files already have concurrent owners.

### Baseline commands and results

The repository-required planner was run before any production change:

```text
pnpm verify:plan
```

It selected the aggregate dirty-tree closure and escalated to the full-suite
reason because workspace/toolchain and validation-infrastructure files are
already dirty. That is a property of the shared working tree, not evidence that
this audit needs to change unrelated packages. The broad plan is retained for
the final integration gate; the inner loop remains bounded to owned files.

The current real-editor baseline was run with an isolated Vite/Playwright port:

```text
VARVE_E2E_PORT=1458 VARVE_E2E_WORKERS=1 \
  pnpm exec playwright test tests/e2e/inspector/design-tab-audit.spec.ts \
  --project=chromium --workers=1 --reporter=line
```

Result: **22 passed in 7.1 minutes**. The spec creates and edits a real
document, draws a rectangle, creates live text, imports a photograph, and
exercises fill, stroke, mask, crop, selection-colour, image-fit, and numeric
editing workflows. Existing console warnings about history mutations outside a
transaction were observed and are not attributed to this audit.

Rendered evidence is available under
`test-results/run-4090770-1458/` and `reports/inspector-review/`. These are
review artifacts, not clean goldens; new screenshots must be captured from
named audit scenarios and reviewed before acceptance.

## 2. Research ledger

The sources below were checked on 2026-09-16. “Type” distinguishes a normative
standard from a component recommendation, observed product behavior, or a
user-reported failure. Product behavior is evidence to interpret, not a
specification to copy.

| Source | Relevant finding | Implication for Varve | Type |
| --- | --- | --- | --- |
| [WAI-ARIA APG: Combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) | Select-only, editable, and autocomplete forms have different keyboard and value contracts; input text and committed selection are not interchangeable. Escape can close without committing a highlighted option. | Keep native `select`, select-only custom controls, editable comboboxes, searchable collections, and command menus as separate primitives. | Standard/recommendation |
| [WAI-ARIA APG: Spinbutton](https://www.w3.org/WAI/ARIA/apg/patterns/spinbutton/) | A spinbutton normally has one tab stop; arrows change value while ordinary text editing shortcuts remain available. | Numeric fields need an explicit draft/parse/commit/cancel state machine; steppers should not add unnecessary tab stops. | Standard/recommendation |
| [WAI-ARIA APG: Toolbar](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/) | Toolbars can reduce tab stops with roving focus, but arrows must not conflict with spinbuttons or text inputs. | Alignment/action clusters need an explicit toolbar contract and must not steal field editing keys. | Standard/recommendation |
| [WAI-ARIA APG patterns](https://www.w3.org/WAI/ARIA/apg/patterns/) | Listbox, menu, dialog, disclosure, slider, spinbutton, and combobox are distinct patterns. | Do not use a menu for a value list, a dialog for a lightweight popup, or a combobox where a native select is sufficient. | Standard/recommendation |
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/) and [Target Size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) | Focus must remain visible and not obscured; AA target size is 24×24 CSS px with spacing exceptions; reflow and text enlargement must preserve functionality. | Retain 32px compact fields, enforce 24px embedded actions, provide a 44px touch density, and test zoom/narrow panels/portaled overlays. | Standard |
| [WCAG 2.2: Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) | Enlarged text and narrow viewports must not become an accidental horizontal-scroll puzzle. | Use bounded label/control tracks, intentional stacking, and full-width long controls. | Standard |
| [MDN: `select`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/select) | Native select gives the platform/browser a well-understood select-only interaction. | Prefer native select for short, stable lists unless rich presentation is materially necessary. | Platform guidance |
| [MDN: number input](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/number) | Number inputs have spinbutton semantics and browser/platform formatting; they are not universal for expressions or specialised scrubbing. | Use an explicit text/draft contract for document units and expressions; do not rely on browser defaults for geometry. | Platform guidance |
| [MDN: `inputmode`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inputmode) | `inputmode` is a virtual-keyboard hint, not validation. | It cannot replace parsing and must not remove minus signs or expression characters needed by touch editing. | Platform guidance |
| [MDN: Popover API](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API) and [Using popovers](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API/Using) | Popover is non-modal/top-layer; dialog is the modal primitive. Top-layer placement helps clipping but nested/fallback behavior still needs testing. | Keep semantic overlay families separate and test portals in scrolled/transformed inspector layouts. | Platform guidance |
| [React Spectrum ComboBox](https://react-spectrum.adobe.com/ComboBox) | Labels are visible or explicitly supplied; option groups need headings; interactive elements should not be nested inside option rows. | Keep option rows selectable/readable, with icons and secondary copy as presentation. | Design-system recommendation |
| [React Aria NumberField](https://react-spectrum.adobe.com/react-aria/useNumberField.html) | Number behavior is separated from presentation and supports locale-aware formatting and steppers. | Separate value math/commit policy from field chrome. | Design-system recommendation |
| [Fluent UI Combobox](https://learn.microsoft.com/en-us/fluent-ui/web-components/components/combobox) | Select and suggestion/filtering modes are distinct. | Searchable property lists must not masquerade as simple dropdowns; filtering preserves committed value. | Design-system recommendation |
| [Fluent UI high contrast](https://learn.microsoft.com/en-us/fluent-ui/web-components/design-system/high-contrast) | Forced-colors needs explicit focus, disabled, selected, and boundary styling; opacity alone is unreliable. | Do not communicate read-only/disabled/mixed state only through opacity. | Design-system recommendation |
| [Carbon number input accessibility](https://carbondesignsystem.com/components/number-input/accessibility/) and [usage](https://carbondesignsystem.com/components/number-input/usage/) | One tab stop is preferred; stepper buttons need not be tab stops; number inputs are for bounded increments, not every continuous variable. | Keep direct typing/arrows/optional scrubbing; use sliders for continuous ranges and one undo transaction per gesture. | Design-system recommendation |
| [Carbon dropdown accessibility](https://carbondesignsystem.com/components/dropdown/accessibility/) and [usage](https://carbondesignsystem.com/components/dropdown/usage/) | Dropdown and combo/filter behavior differ; long labels need readable overflow treatment. | Search large lists, keep duplicate labels distinguishable, and do not commit the query as the value by accident. | Design-system recommendation |
| [Apple HIG: Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers/) | Popovers are small temporary tasks, not a hiding place for large functionality. | Keep advanced editors focused and anchored while leaving primary state discoverable in the Inspector. | Design-system guidance |
| [Penpot interface tour](https://help.penpot.app/user-guide/first-steps/the-interface/) and [sidebar update](https://community.penpot.app/t/penpot-2-12-is-here-jingle-bell-rock/10161) | Properties are contextual to the selected element; optional properties are grouped/collapsed. | Use selection-aware availability and durable collapse without hiding primary context. | Observed product behavior |
| [Figma text properties](https://help.figma.com/hc/en-us/articles/360039956634-Explore-text-properties), [text guide](https://help.figma.com/hc/en-us/articles/360039956434-Guide-to-text-in-Figma-Design), and [layer properties](https://help.figma.com/hc/en-us/articles/26584819173271-Layers-101-Get-started-with-layers) | Text properties are grouped in Typography; the right panel follows the current selection and exposes common position/layout/appearance properties. | Selected text should promote Typography rather than placing it after generic Appearance. | Observed behavior/first-party guidance |
| [Adobe Photoshop workspace](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/workspace-overview.html) and [panels](https://helpx.adobe.com/photoshop/using/panels-menus.html) | Contextual panels follow tool/selection; values can be typed, scrubbed, or changed with arrows. | Preserve dense editing, but make the interaction mode visible/cancellable and do not auto-open every advanced surface. | Observed product behavior |
| [Blender Properties editor](https://docs.blender.org/manual/id/4.5/editors/properties_editor.html) and [addon-tab complaint](https://devtalk.blender.org/t/a-scroller-for-the-properties-side-panel/14869) | Context-sensitive properties/search reduce irrelevant tabs, but large addon/tab collections become hard to browse. | Visibility gating needs recovery/search; “hide everything” is not clutter reduction. | Observed behavior/user complaint |
| [Adobe properties-panel bug](https://community.adobe.com/bugs/p-properties-panel-not-showing-shape-properties-anymore-old-bug-is-back) and [type-layer scrollbar complaint](https://community.adobe.com/t5/photoshop-ecosystem-bugs/properties-panel-for-a-type-layer-shows-only-two-property-sections-when-expanded) | Users report wrong/missing properties and sections becoming unreachable. | Every selection type needs a reachability scenario and shared availability predicate. | User-reported failure |
| [Blender numeric complaint](https://developer.blender.org/T37453) and [user discussion](https://blenderartists.org/t/new-changes-to-numeric-input-are-hard-to-use/598450) | Users report unpredictable scrub acceleration and ambiguity between clicking to type and dragging. | Scrubbing needs explicit affordance, non-drag editing, stable modifier rebasing, cancellation, and one undo transaction. | User-reported failure |
| [Figma UI3 feedback](https://forum.figma.com/share-your-feedback-26/ui3-feedback-3058/index2.html?tid=3058&fid=26) and [properties-panel complaint](https://forum.figma.com/t/most-functionality-removed-from-inspect-properties-panel-now-that-dev-mode-is-out-of-beta/63492) | Moving/hiding familiar functionality without recovery caused findability complaints; floating panels can obscure work. | Keep Inspector docked by default, make hidden sections recoverable, and promote context without silently deleting capability. | User-reported failure |

### Decisions where sources disagree

1. **Native select versus custom select:** use native select for short stable
   select-only lists; use the existing custom `Select` only for rich options or
   collision-aware presentation; use `Combobox` for filtering/editing.
2. **Compact height versus touch target:** keep 32px visual desktop fields,
   enforce 24px embedded actions, and switch to 44px touch targets without
   changing semantics or keyboard behavior.
3. **Scrubbing versus text editing:** retain scrubbing as an explicit label or
   handle affordance, keep the input a normal text-editing surface, and provide
   keyboard/direct-entry alternatives.
4. **Hide versus disable:** hide a whole section with no capability; keep an
   unavailable reference only when its reason makes the action discoverable;
   expose that reason to assistive technology.

## 3. Repository and usage inventory

### Existing boundaries

Varve already has a shared `@varve/ui` package exporting `Field`, `Input`,
`InputGroup`, `NumberInput`, `NativeSelect`, `Select`, `Combobox`, `MultiSelect`,
`SearchField`, `TextArea`, `Slider`, `SegmentedControl`, `Checkbox`, `Switch`,
`Popover`, `Menu`, `Disclosure`, and related overlay primitives. Tokens define
compact/default/large heights of 32/40/48px, a 24px compact target minimum, a
44px touch minimum, semantic gaps, and three themes. The correct direction is
to extend and rationalize this system, not add a parallel Inspector library.

The editor has specialized `FieldRow` and `NumberField` controls because they
own document transactions, mixed values, label scrubbing, and selection-aware
mutation. That specialization is justified; its field chrome and state
contract must align with `@varve/ui` instead of drifting independently.

### Search-based inventory

These are `rg` file counts over `packages/editor`, `packages/ui`, and
`packages/home`; tests, stories, imports, and examples may be included, so
they are discovery signals rather than unique-control counts.

| Search surface | Files |
| --- | ---: |
| `input` | 310 |
| `select` | 565 |
| `textarea` | 31 |
| `contentEditable` | 3 |
| `type="number"` | 41 |
| `role="combobox"` | 11 |
| `role="listbox"` | 23 |
| shared `Select` references | 448 |
| editor `NumberField` references | 44 |
| editor `FieldRow` references | 38 |
| `DisclosureSection` references | 63 |
| `Popover` references | 31 |

### Component inventory and disposition

| Component | Location | Current responsibility | Risk/defect | Decision |
| --- | --- | --- | --- | --- |
| Field/Label/Description/Error | `packages/ui/src/components/Field.tsx` | Composable names, descriptions, errors, column/row form layout | Does not define Inspector mixed values or scrub semantics | Keep as form foundation; add an Inspector adapter |
| Input/TextArea | `packages/ui/src/components/` | Native text editing and helper/error states | Consumer geometry must stay token-driven | Keep and test through shared shell |
| NativeSelect | `packages/ui/src/components/NativeSelect.tsx` | Short platform-like select-only choice | Appearance varies by platform; no rich rows | Keep for simple lists |
| Select | `packages/ui/src/components/Select.tsx` | Rich select-only popup | Selected/active/disabled reason and placement need full coverage | Keep as canonical rich select |
| Combobox/MultiSelect | `packages/ui/src/components/` | Editable/filterable/multi-value popup | Query versus committed value, IME, async races, long values | Keep and harden contract |
| NumberInput | `packages/ui/src/components/NumberInput.tsx` | Settings/dialog numeric editing and scrub | No document undo/mixed/unit semantics | Keep for settings; not a replacement for Inspector field |
| NumberField | `packages/editor/src/components/Inspector/controls/NumberField.tsx` | Document draft/commit, spinbutton, scrub, wheel, undo, mixed values | Local CSS/consumer variations; concurrent owner | Preserve semantics; unify field shell in coordination |
| RangeValueControl/Slider | editor controls + UI | Continuous exploration plus precision in some cases | Slider-only exact values are inaccessible | Pair with exact field for stored continuous values |
| Color picker/swatch | `packages/ui` + Inspector popovers | Rich colour editing | Mixed/bound/overlay states differ | Keep picker; standardize trigger and state |
| FieldRow/InspectorFieldGroup | Inspector controls/CSS | Label/control grid and pairs | Raw inputs/local flex/grid still occur | Keep as Inspector layout adapter and migrate consumers |
| Disclosure/Popover/Menu | UI and Inspector | Section state and overlays | Focus, clipping, nested dismissal, semantic drift | Keep; test by semantic family |

### Rendered baseline evidence

The real-editor audit at 1440×900 reported:

| Selection | Visible sections | Expanded | Scroll/client height | Geometry |
| --- | ---: | ---: | ---: | --- |
| Imported image | 21 | 14 | 4569/665px | 32px inputs, 12px labels, 13px values |
| Live text | 17 | 5 | 5084/665px | 32px inputs, 12px labels, 13px values |
| Rectangle | 12 | 0 | 2533/665px | 32px inputs, 12px labels, 13px values |
| Frame | 14 | 1 | 3140/665px | 32px inputs, 12px labels, 13px values |

No row overflow, sub-24px target, or truncated label was found in these four
scenarios after recent repairs. This does not cover high zoom, forced colors,
IME, touch, raster layers, tables, adjustment nodes, async lists, or every
selection branch.

The rendered text screenshot at
`test-results/run-4090770-1458/inspector-design-tab-audit-3e21c--keeps-its-controls-legible-chromium/design-tab-text-default.png`
shows the current selected-text order:

```text
Align & Distribute → Position & Size → Appearance → Typography
```

This is the principal IA defect. Typography is the primary task for text and
must be the first selection-specific section after the contextual action band;
its advanced subsections can remain collapsed.

## 4. Document-model coverage and selection matrix

The scene model has no standalone `ImageNode`: an image is a `ShapeNode` with
image paint (possibly `shapeless`). Masks are properties on containers or leaf
shapes, not one node kind. Availability and ordering must use capability
predicates rather than labels.

| Selection/context | Primary content | Secondary/advanced content | Hidden or prohibited |
| --- | --- | --- | --- |
| No selection/document | Document/page, canvas background, grid/snap, saved Layer States | Print/export context, collapsed Isometric Grid, useful insights | Object geometry/fill/stroke/typography |
| Rectangle/rounded rectangle | Position & Size, Corner Radius, Appearance | Fill, Stroke, Effects, Mask, Paint Library, Object Filters, Warp | Image crop/resolution, typography |
| Ellipse/circle | Position & Size, Appearance | Fill, Stroke, Effects, Mask, Paint Library, Warp | Rect-only corner grid, image/text controls |
| Polygon/star | Position & Size, Appearance | Fill, Stroke, Effects, geometry-specific controls, Warp | Rect-only and image-only controls |
| Line/arrow | Position & Size and line/arrow geometry | Stroke, Appearance where paintable, Effects | Fill add control when renderer cannot paint fills; corner radius |
| Editable path/outlined vector | Position & Size, Appearance | Fill, Stroke, Effects, Mask, Warp, path/trace actions | Typography when logical text no longer exists |
| Single image shape | Image Placement, Crop & Bounds, Position & Size | Appearance, Fill/Stroke, Mask, Effects, Resolution, Perspective, Animation, image/AI tools | Typography and irrelevant generic controls |
| Multi-image selection | Batch Image Placement, Position & Size | Shared appearance and batch tuning | Single-image crop/perspective without a target |
| Point/area text | Typography, then Position & Size | Appearance, Fill, Stroke, Effects, advanced/OpenType/variable/glyph | Image sections |
| Text on path | Typography, Text on Path, Position & Size | Appearance and advanced typography | Path-text controls for ordinary text |
| Mixed text | Shared Typography rows with mixed indicators | Position/appearance and collapsed advanced rows | Treating mixed values as zero or silently applying a type-specific value |
| Regular frame | Position & Size, Stack/Grid, Appearance | Fill, Stroke, Effects, Mask, guides, export | Typography/image controls |
| Auto-layout frame | Position & Size, Stack/Grid | Guides, component/variant, child layout when child selected | Duplicate child layout controls on frame |
| Component instance frame | Component/variant context, Position & Size, Layout | Overrides, slots, mockup, states | Destructive controls that bypass component ownership |
| Export region frame | Region identity, Position & Size, Export | Print/export presets | Ordinary frame fill/layout when non-painting |
| Plain group | Position & Size, Appearance/effects | Mask, Paint Library, selection colours | Fill if renderer has no group fill; frame layout |
| Live boolean group | Boolean operation/provenance, Position & Size | Appearance, Fill, Stroke, Effects, explicit expand/flatten command | Treating operands as an ordinary path without provenance |
| Image-trace group | Trace identity/provenance, Position & Size | Appearance, Fill, Stroke, Effects, focused edit/retrace | Image crop controls on vector result |
| Table | Table structure, Position & Size | Appearance, Fill, Stroke, Effects, print/export | Generic frame layout controls |
| Table cell/row/column scope | Scope-specific controls | Table appearance and text | Treating edit scope as a scene node |
| Adjustment layer | Adjustment type/parameters, Scope | Focused curves/presets, masks | Generic Fill/Stroke controls with no effect |
| Raster paint layer | Raster/brush identity, Position & Size | Effects, masks, frequency separation, liquify/retouch | Vector fill/stroke and typography |
| Masked container/shape | Mask status and target relationship | Position, appearance, feather/density/invert, vector/raster editor | Hiding active mask state because source is not selected |
| Background/depth mask | Mask result/state, edit/restore action | Depth/segmentation controls in focused panel | Generic mask with no source/scope indication |
| Heterogeneous mixed selection | Shared Position, alignment, common appearance, mixed values | Batch commands and selection colours | Per-type controls acting on only a subset |
| Locked/hidden/inherited/bound | Read-only/unavailable state with reason/recovery | Bind/reset/unlink actions | Disabled field with no explanation |
| Tool-only frame/brush/crop/text/pen | Explicit tool options and context | Advanced options in focused surface | Auto-opening large popovers that steal canvas focus |

This matrix is the acceptance inventory. A new node/capability requires a row,
availability predicate, ordering rule, and real workflow test.

## 5. Root causes and decisions

### Information architecture

The registry is centralized, but its default numeric order is still mostly
type-agnostic. The current text override moves Typography upward yet leaves it
after Appearance. Saved custom order can also override contextual priority.

**Decision:** reserve a non-overridable contextual primary band for the most
relevant sections. User customization applies within bands and to secondary /
advanced content. Section Manager remains the recovery path for hidden sections.

### Duplicate field grammars

Shared `@varve/ui` fields coexist with specialized `.insp-*` fields and local
flex/grid rules. The specialization is necessary for document semantics, but
raw inputs and unlabeled selects still let visual and accessible contracts drift.

**Decision:** add a composable Inspector shell/row/group adapter. It owns
geometry, label association, descriptions/errors, state styling, and stable
action columns. Value-family controls own parsing, selection, or mutation. Do
not create a universal boolean-heavy component.

### State semantics mixed with presentation

Numeric fields have editing draft, valid preview, committed, invalid, and
cancelled states; multi-selection adds mixed, unavailable, inherited, and bound.
Comboboxes have query, highlighted, selected, and committed states.

**Decision:** specify and test state/commit contracts before broad migration.

### Clutter from wrong visibility

Large expanded panels compete with selection-specific tasks. Hiding everything
would repeat Figma/Blender findability failures.

**Decision:** primary (visible/expanded), secondary (visible/collapsed or
compact), and advanced (explicit disclosure/focused editor with active-state
summary). Whole sections disappear only when capability is false.

### Overlay and responsive risk

Inspector width is bounded, popups are portaled, and nested/transformed scroll
regions exist. Top-layer APIs help but do not eliminate collision/focus/WebKit
tests.

**Decision:** each overlay declares its semantic family and gets an edge,
scroll, nested-dismissal, focus-return, and reduced-motion scenario.

## 6. Token and density proposal

The existing token model is retained. New aliases are permitted only for shared
roles; raw pixels in consumer CSS are not the migration strategy.

| Role | Compact desktop | Standard | Touch-oriented | Rule |
| --- | ---: | ---: | ---: | --- |
| Field/control height | 32px | 40px | 44px | Density only changes geometry |
| Inline action target | 24×24px | 32×32px | 44×44px | Glyph size and hit area differ |
| Label/control gap | existing semantic label gap | same | same | No local margin patches |
| Row/group gap | existing control-group semantic | same | same | Proximity stays measurable |
| Section gap | panel semantic | same | same | Whitespace before decorative borders |
| Radius | compact control radius | control radius | control radius | No per-component radii |
| Popup option row | compact menu row | default menu row | touch minimum | Wrap/detail path for long values |
| Focus | semantic focus ring/border | same | same/higher contrast | Works in all themes/forced colors |

Potential aliases, only if repeated consumers justify them:

```text
--inspector-control-height
--inspector-control-padding-inline
--inspector-label-control-gap
--inspector-row-gap
--inspector-section-gap
--inspector-group-padding
--inspector-action-target
--inspector-popup-option-height
--inspector-popup-max-height
```

They must resolve to the existing UI token family in every theme and must not
introduce a fourth density scale.

## 7. Accessibility, performance, and acceptance criteria

Accessibility evidence must cover persistent names, descriptions/errors,
native semantics, correct popup ownership, keyboard/focus contracts, 24px/44px
targets, focus visibility/not-obscured, forced colors, reduced motion, RTL,
long labels, CJK/IME, bidirectional text, and mixed/read-only/inherited/bound
announcements.

Measure avoidable rerenders, popup mount/filter cost, layout reads during
placement/resizing, pointer-move and undo volume during scrubbing, multi-select
updates, WebKitGTK behavior, and low-memory behavior. Do not optimize by
removing semantics or feedback.

Complete work is accepted only when:

1. the repository-wide inventory is checked off or has a documented exception;
2. selected text opens with Typography in the primary band;
3. images, frames, tables, adjustments, raster layers, masks, shapes, groups,
   and mixed selections have contextual priority rules and real scenarios;
4. each migrated input uses a canonical primitive or a written exception;
5. native select, custom select, combobox, search, menu, popover, and dialog
   semantics remain distinct;
6. numeric fields preserve intermediate input, units, mixed values, undo,
   cancellation, and text-editing shortcuts;
7. narrow/wide/zoomed/light/dark/high-contrast/touch/keyboard cases work;
8. before/after visual evidence is reviewed, not merely generated;
9. website/help copy is truthful and marketing scenes are reviewed after capture;
10. no document/selection/serialization behavior changes without explicit tests.

Explicit non-goals at this gate: replacing `@varve/ui`, adding a dependency,
redesigning the canvas/document model/undo architecture, turning every section
into a card, deleting advanced capabilities, or claiming conformance from one
automated scan.

## 8. Follow-up research — long sections, quick actions, and field geometry

The screenshots reviewed on 2026-09-17 show a different failure mode from
simple ordering: a long Typography body pushes Fill and Appearance below the
first useful viewport, while layout-specific fields remain mounted when they
are not applicable. The grid-placement labels also wrap inside a two-up
numeric grid until individual words are clipped. This section records the
research and the implementation decision before changing those surfaces.

| Source | Finding | Varve implication | Evidence type |
| --- | --- | --- | --- |
| [Figma Guide to text in Figma Design](https://help.figma.com/hc/en-us/articles/360039956434-Guide-to-text-in-Figma-Design) (accessed 2026-09-17) | Typography is a named, text-specific group; layout/resizing, fill, stroke, and effects remain separate property families. | Keep semantic ownership separate, but place the text family first and compress its common rows rather than merging unrelated appearance state into typography. | Official product documentation |
| [Figma Explore text properties](https://help.figma.com/hc/en-us/articles/360039956634-Explore-text-properties) (accessed 2026-09-17) | Common font, size, line-height, spacing, and alignment controls stay in Typography; less frequent type settings are opened from a dedicated type-settings surface. | Keep a short always-visible typography spine. Put OpenType, variable axes, glyph, paragraph, and writing-mode details behind labelled disclosures or a focused editor with an active-value summary. | Official product documentation |
| [Adobe Photoshop workspace overview](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/workspace-overview.html) (accessed 2026-09-17) | A contextual task bar exposes relevant next steps while panels remain the detailed editing surface. | Varve can expose a small contextual action strip for high-frequency actions, but it must call the same mutation handlers as the inspector sections; no duplicate property state or silent alternate semantics. | Official product documentation |
| [Adobe Photoshop panel collapse guidance](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/collapse-expand-icons.html) (accessed 2026-09-17) | Panel collapse is used to keep dense workspaces usable, with labels retained when there is room. | Use disclosure as progressive disclosure, not deletion. Collapsed rows must remain visible, keyboard reachable, and summarize non-default values. | Official product documentation |
| [Apple HIG: Layout](https://developer.apple.com/design/human-interface-guidelines/layout) (accessed 2026-09-17) | Proximity, alignment, progressive disclosure, and adapting at defined size changes are preferred over arbitrary compression. | Establish one inspector row grammar and switch paired rows to stacked cells at a measured container threshold; do not let intrinsic input widths define the panel. | Official platform guidance |
| [Apple HIG: Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers/) (accessed 2026-09-17) | Popovers should expose a small related task and should not cover the trigger or essential content. | A focused editor is appropriate for advanced typography/color work; a long property family should not be moved into a giant popover merely to hide scrolling. | Official platform guidance |
| [Adobe Spectrum Text Field](https://spectrum.adobe.com/page/text-field/) (accessed 2026-09-17) | Field labels may be top or side; side labels are for constrained vertical layouts. Field size and width are contextual, with a minimum width tied to height; mixed values use an en dash. | Inspector fields need explicit width roles: fill for long values, bounded for compact numeric values, and stacked labels for narrow paired cells. One unconstrained flex rule is not sufficient. | Official design-system guidance |
| [Carbon form usage](https://carbondesignsystem.com/components/form/usage/) (accessed 2026-09-17) | Multi-column fields should be proportional and respond as a group when one field grows for an error. | Paired inspector fields must share a grid row and error/description expansion must not overlap the adjacent field; actions need a stable end column. | Official design-system guidance |
| [Adobe community: better panel sizing](https://community.adobe.com/feature-requests-730/better-panel-sizing-optimization-e-g-properties-panel-1328209) (accessed 2026-09-17) | Users reported that a narrow Properties panel could hide entire inputs without indicating that content was unavailable. | Varve must measure overflow at representative widths, keep a visible scroll affordance, and stack/wrap before labels or controls clip. | User complaint / product feedback |
| [Adobe community: type-layer sections](https://community.adobe.com/bug-reports-711/properties-panel-for-a-type-layer-shows-only-two-property-sections-when-expanded-657403) (accessed 2026-09-17) | Users reported expanding type sections without receiving a scrollbar for lower sections. | Section expansion cannot remove the panel’s scroll path. Keep one authoritative scroll container and test expansion combinations, not just the initial screenshot. | User complaint / product feedback |
| [Adobe community: panel scroll changes popup values](https://community.adobe.com/bug-reports-733/when-scrolling-panels-pop-up-menus-get-changed-906102) (accessed 2026-09-17) | Users reported that scrolling the panel while a pointer passed over a closed popup changed its value accidentally. | Select/combobox controls must not mutate on wheel merely because they are under the pointer; wheel changes remain an explicit focused NumberField gesture only. | User complaint / product feedback |
| [Figma UI3 feedback](https://forum.figma.com/share-your-feedback-26/ui3-feedback-3058/index2.html?fid=26&tid=3058) (accessed 2026-09-17) | Users complained that moving width/height and changing right-sidebar density made values harder to scan and required hover to understand dimensions. | Preserve stable W/H placement, visible labels, and a consistent value column; do not solve density by shrinking labels or relying on hover-only affordances. | User complaint / product feedback |
| [Blender Properties editor panels](https://docs.blender.org/manual/en/4.1/interface/window_system/tabs_panels.html) (accessed 2026-09-17) | Blender uses collapsible panels and supports collapsing siblings, but users have also requested better navigation for long Properties side panels. | Adopt bounded disclosure with active-state summaries and preserve a predictable scroll model; do not make “only one open section” the only navigation method. | Official product documentation + observed complaint context |

### Decision: compress the grammar, not the capability

The research does not support merging all text appearance into Typography. That
would make the section semantically broad and would recreate the failure where
different node types expose different meanings under the same heading. The
chosen Varve pattern is:

1. Keep Typography, Appearance, Fill, Stroke, and Effects as distinct semantic
   sections.
2. Give text a compact primary spine: Content remains editable, but common
   numeric pairs (size/line height) and short mutually related controls use a
   measured two-up grid; advanced text controls stay collapsed with summaries.
3. Place contextual high-frequency sections in the primary band, but do not
   duplicate their controls in a second “quick bar” until a shared view-model
   or render composition exists. Existing Align & Distribute is retained as a
   real action strip because it owns actions rather than a second property
   value.
4. Make capability-specific subsections conditional. Grid Placement appears
   only for a selected node with a grid parent or an authored placement. Empty
   controls are not useful discoverability; the Layout section remains the
   recovery path for enabling a grid.
5. Replace nested horizontal numeric fields that have insufficient label space
   with stacked, two-up cells. Labels remain persistent and full enough to scan;
   they are not rescued with arbitrary font shrinking.
6. Define field width roles: `fill` for family/select/text values, `bounded` for
   finite-range values, and `grid-cell` for related pairs. All roles use the
   same 32px compact height, border, radius, and focus contract.

### Acceptance additions for this follow-up

- A selected text node exposes Typography first, with Fill/Stroke/Appearance
  still discoverable without entering a separate tab or losing the scroll path.
- A text Typography screenshot at 360px, 480px, and 640px panel widths has no
  clipped labels, horizontal overflow, or controls that change width merely
  because another row contains a longer label.
- Grid Placement is absent for an ordinary frame with no grid parent and is a
  readable stacked-label two-up grid when a real grid-child workflow activates
  it.
- Numeric/select/text controls measure 32px in compact desktop mode, with
  documented exceptions for multiline content and touch density; related
  fields share a column edge and do not stretch past their value role.
- Expanding any Typography advanced subsection leaves the direct inspector
  scroll container reachable and preserves focus visibility.

## 9. Context-control toolbar as a local reference surface

The context-control toolbar is not a replacement for the Inspector, but it is
Varve's strongest existing example of a compact, capability-aware input
surface. I inspected its implementation and ran the real text-editing browser
workflow at DPR 1 across light, dark, and high-contrast themes. The run passed
and produced the evidence under
`test-results/run-4127000-1511/canvas-font-toolbar-visual-76f26-adable-menus-in-every-theme-chromium/`.

| Evidence | Finding | Inspector implication | Classification |
| --- | --- | --- | --- |
| `ContextControlBar.tsx`, `ContextControlBar.css`, and `font-toolbar-visual.spec.ts` | The context and floating text bars use one 32px compact control height, a shared centerline, `2.88px` gap, `5.76px 9.44px` padding, and `14.72px` field text. | Use the same compact geometry tokens for Inspector controls; section layout may change, but equivalent fields must not change height or text metrics by panel. | Local implementation + measured browser evidence |
| DPR 1 browser metrics, light/dark/high contrast | The rendered floating surface measured `46.796875px` high; every family, weight, style, size, colour, and overflow control measured `32px`; all centers matched. | Treat control height and baseline alignment as assertions, not visual preference. Allow fractional shell height from token interpolation, but never fractional control height. | Runtime measurement |
| `ContextControlBar` overflow rules | Text controls stay in one row with `overflow-x: auto` and `flex-wrap: nowrap`; the font family field is bounded instead of squeezing until unreadable. | Inspector rows should use explicit `fill`, `bounded`, and `grid-cell` width roles. At narrow widths, switch paired fields to stacked cells or scroll the owning surface; do not clip labels or values. | Local implementation + measured browser evidence |
| `Toolbar.tsx` and toolbar tests | Icon actions use a toolbar role, one roving button stop, arrow navigation, and yield arrow keys to embedded inputs/selects. | Inspector action clusters may reuse the same keyboard contract. Field controls must continue to own text editing, spinbutton stepping, combobox navigation, and IME behavior. | APG-aligned local implementation |
| `ContextControlBar.tsx`, `ShapeQuickControls.tsx` | Contents are capability-specific: image actions, text formatting, frame actions, shape paint/flip, or multi-selection commands. The bar explicitly leaves complete/rare properties in the Inspector. | Quick actions are appropriate for high-frequency commands, not as a second property editor. Any Inspector action strip must reuse the canonical mutation and undo path. | Local product contract |
| `textEditSession` suppression and toolbar follow-up tests | When canvas text editing is active, the context bar points to the floating text bar instead of duplicating font controls. | Do not duplicate Typography controls across Inspector and a quick bar in the same interaction state. The focused editing surface must be explicit. | Local interaction evidence |
| `ShapeQuickControls.tsx` stroke-width field | The context toolbar still contains a small toolbar-specific raw number input. It has explicit compact geometry and transaction boundaries, but it is not a general Inspector primitive. | Do not copy this exception into Inspector sections. Inspector numeric fields remain on `NumberField` so parsing, mixed values, units, binding, scrubbing, validation, and accessibility stay canonical. | Intentional exception / migration boundary |

### Resulting standard

The Inspector should borrow the context toolbar's measured geometry and
capability gating, but not its horizontal information architecture. A toolbar
can omit persistent labels because it is a short, selection-following command
strip with tooltips and a stable visual context. The Inspector is a durable
property editor: labels, values, units, mixed states, and errors must remain
visible and associated. This distinction resolves the temptation to make every
Inspector row icon-only or to add a second quick bar for every long section.
