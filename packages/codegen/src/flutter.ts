/**
 * Flutter target emitter.
 *
 * Research basis: Flutter Widget library (Container, Positioned, Row, Column, Text).
 */

import type { Document as SceneDocument, SceneNode, TextNode } from '@strata/scene';
import { colorToHex, computeNodePos, getChildren } from './shared';

function colorValue(node: SceneNode): string {
  const hex = colorToHex(node.fill);
  return `Color(0xFF${hex.slice(1)})`;
}

function emitShape(node: SceneNode, depth: number): string {
  const pos = computeNodePos(node);
  return `${'  '.repeat(depth)}Positioned(\n${'  '.repeat(depth + 1)}left: ${pos.x},\n${'  '.repeat(depth + 1)}top: ${pos.y},\n${'  '.repeat(depth + 1)}child: Container(\n${'  '.repeat(depth + 2)}width: ${pos.w},\n${'  '.repeat(depth + 2)}height: ${pos.h},\n${'  '.repeat(depth + 2)}color: ${colorValue(node)},\n${'  '.repeat(depth + 1)}),\n${'  '.repeat(depth)});`;
}

function emitText(node: TextNode, depth: number): string {
  const hex = colorToHex(node.fill);
  const colorText = `Color(0xFF${hex.slice(1)})`;
  return `${'  '.repeat(depth)}Text(\n${'  '.repeat(depth + 1)}'${node.text}',\n${'  '.repeat(depth + 1)}style: TextStyle(\n${'  '.repeat(depth + 2)}fontSize: ${node.fontSize ?? 16},\n${'  '.repeat(depth + 2)}color: ${colorText},\n${'  '.repeat(depth + 1)}),\n${'  '.repeat(depth)});`;
}

function emitContainer(
  node: SceneNode,
  doc: SceneDocument,
  depth: number,
): string {
  const children = getChildren(doc, node);
  const body = children.map((child) => emitNode(child, doc, depth + 2)).join(',\n');

  if (node.kind === 'frame' && node.layoutStyle) {
    const ls = node.layoutStyle;
    const widget = ls.direction === 'row' ? 'Row' : 'Column';
    const props: string[] = [];
    if (ls.gap > 0) {
      props.push(`${'  '.repeat(1)}spacing: ${ls.gap},`);
    }
    if (ls.padding && ls.padding.some((v) => v !== 0)) {
      props.push(`${'  '.repeat(1)}padding: EdgeInsets.fromLTRB(${ls.padding[3]}, ${ls.padding[0]}, ${ls.padding[1]}, ${ls.padding[2]}),`);
    }
    props.push(`${'  '.repeat(1)}children: [\n${body}\n${'  '.repeat(1)}],`);
    return `${'  '.repeat(depth)}${widget}(\n${props.join('\n')}\n${'  '.repeat(depth)});`;
  }

  if (children.length === 0) {
    const pos = computeNodePos(node);
    return `${'  '.repeat(depth)}Container(\n${'  '.repeat(depth + 1)}width: ${pos.w},\n${'  '.repeat(depth + 1)}height: ${pos.h},\n${'  '.repeat(depth + 1)}color: ${colorValue(node)},\n${'  '.repeat(depth)});`;
  }

  return `${'  '.repeat(depth)}Stack(\n${'  '.repeat(depth + 1)}children: [\n${body}\n${'  '.repeat(depth + 1)}],\n${'  '.repeat(depth)});`;
}

function emitNode(
  node: SceneNode,
  doc: SceneDocument,
  depth: number,
): string {
  if (node.kind === 'text') return emitText(node, depth);
  if (node.kind === 'frame' || node.kind === 'group') {
    return emitContainer(node, doc, depth);
  }
  return emitShape(node, depth);
}

export function exportNodeToFlutter(node: SceneNode, doc?: SceneDocument): string {
  const effectiveDoc = doc ?? ({ nodes: {}, rootChildren: [] } as unknown as SceneDocument);
  return emitNode(node, effectiveDoc, 0);
}
