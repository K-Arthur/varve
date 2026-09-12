# Inspector panel optimization — 2026-09-12

Status: implementation checkpoint on `master`. Focused follow-up requested
after the general UI pass
([`ui-visual-optimization-2026-09-12.md`](ui-visual-optimization-2026-09-12.md)).

This pass is deliberately scoped to the inspector panel. It combines external
user research with WCAG 2.2 and the WAI-ARIA Authoring Practices, then measures
the running panel before and after each change.

## A. Research basis

### Inspector-panel user complaints

| Source | Complaint | Response |
|---|---|---|
| [Figma forum — Right Panel Resize](https://forum.figma.com/suggest-a-feature-11/right-panel-resize-design-prototype-inspect-31912) | Property/style names are truncated with ellipses; users cannot read nested token names and want the panel resizable | Varve's panel is already resizable; this pass verified **0 truncated labels** at the default rail and kept the existing ellipsis+tooltip pattern |
| Same thread | Values are hard to read; names "crowd" past a character length | Full names remain in the tooltip and the label column has a stable width; no regression introduced |
| [Figma forum — Layers/panels cut off in Dev Mode](https://forum.figma.com/report-a-problem-6/layers-panel-cuts-off-in-dev-mode-55894) | Property lists cut off horizontally | Narrow-rail check at 240px shows 0 horizontal overflow after the align-group wrap fix |
| [Blender properties-panel feedback](https://blender.stackexchange.com/questions/246119/keyboard-shortcuts-for-properties-panel) | Endless scrolling; sections hard to recognise and navigate | Every section header is now a real heading (`h3`), so sections are navigable by heading and recognizable structurally |
| [Retool — Simplifying Retool's Inspector](https://retool.com/blog/simplifying-retools-inspector) | Properties appearing in several groups destroy scannability | One authoritative edit location per property (preserved; not changed) |

### Standards

- [WCAG 2.2 SC 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html):
  pointer targets must be at least 24×24 CSS px, or spaced so that 24px circles
  do not intersect. Stacked inspector rows are not spaced, so the minimum size
  applies.
- [WAI-ARIA APG Accordion](https://www.w3.org/WAI/ARIA/apg/patterns/accordion):
  each accordion header button is wrapped in an element with `role="heading"`
  and an appropriate `aria-level`; visually persistent controls (section
  actions) are not placed inside the heading element.
- [WCAG 2.2 SC 2.4.11 Focus Not Obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)
  and 2.4.7 Focus Visible: the resized targets keep the existing focus rings.
- [WCAG 2.2 SC 1.3.1 Info and Relationships](https://www.w3.org/TR/WCAG22/):
  headings expose the inspector's section structure.

## B. Runtime audit (before)

Linux Chromium, 1440×900, one rectangle selected, all disclosures expanded:

- **26 interactive controls below 24×24 CSS px**:
  - 13× `.insp-disclosure__trigger` at 292×22 (every section header)
  - 1× `.insp-section-manager__trigger` at 24×19
  - 1× `.insp-contrast-dot` at 8×8
  - 2× `.insp-inline-btn` at 19×19 (fill actions, new effect type)
  - 1× `.insp-paint-library__add-btn` at 292×19
  - 1× `.section-collapse-btn` at 16×16
  - 1× `.layer-states__create-btn` at 18×18
  - 3× `.intelligence-action-btn` at 70×19 / 22×19
  - 1× `.intelligence-filter-chip` at 112×23
  - 2× `.intelligence-issue__target` at 279×19
- **0 of 12 section headers were headings** (all `heading: NONE`).
- **0 truncated labels** at the default 318px rail (the earlier `displayLabel`
  pass holds).
- Panel scroll: 1028px of content in a 678px viewport at the default expansion.

## C. Implemented changes

| Area | Change | File |
|---|---|---|
| Target size | All inspector section triggers `min-height: 24px` | `components/Inspector/inspector.css` |
| Target size | Section manager gear `min 24×24` | `components/Inspector/inspector.css` |
| Target size | `.insp-inline-btn` `min 24×24` (glyph unchanged) | `components/Inspector/inspector.css` |
| Target size | Paint-library add button `min-height: 24px` | `components/Inspector/inspector.css` |
| Target size | Intelligence action buttons, filter chip, issue targets `min-height: 24px` | `components/Inspector/inspector.css` |
| Target size | Contrast dot: 24×24 transparent hit area, 8px visual dot via `::before`, focus ring added | `editor.css` |
| Target size | Section collapse button `24×24` | `components/section-collapse.css` |
| Target size | Layer-states create button `24×24` | `components/LayersPanel/layerStatesSection.css` |
| Target size | Shared disclosure trigger `min-height: 24px` (also benefits the website FAQ) | `packages/ui/src/components/disclosure.css` |
| Semantics | Inspector section trigger wrapped in `<h3 class="insp-disclosure__heading">`, action stays outside the heading | `components/Inspector/controls/DisclosureSection.tsx` (registry + legacy modes) |
| Layout | Align command cluster wraps internally at the 240px rail instead of overflowing the panel | `components/Inspector/inspector.css` |

The heading wrapper is `margin: 0` and flex-sized, so there is no visual
change to the section rows.

## D. Verification

Runtime re-measurement after the changes (same state, all sections expanded):

- Undersized targets: **26 → 2 → 0** (the last two were 22px-wide icon-only
  intelligence actions; `min-width: 24px` removed them).
- Section headings: **0 → 12 × H3**.
- Truncated labels: 0 (unchanged).
- Narrow rail (240px): panel horizontal overflow **0**; every inspected
  control inside the panel bounds; the align cluster wraps to a coherent
  two-row block.
- Unit tests: `packages/editor/src/components/Inspector` + shared
  `Disclosure`/`Accordion` — **627 passed**; focused re-run after the align
  wrap fix — **58 passed**.
- Screenshots reviewed: inspector dark, inspector light, and a
  240px-wide rail capture (`/tmp/insp-dark.png`, `/tmp/insp-light.png`,
  `/tmp/insp-narrow-240.png` during the session).

## E. Residual design-debt register

| Item | Severity | Reason deferred | Next action |
|---|---|---|---|
| Scroll depth when every section is expanded | P2 | Needs product decision | Section F closes this with sticky headers |
| Long font/token names can still truncate in the label column | P3 | Not reproduced at default width | Section F adds the regression test |
| Resizable-rail discoverability | P3 | The splitter exists and is keyboard operable | Section F verifies the tooltip |
| Native/Tauri inspector rendering | P2 | No desktop GUI session under load | Section F records the bounded native evidence |

## F. Follow-up closure and second pass — 2026-09-12 (later)

### F1. Scroll depth — sticky section headers (closed)

Section headers now use `position: sticky; top: 0` inside the scrolling panel.
A runtime probe scrolled to 200px and 420px and confirmed that while a
section card spans the panel top, its header pins at the scrollport padding
edge (header top 177px vs panel top 171px, i.e. the 6px panel padding), then
is pushed away by the next section. This directly answers the Blender-style
"lose section context in a long property list" complaint without adding a
second navigation control to a panel that already has tabs and a section
manager.

### F2. Control-height contract (new finding, fixed)

Runtime measurement showed the inspector mixed **21 / 24 / 27 / 32 / 39 / 65px**
control heights: `.insp-num__input` used the fluid spacing token `--space-7`
(39px), `--space-6` fields were 27px, `RangeValueControl` overrode its number
field to 27px, selects were 32px, and `.insp-btn-sm` (which stands in for a
field) was 27px. Because two of those are fluid tokens, field heights also
drifted with the viewport. Every text/number field, dropdown, and
field-height button now renders at `--component-compact-height` (32px).
Re-measured: **zero** off-contract fields.

### F3. Aesthetic and token cleanup (new finding, fixed)

| Issue | Fix |
|---|---|
| Section containers used an undefined `--radius-xs` fallback (4px) while other surfaces used canonical tokens | Unified on `--radius-control` (8px), giving the container a larger radius than its 6px inputs |
| Hardcoded `rgba(0,0,0,0.03)` card shadows duplicated the borders ("borders within borders" noise) | Removed; borders alone separate |
| `.audit-badge--error:hover` / `.contextual-audit-chip--*` used light-only `oklch(0.95 …)` fills — wrong in dark and high-contrast themes | Replaced with `color-mix(in oklab, var(--color-feedback-*) …, var(--color-surface-raised))` |
| Hardcoded 10/11px type sizes and 0.05em tracking | Mapped to `--font-size-2xs` / `--font-size-xs` and `--tracking-wide` |
| Non-canonical `--space-1-5` / `--space-2-5` tokens (some declarations silently invalid with no fallback) | Mapped to `--space-2` / `--space-3` |
| 39 duplicate top-level selectors in `inspector.css` (25 byte-identical, 4 contiguous, 3 core field selectors, plus specialized widgets) | 25 identical blocks removed, 4 contiguous selectors merged, and `.insp-field`, `.insp-field__label`, `.insp-field__control` consolidated from 2-3 definitions each to one. Remaining specialized-widget duplicates are documented as maintainability debt |
| Raw radius values repo-wide failing `pnpm audit:radius` (including two legacy `--radius-sm` consumers) | All migrated to semantic tokens; `audit:radius` now exits 0 |

### F4. Truncation regression guard (closed)

`FontSelector.test.tsx` now renders a 60-character family name and asserts the
combobox still carries the full value and its accessible name — guarding the
data layer against truncation while the input scrolls visually.

### F5. Resizable-rail discoverability (closed)

`PanelResizeHandle` already wraps the splitter in
`Tooltip label="Drag to resize — double-click to reset"` with
`aria-label`, `aria-valuenow/min/max`, `aria-controls`, and keyboard
resize — no change needed.

### F6. Native inspector rendering (bounded)

`pnpm desktop:preflight` reports GUI available; `cargo check` passes and the
debug binary links and launches, rendering Varve's loading surface in the
WebKitGTK window. Capturing the native editor chrome itself was not possible
in this non-interactive session (no Wayland single-window capture or
window-activation tool, with the concurrent agent's terminal in front).
Native rendering remains a desktop-lane task.

This is an AI-assisted engineering pass using automated plus visual evidence.
It is not a WCAG conformance certification; native screen readers and physical
input devices remain untested.

