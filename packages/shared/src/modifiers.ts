/**
 * Centralized modifier-key interpretation for resize and transform operations.
 *
 * Maps physical platform keys (Shift, Alt, Ctrl/Meta) to semantic actions,
 * providing a single source of truth for the interaction layer.
 *
 * ## Resize modifier conventions (Figma, Sketch, Illustrator, Affinity)
 *
 * | Modifier | Figma        | Sketch       | Illustrator | Affinity  | Strata     |
 * |----------|-------------|--------------|-------------|-----------|------------|
 * | Shift    | Constrain proportions | Constrain proportions | Constrain proportions | Constrain proportions | Toggle aspect lock† |
 * | Alt/Opt  | Resize from center | Resize from center | Resize from center | Resize from center | Resize from center |
 * | Ctrl/Cmd | —           | —            | —           | —         | Bypass snap |
 * | Space    | Pan canvas  | Pan canvas   | Pan canvas  | Pan canvas | Hand tool spring |
 *
 * † Default aspect-lock state differs per object type:
 *   - Raster image corners: locked by default (Shift unlocks)
 *   - Raster image edges: unlocked by default so the container/crop window
 *     changes on one axis without distorting source pixels (Shift locks)
 *   - Vector shapes/text/frames: unlocked by default (Shift locks)
 *   - Multi-selection: follows the majority type
 */

/**
 * Semantic resize modifiers derived from physical key state and context.
 */
export interface ResizeModifiers {
  /** When true, resize from the center (Alt/Option held). */
  centered: boolean;
  /** When true, preserve aspect ratio. Default depends on node type. */
  proportional: boolean;
  /** When true, bypass snapping (Ctrl/Cmd held). */
  bypassSnap: boolean;
}

/**
 * Compute resize modifiers from raw PointerEvent modifier state.
 *
 * @param shiftKey - `e.shiftKey` from the pointer event
 * @param altKey - `e.altKey` from the pointer event
 * @param ctrlKey - `e.ctrlKey` from the pointer event
 * @param metaKey - `e.metaKey` from the pointer event
 * @param isRaster - true when all selected nodes are raster/image fills
 * @param isMac - true when running on macOS (affects Ctrl vs Meta mapping)
 * @param isEdgeHandle - true for a single-axis north/south/east/west handle
 * @param defaultProportional - default proportional state for the selection
 *   (derived from the dominant object type policy). When true, Shift toggles OFF;
 *   when false (default), Shift toggles ON.
 */
export function computeResizeModifiers(
  shiftKey: boolean,
  altKey: boolean,
  ctrlKey: boolean,
  metaKey: boolean,
  isRaster: boolean,
  isMac: boolean = false,
  isEdgeHandle: boolean = false,
  defaultProportional?: boolean,
): ResizeModifiers {
  const cmdKey = isMac ? metaKey : ctrlKey;
  const baseProportional = defaultProportional ?? (isRaster ? !isEdgeHandle : false);

  return {
    centered: altKey,
    proportional: shiftKey ? !baseProportional : baseProportional,
    bypassSnap: cmdKey,
  };
}

/**
 * Compute rotate modifiers. Shift snaps rotation to 15° increments.
 */
export interface RotateModifiers {
  snap: boolean;
}

export function computeRotateModifiers(shiftKey: boolean): RotateModifiers {
  return { snap: shiftKey };
}
