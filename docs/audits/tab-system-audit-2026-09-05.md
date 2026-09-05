# Varve tab-system audit — 2026-09-05

This audit inventories tab-like controls in the current Varve tree and records
the semantic boundary used by the implementation. It is intentionally a
product audit as well as an accessibility audit: a control is only an ARIA
tab when it owns a corresponding tabpanel.

## Reference basis

The visual review used the publicly accessible variant summaries and previews
in [Shadcn Studio's Tabs documentation](https://shadcnstudio.com/docs/components/tabs)
and [Shadcn Space's Tabs collection](https://shadcnspace.com/components/tabs),
then checked the interaction contract against the
[WAI-ARIA Tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).
The references consistently favour short labels, a visible active indicator,
scrollable narrow strips, vertical navigation for dense settings, and motion
that does not change layout. No third-party source code is copied here.

## Inventory and decision matrix

| Surface | Context | Semantic type | State / lifecycle | Current or chosen presentation | Migration decision |
|---|---|---|---|---|---|
| [`@varve/ui` Tabs](../../packages/ui/src/components/Tabs.tsx) | Shared React primitive | Content tabs | Controlled; active panel is lazy by default | Underline, soft, pill, panel, compact; horizontal or vertical | Canonical primitive; add stable IDs, badges, disabled items, manual activation, and explicit panel rendering |
| [`TabStrip`](../../packages/editor/src/TabStrip.tsx) | Open documents | Document tabs | Editor sessions, dirty state, save/close confirmation, focus restoration | Document strip | Keep custom; a close control and save guard make a generic content-tab abstraction unsafe |
| [`WorkspaceTabs`](../../packages/editor/src/components/WorkspaceTabs.tsx) | Application mode dock | Workspace switcher | Editor workspace state plus responsive overflow and persistence | Dock/radiogroup with magnification | Keep radiogroup; it switches application mode and has no tabpanel |
| [`InspectorTabBar`](../../packages/editor/src/components/Inspector/InspectorTabBar.tsx) | Inspector shell | Content tabs | Effective workspace config, contextual tabs, responsive More menu | Compact panel tabs with overflow | Keep local adapter; panel ownership and metadata-driven overflow are Inspector concerns |
| `PropertiesPanel` export tabs | Inspector export workflow | Nested content tabs | Local format/code state; code panel is expensive | Compact underline | Keep local until export panel composition can be keyed by stable values |
| [`ResourcesPanel`](../../packages/editor/src/components/ResourcesPanel/ResourcesPanel.tsx) | Docked assets panel | Content tabs | Local selection; expensive panels remain mounted and hidden | Compact panel tabs with icons | Keep local to preserve panel state and avoid heavyweight remounts |
| `HistoryPanel` | Revision history | Content tabs | Async history session, search, branches, compare, merge | Underline | Keep local; async panel state is intentionally retained per view |
| `SettingsDialog` | Application settings | Content tabs | Lazy section rendering, persistent settings state | Vertical tabs | Keep local; its vertical layout and settings provider boundary are specialized |
| `ArchiveDialog` | Archive create/restore workflow | Content tabs | Form drafts and async archive/restore phases | Underline | Keep local; do not risk remounting an in-progress archive form |
| `CodePanel` primary views | Codegen and audit dock | Content tabs | Persistent panel-local view selection | Panel tabs | Migrate to shared Tabs with stable panel renderers |
| `CodePanel` framework selector | Codegen output | Content tabs | Active target drives generated output | Compact underline, scrollable | Migrate to shared Tabs; use `renderPanel` rather than positional children |
| `CodeGenView` language selector | Inspector code export | Content tabs | Generated output is target-specific and expensive | Compact underline, scrollable | Migrate to shared Tabs with value-keyed panel rendering |
| `ColorBalanceAdjustmentEditor` | Adjustment editor | Content tabs | Local tonal-range selection | Compact soft | Migrate to shared Tabs; the panels are small and synchronous |
| [`PageNav`](../../packages/editor/src/components/PageNav/PageNav.tsx) | Publishing pages | Document-like page tabs | Page IDs, reorder, add/delete, thumbnails, persistence | Page strip | Keep custom; drag/reorder and page commands are not content tabs |
| `BrushBrowser` category control | Brush filter | Filter control | Local filter, no panel relationship | Compact pill buttons | Use radiogroup semantics, not tablist/tab |
| `FontBrowser` source control | Font filter | Filter control | Local source filter, no panel relationship | Compact scrollable pill buttons | Use radiogroup semantics, not tablist/tab |
| `IntelligencePanel` primary views | Audit/intelligence | Content tabs plus overflow | Local view state and menu overflow | Underline + More menu | Implemented: More is a menu button outside the tablist; the active view is a real, labelled tabpanel with roving primary tabs |
| `NewFileDialog` source selector | New document workflow | Content tabs | Form fields and template selection | Soft | Keep local until form-preserving shared-panel composition is worthwhile |
| Website `DisciplineTabs` | Marketing feature discovery | Content tabs | Progressive enhancement; first panel in static HTML | Vertical / horizontal responsive soft tabs | Keep Astro implementation; preserve no-JS content and improve focus/hidden state |
| Website download platform selector | Marketing download choice | Content tabs | Static release data; first platform in HTML | Scrollable underline | Keep Astro implementation; add complete keyboard activation and hidden panels |
| Theme/view/format controls | Editor and website controls | Radiogroups or toggles | Choice state, no associated panels | Existing segmented/radio controls | Do not migrate to Tabs |

## Findings

1. The shared primitive had correct baseline ARIA wiring but treated `activeTab`
   as valid unconditionally. A stale controlled value could leave every tab
   untabbable and every panel hidden. The canonical fallback is the first
   enabled tab.
2. The shared primitive paired panels with `children[i]`. That is convenient
   for a static demo but couples panel identity to array position. New consumers
   use `renderPanel(tab)`; legacy children remain supported for compatibility.
3. Several filter bars used `tablist` and `tab` solely because they looked like
   tabs. They have no tabpanels, so they are filters and now use radiogroup
   semantics with a compact, value-based roving focus model.
4. Horizontal content tablists must only consume Left/Right. Up/Down remains
   available for page scrolling; vertical tablists consume Up/Down.
5. Document tabs, page tabs, and workspace modes intentionally remain custom.
   Their persistence, deletion/reordering, or application-state contracts are
   materially different from content tabs.

## Deferred work

The remaining local adapters are deliberately not converted in this slice:
Resources, History, Settings, Archive, Inspector, PageNav, and the document
strip all own state or lifecycle that is more expensive than a visual wrapper.
Their inventory, semantic choice, and validation obligations are recorded here
so future work can migrate them without reclassifying the controls as tabs.
