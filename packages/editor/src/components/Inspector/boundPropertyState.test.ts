import type { SceneNode, VariableStore } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { deriveNumericBindingPresentation } from './boundPropertyState';

function store(value?: number): VariableStore {
  return {
    variables:
      value === undefined
        ? {}
        : {
            spacing: {
              id: 'spacing',
              name: 'Spacing',
              type: 'number',
              valuesByMode: { default: value },
            },
          },
    collections: {},
    activeCollectionId: '',
    modes: ['default'],
    activeMode: 'default',
  };
}

function node(
  id: string,
  x: number,
  binding?: { variableId: string; expression?: string },
): SceneNode {
  return {
    id,
    kind: 'shape',
    name: id,
    visible: true,
    locked: false,
    opacity: 1,
    transform: [1, 0, 0, 1, x, 0],
    shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
    ...(binding ? { bindings: { x: binding } } : {}),
  } as unknown as SceneNode;
}

describe('deriveNumericBindingPresentation', () => {
  it('shows the resolved value and source for a single numeric binding', () => {
    const result = deriveNumericBindingPresentation(
      [node('a', 12, { variableId: 'spacing' })],
      'x',
      [12],
      store(48),
    );

    expect(result).toMatchObject({
      value: 48,
      sourceLabel: 'Spacing',
      readOnly: true,
      state: { kind: 'bound', value: 48, bindingId: 'spacing' },
    });
  });

  it('supports a binding expression without changing the document value', () => {
    const result = deriveNumericBindingPresentation(
      [node('a', 12, { variableId: 'spacing', expression: '{spacing} / 2' })],
      'x',
      [12],
      store(48),
    );

    expect(result?.value).toBe(24);
    expect(result?.state.kind).toBe('bound');
  });

  it('makes a missing source recoverable and keeps the literal fallback visible', () => {
    const result = deriveNumericBindingPresentation(
      [node('a', 12, { variableId: 'missing' })],
      'x',
      [12],
      store(),
    );

    expect(result).toMatchObject({ value: 12, sourceLabel: 'missing', readOnly: true });
    expect(result?.state.kind).toBe('error');
  });

  it('blocks a mixed batch when any selected node is variable-bound', () => {
    const result = deriveNumericBindingPresentation(
      [node('a', 12, { variableId: 'spacing' }), node('b', 20)],
      'x',
      [12, 20],
      store(48),
    );

    expect(result).toMatchObject({ readOnly: true, value: 12 });
    expect(result?.state).toMatchObject({ kind: 'unavailable', applicableCount: 1, totalCount: 2 });
    expect(result?.state.kind === 'unavailable' && result.state.reason).toMatch(/unbind/i);
  });

  it('does not create Inspector state when no node is bound', () => {
    expect(deriveNumericBindingPresentation([node('a', 12)], 'x', [12], store(48))).toBeUndefined();
  });
});
