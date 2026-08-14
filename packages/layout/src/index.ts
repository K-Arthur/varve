/**
 * @varve/layout — the CSS-native layout IR: flex and grid auto-layout,
 * reflow, and the geometry utilities the layout engine shares with the
 * editor's transform pipeline.
 *
 * The designer's layout IS the handoff CSS. This package holds the pure,
 * DOM-free layout computations (mirroring the `varve-layout` Rust crate's
 * intended surface):
 *
 * - `computeFlexLayout` — row/column/reverse, wrap, gap, padding, align/
 *   justify, grow/shrink, fill/hug/fixed sizing (CSS flexbox model).
 * - `computeGridLayout` / `applyGridLayout` / `parseGridTracks` — explicit
 *   tracks (px/rem/%), auto-placement, placement overrides (CSS grid).
 * - `reflowLayoutChildren` — the single entry point that repositions (and,
 *   for fill/grow children, resizes) a frame's children against its current
 *   box after any frame-size change.
 * - `resizeNodeGeometry` — type-aware geometry resizing shared by the
 *   layout engine, inspector W/H edits, and transform baking.
 * - `checkLayoutCycle` — cycle guard for nested layout containers.
 *
 * Nothing here touches the DOM; the editor owns canvas adapters and the
 * rendering pipeline (see `packages/editor/src/layout/` for editor-only
 * arranging utilities such as autoArrange and table layout).
 */
export type { LayoutResult } from './computeFlexLayout';
export { computeFlexLayout } from './computeFlexLayout';
export type { GridItem } from './computeGridLayout';
export { applyGridLayout, computeGridLayout, parseGridTracks } from './computeGridLayout';
export type { CycleCheckResult, LayoutCycleVerdict } from './cycleDetection';
export { checkLayoutCycle } from './cycleDetection';
export { reflowLayoutChildren } from './reflow';
export { resizeNodeGeometry } from './resizeGeometry';
export const PACKAGE = '@varve/layout' as const;
