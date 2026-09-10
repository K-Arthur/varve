/**
 * Shared z-index for interactive canvas overlays (selection handles, gradient
 * handles, node-edit points, crop/alignment/measure/snap-guide overlays, etc).
 *
 * The canvas paints its own layers with explicit z-index 0-4
 * (`.editor-canvas__grid-layer` through `.editor-canvas__color-blindness` in
 * editor.css) and those canvases paint an opaque page background across their
 * full bounds. Any sibling overlay left at the CSS default `z-index: auto`
 * paints in the same stacking batch as `z-index: 0`, which is *below* those
 * positive-z-index canvases regardless of DOM order — so it renders
 * completely (and silently) hidden behind the canvas, not just where a shape
 * happens to be drawn. Every interactive overlay must set this z-index
 * explicitly; do not rely on DOM order or the CSS default.
 */
export const CANVAS_INTERACTIVE_OVERLAY_Z_INDEX = 10;
