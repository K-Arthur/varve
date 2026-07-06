/**
 * Flutter target emitter.
 *
 * Research basis: Flutter Widget library (Container, Positioned, Row, Column, Text).
 */

import type { Document as SceneDocument, SceneNode, TextNode, VariableStore } from '@strata/scene';
import type { TargetGap } from './types';
import { colorToHex, computeNodePos, getChildren } from './shared';
import { resolveTokenName } from './tokens';

export interface FlutterExportOptions {
  variableStore?: VariableStore;
}

function colorValue(node: SceneNode, opts?: FlutterExportOptions): string {
  const tokenName = opts?.variableStore
    ? resolveTokenName(node.bindings, 'fill', opts.variableStore)
    : undefined;
  if (tokenName) return `Theme.of(context).colorScheme.primary`;
  const hex = colorToHex(node.fill);
  return `Color(0xFF${hex.slice(1)})`;
}

function emitShape(node: SceneNode, depth: number, opts?: FlutterExportOptions): string {
  const pos = computeNodePos(node);
  return `${'  '.repeat(depth)}Positioned(\n${'  '.repeat(depth + 1)}left: ${pos.x},\n${'  '.repeat(depth + 1)}top: ${pos.y},\n${'  '.repeat(depth + 1)}child: Container(\n${'  '.repeat(depth + 2)}width: ${pos.w},\n${'  '.repeat(depth + 2)}height: ${pos.h},\n${'  '.repeat(depth + 2)}color: ${colorValue(node, opts)},\n${'  '.repeat(depth + 1)}),\n${'  '.repeat(depth)});`;
}

function emitText(node: TextNode, depth: number, opts?: FlutterExportOptions): string {
  const colorText = colorValue(node, opts);
  return `${'  '.repeat(depth)}Text(\n${'  '.repeat(depth + 1)}'${node.text}',\n${'  '.repeat(depth + 1)}style: TextStyle(\n${'  '.repeat(depth + 2)}fontSize: ${node.fontSize ?? 16},\n${'  '.repeat(depth + 2)}color: ${colorText},\n${'  '.repeat(depth + 1)}),\n${'  '.repeat(depth)});`;
}

function emitContainer(
  node: SceneNode,
  doc: SceneDocument,
  depth: number,
  opts?: FlutterExportOptions,
): string {
  const children = getChildren(doc, node);
  const body = children.map((child) => emitNode(child, doc, depth + 2, opts)).join(',\n');

  if (node.kind === 'frame' && node.layoutStyle) {
    const ls = node.layoutStyle;
    const widget = ls.direction === 'row' ? 'Row' : 'Column';
    const props: string[] = [];
    if (ls.gap > 0) {
      props.push(`${'  '.repeat(1)}spacing: ${ls.gap},`);
    }
    if (ls.padding?.some((v) => v !== 0)) {
      props.push(
        `${'  '.repeat(1)}padding: EdgeInsets.fromLTRB(${ls.padding[3]}, ${ls.padding[0]}, ${ls.padding[1]}, ${ls.padding[2]}),`,
      );
    }
    props.push(`${'  '.repeat(1)}children: [\n${body}\n${'  '.repeat(1)}],`);
    return `${'  '.repeat(depth)}${widget}(\n${props.join('\n')}\n${'  '.repeat(depth)});`;
  }

  if (children.length === 0) {
    const pos = computeNodePos(node);
    return `${'  '.repeat(depth)}Container(\n${'  '.repeat(depth + 1)}width: ${pos.w},\n${'  '.repeat(depth + 1)}height: ${pos.h},\n${'  '.repeat(depth + 1)}color: ${colorValue(node, opts)},\n${'  '.repeat(depth)});`;
  }

  return `${'  '.repeat(depth)}Stack(\n${'  '.repeat(depth + 1)}children: [\n${body}\n${'  '.repeat(depth + 1)}],\n${'  '.repeat(depth)});`;
}

function emitNode(
  node: SceneNode,
  doc: SceneDocument,
  depth: number,
  opts?: FlutterExportOptions,
): string {
  if (node.kind === 'text') return emitText(node, depth, opts);
  if (node.kind === 'frame' || node.kind === 'group') {
    return emitContainer(node, doc, depth, opts);
  }
  return emitShape(node, depth, opts);
}

export function exportNodeToFlutter(
  node: SceneNode,
  doc?: SceneDocument,
  opts?: FlutterExportOptions,
): string {
  const effectiveDoc = doc ?? ({ nodes: {}, rootChildren: [] } as unknown as SceneDocument);
  return emitNode(node, effectiveDoc, 0, opts);
}

/**
 * Report features used by `node` that Flutter widgets cannot represent
 * without custom code (CustomPainter, ShaderMask, BackdropFilter, etc.).
 */
export function flutterTargetGaps(node: SceneNode, _doc: SceneDocument): TargetGap[] {
  const gaps: TargetGap[] = [];

  if (node.kind === 'image') {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'image node',
      severity: 'warning',
      fallback: 'Use Image.network() or Image.asset() in Flutter',
    });
  }

  if (node.kind === 'shape' && node.shape.kind !== 'rect' && node.shape.kind !== 'ellipse') {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: `non-standard shape (${node.shape.kind})`,
      severity: 'error',
      fallback: 'Use CustomPainter with Canvas.drawPath()',
    });
  }

  const fills = node.fills ?? [];
  if (fills.some((f) => f.type === 'gradient')) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'gradient fill',
      severity: 'warning',
      fallback: 'Use DecoratedBox with BoxDecoration(gradient: LinearGradient(...))',
    });
  }

  const effects = (node.kind === 'shape' || node.kind === 'text' || node.kind === 'frame' || node.kind === 'group')
    ? (node.effects ?? [])
    : [];
  if (effects.some((e) => e.type === 'backgroundBlur')) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'background blur effect',
      severity: 'warning',
      fallback: 'Use BackdropFilter(filter: ImageFilter.blur(...))',
    });
  }
  if (effects.some((e) => e.type === 'layerBlur')) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'layer blur effect',
      severity: 'warning',
      fallback: 'Use ImageFilter.blur() wrapped in a BackdropFilter widget',
    });
  }

  return gaps;
}
