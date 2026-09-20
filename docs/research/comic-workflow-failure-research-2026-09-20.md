# Comic workflow failure research (2026-09-20)

Workflow-level evidence for the Varve comic/manga/webtoon decision (document
`workflowProfile`, page surfaces, panel tool, story outline, publisher slice
presets, streamed tiled export). This document deliberately does NOT repeat
the lettering findings, which live in
[comic-lettering-research-2026-09-19.md](comic-lettering-research-2026-09-19.md);
it covers mode/workspace design, page management, panels, long-canvas handling,
performance, print production, export, and discoverability.

## 1. Scope and method

- Searched 2026-09-20 for workflow-level complaints (not lettering) in Clip
  Studio Paint, Krita, Procreate, Illustrator, and webtoon publishing
  communities.
- Sources: official product documentation and help centers (CSP manual, Tapas
  help, WEBTOON CANVAS Zendesk), official issue trackers (KDE Bugzilla, Adobe
  community), vendor/community forums (Krita Artists, ask.clip-studio.com,
  tapas forums), and Reddit (r/ClipStudio, r/krita, r/WebtoonCanvas,
  r/webtoons, r/ProCreate).
- Reddit and community posts are anecdotal user reports, not verified bug
  reports. Where a complaint could not be corroborated beyond a single thread
  it is labelled as such. Where no credible evidence was found for a suspected
  failure, that is stated explicitly.
- Version numbers are as stated by the reporter; vendor docs are treated as
  current unless a date is shown.
- Quantities from platform documentation (800x1280, 2 MB, 940px, 10 MB) were
  verified against the linked official pages on 2026-09-20. KDE Bugzilla
  returned HTTP 403 to direct fetch; the bug's existence, status, and text were
  verified through the KDE bugs mailing-list mirror and search results.

## 2. Failure table

### A. Long-canvas webtoon: performance, limits, memory

| # | Observed failure | Evidence | Tool / version | Varve response |
|---|---|---|---|---|
| A1 | Hard canvas-length ceilings force stripping into many files: "the limit for smartphones and tablets is 20,000px, and for PC it is 50,000px. Try splitting it into appropriate parts" | [CLIP STUDIO ASK: cant make the webtoon canvas more than 20000 pixel](https://ask.clip-studio.com/en-us/detail?id=119692) | CSP (all platforms; tablet 20k px, desktop 50k px) | Document model is doc-scale agnostic; webtoon content is bounded FrameNodes with page/story structure, and export is streamed tiled slices, so no single 20k+ raster must exist. Already the architecture's direction; no dedicated workspace needed. |
| A2 | Long canvases lag or hit the memory-warning dialog; the workaround is splitting episodes into 40+ separate files: "each episode folder will have at least 40 csp files" and "one long document to avoid lag" is the stated reason | [r/WebtoonCanvas: Managing files in Clip Studio](https://www.reddit.com/r/WebtoonCanvas/comments/1rxfhnt/managing_files_in_clip_studio/) | CSP (2026 user report) | Content stays in one document; tiles are a view/export concern, not a document-splitting requirement. Page surfaces + story outline replace the 40-file folder. |
| A3 | Memory-pressure warnings and brush lag at 1080x20k with 12 layers on 4 GB tablets; users advised to buy 8 GB devices | [r/ClipStudio: Webtoon creation](https://www.reddit.com/r/ClipStudio/comments/1rc6rbu/webtoon_creation/) | CSP on Android/iPad (4 GB) | Bounded tiles and worker-based rendering keep resident memory sub-linear in strip length (per the existing render-pipeline architecture). Do not claim parity benchmarking until measured. |
| A4 | Desktop lag on huge canvases regardless of RAM/GPU: "CSP doesn't handle huge canvases ... the program doesn't use all CPU cores or the GPU at all" | [r/ClipStudio: So THIS keeps happening](https://www.reddit.com/r/ClipStudio/comments/1qyjwju/so_this_keeps_happening/) | CSP 4.x, multi-meter canvas | Varve's render worker + IR replay targets exactly this class; still a benchmark-gated claim, not a promised number. |
| A5 | Long segments and layer counts consume so much memory users accept multiple shorter files for the episode | [r/WebtoonCanvas: Very long canvas need help](https://www.reddit.com/r/WebtoonCanvas/comments/tai1y3/very_long_canvas_need_help/) | CSP EX, 800x50,000 working file | Same response as A2. |
| A6 | Memory ceilings on mobile platforms cap both canvas size and layer count and trigger "too much memory usage" prompts | [r/ClipStudio: Webtoon creation](https://www.reddit.com/r/ClipStudio/comments/1rc6rbu/webtoon_creation/) | CSP tablet | The web target cannot yet promise long-strip editing; caller decides. Not addressed today for browser memory ceilings; treat as a platform limitation to measure. |

### B. Page management and page navigation

| # | Observed failure | Evidence | Tool / version | Varve response |
|---|---|---|---|---|
| B1 | Page manager loses pages on reopen: "Krita closed on me when I opened it back up the project disappeared ... none of the pages show up along the side" | [r/krita: Cant restore pages along the side on comics manager](https://www.reddit.com/r/krita/comments/1ly72he/cant_restore_pages_along_the_side_on_comics/) | Krita Comic Manager (2025 report) | Story outline + page surfaces are part of the document; no side-car project JSON that can desynchronise from pages. |
| B2 | Page deletions leave orphaned files; renames do not follow logical order: "removing a page from the project list doesn't delete the actual .kra file ... These files can be very large" | [Krita Artists: Krita Comics Project Manager feature suggestions](https://krita-artists.org/t/krita-comics-project-manager-feature-suggestions/144501) | Krita CPM tool (2025-2026 thread) | One document, one page list; page identity is document state, not a filesystem convention. |
| B3 | Long series cannot export a page range; users re-export 100-300 page books repeatedly: "My story is 100+ pages and it take me too mutch time to export all of them eatch time i add a new one" | [Krita Artists: Comics manager export feature](https://krita-artists.org/t/comics-manager-export-feature/69035) | Krita CPM (2023 thread, still open) | Bounded/streamed tiled export with explicit page ranges and job resumption is the planned surface; verify range selection exists in the export UI. |
| B4 | Batch page export is slow per page; a contributor measured "each page takes 3-4 seconds", fixed later to 1 second for 56 pages via a quick path | [Krita Artists: Krita Comics Project Manager feature suggestions (page 2)](https://krita-artists.org/t/krita-comics-project-manager-feature-suggestions/144501?page=2) | Krita CPM (2026) | Streamed export must never reopen/flatten full documents per page; export from the same in-memory scene graph. |
| B5 | Import/add-page flows behave inconsistently and copy vs move is unclear; multi-file import failed on some platforms | [Krita Artists: comics manager should allow you to import multiple files at once](https://krita-artists.org/t/the-comics-manager-should-allow-you-to-import-multiple-files-at-once/184872) | Krita CPM, Bazzite/Windows (2026) | Page creation/import is one document operation with undo; no hidden filesystem side effects. |
| B6 | Procreate has no page manager at all; multi-page comics require one project per page or Page Assist, and panels require manual straight lines | [r/ProCreate: How do you make comics with multiple pages](https://www.reddit.com/r/ProCreate/comments/1qn9rwv/how_do_you_make_comics_with_multiple_pages_on_this/), [r/ProCreate: comic panel boxes with no ruler tool](https://www.reddit.com/r/ProCreate/comments/1emnu3f/need_help_figuring_out_how_to_do_comic_panel/) | Procreate (2024-2026 reports) | Evidence FOR the Varve choice: page surfaces + panel tool as document features, without a comic-only mode. |
| B7 | CSP page management ties multiple pages to a .cmc management folder and warns that touching files outside the app corrupts the project | [CSP help: Management Files and Page Files](https://help.clip-studio.com/en-us/manual_en/570_pages/Management_Files_and_Page_Files.htm) | CSP EX (current docs) | Page structure lives in the document; no externally-fragile folder contract. |
| B8 | Insertions into a fixed-height webtoon strip cascade: adding one panel pushes content across every subsequent file | [r/ClipStudio: I need help with editing my webtoon](https://www.reddit.com/r/ClipStudio/comments/1dqcnax/hello_i_need_help_with_editing_my_webtoon/) | CSP, 4-file chapter (2024) | Panel tool divide/join plus story-outline panel order is explicitly designed for re-shuffling; panels are nodes, so reflow is scene editing, not file surgery. |

### C. Panel creation and division

| # | Observed failure | Evidence | Tool / version | Varve response |
|---|---|---|---|---|
| C1 | "Divide frame border" leaves stray thin panels that read as gutters; the recommended fix is deleting and redoing the panels | [r/ClipStudio: Divide frame border is not working properly](https://www.reddit.com/r/ClipStudio/comments/1l2ihvm/divide_frame_border_is_not_working_properly/) | CSP 4.0, PC (2025) | Divide/join must be a deterministic, reversible node operation; no residue state that only an expert can diagnose. |
| C2 | "Keep gutters aligned" silently fails after a further division; the user works around it via a menu path they found by accident | [r/ClipStudio: Problem with keep gutters aligned](https://www.reddit.com/r/ClipStudio/comments/1q9rc9i/problem_with_keep_gutters_aligned/) | CSP (2026) | Gutter is an explicit property of the divide operation and stays consistent after re-division; no hidden per-panel tool state. |
| C3 | Gutter size is read from preferences or the active tool but cannot be set per operation, so equal spacing is lost when a user adjusts one border | [r/ClipStudio: how to make borders bigger for consistency](https://www.reddit.com/r/ClipStudio/comments/1tvvx7s/how_to_make_the_borders_marked_in_red_bigger_for/) | CSP (2026) | Numeric divide parameters plus join presets; document-level rail/gutter settings. |
| C4 | The divide tool exists but users bounce through several official answers to find it; several threads exist for the same "split exactly in half" task | [r/ClipStudio: Making panels that are divided exactly in half](https://www.reddit.com/r/ClipStudio/comments/phf434/making_panels_that_are_divided_exactly_in_half/), [r/ClipStudio: Splitting Rectangle into equal parts](https://www.reddit.com/r/ClipStudio/comments/cpth3b/splitting_rectangle_into_equal_parts/) | CSP (2019-2021) | Panel tool must expose divide/join in the panel context menu, not only a hidden tool group; command palette entry required. |

### D. Export and publishing friction

| # | Observed failure | Evidence | Tool / version | Varve response |
|---|---|---|---|---|
| D1 | WEBTOON CANVAS accepts max 800x1280px images, 2 MB per image, 20 MB and 100 images per episode; anything larger is automatically sliced and "the image quality may be dropped" | [WEBTOON CANVAS: File Size Overview](https://webtooncanvas.zendesk.com/hc/en-us/articles/32913712749588-File-Size-Overview-What-to-Know-before-Publishing-your-Comic-on-WEBTOON-CANVAS) | WEBTOON platform (official) | Publisher slice presets (WEBTOON 800x1280/2 MB) pre-slice deterministically so the platform never recompresses silently. Already a stated feature; add a pre-export slice/byte preview. |
| D2 | Users fight per-slice quality: after slicing and downsizing, "the mount of compression" ruins linework; advice is a manual resolution-change dance before re-export | [r/WebtoonCanvas: I have a problem with file exporting](https://www.reddit.com/r/WebtoonCanvas/comments/1mn7jxw/i_have_a_problem_with_file_exporting/) | CSP EX, 2400x10,000 @350dpi (2025) | Export profile should derive the working-to-publish scale explicitly and preview the result; never force JPEG-only to meet bytes without saying so. |
| D3 | Mobile readers see "crunchy" art after upload even when following platform limits; users try CSP export, Croppy, and JPEG variants without a documented cause | [r/WebtoonCanvas: My Webtoon Art is Too Crunchy](https://www.reddit.com/r/WebtoonCanvas/comments/1o9ix14/my_webtoon_art_is_too_crunchy/) | CSP + WEBTOON (2025) | Slice export reports byte budget per tile and warns when platform re-optimisation is likely; do not teach JPEG as the default answer. |
| D4 | Tapas requires 940px width and under 10 MB per file; creators must cut long files themselves on the platform they use | [Tapas help: File Size Overview](https://help.tapas.io/hc/en-us/articles/360052100813-File-Size-Overview), [Tapas forum: Tapas page size](https://forums.tapas.io/t/tapas-page-size/76256) | Tapas (official + forum, 2023-2026) | Tapas preset (940px/10 MB) in the same publisher slice planner; verify current limits at export time rather than hard-coding silently. |
| D5 | Long-strip exporters are third-party tools because apps lack native slicing; projects like krita-webtoon-export exist specifically to fill the gap | [exitflynn/krita-webtoon-export](https://github.com/exitflynn/krita-webtoon-export) | Krita plugin (2025) | Native streamed tiled export differentiates Varve; keep slice boundaries deterministic and panel-aware where possible. |
| D6 | `mupl` splits images over 10,000px and MangaDex expects per-page files; CBZ-style consumers assume a page sequence, not a strip | [ArdaxHz/mupl README](https://github.com/ArdaxHz/mupl) | MangaDex uploader (current) | CBZ/ZIP export from page surfaces; strip-to-page-split is an explicit export profile, not implicit. |

### E. Print comic production (bleed, spreads, PDF-X, CBZ)

| # | Observed failure | Evidence | Tool / version | Varve response |
|---|---|---|---|---|
| E1 | Krita has no bleed/margin/crop-mark feature; comic artists set guides by hand and the Comics Manager crop is pixel-only | [Krita Artists: Margin and bleed feature request](https://krita-artists.org/t/margin-and-bleed/106967), [r/krita: How to format print bleed](https://www.reddit.com/r/krita/comments/1clgj0b/how_to_format_print_bleed/) | Krita 5.x (2024) | Print workspace already models pages/bleed/spreads/preflight; comic page presets should include trim/bleed/safe guides on those surfaces. |
| E2 | CSP's crop-mark/bleed export settings confuse beginners; users do not know which output range to pick and publishers reject near-miss files | [CLIP STUDIO ASK: Comic Settings Help](https://ask.clip-studio.com/en-us/detail?id=129598), [CLIP STUDIO ASK: visible trim border when exporting](https://ask.clip-studio.com/en-us/detail?id=123312) | CSP EX (2025-2026) | Preflight in Print workspace names the trim/bleed decision instead of presenting "output range" enums. Verify guide automation covers crop marks at export. |
| E3 | CSP exports crop marks but not a PDF; official community advice is to assemble pages in InDesign | [CSP TIPS: Tips and Tricks for Printing Manga and Doujinshi](https://tips.clip-studio.com/en-us/articles/2126) | CSP EX (community guide) | Varve's Print crate exports PDF/PDF-X directly; comic print profile is a preset over that. |
| E4 | Krita's CBZ export crashed for 1.5+ years on "Crop to Outmost Guides" due to a float/int TypeError, fixed only in nightly | [Krita Artists: 5.2 Comics Manager crashes on .CBZ export](https://krita-artists.org/t/krita-5-2-comics-manager-crashes-on-cbz-export-with-crop-to-outmost-guides-selected/79689) | Krita 5.2.2 Linux (2023) | Export paths need typed, tested contracts; CBZ/PDF export belongs in the affected-test closure. |
| E5 | Batch export leaks documents: "Krita does not free up the memory used by each page ... Krita will run out of memory and likely crash" at 30+ high-res pages | [KDE Bug 412740](https://bugs.kde.org/show_bug.cgi?id=412740) (direct fetch 403; verified via [KDE bugs mailing list mirror](https://www.mail-archive.com/kde-bugs-dist@kde.org/msg390764.html)) | Krita 4.2.6+, still reopened | Streamed export must release per-page resources; cap resident memory in the export job and test long jobs. |
| E6 | Webtoon-to-print conversion is a known unsolved pipeline gap: a full strip is hundreds of thousands of pixels tall and creators keep print and scroll masters in separate tools | [Krita Artists: What is the best workflow for infinite scroll formats](https://krita-artists.org/t/what-is-the-best-workflow-for-the-infinite-scroll-formats-tapas-webtoons-0xmanga-etc/52305), [Krita Artists: Vertical comic reader preview](https://krita-artists.org/t/vertical-comic-reader-preview/90583) | Krita (2022-2024) | Varve's workflowProfile is advisory, not a fork: one document with layout variants (print pages vs scrolled strip) is the intended answer. Honest gap: no re-flow automation between the two is planned; state that. |
| E7 | Publisher trim/bleed confusion repeats across threads: "publishers reject files that miss by even a few millimeters" | [CLIP STUDIO ASK: Comic Settings Help](https://ask.clip-studio.com/en-us/detail?id=129598) | CSP EX (2026) | Comic page presets carry publisher trim+bleed; preflight must validate them before export. |

### F. Workspaces, modes, and cross-app workflow

| # | Observed failure | Evidence | Tool / version | Varve response |
|---|---|---|---|---|
| F1 | CSP Simple Mode is treated by its own tutorial as "separate apps but related": tools are unavailable, settings do not carry, and switching requires closing all canvases | [CSP TIPS: Draw Webtoon with Simple Mode](https://tips.clip-studio.com/en-us/articles/8450), [CSP support: Simple Mode shortcut limits](https://support.clip-studio.com/en-us/faq/articles/20240011) | CSP tablet Simple vs Studio Mode | Strongest evidence FOR Varve's "no comic workspace": mode forks demonstrably break shared state. Keep workspace switches as config patches over one EditorState. |
| F2 | Unsupported-layer gates: opening comic work in Simple Mode shows "Incompatible layer" for vector, text, balloon, frame-border layers | [CSP support: layers not supported in Simple Mode](https://support.clip-studio.com/en-us/faq/articles/20230037) | CSP tablet | Never gate document content behind a mode: every workspace must open every document. Already an invariant; add a regression test for it. |
| F3 | Opening the Story Editor erases each page's editing history and disables Undo; the official manual states it as a warning | [CSP help: Use Story Editor](https://help.clip-studio.com/en-us/manual_en/570_pages/Use_Story_Editor.htm) | CSP EX (current docs) | Story outline is a view over document text; entering it must not touch undo history. Non-negotiable. |
| F4 | Hybrid creators split a single job across apps (Procreate sketching, CSP production) because no single tool covers both well, paying repeated file handoffs | [GoBookMart: CSP vs Procreate for Webtoon creators](https://gobookmart.com/clip-studio-paint-vs-procreate-which-is-the-best-software-for-webtoon-creators/) (vendor-adjacent analysis, treat directionally), [r/AskArtists: CSP vs Procreate](https://www.reddit.com/r/AskArtists/comments/1qzgiz3/clip_studio_paint_vs_procreate/) | Procreate + CSP (2026) | Varve's single document across Draw/Design/Print is a differentiator; no import/export handoff needed between illustration and comic surfaces. |
| F5 | Switching CSP workspaces silently rewrites shortcut settings, command bar, and unit preferences unless the user unchecks import options | [CSP manual: Workspace](http://www.clip-studio.com/site/gd_en/csp/userguide/csp_userguide/500_menu/500_menu_window_workspace.htm) | CSP current | Workspace switch must only change presentation config; never key bindings or tool defaults. Matches Varve invariant 9 (no decorative config; bindings not workspace config). |
| F6 | Illustrator workspace persistence bugs span versions: panels reopen collapsed or missing, custom workspaces fail to restore | [Adobe community: workspace panels are folded every time the program is opened](https://community.adobe.com/questions-652/workspace-panels-are-folded-every-time-program-is-opened-821481), [Illustrator Uservoice: workspace panels auto-collapse](https://illustrator.uservoice.com/forums/601447-illustrator-desktop-bugs/suggestions/31721482-workspace-panels-auto-collapse-on-start-even-when) | Illustrator 2015-2024 | Persisted workspace presentation must round-trip through save/quit; add an E2E reload test for per-workspace panel state. |
| F7 | Tool- and app-switching is reported as a cognitive tax; designers describe needing 20+ minutes to regain flow | [r/UXDesign: tool-switching is low-key frying their brain](https://www.reddit.com/r/UXDesign/comments/1mpvdpy/does_anyone_else_feel_like_toolswitching_is/) | General (2025) | Supports keeping comic tooling reachable from the current workspace (context bar, palette, command palette) rather than a mode the user must remember to enter. |

### G. Discoverability of comic features

| # | Observed failure | Evidence | Tool / version | Varve response |
|---|---|---|---|---|
| G1 | A Krita user following tutorials cannot find the Comics Manager docker at all; answers split between "it's a standard feature" and "it's an optional plugin" | [r/krita: Comics manager missing](https://www.reddit.com/r/krita/comments/14e38ed/comics_manager_missing/) | Krita 5.0.8 Fedora (2023) | Comic affordances must surface contextually: choosing a comic preset or `workflowProfile` should offer panel/balloon/outline actions in-place, not depend on a separately installed surface. |
| G2 | New users don't know a multi-page script surface exists; ask.clip-studio answer has to explain the Story Editor's menu path to an EX owner | [CLIP STUDIO ASK: Does CSP EX have script writing tool pages section](https://ask.clip-studio.com/en-us/detail?id=85694) | CSP EX | Story outline discoverable from the new-document comic profile and the command palette; no separate "advanced" mode required to find it. |
| G3 | Krita's comic page workflow is maintained as an optional Python plugin, which is why features land slowly and exports run through a plugin API | [Krita Artists: Comics Project Manager feature suggestions](https://krita-artists.org/t/krita-comics-project-manager-feature-suggestions/144501) | Krita (2025-2026) | Comic-critical paths (panels, slice export, story outline) must be core features, not plugins. Already the architecture's stance; keep it. |
| G4 | No credible evidence found that users specifically want a dedicated comic workspace/mode. The complaints found are about features being missing, hidden, or broken — not about needing a mode boundary. | see F1-F2, G1-G2; no supporting source found for the positive claim | n/a | State honestly: absence of evidence is not proof, but it argues against adding a comic mode. Do not fabricate demand. |

### H. Mobile preview and platform constraints

| # | Observed failure | Evidence | Tool / version | Varve response |
|---|---|---|---|---|
| H1 | Krita has no vertical reader preview; artists can only emulate it with a second detached view, and the Overview docker updates with "a pretty long delay" | [Krita Artists: Vertical comic reader preview](https://krita-artists.org/t/vertical-comic-reader-preview/90583) | Krita 5.2 (2024) | A reader-proportioned preview overlay is a real, repeatedly requested surface. Not addressed yet in Varve; candidate for the webtoon profile (below). |
| H2 | CSP has a webtoon on-screen area frame and a smartphone preview because pacing depends on what a phone screen shows | [CSP help: Webtoons](https://help.clip-studio.com/en-us/manual_en/540_comic/Webtoons.htm), [CSP TIPS: Create your own WEBTOON](https://tips.clip-studio.com/en-us/articles/7425) | CSP EX | A scroll-viewport preview is standard practice; Varve's canvas has camera state that can host it without a mode. Not addressed today. |
| H3 | Tapas publishing is desktop-only and the app advises that mobile uploads "can lower the quality of images" | [Tapas help: How do I publish on Tapas](https://help.tapas.io/hc/en-us/articles/115005476687-How-do-I-publish-on-Tapas) | Tapas (official) | Publish prep must be desktop-grade and explicit; no mobile-quality downgrades, no hidden upload steps. |

## 3. What we should NOT copy

1. **A separate mobile/simple mode that locks features out of the document.**
   CSP's Simple Mode cannot open vector, text, balloon, or frame-border content
   and does not carry tool settings
   ([CSP support](https://support.clip-studio.com/en-us/faq/articles/20230037),
   [CSP TIPS](https://tips.clip-studio.com/en-us/articles/8450)). Varve keeps
   one EditorState and one document model; workspace changes patch config only.
2. **Page managers that fragment a project across dozens of files.**
   A 40-file episode is an accepted workaround, not a design
   ([r/WebtoonCanvas](https://www.reddit.com/r/WebtoonCanvas/comments/1rxfhnt/managing_files_in_clip_studio/)),
   and orphaned files after page deletion are a direct consequence
   ([Krita Artists](https://krita-artists.org/t/krita-comics-project-manager-feature-suggestions/144501)).
3. **Entering an editing surface as a destructive operation.** CSP's Story
   Editor wipes per-page undo history when opened
   ([CSP help](https://help.clip-studio.com/en-us/manual_en/570_pages/Use_Story_Editor.htm)).
   Outline/lettering surfaces must be non-destructive views.
4. **Gutter and panel state that lives in tool preferences.** CSP threads show
   equal-spacing loss and inconsistent re-division
   ([C1](https://www.reddit.com/r/ClipStudio/comments/1l2ihvm/divide_frame_border_is_not_working_properly/),
   [C2](https://www.reddit.com/r/ClipStudio/comments/1q9rc9i/problem_with_keep_gutters_aligned/)).
   Gutter belongs to the panel operation and its parent rail.
5. **Unclear print output-range enums.** The "entire page / up to inside of
   crop marks / up to crop mark bleed" vocabulary is documented, but users
   still cannot answer "which one do I send"
   ([ask.clip-studio](https://ask.clip-studio.com/en-us/detail?id=129598)).
   Preflight should decide and explain, not enumerate.
6. **Forcing JPEG quality down to hit byte caps silently.** Platform byte caps
   are real, but the correct response is a visible byte budget and lossless
   options, not a hidden recompression step
   ([D2](https://www.reddit.com/r/WebtoonCanvas/comments/1mn7jxw/i_have_a_problem_with_file_exporting/),
   [D3](https://www.reddit.com/r/WebtoonCanvas/comments/1o9ix14/my_webtoon_art_is_too_crunchy/)).
7. **Auto-slicing the uploader owns.** WEBTOON's server slices and may drop
   quality automatically
   ([official](https://webtooncanvas.zendesk.com/hc/en-us/articles/32913712749588-File-Size-Overview-What-to-Know-before-Publishing-your-Comic-on-WEBTOON-CANVAS)).
   Do not rely on the platform's recompressor as the export pipeline.

## 4. Realistically resolvable in Varve

Mapped to existing surfaces (not new systems):

| Item | Varve surface | Status |
|---|---|---|
| 20k px / long-strip canvas ceilings (A1-A5) | Bounded FrameNodes + streamed tiled export; document never needs one giant raster | In design; benchmark gate required before claiming frame-time wins |
| 40-file episode fragmentation (A2, B8) | Page surfaces + story outline over one document | In design |
| Page deletion/rename orphans (B1-B3, B5) | Document-owned page list; one undo model | In design; verify import/export range UX |
| Slow batch export (B4, E5) | Streamed export job with explicit page ranges and resource release | Implement; add long-job memory test |
| Panel divide/join bugs and hidden gutter state (C1-C4) | Existing FrameNode panel tool with divide/join; make gutter an operation property; context-menu + command-palette entry | Implement/fix; keep radius caveat in mind (known editor frame-path defect) |
| Deterministic webtoon slicing to platform caps (D1-D5) | Publisher slice planner (WEBTOON 800x1280/2 MB; Tapas 940px/10 MB) + bounded tiled export with byte preview | Implement; limits must be configurable and date-stamped |
| CBZ/MangaDex page expectation (D6) | Page-surface export profiles (CBZ) | Implement in export profiles |
| Print trim/bleed/spread/PDF-X for comic pages (E1-E4, E7) | Print workspace: pages, bleed, spreads, preflight, PDF-X; comic page presets add trim/safe guides | Mostly exists; comic presets + preflight messages needed |
| Webtoon-to-print re-layout (E6) | Layout variants/presets over one document | Partially: guides/presets yes; automated panel re-flow is out of scope for now, say so in docs |
| Mode/workspace state breakage (F1-F3, F5-F7) | Workspace config patch + invariants 1-9; story outline as non-destructive view | Enforce with regression tests; nothing new to build |
| Comic feature discoverability (G1-G3) | `workflowProfile` preset shows panel/balloon/outline actions inline; toolbar/context bar already share the tool registry | Implement as onboarding/preset affordances, not a mode |
| Mobile reader preview (H1-H2) | Not addressed / deferred | New candidate: reader-proportioned scroll preview using existing camera state |
| Platform upload automation (posting episodes) | Not addressed / deliberately out of scope | Local-first, no account credentials; hand off files only |

## 5. Sources

Primary official sources:

- [WEBTOON CANVAS: File Size Overview](https://webtooncanvas.zendesk.com/hc/en-us/articles/32913712749588-File-Size-Overview-What-to-Know-before-Publishing-your-Comic-on-WEBTOON-CANVAS)
- [Tapas help: File Size Overview](https://help.tapas.io/hc/en-us/articles/360052100813-File-Size-Overview)
- [Tapas help: How do I publish on Tapas](https://help.tapas.io/hc/en-us/articles/115005476687-How-do-I-publish-on-Tapas)
- [CSP help: Use Story Editor](https://help.clip-studio.com/en-us/manual_en/570_pages/Use_Story_Editor.htm)
- [CSP help: Management Files and Page Files](https://help.clip-studio.com/en-us/manual_en/570_pages/Management_Files_and_Page_Files.htm)
- [CSP help: Webtoons](https://help.clip-studio.com/en-us/manual_en/540_comic/Webtoons.htm)
- [CSP manual: Workspace](http://www.clip-studio.com/site/gd_en/csp/userguide/csp_userguide/500_menu/500_menu_window_workspace.htm)
- [CSP support: layers not supported in Simple Mode](https://support.clip-studio.com/en-us/faq/articles/20230037)
- [CSP support: Simple Mode shortcut commands](https://support.clip-studio.com/en-us/faq/articles/20240011)

Issue trackers and community forums:

- [KDE Bug 412740: Krita leaks memory on exporting multiple pages from the comics manager](https://bugs.kde.org/show_bug.cgi?id=412740) (mirror: [kde-bugs-dist](https://www.mail-archive.com/kde-bugs-dist@kde.org/msg390764.html))
- [Krita Artists: Comics manager export feature](https://krita-artists.org/t/comics-manager-export-feature/69035)
- [Krita Artists: Krita Comics Project Manager feature suggestions](https://krita-artists.org/t/krita-comics-project-manager-feature-suggestions/144501) ([page 2](https://krita-artists.org/t/krita-comics-project-manager-feature-suggestions/144501?page=2))
- [Krita Artists: the comics manager should allow multiple file import](https://krita-artists.org/t/the-comics-manager-should-allow-you-to-import-multiple-files-at-once/184872)
- [Krita Artists: 5.2 Comics Manager crashes on .CBZ export](https://krita-artists.org/t/krita-5-2-comics-manager-crashes-on-cbz-export-with-crop-to-outmost-guides-selected/79689)
- [Krita Artists: Margin and bleed feature request](https://krita-artists.org/t/margin-and-bleed/106967)
- [Krita Artists: Vertical comic reader preview](https://krita-artists.org/t/vertical-comic-reader-preview/90583)
- [Krita Artists: best workflow for infinite scroll formats](https://krita-artists.org/t/what-is-the-best-workflow-for-the-infinite-scroll-formats-tapas-webtoons-0xmanga-etc/52305)
- [ask.clip-studio: canvas length limit on tablet](https://ask.clip-studio.com/en-us/detail?id=119692)
- [ask.clip-studio: visible trim border when exporting](https://ask.clip-studio.com/en-us/detail?id=123312)
- [ask.clip-studio: Comic Settings Help](https://ask.clip-studio.com/en-us/detail?id=129598)
- [ask.clip-studio: Does CSP EX have a script writing tool pages section](https://ask.clip-studio.com/en-us/detail?id=85694)
- [Adobe community: custom workspace hiding panels](https://community.adobe.com/questions-652/custom-workspace-hiding-panels-821721)
- [Adobe community: workspace panels folded every time](https://community.adobe.com/questions-652/workspace-panels-are-folded-every-time-program-is-opened-821481)
- [Illustrator Uservoice: workspace panels auto-collapse](https://illustrator.uservoice.com/forums/601447-illustrator-desktop-bugs/suggestions/31721482-workspace-panels-auto-collapse-on-start-even-when)

Reddit (anecdotal):

- [r/WebtoonCanvas: Managing files in Clip Studio](https://www.reddit.com/r/WebtoonCanvas/comments/1rxfhnt/managing_files_in_clip_studio/)
- [r/WebtoonCanvas: Very long canvas need help](https://www.reddit.com/r/WebtoonCanvas/comments/tai1y3/very_long_canvas_need_help/)
- [r/WebtoonCanvas: I have a problem with file exporting](https://www.reddit.com/r/WebtoonCanvas/comments/1mn7jxw/i_have_a_problem_with_file_exporting/)
- [r/WebtoonCanvas: My Webtoon Art is Too Crunchy](https://www.reddit.com/r/WebtoonCanvas/comments/1o9ix14/my_webtoon_art_is_too_crunchy/)
- [r/ClipStudio: Divide frame border is not working properly](https://www.reddit.com/r/ClipStudio/comments/1l2ihvm/divide_frame_border_is_not_working_properly/)
- [r/ClipStudio: Problem with keep gutters aligned](https://www.reddit.com/r/ClipStudio/comments/1q9rc9i/problem_with_keep_gutters_aligned/)
- [r/ClipStudio: how to make borders marked in red bigger](https://www.reddit.com/r/ClipStudio/comments/1tvvx7s/how_to_make_the_borders_marked_in_red_bigger_for/)
- [r/ClipStudio: making panels divided exactly in half](https://www.reddit.com/r/ClipStudio/comments/phf434/making_panels_that_are_divided_exactly_in_half/)
- [r/ClipStudio: Splitting Rectangle into equal parts](https://www.reddit.com/r/ClipStudio/comments/cpth3b/splitting_rectangle_into_equal_parts/)
- [r/ClipStudio: editing a webtoon, inserting a panel](https://www.reddit.com/r/ClipStudio/comments/1dqcnax/hello_i_need_help_with_editing_my_webtoon/)
- [r/ClipStudio: Webtoon creation](https://www.reddit.com/r/ClipStudio/comments/1rc6rbu/webtoon_creation/)
- [r/ClipStudio: So THIS keeps happening (canvas lag)](https://www.reddit.com/r/ClipStudio/comments/1qyjwju/so_this_keeps_happening/)
- [r/krita: Cant restore pages along the side on comics manager](https://www.reddit.com/r/krita/comments/1ly72he/cant_restore_pages_along_the_side_on_comics/)
- [r/krita: Comics manager missing](https://www.reddit.com/r/krita/comments/14e38ed/comics_manager_missing/)
- [r/krita: How to format print bleed](https://www.reddit.com/r/krita/comments/1clgj0b/how_to_format_print_bleed/)
- [r/ProCreate: How do you make comics with multiple pages](https://www.reddit.com/r/ProCreate/comments/1qn9rwv/how_do_you_make_comics_with_multiple_pages_on_this/)
- [r/ProCreate: comic panel boxes with no ruler tool](https://www.reddit.com/r/ProCreate/comments/1emnu3f/need_help_figuring_out_how_to_do_comic_panel/)
- [r/UXDesign: tool-switching cognitive tax](https://www.reddit.com/r/UXDesign/comments/1mpvdpy/does_anyone_else_feel_like_toolswitching_is/)

Tooling references:

- [exitflynn/krita-webtoon-export](https://github.com/exitflynn/krita-webtoon-export)
- [ArdaxHz/mupl](https://github.com/ArdaxHz/mupl)
- [GoBookMart: CSP vs Procreate for Webtoon creators](https://gobookmart.com/clip-studio-paint-vs-procreate-which-is-the-best-software-for-webtoon-creators/) (vendor-adjacent, directional only)
