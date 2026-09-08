# Vertical text audit — 2026-09-08

## Scope

This audit records the vertical-writing contract before implementation. It is
intended to prevent three different features from being conflated:

| Concept | Meaning in Varve |
| --- | --- |
| Writing mode | The logical flow of inline text and block lines: `horizontal-tb`, `vertical-rl`, or `vertical-lr`. |
| Text orientation | The orientation of individual vertical grapheme clusters: `mixed`, `upright`, or `sideways`. |
| Vertical alignment | Placement of the complete text layout inside its physical box. It does not rotate glyphs or change line progression. |

`direction` remains the inline bidi direction. It is not a replacement for
writing mode, and a node transform is not a substitute for either setting.

The contract follows the separation made by [CSS Writing Modes Level 3](https://www.w3.org/TR/css-writing-modes-3/): writing mode controls the
inline and block axes, while direction and text orientation remain separate
controls. Mixed orientation follows the Unicode vertical-orientation data in
[UAX #50](https://www.unicode.org/reports/tr50/), applied to grapheme
clusters. Caret movement and deletion must continue to use extended grapheme
clusters as described by [UAX #29](https://www.unicode.org/reports/tr29/).

## Findings

| Surface | Finding | Required repair |
| --- | --- | --- |
| Scene model | `ParagraphFormat.writingMode` exists, but `TextNode` has no writing-mode or orientation state. | Promote the settings to canonical text-node state and preserve them in constructors and serialization. |
| Shared geometry | `resolveTextGeometry` only lays out horizontal advances and maps `node.w` to the wrapping width. | Add logical inline/block axes and map vertical wrapping to the physical height of an area text box. |
| Shaping | The Rust/rustybuzz seam already accepts `ttb`/`btt` and exposes `yAdvance`, but the engine request and canvas path do not carry vertical intent. | Thread the resolved vertical direction through the request, snapshot identity, and renderer. |
| Canonical snapshot | Carets, selection rectangles, and hit testing are expressed only as horizontal `x` positions. | Add vertical line/stop geometry without changing the logical UTF-16 source model. |
| Editor | `TextEditOverlay` is a horizontal transparent textarea with `dir="auto"`. | Apply CSS writing mode/orientation to the editing surface and keep source offsets, IME, clipboard, and history logical. |
| Inspector | Typography exposes direction and vertical alignment but not writing mode or orientation. | Add discoverable Writing mode and Orientation controls, with labels that distinguish them from alignment and rotation. |
| Export | HTML codegen has a writing-mode field; SVG and the scene-to-engine path do not consistently receive the node setting. | Emit the same semantic settings where the target format supports them and document raster/outline limitations honestly. |
| Clipboard | Typography property copying does not include vertical settings. | Preserve writing mode and orientation in internal rich/property clipboard data. |
| Marketing/docs | The typography page describes Unicode and CJK foundations but does not describe vertical writing. | Publish only the validated capability set after the implementation and visual checks land. |

## Implementation decisions

1. The source remains ordinary logical text and rich-text runs. Vertical layout
   must not be implemented with inserted newlines, per-character layers,
   outlines, or a rotated horizontal text node.
2. A vertical area text box wraps along its physical height (the logical
   inline axis). Its columns advance across the physical width. `columnCount`
   remains a separate multi-column layout feature and is not overloaded to mean
   vertical writing.
3. `vertical-rl` starts the first column on the right and progresses columns
   toward the left; `vertical-lr` progresses toward the right. `mixed` uses
   Unicode vertical-orientation data, `upright` uses vertical metrics for every
   cluster, and `sideways` rotates coherent horizontal runs while retaining
   horizontal shaping metrics.
4. Vertical alignment remains a physical-box alignment control. It must not
   change column progression or cluster orientation.
5. The canonical layout snapshot remains the authority for scene bounds,
   painting, caret stops, selection rectangles, and pointer hit testing. Cache
   identity includes writing mode and orientation.
6. Unsupported export targets must report their limitation rather than silently
   flattening editable vertical text into an unrelated visual result.

## Initial capability matrix

| Capability | Before this work | Target of this work |
| --- | --- | --- |
| Persist vertical mode on a text node | No | Yes |
| Layout and paint `vertical-rl` / `vertical-lr` | No | Yes, through the canonical snapshot |
| Mixed/upright/sideways orientation | No | Yes, cluster-aware |
| Vertical wrapping in fixed boxes | No | Yes, using physical height as inline extent |
| Caret, selection, hit testing, IME | Horizontal only | Logical source offsets with vertical geometry |
| Inspector controls | No | Yes |
| Save/reload and property clipboard | Partial model field only | Yes, node-level settings preserved |
| HTML/SVG export | HTML type seam only | HTML semantic attributes; SVG capability documented and tested |
| Native ttb/btt shaping | Backend seam exists | Request path integrated where available; browser fallback remains explicit |

## Validation required before claiming complete

- Unit tests for state defaults, round-trip serialization, logical-axis
  geometry, orientation classification, cache identity, caret/selection/hit
  testing, undo/redo, and clipboard properties.
- Engine/replay tests for horizontal regression plus vertical-rl/lr,
  mixed/upright/sideways, combining marks, emoji clusters, punctuation, and
  multi-paragraph text.
- A real Playwright editor test covering create/convert, inspector changes,
  typing/selection, resize, save/reload, and export.
- Visual screenshots at least for vertical-rl, vertical-lr, mixed orientation,
  and an active editing state. Review must compare the rendered frame with a
  forced full redraw when any pixel-reuse path is involved.

This file is an audit and contract, not a claim that those capabilities were
already present on the audit date.
