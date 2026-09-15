# Toolbar follow-up review — research and evidence ledger (2026-09-15, session B)

Read alongside `docs/audits/toolbar-review-2026-09-15.md` (first session's
diagnosis and fixes) and `docs/agents/toolbar-followup-2026-09-15-ownership.md`
(coordination). Sources checked 2026-09-15. Findings are grouped by the
decision they informed. Nothing below is a claim about Varve's own users:
no user study was run; the external evidence is other products' documented
failures, mapped to concrete Varve actions.

## 1. Applicability map (master-prompt specialist modules)

| Module | Applies? | Reason / boundary |
|---|---|---|
| 6A dense desktop UI | Yes, but already largely exercised | Varve is a dense design suite. The first session reviewed palette density/targets; this session covers the status bar, the two quick bars, and the menubar's own menu surface. Token ownership is unchanged. |
| 6B scrubbable numeric inputs | Out of scope this session | `NumberField` scrubbing exists and the Inspector Design-tab session (2026-09-15) already repaired its label-wrap/target behavior. Not re-opened. |
| 6C virtualized hierarchy | Out of scope this session | `LayersPanel` is virtualized and owned by the active LayersPanel session. The toolbar surfaces contain no hierarchies. |
| 6D menus, context menus, flyouts | Yes | The View menu is the largest command surface in the product and is taller than a 1280x800 viewport (first-session measurement: 1984px). Placement commands must route through the existing command/registry path. |

## 2. Floating toolbar placement (the dominant external failure)

| Source | Finding | Decision |
|---|---|---|
| Figma forum, "Allow us to dock/move the new UI3 toolbar" (thread from 2024-07, hundreds of replies, still active 2025-2026) — forum.figma.com/suggest-a-feature-11/allow-us-to-dock-move-the-new-ui3-toolbar-7861 | Users cannot move or dock the bottom-centre floating toolbar. Reported concrete failures: hidden behind the macOS Dock ("I need to precisely move the cursor just to pick the right tool, and not the mac icon"); hidden behind a laptop display on a multi-monitor desk; dialogs overlapping it on small laptop screens; "most applications allow us to move these tools and palettes"; requests specifically ask for a top option and for the choice to persist across web and desktop. | Ship a persisted top/bottom placement preference. Do not claim left/right/docking in this slice; top placement resolves the Dock/canvas-work overlap class without moving every bottom-anchored surface (page nav, selection info, status, drawers), which is a larger shell-grid change. |
| Same thread, multiple users (2025) | "It is standard for desktop apps to have the toolbar at the top of the page"; top-left reading/work direction; one user reports devtools CSS hacks to force top placement — i.e. the workaround is fragile and unsupported. | Provide a supported, discoverable command (View menu radio entries) plus persistence, instead of users resorting to injection. |
| Epps / "Click This!: A Study on Optimizing Toolbar Placement" (Proceedings of the Human Factors and Ergonomics Society, 2010) — journals.sagepub.com/doi/10.1177/154193121005401912 | Across four sides, toolbar response was slowest at the bottom; fastest at left/right; multiple toolbars and unpredictable placement degraded performance. | Bottom-only is the worst default *and* the least predictable when the platform puts its own chrome there. A user-selectable top position is the minimal fix; document that left/right are not offered yet and why. |
| Microsoft "Giving You Fitts" (archive, 2006) — learn.microsoft.com/en-us/archive/blogs/jensenh/giving-you-fitts | Edge-affixed controls ("mile-high menus", taskbar, QAT in the title bar) have effectively infinite target height. Controls far from the working point cost more movement time. | Reinforces the placement option; also confirms the palette should stay pinned to a canvas edge rather than float in the middle of the work area. |

**Realistic mapping for Varve:** default stays bottom (no forced migration),
add "Toolbar position: Bottom / Top" under View, persist per workspace mode
through the existing override store, and verify no-chrome-overlap in both
positions at 1440/1280/900/640 widths. This resolves the Dock/work-area
overlap class and gives users the choice Figma still does not offer.

## 3. Over-long menus (View menu taller than the viewport)

| Source | Finding | Decision |
|---|---|---|
| Microsoft Fluent UI issue #32311 (2024-08) — github.com/microsoft/fluentui/issues/32311 | A menu with many options opening upward out-grows the window; the top options are unreachable. The library's own fix (`autoSize`) was opt-in, so many apps shipped the broken default. | A menu longer than the viewport is a known, shipped-broken class. Do not rely on a scrollable oversized menu; restructure the command graph. |
| Wikimedia Phabricator T344776; GNOME appindicator bug #1717807; shadcn/ui issue #6343 (2025-01); KDE Discuss "Can't get to/see top of drop down menu" (2026-03) | Same failure reported across toolkits: long menus extend past the screen; bottom items (or top items when flipped) are unreachable; some implementations have no scroll at all. | Oversized menus fail even when scrolling "works": users must hunt. Guidance: keep the root menu within one screen by grouping. |
| Atlassian JRASERVER-33935 | Support tickets caused by users not finding options in over-long menus; recommended fix is categorizing options into submenus ("drill to that level"). | Directly supports restructuring View into submenus instead of only trimming a few entries. |
| UsableNet blog (2025-10-09), screen-reader menu scroll failure | A touch screen reader could not scroll a long menu; focus cursor got stuck and the user abandoned the task. | Grouping is also an accessibility fix: fewer root items means fewer rows that can be off-screen for AT users. |

**Realistic mapping for Varve:** View becomes a short root (Themes, Zoom,
Canvas mode, Viewport, Rulers & grids, Guides, Print, Panels, Workspace,
Toolbar position, Focus) with one level of submenus. Zoom and panel toggles
keep their direct routes (menubar zoom cluster, shortcuts, command palette).
The Workspace group stops duplicating eight mode switches at the root.

## 4. Status bar crowding, clipping, and control/overlap failures

| Source | Finding | Decision |
|---|---|---|
| Blender devtalk "Status bar does not fit the screen" (2019) + "Status bar design" (2020) | Status bar does not fit at 1920 with UI scale 1.6; hints push scene info out of sight; icon-heavy status bars read as buttons and crowd out information users actually need; users ask for compact layouts and a place for the information that matters (scene stats). | Treat the status bar as tiered instrumentation where *controls* must never be silently clipped; verify at narrow widths and with enlarged text. |
| Adobe Community, "Share button overlaps other elements when increasing UI font size" (2025-10) — community.adobe.com/questions-712/...1182858 | Photoshop's options bar overlaps controls when UI font size is increased; the reporter asks for a resizable/dynamically sized bar. Related thread documents collisions below a ~1200px window width. | Enlarged text and narrow widths are real-world conditions for chrome rows. Varve's status bar must either fit, drop tiers, or scroll — never silently clip an interactive control. |
| Krita Artists, "More compact dockers and interface layout" (2026-07) and "Display the current layer name on Status Bar" (2025-04) | Users with 4K screens still lack working room; status bar requested to be more compact; the missing piece users want in the status bar is the *current layer name* because "oops painted on the wrong layer" is a recurring failure. | Keep the status bar compact and informative; the selected-layer readout already exists in Varve (`selectionInfo`), which is the right kind of content. Do not add more chrome. |
| Internal (first session, remaining work #4) | `.editor-status` is a literal `28px` while the shell row uses `--statusbar-height: clamp(1.5rem, 1.45rem + 0.25vw, 1.75rem)` (24–28px). `overflow: hidden` on the shell means the bar can be clipped by the row at narrow widths. | Make the bar height read the same token as the grid row (or make both agree), and verify no control is clipped at 640–1440. |

## 5. Duplicate text-edit surfaces

| Source | Finding | Decision |
|---|---|---|
| First-session audit, remaining work #3 (internal) | While a text edit session is active, the context bar and the floating text bar render the same controls; both write through the same command so they cannot disagree, but the duplication is a clarity/density question. | Reproduce with a real text edit session; if confirmed, keep the canvas-anchored bar (near the work, Fitts-consistent) as the single control surface during editing and show an honest, non-duplicating state in the context bar. |
| Windows/macOS menu and toolbar conventions (general) | Two visible control sets for the same property without a stated distinction invite thrash; proximity wins when both exist. | Covered by the decision above. |

## 6. APG keyboard contract for the quick bars

| Source | Finding | Decision |
|---|---|---|
| WAI-ARIA APG, Toolbar Pattern — w3.org/WAI/ARIA/apg/patterns/toolbar/ | `role="toolbar"` groups controls and expects roving focus (one tab stop, arrow keys within), with composite widgets inside consuming their own keys. | `ContextControlBar` and `FloatingTextBar` declare `role="toolbar"` but enumerate every control as a tab stop. Extend the shared `@varve/ui` Toolbar (already used by the palette) to (a) accept a class name and (b) yield arrow keys to text-entry/select widgets, then wrap both bars. If that proves unsafe, demote to `role="group"` rather than shipping a toolbar role with no toolbar keyboard model. |
| WAI-ARIA APG, Developing a Keyboard Interface (focusability of disabled controls) | Disabled controls in composite widgets remain reachable where the pattern requires it, and never activate. | Already satisfied by the palette fix; the shared Toolbar is extended, not replaced. |
| WCAG 2.2 SC 2.5.8 / 2.5.5 — w3.org/WAI/WCAG22/Understanding/target-size-minimum.html, .../target-size-enhanced.html | 24x24 CSS px minimum; 44x44 enhanced default for custom touch targets. | Status-bar hit targets must be measured, not assumed: report any interactive control under 24x24 (and keep the 44px touch promotion where the bar still renders). |

## 7. Known limits of this evidence

- No screen-reader run (NVDA/VoiceOver/Orca) and no physical touch/pen pass
  in this session; those remain listed as unverified in the audit.
- The Figma thread is user-reported behavior from another product; it is used
  to justify offering a choice, not to claim Varve users share the sentiment.
- The Fitts/placement studies are 2006–2010 and used directionally; the
  product decision is a user-selectable preference, not a forced relocation.
- Playwright measurements are Chromium/Linux on this machine; WebKitGTK and
  Windows/macOS webviews are not exercised here.
