# Shape-building capability audit — 2026-09-13

Status: implementation baseline and product contract. This document separates
verified external behavior, repository observations, hypotheses, and Varve
decisions. It is updated as the implementation milestones land.

## Scope and method

The audit covers the path from selected scene nodes through construction
geometry, region selection, reconstruction, scene mutation, history, rendering,
and export. The initial repository review was performed on `master` at
`9803f33ab1c77279ee2dff33741809764479f1a6` on Linux (CachyOS/Arch), with the
web and Tauri entry points inspected separately. The working tree already
contains unrelated staged and unstaged work; those changes are not attributed
to this feature.

The research pass used primary product documentation, standards, maintained
library documentation, and upstream issue/merge-request records. Access date
for the sources below is 2026-09-13.

## Compact research record

| Source / applicable version | Finding | Implementation consequence | Uncertainty |
| --- | --- | --- | --- |
| [Illustrator Shape Builder](https://helpx.adobe.com/uk/illustrator/using/creating-shapes-shape-builder-tool.html), current help | Regions can be merged by sweep, erased with Alt, and edges can be deleted; the start region can supply styling. | Keep region selection distinct from whole-object booleans; make erase and edge behavior explicit. | Adobe’s exact handling of all mixed-style and open-path cases is version-dependent. |
| [Illustrator shape construction](https://helpx.adobe.com/nz/illustrator/using/building-new-shapes-using-shape.html), current help | Compound paths, regions, gap detection, open-filled-path treatment, and style-source choices are separate concepts. | Do not silently close gaps or silently convert strokes/open paths; expose policy and preview inferred closures. | Some controls differ between desktop and web help surfaces. |
| [Affinity Designer 2 Shape Builder](https://affinity.help/designer2/English.lproj/pages/ObjectControl/join_shapeBuilder.html), v2 help | Staged candidate selection supports Add/Delete/Create; Create retains originals, Add replaces affected originals; cleanup is configurable. | Use a staged session with Apply/Cancel and distinguish retained-source creation from destructive replacement. | Affinity’s internal topology and live-update policy are not public. |
| [Affinity boolean operations](https://affinity.help/designer2/English.lproj/pages/ObjectControl/join.html), v2 help | Whole-object Add/Subtract/Intersect/Xor/Divide is separate from Shape Builder and source order matters. | Preserve ordinary Boolean commands as separate commands and APIs. | None material for the contract. |
| [Affinity compounds](https://affinity.help/designer2/English.lproj/pages/ObjectControl/compound.html), v2 help | A compound can remain editable and its sources can be changed or broken apart. | Only call retained-source output “live” when Varve actually stores a recomputable recipe. | Varve does not yet promise live arbitrary face recipes. |
| [Inkscape boolean operations](https://inkscape-manuals.readthedocs.io/en/1.3/boolean-operations.html), Inkscape 1.3 manual | Path booleans include Combine/Break Apart and operations whose result depends on stacking order. | Preserve fill rules, source order, and compound-path component boundaries. | Manual does not define every malformed-import case. |
| [Inkscape 1.3 release notes](https://wiki.inkscape.org/wiki/Release_notes/1.3) | Fracture cuts overlapping areas into separate objects without overlap. | Document Divide ownership and avoid fabricating connectors between disconnected outputs. | Fracture is not a complete analogue for a region-selecting builder. |
| [CGAL arrangement documentation](https://doc.cgal.org/latest/Arrangement_on_surface_2/index.html), 6.2.1 | Arrangements model vertices, directed half-edges, faces, holes, an unbounded face, and provenance-capable DCEL records. | Use explicit face identity, adjacency, edge multiplicity, provenance, and an excluded unbounded face. | Varve uses a lightweight TypeScript arrangement, not CGAL or exact constructions. |
| [SVG 2 painting](https://www.w3.org/TR/SVG2/painting.html) and [paths](https://www.w3.org/TR/SVG2/paths.html), SVG 2 | An open subpath is implicitly closed for fill; fill rules and stroking are independent. | Separate filled-area, divider, and stroke-area interpretations; reject unsupported stroke workflows instead of using bounds. | Browser renderer details can still differ at pathological floating-point edges. |
| [Pointer Events 3](https://www.w3.org/TR/pointerevents3/), current recommendation | Pointer capture retargets a gesture; cancellation and primary-pointer compatibility behavior must be handled. | Keep an explicit gesture state machine, pointer IDs, capture loss, cancellation, and touch arbitration. | Device-specific stylus firmware can expose additional quirks. |
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/), current recommendation | Keyboard access, pointer cancellation, non-drag alternatives, and a 24 CSS-pixel target-size minimum matter. | Provide click/tap selection plus action buttons, keyboard entry/exit/cancel, and accessible status/control targets. | Target-size exceptions may apply to dense canvas content, not to the tool controls. |
| [Shewchuk robust predicates](https://people.eecs.berkeley.edu/~jrs/papers/robustr.pdf), 1997 | Adaptive precision predicates are needed near degeneracy; a blanket epsilon is not a robustness proof. | Use scale-aware dimensional tolerances plus explicit degeneracy diagnostics; do not claim exactness. | The current kernel remains floating-point and polygonal. |

### Failure reports that shaped the mitigations

These are issue and merge-request reports, not statistical proof. They are
useful evidence of realistic failure modes users notice:

- [Inkscape Shape Builder MR 4709](https://gitlab.com/inkscape/inkscape/-/merge_requests/4709)
  records crashy exits, missed small regions during fast movement, ignored
  transforms in groups, style/z-order surprises, and stale interaction state.
- [Inkscape fracture issue 3828](https://gitlab.com/inkscape/inkscape/-/issues/3828)
  shows a snapped circle/rectangle case producing the wrong number of pieces.
- [Inkscape fracture crash 10717](https://gitlab.com/inkscape/inbox/-/issues/10717)
  records a CLI crash on a fracture/export path.
- [Inkscape compound-path issue 5045](https://gitlab.com/inkscape/inkscape/-/issues/5045)
  documents winding/order errors that appeared to disappear after a geometry
  perturbation.
- [Adobe curved-shape report](https://community.adobe.com/questions-652/adobe-illustration-2023-problem-with-shape-builder-tool-and-curved-shapes-808361)
  reports gaps and bumps around curved shapes and long handles.
- [Adobe no-region report](https://community.adobe.com/questions-652/shape-builder-tool-problem-773424)
  reports an apparent no-op on an anti-circle and unsuccessful gap repair.
- [Inkscape transformed-circle issue 3612](https://gitlab.com/inkscape/inkscape/-/issues/3612)
  records inaccurate differences after strong scale transforms.

The practical Varve responses are: transform geometry before error testing,
cross faces between pointer samples, show eligibility and failure reasons,
preserve authored winding, use atomic cancellation, and stop safely at
complexity limits instead of committing a truncated graph.

## Repository observations

Verified by source inspection before implementation:

| Area | Status | Evidence and consequence |
| --- | --- | --- |
| Whole-object Boolean engine | Working / partial | `packages/scene/src/boolean/engine.ts` and `integration.ts` provide N-ary polygon-clipping booleans, holes, components, and browser/desktop parity. This is reusable reconstruction infrastructure, not a region-selection tool. |
| Self-intersection decomposition | Partial | `self-intersection.ts` splits one polygon and traverses half-edges, but has no multi-operand provenance, authored fill-rule classification, or persistent face identity. |
| Curve conversion | Broken for the requested guarantees | Existing flatness uses a cross-like quantity and samples before the complete transform; the depth cap can return an unqualified endpoint segment. Long handles, coincident endpoints, and shear therefore need targeted repair and tests. |
| Fill classification | Partial / risky | `region.ts` normalizes contour winding before nonzero classification; that can erase the authored winding information required for nonzero holes and nested islands. |
| Open paths and strokes | Explicitly limited | Current Boolean eligibility rejects open paths and expects stroke outlining elsewhere. Shape Builder must not broaden this silently or substitute a bounding box. |
| Live Boolean groups | Working for their narrower model | `liveBoolean.ts` recomputes supported whole-object operations, but it cannot encode arbitrary selected face sets or stale face identity safely. |
| Editor tool routing | Implemented / browser evidence pending | Shape Builder registration, pointer capture/cancellation, staged overlay, action buttons, keyboard shortcuts, and one-transaction commit are wired; runtime evidence is recorded below. |
| History/document mutation | Working primitives | `EditorContext` exposes atomic `updateDoc`, transactions, undo/redo, and selection. A Shape Builder action must use those primitives once per accepted session. |
| Rendering/export | Working infrastructure, feature missing | Shape nodes, compound contours, SVG/PDF resolvers, Layers, and node editing exist; a new result must use ordinary editable path nodes and real contour rings. |
| Website/help | Implemented | In-app help, What Is This lookup, public guide, vector-tools guide, feature card, and marketing copy now describe the verified workflow and limitations. |

## Product contract

Shape Builder is a staged, per-selection construction session. Hovering and
selecting only change tool state. Apply commits one atomic document transaction;
Cancel/Escape restores the pre-session document and selection without a history
entry.

Eligible input is visible, unlocked, editable filled geometry in the current
isolation scope: primitive shapes and closed paths/compound paths whose rendered
fill can be converted to construction rings. Ancestor/descendant selections are
deduplicated. Locked/hidden content, masks/clips, instances/layout-managed
children, live effects, open paths, visible strokes, images, unexpanded text,
and live Boolean groups are reported with the required explicit action (for
example, “Outline Stroke” or “Expand live result”); they are never silently
flattened, detached, or outlined.

The operation meanings are:

| Action | Result |
| --- | --- |
| Merge | Replace the selected filled regions with one editable compound output and preserve all unselected source regions. Internal boundaries disappear only where the selected set permits. |
| Erase | Remove selected regions from participating sources; unrelated regions and unselected objects remain. An empty source is removed only if reference safety permits it. |
| Extract | Create separate editable output components for the selected regions and remove those areas from their sources. |
| Create | Create the selected-region output while retaining the original operands. Overlap is intentional and communicated. |
| Divide | Produce separate editable outputs for selected connected regions/components, with no artificial connecting segments, and remove the selected areas from sources according to the explicit cleanup policy. |

The unbounded exterior is never selectable. Bounded faces classified as empty
under the authored fill rules are not selectable in the first implementation;
creating an island in such a face is a separate, explicit future operation.
Open boundary fragments are preserved only when an operation can represent them;
the first committed builder result is closed filled geometry. Edge removal is
not treated as region deletion: removing an internal divider may merge faces,
while removing an exterior edge can open a result and is not silently done.

Disconnected results are separate path nodes where separate editability is
meaningful; each node stores compound rings for its holes and components. No
ring is joined to another with an invented segment.

Style ownership for a newly created output is the first selected eligible source
and is shown in the tool status. Existing source remainders keep their own
styles. New outputs do not inherit independent multi-source opacity/effect
stacks or visible strokes implicitly; unsupported style combinations are
reported or split into separate outputs. Paint transforms are rebased with the
result’s world placement.

## Required topology and numerical invariants

- A face reference is keyed by geometry revision, canonical boundary signature,
  and provenance—not by an array index.
- Half-edges retain direction, multiplicity, source ID, contour/segment
  references, and parameter intervals where available.
- Authored even-odd/nonzero fill classification happens per operand before
  faces are combined; extra rings are not assumed to be holes.
- Holes, nested islands, shared boundaries, duplicate/coincident edges,
  tangencies, endpoint contacts, and disconnected components are represented
  explicitly. The unbounded face is represented for classification but omitted
  from selectable output.
- Linear/area/angular/parameter and CSS-pixel tolerances remain separate. The
  construction tolerance is evaluated after the complete world transform.
- Approximation is bounded and reported as approximation. A recursion or
  complexity budget failure is an actionable error, never a truncated commit.
- Candidate preview may use a cheaper representation only when it identifies
  the same face set that committed geometry will use.

Initial budgets are deliberately finite and observable: 64 source objects,
20,000 construction segments, 300,000 candidate pairs, 100,000 intersections,
10,000 faces, and 100,000 generated vertices. These are safety limits, not a
license to drop small regions.

## Capability matrix and regression plan

| Capability | Baseline | Target evidence |
| --- | --- | --- |
| Two overlapping rectangles: regions, areas, boundaries, remainders | Working / verified in scene | Scene tests cover 15,000 union / 5,000 intersection / 5,000 difference / 10,000 XOR, face ownership, disconnected components, destructive remainders, and stale revisions; real UI E2E is the remaining gate. |
| Circles/curves and transformed artwork | Partial / bounded | Independent deviation checks cover transformed cubic and ellipse conversion; reconstructed results remain documented polygonal approximations and screenshot/node-edit inspection remain required. |
| Rendered rounded rectangles and negative-direction geometry | Working / scene verified | Rounded-rectangle hit testing uses the rendered boundary, including per-corner radii, transformed arc sampling, and negative-direction rectangles; continuous/smoothed corners remain explicitly unsupported. |
| Donuts, nested islands, compound paths | Working / scene verified | Fill-rule-aware arrangement tests preserve a donut hole and reject artificial connectors; save/reopen/export visual evidence remains required. |
| One self-intersecting path | Partial | Arrangement API supports one selected source; a dedicated self-intersection UI fixture remains to be added. |
| Shared/tangent/coincident/near-coincident geometry | Partial / guarded | Deterministic no-phantom-face tests and finite-coordinate assertions exist; broader degeneracy fixtures remain. |
| Open boundaries, strokes, and gaps | Missing | Explicit eligibility message in v1; no silent closure or bounding-box fallback. |
| Staged selection, sweep crossing, idempotence, touch/keyboard/cancel | Implemented / browser evidence partial | Scene/editor tests cover fast face crossing, touch multi-select toggling, and pointer cancellation; manual browser evidence covers entry, sweep, preview, and staged status, while final Create/Undo/Redo/Node Edit runner coverage remains blocked by Chromium crashes under concurrent load. |
| Source retention, style, hierarchy, references | Partial | Create retains sources, destructive references are guarded, and outputs are ordinary path nodes; save/reopen/export and mixed-style evidence remain. |
| Browser/Tauri parity and constrained-device behavior | Partial | Browser tool is wired and desktop/editor builds are available; a clean browser E2E and measured constrained-device run remain. |

This matrix is intentionally not marked complete until the linked tests and
inspected visual evidence exist. Validation receipts and artifact paths will be
appended below at each implementation milestone.

## Product decisions versus hypotheses

Decisions: use a lightweight arrangement model in `@varve/scene`; reuse the
existing polygon kernel only for bounded reconstruction; use ordinary editable
compound path nodes for committed output; make Create retained-source and Merge
destructive; keep whole-object Booleans separate; use a staged Apply/Cancel
session; support ordinary rendered rounded rectangles but reject continuous
corner smoothing; reject unsupported stroke/open/masked/live inputs explicitly.

Hypotheses to verify: the current scene path representation can preserve enough
curve provenance for unchanged portions without a new native kernel; the
existing document mutation API can preserve world placement under nested
parents; the overlay layer can render candidate faces without intercepting the
canvas pointer stream; and the current SVG/PDF resolvers preserve compound
holes and authored fill rules for the new path nodes.

## Validation receipts

The repository was already dirty before this audit. The initial impact planner
therefore reports a broad affected closure caused by unrelated generative,
import, font, and background-removal work. Feature-specific commands are listed
with their exact scope as implementation lands; unrelated baseline failures are
not attributed to Shape Builder.

### 2026-09-13 implementation receipt

- Scene geometry: `packages/scene/src/shapeBuilder.test.ts` passed 14/14,
  including the rectangle area oracle, thin-face sweep, donut hole,
  disconnected output, one self-intersecting path under its authored fill rule,
  retained-source Create, destructive remainders, stale revision rejection,
  rendered rounded-rectangle hit testing, negative-direction per-corner
  geometry, mixed-scale placement, and zero-area primitive rejection.
- The document-codec round-trip fixture covers a created compound result with a
  hole and passed as part of the 14/14 scene run; the arrangement remains
  derived state rather than a second serialized authority.
- Independent curve checks in `packages/scene/src/boolean/integration.test.ts`
  passed 3/3: a transformed cubic remains below the 0.08-unit fixture budget,
  and a strongly sheared/non-uniformly transformed ellipse remains below the
  0.011-unit world-space budget. Neither compares two paths through the same
  conversion helper.
- Editor tool tests passed 2/2: touch multi-select taps add/remove a face
  idempotently, and pointer cancellation restores the staged face set.
- Real browser interaction: Playwright drove the browser application in an
  isolated worktree on Linux, created two rectangles through the UI, entered
  Shape Builder from the visible toolbar, swept three regions, and the status
  announced “3 regions selected”. The inspected artifacts were
  `/var/tmp/shape-builder-before.png`,
  `/var/tmp/shape-builder-selected.png`,
  `/var/tmp/shape-builder-entered.png`, and
  `/var/tmp/shape-builder-during.png`.
- Visual review confirmed separate source outlines, patterned selected faces,
  teal candidate output, the staged action panel, and the two selected layers.
  The final Create/Undo/Redo/Node Edit portion is covered by
  `tests/e2e/canvas/shape-builder.spec.ts`, but the full clean browser runner
  was not green on this shared machine: Chromium crashed during startup while
  unrelated E2E suites were concurrently consuming renderer memory. That
  portion remains unverified rather than being reported as passed.
- The website source was checked with the Shape Builder guide and feature-card
  links present; the guide documents rounded-rectangle support and explicit
  unsupported-input behavior. A clean website build remains part of the
  affected validation run.
