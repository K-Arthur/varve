import type { Affine } from '@strata/engine';
import type { Document, SceneNode } from '@strata/scene';
import {
  createDocument,
  deepCloneSubtree,
  imageShapeH,
  imageShapeW,
  isImageShape,
} from '@strata/scene';
import { getParserForData, getParserForExtension } from './registry';
import type { BatchFileResult } from './types';

export interface BatchImportOptions {
  files: { name: string; data: string | Uint8Array }[];
  targetPosition?: { x: number; y: number };
  spacing?: number;
  importInPlace?: boolean;
  onProgress?: (completed: number, total: number) => void;
}

export interface BatchImportResult {
  document: Document;
  nodeIds: string[];
  results: BatchFileResult[];
  successCount: number;
  failCount: number;
  warnings: string[];
}

export function batchImport(
  files: { name: string; data: string | Uint8Array }[],
  options?: Partial<BatchImportOptions>,
): BatchImportResult {
  const opts = {
    targetPosition: options?.targetPosition ?? undefined,
    spacing: options?.spacing ?? 50,
    importInPlace: options?.importInPlace ?? false,
    onProgress: options?.onProgress,
  };

  let doc = createDocument('Batch Import');
  const nodeIds: string[] = [];
  const results: BatchFileResult[] = [];
  const globalWarnings: string[] = [];
  let successCount = 0;
  let failCount = 0;

  let offsetX = opts.targetPosition?.x ?? 0;
  const baseY = opts.targetPosition?.y ?? 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    try {
      const ext = file.name.split('.').pop() ?? '';
      const parser = getParserForExtension(ext) ?? getParserForData(file.data);

      if (!parser) {
        results.push({
          name: file.name,
          success: false,
          warnings: [`No parser found for format: ${ext}`],
          nodeIds: [],
        });
        failCount++;
        opts.onProgress?.(i + 1, files.length);
        continue;
      }

      const importResult = parser.parse(file.data);

      if (!opts.importInPlace && importResult.nodeIds.length > 0) {
        let maxW = 0;
        for (const nid of importResult.nodeIds) {
          const node = importResult.document.nodes[nid];
          if (!node) continue;
          const bounds = getNodeBounds(node);
          const movedNode = {
            ...node,
            transform: [
              node.transform[0],
              node.transform[1],
              node.transform[2],
              node.transform[3],
              (node.transform[4] ?? 0) + offsetX,
              (node.transform[5] ?? 0) + baseY,
            ] as Affine,
          } as SceneNode;
          importResult.document.nodes[nid] = movedNode;
          maxW = Math.max(maxW, bounds.w);
        }
        offsetX += maxW + opts.spacing;
      }

      const idMap = new Map<string, string>();
      for (const nid of importResult.nodeIds) {
        if (!importResult.document.nodes[nid]) continue;
        const cloned = deepCloneSubtree(importResult.document.nodes, doc.nextId, nid);
        if (Object.keys(cloned.nodes).length === 0) continue;
        // For paged documents, add to the active page's contentRoot so the
        // node is visible to the page-scoped renderer. Adding to rootChildren
        // bypasses the page system and the node is never traversed.
        const activePage = doc.pages?.find((p) => p.id === doc.activePageId);
        const contentRootId = activePage?.contentRoot;
        if (contentRootId && doc.nodes[contentRootId]) {
          const cr = doc.nodes[contentRootId] as { children?: string[] };
          const crChildren = cr.children ?? [];
          doc = {
            ...doc,
            nextId: cloned.nextId,
            rootChildren: doc.rootChildren,
            nodes: {
              ...doc.nodes,
              ...cloned.nodes,
              [contentRootId]: {
                ...doc.nodes[contentRootId],
                children: [...crChildren, cloned.rootId],
              } as (typeof doc.nodes)[string],
            },
          };
        } else {
          doc = {
            ...doc,
            nextId: cloned.nextId,
            rootChildren: [...doc.rootChildren, cloned.rootId],
            nodes: { ...doc.nodes, ...cloned.nodes },
          };
        }
        for (const [oldId, newId] of cloned.idMap) idMap.set(oldId, newId);
        nodeIds.push(cloned.rootId);
      }

      successCount++;
      globalWarnings.push(...importResult.warnings.map((w) => `${file.name}: ${w}`));
      results.push({
        name: file.name,
        success: true,
        warnings: importResult.warnings,
        nodeIds: importResult.nodeIds.map((nid) => idMap.get(nid) ?? nid),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      globalWarnings.push(`${file.name}: ${msg}`);
      results.push({
        name: file.name,
        success: false,
        warnings: [msg],
        nodeIds: [],
      });
      failCount++;
    }

    opts.onProgress?.(i + 1, files.length);
  }

  return {
    document: doc,
    nodeIds,
    results,
    successCount,
    failCount,
    warnings: globalWarnings,
  };
}

function getNodeBounds(node: SceneNode): { w: number; h: number } {
  if (node.kind === 'shape') {
    if (isImageShape(node)) {
      return { w: imageShapeW(node), h: imageShapeH(node) };
    }
    const s = node.shape;
    switch (s.kind) {
      case 'rect':
        return { w: s.w, h: s.h };
      case 'circle':
        return { w: s.r * 2, h: s.r * 2 };
      case 'ellipse':
        return { w: s.rx * 2, h: s.ry * 2 };
      case 'polygon':
        return { w: s.radius * 2, h: s.radius * 2 };
      case 'star':
        return { w: s.outerRadius * 2, h: s.outerRadius * 2 };
      case 'line':
      case 'arrow': {
        const dw = Math.abs(s.to[0] - s.from[0]) || 4;
        const dh = Math.abs(s.to[1] - s.from[1]) || 4;
        return { w: dw, h: dh };
      }
      case 'path': {
        if (s.points.length === 0) return { w: 10, h: 10 };
        const xs = s.points.map((p) => p.x);
        const ys = s.points.map((p) => p.y);
        return {
          w: Math.max(...xs) - Math.min(...xs) || 10,
          h: Math.max(...ys) - Math.min(...ys) || 10,
        };
      }
    }
  }
  if (node.kind === 'text') {
    const fs = node.fontSize ?? 16;
    return { w: fs * 6, h: fs * 1.4 };
  }
  if (node.kind === 'frame') {
    return { w: node.w ?? 100, h: node.h ?? 100 };
  }
  if (node.kind === 'group') {
    return { w: 100, h: 100 };
  }
  return { w: 100, h: 100 };
}
