/**
 * Flutter target emitter.
 *
 * Research basis: Flutter Widget library (Container, Positioned, Row, Column, Text).
 */

import type { Document as SceneDocument, SceneNode } from '@strata/scene';
import { colorToHex, computeNodePos } from './shared';

export function exportNodeToFlutter(node: SceneNode, _doc?: SceneDocument): string {
  const pos = computeNodePos(node);
  const hex = colorToHex(node.fill);
  const colorText = `Color(0xFF${hex.slice(1)})`;

  if (node.kind === 'text') {
    return `Text(\n  '${node.text}',\n  style: TextStyle(\n    fontSize: ${node.fontSize ?? 16},\n    color: ${colorText},\n  ),\n);`;
  }

  return `Positioned(\n  left: ${pos.x},\n  top: ${pos.y},\n  child: Container(\n    width: ${pos.w},\n    height: ${pos.h},\n    color: ${colorText},\n  ),\n);`;
}
