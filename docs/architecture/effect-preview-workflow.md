# Effect preview workflow

**Status:** current architecture · **Date:** 2026-09-08

This document is the compact contract for previewing and editing effects across
Effect Studio, Object Filters, Layer Effects, Image Tuning, and Adjustment
Layers. The surfaces share canonical scene conversion and effect execution, but
they do not share one lifecycle or one comparison meaning.

## Lifecycle contract

| Lifecycle | Used for | Document state | Close | Commit |
| --- | --- | --- | --- | --- |
| Live editing | An already-applied effect or treatment | Accepted state, updated during a deliberate gesture | Keeps accepted changes | One history entry per gesture |
| Draft preview | Browsing a new treatment or an explicit Apply/Cancel session | Preview-owned overlay inside a bounded transaction | Cancels only the draft | Apply commits the current validated candidate once |

`Reset control` restores the selected treatment's authored controls. `Reset
effect` restores one primitive effect's defaults. `Revert session` means draft
Cancel and is not a live-edit operation. “Apply” never means “keep whichever
bitmap last completed”; it commits the latest validated parameter state.

## Preview identity

Every editing preview is associated with:

```text
document id + editor session + target ids + treatment/instance id
  + baseline revision + parameter generation + renderer profile
```

The generation is monotonic within the mounted preview surface. Document
revision alone is insufficient because a draft can change the scene visible to
the canvas without changing the accepted revision. Late, cancelled, failed,
or mismatched results are not allowed to replace the current display.

## Comparison definitions

- **Before this edit** is the accepted document captured at draft start, or the
  accepted document when live tuning opens.
- **Current candidate** is the current draft, including its complete ordered
  stack and downstream effects.
- **Without selected effect** is a separate bypass operation and must preserve
  every unrelated authored visibility/bypass state. It is not the default
  Effect Studio baseline.
- **Isolated** means a target-only preview and is labelled as representative or
  context-free. The object-local Effect Studio comparison currently uses this
  mode; backdrop-dependent Layer Effects and Adjustment Layers stay in-context.

Both sides use one source selection, frame, preview scale, renderer version,
and resource-readiness policy. A placeholder or a failed side remains a
placeholder or failure; the other side is not duplicated to make the pair look
complete.

## Target and conflict rules

The first selected object is the representative preview for a multi-selection;
the target count and Apply policy are visible. Applying affects all compatible
selected objects in one transaction. A target/document switch cancels the
draft. Cancellation is reconciled to the current document when possible so an
unrelated edit is not restored from an old full-document snapshot. Same-target
conflicts remain explicit: the current accepted target is never silently
replaced with an old candidate.

## Surface matrix

| Surface | Target | Baseline | Preview path | Accepted output |
| --- | --- | --- | --- | --- |
| Effect Studio | One representative; Apply can cover compatible multi-selection | Before this edit | Canonical object-local `FilterIR` via editing-preview profile | Ordered named recipe in Object Filters |
| Object Filters | Selected object(s), stable filter id | Current accepted object result or explicit entry bypass | Canonical object-local stack | Per-entry order, mask, opacity, blend, and visibility |
| Layer Effects | Layer/frame/group/image/text with scene context | Current accepted layer result | Layer-effect staged compositor with backdrop | `effects` array and source geometry retained |
| Image Tuning | Raster images only | Accepted image-local result | Image treatment pipeline | Image-local Object Filter entries |
| Adjustment Layer | Affected scoped backdrop | Accepted scoped backdrop | Adjustment-layer scope/mask replay | Scoped adjustment node |

## Verification status

Unit/state tests cover preview identity, baseline construction, lifecycle
transitions, latest-result-wins behavior, and typed thumbnail outcomes. The
Effect Studio Playwright workflow covers real gallery browsing, precise fields,
preview, split comparison, Apply, Cancel, reopen, retargeting, and visual
screenshots. Browser screenshots are evidence for the browser route only;
packaged WebKitGTK, native providers, and cross-runtime parity remain separate
validation lanes.
