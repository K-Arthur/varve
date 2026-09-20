# Inspector spacing and density research (2026-09-19)

## Decision

The Inspector keeps one quiet separator-based section model and consumes the
existing Default Pro / Compact Pro preference. Default Pro is more breathable
(34px rows, larger vertical rhythm); Compact Pro is deliberately dense (28px
rows, narrow gaps). The document model, canvas geometry, section order, and
control locations remain unchanged.

This is a component-local migration. The primitive spacing ladder and root
`data-density` contract remain the sources of truth; Inspector aliases provide
the semantic bridge so future controls do not repeat raw geometry choices.

## External failure evidence

- [Figma Variables panel feedback](https://forum.figma.com/share-your-feedback-26/feedback-huge-vertical-spacing-in-the-new-variables-panel-is-reducing-density-feature-request-em-rem-units-56030)
  reports that excessive vertical spacing makes large variable sets require
  exhausting scroll and asks for a compact option.
- [Figma UI3 feedback](https://forum.figma.com/share-your-feedback-26/ui3-feedback-3058)
  describes wasted panel space, unstable control locations, and visual noise
  when hierarchy is replaced by extra gaps and surfaces.
- [Adobe Photoshop Properties feedback](https://community.adobe.com/questions-712/photoshop-cc2020-ui-1083187)
  reports oversized Properties spacing that forces unnecessary scrolling.
- [Adobe Premiere Properties feedback](https://community.adobe.com/t5/premiere-pro-ideas/better-panel-sizing-optimization-e-g-properties-panel/idi-p/15095349)
  reports narrow panels silently hiding controls, which is why this pass keeps
  horizontal overflow assertions and does not shrink labels or targets.
- [Figma's UI3 design account](https://www.figma.com/blog/our-approach-to-designing-ui3/)
  documents reverting cramped floating panels after they slowed users and
  reduced usable canvas space.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) provides the reflow and minimum
  target-size constraints used by the Inspector regression matrix.

## Repository evidence and migration map

| Surface | Before | After |
|---|---|---|
| Root preference | `data-density` existed, but Inspector ignored it | Same root writer; Inspector aliases consume it |
| Inspector rows | Most fields/actions resolved to fixed 32px component height | Form/action controls resolve to `--insp-row-height` (34px / 28px) |
| Panel inset | Fixed `space-2` | `space-3` Default Pro / `space-2` Compact Pro |
| Section body | `space-1` content gap and fixed padding | `space-2` / `space-1` by density, with matching content padding |
| Field groups | Shared `space-2` | `space-3` Default Pro / `space-2` Compact Pro |
| Coarse pointer | Selected drag handles had a separate 44px override | Inspector row alias promotes applicable targets to 44px |
| Website | Existing product scenes had no Inspector-density contract | Reviewed recaptures only; no unrelated website layout redesign |

## Known exceptions

- Horizontal gaps in paired coordinate grids stay width-safe; density changes
  vertical rhythm, not the usable value-column geometry.
- Swatches, previews, canvas overlays, authored document dimensions, and other
  functional geometry remain on their existing contracts.
- The existing temporary visual diagnostic remains useful for exploratory
  debugging; `spacing-density.spec.ts` is the committed assertion-based lane.
