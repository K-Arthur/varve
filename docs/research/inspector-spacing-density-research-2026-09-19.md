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

## Follow-up research (2026-09-20): separators and field insets

The first pass established compliance with the ladder and the density
preference. Direct inspection then asked two narrower questions: how should a
dense property panel separate groups, and how should a compact field be
inset? Sources and the decisions they support:

**What works (design systems)**

- Atlassian’s spacing system uses an 8px base and explicitly assigns
  `space.025`–`space.100` (2–8px) to “container padding of small components”
  and “padding within input components”, with 12–24px reserved for less dense
  UI. This is the basis for moving the Inspector’s field inset from 5.92px to
  the 8px+ step; it also confirms that section separation should come from the
  larger range, not from the same step as row gaps.
- Adobe Spectrum, IBM Carbon, Material and the 8-point literature all use the
  same base discipline with a 4px step for “spacing inside small components”.
  The repository’s fluid ladder already provides those steps (`--space-1…
  --space-4` resolve to 2.96/5.92/9.68/13.44px at 1440), so no new ladder was
  added; the fix was assigning the steps by relationship.
- GEL’s proximity model (“best friends ≈ 8px, friends ≈ 16px, acquaintances ≈
  24px+”) is the direct source for the three-level contract: body row gap <
  group gap < section separation, and for the rule “tighter inside, looser
  between” rather than uniform air.
- Pro tools ship two densities exactly this way: Sketch’s inspector and
  Photoshop’s properties both keep a compact row and rely on group separation,
  not on padding inside every row.

**What has failed (complaints we can resolve)**

- Figma’s Variables panel shipped a row-spacing increase that users described
  as “massive, unnecessary vertical gap”, “cluttered yet empty at the same
  time”, and “an exhausting amount of scrolling” — with a request to restore
  the compact layout or offer a density toggle. Lesson: adding air uniformly
  is not a fix; hierarchy is. This pass increased *group and section*
  separation while keeping Compact Pro genuinely compact (it remains 286px
  shorter than Default Pro for the same frame selection).
- Figma UI3 feedback about “wasted panel space”, unstable control locations
  and “visual noise when hierarchy is replaced by extra gaps and surfaces”
  motivated the opposite guard: no new cards, no new surfaces, and no rule
  where a label and a gap can carry the grouping. That is why the Sizing
  subgroup lost its hairline instead of gaining a card.
- Separators disappearing in dark mode is a recurring, cross-product failure:
  Ant Design’s dark mode divider issue (“since the divider color is dark, I
  can’t see it”), VS Code’s title-bar/tab-bar indistinguishability report, and
  end-user contrast reports on cheaper monitors all point the same way.
  Consequence here: the section hairline stays a named token
  (`--color-border-subtle` / `--color-separator-*` are one value by design),
  is never a translucent literal, and is never the only grouping cue.
- Adobe Photoshop and Premiere panel complaints run the other way — oversized
  Properties spacing forcing scroll, and narrow panels silently hiding
  controls. Consequence: horizontal field geometry was deliberately not
  reduced, and the narrow-rail overflow assertions remain part of the lane.
- Figma’s own UI3 account documents reverting cramped floating panels after
  they slowed users down and reduced usable canvas space, which is why the
  pass kept the panel’s existing outer inset and padding rather than shrinking
  chrome to gain rows.

**Decisions recorded**

1. One separator language: rules mark section boundaries; labels mark groups.
2. Three ordered levels per density mode, with section separation one step
   above the group gap because the panel gap adds to its margin.
3. One field chrome and one `--space-3` inline inset for number fields, text
   inputs, preset triggers, and select triggers inside the Inspector.
4. Header rows (sections, node header, alignment label) use
   `--insp-row-height`; controls and navigation share one row contract.
5. Not done, deliberately: no 4px-grid rewrite of the ladder (see
   `spacing-system.md` § Why the ladder was not rewritten), no additional
   ladder steps, no token additions for this pass, no horizontal shrink.

## Known exceptions

- Horizontal gaps in paired coordinate grids stay width-safe; density changes
  vertical rhythm, not the usable value-column geometry.
- Swatches, previews, canvas overlays, authored document dimensions, and other
  functional geometry remain on their existing contracts.
- The existing temporary visual diagnostic remains useful for exploratory
  debugging; `spacing-density.spec.ts` is the committed assertion-based lane.
