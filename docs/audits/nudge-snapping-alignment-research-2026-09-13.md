# Precision placement research and integration audit

**Access date:** 2026-09-13  
**Checkout:** `master` (Varve)  
**Scope:** keyboard nudging, pointer snapping, alignment, distribution, feedback,
focus ownership, and low-resource desktop/browser use.

This is an evidence record for the current implementation. External products are
used to identify established interaction conventions and failure reports, not as
requirements for copying their shortcuts or defaults.

## Consequential research

| Source | Applicable version / status | Finding | Varve consequence |
| --- | --- | --- | --- |
| [Figma: Set small and big nudge values](https://help.figma.com/hc/en-us/articles/4404575206295-Set-small-and-big-nudge-values) | Current Figma Help page, accessed 2026-09-13 | Small and big Arrow-key movements are independently configurable; the documented defaults are 1 and 10 resolution-independent points. | Keep the two amounts independent, allow fractional positive values, and store the canonical value separately from its display unit. |
| [Adobe Illustrator: Align and distribute objects](https://helpx.adobe.com/au/illustrator/desktop/manage-objects/arrange-objects/align-and-distribute-objects.html) | Illustrator desktop help, updated 2026-06-25 | Alignment can use selection bounds, an anchor/key object, or the artboard. A key object is explicitly selected again and remains stationary. | Make the reference visible and mode-specific; never infer a key object from incidental selection order. |
| [Affinity Designer 2: Snapping](https://affinity.help/designer2/en-US.lproj/pages/DesignAids/snapping.html) | Affinity Designer 2 help, current page accessed 2026-09-13 | Snapping has separate target families and scopes for grids, guides, margins, artboards, bounding boxes, key points, geometry, and text baselines. It also documents screen tolerance, visible-only filtering, exclusions, and a temporary override. | Keep candidate scope, tolerance, pixel alignment, and temporary bypass separate. Preserve target identity so a sticky lock can be invalidated rather than held against a replaced target. |
| [W3C Pointer Events](https://www.w3.org/TR/pointerevents/) | Pointer Events specification, accessed 2026-09-13 | Pointer capture, `pointercancel`, and `lostpointercapture` define the lifecycle needed for reliable drags and cancellation. | Treat cancellation and capture loss as distinct cleanup paths and clear transient snap guides/locks when the gesture ends. |
| [WAI-ARIA toolbar pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/) | WAI-ARIA Authoring Practices, accessed 2026-09-13 | A toolbar is a grouped set of controls with a deliberate focus model; arrow keys commonly move focus between toolbar controls. | Do not let canvas-level Arrow handling steal focus-navigation events from a focused toolbar or numeric control. |
| [WCAG 2.2 target-size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | WCAG 2.2 understanding document, accessed 2026-09-13 | Pointer targets should be at least 24 × 24 CSS pixels unless an exception applies. | Keep nudge, alignment, snap, and gap controls usable at compact desktop widths and provide click/tap alternatives to keyboard-only movement. |

## Failure reports worth resolving

These are public user reports, so they are evidence of recurring pain rather than
proof that every version or platform behaves the same way.

| Report | Repeated complaint | Realistic Varve response |
| --- | --- | --- |
| [Illustrator Smart Guides and snapping](https://community.adobe.com/questions-652/improvements-to-smart-guides-and-snapping-797545) | A distant object on another artboard can win over the nearby intended target; users ask for scope and tolerance control. | Scope candidates to the active editing surface, preserve explicit page/frame targets, and rank stable identities instead of array order. |
| [Illustrator anchor-point snap off by 0.005 px](https://community.adobe.com/t5/illustrator-discussions/illustrator-cc-snap-to-anchor-points-off-by-0-005-px/td-p/10015810) | Users see small but consequential residual errors after snapping. | Keep document precision, use one authoritative correction, and test transformed/fractional geometry numerically rather than rounding coordinates. |
| [Illustrator inconsistent snapping](https://community.adobe.com/t5/illustrator/snapping-is-inconsistent-in-illustrator-2019-on-mac/td-p/10504210) | Snapping appears unreliable when competing targets or interaction state changes. | Define priority and deterministic tie-breaking, retain target identity in feedback, and release sticky locks from raw intent. |
| [Illustrator snap-to-grid behavior](https://community.adobe.com/questions-652/snap-to-grid-behavior-not-working-768170) | Grid snapping and arrow movement can be confused, especially with fractional group positions. | Exact nudging remains independent of magnetic snapping and pixel/grid alignment is an explicit mode. |
| [Affinity snapping stopped working](https://forum.affinity.serif.com/index.php?%2Ftopic%2F215182-solved-designer-all-of-sudden-snapping-is-not-working-any-longer%2F=) | Candidate visibility/scope settings can make snapping appear dead. | Make snap enablement and candidate categories discoverable, keep hidden targets out of feedback, and expose the active scope in the UI/docs. |
| [Figma pixel snapping changed fractional positions](https://forum.figma.com/ask-the-community-7/pixel-snapping-not-working-anymore-snaps-to-decimal-value-14845) | Pixel alignment is mistaken for ordinary snapping, producing surprising decimal or integer results. | Do not globally round positions; keep the reference pixel grid and ordinary nudge/geometry snapping distinct. |
| [Figma distance overlays missing](https://forum.figma.com/report-a-problem-6/can-t-see-distances-between-elements-even-in-design-mode-and-after-trying-everything-45338) | Feedback can disappear or describe a relationship that is not actually applied. | Derive arrangement guides from the post-command result and show the reference/gap that was used. |
| [Figma canvas accessibility](https://www.figma.com/blog/building-accessibility-into-a-canvas-based-product/) | Canvas interactions need a parallel accessible control path and clear focus behavior. | Retain Inspector numeric controls, toolbar actions, announcements, and non-drag placement alternatives instead of making a pointer gesture the only route. |

## Evidence classification

The categories below separate facts from decisions:

- **Verified fact:** directly supported by the cited specification/product help or
  by a passing test/assertion in the checkout.
- **Observed Varve behavior:** reproduced from the current source/tests or real UI
  path; it is not generalized to other platforms.
- **Hypothesis:** a suspected integration risk that still needs a reproducer.
- **Product decision:** a deliberate Varve contract chosen to make behavior
  predictable; it is not attributed to an external product.

## Current audit matrix

| Capability | Status | Reproduction / evidence | Severity | Root-cause evidence | Affected environments | Regression test or next check |
| --- | --- | --- | --- | --- | --- | --- |
| Fractional-position nudge with snapping disabled | **Working** | Set a fractional transform and issue Arrow; planner tests preserve the exact delta. | High | Shared nudge planner applies document-space displacement without integer rounding. | Browser and desktop engine path; Chromium UI coverage is required for final gate. | `packages/editor/src/commands/nudge.test.ts`; `tests/e2e/canvas/nudge.spec.ts`. |
| Parent + descendant selected | **Working** | Select both and nudge/drag; independent-root collection removes the descendant. | High | `selectionArrangement` resolves roots before mutation. | All scene surfaces using the shared planner. | `selectionArrangement.test.ts`, nudge hierarchy cases, canvas E2E. |
| Held nudge interrupted by selection/document change | **Working** | Hold/repeat Arrow, change selection or document, then release. | High | `CanvasNudgeController` closes the old transaction when the session witness fails. | Browser keyboard path; native key delivery remains platform-dependent. | `ToolManager.test.ts`; add/retain UI selection-switch scenario. |
| Exact nudge vs magnetic snap | **Working** | Keyboard Arrow movement does not call pointer snap; pointer Ctrl/Cmd bypass is separate. | High | Generic nudge controller and `InteractionContext` have separate ownership/modifier paths. | Browser and desktop. | Nudge command/controller tests and pointer E2E bypass case. |
| Raw pointer intent after a snap correction | **Working in solver; live integration pending** | Feed corrected coordinates with a raw proposal and cross release boundary. | High | `snapPosition` accepts `rawIntent`; caller wiring must provide identity-bearing candidates. | Pointer gestures in browser/desktop. | `tools/__tests__/snapping.test.ts`; real drag with temporary bypass. |
| Sticky-lock target replacement/deletion | **Working in solver; live index invalidation pending** | Replace a same-coordinate target and sample again. | High | `SnapLock` records target/source/feature identity and scope filtering invalidates it. | Indexed canvas path. | `tools/__tests__/snapping.test.ts`; live target deletion/movement E2E. |
| Moving roots/descendants excluded from candidates | **Partial** | Pure filter excludes the moving hierarchy; canvas context wiring is being integrated with indexed candidates. | High | Exclusion exists in `filterSnapTargetEntries`; current worktree still contains shared `toolContext` edits. | Browser canvas pointer path. | Add a real multi-selection drag regression after integration commit. |
| Deterministic competing targets | **Working in solver** | Shuffle coincident identity-bearing targets and compare the winner. | Medium | Candidates sort by stable identity and priority; parity benchmark compares optimized and canonical solvers. | All runtimes. | `snapping.test.ts`, `snapParity.bench.test.ts`. |
| Alignment reference/key-object feedback | **Working in Inspector path** | Align to page/key object and inspect guide label/line. | High | Feedback derives from post-command document and records reference identity. | Browser Inspector; menu/shortcut overlay path needs a real UI check. | `AlignDistributeBar.test.tsx`, arrangement tests, alignment visual E2E. |
| Single-object page alignment | **Working** | Select one object and align to an explicit page. | Medium | Capability predicate is operation-specific (`canAlignToPage`). | Multi-page browser/desktop. | Arrangement tests and alignment E2E. |
| Equal gaps vs equal centers | **Working** | Arrange unequal widths and compare edge gaps/center intervals. | High | Separate distribution modes and explicit gap formula. | Browser Inspector and command path. | `selectionArrangement.test.ts`; alignment-arrangement E2E. |
| Fixed gap with two objects | **Working** | Choose Fixed gap with two eligible objects. | High | `canSetGap` is separate from three-object automatic distribution. | Browser Inspector. | `AlignDistributeBar.test.tsx`, arrangement tests, UI availability assertion. |
| Focused text/number field or toolbar | **Working by routing contract; browser proof pending** | Focus a field and press Arrow; canvas handler is not the target and global shortcut guard ignores widgets. | High | `shouldIgnoreShortcutTarget`, IME guard, and canvas ownership boundary. | Browser; WebKitGTK/native focus should be checked separately. | Shortcut tests; keyboard-navigation and Settings E2E. |
| Guides describe applied result and stay camera-locked | **Working in alignment overlay; snap live proof pending** | Overlay projects post-command lines through full camera transform. | Medium | `AlignmentGuideOverlay` consumes solver/result lines and `worldToScreen` camera mapping. | Rotated browser camera and desktop renderer. | Alignment visual E2E plus rotated-camera screenshot. |
| Save/reopen and export after movement | **Unverified in this slice** | No new end-to-end evidence collected yet for moved indexed targets surviving reopen/export. | High | Persistence/export paths exist, but this specific cross-workflow assertion needs a real fixture. | Browser IndexedDB and native file path. | Add a bounded save/reopen → snap-to-moved-object E2E. |
| Touch/stylus precision alternatives | **Unverified** | Pointer policy and numeric controls exist; no hardware trace was captured on this host. | Medium | Runtime support varies by browser/WebKitGTK and device. | Chromebook touchscreen/stylus, Linux WebKitGTK. | Run touch emulation plus physical-device check; do not claim hardware coverage from emulation. |
| 100–50,000 object performance | **Partial** | Snap parity and move benchmarks exist; dense real indexed interaction still needs a controlled run. | Medium | Indexed broad phase is present; resource contention makes concurrent timing noisy. | Linux x86-64 host; Chromebook/ARM untested. | Run `pnpm bench` in an isolated low-worker process and record median/tail. |

## Product decisions for this milestone

1. Keyboard nudging is exact document movement. It never becomes magnetic snap,
   pixel rounding, or drag reparenting.
2. Pointer snapping is assistance, not a hard constraint. Grid-only or pixel
   alignment is an explicit setting/mode with its own reference and feedback.
3. A selection moves as one rigid world-space proposal. Candidate filtering
   excludes all moving roots and dependent descendants; explicit page/frame
   references are added separately.
4. Alignment and distribution expose their reference/mode instead of silently
   falling back. Fixed gap is valid for two objects; automatic equal-gap and
   equal-center distribution retain their own minimum cardinalities.
5. Every transient guide is disposable. Completion, cancellation, invalidation,
   document changes, and snap disablement clear the visual state.

These decisions are intentionally narrow enough to remain lightweight and local
on Linux and low-memory browsers. More advanced baseline, size-match, and
oriented-bound modes should only be advertised after their real metrics and
interaction paths have dedicated evidence.
