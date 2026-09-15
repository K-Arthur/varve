import type { Affine } from '@varve/engine';
import { createDocument, makeGroupNode, makeShapeNode } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { batchImport } from './batch';
import { registerParser, resetRegistry } from './registry';
import type { ImportParser } from './types';

function makeTestParser(
  format: string,
  extensions: string[],
  canParseFn?: (data: string | Uint8Array) => boolean,
): ImportParser {
  return {
    format,
    supportedExtensions: () => extensions,
    canParse: canParseFn ?? (() => false),
    parse: (_data, _opts) => {
      const doc = createDocument(`Test ${format}`);
      const node = makeShapeNode(
        '',
        { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
        {
          name: `${format}-node`,
          fill: { space: 'rgb' as const, r: 200, g: 50, b: 50, a: 255 },
          transform: [1, 0, 0, 1, 0, 0] as Affine,
        },
      );
      return {
        document: {
          ...doc,
          rootChildren: [...doc.rootChildren, node.id],
          nodes: { ...doc.nodes, [node.id]: node },
        },
        nodeIds: [node.id],
        warnings: [],
      };
    },
  };
}

function makeFailingParser(format: string, extensions: string[]): ImportParser {
  return {
    format,
    supportedExtensions: () => extensions,
    canParse: () => false,
    parse: () => {
      throw new Error('Parse failed');
    },
  };
}

describe('batchImport', () => {
  it('imports batch of SVG files successfully', () => {
    resetRegistry();
    registerParser(makeTestParser('svg', ['svg']));
    const result = batchImport([
      { name: 'a.svg', data: '<svg></svg>' },
      { name: 'b.svg', data: '<svg></svg>' },
      { name: 'c.svg', data: '<svg></svg>' },
    ]);
    expect(result.successCount).toBe(3);
    expect(result.failCount).toBe(0);
    expect(result.nodeIds.length).toBe(3);
    expect(result.results.length).toBe(3);
    expect(result.results.every((r) => r.success)).toBe(true);
  });

  it('handles mixed success and failure', () => {
    resetRegistry();
    registerParser(makeTestParser('svg', ['svg']));
    registerParser(makeFailingParser('bad', ['bad']));
    const result = batchImport([
      { name: 'a.svg', data: '<svg></svg>' },
      { name: 'b.bad', data: new Uint8Array([0, 0]) },
      { name: 'c.svg', data: '<svg></svg>' },
      { name: 'd.bad', data: new Uint8Array([0, 0]) },
      { name: 'e.svg', data: '<svg></svg>' },
    ]);
    expect(result.successCount).toBe(3);
    expect(result.failCount).toBe(2);
    expect(result.nodeIds.length).toBe(3);
    expect(result.results[1]?.success).toBe(false);
    expect(result.results[3]?.success).toBe(false);
  });

  it('places nodes with position offset', () => {
    resetRegistry();
    registerParser(makeTestParser('svg', ['svg']));
    const result = batchImport(
      [
        { name: 'a.svg', data: '<svg></svg>' },
        { name: 'b.svg', data: '<svg></svg>' },
      ],
      { targetPosition: { x: 100, y: 200 } },
    );
    expect(result.successCount).toBe(2);
    const nodeA = result.document.nodes[result.nodeIds[0]!];
    const nodeB = result.document.nodes[result.nodeIds[1]!];
    expect(nodeA?.transform[4]).toBe(100);
    expect(nodeA?.transform[5]).toBe(200);
    expect(nodeB?.transform[4]).toBe(200);
    expect(nodeB?.transform[5]).toBe(200);
  });

  it('applies custom spacing between nodes', () => {
    resetRegistry();
    registerParser(makeTestParser('svg', ['svg']));
    const result = batchImport(
      [
        { name: 'a.svg', data: '<svg></svg>' },
        { name: 'b.svg', data: '<svg></svg>' },
        { name: 'c.svg', data: '<svg></svg>' },
      ],
      { targetPosition: { x: 0, y: 0 }, spacing: 100 },
    );
    expect(result.successCount).toBe(3);
    expect(result.document.nodes[result.nodeIds[0]!]?.transform[4]).toBe(0);
    expect(result.document.nodes[result.nodeIds[1]!]?.transform[4]).toBe(150);
    expect(result.document.nodes[result.nodeIds[2]!]?.transform[4]).toBe(300);
  });

  it('returns empty document for empty batch', () => {
    resetRegistry();
    const result = batchImport([]);
    expect(result.successCount).toBe(0);
    expect(result.failCount).toBe(0);
    expect(result.nodeIds.length).toBe(0);
    expect(result.results.length).toBe(0);
  });

  it('calls progress callback for each file', () => {
    resetRegistry();
    registerParser(makeTestParser('svg', ['svg']));
    const progress = vi.fn();
    batchImport(
      [
        { name: 'a.svg', data: '<svg></svg>' },
        { name: 'b.svg', data: '<svg></svg>' },
        { name: 'c.svg', data: '<svg></svg>' },
      ],
      { onProgress: progress },
    );
    expect(progress).toHaveBeenCalledTimes(3);
    expect(progress).toHaveBeenNthCalledWith(1, 1, 3);
    expect(progress).toHaveBeenNthCalledWith(2, 2, 3);
    expect(progress).toHaveBeenNthCalledWith(3, 3, 3);
  });

  it('accumulates warnings across files', () => {
    resetRegistry();
    const warnParser: ImportParser = {
      format: 'warnsvg',
      supportedExtensions: () => ['warnsvg'],
      canParse: () => true,
      parse: () => {
        const doc = createDocument('Warn');
        const node = makeShapeNode('', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
        return {
          document: { ...doc, rootChildren: [node.id], nodes: { [node.id]: node } },
          nodeIds: [node.id],
          warnings: ['Missing feature X', 'Fallback font used'],
        };
      },
    };
    registerParser(warnParser);
    const result = batchImport([
      { name: 'a.warnsvg', data: 'data' },
      { name: 'b.warnsvg', data: 'data' },
    ]);
    expect(result.warnings.length).toBe(4);
  });

  it('handles large batch performance', () => {
    resetRegistry();
    registerParser(makeTestParser('svg', ['svg']));
    const files = Array.from({ length: 50 }, (_, i) => ({
      name: `file${i}.svg`,
      data: '<svg></svg>',
    }));
    const start = performance.now();
    const result = batchImport(files);
    const elapsed = performance.now() - start;
    expect(result.successCount).toBe(50);
    expect(result.failCount).toBe(0);
    expect(result.nodeIds.length).toBe(50);
    expect(elapsed).toBeLessThan(5000);
  });

  it('includes warnings from per-file results', () => {
    resetRegistry();
    const warnParser: ImportParser = {
      format: 'warns',
      supportedExtensions: () => ['warns'],
      canParse: () => true,
      parse: () => {
        const doc = createDocument('W');
        const node = makeShapeNode('', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
        return {
          document: { ...doc, rootChildren: [node.id], nodes: { [node.id]: node } },
          nodeIds: [node.id],
          warnings: ['Test warning'],
        };
      },
    };
    registerParser(warnParser);
    const result = batchImport([{ name: 'a.warns', data: 'data' }]);
    expect(result.results[0]?.warnings).toContain('Test warning');
  });

  it('deep-clones imported container subtrees and remaps child ids', () => {
    resetRegistry();
    const groupedParser: ImportParser = {
      format: 'grouped',
      supportedExtensions: () => ['grouped'],
      canParse: () => true,
      parse: () => {
        const child = makeShapeNode('s1', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
        const group = makeGroupNode('g1', { children: ['s1'] });
        return {
          document: {
            ...createDocument('Grouped', true),
            rootChildren: ['g1'],
            nodes: { g1: group, s1: child },
            nextId: 2,
          },
          nodeIds: ['g1'],
          warnings: [],
        };
      },
    };
    registerParser(groupedParser);

    const result = batchImport([{ name: 'layers.grouped', data: 'data' }]);

    const importedGroup = result.document.nodes[result.nodeIds[0]!];
    expect(importedGroup?.kind).toBe('group');
    if (importedGroup?.kind !== 'group') return;
    expect(importedGroup.children).toHaveLength(1);
    expect(importedGroup.children[0]).not.toBe('s1');
    expect(result.document.nodes[importedGroup.children[0]!]).toBeDefined();
  });
});
