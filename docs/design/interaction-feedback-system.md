# Interaction feedback system

Current-state contract for hover, focus, selection, toggle, highlight, and
drag feedback across the Varve editor UI and marketing site.

This document is intentionally about application-interface feedback. Document
paint, user-authored layer colors, exported artwork, canvas pixels, hit-test
buffers, shader/debug colors, and decorative marketing artwork remain owned by
their respective domains.

## Audit summary

Varve already has a useful foundation: `packages/ui/src/tokens/color.ts` is the
audited color source, `tokens.css` is generated from it, and most persistent
controls expose ARIA state (`aria-selected`, `aria-pressed`, or `aria-current`).
The editor and website both consume the token stylesheet. The main gap was not
the absence of tokens; it was that the available tokens represented only a
small part of the interaction vocabulary and were used inconsistently.

### Findings

| Priority | Finding | Impact |
| --- | --- | --- |
| High | Hover, pressed, selected, current, checked, search, and drop states were not represented by one semantic set of roles. | Equivalent states could look unrelated, while unrelated states could look identical. |
| High | Several hover rules were unconditional. | Touch and hybrid devices could inherit sticky desktop hover feedback. |
| High | Layer search matches used the warning color and invalid drops referenced the obsolete `feedback-error` name. | Search could be confused with validation, and invalid-drop feedback could silently fall back. |
| High | Focus was usually visible, but selected/current controls did not have a documented combination rule. | Future local overrides could hide focus on persistent states. |
| Medium | The shared button press and generic drag feedback used scale transforms. | Repeated actions could feel unstable and introduce visual movement. |
| Medium | Website buttons and cards contained `transition: all` or raw interaction colors. | Unrelated properties could animate and the marketing surface could drift from the app hierarchy. |
| Medium | Layers intentionally combine type/document-color washes with application selection. | This is useful, but must remain an explicit exception rather than become a second state system. |
| Low | The repository has broad visual infrastructure but no compact, reusable interaction-state matrix. | Regressions are harder to inspect directly across themes and modalities. |

### Product context

Varve is a dense, local-first vector/raster design editor with long-session
desktop workflows, a keyboard-heavy tool surface, layers trees, inspectors,
menus, timelines, drag-and-drop, and a canvas rendered separately from the UI.
The website is a more expressive marketing surface, but shares typography,
theme lifecycle, and controls with the application. The editor therefore uses
restrained surface changes for hover, compact persistent selection, a clear
focus ring, and precise drop indicators. The website may use elevation and
motion for cards, but retains the same state meaning and focus treatment.

## Canonical state model

Persistent semantics belong in ARIA or data attributes; classes are only a
rendering hook. The following meanings apply wherever the component supports
the state:

| State | Meaning | Primary visual cue |
| --- | --- | --- |
| Resting | Available, not currently targeted. | Neutral surface and foreground. |
| Hover | Temporary pointer preview on a hover-capable device. | Subtle surface/foreground refinement. |
| Focus-visible | Keyboard or equivalent navigation target. | Independent 2px focus ring with offset. |
| Pressed | Immediate activation feedback. | Short-lived darker/lower-luminance surface; no layout movement. |
| Selected | Persistent membership in a selection. | Persistent selected surface and/or boundary. |
| Current | Current route, tab, tool, page, or context. | Indicator or underline distinct from selection. |
| Checked / pressed toggle | Persistent boolean control value. | Checked mark or selected control surface; works without hover. |
| Search match | Non-current result. | Localized match highlight. |
| Current search match | Result currently navigated or edited. | Stronger match treatment plus non-color cue where needed. |
| Drag source | Item currently being moved. | Reduced emphasis without changing geometry. |
| Drop target | Valid destination. | Outline/insertion marker; overrides ordinary hover. |
| Drop denied | Destination is unavailable. | Danger outline/marker and explicit status text or icon. |
| Disabled | Unavailable and not interactive. | Muted content; no ordinary hover or pressed feedback. |
| Read-only | Inspectable or focusable, but not editable. | Normal navigation feedback with a read-only affordance. |

Combination rules:

- Disabled suppresses ordinary hover and pressed feedback.
- Selected and current remain visible after hover ends. Hover refines them;
  it never replaces them.
- Focus-visible remains visible on selected, checked, current, invalid, and
  hovered controls. It is never encoded only by the selected surface.
- Pressed temporarily outranks hover while preserving persistent context.
- A valid drop target outranks hover and selected-row background treatment;
  insertion lines use positioned pseudo-elements so virtualized row geometry
  does not change. Drop denied never uses the valid-target color.
- Search match is not a warning. Current match is stronger than other matches.
- A child action may be hovered/focused while its parent row remains selected.
- Local selection and remote collaboration selection use different cues.
- Pointer hover is available only inside `(hover: hover) and (pointer: fine)`.
  Touch and coarse-pointer layouts expose actions without requiring hover.
- Reduced motion removes transitions, not state contrast or state markers.

## Architecture and migration map

The source-of-truth chain is:

```text
color.ts (audited semantic roles)
  -> generate-token-css.ts
  -> tokens.css (light/dark/high-contrast/forced-colors)
  -> shared UI CSS + website semantic aliases
  -> ARIA/data state attributes on components
```

The interaction roles are grouped as follows:

- Primitive ramps remain in `color.ts`; components do not select ramp steps.
- Semantic roles describe meaning: hover surface, selected surface, pressed
  surface, focus ring, current indicator, match highlights, and drop feedback.
- Domain aliases remain for layers and canvas overlays where geometry or
  document semantics require a distinct rendering method.
- Website aliases in `apps/website/src/styles/theme.css` point to shared roles;
  page-level CSS does not invent a second interaction palette.

Representative migrations:

| Before | After |
| --- | --- |
| Local row hover color | Shared interactive hover surface role. |
| Selection color reused for focus/current | Separate selected, current, and focus roles. |
| Warning color for layer search | Search-match and current-search-match roles. |
| `feedback-error` drop fallback | Canonical danger/drop-denied role. |
| `transition: all` | Explicit background, color, border, and shadow properties. |
| Button/drag scale press effect | Surface/border feedback without dimension movement. |
| Hover-only drag handle | Hover + focus-within on fine pointers; always available on coarse pointers. |
| Raw website hover values | Website aliases backed by shared UI tokens. |

Intentional local exceptions:

- Layer tag colors and type-coded layer rails are document-organization cues;
  they are preserved and selection is layered over them.
- Canvas selection, guides, snap previews, audit overlays, and renderer colors
  are screen-space/editor-domain rendering contracts, not DOM component colors.
- Marketing hero artwork and decorative glows are visual direction, not state
  feedback; they may retain their local tokens when they do not claim to be an
  interaction state.

## Validation contract

Every future interaction-state change should include:

1. `pnpm verify:plan` followed by `pnpm verify:affected`.
2. Token contrast coverage for light, dark, high-contrast, and forced-colors
   behavior where a new semantic color is introduced.
3. Keyboard checks for focus-visible, current, selected, and checked states.
4. Pointer checks for hover/pressed and touch/coarse-pointer checks that do not
   depend on hover.
5. A representative visual matrix: editor chrome, layers tree, menus/tabs,
   and website navigation/cards in light, dark, and high-contrast themes.
6. Direct screenshot inspection; a passing screenshot assertion is not proof
   that the hierarchy is visually coherent.

The current implementation intentionally lands this contract incrementally.
The migration is complete only when shared controls, layers, website states,
and their visual coverage all consume the same semantic roles.
