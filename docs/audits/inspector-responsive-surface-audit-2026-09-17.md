# Inspector responsive input-surface audit

**Date:** 2026-09-17
**Branch:** `master`
**Scope:** Inspector geometry fields, image fill/placement surfaces, shared
field containment, and the responsive migration boundary
**Status:** evidence-backed responsive implementation slice; visual and
interaction validation recorded below before the owned commit

This audit follows the existing Inspector input-surface contract and the
paint-stack handoff. It is deliberately narrower than the application-wide
inventory: it establishes the measurable causes of the current screenshots,
then defines the first responsive implementation slice without overwriting
the concurrent `NumberField`/`DocumentPanel` owner.

## 1. Coordination and repository status

The work is on `master` as requested. The shared worktree contains unrelated
in-flight changes in the native/font, engine, website, photo, and Inspector
areas. The active ownership record is
[`docs/agents/inspector-responsive-surface-2026-09-16-ownership.md`](../agents/inspector-responsive-surface-2026-09-16-ownership.md).

This slice owns:

- this audit and its real-editor evidence spec;
- `PositionSizeSection.tsx`, `LayoutSection.tsx`, `ImageFillControls.tsx`,
  `ImagePlacementSection.tsx`, and focused tests;
- explicitly scoped responsive rules in the existing Inspector stylesheet.

It does not overwrite or stage the concurrently modified
`NumberField.tsx`, `NumberField.test.tsx`, `DocumentPanel.tsx`,
`PropertiesPanel.tsx`, or the existing Design-tab audit. Those paths remain an
integration boundary and are called out as follow-up work below.

## 2. Sources consulted

Sources were checked on 2026-09-17. The source type is recorded so a product
observation is not mistaken for a normative requirement.

| Source | Relevant finding | Implication for Varve | Type |
| --- | --- | --- | --- |
| [WCAG 2.2 Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) | At 400% zoom, content must remain usable without two-dimensional scrolling except where the task inherently needs it. | Inspector rows need bounded tracks, intentional stacking thresholds, and no hidden horizontal overflow. | Standard |
| [WCAG 2.2 Target Size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | AA target size is 24×24 CSS px with spacing exceptions; compact controls still need usable embedded actions. | Keep compact visual fields, but keep reset, lock, drag, clear, and disclosure actions at or above the target minimum; coarse pointers use the touch token. | Standard |
| [WAI-ARIA APG Spinbutton](https://www.w3.org/WAI/ARIA/apg/patterns/spinbutton/) | An editable spinbutton preserves normal text editing while arrows change value; it should not become a drag-only control. | A bounded visual width is a presentation decision, not a change to numeric draft, commit, or cancellation semantics. | Standard/recommendation |
| [MDN CSS container queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries) | Components can adapt to their containing rail rather than the viewport. | Inspector controls should respond to the actual dock/floating rail width, not only the browser viewport. | Platform guidance |
| [MDN `select`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/select) | Native select supplies a platform-recognised select-only interaction. | Use the existing rich `Select` only where custom option presentation or collision handling is needed; do not use a segmented control for every value list. | Platform guidance |
| [React Aria ComboBox](https://react-spectrum.adobe.com/react-aria/ComboBox.html) | Labels, option groups, loading, and collection state are separate from the popup surface. | Image fit is a small fixed choice, not a searchable combobox; the inspector should reserve searchable surfaces for real collections. | Design-system recommendation |
| [Fluent 2 Combobox](https://fluent2.microsoft.design/components/web/react/combobox/usage) | Selection, filtering, and freeform entry are distinct modes. | A compact select must not silently become an editable field when the rail is narrow. | Design-system recommendation |
| [Figma image fills](https://help.figma.com/hc/en-us/articles/360040314193-Add-images-to-design-files) | Image fill placement is presented with the fill/image context, while crop is a focused editing operation. | Keep per-paint image fit close to the image fill; use a separate placement surface for selection-wide offsets and crop actions. | First-party product guidance |
| [Adobe Photoshop workspace](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/workspace-overview.html) | Contextual panels expose the common operation near the selected content and keep specialised workflows in focused panels. | The Inspector should provide a compact common path and progressive disclosure, rather than making every image operation an always-expanded block. | Observed product behavior |
| [Blender Properties editor](https://docs.blender.org/manual/en/latest/editors/properties_editor.html) | Contextual properties help, but large property collections become difficult to browse when every possible category is exposed. | Visibility predicates and section ordering must be coupled with a recovery/search path; hiding must not be a substitute for semantic availability. | Observed product behavior |
| [Figma UI feedback](https://forum.figma.com/share-your-feedback-26/ui3-feedback-3058/index2.html?tid=3058&fid=26) | Users complained when familiar high-frequency actions moved behind extra clicks or became difficult to find. | Consolidate duplicate Fit controls, but keep the common per-fill Fit action one interaction away and preserve a visible summary for compressed state. | User-reported failure |
| [Adobe properties-panel complaint](https://community.adobe.com/bugs/p-properties-panel-not-showing-shape-properties-anymore-old-bug-is-back) | Users report contextual properties becoming unavailable or unreachable when panel logic drifts. | Every reorder/hide decision requires a real selection reachability test and an explicit fallback. | User-reported failure |

### Decision from the comparative review

The reliable pattern is not “make every row full width” and not “put every
property in a card.” Professional tools keep the high-frequency value close to
the contextual object, bound numeric controls to the space their values need,
and expand only when the available rail cannot preserve readable labels and
targets. Varve will use that pattern with a container-aware layout grammar.

## 3. Breadth and depth inventory

The repository search was performed under `packages/editor/src/components/Inspector`
and then followed into the shared UI package and live consumers. Discovery
counts include implementations and consumers, so they are not unique-control
counts.

| Surface | Discovery result | Interpretation |
| --- | ---: | --- |
| Raw `<input>` in Inspector TSX | 45 files | Geometry, image, layout, colour, gradient, and specialised popovers still bypass the shared value shell. |
| Raw `<select>` | 4 files | A small but important native/custom boundary remains. |
| Raw `<textarea>` | 4 files | Text, expressions, and long-form values need separate layout rules. |
| `<button>` | 73 files | Embedded actions are widespread; action columns must be stable. |
| `NumberField` consumers | 34 files | Specialised document semantics are justified, but unbounded fields currently inherit the row’s remaining width. |
| `FieldRow` consumers | 34 files | The 38/62 label/control grammar is broadly reused but has no paired/compact role. |
| `Select` consumers | 39 files | Rich selects are common; narrow behavior must remain a select contract, not an accidental combobox. |
| Inline-style lines | 164 | Local width/flex/grid overrides remain a primary source of divergence. |
| Inspector stylesheet | 6,774 lines | Source-order duplication and broad containment rules make local width contracts easy to override. |
| Largest relevant surfaces | `DocumentPanel` 1,164; `PositionSizeSection` 661; `ImageFillControls` 643; `NumberField` 754 | These are high-risk migration boundaries, not candidates for a universal boolean-heavy component. |

Representative raw-input consumers include `PositionSizeSection`,
`ImageFillControls`, `LayoutSection`, `RangeValueControl`,
`FramePresetDropdown`, `GradientMapEditor`, and several document/canvas
property surfaces. This means the fix must be a reusable geometry contract,
not a single image-specific width.

## 4. Runtime evidence

The real-editor audit is
[`tests/e2e/inspector/inspector-responsive-surface-audit.spec.ts`](../../tests/e2e/inspector/inspector-responsive-surface-audit.spec.ts).
It creates a real rectangle and imports
`tests/e2e/fixtures/real-life-still-life.jpg`, then measures a live Inspector
rail at 240, 280, 320, 400, and 640 CSS px. It also captures the image surface
at each width.

### Position & Size baseline

The group has no horizontal overflow, but the value controls consume almost
all available width even when the value is only a few digits. These are the
actual input/control widths after the current `NumberField` compact fix (the
unbounded X/Y/W/H fields intentionally do not receive that compact rule):

| Rail | Group content width | X/Y input width | W/H input width |
| ---: | ---: | ---: | ---: |
| 240 | 220.28 | 67.78 / 68.78 | 48.83 / 51.83 |
| 280 | 260.28 | 87.78 / 88.78 | 68.83 / 71.83 |
| 320 | 306.19 | 110.73 / 111.73 | 91.78 / 94.78 |
| 400 | 386.19 | 150.73 / 151.73 | 131.78 / 134.78 |
| 640 | 626.19 | 270.73 / 271.73 | 251.78 / 254.78 |

The X/Y control width therefore grows by about 4× from a usable narrow rail to
a wide rail, and W/H grows by about 5×. That growth is not buying a larger
value vocabulary; it is the result of a flexible grid track and a generic
`.insp-field__control > input { flex: 1 1 0 }` rule.

### Image Fill and Image Placement baseline

The live image surface confirms three separate defects:

- `Image Placement` exposes a five-option Fit control as a full-width row;
  its control grows from approximately 220px at a 240px rail to 626px at a
  640px rail.
- `ImageFillControls` exposes another Fit control for the image paint, so the
  user can see two controls that write the same image-fit property through
  different paths.
- The image preview grows to approximately 612px wide on a 640px rail while
  remaining capped at 120px high. It is useful evidence, but it is not a
  value that needs to occupy the entire wide rail.

At the 280px rail, the image Fill controls show a 120px-wide control column,
an 80px rotation input, and a full-width Fit row. At the 640px rail the same
Fit/source rows expand to roughly 374px, and the Fill disclosure reports a
small horizontal overflow (`scrollWidth` 628 vs `clientWidth` 626) from nested
paint content. The screenshots are stored in the corresponding
`test-results/run-*/.../image-rail-*.png` run directory and were visually
reviewed at narrow and wide rails.

### Post-implementation Frame and Stack/Grid evidence

The Frame scenario was added to the real-editor audit after the initial image
slice exposed a second geometry contract: Position & Size used a two-track X/Y
grid while W/H added lock/orientation tracks, so corresponding value edges
shifted. The implementation now reserves action columns at normal rails and
uses a shared compact two-up grammar below the 20rem container threshold. At
the very narrow threshold (13rem), position fields stack; W/H keeps the lock
between its two values rather than allowing the lock to become a stray row.

Measured after the change, using a real Frame and the same 240/280/320/400/640
CSS-pixel rails:

| Rail | X/Y right-edge delta vs W/H | visible action slots | field height | Stack/Grid overflow |
| ---: | ---: | ---: | ---: | ---: |
| 240 | 0px | 0 (narrow grammar) | 32px | 0px |
| 280 | 0px | 0 (narrow grammar) | 32px | 0px |
| 320 | 0px | 0 (narrow grammar) | 32px | 0px |
| 400 | 0px | 2 stable reserved slots | 32px | 0px |
| 640 | 0px | 2 stable reserved slots | 32px | 0px |

Stack/Grid now uses one shared wrapper instead of inline spacing overrides. Its
Sizing subsection resolves `margin-block-start` and `padding-block-start` from
`--space-2` (5.92px at the test root) and its internal gap from `--space-1`
(2.96px), with all measured field shells at 32px. The assertion resolves the
tokens in the browser, so it remains valid under a different root font size.
The Frame screenshots at 240, 400, and 640px were visually inspected; the
240px capture confirms the centered proportion lock does not overlap the H
label, while the wider captures restore the full orientation/action grammar.

The current responsive E2E artifact is
`tests/e2e/inspector/inspector-responsive-surface-audit.spec.ts`; screenshots
are emitted under the Playwright `test-results/run-*/...` directory for each
validation run.

### Root causes

1. Unbounded `NumberField` instances in Position & Size inherit the remaining
   grid track, while bounded fields use the newer intrinsic-width contract.
2. The generic Inspector containment rule intentionally makes direct inputs
   flexible, but no semantic “geometry numeric rail” overrides that behavior.
3. `FieldRow` has one row grammar. It cannot express a compact paired
   control, so Fit, Rotation, and Flip are forced into separate full-width
   rows.
4. `ImageFillControls` and `ImagePlacementSection` both expose Fit even though
   Fit is stored inside each image paint. This is an information-architecture
   duplication, not just a spacing defect.
5. The five-up Fit segmented control is forced to equal columns even when its
   labels and adjacent controls would be better represented by a bounded
   select or a responsive two-up/stacked group.
6. Image preview width is unbounded at wide rails, which creates visual weight
   without improving image editing precision.
7. The Inspector CSS has accumulated duplicate rules and broad selectors;
   source order can override local width intent. The migration must add a
   small, named contract and then remove obsolete local rules after consumers
   are accounted for.

### Section-header evidence

The existing empty-selection grid screenshots add a related shell defect. When
the Inspector is scrolled through a long expanded section, a row from the
preceding section remains visible in the top scroll-padding band while the next
section header sticks several pixels below it. The result is a clipped label
such as `PRESET`/`SPACING X` immediately above or behind `ISOMETRIC GRID` or
`DOCUMENT GRID`.

The cause is the combination of `.insp-panel`'s outer padding and
`.insp-disclosure__header { position: sticky; top: 0; }`: the sticky header is
anchored to the scroller, but its opaque background does not own the padded
top inset. This is a geometry/stacking defect, not a reason to remove sticky
section context.

The repair will make the scroller's section-header inset explicit, give the
sticky header an opaque surface and a stable separator, and ensure the first
content row cannot paint into that inset. The acceptance test will scroll a
real Document/Isometric Grid panel and assert that the sticky header's top is
at the content viewport's top inset while the preceding row is either fully
above it or fully below it—not intersecting its rectangle.

## 5. Responsive and information-architecture decision

### Canonical ownership

The image fill owns **per-paint** source, Fit, Rotation, Flip, crop summary,
and colour metadata because those values belong to `ImageFillData` and can
legitimately differ between stacked image paints.

`Image Placement` owns **selection-wide** Scale, Offset, crop entry, and Reset
placement. Its duplicate Fit editor is removed. It retains a compact read-only
Fit summary when image paints disagree or are in Stretch mode, so the section
does not lie about why Scale/Offset are unavailable. Reset continues to reset
placement and Fit for the selected image paints and is labelled accordingly.

For an image selection the contextual order becomes:

1. Position & Size.
2. Fill (the image source and common per-paint Fit action).
3. Image Placement (selection-wide offsets, scale, crop entry, reset).
4. Crop & Bounds and other advanced image operations.

This preserves one-click access to the common Fit control without keeping two
competing editors. A future multi-paint image editor may add an explicit
paint-target picker, but this slice does not invent one.

### Layout thresholds

These are container widths, not viewport widths:

| Inspector content width | Geometry | Image transform | Rationale |
| ---: | --- | --- | --- |
| ≥ 20rem | Four-track X/Y and W/H geometry with stable lock/orientation action columns; numeric rails are bounded. | Fit + Rotation/Flip share a two-column group; preview is capped. | Typical docked desktop rail; preserves scan paths and reduces empty boxes. |
| 13–20rem | X/Y and W/H remain two-up, but empty action columns collapse; the proportion lock is centered in a reserved gap. | Fit + transform group stays paired only if each control retains its target; otherwise it stacks. | Narrow docked rails keep labels and value edges readable without horizontal scrolling. |
| < 13rem | Position fields stack intentionally; W/H retains a centered lock and never creates a second scroll container. | Stack Fit and transform controls; keep Flip actions next to Rotation. | A very narrow/floating rail must reflow rather than clip labels or actions. |

The image transform pairing still uses its own 18rem content threshold; these
geometry thresholds are separate because the lock and action columns have a
different minimum width contract.

The exact CSS uses the existing Inspector container query and semantic custom
properties, not viewport media queries. Numeric values remain editable and
scrollable inside a bounded field; the width cap never clamps or rounds the
document value.

### Quick actions and progressive disclosure

- Fit, Rotation, and Flip are high-frequency image operations and stay in the
  expanded image fill surface.
- Source URL, crop metadata, colour metadata, and upscale actions remain
  compact rows; long metadata is truncated with a tooltip and details remain
  expandable.
- Selection-wide Scale/Offset stay in Image Placement because they are needed
  during crop/placement work; the section does not duplicate per-paint Fit.
- Rare perspective, resolution, AI, and advanced colour operations remain
  collapsed sections with current-state summaries. They are not moved into an
  unlabeled three-dot menu where recovery would be poor.
- Reset and clear remain explicit named actions. Reordering/removal actions
  belong to the existing paint/effect row menu and drag handle contract.

## 6. Proposed token and component contract

This slice reuses existing tokens and introduces no parallel design system.
The semantic contract to be implemented is:

| Token/role | Contract |
| --- | --- |
| `--component-compact-height` | 32px visual desktop field height, already used by the context toolbar and Inspector. |
| `--touch-target-min` | Coarse-pointer target size; embedded actions never shrink below the existing target contract. |
| `--insp-numeric-rail` | Bounded geometry field value rail, approximately 8–10ch at normal density and allowed to shrink to the available cell. |
| `--insp-preview-max-inline-size` | Cap image previews at a useful reading size instead of scaling them with a wide rail. |
| `--space-*`, `--radius-control-compact`, semantic borders/foregrounds | Existing Inspector/UI tokens; no literal per-call-site geometry. |

The canonical composition remains:

`InspectorSection → InspectorFieldGroup → FieldRow/NumberField → value + unit + action`

`NumberField` continues to own draft parsing, spinbutton semantics, scrubbing,
mixed values, bindings, undo transactions, and commit/cancel behavior. The
responsive slice only constrains its presentation track. `FieldRow` remains a
label/control adapter; paired groups are explicit wrappers rather than a
universal component with many booleans.

## 7. Migration matrix

| Surface | Current defect | First decision | Owner/status |
| --- | --- | --- | --- |
| Position & Size X/Y/W/H | Unbounded fields grow with rail | Add a named geometry numeric pair contract and a narrow stack threshold | This slice |
| Rotation/flip/skew | Action row competes with a flexible field | Apply the same bounded geometry action grammar | This slice |
| Image Fill Fit/Rotation/Flip | Full-width rows, inconsistent widths | Pair common transform controls; keep Fit in per-paint Fill | This slice |
| Image Placement Fit | Duplicates per-paint Fit | Remove editor, retain read-only summary/reset semantics | This slice, with registry owner handoff for ordering |
| Image preview | Wide rails create oversized visual block | Cap inline size and preserve bounded height/contain behavior | This slice |
| Sticky section headers | Previous-section rows show through/clipped above a sticky header | Reserve and paint a single explicit header inset in the Inspector scroller | This slice |
| `NumberField` finite widths | Concurrent fix exists and is dirty | Do not overwrite; integrate after owner handoff | Concurrent Inspector pass |
| `DocumentPanel` inline widths | Many one-off width overrides | Audit and migrate after shared field contract lands | Follow-up |
| Layout/Grid/constraints | Raw inputs, clipped labels, and mixed inline spacing | Use the shared Stack/Grid wrapper, bounded numeric pairs, and tokenized sizing subsection; preserve functionality and test grid placement | This slice for Frame Stack/Grid; deeper grid-placement cleanup remains follow-up |
| Popover/listbox surfaces | Need collision/zoom/forced-colors coverage | Keep existing overlay primitives; add geometry assertions | Follow-up |
| Website/marketing | Must explain responsive/contextual Inspector behavior | Update only after implementation evidence and screenshots are stable | Website owner/handoff |

## 8. Accessibility and performance strategy

Accessibility checks for this slice:

- persistent visible and programmatic labels remain unchanged;
- bounded inputs retain text editing, spinbutton semantics, mixed state, unit
  naming, and existing commit/cancel behavior;
- Fit remains a select-only control; it does not become editable at narrow
  widths;
- Flip and reset retain named buttons, visible focus, and 24px minimum targets;
- stacked layouts are DOM-order stable and do not move focus when the rail
  crosses a threshold;
- no state is communicated by colour or width alone;
- forced colors, 200% zoom, reduced motion, RTL, and long labels are included
  in the acceptance run.

Performance checks:

- CSS container queries must not introduce per-pointer layout work;
- image preview capping must not decode the original image at a larger size;
- removing duplicate Fit controls should reduce mounted controls and not add
  a second update subscription;
- real-editor E2E measures layout stability after rail changes and image
  selection; no render-pipeline code is touched.

## 9. Test and acceptance matrix

Before the responsive slice is considered complete:

- focused unit tests prove Image Placement no longer mounts a duplicate Fit
  editor and that per-fill Fit remains editable;
- real-editor Playwright covers a shape, an imported image, and a frame at
  240/280/320/400/640px rails;
- geometry assertions verify bounded control widths, no horizontal overflow,
  stable action columns, and intentional stacking below the narrow threshold;
- screenshots are reviewed at narrow, typical, and wide rails in light/dark
  themes, plus 200% browser zoom;
- keyboard tests cover opening/selecting Fit, editing Rotation, reset, and
  resizing the rail while focus remains in a field;
- the affected validation planner and docs/token/accessibility audits are
  recorded with unrelated shared-worktree failures separated.

### Validation completed for this slice

- Focused Vitest: 5 files, 100 tests passed.
- Real-editor Playwright responsive audit: 4 tests passed across the five
  rails, including the imported photograph, a drawn shape, a real Frame, and
  sticky-header scrolling.
- `pnpm typecheck:e2e`: passed.
- `pnpm audit:docs`: passed.
- `pnpm audit:emoji`: passed.
- `pnpm audit:tokens`: all 201 pairs passed across light, dark, and
  high-contrast themes.
- `pnpm verify:affected`: stopped at the repository-mandated full-gate
  escalation because 152 shared-worktree files are dirty; it did not report a
  failure in this slice. The editor package typecheck was run separately and
  remains blocked by unrelated concurrent errors in Menubar, canvas/tools,
  FramePresetDropdown, masks, mockups, workspace, and other files; none point
  to the owned responsive files.

## 10. Explicit non-goals

- No replacement of `NumberField`, `Select`, `Disclosure`, or the existing
  overlay system.
- No change to scene serialization, selection semantics, or image rendering.
- No desktop-to-mobile redesign or forced 44px fields for a mouse/keyboard
  density mode.
- No hiding of image functionality solely to reduce scroll length.
- No broad cleanup of unrelated dirty files or existing native/engine failures.
- No claim that the entire Inspector inventory is migrated by this first
  responsive slice; the matrix above is the auditable migration boundary.
