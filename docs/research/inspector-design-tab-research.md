# Inspector Design Tab — Independent Research Corpus (2026-09-19, pass 2)

> This document is the research record for the second, independent Inspector
> Design-tab pass (2026-09-19). It was produced from fresh web research and
> fresh in-repo measurement; it deliberately does not inherit findings or
> conclusions from earlier passes. Verified facts carry a source URL;
> inferences are marked **[inference]** and must be confirmed against the
> baseline matrix before they drive a change.
>
> Measured ground truth for this pass:
> `reports/inspector-redesign/baseline-matrix/` (9 selection states × 3 rails
> × 3 themes × 3 text scales; computed metrics + screenshots; captured
> 2026-09-19 05:11–05:25 under the heavy lease).

## A. What works — conventions from shipping inspectors

### A1. Figma (help.figma.com, "Adjust alignment, rotation, position, and dimensions", fetched 2026-09-19)

Verified facts:

- **Nudge**: two configurable amounts. "By default, small nudge is set to 1
  and big nudge set to 10." Arrow keys = small; Shift+arrows = big.
- **X/Y**: coordinates refer to the top-left corner of the layer's bounds;
  for rotated layers they stay pinned to the original top-left corner.
- **W/H**: aspect-ratio lock control in the panel; while locked, editing one
  updates the other. Ctrl temporarily *disables* the lock; Shift temporarily
  *enables* it while unlocked. (Modifier inversion is intentional: the
  modifier expresses the exception to the current state.)
- **Rotation**: field at the top of the Design panel; range ±180° with wrap
  ("going 15° past 180° will give you an angle of -165°"); Shift snaps to 15°
  increments while dragging on canvas.
- **Math expressions**: position, dimension, and rotation fields accept
  `+ - * / ^` and parentheses; the equation is *appended* to the existing
  value (otherwise typing replaces it). Mixed selections support
  `Mixed+100`-style relative math applied to every layer.
- **Scrubbing**: hover the field label (or the field with Option/Alt held)
  for the scrub cursor; drag left/right to change. **Four speeds by cursor
  height relative to the label's vertical center: 2x above, 1x at the top
  half, 1/2 lower, 1/4 at the bottom.** Scrubbing continues when the cursor
  leaves the field. This is the most granular speed model of any tool
  studied.
- **Alignment**: single selection aligns to its parent; multiple selections
  align to each other by default; **Shift+click an alignment control aligns
  the selection as a group to its parent**. Distribution requires >1 layer;
  outermost layers keep position; space-between value = the *mode* (most
  common) spacing in the selection.
- **Pixel grid**: with snap on, values may round up to 1px for display
  consistency with the mode spacing.

### A2. Figma UI3 (forum.figma.com; uxdesign.cc; Joey Banks' Config 2024 recap; designmonks.co)

Verified facts:

- **Property labels shipped OFF** in UI3 at Config 2024 (June 2024) and were
  restored as an **opt-in toggle** ("dropdown next to the zoom percentage →
  Property labels") after sustained complaints that the unlabeled panel was
  hard to read. Source: Joey Banks, "Config 2024: Everything New in Figma"
  (medium.com); Figma "Making the Move to UI3" best-practice guide (Mar 2025).
- **Floating panels shipped and were rolled back** (October 2024). Figma
  removed them entirely rather than making them optional. Sources:
  uxdesign.cc (Oct 5, 2024); forum.figma.com "Shortcut to bring back floating
  panels in UI3" (Oct 1, 2024).
- **UI scale**: the desktop app zoom adjusts the whole UI scale (help.figma.com
  "Adjust the scale of the Figma UI"); a font/icon-only scale has been
  requested since 2021 (forum.figma.com "Change Interface Scale").
- UI3's visual language: backgrounds on inputs, borders around dropdowns,
  larger radii, 200 redrawn icons (Figma blog, June 26, 2024, "Inside the
  Redesigned Figma").

**[inference]** The durable lessons: (1) a properties panel loses
scannability when labels disappear — labels are the primary way users
predict what a field does; (2) structural chrome experiments (floating
panels) can fail even when aesthetically interesting; (3) escape hatches for
legibility (label toggle, UI scale) are what users ask for when density
increases.

### A3. Sketch (sketch.com docs, blog, "What's New")

Verified facts:

- The Inspector is the right-hand panel; Layer List is left (sketch.com/docs).
- **Single-layer alignment targets the immediate parent** (group/artboard) —
  Sketch aligned with Figma's model in an Aug 4, 2022 update
  (sketch.com/blog "Align layers to a reference object").
- **Math operations in Inspector fields** (sketch.com, "How to use math
  operations in the Sketch Inspector", Oct 7, 2021): arithmetic on the
  current value while editing, including constants like pi.
- **Collapse/expand state of Inspector sections and Layer List groups
  persists across sessions** (sketch.com "What's New", Aug 26, 2026 entry).
- Web inspector improvements shipped Mar 12, 2026 (right-click inspect in
  frame detail view).

### A4. Penpot (community.penpot.app thread 248, fetched 2026-09-19)

Verified complaints (user-voiced, community thread):

- **Scrubbing number fields is a "must have"**: "change numbers on the right
  sidebar by dragging on the number box … saves a lot of time" (Solinus839,
  echoed by Kafka).
- **Right-panel spacing feels cluttered**: "a few panels on the right spacing
  are kinda close together, feels very cluttered" (Dream_Fighters).
- **Hover-state inconsistency**: "some elements get a green background, some
  a gray rectangle, some get only the pointer change" — users cannot tell
  what is interactive (jdittrich).
- **Thin strokes/icons** hard to read (sameoldlab); adjustable panel width
  requested.

### A5. Standards

- **WCAG 2.2 SC 2.5.8 Target Size (Minimum)** (w3.org, Understanding SC
  2.5.8): targets ≥ 24×24 CSS px, with exceptions — *Spacing*: an undersized
  target passes if a 24px-diameter circle centered on it does not intersect
  any other target's circle; *Inline*; *User-agent control*; *Essential*;
  *Equivalent*. The spacing exception is the standard tool for dense
  professional UIs: keep the visual control small but guarantee 24px of
  clear space around it.
- **WAI-ARIA APG Spinbutton** (w3.org/ARIA/apg/patterns/spinbutton): the
  text field is the only focusable element; ArrowUp/Down step, PageUp/Down
  larger step (optional), Home/End min/max *when they exist* (with the
  2026-era APG guidance that editable spinbuttons should not hijack
  Home/End caret behavior); typing with invalid characters blocked;
  `role="spinbutton"` + `aria-valuenow/min/max` (+ `aria-valuetext` for
  units); +/− buttons are decorative, not focusable; focus stays in the
  field throughout.

## B. What failed — documented failures to avoid

| # | Failure (source) | Root cause |
|---|---|---|
| F1 | UI3 small text / illegibility (forum.figma.com "Change Interface Scale" 2021 + UI3-era replies) | Type ramp shrank; no user-controlled scale for panel text |
| F2 | Icon-only controls lost labels (Config 2024 reaction; labels restored as toggle) | Labels removed for density; recognition replaced by recall |
| F3 | Floating panels (rolled back Oct 2024) | Structural chrome experiment reduced usable area and predictability |
| F4 | "More clicks for basic tasks", "wasted space and visual distraction" (forum Mar/May 2025 threads) | Controls moved/buried; padding increased without adding function |
| F5 | Forced migration anger (forum "UI3 is a huge downgrade", May 2025) | No opt-out during transition |
| F6 | Penpot: no scrubbing on number fields | Value editing relies on typing only |
| F7 | Penpot: inconsistent hover states | No shared interaction-state contract per control class |
| F8 | Penpot: cluttered right panel | No spacing scale between/inside sections |
| F9 | Design-tool a11y class issues (general): low-contrast labels, tiny hit targets, keyboard traps in numeric fields, unlabeled icon buttons | Density pursued without a11y contracts |

## C. Synthesis — complaint → does Varve have it (per my baseline)? → resolution → priority

Ground truth: `metrics-light.json` / `metrics-themes.json` /
`metrics-textscale.json` (fresh capture 2026-09-19 05:11–05:25), plus the
code census recorded in the audit document. Priorities: P1 = this pass must
fix; P2 = fix if bounded; P3 = documented decision, no change.

| Complaint | Varve status (measured) | Resolution for Varve | Priority |
|---|---|---|---|
| F1 small text | Labels render 12px/600 uppercase with a line-height split (15 vs 16.2px for the same 12px/600 census key); values 13px; section titles 13px/700. All `audit:tokens` pairs pass AA | Unify the label line-height split (drift, not a size problem); keep the 12px floor | P1 |
| F2 icon drift / unlabeled icons | 7 distinct icon sizes in one panel state (9–15px measured); key controls carry labels (asserted by existing E2E) | Icon-size token steps enforced; labels stay | P1 |
| F4 buried controls / clutter | Expanded worst-case scroll ratio: no-selection 7.3×, text 7.5× at the 240 rail (defaults collapse most sections) | Keep registry defaults; single spacing scale for section separation | P2 |
| Column alignment (Figma/Sketch convention: X/Y, W/H on a fixed grid) | Three distinct label-column x-positions per state (rectangle@320: 1128/1279/1329; spread 521px at the 640 rail); ~28 section-local `grid-template-columns` compete with the shared 38% `.insp-field` grid and the inline-flex NumberField row | One label-column grid contract; local grids only for genuine 2-col pairs | P1 |
| Inconsistent control heights (F4-class waste) | Measured control heights 24/30/31/32/44/51/52/54/55/63/65/66/88/113; `--component-compact-height` (32) used 22× but ~15 raw heights compete | Height tokens: field 32 (exists), compact row 24, composites derived — and a gate | P1 |
| F6 no scrubbing | NumberField already has scrub (relative delta), arrows + Shift/Alt modifiers, PageUp/Down, wheel, math expressions incl. `{alias}`, mixed values — verified in source | Keep; pin in spec | done |
| F7 hover inconsistency | Not yet measured per control class | One hover/focus contract per control class in the spec; spot-check in audit | P2 |
| F8 cluttered spacing | 951 raw px values across 19 inspector stylesheets; 1px×325, 2px×210 most common | Spacing from `--space-*` scale; enforcement gate for new code | P1 |
| F9 a11y | `audit:tokens` 213/213; undersized-target audit 0 failing (spacing-exception aware); keyboard = APG spinbutton | Maintain; add missing focus-ring geometry tokens (width/offset absent from tokens.css) | P2 |

## D. Standards reconciliation for dense pro-tool UI

- Adopt the **2.5.8 spacing exception** as the official approach: interactive
  targets must be ≥ 24×24 px, OR visually smaller with ≥ 24px clear space to
  every neighbouring target (measured, not assumed — the baseline harness
  computes this per target).
- Numeric fields follow the **APG spinbutton** model already implemented in
  `NumberField` (field-only focus, arrows, PageUp/Down, decorative steppers,
  `aria-valuenow/min/max/valuetext`). Home/End keep native caret behavior
  per the APG Task Force decision referenced in the source file.
- Uppercase micro-labels keep a 12px floor with 0.02em tracking
  (legibility complaint F1 balanced against density needs; every pair
  already passes WCAG AA in `audit:tokens`).

## Sources

- Figma Help, "Adjust alignment, rotation, position, and dimensions":
  https://help.figma.com/hc/en-us/articles/360039956914 (fetched 2026-09-19)
- Figma Help, "Adjust the scale of the Figma UI": https://help.figma.com
- Figma Forum, "Change Interface Scale (or just Figma's UI font scale)" (2021): https://forum.figma.com
- Figma Forum, "Figma UI3 is a huge downgrade and they are forcing it on us" (May 2025): https://forum.figma.com
- Figma Forum, "Shortcut to bring back floating panels in UI3" (Oct 2024): https://forum.figma.com
- Joey Banks, "Config 2024: Everything New in Figma": https://medium.com/@joeyabanks/config-2024-everything-new-in-figma-8c12e86303aa
- uxdesign.cc on the UI3 floating-panel rollback (Oct 2024): https://uxdesign.cc
- Figma, "Making the Move to UI3" (Mar 2025): https://www.figma.com/best-practices/
- Figma blog, "Inside the Redesigned Figma" (June 2024): https://www.figma.com/blog/
- Sketch docs — The Inspector: https://www.sketch.com/docs/
- Sketch blog, "Align layers to a reference object" (Aug 2022): https://www.sketch.com/blog/
- Sketch, "How to use math operations in the Sketch Inspector" (Oct 2021): https://www.sketch.com/
- Sketch, "What's New" (Aug 2026 — section collapse persistence): https://www.sketch.com/whats-new/
- Penpot community, "Thoughts on Penpot's User Interface":
  https://community.penpot.app/t/thoughts-on-penpot-s-user-interface/248
- W3C, Understanding SC 2.5.8 Target Size (Minimum): https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- W3C, APG Spinbutton pattern: https://www.w3.org/WAI/ARIA/apg/patterns/spinbutton/
