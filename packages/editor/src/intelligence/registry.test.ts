import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearRegistry,
  getAllFeatures,
  getFeature,
  getFeaturesByCategory,
  registerFeature,
  unregisterFeature,
} from './registry';

describe('intelligence registry', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('registers and retrieves a feature by id', () => {
    const feature = {
      id: 'test-audit',
      name: 'Test Audit',
      category: 'audit' as const,
      description: 'A test audit feature',
      run: () => {},
    };
    registerFeature(feature);
    expect(getFeature('test-audit')).toBe(feature);
  });

  it('returns undefined for unregistered id', () => {
    expect(getFeature('nonexistent')).toBeUndefined();
  });

  it('lists all registered features', () => {
    registerFeature({ id: 'a', name: 'A', category: 'audit', description: '', run: () => {} });
    registerFeature({ id: 'b', name: 'B', category: 'debt', description: '', run: () => {} });
    expect(getAllFeatures()).toHaveLength(2);
  });

  it('filters features by category', () => {
    registerFeature({ id: 'a', name: 'A', category: 'audit', description: '', run: () => {} });
    registerFeature({ id: 'b', name: 'B', category: 'debt', description: '', run: () => {} });
    registerFeature({ id: 'c', name: 'C', category: 'audit', description: '', run: () => {} });
    const audits = getFeaturesByCategory('audit');
    expect(audits).toHaveLength(2);
    expect(audits.map((f) => f.id)).toEqual(['a', 'c']);
  });

  it('unregisters a feature', () => {
    registerFeature({ id: 'a', name: 'A', category: 'audit', description: '', run: () => {} });
    expect(unregisterFeature('a')).toBe(true);
    expect(getFeature('a')).toBeUndefined();
  });

  it('returns false when unregistering nonexistent feature', () => {
    expect(unregisterFeature('nonexistent')).toBe(false);
  });

  it('allows features with autoFix', () => {
    const autoFix = () => {};
    registerFeature({
      id: 'fixable',
      name: 'Fixable',
      category: 'debt',
      description: '',
      run: () => {},
      autoFix,
    });
    expect(getFeature('fixable')?.autoFix).toBe(autoFix);
  });
});
