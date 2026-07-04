import { describe, expect, it } from 'vitest';
import { evaluateCondition, findInteractions, processInteractions } from './interactions';
import type { PrototypeEvent } from './triggers';
import type {
  Action,
  ConditionDefinition,
  Interaction,
  PrototypeState,
  TransitionConfig,
  Trigger,
} from './types';

const defaultTransition: TransitionConfig = {
  kind: 'instant',
  duration: 0,
  easing: { kind: 'linear' },
};

function makeInteraction(
  id: string,
  nodeId: string,
  trigger: Trigger,
  actions: Action[],
  enabled = true,
): Interaction {
  return { id, nodeId, name: `Interaction ${id}`, trigger, actions, enabled };
}

function makeState(overrides?: Partial<PrototypeState>): PrototypeState {
  return {
    variables: {},
    currentScreenId: 'screen-1',
    overlayStack: [],
    scrollPositions: {},
    visibilityOverrides: {},
    animationStates: {},
    ...overrides,
  };
}

describe('findInteractions', () => {
  it('finds interactions for a specific node', () => {
    const interactions: Interaction[] = [
      makeInteraction('i1', 'node-1', { kind: 'onClick' }, [
        { kind: 'navigateTo', targetId: 'screen-2', transition: defaultTransition },
      ]),
      makeInteraction('i2', 'node-2', { kind: 'onHover' }, [
        { kind: 'toggleVisibility', targetId: 'tooltip', visible: true },
      ]),
    ];
    const found = findInteractions(interactions, 'node-1');
    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe('i1');
  });

  it('returns empty array when node has no interactions', () => {
    const interactions: Interaction[] = [makeInteraction('i1', 'node-1', { kind: 'onClick' }, [])];
    expect(findInteractions(interactions, 'node-99')).toEqual([]);
  });

  it('excludes disabled interactions', () => {
    const interactions: Interaction[] = [
      makeInteraction('i1', 'node-1', { kind: 'onClick' }, [], false),
    ];
    expect(findInteractions(interactions, 'node-1')).toEqual([]);
  });

  it('finds multiple interactions for the same node', () => {
    const interactions: Interaction[] = [
      makeInteraction('i1', 'node-1', { kind: 'onClick' }, []),
      makeInteraction('i2', 'node-1', { kind: 'onHover' }, []),
    ];
    expect(findInteractions(interactions, 'node-1')).toHaveLength(2);
  });
});

describe('processInteractions', () => {
  it('returns matching interactions for a click event', () => {
    const interactions: Interaction[] = [
      makeInteraction('i1', 'btn-1', { kind: 'onClick' }, [
        { kind: 'setVariable', variableId: 'count', value: 1 },
      ]),
    ];
    const state = makeState();
    const event: PrototypeEvent = { type: 'click', nodeId: 'btn-1' };
    const results = processInteractions(interactions, event, state);
    expect(results).toHaveLength(1);
    expect(results[0]?.interactionId).toBe('i1');
    expect(results[0]?.actionResults).toHaveLength(1);
  });

  it('processes multiple actions in sequence', () => {
    const interactions: Interaction[] = [
      makeInteraction('i1', 'btn-1', { kind: 'onClick' }, [
        { kind: 'setVariable', variableId: 'count', value: 1 },
        { kind: 'navigateTo', targetId: 'screen-2', transition: defaultTransition },
      ]),
    ];
    const state = makeState();
    const event: PrototypeEvent = { type: 'click', nodeId: 'btn-1' };
    const results = processInteractions(interactions, event, state);
    expect(results).toHaveLength(1);
    expect(results[0]?.actionResults).toHaveLength(2);
  });

  it('skips interactions with non-matching triggers', () => {
    const interactions: Interaction[] = [
      makeInteraction('i1', 'btn-1', { kind: 'onHover' }, [
        { kind: 'setVariable', variableId: 'x', value: 1 },
      ]),
    ];
    const state = makeState();
    const event: PrototypeEvent = { type: 'click', nodeId: 'btn-1' };
    const results = processInteractions(interactions, event, state);
    expect(results).toHaveLength(0);
  });

  it('processes actions with delay', () => {
    const interactions: Interaction[] = [
      makeInteraction('i1', 'btn-1', { kind: 'onClick' }, [
        { kind: 'setVariable', variableId: 'x', value: 1, delay: 500 },
      ]),
    ];
    const state = makeState();
    const event: PrototypeEvent = { type: 'click', nodeId: 'btn-1' };
    const results = processInteractions(interactions, event, state);
    expect(results[0]?.actionResults[0]).toMatchObject({
      kind: 'setVariable',
      variableId: 'x',
      value: 1,
    });
  });
});

describe('evaluateCondition', () => {
  it('evaluates equals condition as true', () => {
    const condition: ConditionDefinition = {
      variableId: 'count',
      operator: 'equals',
      value: 5,
    };
    const state = makeState({
      variables: { count: { id: 'count', name: 'Count', type: 'number', value: 5 } },
    });
    expect(evaluateCondition(condition, state)).toBe(true);
  });

  it('evaluates equals condition as false', () => {
    const condition: ConditionDefinition = {
      variableId: 'count',
      operator: 'equals',
      value: 10,
    };
    const state = makeState({
      variables: { count: { id: 'count', name: 'Count', type: 'number', value: 5 } },
    });
    expect(evaluateCondition(condition, state)).toBe(false);
  });

  it('evaluates greaterThan condition', () => {
    const condition: ConditionDefinition = {
      variableId: 'score',
      operator: 'greaterThan',
      value: 100,
    };
    const state = makeState({
      variables: { score: { id: 'score', name: 'Score', type: 'number', value: 150 } },
    });
    expect(evaluateCondition(condition, state)).toBe(true);
  });

  it('evaluates "and" logical condition', () => {
    const condition: ConditionDefinition = {
      logicalOperator: 'and',
      conditions: [
        { variableId: 'a', operator: 'equals', value: true },
        { variableId: 'b', operator: 'equals', value: true },
      ],
    };
    const state = makeState({
      variables: {
        a: { id: 'a', name: 'A', type: 'boolean', value: true },
        b: { id: 'b', name: 'B', type: 'boolean', value: true },
      },
    });
    expect(evaluateCondition(condition, state)).toBe(true);
  });

  it('evaluates "or" logical condition', () => {
    const condition: ConditionDefinition = {
      logicalOperator: 'or',
      conditions: [
        { variableId: 'a', operator: 'equals', value: true },
        { variableId: 'b', operator: 'equals', value: true },
      ],
    };
    const state = makeState({
      variables: {
        a: { id: 'a', name: 'A', type: 'boolean', value: false },
        b: { id: 'b', name: 'B', type: 'boolean', value: true },
      },
    });
    expect(evaluateCondition(condition, state)).toBe(true);
  });

  it('evaluates "not" logical condition', () => {
    const condition: ConditionDefinition = {
      logicalOperator: 'not',
      condition: { variableId: 'isActive', operator: 'equals', value: true },
    };
    const state = makeState({
      variables: { isActive: { id: 'isActive', name: 'Active', type: 'boolean', value: false } },
    });
    expect(evaluateCondition(condition, state)).toBe(true);
  });
});
