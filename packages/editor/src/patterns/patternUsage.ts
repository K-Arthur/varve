import type { Document } from '@varve/scene';
import { resolveNodePaints } from '@varve/scene';

/** Count live object fills and each nested definition edge once. */
export function countPatternUses(document: Document, definitionId: string): number {
  let count = 0;
  const scan = (fills: readonly import('@varve/scene').Fill[] | undefined) => {
    for (const fill of fills ?? []) {
      if (fill.type === 'pattern' && fill.pattern?.definitionId === definitionId) count += 1;
    }
  };

  const referencedPaintIds = new Set<string>();
  for (const node of Object.values(document.nodes)) {
    for (const paintId of node.paintRefs ?? []) referencedPaintIds.add(paintId);
    scan(resolveNodePaints(node as unknown as Parameters<typeof resolveNodePaints>[0], document));
  }
  for (const paint of Object.values(document.paints ?? {})) {
    if (!referencedPaintIds.has(paint.id)) scan([paint.fill]);
  }

  for (const definition of Object.values(document.patternDefinitions ?? {})) {
    const nestedDefinitions = new Set(definition.dependencyPatternIds ?? []);
    if (definition.source.kind === 'vector') {
      for (const node of Object.values(definition.source.nodes)) {
        for (const fill of node.fills ?? []) {
          if (fill.type === 'pattern' && fill.pattern?.definitionId) {
            nestedDefinitions.add(fill.pattern.definitionId);
          }
        }
      }
    }
    if (nestedDefinitions.has(definitionId)) count += 1;
  }

  return count;
}
