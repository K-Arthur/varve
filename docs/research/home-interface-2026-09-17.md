# Home interface — research ledger and decision record (2026-09-17)

Scope: the Home/Start surface (`@varve/home`) only. Research executed
2026-09-17 against current headings; sources fetched that day unless noted.

## Sources reviewed

| # | Source / date | Kind | Observed | Confidence & limits | Applies to Varve home as |
|---|---|---|---|---|---|
| 1 | W3C, *Understanding SC 2.5.8 Target Size (Minimum)*, WCAG 2.2 Understanding doc, rev. 2026-05-11 | Standard (normative SC + informative guidance) | Targets must be ≥24×24 CSS px, or meet the spacing exception. Figure 9 (small target clipping a large target) **fails** when the small target is <24px even inside a larger target. Note explicitly endorses increasing the active target area *without* increasing the visible size. | High; direct normative applicability (AA) | The favourite star sat ~17px inside a large clickable card (gridcell) — its 24px circle intersects the card target, so it failed 2.5.8 outright. Fixed by a 24×24 button box with the 12px glyph unchanged. |
| 2 | Figma blog, *Figma on Figma: Our approach to designing UI3* (2024-10-01) | First-party product post-mortem | Floating side panels were reversed after launch: they "cramped the canvas… slowed people down"; docked panels restored. Icon-hidden blend modes reverted to an inline dropdown because users had to wait for a tooltip to know the current value; the new label system keeps full visible labels (and matches `aria-label`s). | High for Figma's own decisions; not a general law. | Supports keeping home chrome flush/docked/token-driven (no floating reskin), keeping visible text labels on primary actions, and visible group labels in the search palette. |
| 3 | GNOME Wiki archive, *Design/OS/SelectionPattern*; GNOME HIG *Keyboard navigation* | Platform conventions (first-party) | Selection mode exits on **Escape**; Ctrl+A selects all; Ctrl+Shift+A deselects all. HIG lists Esc as "exit a menu, popup, switcher, or dialog window". | High for GNOME; macOS Finder semantics are less explicitly documented. | Escape hierarchy: close overlay first, otherwise clear selection. Implemented with an explicit guard so it never fires while a dialog/menu/rename is open. |
| 4 | UX Patterns for Developers, *Command Palette pattern*; saasui.design, *Search & Command Palette UX* (2026-06-15); 137Foundry, *How to Design a Command Palette Users Will Reach For* (2026-08-11); DesignSystems.one reference; `cmdr` commit d340629 | Practitioner pattern references | Empty-query palettes should lead with recents/common items (not a blank box); group and label results; keep the default set curated ("an empty state showing a dashboard… is not a command palette"); no-results must explain, not look broken. | Medium-high; multiple independent sources agree, no formal study. | Empty-query search palette now shows a single "Recent files" group (≤6, most recently opened first). Projects/templates stay query-gated — they currently only open files, so promoting them to the default view would create dead-end affordances. Recorded as a known defect instead. |

## Decisions

1. **Escape clears selection (with hierarchy).** Overlay open → overlay owns
   Escape; inline rename active → rename owns Escape; otherwise clear
   selection. GNOME convention (#3); matches the existing UI where `Escape`
   previously only closed dialogs and left multi-selection stranded.
2. **Recents-first empty palette, curated.** One group, capped at 6, honest
   label; no dashboard, no dead ends (#4).
3. **24×24 favourite target, visual star unchanged** (#1). This was a
   conformance fix, not polish.
4. **No floating chrome or reskin on home.** The surface already consumes
   the shared token contract; Figma's UI3 reversal (#2) argues against
   introducing floating panels where none existed. Home keeps flush
   toolbar/sidebar and visible labels.
5. **Text selection is not a card interaction.** Click/shift-click/drag on
   cards is selection of *items*; browser text-selection during those
   gestures was an input-reliability defect (observed live, see audit
   screenshot 06). `user-select: none` on card/row surfaces, re-enabled on
   the rename inputs.

## Rejected alternatives

- **Rewriting the home e2e lane's 5s perf budget.** The lane is stale and
  the budget is environment-sensitive (cold 8.8s / warm-reload 6.4s on the
  shared dev server, see audit). Policy forbids moving thresholds after
  testing; the failure is reported, not papered over.
- **Adding project/template actions to the palette empty state now.**
  Would surface dead-end options (palette `onOpenFile` resolves only file
  ids). Deferred and recorded.
- **`::after` hit-area expansion for the star.** A fixed 24px button box is
  simpler, avoids overlapping the adjacent timestamp target region, and
  keeps the visible layout stable.
