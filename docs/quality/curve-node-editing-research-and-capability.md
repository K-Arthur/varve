# Curve and Node Editing — Research Ledger and Capability Matrix

**Access date:** 2026-09-13  
**Scope:** authored vector paths, anchor nodes, Bézier handles, contours,
holes, topology editing, rendering, persistence, and export. Animation easing
curves and raster tone curves are out of scope, but animated/reference paths
are an integration concern.

This is an evidence record for the curve/node editing work. It is deliberately
split into three kinds of statements:

1. **Externally verified** — behavior or a platform contract supported by a
   primary specification or maintained product/library documentation.
2. **Observed in Varve** — behavior reproduced by source review, existing
   tests, or a runtime check against the current checkout.
3. **Varve decision** — an explicit product or implementation choice. It is
   not presented as a universal editor convention.

## Research ledger

| Source / version | Access date | Finding | Implementation consequence | Uncertainty |
| --- | --- | --- | --- | --- |
| [Inkscape Advanced Tutorial](https://inkscape.org/es/doc/tutorials/advanced/tutorial-advanced.html?switchlang=es), current documentation | 2026-09-13 | Cusp permits independent handles; smooth keeps handle tangents collinear; symmetric additionally keeps handle lengths equal; automatic smoothing also changes neighboring automatic nodes. | Varve must model corner/cusp, smooth, symmetric, and automatic smoothing as distinct behaviors. A handle existing is not enough to classify a node as smooth. | Inkscape’s exact automatic-smoothing formula is product-specific; Varve will document its own neighbor rule. |
| [Inkscape key and mouse reference](https://inkscape.org/sl/doc/keys.html), current documentation | 2026-09-13 | Node-mode conversion and break/join/delete actions have discoverable keyboard alternatives. | Node editing needs command/shortcut coverage in addition to pointer gestures. | Key labels vary by platform; Varve’s shortcut registry remains authoritative. |
| [Illustrator: Refine paths](https://helpx.adobe.com/illustrator/desktop/draw-shapes-and-paths/modify-paths/refine-paths.html) and [Anchor Point tool](https://helpx.adobe.com/uk/illustrator/using/tool-techniques/anchor-point-tool.html), current help | 2026-09-13 | Anchor conversion, independent handles, linked opposite handles, smoothing, and direct path manipulation are separate operations. | Handle creation/retraction and mode conversion must be explicit; a modifier may change continuity, but it must not silently force symmetry for every node. | Illustrator’s exact hit priorities and modifier mapping are not normative for Varve. |
| [Affinity Node Tool](https://s3-eu-west-1.amazonaws.com/affinity-docs/help/designer/en-US.lproj/pages/Tools/tools_node.html) and [editing curves](https://s3-eu-west-1.amazonaws.com/affinity-docs/help/designer/en-US.lproj/pages/CurvesShapes/edit_linesAndShapes.html), current help | 2026-09-13 | Sharp, smooth, and smart node conversion are exposed beside break, close, join, reverse, and shape-preserving deletion. | Essential topology commands belong in the path editing surface and should share geometry commands with shortcuts. | “Smart” is not necessarily the same algorithm as Varve automatic smoothing. |
| [Figma: Edit vector layers](https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers) and [vector networks](https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks), current help | 2026-09-13 | Vector edit has lasso/multi-selection, direct bend, cut, multi-node transforms, and separate handle mirroring choices (none, angle, angle+length). | Multi-selection and independent-vs-angle-vs-symmetric constraints are useful interoperability conventions. Touch alternatives must not depend on a hidden keyboard modifier. | Figma’s vector-network topology is broader than Varve’s current ring model; do not import that model partially. |
| [W3C SVG 2 Paths](https://www.w3.org/TR/SVG/paths.html) and [MDN `d`](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/d), current specifications/reference | 2026-09-13 | SVG path data includes moveto, line, cubic, quadratic, arc, and closepath; compound contours, open paths, and closepath are distinct. Paths can feed clipping, text-on-path, and animation. | The editor must preserve open/closed and contour semantics. Imported quadratics/arcs need a deliberate representation or bounded conversion, never an undocumented “lossless” claim. | Varve’s authored model currently stores cubic-compatible `PathPoint`s, so source command fidelity must be checked at import/export boundaries. |
| [Pomax Bézier Primer](https://pomax.github.io/bezierinfo/) and [UC Berkeley de Casteljau report](https://www2.eecs.berkeley.edu/Pubs/TechRpts/1986/6091.html), original algorithm explanations | 2026-09-13 | de Casteljau evaluates and subdivides a cubic at arbitrary parameter `t`; nearest-point search needs a candidate search plus numerical refinement and degenerate handling. | Insertion must use the actual nearest segment parameter and de Casteljau subdivision. Segment bending and closest-point code need scale-aware finite checks. | Closest-point refinement is numerical, not a single closed-form operation for all cubics; error budgets must be tested independently. |
| [W3C Pointer Events](https://www.w3.org/TR/pointerevents/), [MDN pointer capture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture), and [MDN `pointercancel`](https://developer.mozilla.org/en-US/docs/Web/API/Element/pointercancel_event) | 2026-09-13 | Capture retargets an active pointer; `pointercancel` and `lostpointercapture` are normal lifecycle paths for scrolling, viewport gestures, orientation changes, and palm rejection. | Capture only after accepting a target. Cancel/lost-capture/focus/tool changes must close or abort the gesture deterministically and release provisional state. | Browser/WebView behavior still needs runtime checks; spec conformance is not proof of identical desktop-WebView behavior. |
| [MDN `touch-action`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action) | 2026-09-13 | Touch arbitration is local to the intended surface; the browser can take a gesture and send `pointercancel`. | Do not globally disable scrolling/zoom. Scope canvas touch policy and make second-finger/pinch behavior explicit. |
| [WCAG 2.2 SC 2.5.7 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) | 2026-09-13 | Drag functionality needs a simple single-pointer alternative; keyboard support alone does not satisfy the requirement. | Provide tap-to-move/selected-target destination behavior where feasible, plus numeric inspector fields and keyboard nudging. | Conformance depends on the final UI and exception analysis; visual target size alone is not an alternative. |
| [Tauri WebView versions](https://v2.tauri.app/reference/webview-versions/) and [prerequisites](https://v2.tauri.app/start/prerequisites/) | 2026-09-13 | Tauri uses the operating system’s WebView: WebKitGTK on Linux, WKWebView on macOS, and WebView2 on Windows. | Browser Chromium tests and desktop WebView tests are separate evidence. A resized browser or user-agent is not a Chromebook or WebKitGTK test. | Actual ChromeOS hardware is unavailable in this environment and remains unverified. |

## Observed Varve behavior at baseline

These findings are from the current `master` checkout on Linux, source review,
and the passing baseline unit suites
(`packages/editor/src/tools/__tests__/NodeEditTool.test.ts` and
`packages/shared/src/bezierPathOps.test.ts`). Passing a unit test is not treated
as proof that the real canvas interaction works.

| Capability | Status | Reproduction / evidence | Severity and affected environments | Root-cause evidence | Regression coverage |
| --- | --- | --- | --- | --- | --- |
| Enter/exit node editing and basic single-anchor drag | **Partial** | Select a path, enter “Edit nodes”, click an anchor, drag, release; the existing capture workflow exercises this. | High; browser and desktop paths | `NodeEditTool` owns anchor drag and `NodeEditOverlay` renders the overlay, but there is no full workflow coverage for cancellation or compound topology. | Existing unit tests and `scripts/capture/workflows/bezier-node-edit.mjs`; real Playwright coverage to be added. |
| Multi-node pointer movement | **Broken** | Select one anchor, Shift-select another, then drag the already-selected anchor. The pointer path clears/replaces selection and updates only `draggingAnchorIdx`; keyboard nudge is a different path. | High; all pointer runtimes | `NodeEditTool.onPointerDown` clears selection unless Shift is held and `onPointerMove` calls `updatePathPoint` for one global index only. | New tool unit and Playwright drag test. |
| Compound contour/holes movement by keyboard | **Broken** | Enter node editing on a compound path/hole, select a hole anchor, press an arrow key. | High; imported/boolean/text-outline compound paths | Nudge maps only `shape.points`, while pointer/delete code uses `contours`/`holes`. | Compound contour nudge test plus saved/reopened fixture. |
| Handle continuity modes | **Broken/partial** | Drag an incoming handle on a one-sided/corner node without Alt, then drag the outgoing handle or change a modifier mid-drag. | High; mouse, stylus, and touch-with-alternative | Handle code mirrors opportunistically, creates the opposite handle inconsistently, samples Alt only at pointer-down, and has no persisted node mode. | Mode invariant tests and pointer modifier/cancel tests. |
| Node indicator classification | **Broken** | Give a node one handle or two handles of unequal length and inspect the overlay. | Medium; all themes | Overlay uses `handleIn !== null || handleOut !== null` as “smooth”. | Overlay render test with one-sided and symmetric cases. |
| Hit tolerance under non-uniform scale/shear | **Broken/partial** | Apply non-uniform scale or shear, zoom out, and click near a rendered anchor/handle at a constant CSS distance. | High; transformed paths, especially zoomed browser/WebView | Hit test converts to local space using one `hypot(worldMat[0], worldMat[1])` scalar; arbitrary affine screen distance is not represented. | Full-affine numerical hit tests and rotated/sheared Playwright fixture. |
| Camera-rotated overlay alignment | **Broken** | Rotate the camera, pan/zoom, then compare anchor overlay to the rendered path. | High; rotated camera only | `CanvasOverlays` does not pass camera rotation to `NodeEditOverlay`; its camera object is `{zoom, pan}`. | Independent renderer-vs-overlay alignment assertion and screenshot. |
| Invalid transform handling | **Partial** | Target a path with a singular/near-singular transform and click/drag. | High; malformed/imported documents | Pointer path calls unsafe `invertAffine`; nudge uses `tryInvertAffine` but the gesture path does not. | Singular affine tests; malformed import fixture. |
| Selection-only click/history | **Partial** | Click an anchor without moving, then undo. | Medium; all runtimes | Transaction begins in `onPointerDown` before movement threshold; commit behavior depends on current history implementation. | No-op history E2E and transaction unit test. |
| Pointer cancellation/lost capture/focus loss | **Broken/partial** | Start an anchor/handle drag, trigger Escape, blur, `pointercancel`, or lose capture, then undo or switch tools. | Critical; touch, stylus, browser tab changes, desktop WebViews | `NodeEditTool` has no `onPointerCancel`; deactivation/focus loss commits nudge state but does not abort/reset an active pointer gesture. | Pointer lifecycle Playwright tests and direct tool tests. |
| Stable selection identity across topology | **Partial** | Select nodes, insert/delete/reverse a contour, then inspect selection. | High; node editing and topology commands | Selection is a flat `Set<number>` over concatenated ring indices; there is no stable point id or operation remapping. | Explicit remap tests for each topology operation. |
| Shared insertion/nearest-point geometry | **Disconnected** | Call the shared `bezierPathOps` insertion/nearest helpers; then use NodeEdit UI. | High; insertion is absent from the tool/UI | Shared helpers are only referenced by their own tests; `NodeEditTool` has separate local update/delete code. | Integration tests must exercise the shared command through UI. |
| Essential topology operations | **Missing/partial** | Inspect node-edit controls and command registry for insert/split/break/join/reverse/line-curve conversion. | High; desktop and browser | Current quick-bar path actions expose Edit nodes, Simplify, Flip, Open/Close; node tool exposes delete and a two-state toggle only. | Command/UI Playwright matrix plus geometry invariants. |
| Precise node/handle inspector and drag alternative | **Missing** | Enter node edit and inspect controls for anchor/handle fields or tap-to-move. | High; keyboard/touch accessibility | No node-edit inspector surface is connected to `NodeEditTool`; WCAG alternative is not met by arrow keys alone. | Accessibility and keyboard/touch E2E coverage. |
| Persistence/import/export round trip | **Unverified** | Save/reopen a path with compound contours and handles; copy/export/import SVG; inspect values. | Critical for user data; browser/desktop/export paths | Existing path schema has `points`, optional `contours`/`holes`, and relative handles, but node-edit-specific topology/mode metadata has no completed contract. | Round-trip fixture tests and UI save/reopen/export workflow. |
| Animated/referenced path correspondence | **Unverified** | Edit topology on a path referenced by motion/text-on-path/mask/boolean/effect systems. | Critical where feature is used | SVG documents path animation/text-on-path dependencies; current node-edit path does not visibly enforce a topology policy. | Dependency audit and explicit restrict/convert behavior test. |

## Failure reports worth designing against

These are not claims that Varve has the same bugs. They are public evidence of
failure modes that users notice and that Varve can realistically avoid.

| Reported failure mode | Source | Varve response |
| --- | --- | --- |
| Direct-selection/hand-tool state becomes confusing after temporary panning. | [Adobe Community: direct selection and hand tool](https://community.adobe.com/questions-652/issue-with-the-direct-selection-tool-and-hand-tool-813427) | Keep node-edit scope and tool transitions explicit; cancel/commit interactions before switching tools and announce the resulting state. |
| Visible handles are difficult to select, especially with a pen display. | [Adobe Community: cannot select a visible handle](https://community.adobe.com/questions-652/i-can-see-but-can-t-select-the-handle-of-an-anchor-point-794655) | Use a full-transform screen-space tolerance, deterministic anchor/handle priority, and an inspector/tap alternative rather than only enlarging overlapping hit boxes. |
| Handles or anchors disappear while manipulating a path. | [Adobe Community: disappearing control handles](https://community.adobe.com/questions-652/illustrator-23-the-control-handles-used-to-manipulate-a-curve-disappear-805743), [path/anchor visibility report](https://community.adobe.com/questions-652/path-and-anchor-points-disappearing-when-i-move-a-point-with-the-direct-selection-tool-771849) | Keep overlays aligned to the authoritative camera and test the artwork and overlay separately; do not hide selected geometry during drag/culling. |
| Node jumps, self-moves, crashes, or becomes inaccurate at extreme zoom. | [Inkscape node jump report](https://gitlab.com/inkscape/inbox/-/work_items/12813), [slow corner-node report](https://gitlab.com/inkscape/inkscape/-/issues/2555), [max-zoom cusp report](https://gitlab.com/inkscape/inkscape/-/issues/704) | Snapshot gesture transforms, reject non-finite/singular math, retain full precision, and test zoom extremes with numerical rather than screenshot-only assertions. |
| Touch multi-selection and modifier shortcuts are awkward or conflict with snapping. | [Affinity touch multi-select report](https://forum.affinity.serif.com/index.php?%2Ftopic%2F87925-node-tool-not-selecting-multiple-nodes-when-using-one-finger-and-tapping%2F=), [Affinity Alt conflict report](https://forum.affinity.serif.com/index.php?%2Ftopic%2F93672-interface-alt-hotkey-conflict-on-node-tool%2F=) | Offer tap-to-move and visible controls for mode/selection actions; do not make ordinary touch editing depend on Alt/Option. |
| A changed vector-point drag model slows ordinary editing; selection handles flicker. | [Figma vector-point drag report](https://forum.figma.com/report-a-problem-6/vector-points-no-longer-act-as-drag-anchors-really-slowing-down-workflow-maybe-a-modifier-key-to-bring-it-back-50622), [Figma handle flicker report](https://forum.figma.com/ask-the-community-7/resizing-and-repositioning-nodes-causes-user-s-selection-handles-to-flicker-11707) | Preserve the conventional selected-anchor drag, use a potential-drag threshold before mutation, and verify stable overlay state in recordings/screenshots. |
| Direct selection can pick an unexpected path/object. | [Adobe Community: wrong direct-selection target](https://community.adobe.com/questions-652/problems-with-selecting-a-path-direct-selection-illustrator-29-4-815356) | Scope node editing to one authoritative target path; do not introduce unsafe multi-object local-coordinate editing. |

## Post-implementation status (2026-09-13)

The foundational pass now implements the core decisions above. The updated
capability status is:

| Area | Current status | Evidence |
| --- | --- | --- |
| Single and multi-anchor movement, holes, keyboard nudge | **Working** | Canonical `pathRings` mutation, transformed-tool tests, group-drag and compound-ring tests. |
| Full-transform hit testing and camera-rotated overlay | **Working in code; browser visual lane pending** | Screen-space numerical tests cover rotation/non-uniform affine and closing segments; real Playwright visual evidence is tracked separately from unit results. |
| Corner, smooth, symmetric, automatic modes | **Working** | Explicit mode helpers, invariant tests, keyboard/control affordances, and persisted optional mode. |
| Insertion, deletion, reverse, open/close, line/curve controls | **Working for the scoped single-path model** | de Casteljau insertion, selection remaps, ring-aware deletion/reversal, controls, and focused tests. |
| Transaction cancellation and no-op selection | **Working in tool contract** | Pointer-cancel, Escape/focus cleanup, and selection-only transaction tests. |
| Dependent path topology | **Safely restricted** | Text-on-path, masks, motion/timeline, effects/scopes, component, and interaction references receive an actionable block. |
| Undo/redo after a canvas gesture | **Working in code; post-fix browser lane unverified** | The direct control restored the edit in a real capture; a focused shortcut test verifies capture-phase Ctrl/Cmd+Z and Shift+Z dispatch. The post-fix browser capture attempts crashed before completing. |
| Break/split separate paths, endpoint join, shape-preserving general deletion | **Missing/deferred** | Controls expose a disabled explanation; no silent approximation is presented as complete. |
| Physical ChromeOS and Linux WebKitGTK visual lanes | **Unverified** | This host provides browser automation and Linux tooling, not the actual Chromebook hardware lane. |

The original matrix remains the baseline audit and is intentionally retained so
future changes can distinguish an observed defect from a feature that was
deliberately deferred.

## Varve decisions and validation contract

These are proposed product decisions for implementation, not claims about what
all editors must do:

- **Canonical geometry:** a path operation reads and writes the authored ring
  representation. Legacy `points`/`holes` are kept synchronized when present;
  no operation may update only `points` if the document also has `contours`.
- **Handle space:** handles remain relative local vectors. Moving an anchor
  translates the anchor and leaves its vectors unchanged; affine translation
  is never applied to a vector.
- **Node modes:** `corner` allows independent handles, `smooth` aligns tangent
  directions while permitting different lengths, `symmetric` aligns and equalizes
  lengths, and `automatic` derives handles from neighboring anchors. Manual
  handle movement leaves automatic mode in a documented mode transition.
- **Selection identity:** the current document schema does not have stable point
  ids. Until a compatible schema extension is justified, topology commands must
  return an explicit old-index-to-new-index remap and selection is updated from
  that remap. A flat index must never silently point at a different node.
- **Gesture transaction:** potential drags mutate neither geometry nor history;
  accepted drags make one transaction; no-op clicks make no history entry;
  Escape, pointer cancellation, lost capture, focus loss, target deletion, and
  tool changes abort provisional edits and restore the pre-gesture document.
- **Hit testing:** candidates are transformed to screen/canvas CSS pixels with
  the same complete node and camera transform as rendering. Hand-motion
  thresholds remain CSS-pixel values and are never divided by zoom.
- **Topology safety:** open/close, break, join, reverse, insert, split, and
  delete are separate commands. A command that would invalidate an animation,
  mask, text-on-path, live boolean, or other topology dependency is blocked or
  explicitly converts/rebinds it; it never silently corrupts correspondence.
- **Verification:** each meaningful interaction change requires a numerical
  geometry test, a real Playwright pointer/keyboard test, and inspected visual
  evidence. Chromium is the browser baseline in this environment; Linux
  WebKitGTK and actual Chromebook hardware are separate evidence lanes.

The implementation plan follows these decisions in dependency order: canonical
ring helpers and remapping, gesture/hit/camera correctness, node modes and
topology commands, accessible controls, then persistence/export/dependent
features and measured performance.

## Final validation evidence (2026-09-13)

The focused geometry and document checks passed after the implementation pass:

- `packages/shared/src/pathEditing.test.ts` — 8 tests passed, including
  automatic-tangent refresh after anchor movement.
- `packages/shared/src/bezierPathOps.test.ts` — 23 tests passed, including the
  nearest-point distance-unit regression.
- The editor node-tool, geometry, control, topology-dependency, and
  document-codec suites passed together with the shared path suites in one
  clean run: 7 files and 96 tests passed. The run used one Vitest worker
  because the shared machine was also carrying unrelated jobs.
  The added compound-hole coverage verifies automatic tangents, closing
  segment insertion/hit testing, and the corresponding control guard when the
  outer contour is open.

The real capture workflow
(`pnpm capture:workflow bezier-node-edit --no-mp4`) exercised the application,
not a mock geometry helper. The successful pre-shortcut-fix run recorded and
asserted entering node editing, four real anchors, anchor dragging, handle
dragging, undo, and redo; its product assertions passed, but the generated
WebM was 43.2 seconds, outside the 14–26 second delivery window. The inspected
mid-edit frame showed the rendered path, anchors, handles, explicit mode
controls, numeric fields, and topology controls; the final frame showed the
normal selection state. A later direct-control diagnostic completed the same
sequence at 26.7 seconds, with only the duration verifier finding, but it used
the enabled Undo control rather than the keyboard shortcut and is not treated
as post-fix keyboard proof.

The focused `useShortcuts` test passed for capture-phase undo/redo dispatch and
action recording. Two post-fix real Chromium capture attempts crashed the
renderer (one during startup, one during the first drawing gesture) before
assertions completed, so no clean post-fix browser capture is claimed. The
capture helper now uses a bounded whole-canvas fingerprint for mutation checks
and retains full visual-frame sampling; its next clean run should be repeated
on an idle machine.

The committed Playwright regression
(`tests/e2e/canvas/node-editing.spec.ts`) drives pointer events through the real
canvas and checks artwork pixels independently of the SVG overlay. Several
reruns were attempted on isolated Vite ports. The host was simultaneously
running other browser and test jobs; attempts either selected only one node,
timed out during app startup, hit a concurrent Vite export mismatch, or lost
the Chromium page. The corrected spec has not therefore been reported as
passed. One run did provide direct event evidence for a real defect: the
second Shift-click targeted the overlay's transparent SVG `rect`, and the
canvas never received the additive `pointerdown`. `NodeEditOverlay` now marks
the group and each visual primitive `pointer-events="none"`, keeping selection
on the canonical canvas pipeline. Later reruns reached the app but hit a page
reload during startup or a render-readiness timeout; no clean post-fix spec
pass is claimed. Physical Chromebook/ChromeOS and a real Tauri WebKitGTK
window remain unverified; this host only confirmed Headless Chromium 151
pointer capture, `pointercancel`, `touch-action`, and device-pixel-ratio APIs,
plus installed WebKitGTK 2.52.x libraries.

No 50k-anchor performance benchmark is claimed for this milestone. The
nearest-point unit regression and automatic-tangent refresh are linear in the
affected rings, but a representative drag/frame profile still needs an idle
machine and should be run before broadening the editing scope.
