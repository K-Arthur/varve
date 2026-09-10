# Grid system follow-up audit

**Date:** 2026-09-09  
**Scope:** scene model, migrations, Figma import, editor rendering, snapping, inspector, and website documentation  
**Status:** implementation complete; marketing browser validation complete; editor browser validation blocked by shared-worktree app instability

This is a new audit against the current `master` tree. The earlier grid audit
(`grid-system-audit-2026-07-27.md`) correctly identified missing layout-guide rendering,
but its remaining-state tables are historical and should not be treated as current behavior.

## Findings and repairs

| Finding | Root cause | Repair/evidence |
| --- | --- | --- |
| Camera rotation could leave document-grid lines in unrotated screen space | Renderer projected lines with `world * zoom + pan` arithmetic | `gridRenderer.ts` now projects through shared camera helpers; focused renderer tests cover rotated camera/grid cases |
| Non-square document grids reused X minor spacing for Y | One `minorStep` was derived only from `spacingX` | Independent X/Y minor and major LOD steps; focused renderer test covers `8 × 12` spacing |
| Pixel grid was below opaque artwork | CSS layer had a lower stacking level than content | Pixel lines now use the canonical overlay canvas and camera projection |
| CSS dot grid was always mounted | `dotGridEnabled` was not used as a render guard | Dot layer is conditional and documented as visual-only |
| Layout guides were not rendered and snapping borrowed auto-layout tracks | Tool context parsed `layoutStyle.gridTemplateColumns` as a proxy | Pure `layoutGridGeometry` resolves authored guides for both drawing and snapping; auto layout remains separate |
| Only one layout guide survived per frame | `layoutGrids` was `Record<string, LayoutGrid>` and Figma import selected one entry | v2.24 stores arrays, migrates old documents, and preserves all supported Figma entries |
| Layout guide overlays could leak from another page/canvas | Overlay iteration used every document entry | Active editor scene scope filters frame owners for drawing and snapping |
| Grid inspector could show state that the document setter rejected | UI patched unsanitized values after scene validation | Context handlers patch only the accepted sanitized document grid |
| Viewport preference could overwrite document-authored grid visibility | Restore merged legacy `gridVisible` into the document grid | Document grid geometry and visibility now win; view preferences remain display-only |
| Baseline/isometric geometry duplicated camera math and ignored configured origins | SVG overlay used fixed extents and a local transform | Overlay uses shared camera projection, viewport bounds, baseline offset, isometric origin, axes, and rotation |
| Marketing guide presented correct content as a dense, unstyled text column | The first docs pass had no page-local composition or visual explanation | Grid Systems now has a visual hero, system map, control mockups, responsive cards, and a dedicated Canvas feature showcase |

## Capability map

| Capability | Document grid | Pixel grid | Baseline/isometric | Frame layout guides |
| --- | --- | --- | --- | --- |
| Persisted in document | Yes | Settings + document definition | Yes | Yes, v2.24 arrays |
| Independent visibility | Yes | Yes | Yes | Global + per guide |
| Independent snapping | Yes | Yes | Baseline deferred | Yes, per guide |
| Pan/zoom projection | Shared camera | Shared camera | Shared camera | Camera + frame transform |
| View rotation | Draw + snap | Draw | Draw | Frame transform |
| Inspector authoring | Yes | Toggle + snap toggle | Existing isometric controls | Yes, multiple guides |
| Exported by default | No | No | No | No |

## Decision record

1. Visual layout guides are authored frame metadata, not `layoutStyle` and not scene nodes.
2. Every visible/snap-capable overlay must use the same camera authority as artwork.
3. Document geometry is restored from the document; local preferences may control display
   modes but cannot replace authored spacing, offset, rotation, or visibility.
4. A frame may own multiple guides. Figma entries are imported individually with stable ids.
5. Invalid track geometry is handled as an explicit non-rendering state rather than silently
   scaling fixed tracks into a different authored meaning.

## Tracker

| Work item | Status | Validation |
| --- | --- | --- |
| Camera-correct document grid | Done | `gridRenderer.test.ts` |
| Independent X/Y density and rotated snapping | Done | renderer + snapping focused tests |
| v2.24 multi-guide model/migration | Done | `version.test.ts` |
| Figma multi-guide import | Done | `figma.test.ts` |
| Frame guide geometry/rendering | Done | `layoutGridGeometry.test.ts` + editor typecheck |
| Inspector controls and state precedence | Done | `LayoutSection.test.tsx` and editor typecheck |
| Website documentation and feature copy | Done | website typecheck + 6 grid-docs browser tests across both site builds |
| Marketing visual hierarchy and responsive composition | Done | inspected desktop/mobile docs and Canvas feature captures; no overflow |
| Editor browser interaction/visual validation | Blocked in shared worktree | Playwright reaches the editor, then the shared build enters a Vite error overlay/safe-mode screen for unrelated unresolved imports (`generativeEdit/nativeModel`, `@tauri-apps/plugin-dialog`) before the layout-guide assertion; rerun after concurrent editor changes settle |

## External reference check

The behavior model was compared with current official product documentation:

- [Figma layout guides](https://help.figma.com/hc/en-us/articles/360040450513-Create-layout-guides)
  distinguishes frame-attached uniform, column, and row guides from auto-layout grids and
  supports multiple guides per frame.
- [Adobe Illustrator grids and guides](https://helpx.adobe.com/illustrator/desktop/measure-and-align/grids-and-guides/align-graphic-objects-with-grids.html)
  keeps showing a grid separate from Snap to Grid.
- [Sketch canvas grids](https://www.sketch.com/docs/interface-and-settings/the-mac-app-interface/the-canvas/)
  keeps square/layout grids and pixel fitting as separate canvas behaviors.
