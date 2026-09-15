# Inspector panel audit and remediation — 2026-09-10

**Scope:** the right-hand Inspector (Design tab and its tab bar) in the shared
editor shell used by the browser build and the Tauri webview: what it shows
for each item kind, workspace, and active tool, how its rows and fields are
laid out, and the units its numeric fields use. The home dialogs are included
only where they share `@varve/ui` components the Inspector uses (the preset
picker).

**Method:** repository-first review, then runtime captures of the real app
(Playwright, Chromium, 1440×900 and 1440×2200, light and dark themes) before
and after each change. Every regenerated visual baseline was opened and
inspected before it was accepted; one generated baseline was rejected
because it showed a defect (collapsed preset tiles).

This is an internal design and implementation review, not an accessibility
certification or a usability study.

## 1. Research

Official documentation and user-reported problems for comparable inspectors
were reviewed to ground the direction. Public sources only; no product data
was sent to search.

| Pattern | Evidence | Applied as |
|---|---|---|
| The panel follows the active tool; frame/board presets live in the right panel while that tool is active | [Figma: create a frame using presets](https://help.figma.com/hc/en-us/articles/30974070391191-FD4B-Create-a-frame-using-frame-presets); [Penpot: boards](https://help.penpot.app/user-guide/designing/layers/) (with preset search) | Tool context map; Frame presets in the Inspector |
| A selected frame can snap to a preset | [Figma: frames](https://help.figma.com/hc/en-us/articles/360041539473-Frames-in-Figma-Design) | Resize to Preset row under Position & Size |
| Position and size must not be pushed down or jump | [Figma UI3 feedback](https://forum.figma.com/share-your-feedback-26/ui3-feedback-3058) | Selection Sources and the gear no longer precede object properties |
| Frequently used values should not hide behind "show more"; inert controls are equally costly | [Figma: Fill/Hug visibility](https://forum.figma.com/suggest-a-feature-11/ui3-show-layout-properties-width-height-fill-hug-35315) | Sections that cannot act stay out |
| Section titles toggle their section | [Penpot #5168](https://github.com/penpot/penpot/issues/5168) | Verified: the whole header is the toggle |
| The panel refreshes when switching between same-kind objects | [Penpot #1411](https://github.com/penpot/penpot/issues/1411) | Covered by frame → resize E2E |
| Numeric fields select on focus and scrub from their label/icon | [Penpot #2520](https://github.com/penpot/penpot/issues/2520); [Sketch Copenhagen tour](https://www.sketch.com/blog/a-tour-of-copenhagen/) | Inline-label fields scrub from the prefix |
| Mixed values read "Mixed" and edit all | [Penpot variants](https://help.penpot.app/user-guide/design-systems/variants/); [Figma multi-edit](https://forum.figma.com/product-updates-3/meet-multi-edit-35320) | Verified in multi-selection captures |
| Users cannot tell why controls appear | [Figma forum](https://forum.figma.com/suggest-a-feature-11/properties-panel-selection-actions-quite-confusing-41667) | Header row always names the inspected target |
| Long preset lists need pinning/favorites | [Figma request](https://forum.figma.com/suggest-a-feature-11/ability-to-pin-or-customize-default-frame-presets-50212) | Existing favorites/recents/custom kept; list made legible |
| Labels carry full context; crammed unlabeled controls are a complaint | [Figma UI3 rationale](https://www.figma.com/blog/our-approach-to-designing-ui3/); [Penpot #3833](https://github.com/penpot/penpot/issues/3833) | Short inline prefixes keep full accessible names |

Also consulted: [Sketch Inspector](https://www.sketch.com/docs/interface-and-settings/the-mac-app-interface/the-inspector/),
[Sketch Copenhagen changelog](https://www.sketch.com/changelog/copenhagen/),
[user reactions to Copenhagen](https://mjtsai.com/blog/2025/11/20/sketch-copenhagen/).

## 2. Findings

Severity: **P0** visibly broken or misleading, **P1** major inconsistency or
high-frequency friction, **P2** meaningful polish, **P3** optional.

| # | Finding | Evidence | Sev | Root cause | Status |
|---|---|---|---|---|---|
| 1 | With nothing selected, every non-navigation tool showed the same dead end: raw-id header ("rect options"), a "No selection" illustration, and "open the active tool controls" for tools that have none | Baseline captures, Frame and Rectangle tools | P1 | Tool scope applied to every tool; no tool content composed | Fixed `b2e1c3ddb` |
| 2 | Frame presets registered for the Frame tool but never mounted in the Inspector; the popover that did host them stayed closed | `sectionRegistry.ts`, `ToolOptionsPopover.tsx` | P1 | Registration without a mount site | Fixed `b2e1c3ddb` |
| 3 | "Resize to preset" and "Save current size as preset" had no call site | `FramePresetsSection mode="resize"` unused | P1 | Dead code path | Fixed `b2e1c3ddb` |
| 4 | Page Print could never render: its only mount was hidden while the Page tool was active | `DocumentPanel` vs tool scope | P1 | Scope precedence | Fixed `b2e1c3ddb` |
| 5 | Preset tiles collapsed to 4 px slivers; contents stacked vertically | Rejected baseline | P0 | Card recipe `overflow: hidden` zeroed flex min-height; default column direction | Fixed `e303b19e5` |
| 6 | Fill and stroke rows rendered as a vertical column of loose icons | Item captures | P0 | Multi-control rows reused the label/control grid | Fixed `3c3494e9c` |
| 7 | Hidden-label number fields clipped ("100" → "10") | Fill row capture | P0 | Hidden label left the control in the 38% label column | Fixed `3c3494e9c` |
| 8 | Float residue in resting values ("270.400000…") | Frame/image captures | P0 | `String(value)` display | Fixed `3c3494e9c` |
| 9 | Fill opacity 0–1 while layer opacity is 0–100 % | Rectangle capture | P1 | Unit chosen per field | Fixed `3c3494e9c` |
| 10 | Stroke position labelled "In / Ct / Out" | Code | P2 | Abbreviations | Fixed `3c3494e9c` |
| 11 | Selection Sources occupied the top slot in every context, with every command disabled for most selections | Captures | P1 | Unconditional mount | Fixed (this slice) |
| 12 | Section customizer gear on a row of its own | Captures | P2 | Separate header row | Fixed (this slice) |
| 13 | Empty state repeated the header three times (header, "No selection", "Inspecting …") | Captures | P2 | Illustration component | Fixed (this slice) |
| 14 | Text layers listed Typography after fills, strokes, filters, and effects | Text capture | P1 | Static order | Fixed (this slice) |
| 15 | Tab dividers only at group boundaries (missing between Design and Adjustments) | User report, captures | P2 | Group-start rule | Fixed (this slice) |
| 16 | Tabs that fit could collapse into More, and stay collapsed | Capture during fix | P1 | Overflow measured on stretched widths | Fixed (this slice) |
| 17 | Website described a toolbar strip on the left, an Inspector "below layers", and a Frame Presets section for selected frames | Website pages vs captures | P2 | Stale copy | Fixed `38ba865e4` |

Open findings are listed in §5.

## 3. Context behaviour

With nothing selected the Inspector follows the active tool
(`components/Inspector/toolContext.ts`): Frame shows presets; tools with
Tool Options show a button that opens them; every other tool shows the
page/canvas/document settings, with Page Print at the top for the Page tool.
Selection always wins over tool context.

## 4. Validation

Recorded per slice in commit messages; see §6 for the final run.

## 5. Open items

Tracked as slices land.

## 6. Final validation

Pending.
