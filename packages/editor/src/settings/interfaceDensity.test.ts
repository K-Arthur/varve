import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetInterfaceDensity,
  appliedRowHeight,
  applyInterfaceAppearance,
  applyInterfaceDensity,
  applyInterfaceFontSize,
  getAppliedInterfaceDensity,
  normalizeInterfaceDensity,
  normalizeInterfaceFontSize,
  subscribeInterfaceDensity,
} from './interfaceDensity';

function fakeRoot(): Pick<HTMLElement, 'dataset' | 'style'> {
  return {
    dataset: {} as DOMStringMap,
    style: { fontSize: '' } as unknown as CSSStyleDeclaration,
  };
}

describe('interface density runtime', () => {
  beforeEach(() => {
    __resetInterfaceDensity();
  });

  describe('normalizeInterfaceDensity', () => {
    it('accepts the two modes', () => {
      expect(normalizeInterfaceDensity('default')).toBe('default');
      expect(normalizeInterfaceDensity('compact')).toBe('compact');
    });

    it('normalizes unknown, corrupt, and absent values to default', () => {
      expect(normalizeInterfaceDensity('cozy')).toBe('default');
      expect(normalizeInterfaceDensity('COMPACT')).toBe('default');
      expect(normalizeInterfaceDensity(undefined)).toBe('default');
      expect(normalizeInterfaceDensity(null)).toBe('default');
      expect(normalizeInterfaceDensity(42)).toBe('default');
    });
  });

  describe('normalizeInterfaceFontSize', () => {
    it('accepts the three sizes', () => {
      expect(normalizeInterfaceFontSize('small')).toBe('small');
      expect(normalizeInterfaceFontSize('medium')).toBe('medium');
      expect(normalizeInterfaceFontSize('large')).toBe('large');
    });

    it('normalizes unknown values to medium', () => {
      expect(normalizeInterfaceFontSize('huge')).toBe('medium');
      expect(normalizeInterfaceFontSize(undefined)).toBe('medium');
    });
  });

  describe('applyInterfaceDensity', () => {
    it('maps the setting onto the shared data-density contract', () => {
      const root = fakeRoot();
      expect(applyInterfaceDensity('default', root)).toBe('default');
      expect(root.dataset.density).toBe('comfortable');
      expect(applyInterfaceDensity('compact', root)).toBe('compact');
      expect(root.dataset.density).toBe('compact');
    });

    it('is explicit: the attribute is always set, never removed', () => {
      const root = fakeRoot();
      applyInterfaceDensity('default', root);
      expect(getAppliedInterfaceDensity(root)).toBe('comfortable');
    });

    it('tolerates a missing root and falls back to the browser root when unset', () => {
      expect(() => applyInterfaceDensity('compact', undefined)).not.toThrow();
      // 'undefined' means "use the browser root"; an element without the
      // attribute reads as null.
      expect(getAppliedInterfaceDensity(fakeRoot())).toBeNull();
    });

    it('notifies subscribers only on change', () => {
      const root = fakeRoot();
      const listener = vi.fn();
      subscribeInterfaceDensity(listener);
      applyInterfaceDensity('compact', root);
      expect(listener).toHaveBeenCalledTimes(1);
      applyInterfaceDensity('compact', root);
      expect(listener).toHaveBeenCalledTimes(1);
      applyInterfaceDensity('default', root);
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  describe('applyInterfaceFontSize', () => {
    it('applies root overrides for small and large', () => {
      const root = fakeRoot();
      applyInterfaceFontSize('small', root);
      expect(root.style.fontSize).toBe('15px');
      applyInterfaceFontSize('large', root);
      expect(root.style.fontSize).toBe('18px');
    });

    it('clears the override for medium', () => {
      const root = fakeRoot();
      applyInterfaceFontSize('small', root);
      applyInterfaceFontSize('medium', root);
      expect(root.style.fontSize).toBe('');
    });

    it('notifies subscribers on change', () => {
      const root = fakeRoot();
      const listener = vi.fn();
      subscribeInterfaceDensity(listener);
      applyInterfaceFontSize('small', root);
      expect(listener).toHaveBeenCalledTimes(1);
      applyInterfaceFontSize('small', root);
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('applyInterfaceAppearance', () => {
    it('applies both dimensions in one call', () => {
      applyInterfaceAppearance('compact', 'large');
      expect(document.documentElement.dataset.density).toBe('compact');
      expect(document.documentElement.style.fontSize).toBe('18px');
      applyInterfaceAppearance('default', 'medium');
      expect(document.documentElement.dataset.density).toBe('comfortable');
      expect(document.documentElement.style.fontSize).toBe('');
    });

    it('writes through to the real document root', () => {
      applyInterfaceAppearance('compact', 'medium');
      expect(document.documentElement.dataset.density).toBe('compact');
    });
  });

  describe('appliedRowHeight', () => {
    it('mirrors the density row-height contracts', () => {
      const compactRoot = fakeRoot();
      compactRoot.dataset.density = 'compact';
      expect(appliedRowHeight(compactRoot)).toBe(28);
      const comfortableRoot = fakeRoot();
      comfortableRoot.dataset.density = 'comfortable';
      expect(appliedRowHeight(comfortableRoot)).toBe(32);
      expect(appliedRowHeight(fakeRoot())).toBe(32);
    });
  });

  describe('unsubscribe', () => {
    it('removes the listener', () => {
      const listener = vi.fn();
      const unsub = subscribeInterfaceDensity(listener);
      unsub();
      applyInterfaceDensity('compact', fakeRoot());
      expect(listener).not.toHaveBeenCalled();
    });
  });

  afterEach(() => {
    document.documentElement.style.fontSize = '';
    delete document.documentElement.dataset.density;
  });
});
