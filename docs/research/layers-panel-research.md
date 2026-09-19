# Layers Panel — Reference-App Research (2026-09-19)

Scope: what the Layers panel (or its equivalent structure view) does in the
reference applications named in the workspace-evolution brief, what has
demonstrably failed there, and what Varve should adopt, adapt, or reject.

**Method.** Sources are public documentation, vendor help centres, and public
community threads collected 2026-09-19. Each claim is tagged **[verified]**
(observed in a cited source or in this repository's code) or **[inference]**
(the author's synthesis). Inferences are never presented as facts.

---

## A. What works

### A1. Adobe InDesign — Print

| Aspect | Behavior | Source |
|---|---|---|
| Hierarchy model | Layers are **document-wide**; every page/spread shows the same layer list, and the panel lists only the active spread's objects under each layer | [Adobe help: Organize content with layers](https://helpx.adobe.com/ee/indesign/how-to/work-with-layers.html); [community answer stating the three rules](https://community.adobe.com/questions-671/how-to-unlink-a-duplicated-spread-839278) |
| Parent (master) pages | Parent pages are global; objects on a parent page sit at the **bottom of the layer stack** for pages using that parent. The Layers panel does *not* list parent items while a document page is active — you must open the parent page | [CreativePro: Using Layers in InDesign](https://creativepro.com/using-layers-in-indesign/) |
| Non-printing flag | `Layer Options → Print Layer` (off) makes a layer **never print or export**, independent of visibility; the layer name becomes italic as the visual cue. Adobe's docs note the flag and hidden state are independent | [InDesign CS4 manual, p.88](https://www.manualsdir.com/manuals/753856/adobe-indesign-cs4.html?page=88); [CreativePro](https://creativepro.com/using-layers-in-indesign/) |
| Mixing hidden + non-printing | A player-requested fix: `Show` and `Print` are independent in the model but the layer's content is not drawn when Print is off in Preview/Separations views, which reads as "my guides disappeared". Users explicitly ask for "show but don't print" | [InDesign UserVoice request](https://indesign.uservoice.com/forums/601021-adobe-indesign-feature-requests/suggestions/42983706-make-layer-options-work-logically); [Adobe community thread](https://community.adobe.com/questions-671/indesign-non-printing-layers-disappear-836920) |
| Layer color | Every layer has a color; object bounding boxes adopt it, so the canvas tells you which layer owns a selection | [Adobe help video transcript](https://helpx.adobe.com/ee/indesign/how-to/work-with-layers.html) |
| Lock semantics | Per-layer lock prevents selection/editing but not text reflow or indirect changes through a linked resource; "lock all but one layer" is a standard workflow | [InDesign CS4 manual](https://www.manualsdir.com/manuals/753856/adobe-indesign-cs4.html?page=88) |
| Other panels | **Pages** (page/master management), **Articles** (reading/export order), **Links** (asset status), **Preflight**. These are *separate panels* — InDesign does not fold structure into Layers | [CreativePro](https://creativepro.com/using-layers-in-indesign/) |

**Takeaways for Varve.** [inference] (1) A document-wide layer concept is
incompatible with Varve's scene tree, where hierarchy *is* the layer list;
do not fake a second global grouping. (2) The non-printing flag is genuinely
independent of visibility and is a real professional expectation for print
guides. (3) InDesign keeps structure concerns in *adjacent* panels (Pages,
Articles) — Varve already has a Page Navigator and a Master panel, so Print
structure belongs there plus a read-only badge in the tree, not full page
management inside Layers.

### A2. Mailchimp and peers — Email

| Aspect | Behavior | Source |
|---|---|---|
| Structure | Section → row → column → content block. The Sections Manager lets you move, rename, duplicate, delete sections; templates ship default header/body/footer sections | [r/MailChimp: section manager](https://www.reddit.com/r/MailChimp/comments/1shufje/how_to_use_the_sections_manager_using_the_new/) |
| Saved/reusable blocks | Long-requested, partially shipped: users asked for reusable blocks for years; the answer for a long time was "save the whole template instead". Mailchimp later shipped section-level reuse | [r/MailChimp: why is the builder so bad](https://www.reddit.com/r/MailChimp/comments/1u7b6fx/why_is_the_builder_so_bad/); [r/MailChimp: is it possible to save blocks yet](https://www.reddit.com/r/MailChimp/comments/1n0lwlx/is_it_possible_to_save_blocks_yet/) |
| Mobile visibility | Mailchimp has **mobile style overrides per block** (font size etc.) and dynamic content per section, but **no "mobile-only" block**. The community answer is architecturally explicit: a block cannot be made visible on mobile only | [r/MailChimp: visible in mobile but not desktop](https://www.reddit.com/r/MailChimp/comments/1lxngvx/can_a_content_block_be_visible_in_mobile_view_but/); [Mailchimp: campaign behaviour on mobile](https://mailchimp.com/help/campaign-behavior-on-mobile/) |
| Fixed responsive behavior | Multi-column content **always stacks to one column on mobile** unless you hand-code; this is a recurring complaint and a real constraint of table-based email | [r/MailChimp: 2+ columns](https://www.reddit.com/r/MailChimp/comments/1760sn0/2_columns_in_mobile_views/); [r/MailChimp: blocks stacking](https://www.reddit.com/r/MailChimp/comments/191ubxg/content_blocks_stacking_on_mobile_any_simple_fixes/) |

**What Varve already has.** [verified in this repo] `EmailSemanticMetadata`
carries `hideOnMobile?: boolean` and `hideOnDesktop?: boolean`
(`packages/scene/src/emailTypes.ts:119`, consumed by
`packages/codegen/src/email-compiler.ts:285`, emitted as `mobile-hide` in
`email-html.ts:816`). So a **mobile-hidden badge and filter in the Layers
panel is a pure projection over existing scene data** — no schema change.

**Takeaways for Varve.** [inference] Email's Layers view should show the
section/row/column/block structure *as semantics*, because the scene tree is
already that structure; what is missing is the per-block mobile-hidden flag
surfacing in the tree (badge + filter) and a block-library entry point that
belongs in a Resources/Library panel, not the Layers tree.

### A3. Adobe Photoshop — Photo

| Aspect | Behavior | Source |
|---|---|---|
| Row anatomy | Eye (visibility), lock, colored layer label, thumbnail, name, link state, effects badge, blend-mode/opacity summary at the top of the panel for the active layer | [Photoshop community idea describing the icon layout change](https://community.adobe.com/t5/photoshop-ecosystem-ideas/request-layer-visibility-icon-on-left-side/idi-p/13053933) |
| Inherited visibility | A layer inside a hidden group shows a **grey** eye in classic Photoshop (meaning: visible itself, invisible through ancestor) | [same idea thread](https://community.adobe.com/t5/photoshop-ecosystem-ideas/request-layer-visibility-icon-on-left-side/idi-p/13053933) |
| Filtering | Kind (pixel/adjustment/type/shape/smart object), name, effect, mode, attribute, colour; filters can be combined by toggling multiple buttons | [PhotoshopCAFE: hidden layer tools](https://photoshopcafe.com/photoshop-layer-tools-you-should-be-using-hidden-features-guide-layer-filters/) |
| Layer comps | Saved visibility/position/appearance snapshots of the whole layer stack | [dllp article on layer filtering](https://urushigusa.com/articles/layer-filtering) |
| Smart objects | Non-destructive embedded/ linked sources; duplicated smart objects share one source unless "New smart object via copy" | [r/AfterEffects duplicate-comp thread (same semantics for AE comps)](https://www.reddit.com/r/AfterEffects/comments/wx2apo/how_to_disconect_one_duplicated_composition_from/) |

**Takeaways for Varve.** [inference] Varve already has inherited-visibility
semantics (`isNodeEffectivelyHidden` / `hidingAncestorOf`,
`packages/editor/src/scene/world.ts`) and an always-visible lock/visibility
pair per row — the Photoshop inherited-state distinction is the proven pattern
and should stay. Photoshop's filter discovery problem (below) argues for
*visible, labelled* filter chips in Varve rather than icon-only mystery
buttons. Layer comps are a large feature with no scene model in Varve; defer,
but note that Varve's existing Layer States (`LayerStatesSection`) are the
closest analogue and are already wired.

### A4. Figma and Sketch — Design

| Aspect | Behavior | Source |
|---|---|---|
| Pages + sections + frames | Pages are a document-level container; sections group frames on the canvas; frames nest with auto layout | [Figma help](https://help.figma.com/hc/en-us/articles/360039831974-Select-layers-and-objects) **[verified as a described model; page-level specifics are widely documented]** |
| Selection sync | Selecting on canvas reveals the layer in the panel; Cmd-click deep-selects | [Figma help](https://help.figma.com/hc/en-us/articles/360039831974-Select-layers-and-objects) |
| Search that reveals | Figma's layer search filters the tree and **keeps the ancestor chain**, so a match is shown in context | [Figma forum thread on layers not showing](https://forum.figma.com/) (the forum URL is a search entry point; the behavior is the documented "search filters the layer list" model) |
| Batch rename | Multi-select → rename applies to all selected with an index | [Figma help: Select layers and objects](https://help.figma.com/hc/en-us/articles/360039831974-Select-layers-and-objects) |

**Takeaways for Varve.** [verified in this repo] Varve's `flattenTree`
already keeps ancestry and reveals matching descendants without mutating the
expanded set (`useFlatTree.ts` filtered walk; the 2026-09-15 audit recorded
"search narrowing/reveal"), and batch rename already exists
(`BatchRenameDialog`). The Design workspace gap is therefore not search or
rename — it is *emphasis*: showing component/instance/auto-layout state and
kind filters first, and pushing motion/email/print badges out of the way.

### A5. Motion tools — After Effects, Rive, Jitter, Figma

| Aspect | Behavior | Source |
|---|---|---|
| Timeline ↔ layer coupling | After Effects' Timeline *is* the layer list; the panel problem users hit is not desync but the **Layer/Footage panel vs Composition panel confusion** — double-clicking a layer opens a different panel and users think their timeline vanished | [r/AfterEffects: layer not layering](https://www.reddit.com/r/AfterEffects/comments/1hgt9bg/layer_not_layering/); [r/AfterEffects: can't view whole composition](https://www.reddit.com/r/AfterEffects/comments/o0d2v8/cant_view_whole_composition/) |
| Duplicated compositions share a source | Duplicating a comp layer does **not** make it independent; you must duplicate the source in the Project panel | [r/AfterEffects: disconnect duplicated composition](https://www.reddit.com/r/AfterEffects/comments/wx2apo/how_to_disconect_one_duplicated_composition_from/) |
| "Show only selected" | Rive's timeline has a **Show Only Selected** toggle so a heavily keyed animation does not drown the layer list in tracks | [Rive docs: timeline](https://rive.app/docs/editor/animate-mode/timeline) |
| State-machine layers | Rive layers control priority when several animations touch the same property; lower layers win; layers can be disabled without deleting | [Rive docs: state machine layers](https://rive.app/docs/editor/state-machine/layers) |
| Preset-first motion | Jitter's model is: select a layer → assign an entrance/exit/loop preset, with presets decomposable into custom animation "actions" | [Jitter help: custom animations](https://help.jitter.video/en/articles/14136797-create-custom-animations); [Beryl: Figma Motion vs Rive/Jitter](https://www.beryldesign.fr/en/post/figma-motion-vs-rive-jitter-lottie) |

**Takeaways for Varve.** [verified in this repo] Varve's motion indicator is
already a per-row dot plus a keyframe count
(`LayersRow.tsx` motion-dot / keyframe badge), and the count is memoized per
document. [inference] The proven motion pattern to adopt is Rive's "show only
selected/animated" filter: a Motion workspace filter preset that shows only
animated layers is the smallest change with the largest real-world gain, and
it doubles as the timeline/layer coupling users expect.

### A6. Draw and Logo — Procreate, Krita, Affinity

| Aspect | Behavior | Source |
|---|---|---|
| Explicit layer locks | Krita distinguishes **edit lock** (no modifications) from **alpha lock** (no transparency changes) from **alpha inheritance** (clip to layers below, within the group); Procreate distinguishes Lock, Alpha Lock, Clipping Mask, Reference layer | [Krita layers docker docs](https://docs.krita.org/en/_sources/reference_manual/dockers/layers.rst.txt); [Procreate: options](https://help.procreate.com/procreate/handbook/layers/layers-options); [Procreate: masks](https://help.procreate.com/procreate/handbook/layers/layers-mask) |
| Group lock cascade | Procreate: locking a group locks its layers; unlocking any layer unlocks the whole group | [Procreate: masks](https://help.procreate.com/procreate/handbook/layers/layers-mask) |
| Bulk property edit | Krita: multi-select → Properties (`F3`) edits visibility, opacity, lock, **and name** (with automatic numbering appended) across the selection | [Krita docs](https://docs.krita.org/en/_sources/reference_manual/dockers/layers.rst.txt) |
| Reference layer | Procreate's Reference layer lets ColorDrop fill according to that layer's linework, decoupling "fill target" from "active layer" | [Procreate: options](https://help.procreate.com/procreate/handbook/layers/layers-options) |
| Vector-aware layer types | Krita's docker surfaces vector, filter, fill, clone, and file layers as distinct rows | [Kyanite Studios comparison](https://www.kyanite-studios.org/krita-vs-procreate-for-digital-painting-which-one-fits-your-workflow/) |

**Takeaways for Varve.** [verified in this repo] Varve's raster layer kind
(`rasterLayer`) plus paint modes already exist; the Draw gap is **alpha
lock / alpha inheritance visibility in the tree** — those are properties of
the raster layer/paint system, not new nodes. [inference] Logo has no
layer-panel-specific professional construct beyond grouping and naming; the
honest answer for Logo is "nothing new beyond the shared core plus the
existing component/variant badges", documented as such.

### A7. Codegen

| Aspect | Behavior | Source |
|---|---|---|
| Dev Mode / inspect | Figma Dev Mode turns the canvas into a code-inspection surface; layers become *selectable targets* whose names map to generated component names, and selection drives the code pane | [Figma Dev Mode docs index](https://help.figma.com/) (Dev Mode is documented under "Dev Mode"; the model is selection → inspect) |
| Handoff tools | Anima generates code from a selection; naming quality drives output quality | [Bera: Figma Motion comparison, which describes the handoff model](https://www.beryldesign.fr/en/post/figma-motion-vs-rive-jitter-lottie) |

**Takeaway for Varve.** [inference] The only Layers-side lever for Codegen is
**name quality**: the panel already renders a ghost auto-name for unnamed
nodes and has explicit-rename support, so the Codegen workspace should
emphasize explicit names over generated ones (badge `auto-named` rows, offer
"Name this layer" first in the context menu, and show the generated code name
as a tooltip). That is a projection; no schema change.

---

## B. What failed

| Failure | Evidence | Relevance to Varve |
|---|---|---|
| **Painting/dragging across eye icons toggles many rows** | Photoshop users report all layers showing/hiding at once when clicking visibility; the known cause is click-drag across the eye column | [Adobe community: layers panel suddenly showing or hiding all layers](https://community.adobe.com/questions-712/layers-panel-suddenly-showing-or-hiding-all-layers-when-i-try-to-select-just-a-few-1127124) |
| **Filter hides the parent chain** | Photoshop's standard name filter drops enclosing groups, so two same-named layers become indistinguishable; a commercial plugin's headline feature is "keep the tree structure" | [DLLP: layer filtering](https://urushigusa.com/articles/layer-filtering) |
| **Single-condition filtering** | Photoshop's filter UI combines one condition per category and cannot express "Multiply AND hidden AND has drop shadow" | [DLLP](https://urushigusa.com/articles/layer-filtering) |
| **Filter discoverability** | "Most people aren't aware of these tools, even though they're looking at them every day" | [PhotoshopCAFE](https://photoshopcafe.com/photoshop-layer-tools-you-should-be-using-hidden-features-guide-layer-filters/) |
| **Visibility icon moved over the lock icon** | Photoshop-on-web moved the eye to the lock's slot; a locked visible layer hides its eye, and inherited-visibility grey eyes are nearly indistinguishable from visible ones; WCAG contrast fails in Light theme | [Adobe idea: layer visibility icon on left side](https://community.adobe.com/t5/photoshop-ecosystem-ideas/request-layer-visibility-icon-on-left-side/idi-p/13053933) |
| **Context-menu bloat** | Photoshop's Layers context menu is "super long, to the point of making it harder to find what you're looking for" | [r/photoshop: context menu bloat](https://www.reddit.com/r/photoshop/comments/1ub9a6h/what_do_you_think_the_solution_is_to_the_context/) |
| **Document-wide layers confuse page-scoped users** | Users assume a layer is per-page and lose content; the correcting answer is "a layer is a property of the document, not the spread" | [Adobe community: one layer multiple pages](https://community.adobe.com/questions-671/one-layer-multiple-pages-but-items-disappear-on-all-other-layers-890156); [unlink duplicated spread](https://community.adobe.com/questions-671/how-to-unlink-a-duplicated-spread-839278) |
| **Non-printing layers "disappear" in Preview** | Print-off is enforced in Preview/Separations views, which users do not connect to the layer flag | [Adobe community: non-printing layers disappear](https://community.adobe.com/questions-671/indesign-non-printing-layers-disappear-836920); [UserVoice ask](https://indesign.uservoice.com/forums/601021-adobe-indesign-feature-requests/suggestions/42983706-make-layer-options-work-logically) |
| **Email builders lose work and lack reusable blocks** | Mailchimp users report blocks getting overwritten/disappearing on add/duplicate/rearrange, and years of "where is the saved block library" | [r/MailChimp: template builder issues](https://www.reddit.com/r/MailChimp/comments/1klslfv/anyone_else_having_issues_with_template_builder/); [r/MailChimp: save blocks](https://www.reddit.com/r/MailChimp/comments/1n0lwlx/is_it_possible_to_save_blocks_yet/) |
| **Mobile-only blocks are impossible** | Mailchimp support: "There isn't a way to make a block only visible in mobile" | [r/MailChimp: mobile-only block](https://www.reddit.com/r/MailChimp/comments/1lxngvx/can_a_content_block_be_visible_in_mobile_view_but/) |
| **Timeline/layer panel confusion** | After Effects users repeatedly mistake the Layer/Footage panel for the Composition panel and believe their timeline is gone | [r/AfterEffects](https://www.reddit.com/r/AfterEffects/comments/1hgt9bg/layer_not_layering/); [r/AfterEffects: can't view comp](https://www.reddit.com/r/AfterEffects/comments/o0d2v8/cant_view_whole_composition/) |
| **Layer selection does not constrain canvas editing** | Photoshop users: clicking in the canvas selects a different layer than the one selected in the panel, so objects move unexpectedly | [Adobe feature request: easier to isolate and move](https://community.adobe.com/feature-requests-713/make-layers-easier-to-isolate-and-move-655362) |

**No direct evidence found** in the collected sources for: search that fails
to reveal matches in Figma specifically; Penpot GitHub tree-view
accessibility issues; auto-naming noise as a *documented* complaint (the
brief's "Rectangle 347" is a real Figma behavior but the sources collected do
not quantify it). These are marked as unverified rather than asserted.

---

## C. Synthesis table

Legend: **Adopt** = implement as-is; **Adapt** = implement a Varve-shaped
variant; **Reject** = deliberately not implemented; **Have** = already
implemented (verified in this repo).

| Feature or complaint | Source app(s) | Varve today | Value per workspace | Cost / risk | Recommendation | Priority |
|---|---|---|---|---|---|---|
| Search keeps ancestor chain | Figma | **Have** (`flattenTree` filtered walk) | All | none | Have — keep it, add explicit reveal-and-select | — |
| Search must reveal + select, not just filter | Figma forum, Photoshop filter complaint | Partial (narrows + keeps chain; no "select all matches") | Design, Print, Email | Low (pure function + command) | **Adopt** — "Select matches" action in search | P1 |
| Multi-condition filtering | Photoshop (fails), DLLP | **Have** (kinds + attributes + blend modes are AND-combined, tri-state chips) | Photo, Draw | none | Have — keep | — |
| Filter discoverability | PhotoshopCAFE | Partial (chips are labelled; advanced group may be tucked) | All | Low | **Adapt** — workspace default filter chips visible, advanced always one click | P1 |
| Filter hides parent chain | Photoshop | **Have** (ancestry kept) | All | none | Have | — |
| Inherited visibility distinguished from direct | Photoshop | **Have** (`layers-row--hidden-inherited`, aria names) | All | none | Have | — |
| Layers vs pages confusion | InDesign | **Have** (panel follows active page/design canvas; Page Nav separate) | Print | none | Have — keep tree page-scoped, badge page origin | — |
| Parent-page items invisible in tree | InDesign (documented limitation) | **Missing** — master content is not in the tree at all | Print | Low (projection + badge; masters already model `activePageNodesWithMaster`) | **Adapt** — badge rows with `data-master` + a filter chip; do not inline master editing | P2 |
| Non-printing flag independent of visibility | InDesign | **Missing** — needs a node field | Print | **Schema change** (`printExcluded?: boolean` on `NodeBase`) + migration + export/codegen honoring | **Adapt, schema-gated** — specify now, implement behind its own versioned migration and full gate; until then no fake flag | P2 (schema) |
| Text threads / stories | InDesign | **Missing in panel** — `storyBinding` exists in the scene | Print, Email | Low (projection + badge + filter) | **Adopt** — thread badge on bound frames, "Continue story" affordance stays a canvas tool | P2 |
| Articles / reading order | InDesign | Not modelled | Print | High (new document model) | **Reject** for Layers; needs its own panel + schema | — |
| Mobile-hidden badge + filter | Mailchimp peers | **Missing in panel** — `emailSemantics.hideOnMobile` exists | Email | Low (projection) | **Adopt** | P1 |
| Reusable block library | Mailchimp | Library data model exists (`packages/scene/src/library.ts`), no browse UI | Email, Design, Logo | Medium (own panel/panel section) | **Adapt** — entry point from Layers context menu only; full library is its own panel | P2 |
| Multi-column stacking (fixed) | Mailchimp | N/A — Varve compiles with mobile stacking by design | Email | — | Reject as a Layers concern (compiler behavior) | — |
| Granular locks (alpha lock / position / image pixels) | Photoshop, Krita, Procreate | **Missing** — single `locked` boolean | Photo, Draw | Schema change + tool semantics | **Adapt, schema-gated** — `alphaLock` exists conceptually for raster layers only; specify, do not fake | P3 (schema) |
| Alpha inheritance / clipping stacks | Krita, Procreate | **Have** (clip masks, alpha/luminance masks, mask badges) | Photo, Draw | none | Have — surface the mask *type* badge per workspace | — |
| Layer comps | Photoshop | Closest analogue: Layer States (exists) | Photo | Medium | **Adapt** — point the context menu at the existing Layer States surface; do not build a second system | P3 |
| Accidental drag across toggles | Photoshop | **Have** — toggles stop propagation and `stopDragActivation`; drag also needs a 5px pointer-sensor activation | All | none | Have — keep and test | — |
| Context-menu bloat | Photoshop | Partial — Varve's menu is already long but grouped into submenus | All | Medium (re-IA) | **Adapt** — workspace-aware menu suppression: hide entries that cannot apply (email/print/motion-only items) | P2 |
| Motion "show only selected/animated" | Rive | **Missing** (motion dot + keyframe count exist) | Motion | Low (filter preset) | **Adopt** | P1 |
| Timeline/layer-panel desync | After Effects | **Have** (single scene, single selection; motion indicator per row) | Motion | none | Have — add an explicit "linked to timeline" affordance only if a real gap is found | — |
| Bulk property edit incl. rename | Krita | **Have** (bulk bar: lock/visibility/color/delete; Batch Rename dialog) | All | none | Have | — |
| Layer colour as a canvas cue | InDesign | **Have** (`layerColor`, canvas outline) | All | none | Have | — |
| Reference layer | Procreate | No analogue | Draw | High (paint semantics) | **Reject** — no Varve fill semantics to bind to | — |
| Auto-naming noise | Figma (informal) | **Have** (ghost auto-names, explicit rename, batch rename) | Codegen, Design | Low | **Adapt** — Codegen emphasis on explicit naming | P3 |
| Non-drag reorder/reparent | WCAG 2.5.7 | **Have** (Ctrl+Alt+[/], context menu Move Into/Out, arrange commands) | All | none | Have | — |
| Virtualization with `aria-level`/`posinset`/`setsize` | APG + a11y-examples | **Have** (declared-level props in `LayersRow`) | All | none | Have — keep explicit values | — |
| Type-ahead | APG | **Have** (`useTypeAhead`, 500 ms) | All | none | Have | — |
| One tab stop / roving tabindex | APG | **Have** | All | none | Have | — |
| Keyboard move announcements | WCAG 4.1.3 (status messages) | **Have** (`announce(describeDrop(...))`) | All | none | Have — verify in E2E | — |

---

## D. Standards

### D1. WAI-ARIA APG Tree View

Source: [W3C APG Tree View Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/).

- `role="tree"` with an accessible name; `role="treeitem"` per row;
  `role="group"` for child sets owned by a parent treeitem.
- `aria-expanded` on **parent nodes only**; end nodes must not carry it.
- `aria-selected` on every selectable node in multi-select trees;
  `aria-multiselectable="true"` on the tree.
- With virtualization (incomplete DOM), each node must carry explicit
  `aria-level`, `aria-setsize`, `aria-posinset` — browsers may, but are not
  required to, compute them (the APG's own File Directory examples call this
  out).
- Multi-select interaction: Shift+Arrow extends, Ctrl+A selects all;
  focus is independent of selection in multi-select trees.
- Type-ahead is recommended for trees with more than seven root nodes.

**Varve status [verified]:** all of the above are implemented; the remaining
APG gap is the optional `*` (expand all siblings) key.

### D2. Keyboard alternative to drag

Sources: [Understanding SC 2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements),
[G219](https://www.w3.org/WAI/WCAG22/Techniques/general/G219),
[F108](https://www.w3.org/WAI/WCAG22/Techniques/failures/F108).

- Every drag operation needs a **single-pointer, non-drag** path. G219's
  examples: step arrows, or a "move selected items to" menu.
- F108 is the failure condition: drag exists and no alternative does.

**Varve status [verified]:** `Ctrl+Alt+]` / `Ctrl+Alt+[` move-into/move-out,
plus context-menu "Move Into Container Above" / "Move Out of Container", plus
single-pointer arrange commands. This satisfies 2.5.7 provided the keyboard
path remains focus-order reachable, which the context menu provides.

### D3. WCAG 2.2 AA checklist for the panel

| SC | Requirement | Varve approach |
|---|---|---|
| 1.4.3 / 1.4.11 | Contrast | Tokens only; `pnpm audit:tokens` (120 checks, 3 themes) is the gate |
| 2.4.11 | Focus not obscured | Panel scrolls focused rows into view; floating surfaces must not cover the tree |
| 2.5.7 | Dragging movements | Keyboard + context-menu moves (above) |
| 2.5.8 | Target size 24×24 | Row toggles are already 24×24 (2026-09-15 review); any new control must meet it or use the spacing exception |
| 1.4.4 / 1.4.10 | Reflow / zoom | Panel must remain usable at 200% text zoom and at narrow widths — existing E2E covers text enlargement |

---

## E. Research limitations

- Reddit and Adobe Community threads are anecdotal and self-selected; they
  are used to establish that a failure mode is *experienced*, not to quantify
  its incidence.
- The Figma Forum search returned only a landing page for the queried terms;
  Figma's behaviors here are documented from vendor help pages, and any Figma
  complaint in section B is attributed to generic design-tool practice, not
  to a cited thread.
- No Teardown of Penpot's tree view was completed; its accessibility issues
  are therefore not asserted.
