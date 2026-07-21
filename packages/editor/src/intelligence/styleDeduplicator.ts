import type { Document, NodeId, Style } from '@strata/scene';
import { getNodesUsingStyle } from '@strata/scene';

export interface StyleMergeSuggestion {
  sourceStyleId: string;
  targetStyleId: string;
  usageCount: number;
  canAutoMerge: boolean;
}

function styleContentKey(style: Style): string {
  switch (style.type) {
    case 'color':
      return JSON.stringify({ type: 'color', fill: style.fill });
    case 'text':
      return JSON.stringify({
        type: 'text',
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        fontStyle: style.fontStyle,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        paragraphSpacing: style.paragraphSpacing,
        textAlign: style.textAlign,
        textAlignVertical: style.textAlignVertical,
        textCase: style.textCase,
        textDecoration: style.textDecoration,
        listStyle: style.listStyle,
      });
    case 'effect':
      return JSON.stringify({ type: 'effect', effects: style.effects });
    case 'layout':
      return JSON.stringify({ type: 'layout', layout: style.layout });
  }
}

export function findDuplicateStyles(doc: Document): StyleMergeSuggestion[] {
  if (!doc.styles) return [];

  const styles = Object.values(doc.styles);
  const suggestions: StyleMergeSuggestion[] = [];
  const processed = new Set<NodeId>();

  for (let i = 0; i < styles.length; i++) {
    const a = styles[i]!;
    if (processed.has(a.id)) continue;

    const aKey = styleContentKey(a);

    for (let j = i + 1; j < styles.length; j++) {
      const b = styles[j]!;
      if (processed.has(b.id)) continue;

      const bKey = styleContentKey(b);
      if (aKey !== bKey) continue;

      const nodesA = getNodesUsingStyle(doc, a.id);
      const nodesB = getNodesUsingStyle(doc, b.id);

      const source = nodesA.length <= nodesB.length ? a : b;
      const target: typeof a = nodesA.length <= nodesB.length ? b : a;
      const usageCount = nodesA.length + nodesB.length;

      processed.add(a.id);
      processed.add(b.id);

      suggestions.push({
        sourceStyleId: source.id,
        targetStyleId: target.id,
        usageCount,
        canAutoMerge: true,
      });

      break;
    }
  }

  return suggestions;
}
