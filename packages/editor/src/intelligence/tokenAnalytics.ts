import type { Document, SceneNode } from '@strata/scene';

export interface TokenCoverageReport {
  overall: number;
  byCategory: {
    colors: number;
    spacing: number;
    fonts: number;
  };
  totalNodes: number;
  tokenizedNodes: number;
}

const TYPE_SCALE = new Set([12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72, 80]);

function hasSwatchFill(node: SceneNode, doc: Document): boolean {
  if (!doc.swatches || doc.swatches.length === 0) return false;

  const swatchColors = doc.swatches.map((s) => s.color);

  function matchesSwatch(c: unknown): boolean {
    if (!c || typeof c !== 'object') return false;
    const col = c as { space?: string; r?: number; g?: number; b?: number };
    if (col.space === 'rgb' && col.r !== undefined && col.g !== undefined && col.b !== undefined) {
      return swatchColors.some((sc) => {
        if (sc.space !== 'rgb') return false;
        return sc.r === col.r && sc.g === col.g && sc.b === col.b;
      });
    }
    return false;
  }

  if ('fills' in node) {
    const fills = node.fills as Array<{ color?: unknown }> | undefined;
    if (fills && fills.length > 0) {
      for (const f of fills) {
        if (f.color && matchesSwatch(f.color)) return true;
      }
    }
  }

  if ('fill' in node) {
    if (matchesSwatch(node.fill)) return true;
  }

  return false;
}

function hasTokenSpacing(node: SceneNode): boolean {
  if (node.kind !== 'frame') return false;

  const layoutStyle = (node as { layoutStyle?: { gap?: number; padding?: number[] } }).layoutStyle;
  if (!layoutStyle) return false;

  const gap = layoutStyle.gap;
  if (gap !== undefined && gap > 0 && gap % 4 !== 0) return false;

  const padding = layoutStyle.padding;
  if (padding) {
    for (const p of padding) {
      if (p > 0 && p % 4 !== 0) return false;
    }
  }

  return gap !== undefined || (padding?.some((p) => p > 0) ?? false);
}

function hasTokenFont(node: SceneNode): boolean {
  if (node.kind !== 'text') return false;
  const fontSize = (node as { fontSize: number }).fontSize;
  return TYPE_SCALE.has(fontSize);
}

export function computeTokenCoverage(doc: Document): TokenCoverageReport {
  const nodes = Object.values(doc.nodes);
  const totalNodes = nodes.length;

  if (totalNodes === 0) {
    return {
      overall: 0,
      byCategory: { colors: 0, spacing: 0, fonts: 0 },
      totalNodes: 0,
      tokenizedNodes: 0,
    };
  }

  const colorNodes = nodes.filter((n) => hasSwatchFill(n, doc)).length;
  const spacingNodes = nodes.filter((n) => hasTokenSpacing(n)).length;
  const fontNodes = nodes.filter((n) => hasTokenFont(n)).length;

  const colorDenom = nodes.length;
  const spacingDenom = nodes.filter((n) => n.kind === 'frame' && 'layoutStyle' in n).length || 1;
  const fontDenom = nodes.filter((n) => n.kind === 'text').length || 1;

  const colors = colorNodes / colorDenom;
  const spacing = spacingNodes / spacingDenom;
  const fonts = fontNodes / fontDenom;

  const tokenizedNodes = nodes.filter(
    (n) => hasSwatchFill(n, doc) || hasTokenSpacing(n) || hasTokenFont(n),
  ).length;

  const overall = tokenizedNodes / totalNodes;

  return {
    overall,
    byCategory: {
      colors: Math.min(1, colors),
      spacing: Math.min(1, spacing),
      fonts: Math.min(1, fonts),
    },
    totalNodes,
    tokenizedNodes,
  };
}
