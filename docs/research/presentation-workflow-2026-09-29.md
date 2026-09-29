# Presentation workflow research ledger — 2026-09-29

This ledger records dated public product guidance and user-reported problems
that informed the local presentation workflow. Forum reports are evidence of
individual experiences, not prevalence estimates. Status below reflects the
source at the date checked, 2026-09-29.

## Source and decision ledger

| Source and date | Observed problem or product behavior | Decision for Varve | Regression / acceptance check |
|---|---|---|---|
| [Figma community: changing an existing slide layout](https://forum.figma.com/ask-the-community-7/how-do-i-change-the-layout-of-an-existing-slide-in-figma-slides-46971), opened 2025-11-05; replies through 2026-07-07 | The original author said applying a different layout after slide creation was unavailable and described rebuilding 25 imported slides. Community support suggested inserting a new slide from a template and called the report a feature request. The forum's “Solved” marker labels the support reply, but the reply describes a workaround, not delivery of layout reassignment. A 2026-02-24 reply clarifies that Template Style changes text styles and color fills, not layout geometry. | Permit layout reassignment on existing editable frames. Preview geometry changes and explicitly reapply; preserve content, local overrides, and extra artwork. | Apply a different layout to a populated slide; verify title/body/media content identities, text runs, image crop, notes and extras survive; verify preview does not mutate and Apply is one undoable operation. |
| [Figma community: PPTX export fidelity](https://forum.figma.com/report-a-problem-6/issue-with-exporting-slides-to-pptx-format-42753), 2025-07-13 to 2025-07-14 | A user reported missing backgrounds and decorative shapes when exporting to PPTX. Support did not reproduce the rounded-rectangle loss, did observe a mask issue, and passed it to the team; the thread has no recorded fix. | Ship a rasterized screen PDF and PNG sequence first. Describe PDF as visual output rather than editable or accessible slide structure; defer PPTX pending a feasibility and fidelity assessment. | Compare masked, clipped, effect-heavy frames in editor, thumbnail, audience preview, reopened document and actual exported PDF/PNGs. Parse PDF pages and verify ZIP filenames/order. |
| [Figma community: Slides export unavailable](https://forum.figma.com/report-a-problem-6/can-no-longer-export-in-figma-slides-52514), 2026-04-01 to 2026-04-17 | The application export command was temporarily greyed out. Figma support said the issue appeared fixed after restarting; the author confirmed on 2026-04-02. A later report concerned individual-asset export from Slides mode; support clarified it belongs in Design mode. | Keep deck delivery reachable from the same local workflow, with explicit empty/missing-resource/write-failure outcomes. Do not conflate per-object export with deck export. | Exercise successful save, cancellation, missing resources, and write failure; controls remain available when one output path is unavailable. |
| [Apple Keynote: tagged layout placeholders](https://support.apple.com/en-ae/guide/keynote/tan7a2b69972/mac), checked 2026-09-29 | Placeholder tags identify where text/media should flow when layouts change. Untagged objects added to a source layout can become background content rather than editable slide objects. | Use stable Varve content-role keys on editable source frames. Keep unmatched and additional slide artwork editable and warn when content has no destination. | Reapply a layout with matching and unmatched roles; verify matched content moves, unmatched content stays editable, and missing/deleted source references remain recoverable. |
| [Apple Keynote: reapplying a layout](https://support.apple.com/en-ca/guide/keynote/tan584189747/mac), checked 2026-09-29 | Keynote describes reapplying a slide layout as restoring placeholder style/position and background while retaining content. | Track only managed properties and distinguish inherited values from local overrides. Preview before applying a source revision; provide separate geometry, formatting and per-override resets. | Edit source geometry, preview reflow, cancel, then apply and undo; verify local overrides and object IDs persist. |
| [W3C WCAG 2.2, SC 2.5.7 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html), page updated 2026-08-10; checked 2026-09-29 | Dragging functionality needs a single-pointer alternative that does not require dragging. W3C lists adjacent up/down controls for sortable lists as an example. | Provide Move earlier, Move later, and Move to position actions in addition to pointer reorder. | Mouse/touch/keyboard reorder paths produce the same sequence; each control has accessible name and announces the new position. |
| [PptxGenJS docs and MIT license](https://gitbrent.github.io/PptxGenJS/docs/api-images/), checked 2026-09-29 | The library documents PNG/JPEG image slides, image sizing/cropping, browser-compatible builds and binary save output. Microsoft documents that a PresentationML file also has package structure for themes, masters, layouts, notes and slide references. | **Feasible as a later raster-only adapter, with a short spike first.** Rendering each included frame to a PNG and placing it on a PPTX slide should preserve Varve's masks and visual effects while sacrificing per-object editability, searchable text, and structured accessibility. Browser bundling, binary save, license inclusion, notes privacy, mixed slide dimensions, page bounds and output fidelity still need an end-to-end prototype in this repository. Do not advertise editable PPTX or add import scope based on library examples. | Build a local spike with 16:9, 4:3 and vertical source frames, images with crop/mask/effects, and private notes. Inspect ZIP package and render in at least one independent office suite; confirm notes are absent, decide global/per-slide dimensions, and measure memory before estimating product scope. |

## Product baseline audit

Performed in a local desktop webview build on 2026-09-29 using the Design
workspace and a disposable frame/document. The test document was local to the
audit origin and was not added to repository fixtures.

| Area | Baseline observation | Evidence type | Required correction |
|---|---|---|---|
| Authoring model | Creation starts a normal design document/frame. No persistent deck, ordered slide-reference model, or slide notes/skip/section controls were found. Existing frame presets are usable artwork but do not form a presentation sequence. | UI walkthrough and scene model audit | Add versioned optional deck metadata referencing ordinary frames; resolve order from the deck, not canvas coordinates or paint order. |
| Preview | Ctrl+Shift+P opens the existing single-frame Prototype Preview. Layers and Inspector dock headers remain visible over the audience-sized white preview, obscuring slide content. | Reproduced visually in local webview | Host audience preview in the shared top-layer dialog stack and verify dock chrome is absent at desktop and tablet sizes. |
| Export | Existing export UI is per-node/per-layer and offers image/vector/document assets. It has no ordered multi-frame PDF or PNG-sequence path. The current browser raster-PDF helper emits one page. | UI walkthrough and source audit | Add deck and selected-slide targets, sequence-aware capture, multipage PDF and ordered PNG ZIP; report success only after save completes. |
| Frame fidelity | The existing prototype preview path flattens a screen result for thumbnails and does not provide the structured, exact-frame-clipped capture needed for slide export. The general node export path includes effect-expanded bounds. | Source audit | Share a frame-local structured capture between thumbnails, preview and export; clip to slide dimensions and wait for fonts/assets. |
| Design safety | No presentation-specific destructive action was exercised because the workflow does not yet exist. Generic scene frame deletion and presentation slide-reference removal need distinct semantics. | Architecture audit | Removing a deck entry must preserve artwork, notes and unresolved references; deleting artwork must not silently erase the recovery record. |

## Implementation status

The online complaints above are converted into repository regression scenarios;
they are not used as claims about market-wide failure rates. Research scope is
qualitative. No Varve product analytics or user survey data was used.

## PPTX feasibility assessment — 2026-09-29

The most credible low-risk route is raster PPTX: reuse the validated frame-local
capture, place one PNG image on each slide, and let a PPTX writer package the
slides. PptxGenJS documents browser-compatible output, image placement and crop
controls, binary save forms, and is MIT licensed. This is a technical signal,
not a compatibility or fidelity result for Varve. Microsoft's PresentationML
documentation describes a package made from related slide, layout, master,
theme, and optional notes parts. Therefore preserving Varve's vector-editable
objects, slide masters, role placeholders, and tagged reading order would be a
separate substantial implementation rather than a small addition to the
raster writer. See the [PptxGenJS browser/save documentation](https://gitbrent.github.io/PptxGenJS/docs/usage-saving/),
[image sizing documentation](https://gitbrent.github.io/PptxGenJS/docs/api-images/),
[MIT license](https://github.com/gitbrent/PptxGenJS/blob/master/LICENSE), and
[Microsoft's PresentationML structure guide](https://learn.microsoft.com/en-us/office/open-xml/presentation/structure-of-a-presentationml-document).

**Decision:** defer PPTX export and all PPTX import. After the core delivery
path passes its actual-file visual checks, run the spike above and make a
separate scope decision. The main open question is page geometry for mixed-size
decks: current sources establish configurable presentation layouts but do not
establish that the chosen library can assign different physical dimensions to
each slide. PDF and PNG remain the required outputs and retain their per-frame
dimensions. The raster PPTX option would also need an explicit visual-only
label; it could not promise searchable/editable text, native masks, editable
objects, notes, or accessible reading order.

## Post-core delivery check — 2026-09-29

The browser now exported the three-slide `Local field notes` fixture through
Varve's save adapter. `pdfinfo` reported three 960×540pt pages; `unzip -l`
reported `01-A-better-story.png`, `02-The-sequence.png`, and `03-Local-work.png`
in deck order. I inspected all three full-size PNGs and all three pages
rendered from the PDF against the audience preview. Text, solid shapes, slide
backgrounds, and explicit order matched visually. This fixture contains no
images, masks, or effects; no PPTX was generated, and no office suite was used.

This confirms a local image-per-slide pipeline can feed the tested PDF/PNG
writer, but it does not resolve PPTX packaging, mixed per-slide physical page
sizes, office renderer behavior, image/mask fidelity, or memory under actual
PPTX encoding. The recommendation remains to defer PPTX adoption until the
independent raster-only spike above passes. Do not advertise PPTX export or
import in the current source-build pages.
