# Radio-group system

**Status:** current production contract
**Last updated:** 2026-09-20
**See:** `docs/design/switch-system.md` (binary settings), `docs/design/corner-radius-system.md`
(segment geometry), `docs/audits/radio-group-review-2026-09-20.md` (evidence).

Varve has one mutually-exclusive choice grammar. A control is chosen from the
kind of decision the user is making, not from how compact the surface is.

## Choosing the control

| User decision | Control | Contract |
|---|---|---|
| One setting, genuinely on/off | `Switch` / `SwitchField` | See switch-system.md |
| Zero or more independent options | `Checkbox` / checkbox group | Multi-select only |
| One of two or more **peer modes** applied immediately | `SegmentedControl` | APG radiogroup, roving tabindex, instant apply |
| One of a short list **inside a form/dialog**, each option needing explanation | `RadioGroup` / native radios (card or stacked) | Native `checked`, group label, instant or staged per surface |
| More than five text options, or options that are sentences | `Select` | APG combobox |
| One action whose pressed state is interaction-local | `ToggleButton` | `aria-pressed`, not a setting |
| Independent toolbar commands | `ButtonGroup` | `role="group"`, no selection state |

### SegmentedControl limits

- **2–5 options with visible text.** Five is the practical ceiling on desktop.
- **Up to 6 options when every option is icon-only.** The visible label is
  hidden (`hideLabel`) but stays in the accessibility tree and the tooltip;
  an icon segment is never an unlabelled glyph.
- **More than 5 text options is the wrong component.** Use `Select`, or split
  the decision. Abbreviating labels to fit ("Spc", "Ard", "Evn") is not a fix;
  it trades comprehension for width.
- Binary peer alternatives (Grid/List, Dark ink/Light ink) stay segmented;
  binary *settings* (Show guides) use `Switch`.

## SegmentedControl contract

Canonical implementation: `packages/ui/src/components/SegmentedControl.tsx`,
styled by `.varve-segmented*` in `packages/ui/src/components/components.css`
with geometry owned by `radius-system.css`.

- **Semantics:** `role="radiogroup"` with a required accessible name; each
  option is a native radio carrying `checked`. No `aria-checked` override.
- **Keyboard (APG radio group):** one tab stop (the checked option, or the
  first enabled one); Arrow keys move focus **and** selection; Home/End jump
  to first/last; disabled options are skipped and expose their reason as a
  tooltip.
- **Pointer:** the transparent input covers the whole segment, so the segment
  is one hit target and automation can click the radio directly.
- **Labels:** visible text by default; `hideLabel` for icon options keeps the
  accessible name; `tooltip` overrides the hover text when it should say more.
- **Disabled:** per-option `disabled`/`disabledReason` and group-level
  `disabled`; disabled segments keep their stored value.
- **Variant `pill`:** view-mode switches (e.g. Grid/List). Labels collapse
  below 640px but the input keeps its `aria-label` (WCAG 4.1.2).

### Geometry

The control is an **inset** group: the shell owns the outer radius and each
segment is a separate visible layer inset by the shell padding, so segment
radius derives from the outer value (`max(0px, calc(var(--radius-control) -
var(--space-05)))`). Connected groups with square internal edges are a
different pattern (`ButtonGroup`, toolbars) and do not apply here. The pill
variant rounds both levels. State changes never change radius.

### Responsive behavior

- **Wrap, never clip.** Inspector field columns use
  `repeat(auto-fit, minmax(min(6rem, 100%), 1fr))`: options wrap onto
  additional rows instead of shrinking below their labels. When a segment is
  genuinely squeezed, its label ellipsizes and the tooltip still carries the
  full text.
- **No horizontal scroll strips.** A scrolled segmented control hides options
  at the inline end; wrap instead (the Upscale dialog does).
- Icon-only variants stay on one row longest because their targets are
  uniform; text variants wrap by content width.
- Touch targets stay at the shared minimum on coarse pointers.

## RadioGroup / native radios

`packages/ui/src/components/Radio.tsx` remains the composition layer for
form-like and card choices (only production consumer: the New-design dialog
"Starting point" cards). Dialog surfaces that predate it keep native
`<input type="radio">` groups inside a `<fieldset>`/labelled group; native
radios already provide arrow-key navigation and form semantics, so they are
correct as-is. What they must not do is sit inside a `role="radiogroup"` that
also contains non-radio controls, or drop their group label.

## Hand-rolled radiogroups: allowed shape

Purpose-built surfaces (canvas overlays, tool popovers, the website theme
switcher) may own their visual chrome, but not their keyboard model or role
ownership:

- `role="radiogroup"` contains **only** `role="radio"` children.
- Exactly one radio is a tab stop; arrows + Home/End move selection and focus.
- A group of `aria-pressed` toggle buttons uses `role="group"`, never
  `role="radiogroup"`.
- Icon-only options keep an accessible name and a tooltip.
- A focused radiogroup owns its keys: `[role="radiogroup"]` is part of the
  widget-ownership selector, so global single-key shortcuts and modal captures
  (such as the crop-mode arrow handler) never steal arrows from the group.

Documented members of this family: `CropOverlay` (aspect/guides, shared local
helper), `ToolOptionsPopover` `SegmentedRadioGroup`, `WorkspaceTabs`,
`BrushBrowser` filter chips, `ColorSpaceSelector`/`ColorFields`, the website
`ThemeToggle` (Astro, same contract, forced-colors and touch-target rules).

## Registry — reviewed surfaces

Full per-surface inventory and decisions live in
`docs/audits/radio-group-review-2026-09-20.md`. Summary:

- 56 `SegmentedControl` usages: all classified; four binary mode pickers and
  every icon-capable picker reviewed; Layout align/justify converted from six
  abbreviated text segments to icon segments with full names.
- 43 native radio inputs across dialogs: kept (correct semantics), with the
  inert import-preview pair removed and the archive dialog's emoji entities
  replaced by icons.
- `AlignDistributeBar` alignment reference: role corrected to `group`.
- `ImportPreview`: dead control removed rather than styled.

## Research basis

- WAI-ARIA APG, Radio Group pattern (roving tabindex, arrows, group name).
- Apple Human Interface Guidelines, segmented controls: 2–7 segments wide /
  ≤5 on iPhone, consistent segment sizes, don't mix text and icons.
- Material Design 3 segmented buttons; Primer segmented control: 2–5 text or
  ≤6 icon-only options, immediate apply, no more than five text options.
- Nielsen Norman Group and Baymard on visibility-first choice controls;
  segmented-control misuse patterns (navigation, 6+ options, cryptic
  abbreviations, hidden overflow).
- `docs/audits/radio-group-system-audit-2026-08-31.md` and
  `docs/audits/radio-group-canonicalization-2026-09-19.md` for prior decisions.

## Verification checklist

For any new or migrated group:

1. Role ownership: radiogroup contains only radios; pressed-button groups use
   `role="group"`.
2. Exactly one tab stop; arrows and Home/End move focus and selection.
3. Every option has an accessible name, including icon-only and collapsed
   pill segments.
4. Option count within the text/icon limits above; no cryptic abbreviations.
5. Geometry: derived inset radius on segments, both pill levels round.
6. Narrow container: options wrap with full labels; no clipped or scrolled
   options; tooltips carry squeezed labels.
7. Light, dark, high-contrast/forced-colors, and reduced-motion states keep
   the selection distinguishable without relying on color alone.
