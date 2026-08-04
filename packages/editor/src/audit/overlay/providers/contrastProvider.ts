import type { Document, NodeId, SceneNode, TextNode } from '@varve/scene';
import { isContainer } from '@varve/scene';
import { contrastRatio, isLargeText, relativeLuminance, wcagLevel } from '@varve/shared';
import { BackgroundResolver } from '../../BackgroundResolver';
import type { AuditSeverity, OverlayContext, OverlayPrimitive, OverlayProvider } from '../types';

const OVERLAY_Z_ORDER = 10;

let sharedResolver: BackgroundResolver | null = null;
let lastDocument: Document | null = null;

function getResolver(doc: Document): BackgroundResolver {
  if (!sharedResolver || lastDocument !== doc) {
    sharedResolver = new BackgroundResolver();
    lastDocument = doc;
  }
  return sharedResolver;
}

function getTextColor(node: SceneNode): [number, number, number] | null {
  if (node.kind !== 'text') return null;
  const textNode = node as TextNode;
  const fill = textNode.fill;
  if (fill.space === 'rgb') {
    return [fill.r / 255, fill.g / 255, fill.b / 255];
  }
  if (fill.space === 'gray') {
    const v = fill.v / 255;
    return [v, v, v];
  }
  return null;
}

function getStrokeColor(node: SceneNode): [number, number, number] | null {
  if (!('strokes' in node) || !node.strokes) return null;
  for (const s of node.strokes) {
    if (!s.visible) continue;
    const c = s.color;
    if (c.space === 'rgb') return [c.r / 255, c.g / 255, c.b / 255];
    if (c.space === 'gray') {
      const v = c.v / 255;
      return [v, v, v];
    }
    return null;
  }
  return null;
}

interface ContrastFinding {
  badgeText: string;
  severity: AuditSeverity;
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  wcagRule: string;
}

function computeTextContrastFinding(
  node: SceneNode,
  doc: Document,
  nodeId: NodeId,
): ContrastFinding {
  const resolver = getResolver(doc);
  const result = resolver.resolve(doc, nodeId);

  const fg = getTextColor(node);
  const bg = result.color;

  const textNode = node as TextNode;
  const large = isLargeText(textNode.fontSize, textNode.fontWeight);

  if (!fg || !bg) {
    return {
      badgeText: 'Contrast: unknown',
      severity: 'advisory',
      confidence: 'unknown',
      wcagRule: 'WCAG 1.4.3',
    };
  }

  const fgLum = relativeLuminance(fg[0], fg[1], fg[2]);
  const bgLum = relativeLuminance(bg[0], bg[1], bg[2]);
  const ratio = contrastRatio(fgLum, bgLum);
  const level = wcagLevel(ratio, large);

  const ratioStr = ratio.toFixed(1);
  let severity: AuditSeverity;
  let levelLabel: string;

  if (level === 'FAIL') {
    severity = 'error';
    levelLabel = 'FAIL';
  } else if (level === 'AA') {
    severity = 'warning';
    levelLabel = 'AA';
  } else {
    severity = 'suggestion';
    levelLabel = 'AAA';
  }

  let badgeText = `Contrast: ${ratioStr}:1 (${levelLabel})`;
  if (result.confidence === 'low' || result.confidence === 'medium') {
    const reason = result.ambiguityReason ?? 'low confidence';
    badgeText += ` (low confidence - ${reason})`;
  }

  return {
    badgeText,
    severity,
    confidence: result.confidence,
    wcagRule: large ? 'WCAG 1.4.3 / 1.4.6' : 'WCAG 1.4.3',
  };
}

function computeNonTextContrastFinding(
  node: SceneNode,
  doc: Document,
  nodeId: NodeId,
): ContrastFinding | null {
  if (node.kind === 'text' || isContainer(node)) return null;

  const strokeColor = getStrokeColor(node);
  if (!strokeColor) return null;

  const resolver = getResolver(doc);
  const result = resolver.resolve(doc, nodeId);
  const bg = result.color;

  if (!bg) {
    return {
      badgeText: 'Non-text contrast: unknown',
      severity: 'advisory',
      confidence: 'unknown',
      wcagRule: 'WCAG 1.4.11',
    };
  }

  const strokeLum = relativeLuminance(strokeColor[0], strokeColor[1], strokeColor[2]);
  const bgLum = relativeLuminance(bg[0], bg[1], bg[2]);
  const ratio = contrastRatio(strokeLum, bgLum);

  const ratioStr = ratio.toFixed(1);

  if (ratio < 3) {
    return {
      badgeText: `Non-text contrast: ${ratioStr}:1 (FAIL)`,
      severity: 'error',
      confidence: result.confidence,
      wcagRule: 'WCAG 1.4.11',
    };
  }

  return null;
}

export function createContrastProvider(): OverlayProvider {
  return {
    id: 'contrast',
    label: 'Contrast Regions',
    zOrder: OVERLAY_Z_ORDER,
    interactive: false,
    enabled: true,
    getPrimitives(ctx: OverlayContext): OverlayPrimitive[] {
      const primitives: OverlayPrimitive[] = [];

      for (const [nodeId, node] of Object.entries(ctx.document.nodes)) {
        if (!node.visible) continue;
        if (ctx.hiddenNodeIds.has(nodeId)) continue;

        const bounds = ctx.getWorldBounds(nodeId);
        if (!bounds) continue;

        if (node.kind === 'text') {
          const finding = computeTextContrastFinding(node, ctx.document, nodeId);
          const color = getSeverityColor(finding.severity);

          primitives.push({
            kind: 'badge',
            anchor: [bounds.x, bounds.y - 8],
            text: finding.badgeText,
            severity: finding.severity,
            findingId: `contrast-${nodeId}`,
            screenSpaceSize: true,
          });

          primitives.push({
            kind: 'rect',
            bounds,
            style: {
              strokeColor: color,
              strokeWidth: 1.5,
              fillColor: color,
              fillOpacity: 0.06,
              dashPattern: [4, 3],
            },
            findingId: `contrast-${nodeId}`,
          });

          const resolver = getResolver(ctx.document);
          const result = resolver.resolve(ctx.document, nodeId);
          if (result.color) {
            const bgBounds = shrinkBounds(bounds, 2);
            primitives.push({
              kind: 'rect',
              bounds: bgBounds,
              style: {
                strokeColor: color,
                strokeWidth: 2,
                fillColor: color,
                fillOpacity: 0.1,
              },
              findingId: `contrast-${nodeId}-bg`,
            });
          }
        } else if (node.kind === 'shape') {
          const ntFinding = computeNonTextContrastFinding(node, ctx.document, nodeId);
          if (ntFinding) {
            const color = getSeverityColor(ntFinding.severity);
            primitives.push({
              kind: 'badge',
              anchor: [bounds.x, bounds.y - 8],
              text: ntFinding.badgeText,
              severity: ntFinding.severity,
              findingId: `non-text-contrast-${nodeId}`,
              screenSpaceSize: true,
            });
            primitives.push({
              kind: 'rect',
              bounds,
              style: {
                strokeColor: color,
                strokeWidth: 1.5,
                fillColor: color,
                fillOpacity: 0.06,
                dashPattern: [4, 3],
              },
              findingId: `non-text-contrast-${nodeId}`,
            });
          }
        }
      }

      return primitives;
    },
  };
}

function getSeverityColor(severity: AuditSeverity): string {
  switch (severity) {
    case 'error':
      return 'var(--color-feedback-danger, #d32f2f)';
    case 'warning':
      return 'var(--color-feedback-warning, #f57c00)';
    case 'suggestion':
      return 'var(--color-feedback-info, #1976d2)';
    case 'advisory':
      return 'var(--color-feedback-info, #1976d2)';
  }
}

function shrinkBounds(
  bounds: { x: number; y: number; w: number; h: number },
  px: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: bounds.x + px,
    y: bounds.y + px,
    w: Math.max(0, bounds.w - 2 * px),
    h: Math.max(0, bounds.h - 2 * px),
  };
}
