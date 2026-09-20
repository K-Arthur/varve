# ADR-0238: Comic and webtoon workflow architecture

*Status: accepted — 2026-09-19*

## Context

Varve ships eight workspace modes and shared scene, page, text, and halftone
foundations. This decision answers one gating question before comic work is
implemented:

> Does comic / manga / webcomic production require a dedicated Varve workspace?

The answer is grounded in repository evidence (workspace system, pages, print,
export, text, effects) and external workflow research (Clip Studio Paint,
Krita, Procreate, publishing platforms, mode-design literature). The decision
is implemented incrementally through shared scene metadata, presets,
page-surface disclosure, panel layout, painting-resolution mapping, and
bounded export contracts; remaining publishing and lettering surfaces are
tracked explicitly below.

### Existing systems examined

- **Workspaces are disclosure over one document, never a scene fork.**
  Invariants in `docs/architecture/workspace-system.md:15-33`; one resolver
  `getEffectiveWorkspaceConfig` (`packages/editor/src/workspace/workspaceStore.ts:456-547`);
  one switch path `requestWorkspaceSwitch`
  (`packages/editor/src/workspace/useWorkspaceMode.ts:236-269`). Modes change
  panels, default tool, toolbar composition, inspector tabs, status sections,
  canvas overlays, and chrome — nothing else.
- **Users already compose their own workspaces.** Per-mode overrides are
  persisted (`varve-workspace-preferences`, platform app-setting
  `workspace-preferences`) and surfaced through `WorkspaceCustomizeDialog`;
  **named layout variants** capture panels, widths, inspector tabs, status
  sections, toolbar tools, and chrome, with save/apply/rename/delete and
  portable JSON import/export (`packages/editor/src/workspace/layoutVariants.ts`;
  `docs/architecture/workspace-system.md:362-415`). The variant header is
  explicit that a saved layout "is deliberately *not* a new workspace mode".
- **Publishing pages are a document record, not nodes.**
  `Document.pages` / `Page` with order, bleed/safe/slug, masters, and the
  derived/custom spread model (`packages/scene/src/types.ts:2219-2253`,
  `:2277-2368`); CRUD, duplicate, and reorder in
  `packages/scene/src/document-pages.ts`; windowed `PagesPanel` and thumbnail
  `PageNav`.
- **The print pipeline supplies reusable foundations, not a complete comic publisher.** Print geometry
  (`packages/scene/src/printGeometry.ts`), preflight
  (`packages/scene/src/printPreflight.ts`), CMYK/PDF-X
  (`crates/varve-print`, `@varve/print`), page-range export planning
  (`packages/scene/src/export/plan.ts`, `presets.ts`).
- **A panel primitive already exists.** `FrameNode` with bounds and
  `clipContent` default true (`packages/scene/src/types.ts:1747`,
  `packages/scene/src/document.ts:800`), plus clip masks for arbitrarily shaped
  panels (`packages/scene/src/clippingMask.ts`). Grids and page margins exist
  as guides only (`packages/scene/src/gridTypes.ts:68`, ADR-0227).
- **Lettering has important foundations but is incomplete for production manga.** Vertical CJK writing modes
  (`packages/scene/src/types.ts:1129-1130`), vertical layout/paint
  (`packages/engine/src/textLayoutSnapshot.ts`, `verticalTextReplay.ts`;
  `docs/architecture/text-pipeline.md`, `typography-platform.md`), and linked
  text stories (ADR-0159).
- **Screentone foundations exist.** Halftone `comic-dots` and `line-screen`
  presets plus a Krita-Screentone-derived threshold core
  (`packages/engine/src/halftone.ts:1371-1425`,
  `packages/engine/src/halftoneScreen.ts`), color halftone with a `comic-book`
  preset (`packages/engine/src/colorHalftone.ts`).
- **Domain metadata without a scene fork has precedent.**
  `Document.logoProject` (`packages/scene/src/document.ts:169-173`) and
  `Document.emailProfile` (v2.21 no-op migration, `document.ts:353-367`).
- **Templates exist but are generic.** `TemplateLibrary`
  (`packages/platform/src/types.ts:428`), frame/paper presets
  (`packages/shared/src/presetRegistry.ts`). Comic print, manga, and webtoon
  presets are now registered there and attach an advisory workflow profile.

### What is actually missing (capability gap, not a mode gap)

- Panel creation, division, and gutter generation; a balloon/callout primitive
  with a tail and text binding; tone/screentone fills and tone brushes beyond
  the halftone adjustment; speed/focus lines; comic page templates; per-panel
  art clipping workflow.
- Page-aware export in the dialog (jobs are node-preset-only today), multi-page
  PDF (`docs/architecture/page-export-selection.md:40-47`,
  `docs/plans/multipage-layout-progress.md`), webtoon slice export, and
  CBZ/EPUB packaging.
- **Page surfaces were hard-gated to Print mode.**
  `resolvePageSurfaceVisibility` now also accepts a comic workflow profile and
  can disclose publishing pages from Draw without adding a workspace mode.
  and `showPageNavigation = isPrint && hasPages`
  (`packages/editor/src/workspace/useWorkspaceConfig.ts`; consumers
  `Shell.tsx`, `PagesPanel.tsx`). Ordinary Draw documents retain the existing
  canvas behavior.
- Tall-page handling: page-nav thumbnails are a fixed 180×90 landscape variant,
  PageNav is not virtualized, and there is no slicing, tiling export, or
  mobile-preview surface for a vertical-scroll episode.

### Cost of a ninth hard-coded mode (measured in this repository)

Adding one mode is not a config row. The compile-forced or snapshot-forced
touch points are: the `WorkspaceMode` union in two packages
(`packages/shared/src/auditTypes.ts:83-91`, `packages/platform/src/types.ts:20-28`);
`WORKSPACE_CONFIGS`, labels, icons, `ALL_WORKSPACE_MODES`, overflow order and
priority (`workspaceTypes.ts`); a `ShortcutManager` binding and label; an action
handler; menu defs, localization keys, and the hard-coded menu list in
`Menubar.tsx`; `WorkspaceTabs` icon names; per-mode accent/icon tokens for three
themes with `audit:tokens` contrast pairs; menu filtering sets; demo capability
lists; and test surfaces that assert the exact eight-mode matrix
(`workspaceBaseline.test.ts`, menu snapshot, label lists, overflow/switching
tests, toolbar composition `it.each` over all modes, workspace E2E and visual
snapshots). Crucially, the page-vs-design-canvas branching is **mode-keyed in
roughly a dozen hot-path files** (editor context, tool context,
`renderPipeline.ts`, `selectionArrangement.ts`, `navigationBounds.ts`,
`sceneScope`, LayersPanel, drops, master/spread panels). A ninth mode either
duplicates that branch set or forces the capability refactor below — in which
case the mode pays for itself only after its main justification is gone.

### External evidence

- **Clip Studio Paint** (the comic-production reference) treats workspaces as
  palette-layout presets: defaults are `Illustration`, `Comic`, and `By
  category`; users register their own and share them as ASSETS, optionally
  importing shortcut/command-bar/unit settings. Comic and webtoon capabilities
  are **global tools and document/export options**, not workspace features:
  frame-border, balloon, screentone, and speed-line tools are available in any
  workspace; "New" distinguishes `Comic` and `Webtoon` document presets
  (including EX page divisions); `Export webtoon` slices a long canvas into
  800×1280 images. Community workspaces are exactly "palette arrangement plus
  shortcuts".
- **Krita** keeps comic capability out of modes too: the Comic Manager is a
  docker/plugin for page organization and templates (with bleed/margin guides
  and CBZ/EPUB export), balloons come from a third-party plugin, and feature
  requests ask for a panel generator, a mobile preview of vertical comics, and
  long-webcomic support — all capabilities, none asking for another workspace.
- **Procreate** has no modes at all. Comic workflow is assembled from drawing
  guides, templates, clipping, and third-party brush packs for panels,
  balloons, and sound effects; webtoon slicing happens outside the app.
- **Affinity** exposes Personas/Studio Link precisely because capabilities were
  split across applications; user threads repeatedly show "which persona/app do
  I use?" friction, and its recent consolidation drew complaints about merged
  UIs. Cautionary evidence that mode switching is a cost users pay only when
  capabilities are otherwise unreachable.
- **Platform constraints are format prescriptions, not modes.** WEBTOON CANVAS
  wants 800 px wide RGB images, sections around 1280 px tall and about 2 MB,
  with episodes commonly 4,000–15,000 px tall; print comics carry trim, bleed,
  spreads, and CMYK/PDF-X requirements. These are document/export properties.
- **Mode-design literature** (Raskin, *The Humane Interface*; Tesler's "no
  modes" principle) is consistent with the repository's own boundary: modes are
  tolerated when they align with a cognitive task switch, and are harmful when
  they hide capabilities behind state.

### Measured workflow friction

Structural counts from the code above; interaction counts are estimates for an
implemented capability, not benchmark data.

| Scenario | Friction today | Root cause |
|---|---|---|
| **Manga page** (B5: panels, ink, tones, speed lines, balloons, lettering, print export) | Must live in Print for page context; every panel is manual Frame + stroke with no division/gutter command; balloons are ellipse + tail path + text with no binding or auto-fit; speed lines manual; PDF export is single-page | Missing capabilities and mode-keyed page surfaces — not the absence of a tab |
| **40-page chapter** | Navigation, reorder, duplicate, masters exist; no bulk page insert; sections have no authoring UI; no reusable balloons; chapter export blocked by single-page PDF and no CBZ/EPUB | Export and capability gaps |
| **Vertical webtoon episode** | Custom tall pages possible, but thumbnails letterbox hard, no slicing or width enforcement, no mobile preview, long-canvas residency not tuned for strip workflows | Format-specific capabilities |
| **Draw user turns an illustration into a comic** | No conversion is forced; pages are additive (`migrateToPages`), switching preserves document/selection/viewport/undo. The user simply cannot add a real panel or balloon in place | Missing capabilities; discovery |

The friction is capability-shaped and format-shaped. Nothing in the scenarios
is reduced by adding a mode, and Scenario 4 is made *worse* by any design that
ties comic capability to a mode (the balloon tool must not disappear when the
user returns to Draw).

## Decision

1. **No hard-coded Comic, Manga, or Webtoon workspace mode is approved.** A
   future proposal for one requires a superseding ADR with evidence that the
   preset mechanism below cannot express the needed composition.
2. **Comic and webtoon are document workflows over shared systems.** They are
   identified by an optional, advisory `Document.workflowProfile`
   (`comic-print`, `webtoon-vertical`, future values), owned by the scene like
   `logoProject` / `emailProfile`. The profile selects defaults (page presets,
   suggested layout preset, suggested export preset) and is never a scene fork,
   capability gate, or editing precondition. Documents without a profile behave
   exactly as today.
3. **Page surfaces become capability-driven, not mode-driven.** The
   `mode === 'print'` gate becomes a policy composed from document capability
   (pages exist) and an explicit page-surface presentation preference, with
   print-only geometry (bleed overlays, preflight, spreads, masters) disclosed
   separately. This removes forced Print residency, is the structural fix behind
   improving the existing workspaces, and is a prerequisite for any preset.
4. **Comic capabilities ship as shared, always-available tools and presets**:
   a FrameNode-based panel tool plus divide/join commands; a balloon primitive
   with tail and text binding; tone and speed-line presets built on the
   existing halftone/pattern/preset systems; comic page presets and templates;
   a page-aware export dialog with multi-page PDF; a bounded, streamed webtoon
   slice export. Design parity rule: a tool is global, a preset sets its
   defaults.
5. **Comic and webtoon compositions ship as optional presets, not modes.**
   Extend the existing layout-variant payload to capture the default tool and
   the page-surface preference, then provide built-in `Comic (print)` and
   `Webtoon (vertical)` variants selectable from Manage Layouts and the command
   palette and suggested by the workflow profile at document creation. One
   preset mechanism, one resolver, one switch path.
6. **The two workflows stay distinct.** Print comics inherit Print semantics
   (bleed, spreads, masters, preflight, PDF/X); webtoons inherit long-canvas
   residency, slicing, and mobile preview with no print chrome. One hard-coded
   "Comic" mode would serve neither well.

### Panel model (implementation note, 2026-09-19)

Panels are **not** a parallel implementation of frames. There is one node
model — `FrameNode` — and panels are frames under panel conventions, exactly
as export regions already are (`SliceTool` → `frameRole: 'exportRegion'` on a
`FrameNode`). One factory path (`makeContainerNodeForTool`), one capture rule,
one renderer, one codec. A `PanelNode` would fork the schema, migrations,
renderer, and export for zero new capability: frames already clip, stroke,
mask, and lay out.

What is panel-specific lives in `packages/editor/src/scene/panelLayout.ts`:

- **Paper conventions**: white fill, a solid `outside`-aligned border (frame
  borders paint below children in every replay path, so an inside/center
  border would be covered by clipped artwork), clipped content.
- **Layout templates** (`PANEL_LAYOUT_PRESETS`): splash, two-up, three-tier,
  four/six/nine-panel grids, and a webtoon stack with the larger vertical
  gutter the format uses for pacing. Templates express cells relative to the
  target's bounds with one constant gutter and one outer margin — the CLIP
  STUDIO PAINT "Divide frame border equally" vocabulary, which the absolute
  frame-size preset registry cannot represent.
- **The divide operation** (`divideFrameIntoPanels`): turns one empty frame
  into a rows × columns grid of named child panels in one undo entry.

Known v1 boundaries: divide duplicates existing artwork into every panel —
each panel shows the same absolute artwork region clipped to its cell, and the
originals are removed (the CLIP STUDIO PAINT "divide frame folder and
duplicate inside layer" behaviour). Reading order is derived, not stored:
`orderPanelIds` sorts tiers top-to-bottom and panels left-to-right (or
right-to-left for manga), and the `renumberPanelsLtr` / `renumberPanelsRtl`
commands renumber a frame's child panels from it. Panel-level metadata is now
optional on `FrameNode` (`panelId`, reading order/direction, gutter, and an
optional clipping-path reference); explicit order editing and irregular
freeform authoring remain follow-up UI work.

### Options considered

1. **No new workspace** (templates, presets, commands, libraries only).
2. **Improve existing workspaces** (Draw/Print information architecture).
3. **Contextual comic mode without a workspace** (document metadata and
   contextual surfaces).
4. **Dedicated Comic workspace** (ninth hard-coded mode).
5. **Configurable Comic preset** (user-level composition over shared systems).
6. **Other discovered alternative — capability-keyed page surfaces**: replace
   the mode-keyed page-surface gate so workflow capability, not mode identity,
   decides what a document can show.

| Criterion | 1 No new workspace | 2 Improve Draw/Print | 3 Contextual profile | 4 Dedicated Comic mode | 5 Configurable preset |
|---|---|---|---|---|---|
| Workflow efficiency | No change by itself | Removes the Print detour | Defaults only | Only pays off after the same refactor | Same benefit as 2+3 |
| Discoverability | Templates must be found | Capability-named surfaces | Profile at creation | New tab, but hides where tools live | Presets in layouts/palette |
| Expert efficiency | Neutral | Fewer forced switches | Neutral | Another overflow consumer in an eight-tab strip | Keeps custom variants |
| UI density | Neutral | No new chrome | No new chrome | Mode plus its variant surface | Only what the user applies |
| Reuse | High | High | High | Duplication risk (page branches, toolbar) | High; configures shared tools |
| Architecture | Preserves one scene | Fixes mode-keyed branching | Metadata only | Encodes document semantics as app-global UI state | One resolver, one capture path |
| Maintainability | Minimal | Medium | Minimal | ~14 registration points and exact-8 test matrices | Extends variant payload |
| Extensibility | Ad hoc | Medium | Generalizes to future workflows | Every workflow needs a mode | Zine, storyboard, webcomic reuse |
| Customization | Not addressed | Not addressed | Feeds defaults | Hard-codes one composition | Core of the approach |
| Accessibility | Neutral | Neutral | Neutral | New navigation tier, new contrast pairs in three themes | Reuses layouts/toolbar contracts |
| Low-end performance | Neutral | Neutral | Neutral | Same rendering; more UI variants | Config-only |
| Persistence | Templates only | No new prefs | New document field plus no-op migration | Snapshot universe changes | Versioned variant payload |
| Testing | Minimal | Page-surface policy tests | Migration tests | Exact-8 baselines, snapshots, E2E visual | Variant/profile tests, no mode matrix |

### Decision output (required study fields)

- **Existing systems examined**: workspace system and named layout variants,
  publishing pages/spreads/masters, print geometry/preflight/PDF-X, export
  planning, FrameNode clipping, text pipeline (vertical CJK), halftone and
  color halftone, templates and frame presets, and document metadata
  precedents — detailed under Context.
- **User workflows researched**: a manga/print comic page (panels, tones,
  balloons, lettering, print export), a 40-page chapter (navigation,
  duplication, global styles, chapter export), a vertical-scroll webtoon
  episode (long canvas, slicing, mobile preview, platform limits), and an
  existing Draw document converted to comic later — the four scenarios in
  "Measured workflow friction".
- **Competitor patterns**: Clip Studio Paint — workspaces are palette-layout
  presets (`Illustration`, `Comic`, `By category`, user-registered, shareable)
  while comic tools are global and the comic/webtoon distinction lives in
  document and export presets; Krita — Comic Manager docker plus page templates
  and CBZ/EPUB export, balloons via a third-party plugin; Procreate — no modes,
  comic workflow assembled from guides, templates, and third-party brush packs;
  Affinity — Personas/Studio Link switch capability sets and attract repeated
  "which persona/app?" friction; Adobe — workspaces are panel arrangements
  only.
- **Competitor/user pain points**: panels require manual construction; balloons
  are absent or third-party/paid; webtoon slicing, mobile preview, and
  long-canvas memory are recurring webtoon complaints; page organization
  outside the drawing surface fragments the workflow; in-app reading preview
  is valued; and users routinely re-arrange and share palette layouts —
  evidence for presets over modes.
- **Options considered**: 1 no new workspace, 2 improve Draw/Print,
  3 contextual profile, 4 dedicated Comic workspace, 5 configurable preset,
  6 capability-keyed page surfaces — evaluated in the table above.
- **Chosen architecture**: options 2 + 3 + 5 + 6 as one sequence — no new mode;
  capability-keyed page surfaces; document workflow profile; shared comic tools;
  Comic/Webtoon layout presets.
- **Why**: the measured gap is missing capabilities and a Print-only page
  surface, not missing workspace identity; presets are the established,
  user-owned composition mechanism and match the Clip Studio Paint precedent;
  comic and webtoon needs diverge enough that a single mode is a poor
  abstraction; a ninth mode multiplies mode-keyed branches and test surfaces
  while delivering none of the missing value.
- **Why rejected approaches were rejected**: option 1 alone leaves page-surface
  gating and discovery unsolved; option 3 alone is decorative config (violates
  the workspace invariant that every config field has a runtime consumer);
  option 4 is the most expensive option with the least incremental capability
  and risks one mode for two workflows; a Comic-plus-Webtoon pair of modes
  doubles that cost with no additional benefit.
- **What remains shared**: scene/document model, FrameNode panels, pages and
  spreads and masters, print geometry and preflight, text pipeline including
  vertical CJK, halftone/color-halftone, effects, layers, export pipeline,
  command/shortcut/action registries, thumbnails, and every tool.
- **What becomes comic-specific**: the optional workflow profile; comic page
  presets and templates; the panel and balloon tools' default presets; tone and
  speed-line presets; webtoon slice export preset; the two built-in layout
  variants.
- **New UI surfaces required**: workflow profile selection in the
  new-document/template flow and document properties; selection-driven panel
  and balloon inspector sections; an on-demand mobile preview for webtoon
  (dialog/overlay, not a mode); export preset entries; built-in variant entries
  in Manage Layouts. No new top-level workspace tab.
- **Existing UI surfaces changed**: page-surface policy and its Shell/PagesPanel
  consumers; ExportDialog page awareness; frame presets and NewDesignDialog;
  PageNav thumbnail handling for tall pages; toolbar registry entries for the
  new tools; menu filtering where new commands appear.
- **Document/schema changes**: additive `Document.workflowProfile?:
  ComicWorkflowProfile`, story-outline and painting-PPI metadata, plus optional
  panel/callout/ruby metadata on existing node and text types. These fields are
  optional so legacy documents retain behavior.
- **Migration implications**: absent profile equals current behavior; unknown
  kinds sanitize to absent and are preserved as unknown fields by the codec but
  not honored; opening a document never rewrites its profile or forces pages.
- **Performance implications**: presets are configuration, not background work.
  Webtoon work requires bounded tall-page residency, streamed slice export
  (no full-height bitmap materialization), on-demand preview, and a bounded
  thumbnail variant for tall pages; none of this is added by a mode, and all of
  it is required regardless.
- **Accessibility implications**: no new navigation tier or mode tokens; new
  tools join the existing APG toolbar contract (single tab stop, roving focus,
  `aria-keyshortcuts`); preset pickers use the custom `Select`; built-in
  variants remain reachable by keyboard through Manage Layouts.
- **Testing implications**: no ninth-mode baseline; add profile migration and
  persistence tests, extended page-surface policy tests, panel/balloon tool
  geometry and pointer E2E, page-aware export and slice-export tests, and
  built-in variant coverage. Existing eight-mode baselines remain valid.

## Consequences

Comic work can start on capabilities and page-surface policy immediately, with
no workspace migration, no new preference schema, and no new mode matrix. Users
gain a `Comic (print)` or `Webtoon (vertical)` composition they can adopt,
modify, export, and share through the same Manage Layouts mechanism as every
other layout, and the balloon/panel tools remain available in Draw, Print, and
Design alike.

The deferred risk is discoverability: a preset is less visible than a tab. The
mitigations are document templates with the profile attached, a suggestion at
document creation, the command palette, and menu entries — all measurable. If
evidence later shows users cannot find or express the workflow through presets,
the superseding-ADR path remains open and is cheap to evaluate because the
capabilities will already be shared.

## Validation

- Doc gates: `pnpm audit:docs` (ADR index coverage, links, naming) and
  `pnpm audit:emoji`.
- Initial implementation lives in `packages/scene/src/comicWorkflow.ts`, the
  shared comic presets, Draw page-surface policy, panel metadata/cost preview,
  panel-aware painting targets, and the bounded export tile API. Balloon UI,
  complete multipage artifact assembly, and publisher preflight remain tracked
  implementation follow-ups and are not represented as complete here.
- Implementation sequencing, acceptance tests, and E2E coverage for each
  capability belong to a follow-up plan; the workspace decision itself is
  frozen by this record.

### Implementation status (2026-09-20)

Landed since acceptance: workflow profiles applied at document creation through
the canonical `createNewDocument`; capability-keyed page surfaces including the
comic Draw default; the Panel tool with divide/join/renumber commands and the
Panel Layouts inspector section; the story-outline panel with derived panel and
dialogue links; built-in Comic (print) and Webtoon (vertical) layout variants
with apply commands and a contextual suggestion; Burst and Cloud shaped
balloons; the text-effect/SFX preset library; direct balloon editing and
clone/paste recipe remapping; real-photo E2E validation in
`tests/e2e/canvas/comic-workflow.spec.ts`.

Still deferred: page-aware multi-page PDF and CBZ/EPUB assembly, streamed
webtoon slice export wiring, mobile reading preview, and tall-page PageNav
thumbnail variants.

## Sources

- Clip Studio Paint: [Register and manage your workspace](https://help.clip-studio.com/en-us/manual_en/690_interface/Register_and_manage_your_workspace.htm),
  [Webtoons](https://help.clip-studio.com/en-us/manual_en/540_comic/Webtoons.htm)
  (Export webtoon slicing), [New dialog box (Webtoon)](https://www.clip-studio.com/site/gd_en/csp/userguide/csp_userguide/500_menu/500_menu_file_new_webtoon.htm),
  and community workspaces published on CLIP STUDIO ASSETS.
- Krita: [InkBalloon + Comic Page Manager](https://krita-artists.org/t/inkballoon-comic-page-manager-comic-workflow-for-krita/184807),
  [Comic workflow feature requests](https://krita-artists.org/t/comic-workflow-general-ideas-and-feature-requests-including-long-webcomics/37528),
  [Writing a comics manager for Krita](https://wolthera.info/2017/08/writing-a-comics-manager-for-krita/).
- Procreate: community comic workflows and third-party panel/balloon brush
  toolkits, plus webtoon canvas guidance.
- WEBTOON CANVAS: platform upload guidance (800 px width, ~1280 px sections,
  ~2 MB per image) as repeated across creator guides; to be re-verified against
  the platform's current official specification before implementing slice
  export.
- Jef Raskin, *The Humane Interface* (modes); Larry Tesler's "no modes"
  principle.
