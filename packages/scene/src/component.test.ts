import { describe, expect, it } from 'vitest';
import { type ComponentDefinition, slotsSatisfied } from './component';
import { createVariableStore, resolve } from './variables';

describe('VariableStore (stub)', () => {
  it('resolves the active-mode value', () => {
    const store = createVariableStore(['default', 'dense']);
    store.variables['space-2'] = {
      id: 'space-2',
      name: 'space/2',
      type: 'number',
      valuesByMode: { default: 8, dense: 4 },
    };
    expect(resolve(store, 'space-2')).toBe(8);
    store.activeMode = 'dense';
    expect(resolve(store, 'space-2')).toBe(4);
  });

  it('falls back to default mode when the active mode is unset', () => {
    const store = createVariableStore(['default', 'dense']);
    store.variables.r = { id: 'r', name: 'r', type: 'number', valuesByMode: { default: 2 } };
    store.activeMode = 'dense';
    expect(resolve(store, 'r')).toBe(2);
  });

  it('throws on unknown variable', () => {
    const store = createVariableStore();
    expect(() => resolve(store, 'nope')).toThrow();
  });
});

describe('ComponentDefinition (slots-ready stub)', () => {
  const comp: ComponentDefinition = {
    id: 'cmp-1',
    name: 'Button',
    masterRootId: 'master-root',
    slots: [
      { id: 'icon', name: 'Icon', kind: 'single' },
      { id: 'label', name: 'Label', kind: 'text' },
    ],
  };

  it('is satisfied when all slots are filled', () => {
    expect(slotsSatisfied(comp, { icon: 'n1', label: 'n2' })).toBe(true);
  });

  it('is NOT satisfied when a slot is missing', () => {
    expect(slotsSatisfied(comp, { icon: 'n1' })).toBe(false);
    expect(slotsSatisfied(comp, {})).toBe(false);
  });
});
