/**
 * SwiftUI target emitter.
 *
 * Research basis: SwiftUI View protocol (ZStack, HStack, VStack, frame, foregroundColor, font).
 */

import type { Document as SceneDocument, SceneNode, TextNode } from '@strata/scene';
import { colorToHex, computeNodePos, getChildren } from './shared';

function colorValue(node: SceneNode): string {
  const hex = colorToHex(node.fill).toUpperCase();
  return `Color(hex: "${hex}")`;
}

function emitShape(node: SceneNode, depth: number): string {
  const pos = computeNodePos(node);
  const color = colorValue(node);
  return `${'  '.repeat(depth)}${color}\n${'  '.repeat(depth)}  .frame(width: ${pos.w}, height: ${pos.h})\n${'  '.repeat(depth)}  .position(x: ${pos.x + pos.w / 2}, y: ${pos.y + pos.h / 2})`;
}

function emitText(node: TextNode, depth: number): string {
  const hex = colorToHex(node.fill).toUpperCase();
  const color = `Color(hex: "${hex}")`;
  return `${'  '.repeat(depth)}Text("${node.text}")\n${'  '.repeat(depth)}  .font(.system(size: ${node.fontSize ?? 16}))\n${'  '.repeat(depth)}  .foregroundColor(${color})`;
}

function emitContainer(node: SceneNode, doc: SceneDocument, depth: number): string {
  const children = getChildren(doc, node);
  const body = children.map((child) => emitNode(child, doc, depth + 1)).join('\n');

  if (node.kind === 'frame' && node.layoutStyle) {
    const ls = node.layoutStyle;
    let result = '';
    if (ls.padding?.some((v) => v !== 0)) {
      const [t, r, b, l] = ls.padding;
      result += `${'  '.repeat(depth)}.padding(EdgeInsets(top: ${t}, leading: ${l}, bottom: ${b}, trailing: ${r}))\n`;
    }
    if (ls.direction === 'row') {
      const spacing = ls.gap > 0 ? `spacing: ${ls.gap}` : '';
      result = `HStack(${spacing}) {\n${body}\n${'  '.repeat(depth)}}${result ? `\n${result}` : ''}`;
    } else {
      const spacing = ls.gap > 0 ? `spacing: ${ls.gap}` : '';
      result = `VStack(${spacing}) {\n${body}\n${'  '.repeat(depth)}}${result ? `\n${result}` : ''}`;
    }
    return `${'  '.repeat(depth)}${result}`;
  }

  if (children.length === 0) {
    const pos = computeNodePos(node);
    const color = colorValue(node);
    return `${'  '.repeat(depth)}${color}\n${'  '.repeat(depth)}  .frame(width: ${pos.w}, height: ${pos.h})`;
  }

  return `${'  '.repeat(depth)}ZStack {\n${body}\n${'  '.repeat(depth)}}`;
}

function emitNode(node: SceneNode, doc: SceneDocument, depth: number): string {
  if (node.kind === 'text') return emitText(node, depth);
  if (node.kind === 'frame' || node.kind === 'group') {
    return emitContainer(node, doc, depth);
  }
  return emitShape(node, depth);
}

export function exportNodeToSwiftUI(node: SceneNode, doc?: SceneDocument): string {
  const effectiveDoc = doc ?? ({ nodes: {}, rootChildren: [] } as unknown as SceneDocument);
  return emitNode(node, effectiveDoc, 0);
}
