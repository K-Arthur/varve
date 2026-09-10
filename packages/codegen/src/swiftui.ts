/**
 * SwiftUI target emitter.
 *
 * Research basis: SwiftUI View protocol (ZStack, HStack, VStack, frame, foregroundColor, font).
 */

import type { Document as SceneDocument, SceneNode, TextNode, VariableStore } from '@varve/scene';
import { isImageShape } from '@varve/scene';
import { adjustmentStackTargetGaps, colorToHex, computeNodePos, getChildren } from './shared';
import { resolveTokenName } from './tokens';
import type { TargetGap } from './types';

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

function emitContainer(
  node: SceneNode,
  doc: SceneDocument,
  depth: number,
  opts?: SwiftUIExportOptions,
): string {
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

function emitNode(
  node: SceneNode,
  doc: SceneDocument,
  depth: number,
  opts?: SwiftUIExportOptions,
): string {
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

/**
 * Report features used by `node` that SwiftUI views cannot represent
 * without custom Path/Shape code or additional modifiers.
 */
export function swiftuiTargetGaps(node: SceneNode, _doc: SceneDocument): TargetGap[] {
  const gaps: TargetGap[] = [...adjustmentStackTargetGaps(node)];

  if (isImageShape(node)) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'image node',
      severity: 'warning',
      fallback: 'Use Image("assetName") or AsyncImage(url:) in SwiftUI',
    });
  }

  if (node.kind === 'shape' && node.shape.kind !== 'rect' && node.shape.kind !== 'ellipse') {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: `non-standard shape (${node.shape.kind})`,
      severity: 'warning',
      fallback: 'Implement a custom Shape with a Path { path in ... } body',
    });
  }

  const fills = node.fills ?? [];
  if (fills.some((f) => f.type === 'gradient')) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'gradient fill',
      severity: 'warning',
      fallback: 'Use .overlay(LinearGradient(...)) or .background(gradient)',
    });
  }

  const effects =
    node.kind === 'shape' || node.kind === 'text' || node.kind === 'frame' || node.kind === 'group'
      ? (node.effects ?? [])
      : [];
  if (effects.some((e) => e.type === 'backgroundBlur')) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'background blur effect',
      severity: 'warning',
      fallback: 'Use .background(.ultraThinMaterial) or UIVisualEffectView',
    });
  }
  if (effects.some((e) => e.type === 'dropShadow')) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'drop shadow',
      severity: 'warning',
      fallback: 'Use .shadow(color:radius:x:y:) modifier',
    });
  }

  return gaps;
}
