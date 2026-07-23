import { afterEach, describe, expect, it } from 'vitest';
import { getActionRegistry, resetActionRegistryForTesting } from './ActionRegistry';

describe('ActionRegistry', () => {
  afterEach(() => {
    resetActionRegistryForTesting();
  });

  it('creates a singleton instance', () => {
    const a = getActionRegistry();
    const b = getActionRegistry();
    expect(a).toBe(b);
  });

  it('registers and retrieves an action', () => {
    const r = getActionRegistry();
    const handler = () => {};
    r.register({ id: 'test', label: 'Test Action', category: 'edit' }, handler);
    expect(r.get('test')).toBeDefined();
    expect(r.get('test')?.label).toBe('Test Action');
    expect(r.get('test')?.handler).toBe(handler);
  });

  it('returns undefined for unknown action', () => {
    const r = getActionRegistry();
    expect(r.get('nonexistent')).toBeUndefined();
  });

  it('lists all registered actions', () => {
    const r = getActionRegistry();
    r.register({ id: 'a', label: 'A', category: 'edit' }, () => {});
    r.register({ id: 'b', label: 'B', category: 'view' }, () => {});
    expect(r.getAll()).toHaveLength(2);
  });

  it('filters by category', () => {
    const r = getActionRegistry();
    r.register({ id: 'a', label: 'A', category: 'edit' }, () => {});
    r.register({ id: 'b', label: 'B', category: 'file' }, () => {});
    r.register({ id: 'c', label: 'C', category: 'edit' }, () => {});
    expect(r.getByCategory('edit')).toHaveLength(2);
    expect(r.getByCategory('file')).toHaveLength(1);
    expect(r.getByCategory('view')).toHaveLength(0);
  });

  it('searches by label', () => {
    const r = getActionRegistry();
    r.register({ id: 'undo', label: 'Undo', category: 'edit' }, () => {});
    r.register({ id: 'redo', label: 'Redo', category: 'edit' }, () => {});
    r.register({ id: 'group', label: 'Group', category: 'object' }, () => {});
    expect(r.search('undo')).toHaveLength(1);
    expect(r.search('Undo')).toHaveLength(1);
    expect(r.search('red')).toHaveLength(1);
  });

  it('searches by keyword', () => {
    const r = getActionRegistry();
    r.register(
      {
        id: 'flipH',
        label: 'Flip Horizontal',
        category: 'object',
        keywords: ['mirror', 'reflect'],
      },
      () => {},
    );
    expect(r.search('mirror')).toHaveLength(1);
    expect(r.search('reflect')).toHaveLength(1);
  });

  it('searches by id', () => {
    const r = getActionRegistry();
    r.register({ id: 'toggleSnap', label: 'Toggle Snap', category: 'view' }, () => {});
    expect(r.search('togglesnap')).toHaveLength(1);
  });

  it('returns all actions with empty search', () => {
    const r = getActionRegistry();
    r.register({ id: 'a', label: 'A', category: 'edit' }, () => {});
    r.register({ id: 'b', label: 'B', category: 'view' }, () => {});
    expect(r.search('')).toHaveLength(2);
    expect(r.search('  ')).toHaveLength(2);
  });

  it('checks if action exists', () => {
    const r = getActionRegistry();
    r.register({ id: 'exists', label: 'Exists', category: 'edit' }, () => {});
    expect(r.has('exists')).toBe(true);
    expect(r.has('missing')).toBe(false);
  });

  it('removes an action', () => {
    const r = getActionRegistry();
    r.register({ id: 'temp', label: 'Temp', category: 'edit' }, () => {});
    expect(r.has('temp')).toBe(true);
    r.remove('temp');
    expect(r.has('temp')).toBe(false);
  });

  it('clears all actions', () => {
    const r = getActionRegistry();
    r.register({ id: 'a', label: 'A', category: 'edit' }, () => {});
    r.register({ id: 'b', label: 'B', category: 'view' }, () => {});
    r.clear();
    expect(r.size).toBe(0);
  });

  it('tracks size', () => {
    const r = getActionRegistry();
    expect(r.size).toBe(0);
    r.register({ id: 'a', label: 'A', category: 'edit' }, () => {});
    expect(r.size).toBe(1);
  });

  it('warns on duplicate registration in dev', () => {
    const r = getActionRegistry();
    r.register({ id: 'dup', label: 'First', category: 'edit' }, () => {});
    r.register({ id: 'dup', label: 'Second', category: 'view' }, () => {});
    expect(r.get('dup')?.label).toBe('Second');
  });
});

describe('ActionRegistry fuzzy search', () => {
  afterEach(() => {
    resetActionRegistryForTesting();
  });

  it('finds actions by fuzzy subsequence match', () => {
    const r = getActionRegistry();
    r.register({ id: 'bringFront', label: 'Bring to Front', category: 'arrange' }, () => {});
    r.register({ id: 'sendBack', label: 'Send to Back', category: 'arrange' }, () => {});
    r.register({ id: 'group', label: 'Group', category: 'object' }, () => {});
    const results = r.search('bfr');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.id).toBe('bringFront');
  });

  it('ranks exact match above fuzzy match', () => {
    const r = getActionRegistry();
    r.register({ id: 'undo', label: 'Undo', category: 'edit' }, () => {});
    r.register({ id: 'duplicate', label: 'Duplicate', category: 'edit' }, () => {});
    const results = r.search('undo');
    expect(results[0]?.id).toBe('undo');
  });

  it('ranks prefix match above substring match', () => {
    const r = getActionRegistry();
    r.register({ id: 'alignLeft', label: 'Align Left', category: 'object' }, () => {});
    r.register(
      { id: 'distributeHorizontal', label: 'Distribute Horizontally', category: 'object' },
      () => {},
    );
    const results = r.search('align');
    expect(results[0]?.id).toBe('alignLeft');
  });

  it('boosts recently used actions', () => {
    const r = getActionRegistry();
    r.register({ id: 'actionA', label: 'Alpha Item', category: 'edit' }, () => {});
    r.register({ id: 'actionB', label: 'Beta Item', category: 'edit' }, () => {});
    r.recordUsage('actionB');
    const results = r.search('item');
    expect(results[0]?.id).toBe('actionB');
  });

  it('returns empty for no match', () => {
    const r = getActionRegistry();
    r.register({ id: 'undo', label: 'Undo', category: 'edit' }, () => {});
    expect(r.search('zzzz')).toHaveLength(0);
  });
});

describe('ActionRegistry usage tracking', () => {
  afterEach(() => {
    resetActionRegistryForTesting();
  });

  it('tracks recent ids in order', () => {
    const r = getActionRegistry();
    r.register({ id: 'a', label: 'A', category: 'edit' }, () => {});
    r.register({ id: 'b', label: 'B', category: 'edit' }, () => {});
    r.register({ id: 'c', label: 'C', category: 'edit' }, () => {});
    r.recordUsage('a');
    r.recordUsage('b');
    r.recordUsage('c');
    expect(r.getRecentIds()).toEqual(['c', 'b', 'a']);
  });

  it('moves re-used id to front', () => {
    const r = getActionRegistry();
    r.register({ id: 'a', label: 'A', category: 'edit' }, () => {});
    r.register({ id: 'b', label: 'B', category: 'edit' }, () => {});
    r.recordUsage('a');
    r.recordUsage('b');
    r.recordUsage('a');
    expect(r.getRecentIds()).toEqual(['a', 'b']);
  });

  it('ignores unknown ids', () => {
    const r = getActionRegistry();
    r.register({ id: 'a', label: 'A', category: 'edit' }, () => {});
    r.recordUsage('nonexistent');
    expect(r.getRecentIds()).toHaveLength(0);
  });
});
