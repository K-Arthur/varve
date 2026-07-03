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
