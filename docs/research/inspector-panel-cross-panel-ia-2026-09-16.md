# Inspector panel — cross-panel IA research (2026-09-16)

**Question investigated:** should any items currently surfaced in the
Inspector belong in the Layers panel (or elsewhere) instead? This follows
several prior 2026-09-15/16 passes that already reviewed the Inspector's
Design tab, Export tab, Typography/Insights sections, and general
disclosure/target-size hygiene (see `docs/agents/inspector-*-2026-09-1[56]*`).
This pass specifically audits placement, not per-control styling.

## Method

1. Read `sectionRegistry.ts` (62 section definitions across 7 categories) to
   inventory everything the Inspector can show and its availability
   predicates.
2. Cross-referenced `featureOwnership.ts`, which already records a
   deliberate placement rationale for every section — so before proposing a
   move, the first check is whether one was already made and why.
3. Compared Inspector sections against what the Layers panel
   (`packages/editor/src/components/LayersPanel/`) already owns, looking for
   structural duplicates or contradicted rationales.
4. Searched for public complaints about panel placement in comparable design
   tools, specifically failures other apps shipped and users pushed back on
   (not just what those apps did that reviewers liked).

## External findings

Figma's 2025-2026 UI3 redesign made the right-side inspector/properties
panel floating and collapsible. Community reaction was negative on several
concrete points relevant here:

- Floating panels "blurred the lines between tools and the canvas,"
  increasing visual clutter rather than reducing it, and made inspector text
  *smaller* while taking more screen space (bitskingdom.com summary of the
  UI3 feedback thread).
- Figma's separate Inspect/Dev Mode panel had "most functionality removed"
  when Dev Mode left beta, with unclear communication about what moved
  where — users reported hunting for previously-available properties
  (forum.figma.com/t/most-functionality-removed-from-inspect-properties-panel...).
- Contrast complaints in the properties panel's light theme made values hard
  to read (forum.figma.com UI3 feedback thread).

The throughline in all three: moving or hiding functionality between panels
without a clear, discoverable trail is what generates complaints — not the
existence of multiple panels per se. That is the standard this pass applies:
a relocation (or a decision to *not* relocate) needs to leave the feature at
least as reachable as before, in every state the UI can be in, not just the
state the reviewer tested.

Sources:
- [Why Figma's Floating Panels Fell Short: A UX Lesson](https://bitskingdom.com/blog/figma-floating-panels-ux-lesson/)
- [Most functionality removed from Inspect/Properties panel now that Dev Mode is out of beta](https://forum.figma.com/t/most-functionality-removed-from-inspect-properties-panel-now-that-dev-mode-is-out-of-beta/63492)
- [UI3 Feedback — Figma Forum](https://forum.figma.com/share-your-feedback-26/ui3-feedback-3058/index2.html?tid=3058&fid=26)

## Findings in Varve

### 1. `layer-states` — real bug, not a placement problem (fixed this pass)

`featureOwnership.ts` already documents a deliberate split: "The Inspector
owns this selection/state workflow; Layers remains focused on hierarchy
navigation and offers contextual entry points only." That rationale is
sound in the abstract (it matches Selection Sets living in the Layers panel
while a *different*, selection-scoped workflow lives in the Inspector) —
but two things contradicted it in practice:

- No "contextual entry point" for Layer States exists anywhere in
  `LayersPanel/` (grepped for `layerState`/`LayerState` — zero hits outside
  the section's own files). The promised bridge was never built.
- The registry's own `isAvailable` predicate for `layer-states`
  (`hasNodes(ctx) || (ctx.document?.layerStates?.length ?? 0) > 0`) was
  written to keep the section visible with an empty selection when saved
  states exist — but `PropertiesPanel.tsx`'s empty-selection composition
  (`DocumentPanel`) never called `add('layer-states', ...)`, so that branch
  of the predicate was dead code. Deselecting everything after capturing a
  state made it unreachable: not deleted, just invisible, with no error and
  no indication anything was wrong.

This is exactly the Figma Dev Mode failure mode above — a feature exists but
becomes undiscoverable in a state nobody happened to test — reproduced
locally. Confirmed with a real capture → deselect → verify Playwright
scenario (`tests/e2e/layers/layer-workflows.spec.ts`, "a captured state
stays visible and applicable after deselecting everything"); the test fails
without the fix and passes with it (verified by temporarily reverting the
fix and re-running).

**Fix:** render `<LayerStatesSection />` in `DocumentPanel` (the
empty-selection composition), gated on the same `sectionVisibility` hide
flag the selection-scoped panels already respect, positioned before the
Isometric Grid section (the longest section in that composition) so
reaching it does not require scrolling past unrelated, rarely-used content.
This keeps the *existing, deliberate* Inspector-owns-this-workflow decision
intact rather than relitigating it, and closes the actual reachability gap.

**Not done, and why:** actually building the promised Layers-panel
"contextual entry point" (e.g., a quick-apply affordance on rows) is a
larger, separate feature addition rather than a repair of a stated
architecture, and risks duplicating the just-fixed Inspector surface without
a clear win. Recorded here as a legitimate follow-up if the maintainer wants
the Layers panel to do more than navigate hierarchy.

### 2. `canvas`-category sections (Canvas, Snapping, Document Color, Soft
Proof, Document Grid, Isometric Grid) — correctly placed, not moved

These only render when `selectionKind === 'empty'`, which is the same
pattern Figma and Sketch use for their own right panel: no selection swaps
the panel from per-object properties to page/document-level properties in
place, rather than requiring a separate panel or dialog. Moving these into
the Layers panel would fragment "what does the currently-focused thing look
like" across two panels for no benefit — left as-is.

### 3. `align-distribute` — already resolved by a prior pass

Order 90, category `geometry`, `essential: true`. Git history
(`dc9d1ab50 feat(align): resolve the alignment surface from the workspace
mode`) shows this was already deliberately routed to the appropriate
surface per workspace mode rather than hardcoded to the Inspector. Not
revisited here.

### 4. Highly specialized single-purpose AI/photo sections (`ai-denoise`,
`depth-mask`, `lens-blur`, `line-art`, `content-aware-fill`, `detect-text`,
`ocr`, `blend-images`, `palette`, `font-detect`, `colorize`,
`background-removal`) — correctly gated, not a Layers-panel candidate

All eleven are `isSingleSelection && isImageNode && workspaceMode ===
'image'` — they only exist in Photo workspace mode with an image selected,
and `ai-tools-hint` (order 279) is the mirror-image section shown *outside*
Photo mode so the same selection always has either the tools or a one-click
path to them. This is already the discoverability contract the
Figma/Photoshop research above argues for (never neither state, never
silently removed) — no placement change indicated.

## Conclusion

One genuine cross-panel/reachability defect found and fixed (`layer-states`
empty-selection gap). Everything else audited in this pass already reflects
a considered, still-valid placement decision; relocating any of it would
trade a working, documented architecture for a cosmetic reshuffle with no
evidenced user benefit — which the research above suggests is exactly the
kind of change that generates complaints rather than resolving them.
