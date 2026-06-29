/**
 * SwiftUI target emitter.
 *
 * Research basis: SwiftUI View protocol (ZStack, frame, foregroundColor, font).
 */

import type { Document as SceneDocument, SceneNode } from '@strata/scene';
import { colorToHex, computeNodePos } from './shared';

export function exportNodeToSwiftUI(node: SceneNode, _doc?: SceneDocument): string {
  const pos = computeNodePos(node);
  const hex = colorToHex(node.fill).toUpperCase();
  const color = `Color(hex: "${hex}")`;

  if (node.kind === 'text') {
    return `Text("${node.text}")\n  .font(.system(size: ${node.fontSize ?? 16}))\n  .foregroundColor(${color})`;
  }

  return `${color}\n  .frame(width: ${pos.w}, height: ${pos.h})\n  .position(x: ${pos.x + pos.w / 2}, y: ${pos.y + pos.h / 2})`;
}
