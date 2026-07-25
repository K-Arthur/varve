# Properties panel ownership audit

Date: 2026-07-23

## Runtime evidence

The audit used the existing browser runtime at `http://localhost:1420` with a
1440 by 1000 viewport and direct DOM inspection. Evidence is stored in
`/tmp/strata-properties-audit-20260723/`.

| State | Scroll height | Viewports | Descendants | Buttons | Controls |
|---|---:|---:|---:|---:|---:|
| Empty | 762 px | 1.00 | 51 | 12 | 0 |
| Rectangle | 1497 px | 1.96 | 276 | 34 | 15 |
| Text | 2460 px | 3.23 | 467 | 55 | 32 |
| Mixed text and shape | 2341 px | 3.07 | 516 | 64 | 32 |

The mixed text and shape state exposed Typography and OpenType controls even
though only part of the selection supported them. Arrow-key tab navigation
changed `aria-selected` without moving focus. At 800 px width the inspector
drawer was translated to an on-screen state but its box remained entirely
outside the viewport.

After restructuring, the same rectangle workflow measured 511 px of content
(one viewport) and 221 descendants. A Chromium E2E budget now caps this common
state at 1.75 viewports and 240 descendants, and asserts that Effects and
Prototype editors are not mounted on the Properties surface.

## Original inventory

| Feature | Actual applicability | Scope | Frequency | Complexity | Duplicate or temporary | Status | New owner |
|---|---|---|---|---|---|---|---|
| Position and Size | Any selection; some fields only on measurable nodes | Mixed selection | High | Large | Responsive min/max are advanced | Functional | Properties |
| Align and Distribute | Multi-selection | Mixed selection | High | Moderate | None | Functional | Properties |
| Constraints | Children of frames, despite broad registry predicate | Selection | Medium | Compact | Component self-gates | Functional | Properties |
| Corner Radius | One rectangle or frame | Selection | High | Moderate | None | Functional | Properties |
| Layout | One frame | Selection | High | Large | Grid and child placement need depth | Functional | Properties, with future advanced editor split |
| Appearance | Any selection | Mixed selection | High | Compact | None | Functional | Properties |
| Fill stack | Any fill-capable selection | Mixed selection | High | Large | Image fit duplicated elsewhere | Functional | Properties |
| Stroke stack | Shape, text, or frame subset | Mixed selection | High | Large | Previously edited compatible subsets silently | Functional | Properties |
| Effects stack | Shape, text, frame, path, or adjustment subset | Mixed selection | Medium | Very large | Long reorderable stack | Functional | Appearance |
| Typography | Text subset | Mixed selection | High | Very large | Rich text, OpenType, variable axes need depth | Functional with incomplete claims | Properties; future Typography split |
| Paint Library | Broad selection | Document workflow | Medium | Large | Overlaps variables and reusable styles | Functional | Appearance |
| Mask | Compatible single container or adjustment | Selection workflow | Medium | Large | Refinement is temporary | Functional | Appearance |
| Component | One component instance | Selection | High | Moderate | None | Functional | Properties |
| Frame Presets | Frame tool or selected frame | Active tool | Medium | Moderate | Duplicates width and height | Functional | Tool Options |
| Image Placement | One image-filled shape | Selection | High | Compact | Fit appeared in three places | Functional | Properties |
| Crop and Bounds | One image-filled shape | Temporary workflow | Medium | Large | Fit duplicated; From Center disconnected | Incomplete | Tool Options |
| Image and Vector | One image-filled shape | Processing workflow | Low | Very large | Upscale and trace combined | Functional | Adjustments |
| Background Removal | Image or prior removal state | Temporary workflow | Medium | Very large | Model and mask refinement | Functional when available | Adjustments |
| Colorize | One image-filled shape | Processing workflow | Low | Very large | Model dependency | Incomplete | Adjustments |
| AI Denoise | One image-filled shape | Processing workflow | Low | Large | Model dependency | Functional when available | Adjustments |
| Lens Blur | One image-filled shape | Processing workflow | Low | Large | Depth preview and model | Functional when available | Adjustments |
| Line Art | One image-filled shape | Processing workflow | Low | Large | Model dependency | Functional when available | Adjustments |
| Content-Aware Fill | One image-filled shape | Temporary workflow | Low | Very large | Paint mask and preview | Functional | Adjustments |
| Detect Text | One image-filled shape | Analysis workflow | Low | Large | Overlaps OCR and audit | Functional | Adjustments |
| OCR | One image-filled shape | Conversion workflow | Low | Large | Requires result editing | Functional | Adjustments |
| Blend Images | One image plus another candidate | Processing workflow | Low | Large | Self-hides without second image | Incomplete | Adjustments |
| Extract Palette | One image-filled shape | Analysis workflow | Low | Moderate | Belongs with colors and swatches | Functional | Adjustments |
| Adaptive Contrast | All-text selection | Accessibility | Medium | Large | Analysis and remediation | Functional | Audit |
| Prototype Interactions | One selection | Prototype workflow | Medium | Large | None | Functional | Prototype |
| Prototype Flow | Document | Prototype workflow | Low | Very large | Previously gated by unreachable mode | Disconnected | Prototype |
| Cognitive Load | Selection or document | Diagnostic | Low | Compact | Overlaps Audit | Functional | Audit |
| Brush Settings | Paint, eraser, pencil, or smudge tool | Active tool | High | Moderate | Size and opacity duplicated in toolbar | Functional | Tool Options |
| Canvas Background | No selection in old UI | Document | Medium | Compact | Mixed into empty selection | Functional | Document |
| Document Color | No selection in old UI | Document | Low | Moderate | Conversion may be impactful | Functional | Document |
| Export tab | First selected node | Export | Medium | Large | Duplicates Spec and Export dialog | Functional | Export |
| Spec tab and Inspect takeover | First selected node | Handoff | Medium | Large | Duplicates export controls | Partially persistent | Inspect |
| Score tab | Selection or document | Diagnostic | Low | Compact | Duplicates Audit layout analysis | Functional | Audit |
| Audit tab | Document and selection | Diagnostic | Low | Large | None | Functional | Audit |
| Adjustment Layer editor | One adjustment node | Adjustment workflow | Medium | Very large | Generic properties also mounted | Partially connected | Adjustments |

## Problems found

- `PropertiesPanel` statically imported more than thirty section modules and
  hard-coded composition despite the registry claiming to own composition.
- Workspace inspector-tab configuration was not used by runtime UI.
- Default section state omitted registry order; migration discarded custom order.
- The section manager called the show operation in both checkbox branches.
- Most sections did not pass a section ID, so manager state did not control them.
- Plugin contribution metadata had no production renderer.
- Image fit appeared in Fill, Image Placement, and Crop and Bounds.
- Export and code generation appeared in the Export tab, Spec, and a separate dialog.
- Adjustment controls were mounted before generic properties for adjustment nodes.
- Selection applicability had no all, compatible-subset, or none distinction.
- Hidden or locked selections had no consistent read-only policy.
- Large editors were imported eagerly; the section-list memo depended on the
  entire editor state.

## Implemented ownership

- Properties retains geometry, layout, opacity and blend, fills, strokes,
  basic image placement, component basics, and typography.
- Appearance owns masks, shared paints, and the full effect stack.
- Adjustments owns adjustment layers and image processing.
- Prototype owns interactions and the document flow.
- Audit owns adaptive contrast and cognitive-load diagnostics alongside
  intelligence audits.
- Document owns canvas background and document color mode.
- Tool Options owns brush settings, frame creation presets, and crop workflow.
- Export and Inspect remain explicit workflow tabs; the duplicate Score tab was removed.

The dedicated workflow modules are lazy-loaded. Workspace modes now determine
which tabs are normally visible, while image or adjustment selections expose
Adjustments contextually and action-registry commands can deep-link to every
workflow.

## Kept, moved, merged, and removed

- Kept in Properties: position and size, alignment, constraints, corner radius,
  layout, opacity and blend, fills, strokes, basic image placement, component
  basics, and typography.
- Moved to Appearance: masks, shared paint/style management, and effect stacks.
- Moved to Adjustments: adjustment layers, enhancement, background removal,
  colorization, denoise, lens blur, line art, content-aware fill, OCR, image
  blending, and palette extraction.
- Moved to Tool Options: brush behavior, frame creation presets, and crop/bounds.
- Moved to Prototype, Document, and Audit: interactions/flow, canvas and document
  color, and accessibility/intelligence diagnostics respectively.
- Merged image fitting into Image Placement; Crop now links into a focused tool
  workflow rather than repeating fit and edit-crop controls.
- Removed the duplicate Score tab. Its layout diagnostics remain searchable and
  available through Audit.

No moved editor gained a new document-state path: the dedicated surfaces reuse
the existing editor context commands and history behavior.

## Navigation and command changes

Searchable action-registry entries now open Properties, Appearance, Adjustments,
Prototype, Document, Export, Inspect, and Audit directly. A requested workflow
can temporarily appear even when it is not one of the current workspace mode's
default tabs, preserving command-palette deep links. Workspace mode
configuration is now the runtime source for inspector tab composition.

Inspector tabs implement the ARIA tabs keyboard pattern with roving focus:
Left/Right wrap, Home selects the first tab, and End selects the last. Compact
Properties summaries and empty states link directly to their canonical
workflow. At narrow widths, the inspector opens as an in-viewport drawer.

## Performance and accessibility

- Dedicated panels and tool editors use lazy imports and mount only while active.
- Registry applicability prevents unsupported section components from mounting.
- Heterogeneous selections no longer expose Typography, Stroke, or Effects when
  the whole selection cannot support the operation.
- Locked selections make selection workflows inert and announce the read-only
  state; hidden selections receive an explicit status.
- Mixed numeric values retain their existing accessible value text.
- The section manager now performs real show/hide operations, preserves order
  through migration, and scopes its choices to the Properties surface.
- The browser DOM budget records the rectangle reduction from 1,497 px and 276
  descendants to 511 px and 221 descendants.
- Token contrast remains 120/120 across light, dark, and high-contrast themes;
  reduced-motion behavior uses the existing design-system rules.

## Verification

Added or updated coverage includes:

- exhaustive feature-ownership and surface classification tests;
- section ordering, migration, applicability, and manager visibility tests;
- mixed heterogeneous selection tests;
- action registration and deep-link tests;
- locked-selection and workspace-mode composition tests;
- floating Tool Options keyboard/dialog tests;
- Chromium E2E tests for roving tab focus, moved Prototype/Document workflows,
  brush Tool Options, responsive drawer placement, and the Properties DOM budget;
- Chromium visual baselines for rectangle Properties and Document Settings.

Verified on CachyOS/Linux in the browser runtime and Chromium. Rust workspace
check, clippy with warnings denied, and all Rust tests pass. WebKit browser
execution was attempted but the Playwright WebKit binary is not installed.
Windows WebView2, macOS WKWebView, and native Tauri window automation were not
available in this environment.

Repository-wide JS verification was affected by concurrent work: 9,003 tests
passed and 14 failures were isolated to newly added archive encryption and
export compositor tests. The inspector-focused suite and all five new Chromium
E2E scenarios pass. Repository typecheck/build failures are in concurrent
flatten, adjustment, crop, and scene changes; no error is reported from the
new inspector modules. The architecture import-budget audit and both UI audits
pass.

## Future additions

`docs/architecture/inspector-feature-ownership.md` defines the placement
decision tree, required proposal metadata, session checklist, and rejection
rules. `featureOwnership.ts` is exhaustive over every registered section, so a
session adding a section without choosing an owner fails the test suite.

## Evidence-based limitations

- Typography still combines common and advanced controls in one component.
- Fill and Stroke still contain advanced stack editors in Properties.
- Export and Inspect still share some export/code controls with the full Export dialog.
- Plugin section contributions remain metadata-only because the API has no
  production render factory contract.
- Locked and hidden selection editing policy still needs a capability-level model.
- macOS WKWebView and Windows WebView2 were not available in this Linux environment.
