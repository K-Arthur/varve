/**
 * Text-node local bounds — the scene graph's single adapter onto the canonical
 * text geometry in `@varve/shared`.
 *
 * `nodeBounds` and `sourceBounds` both compute local bounds and both used to
 * carry their own copy of the text branch; they had already drifted apart
 * (one honoured wrapping and text case, the other did not), so a warped or
 * expanded text node measured differently from the same node selected. Both
 * now call through here.
 */

import type { Rect } from '@varve/shared';
import {
  DEFAULT_ARTWORK_FONT_FAMILY,
  resolveTextGeometry,
  type TextGeometry,
  type TextGeometryInput,
} from '@varve/shared';
import type { SceneNode } from './types';

type TextNodeLike = Extract<SceneNode, { kind: 'text' }>;

/** Project a scene text node onto the layout inputs geometry actually reads. */
export function textGeometryInput(node: TextNodeLike): TextGeometryInput {
  return {
    text: node.text,
    richText: node.richText,
    w: node.w,
    h: node.h,
    fontSize: node.fontSize,
    fontFamily: node.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY,
    fontWeight: node.fontWeight,
    fontStyle: node.fontStyle,
    letterSpacing: node.letterSpacing,
    tracking: node.tracking,
    lineHeight: node.lineHeight,
    paragraphSpacing: node.paragraphSpacing,
    textCase: node.textCase,
    textMode: node.textMode,
    textResizing: node.textResizing,
    variableAxes: node.variableAxes,
  };
}

/** Full derived geometry — container, layout, line boxes, and selection box. */
export function textNodeGeometry(node: TextNodeLike): TextGeometry {
  return resolveTextGeometry(textGeometryInput(node));
}

/** The selection/transform rectangle for a text node, in its local space. */
export function textNodeLocalBounds(node: TextNodeLike): Rect {
  return textNodeGeometry(node).bounds;
}
