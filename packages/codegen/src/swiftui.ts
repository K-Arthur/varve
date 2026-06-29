/**
 * SwiftUI target emitter.
 *
 * Research basis: SwiftUI View protocol (ZStack, HStack, VStack, frame, foregroundColor, font).
 */

import type { Document as SceneDocument, SceneNode, TextNode, VariableStore } from '@strata/scene';
import { colorToHex, computeNodePos, getChildren } from './shared';
import { resolveTokenName } from './tokens';

export interface SwiftUIExportOptions {
  variableStore?: VariableStore;
}

function colorValue(node: SceneNode, opts?: SwiftUIExportOptions): string {
  const tokenName = opts?.variableStore
    ? resolveTokenName(node.bindings, 'fill', opts.variableStore)
    : undefined;
  if (tokenName) return `Color("${tokenName}")`;
  const hex = colorToHex(node.fill).toUpperCase();
  return `Color(hex: "${hex}")`;
}

function emitShape(node: SceneNode, depth: number, opts?: SwiftUIExportOptions): string {
  const pos = computeNodePos(node);
  const color = colorValue(node, opts);
  return `${'  '.repeat(depth)}${color}\n${'  '.repeat(depth)}  .frame(width: ${pos.w}, height: ${pos.h})\n${'  '.repeat(depth)}  .position(x: ${pos.x + pos.w / 2}, y: ${pos.y + pos.h / 2})`;
}

function emitText(node: TextNode, depth: number, opts?: SwiftUIExportOptions): string {
  const color = colorValue(node, opts);
  return `${'  '.repeat(depth)}Text("${node.text}")\n${'  '.repeat(depth)}  .font(.system(size: ${node.fontSize ?? 16}))\n${'  '.repeat(depth)}  .foregroundColor(${color})`;
}

function emitContainer(node: SceneNode, doc: SceneDocument, depth: number, opts?: SwiftUIExportOptions): string {
  const children = getChildren(doc, node);
  const body = children.map((child) => emitNode(child, doc, depth + 1, opts)).join('\n');

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
    const color = colorValue(node, opts);
    return `${'  '.repeat(depth)}${color}\n${'  '.repeat(depth)}  .frame(width: ${pos.w}, height: ${pos.h})`;
  }

  return `${'  '.repeat(depth)}ZStack {\n${body}\n${'  '.repeat(depth)}}`;
}

function emitNode(node: SceneNode, doc: SceneDocument, depth: number, opts?: SwiftUIExportOptions): string {
  if (node.kind === 'text') return emitText(node, depth, opts);
  if (node.kind === 'frame' || node.kind === 'group') {
    return emitContainer(node, doc, depth, opts);
  }
  return emitShape(node, depth, opts);
}

export function exportNodeToSwiftUI(
  node: SceneNode,
  doc?: SceneDocument,
  opts?: SwiftUIExportOptions,
): string {
  const effectiveDoc = doc ?? ({ nodes: {}, rootChildren: [] } as unknown as SceneDocument);
  return emitNode(node, effectiveDoc, 0, opts);
}
