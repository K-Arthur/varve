import { describe, expect, it } from 'vitest';
import {
  type BatchRenameOptions,
  applyBatchRename,
  computeBatchRenamePreview,
  validateRegex,
} from '../batchRename';

const baseOptions: BatchRenameOptions = {
  find: 'old',
  replace: 'new',
  useRegex: false,
  caseSensitive: false,
  wholeWord: false,
};

const nodeNames = [
  { nodeId: 'n1', name: 'oldShape' },
  { nodeId: 'n2', name: 'Shape old' },
  { nodeId: 'n3', name: 'boldText' },
  { nodeId: 'n4', name: 'no-match' },
  { nodeId: 'n5', name: 'OldOld' },
];

function makeDoc(nodes: Array<{ id: string; name: string }>) {
  const doc: Record<string, unknown> = {
    nodes: {},
    rootChildren: [],
    canvasWidth: 1920,
    canvasHeight: 1080,
    name: 'test',
    formatVersion: '2.6',
  };
  for (const n of nodes) {
    (doc.nodes as Record<string, unknown>)[n.id] = {
      id: n.id,
      name: n.name,
      kind: 'shape',
      transform: [1, 0, 0, 1, 0, 0],
      shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      fills: [],
      strokes: [],
      effects: [],
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal' as const,
      rotation: 0,
      order: 'a0',
      fill: { space: 'rgb' as const, r: 200, g: 200, b: 200, a: 255 },
    };
  }
  return doc as unknown as import('@strata/scene').Document;
}

describe('computeBatchRenamePreview', () => {
  it('returns all names unchanged when find is empty', () => {
    const opts = { ...baseOptions, find: '' };
    const result = computeBatchRenamePreview(nodeNames, opts);
    expect(result).toHaveLength(5);
    for (const r of result) {
      expect(r.changed).toBe(false);
      expect(r.newName).toBe(r.originalName);
    }
  });

  it('returns unchanged when no find matches', () => {
    const opts = { ...baseOptions, find: 'xyz' };
    const result = computeBatchRenamePreview(nodeNames, opts);
    expect(result.every((r) => !r.changed)).toBe(true);
  });

  it('performs basic find/replace', () => {
    const result = computeBatchRenamePreview(nodeNames, baseOptions);
    const changed = result.filter((r) => r.changed);
    const n1 = result.find((r) => r.nodeId === 'n1');
    expect(n1?.newName).toBe('newShape');
    const n2 = result.find((r) => r.nodeId === 'n2');
    expect(n2?.newName).toBe('Shape new');
    const n3 = result.find((r) => r.nodeId === 'n3');
    expect(n3?.newName).toBe('bnewText');
    const n5 = result.find((r) => r.nodeId === 'n5');
    expect(n5?.newName).toBe('newnew');
    expect(changed.length).toBeGreaterThanOrEqual(3);
  });

  it('sorts changed items first, then alphabetically', () => {
    const result = computeBatchRenamePreview(nodeNames, baseOptions);
    const changed = result.filter((r) => r.changed);
    const unchanged = result.filter((r) => !r.changed);
    for (let i = 0; i < changed.length; i++) {
      expect(result[i]?.changed).toBe(true);
    }
    for (let i = changed.length; i < result.length; i++) {
      expect(result[i]?.changed).toBe(false);
    }
    for (let i = 1; i < changed.length; i++) {
      expect(
        changed[i]!.originalName.localeCompare(changed[i - 1]!.originalName),
      ).toBeGreaterThanOrEqual(0);
    }
    for (let i = 1; i < unchanged.length; i++) {
      expect(
        unchanged[i]!.originalName.localeCompare(unchanged[i - 1]!.originalName),
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it('supports regex find/replace', () => {
    const opts: BatchRenameOptions = {
      ...baseOptions,
      find: '\\d+',
      replace: '#',
      useRegex: true,
    };
    const names = [
      { nodeId: 'a', name: 'Layer 1' },
      { nodeId: 'b', name: 'Layer 42' },
    ];
    const result = computeBatchRenamePreview(names, opts);
    expect(result.find((r) => r.nodeId === 'a')?.newName).toBe('Layer #');
    expect(result.find((r) => r.nodeId === 'b')?.newName).toBe('Layer #');
  });

  it('regex capture groups work', () => {
    const opts: BatchRenameOptions = {
      ...baseOptions,
      find: '(old)',
      replace: '$1-new',
      useRegex: true,
    };
    const result = computeBatchRenamePreview(nodeNames, opts);
    expect(result.find((r) => r.nodeId === 'n1')?.newName).toBe('old-newShape');
  });

  it('respects case sensitivity', () => {
    const opts: BatchRenameOptions = {
      ...baseOptions,
      find: 'old',
      caseSensitive: true,
    };
    const names = [
      { nodeId: 'a', name: 'oldShape' },
      { nodeId: 'b', name: 'OLDShape' },
    ];
    const result = computeBatchRenamePreview(names, opts);
    expect(result.find((r) => r.nodeId === 'a')?.changed).toBe(true);
    expect(result.find((r) => r.nodeId === 'b')?.changed).toBe(false);
  });

  it('respects whole word', () => {
    const opts: BatchRenameOptions = {
      ...baseOptions,
      find: 'old',
      wholeWord: true,
    };
    const names = [
      { nodeId: 'a', name: 'old shape' },
      { nodeId: 'b', name: 'oldShape' },
    ];
    const result = computeBatchRenamePreview(names, opts);
    expect(result.find((r) => r.nodeId === 'a')?.changed).toBe(true);
    expect(result.find((r) => r.nodeId === 'b')?.changed).toBe(false);
  });

  it('handles invalid regex gracefully', () => {
    const opts: BatchRenameOptions = {
      ...baseOptions,
      find: '[invalid',
      useRegex: true,
    };
    const result = computeBatchRenamePreview(nodeNames, opts);
    expect(result.every((r) => !r.changed)).toBe(true);
  });
});

describe('validateRegex', () => {
  it('returns null for valid pattern', () => {
    expect(validateRegex('\\d+')).toBeNull();
    expect(validateRegex('[a-z]+')).toBeNull();
    expect(validateRegex('hello|world')).toBeNull();
  });

  it('returns error message for invalid syntax', () => {
    expect(validateRegex('[invalid')).not.toBeNull();
    expect(validateRegex('(unclosed')).not.toBeNull();
  });

  it('returns error for empty pattern', () => {
    expect(validateRegex('')).toBe('Pattern is empty');
  });

  it('detects catastrophic backtracking', () => {
    expect(validateRegex('(a+)+')).not.toBeNull();
    expect(validateRegex('(\\d+)*')).not.toBeNull();
    expect(validateRegex('a*b+c+')).toBeNull();
  });
});

describe('applyBatchRename', () => {
  it('returns same document when find is empty', () => {
    const doc = makeDoc([{ id: 'n1', name: 'oldShape' }]);
    const result = applyBatchRename(doc, ['n1'], { ...baseOptions, find: '' });
    expect(result).toBe(doc);
  });

  it('returns same document when no nodes match', () => {
    const doc = makeDoc([{ id: 'n1', name: 'xyz' }]);
    const result = applyBatchRename(doc, ['n1'], baseOptions);
    expect(result).toBe(doc);
  });

  it('renames matching nodes', () => {
    const doc = makeDoc([
      { id: 'n1', name: 'oldShape' },
      { id: 'n2', name: 'no-match' },
    ]);
    const result = applyBatchRename(doc, ['n1', 'n2'], baseOptions);
    expect(result.nodes['n1']?.name).toBe('newShape');
    expect(result.nodes['n2']?.name).toBe('no-match');
  });

  it('renames only scope ids when subset is passed', () => {
    const doc = makeDoc([
      { id: 'n1', name: 'old A' },
      { id: 'n2', name: 'old B' },
    ]);
    const result = applyBatchRename(doc, ['n1'], baseOptions);
    expect(result.nodes['n1']?.name).toBe('new A');
    expect(result.nodes['n2']?.name).toBe('old B');
  });

  it('is immutable (does not mutate input)', () => {
    const doc = makeDoc([{ id: 'n1', name: 'oldShape' }]);
    const originalName = doc.nodes['n1']!.name;
    applyBatchRename(doc, ['n1'], baseOptions);
    expect(doc.nodes['n1']?.name).toBe(originalName);
  });
});
