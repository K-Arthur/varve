# Presentation workflow research, follow-up (2026-09-29)

Fresh online research for a design-tool team building slide authoring inside a
design app. Two directions were covered: what incumbent tools guarantee, and
what users actually complain about.

Method: `webfetch` on real URLs (primary), `websearch` to find pages and to
cover sources that refuse fetch. Every row is tagged:

- **VERIFIED-BY-FETCH** — the page body was retrieved and read in this session.
- **SEARCH-SNIPPET-ONLY** — content came from search results (the page blocked
  fetch, returned a JS shell, or was not fetched to save budget).

Anchor URLs from the brief: all seven resolved (no 404s). Two anchors returned
non-article bodies on fetch (see "Inaccessible sources").

---

## 1. Ledger

| # | Source + URL + date/version | Observed capability or complaint | Relevance | Decision it implies | Candidate acceptance test | Tag |
|---|---|---|---|---|---|---|
| 1 | Microsoft Support, "What is a slide master in PowerPoint?" — https://support.microsoft.com/en-us/powerpoint/training/what-is-a-slide-master-in-powerpoint (undated support page; fetched 2026-09-29) | Master/layout edits propagate to *future* slides; existing slides need the layout **reapplied**. Microsoft explicitly advises editing masters *before* building slides, and warns that master-defined elements are not editable in Normal view ("why can't I remove this picture?"). | The core master/layout contract, and its first documented footgun. | Varve must decide, and document, whether a layout edit retro-applies, applies prospectively, or prompts. Silence here is what makes users think content was destroyed. | Edit a layout after 20 slides exist; assert a per-slide policy flag (retro / prospective / prompted) and that no slide loses authored content either way. | VERIFIED-BY-FETCH |
| 2 | Microsoft Support, "Edit and re-apply a slide layout" — https://support.microsoft.com/en-us/powerpoint/edit-and-re-apply-a-slide-layout (undated) | After adding a placeholder or altering a layout you **must reapply** the layout to each slide; reapply = Home > Layout > pick layout, optionally Reset. | Reapply is a manual, per-slide repair loop in the incumbent. | Ship reapply/reset as a first-class, multi-select, undoable bulk command with a diff preview. | Select 10 slides, run "Reapply layout", confirm one undo step restores prior overrides byte-for-byte. | SEARCH-SNIPPET-ONLY |
| 3 | Apple Keynote User Guide, "Add and edit slide layouts in Keynote on Mac" — https://support.apple.com/en-kg/guide/keynote/tan7a2b69972/mac (guide build 15.4, asset `6A304288…`) | Objects added to a layout become **background and are not editable** on the slide unless made placeholders; placeholders carry a **tag** ("Media", text) so content migrates when the slide switches layout; "Allow layering" opts slides into layering under layout objects. | Best-documented answer to "changing layout destroyed my content": content survives only if it lives in tagged placeholders. | Adopt tagged placeholders + a documented "everything else is background" rule, or Varve will re-learn Keynote's confusion the hard way. | Switch a slide to a layout with matching tags; assert tagged content re-binds and untagged objects are explicitly reported (moved to background / kept as free objects), never silently dropped. | VERIFIED-BY-FETCH |
| 4 | Apple Keynote User Guide, "Apply a slide layout in Keynote on Mac" — https://support.apple.com/en-kg/guide/keynote/tan584189747/mac (same guide version) | "Reapplying the slide layout **won't delete your content**"; reapply resets placeholder style/position, background, and default visibility. Reapply is unavailable while a presentation is shared (collaborating). | A vendor guarantee worth copying verbatim in spirit: reset is formatting-only. | Detach/reset operations must be defined as *formatting* operations over *content*, and must be allowed in collaborative sessions. | Populate placeholders with custom text + add a free object, run reapply; assert content bytes unchanged, only resolved style/geometry change. | VERIFIED-BY-FETCH |
| 5 | Apple Keynote User Guide, "Play a presentation on a separate display" — https://support.apple.com/en-gb/guide/keynote/tana4da2681/mac | Presenter display configurable per screen (current/next slide, notes, clock, timer); docs warn **mirroring hides the presenter display**; multi-display layout customisable. | Dual-display expectations: audience screen must be *clean*, presenter screen configurable. | Presenter mode needs an explicit display-assignment UI plus a "you are mirroring" warning, not silent guessing. | Simulate two displays (and a mirrored configuration); assert audience surface never contains notes and the app warns when mirroring. | SEARCH-SNIPPET-ONLY |
| 6 | Figma Help, "Export from Figma Slides" — https://help.figma.com/hc/en-us/articles/24848334599447-Export-from-Figma-Slides (current as of 2026-09-29) | PPTX export offers **Structure: editable objects vs flatten to bitmap**. Documented limits: missing fonts fall back to the default PowerPoint font; live interactions and code blocks become static images; **gradient fills become solid fills**; bulk export unsupported. | The clearest vendor-published conversion-limit list found. | Ship the same honest, per-feature export matrix — and an explicit editable-vs-flatten choice — instead of a single "Export to PPTX" button. | Export a deck with gradients, missing fonts, and an interactive element; assert the emitted limits report matches a fixture list, and flatten mode produces raster slides that still open. | VERIFIED-BY-FETCH |
| 7 | W3C, Understanding SC 2.5.7 Dragging Movements (WCAG 2.2, Level AA) — https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html (page updated 10 August 2026) | Every dragging function needs a **single-pointer non-drag alternative**; this is separate from keyboard (2.1.1); a sortable list may offer tap-then-arrow move controls; path-based gestures also fail 2.5.1. | Drag-only slide reordering is a documented AA failure (F108). | Slide reorder ships with click-to-place and/or move-up/down menu controls, plus keyboard; not drag alone. | Keyboard-only and tap-only reorder of a 10-slide deck passes an automated a11y check and completes without any pointer-down/move/up sequence. | VERIFIED-BY-FETCH |
| 8 | Microsoft Learn, "Structure of a PresentationML document" — https://learn.microsoft.com/en-us/office/open-xml/presentation/structure-of-a-presentationml-document (ms.date 2024-11-26, updated 2025-03-26) | Package parts: `presentation`, `sldMaster`, `sldLayout`, `sld`, `theme`, `notes`, `notesMaster`, `handoutMaster`, comments. Slide order is `<p:sldIdLst>` of `slideID` + relationship ids; masters/layouts/themes are separate parts with explicit/implicit relationships; **circular references** between layouts and masters. | The structural contract any PPTX importer/exporter must honour; also explains why "slide number" and "slide order" break independently. | Round-trip tests must be part-level (order list, layout linkage, notes part presence), not screenshot-level. | Import → export a fixture deck; assert `sldIdLst` order, layout→master links, and notes/handout parts survive, and reopen in PowerPoint-compatible tooling. | VERIFIED-BY-FETCH |
| 9 | python-pptx 1.0.0 docs — https://python-pptx.readthedocs.io/ (v1.0.0, fetched 2026-09-29) | Round-trips any .pptx including all elements; placeholders, tables, charts, notes slides, hyperlinks supported; authors state the format is richer than the library ("features python-pptx does not support"). No PowerPoint installation needed. | Mature, testable PPTX reader/writer for a Rust/TS pipeline (also usable as an oracle in CI). | Use a real library as the round-trip oracle; never hand-roll zip/XML parsing for tests only. | Fuzz a corpus of decks through python-pptx; assert no exception and stable re-save diff for supported features. | VERIFIED-BY-FETCH |
| 10 | Figma Forum, "How do I change the layout of an existing slide in Figma Slides?" — https://forum.figma.com/ask-the-community-7/how-do-i-change-the-layout-of-an-existing-slide-in-figma-slides-46971 (posted 2025-11-05; replies through 2026-07-07) | Official answer: **"It is not possible to change a Slide's layout after it's been created."** Workaround = create a new slide from template and rebuild; one user recreated 25 imported slides and called it painful; another said this alone blocks a paid subscription. Template Style only restyles text/colours. | A design-first competitor shipped without layout reassignment — the single most-cited brownfield gap. | Layout reassignment on existing slides is a **day-one** requirement for Varve, not a v2 feature. | Change layout of a populated slide in place; content maps by tag/role, one undo, no manual rebuild. | VERIFIED-BY-FETCH |
| 11 | Figma Forum, "Issue with exporting slides to .pptx format" — https://forum.figma.com/report-a-problem-6/issue-with-exporting-slides-to-pptx-format-42753 (2025-07-13) | Frames with text export to PPTX **missing backgrounds, rounded rectangles and masks**, leaving text only; reporter asks for at least whole-frame PNG. Staff: masks behaviour is not documented; escalated. | Export fidelity failures are reported as *content loss*, not "style drift". | Degrade per-slide to a raster fallback when a shape class is unsupported, and say so in the export report. | Export a deck containing masks/rounded rects; assert no slide loses opaque background coverage, and unsupported layers are listed in an export manifest. | VERIFIED-BY-FETCH |
| 12 | Figma Forum, "Publishing template changes should auto-apply to existing slide decks" — https://forum.figma.com/suggest-a-feature-11/figma-slides-publishing-template-changes-should-auto-apply-to-existing-slide-decks-23115 (2024-06-30 → 2026-01-05) | Staff confirm published template changes apply **only to new decks** — "the Figma Slides team has not yet the capability to automatically push template changes to existing slide decks". Complaints: brand changes don't propagate; "easier to make slides in a regular Figma Design file". | Theme/brand propagation is the #1 promise users hold design-led slide tools to. | Varve's theme/token pipeline must push to *existing* documents, with an explicit update banner and a review diff. | Change a brand colour in the theme; all existing decks show a pending-update affordance; accepting updates re-renders without touching local overrides. | VERIFIED-BY-FETCH |
| 13 | Figma Forum, "Figma Slides – Color Bug?" — https://forum.figma.com/report-a-problem-6/figma-slides-color-bug-41746 (2025-06-12 → 2026-01-13) | "Remix Template Colors" resurrects **deleted** palette entries as broken variables; second user reproduced with a screencast; a user evaluating an org-wide switch says this alone would stop adoption. | Recolouring touching unrelated/removed artwork is a trust-destroying class of bug. | Global recolour must operate on a validated, live colour set only; deleted tokens must be unreferenced everywhere before a recolour runs. | Delete a token, run recolour/remix repeatedly (seeded); assert zero dangling references and zero colours outside the live palette. | VERIFIED-BY-FETCH |
| 14 | Microsoft Q&A, "PowerPoint old layout overrides the new template" — https://learn.microsoft.com/en-us/answers/questions/5015518/powerpoint-old-layout-overrides-the-new-template (2019-11-07, still referenced) | Pasting slides with "Use destination theme" carries source layouts; PowerPoint creates `1_Title`, `2_Title` duplicates unless **5 criteria** match (layout name, layout type, placeholder count, placeholder types, placeholder `idx`). Moderator: "deliberate… PPT has no way of knowing which aspects you want preserved". | The brownfield import problem in one page: layout identity is fragile, so tools *duplicate* layouts rather than risk data loss. | Import must match layouts on a defined signature and, on mismatch, create a clearly named derived layout instead of remapping silently — plus a cleanup pass for unused layouts. | Import a deck whose layout names match but placeholder counts differ; assert a derived layout is created, no slide changes appearance, and an "unused layouts: N" report appears. | VERIFIED-BY-FETCH |
| 15 | Microsoft Q&A, "PowerPoint Presenter View not showing on extended display" — https://learn.microsoft.com/en-au/answers/questions/5579683/powerpoint-presenter-view-not-showing-on-extended (2025-10-09 → fixed 2025-10-14) | Release 2509 (builds 19231.20156 / .20172) broke auto-switch from Duplicate → Extend; audience saw desktop or duplicated slides, Presenter View absent; three independent confirmations; resolved by the 2025-10-14 update, workaround was rolling back the Click-to-Run build. | Even the market leader's presenter pipeline regressed publicly and needed a rollback recipe. | Presenter mode needs a documented manual fallback (explicit display picker + swap) that works when OS auto-switching misbehaves. | Present with an OS "duplicate" configuration; assert the app detects it, offers swap, and never renders notes on the audience target. | VERIFIED-BY-FETCH |
| 16 | Microsoft Q&A, "Why do my PowerPoint notes and the next slide continue to show on the audience screen when Show PresenterView is enabled?" — https://learn.microsoft.com/en-us/answers/questions/5388802/ (2024-12-20) | Notes + next slide reach the public screen when Windows is in Duplicate/Second-screen-only rather than Extend; answer prescribes Extend + Slide Show Monitor selection. | Notes leakage is almost always a *display topology* failure, not a data failure. | Treat display topology as explicit state the user can inspect and correct mid-show. | Start a show in duplicate mode; assert a visible, keyboard-reachable remediation control, and that notes never appear on the audience output. | SEARCH-SNIPPET-ONLY |
| 17 | Apple Discussions, "Unable to access Presenter View when projecting my slideshow in Keynote" — https://discussions.apple.com/thread/254425501 (2022-12-01) | Presenter View absent on projector; fix = stop mirroring, then Play; a user reports "Stop Mirroring" greyed their laptop screen and they had to recover via System Preferences on the projector; another says Keynote "can't show Presenter Display when Mirror Displays is on". | Same failure mode as #16 in a different ecosystem → systemic, not app-specific. | Detect mirroring early; never require the user to operate settings *on the audience screen*. | With a simulated mirrored display, presenter entry shows a blocking-but-dismissible explanation instead of a black/incorrect output. | SEARCH-SNIPPET-ONLY (fetch blocked by bot check) |
| 18 | Google Docs Editors Community, "Exported PDF from Google Slides lose alt text" — https://support.google.com/docs/thread/260155900/exported-pdf-from-google-slides-lose-alt-text (2024-02-22) | Alt text added in the editor does not survive PDF export. | Accessibility metadata silently dropped at the most-distributed format. | Alt text must be part of the export contract for PDF (tagged) and PPTX; if it cannot be written, the export must warn. | Add alt text, export PDF/PPTX; assert description present in tags/metadata, else fail the acceptance test. | SEARCH-SNIPPET-ONLY (fetch returned a JS shell) |
| 19 | The Accessibility Guy, "Export Google Docs to Tagged PDF" — https://theaccessibilityguy.com/export-google-docs-to-tagged-pdf-google-docs-update/ (2025-11-03) | Google **Docs** gained tagged PDF export (2025) while **Google Slides still lacks tagged PDF** — inspecting a Slides PDF in Acrobat shows no tag structure. | Tagged vs raster export is a live differentiator in 2026; Slides is behind PowerPoint. | Varve's PDF path should target tagged output from day one — it is a cheap differentiator against Google and parity with PowerPoint. | Export PDF; assert a non-empty tag tree with reading order, or a documented "untagged" flag in the export report. | SEARCH-SNIPPET-ONLY |
| 20 | GrackleDocs, "Google Slides and Accessibility" — https://www.grackledocs.com/en_ca/google-slides-and-accessibility/ (2023-06-20) + Perkins, "Creating accessible Google Slides" — https://www.perkins.org/resource/creating-accessible-google-slides/ (2024-08-27) | No reading-order control or preview in Slides; tables/charts created in-app are not screen-reader navigable; alt text must be added manually with no enforcement; third-party add-ons are the workaround. | Reading order and structure are the two gaps users hit after alt text. | Reading order is an explicit, editable, inspectable model (not z-order), with a checker that runs before export. | Reorder objects so visual order ≠ z-order; assert the accessibility checker flags it and the exported reading order follows the explicit model. | SEARCH-SNIPPET-ONLY |
| 21 | Google Docs Editors Community + Reddit r/GoogleSlides/r/Google/r/techsupport/r/gsuite, "Speaker notes disappearing" (Jan 2026 cluster) — https://support.google.com/docs/thread/403752806/, https://www.reddit.com/r/GoogleSlides/comments/1qj6skl/ , https://www.reddit.com/r/GoogleSlides/comments/1qj74u8/ (2026-01-21/22) | Notes pane vanishes across accounts/devices while "Show speaker notes" stays checked; root cause identified as an overlay element covering the pane; workarounds: Tools > Dictate Speaker Notes, Ctrl+0 zoom reset, devtools deletion; Google acknowledged a fix. One teacher: captions written in notes became unreadable for 36 slides. | "Notes lost" is experienced as *data loss* even when the data still exists. | Notes pane state must be resilient (independent layout, no overlay), and notes must always be recoverable/exportable regardless of pane visibility. | Force the notes pane to zero height / hide it; assert notes content persists, is exportable, and restoring the pane shows the same bytes. | SEARCH-SNIPPET-ONLY (Reddit returned HTTP 403) |
| 22 | docs-to-pdf.com, "Bulk Convert Google Slides to PDF Without Speaker Notes" — https://docs-to-pdf.com/bulk/google-slides/without-speaker-notes (2026) | **Print settings are saved with the file**; a collaborator flipping "1 slide with notes" persists for everyone, so notes slip into distributed PDFs; checklist advice: verify layout before every batch export. | Notes leak into handouts through a *persisted, shared* setting rather than a bug. | Export intent (audience vs presenter vs notes) must be an explicit, per-export choice with a visible preview — never inherited silently from a saved preference. | Set notes layout, export "audience PDF"; assert output excludes notes and the choice does not persist into the next export without re-confirmation. | SEARCH-SNIPPET-ONLY (third-party, corroborates Google community threads) |
| 23 | StackExchange/WebApps, "How to export Google Slides speaker notes?" — https://webapps.stackexchange.com/questions/7564/ (2010-10-04, answers through 2020s) | No good notes export: printing truncates long notes, TXT loses formatting, "1 slide with notes" is the only route; a PPTX→Keynote round-trip preserved notes but PPTX→PowerPoint on Mac reformatted them. | Notes are second-class in every export path. | Notes export deserves a first-class, format-preserving target (Markdown/Text) plus notes-pages PDF. | Export notes for a 50-slide deck; assert full text, no truncation, stable structure. | SEARCH-SNIPPET-ONLY |
| 24 | Microsoft Support, "Start the presentation and see your notes in Presenter view" — https://support.microsoft.com/en-us/office/start-the-presentation-and-see-your-notes-in-presenter-view-4de90e28-487e-435c-9401-eb49a3801257 (undated) | Auto-detects two monitors; **"Display Settings → Swap Presenter View and Slide Show"** is the sanctioned one-click recovery; single-monitor Presenter View available from the control bar. | The recovery affordance users are taught to expect. | Ship a permanent, always-visible swap control in presenter mode. | Open presenter view on the wrong target, invoke swap from keyboard; assert surfaces exchange within one frame and state persists. | SEARCH-SNIPPET-ONLY |
| 25 | libreoffice-users mailing list, "[libreoffice-users] impress bug internal hyperlink" — https://www.mail-archive.com/users@global.libreoffice.org/msg58691.html (2024-02-15) | Internal slide hyperlinks **do not renumber** when a slide is inserted (link stays at target 100 while the content moved to 101); duplicates update "sometimes, in some slides". | Position-based references leak into navigation, numbering and links. | All cross-references bind to stable slide ids, never indices; renumbering is derived at render time. | Insert 3 slides before a linked target; assert the link still resolves to the same slide id and rendered page number updates. | VERIFIED-BY-FETCH |
| 26 | LibreOffice users/list threads + Reddit r/libreoffice, master duplication on copy/paste — https://www.reddit.com/r/libreoffice/comments/1hz10s8/ (2025-01-11) | Copy/pasting slides silently creates **independent copies of the master** (unlike duplicate), and pasting from another file drags its master along; author asks how to protect a file from "unwanted additional master slides". Users then cannot see why brand updates don't apply. | Direct cause of failure class "theme changes not propagating". | Import/paste must normalise masters behind a user-visible choice (keep source design / use destination design / merge) and report what was created. | Paste 5 slides from a foreign deck; assert exactly one documented master outcome and an audit line naming any new layout/master. | SEARCH-SNIPPET-ONLY |
| 27 | LibreOffice Bugzilla, Bug 163576 "Impress misses UI to restart numbering" — https://bugs.libreoffice.org/show_bug.cgi?id=163576 (2024-10) and Bug 114405 "Impress forgets settings of slide number dialog for handouts" — https://lists.freedesktop.org/archives/libreoffice-bugs/2017-December/065488.html (2017-12) | Numbering restart has no UI; handout slide-number dialog settings not remembered/reproduced via Print to PDF. | Numbering state is scattered across dialogs and lost between passes. | Numbering policy (start-at, skip-title, restart-per-section) is document state, editable in one place. | Set start-at 5, skip title, export handouts; assert all three hold across reopen and export. | SEARCH-SNIPPET-ONLY (Bugzilla itself is bot-gated; see inaccessible list) |
| 28 | Collabora Gerrit, "impress: fixed slide numbers after collapsing a section" change 11052 — https://gerrit.collaboraoffice.com/c/online/+/11052 (submitted Sep) | Visible slide numbers came from a CSS counter; slides hidden by a collapsed section were not counted, so **every slide after the section showed a smaller number**; fix writes the number as text plus alt text/tooltip. | Concrete, recent, fixed renumbering bug with an accessibility side-effect (number as alt text). | Compute numbers from an ordered, filtered model and expose them as real text, not counters; cover sections/skips in tests. | Collapse/expand a section and reorder; assert numbers equal position-within-visible-order for every slide, and each number is readable text. | SEARCH-SNIPPET-ONLY |
| 29 | Mozilla Bugzilla 1691887, "The google slides fullscreen is not correctly launched by keyboard" — https://bugzilla.mozilla.org/show_bug.cgi?id=1691887 (2021, closed as duplicate) + mozilla/pdf.js issue 15424 — https://github.com/mozilla/pdf.js/issues/15424 (2022-09-12) | `requestFullscreen()` rejected: "not called from inside a short running user-generated event handler" (transient activation). Keyboard-triggered presentation start fails; clicking Present works. pdf.js had the same class of failure entering presentation mode via keyboard. | Web presenter mode breaks on keyboard-only entry unless activation is handled. | Fullscreen entry must be reachable from a real user gesture, with a non-fullscreen fallback path if the promise rejects. | Trigger "Present" via keyboard shortcut with no prior pointer gesture; assert either fullscreen succeeds or a fallback presenter UI opens — never a silent no-op. | SEARCH-SNIPPET-ONLY |
| 30 | Chrome explainer, "Explainer for HTML Fullscreen Without A Gesture" — https://github.com/explainers-googlers/html-fullscreen-without-a-gesture (drafted 2023–) and MDN `requestFullscreen()` — https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen (updated 2026-09-11) | Transient activation required; `Permissions-Policy: fullscreen` can block it; second-screen popups may be **blocked**, requiring a separate gesture per window; documented pattern: query `navigator.permissions.query({name:'fullscreen'})` and prompt per gesture. | Dual-window presenter+audience on the web is a popup/fullscreen permission minefield. | Design presenter mode for the degraded case first (same-window presenter, or user-approved popup with a retry button), and detect permission state up front. | Open audience window programmatically; assert a visible "popup blocked → allow" recovery, and presenter keeps working with a single window. | SEARCH-SNIPPET-ONLY |
| 31 | Microsoft Q&A performance threads: memory leak — https://learn.microsoft.com/en-us/answers/questions/1168128/ (2023-02), 120-slide slow deck — https://learn.microsoft.com/en-us/answers/questions/5081115/ , 90 MB bloat persists after deleting slides — https://learn.microsoft.com/en-us/answers/questions/5603762/ , 100-slide freeze — https://learn.microsoft.com/en-us/answers/questions/5096429/ (2024) | Reports of progressive slowdown requiring app restart; copying animated objects drove RAM 400 MB → 2.1 GB; a deck grew 3 MB → 90 MB after adding PNG slides and stayed slow **after deleting them** ("cached or preview images from deleted slides… structural bloat"); a 100-slide/20 MB deck intermittently became unclickable. | Large-deck performance degrades through *leak and bloat*, and deletion does not reclaim it. | Reclaim on delete (drop cached previews/bitmaps for removed slides) and budget memory per slide; treat 100-slide decks as a supported tier, not an edge case. | Build a 150-slide image-heavy deck, delete half, force GC/memory sampling; assert resident memory returns within a fixed band and frame times stay bounded. | SEARCH-SNIPPET-ONLY |
| 32 | Reddit r/GoogleSlides, "Google Slide maxes out a 100MB" — https://www.reddit.com/r/GoogleSlides/comments/1mkdge8/ (2025-09-29) + "Google Slides lag?" — https://www.reddit.com/r/GoogleSlides/comments/1jozutr/ (2025-04-01) | Hard ~100 MB ceiling makes crisp image decks impossible ("That is a pain point… unless you're willing to reduce resolution"); separate thread reports 10-second latency per text edit. | Cloud tools impose size ceilings and latency that a local-first app can win on — if it stays fast. | Local-first is only a differentiator with a documented large-deck performance budget (open, scroll, edit at 100+ slides). | Automated perf run: 100-slide deck, measure open time, slide-switch p95, and edit latency; record thresholds in the perf harness. | SEARCH-SNIPPET-ONLY |
| 33 | Reddit r/powerpoint export-fidelity cluster: "Exporting as a PDF removes half my content" — https://www.reddit.com/r/powerpoint/comments/1c4jz96/ (2024-04-15); "Font Change issues when printing or exporting to PDF" — https://www.reddit.com/r/powerpoint/comments/143n8y4/ (2023); "PowerPoint not exporting typeface" (Mac) — https://www.reddit.com/r/powerpoint/comments/1k0hff3/ (2025-04-16); "Embedded fonts… disappear when exporting to PDF" — https://www.reddit.com/r/powerpoint/comments/s0uwlp/ (2022) | Shapes/text missing from PDF output; brand fonts fall back (to Calibri/Serif) despite embedding; Mac export of embedded fonts reported broken while PC works; users resort to rasterising slides. **Multiple export paths (Save As / Print / Export / Adobe plug-in) give different results.** | Font and content loss at export is the top-ranked PowerPoint complaint found. | One export pipeline, one documented fidelity matrix, explicit font-embedding/substitution report; never route users through 4 different dialogs with 4 different results. | Export with an unembedded, a variable, and an embedded font; assert a substitution report naming each fallback, plus a pixel-compare against the editor render. | SEARCH-SNIPPET-ONLY (Reddit HTTP 403 on fetch) |
| 34 | Reddit r/powerpoint master/theme cluster: "Issues with Master Template Changes" — https://www.reddit.com/r/powerpoint/comments/t6oq888/ (2022-09-29); "Preventing master pages from old decks…" — https://www.reddit.com/r/powerpoint/comments/1bnpinj/ (2024-03-25); "Insert slide is not following format" — https://www.reddit.com/r/powerpoint/comments/1cywjd8/ (2024-05-23) | Master edits (bullets, spacing, font size) **not accepted by existing slides**; reapplying layout "and back" did nothing; the fix that worked was rebuilding in a fresh file; off-brand masters accumulate from colleagues' pastes — "our presentations have turned into a mess of mismatched templates" (no lock-down available). | Theme propagation and master hygiene are the most repeated complaints in r/powerpoint. | Provide master/layout locking, an "unused/foreign layouts" audit, and a propagation preview before commits. | Paste foreign slides into a branded deck; assert no silent master creation, plus a one-click "remove unused layouts" that changes no rendered pixels. | SEARCH-SNIPPET-ONLY |
| 35 | PptxGenJS docs, "HTML to PowerPoint" — https://gitbrent.github.io/PptxGenJS/docs/html-to-powerpoint.html (current) | `tableToSlides()` reproduces HTML tables with auto-paging; explicitly unsupported: word-level formatting, nested tables, custom CSS beyond cell level; Master Slides must pre-define margins/logos. | Evidence that JS PPTX generation is a **drawing API**, not a layout engine → editable output only for what you model. | Varve must map its own node model to native shapes; it cannot expect CSS to translate itself. | Generate a deck from the Varve node model; assert every text run is a real text frame (not an image) for the supported feature set. | SEARCH-SNIPPET-ONLY |
| 36 | WebToSlides, "dom-to-pptx and PptxGenJS" — https://www.webtoslides.com/blog/dom-to-pptx-and-pptxgenjs-explained (2026-04-30) + Deckary, "HTML to PowerPoint: Best Conversion Paths Compared" — https://deckary.com/blog/html-to-powerpoint (2026-06-11) | DOM→PPTX libraries measure final rendered boxes and emit shapes; font/image **CORS** silently degrades to Arial; gradient/shadow must be rebuilt shape-by-shape (PptxGenJS has no gradient fills per skill guidance); Slidev PPTX export ships **images** (not editable), Marp `--pptx-editable` is experimental and needs LibreOffice. "A tool can produce a `.pptx` file and still fail the real workflow because round-two edits are slow." | Independent confirmation that editable-vs-flattened is *the* axis, and that most "PPTX export" features are raster. | Publish an editability matrix per node type (native shape / text / image / unsupported→raster), and test round-trip editability, not just openability. | Reopen Varve's PPTX in a checker: count raster-only slides and unsupported elements; fail the gate if a declared-editable element lands as an image. | SEARCH-SNIPPET-ONLY |
| 37 | Figma Forum, "Figma Slide Styles are not manageable" — https://forum.figma.com/report-a-problem-6/figma-slide-styles-are-not-manageable-42037 (2025-06-20) and "Color variables seem to not sync with Figma Slides" — https://forum.figma.com/ask-the-community-7/color-variables-seem-to-not-sync-with-figma-slides-42367 (2025-07-01) | Type/colour styles apply inconsistently across slides; duplicate same-named styles accumulate; Slides **copies** a library variable into a local entity that "will never update if I publish library updates" — "completely useless… dozens of inconsistencies". | Style duplication/inconsistency is what users get when propagation is approximate. | Single source of truth for tokens with hard references; duplicate-name styles are a compile error, not a warning. | Link a shared token set, publish an update, reopen deck; assert zero local duplicates and zero stale resolved values. | SEARCH-SNIPPET-ONLY |
| 38 | ask.libreoffice.org, "Images on Notes pages do not appear when exported as PDF" — https://ask.libreoffice.org/t/images-on-notes-pages-do-not-appear-when-exported-as-pdf/48546 (2020-01-23) + "Impress: How to avoid speaker-notes when exporting to PDF" — https://ask.libreoffice.org/t/impress-how-to-avoid-speaker-notes-when-exporting-to-pdf/20827 | Notes-page images missing from PDF; users need a way to *avoid* notes in PDF export. | Both directions of the notes/export problem exist in FOSS today. | Notes inclusion must be an explicit three-way choice (audience / notes pages / none) per export. | Export all three modes; assert images present on notes pages and absent from audience output. | SEARCH-SNIPPET-ONLY (site served a bot challenge) |
| 39 | libreoffice-users, "LibreOffice Impress and Speaker's Notes With pptx Files" — https://listarchives.libreoffice.org/global/users/2023/msg00261.html (2023, cites Bug 155365) | Opening PPTX in Impress **mangles speaker notes**: paragraph breaks and bullets vanish during the show; user hand-edits 12–15 units adding spaces per newline. | Notes fidelity degrades on every cross-tool hop. | Notes must round-trip as structured content (paragraphs, lists), not flattened text. | Round-trip a bulleted multi-paragraph notes set through PPTX; assert paragraph and list structure preserved in the editor and in presenter view. | SEARCH-SNIPPET-ONLY (Bugzilla/forums bot-gated) |
| 40 | Perkins, "ChromeVox: Google Slides Video Tutorial" — https://www.perkins.org/resource/chromevox-google-slides-video-tutorial/ (2022-03-24) + LibreOffice SlideSorterViewShell docs — https://docs.libreoffice.org/sd/html/classsd_1_1slidesorter_1_1SlideSorterViewShell.html | Screen-reader curricula teach moving slides *within* the filmstrip as a distinct skill; Impress exposes `ExecMovePageUp/Down` UNO commands and accessible document views for the sorter. | Keyboard/screen-reader slide movement is taught content, and FOSS exposes it as commands. | Expose move-slide as a named command (palette + shortcut + context menu), not a gesture side-effect. | Execute "Move slide down" via command palette and via screen reader; assert order changes and an announcement/undo appears. | SEARCH-SNIPPET-ONLY |

---

## 2. Vendor guarantees (what the manuals promise)

- **Reapply resets formatting, not content.** Keynote states reapplying a layout
  "won't delete your content" and lists exactly what *does* reset (placeholder
  style/position, background, default visibility) —
  https://support.apple.com/en-kg/guide/keynote/tan584189747/mac. This is the
  clearest specification of a safe "detach/reset" found.
- **Placeholders are the only portable content.** Keynote: objects added to a
  layout become background and are non-editable on slides unless defined as
  placeholders; placeholder **tags** carry content across layout switches —
  https://support.apple.com/en-kg/guide/keynote/tan7a2b69972/mac.
- **Master edits are forward-looking by default.** Microsoft documents that
  editing masters/layouts after slides exist requires reapplying layouts, and
  that master-defined objects cannot be edited in Normal view —
  https://support.microsoft.com/en-us/powerpoint/training/what-is-a-slide-master-in-powerpoint
  and https://support.microsoft.com/en-us/powerpoint/edit-and-re-apply-a-slide-layout.
- **PPTX export limits are published, and they are severe.** Figma documents
  font fallback to the default PowerPoint font, gradient fills collapsing to
  solid fills, interactions/code blocks becoming static images, no bulk export,
  and offers editable-vs-flatten structure —
  https://help.figma.com/hc/en-us/articles/24848334599447-Export-from-Figma-Slides.
- **Presenter display is a documented, per-screen configurable surface**, with
  mirroring called out as the reason the presenter display disappears —
  https://support.apple.com/en-gb/guide/keynote/tana4da2681/mac and
  https://support.microsoft.com/en-us/office/start-the-presentation-and-see-your-notes-in-presenter-view-4de90e28-487e-435c-9401-eb49a3801257
  (swap-recovery is the sanctioned fix).
- **Dragging needs a single-pointer alternative (AA), independent of keyboard
  support** — https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html
  (updated 2026-08-10), failure F108.
- **PresentationML is part-structured** (masters, layouts, slides, theme, notes,
  notes master, handout master; order via `sldIdLst` of ids + relationships) —
  https://learn.microsoft.com/en-us/office/open-xml/presentation/structure-of-a-presentationml-document
  (ms.date 2024-11-26).

## 3. Firsthand reports (what users say)

Ranked by how often the same complaint recurred across independent sources:

1. **Layout change is impossible or destructive.** Figma staff: layouts cannot
   be changed after creation; a user rebuilt 25 imported slides by hand
   (#10). PowerPoint users get orphaned `1_Title` layouts instead (#14) and
   report master changes "NONE of them have accepted" (#34).
2. **Theme/brand changes do not propagate** — Figma published template updates
   only reach new decks (#12); Slides copy library variables into never-updating
   local entities (#37); LibreOffice paste silently forks masters (#26).
3. **Export fidelity** — missing backgrounds/masks/rounded rects in PPTX (#11),
   gradient→solid (#6), fonts substituted or dropped on PDF export across
   Save/Print/Export paths (#33), half the content vanishing from a poster PDF
   (search snippet, #33), notes-page images missing (#38).
4. **Notes leaking or disappearing** — print layout persisted in the file lets a
   collaborator's "notes" setting reach a distributed PDF (#22); Jan 2026
   Google Slides outage hid the notes pane entirely (#21); Impress mangles
   PPTX notes bullets (#39); Google has no notes-only export (#23).
5. **Presenter/dual-display failures** — notes on the audience screen in
   Keynote (#17) and PowerPoint (#16), plus a genuine Microsoft regression in
   Oct 2025 requiring a Click-to-Run rollback (#15); keyboard-started fullscreen
   denied by transient-activation rules (#29) and second-window popups blocked
   (#30).
6. **Numbering/reference breakage** — internal slide links don't renumber (#25),
   section collapse shifted every subsequent number (#28), `<#>` placeholders
   and missing numbers on graphics-only slides (search snippets, #27).
7. **Accessibility** — Slides PDF loses alt text (#18), Slides still has no
   tagged PDF (#19), no reading-order control (#20).
8. **Performance at scale** — leak-like slowdown requiring restarts, 3 MB → 90 MB
   bloat that deletion does not reclaim, 100-slide freezes (#31), Google Slides'
   100 MB ceiling and 10-second edit latency (#32).

## 4. Inference (not directly sourced; reasoning from the above)

- **Brownfield beats greenfield.** Every incumbent's sharpest complaints concern
  *existing* decks: pasted slides, re-templating, re-layout, renumbering. A new
  slide tool that is pleasant only on blank documents will hit the same wall Figma
  hit (#10, #12, #14, #26, #34).
- **Two models, one preview.** The safest UX is: content lives in tagged/role-bound
  nodes; layouts and themes resolve *around* them; every propagation is previewed
  as a diff and undoable. This satisfies Keynote's guarantee (#4) while avoiding
  PowerPoint's silent orphan-layout behaviour (#14).
- **Degrade loudly, never quietly.** Given Figma's own limits list (#6) and the
  mask/background loss (#11), any unsupported construct at export should either
  fall back to a rasterised region or be listed in an export report — never
  dropped.
- **Editable-vs-flatten is a product decision, not a checkbox.** Library evidence
  (#35, #36) shows most PPTX "export" is raster with a shape layer where cheap;
  the honest matrix is per node type.
- **Local-first wins on #31/#32 only with a budget.** Memory/latency complaints are
  the incumbent's weakest flank, but reclaim-on-delete and a 100-slide perf gate
  are prerequisites.
- **Presenter mode should assume broken OS topology.** Two ecosystems independently
  fail on mirroring/duplicate mode (#15, #16, #17); detection + manual swap is the
  mitigation, not auto-detection alone.

## 5. Unresolved / inaccessible sources

| Source | Status | Handling |
|---|---|---|
| https://support.google.com/docs/thread/260155900 (alt text lost in PDF) | Fetch returned a client-side JS shell, no thread body | Treated SEARCH-SNIPPET-ONLY (#18); title/date from search index |
| https://discussions.apple.com/* (all threads) | Fetch blocked by bot-verification interstitial | Content used only from search snippets (#17, #19-class findings) |
| https://www.reddit.com/* | HTTP 403 on both www and old.reddit (including `.json`) | Reddit rows are SEARCH-SNIPPET-ONLY (#21, #32, #33, #34, #26) |
| https://bugs.documentfoundation.org/show_bug.cgi?id=155365 and https://bugs.libreoffice.org/... | Anubis proof-of-work challenge | Bug existence taken from mailing-list/Reddit citations (#27, #39) |
| https://ask.libreoffice.org/t/... | Anubis challenge on some threads | Snippets only (#38) |
| Google Slides official docs on notes/handout export | Not fetched directly; behaviour described by Google community threads + third-party guides | Behaviour marked as corroborated, not vendor-guaranteed (#22, #23) |
| Whether Figma has since shipped layout reassignment | Thread shows status as of 2026-07-07 still feature-request | Re-check before citing as current limitation |
| WCAG 2.5.7 conformance status of incumbent slide tools | Not researched | Open question for an accessibility review |

## 6. Top 10 brownfield failure classes with realistic mitigations for a local-first design app

1. **Re-layout of an existing slide losing or orphaning content.**
   Mitigation: role/tag-bound placeholders (Keynote model), content-first mapping
   with a per-slide report of unmatched objects, and layout reassignment as a
   day-one command. *Test:* switch layout on a populated slide; zero content loss,
   one undo.
2. **Theme/brand change not propagating (or over-propagating).**
   Mitigation: tokens referenced by id, deck-level "template updated" banner with
   accept/review, and local overrides explicitly marked and preserved.
   *Test:* change a brand colour; pending-update flow appears; overrides survive.
3. **Recolour touching deleted/unrelated artwork.**
   Mitigation: recolour runs against a validated live palette; dangling references
   block the operation; audit lists every element that will change.
   *Test:* delete a token, run recolour under a seeded fuzzer; zero dangling refs.
4. **Export fidelity loss (gradients, masks, backgrounds, effects).**
   Mitigation: published per-node editability matrix; whole-region raster fallback
   for unsupported constructs; export manifest of substitutions (Figma's model).
   *Test:* export a feature-coverage fixture; manifest matches exactly; no slide
   loses opaque background coverage.
5. **Font substitution at export.**
   Mitigation: embedding check before export, explicit substitution report, one
   export pipeline (not four dialogs with four behaviours).
   *Test:* unembedded/variable/embedded fonts each produce a named report line and
   a pixel-compare within tolerance.
6. **Speaker notes leaking into handouts or onto the audience screen.**
   Mitigation: export intent chosen per export (audience / notes pages / none) with
   preview; presenter surface derived from an explicit display assignment, with a
   mirroring/duplicate-mode warning and one-key swap.
   *Test:* audience PDF has zero notes text; mirrored config never renders notes on
   the audience target.
7. **Slide numbering / internal links breaking after reorder, duplicate, section.**
   Mitigation: stable ids everywhere; numbers, links, and totals derived at render;
   sections and skipped slides included in the ordering model.
   *Test:* insert/duplicate/reorder/collapse operations assert correct numbers and
   link targets on every slide.
8. **Accessibility: reading order, alt text, tagged vs raster export.**
   Mitigation: explicit reading-order model separate from z-order, pre-export
   checker (alt text, contrast, titles), tagged PDF output or a loud "untagged"
   warning.
   *Test:* PDF tag tree non-empty with correct order, or export fails the gate.
9. **Drag-only reordering (and other drag-only operations).**
   Mitigation: WCAG 2.5.7 compliance — single-pointer alternatives (tap-to-place,
   move up/down menu commands) *plus* keyboard commands exposed to the palette and
   screen readers. *Test:* reorder with keyboard only and pointer-tap only, no drag
   events; automated a11y scan clean.
10. **Performance/memory with 50–100+ slide decks (including after deletion).**
    Mitigation: reclaim caches/previews for deleted slides (PowerPoint's 90 MB
    non-reclaim is the anti-pattern), virtualised slide filmstrip, per-slide budget,
    measured gates at 100/500 slides. *Test:* 150-slide deck, delete half, assert
    memory returns to a band and slide-switch/edit p95 stays under threshold.

---

### Scope note

This file is research output only; no product code or other repository file was
modified. Sources were read on 2026-09-29; dates shown are the pages' own
publication/version markers where available.
