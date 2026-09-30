import type { Document, PatternFillData, SceneNode } from '@varve/scene';
import { resolveNodePaints } from '@varve/scene';

export interface PatternTileImportTarget {
  nodeId: string;
  sourceKey: string;
}

/** Capture the selected inline pattern fills that an opened file picker targets. */
export function capturePatternTileImportTargets(
  document: Document,
  nodeIds: readonly string[],
  fillIndex: number,
): PatternTileImportTarget[] {
  const seen = new Set<string>();
  const targets: PatternTileImportTarget[] = [];
  for (const nodeId of nodeIds) {
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    const node = document.nodes[nodeId];
    if (!node || node.paintRefs?.length) continue;
    const fill = resolveNodePaints(
      node as unknown as Parameters<typeof resolveNodePaints>[0],
      document,
    )[fillIndex];
    if (fill?.type !== 'pattern' || !fill.pattern || fill.pattern.definitionId) continue;
    targets.push({ nodeId, sourceKey: sourceKey(fill.pattern) });
  }
  return targets;
}

/**
 * Apply imported bytes only to the fills that opened the picker and whose
 * source has not changed since. Current placement fields are copied forward.
 */
export function applyPatternTileImport(
  document: Document,
  fillIndex: number,
  targets: readonly PatternTileImportTarget[],
  dataUrl: string,
): { document: Document; updatedCount: number } {
  const nextNodes = { ...document.nodes };
  let updatedCount = 0;
  for (const target of targets) {
    const node = document.nodes[target.nodeId];
    if (!node || node.paintRefs?.length) continue;
    const currentFills = resolveNodePaints(
      node as unknown as Parameters<typeof resolveNodePaints>[0],
      document,
    );
    const currentFill = currentFills[fillIndex];
    if (
      currentFill?.type !== 'pattern' ||
      !currentFill.pattern ||
      currentFill.pattern.definitionId ||
      sourceKey(currentFill.pattern) !== target.sourceKey
    ) {
      continue;
    }
    nextNodes[target.nodeId] = {
      ...node,
      fills: currentFills.map((fill, index) =>
        index === fillIndex && fill.type === 'pattern' && fill.pattern
          ? {
              ...fill,
              pattern: {
                ...fill.pattern,
                tileSrc: dataUrl,
                generator: undefined,
                logicalWidth: undefined,
                logicalHeight: undefined,
              },
            }
          : fill,
      ),
    } as SceneNode;
    updatedCount++;
  }
  return {
    document: updatedCount > 0 ? { ...document, nodes: nextNodes } : document,
    updatedCount,
  };
}

function sourceKey(pattern: PatternFillData): string {
  return JSON.stringify([pattern.definitionId ?? null, pattern.tileSrc, pattern.generator ?? null]);
}
