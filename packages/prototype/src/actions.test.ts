import { describe, expect, it } from 'vitest';
import { type ActionResult, executeAction } from './actions';
import type { Action, PrototypeState, TransitionConfig } from './types';

const defaultTransition: TransitionConfig = {
  kind: 'instant',
  duration: 0,
  easing: { kind: 'linear' },
};

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

describe('executeAction', () => {
  it('navigateTo changes currentScreenId', () => {
    const action: Action = {
      kind: 'navigateTo',
      targetId: 'screen-2',
      transition: defaultTransition,
    };
    const state = makeState();
    const result = executeAction(action, state) as ActionResult & { kind: 'navigateTo' };
    expect(result.kind).toBe('navigateTo');
    expect(result.targetId).toBe('screen-2');
    expect(result.transition.kind).toBe('instant');
  });

  it('openOverlay adds to overlay stack', () => {
    const action: Action = {
      kind: 'openOverlay',
      targetId: 'overlay-1',
      transition: {
        ...defaultTransition,
        kind: 'dissolve',
        duration: 200,
        easing: { kind: 'easeInOut' },
      },
    };
    const state = makeState();
    const result = executeAction(action, state) as ActionResult & { kind: 'openOverlay' };
    expect(result.kind).toBe('openOverlay');
    expect(result.targetId).toBe('overlay-1');
  });

  it('closeOverlay removes from overlay stack', () => {
    const action: Action = {
      kind: 'closeOverlay',
      overlayId: 'overlay-1',
      transition: defaultTransition,
    };
    const state = makeState({ overlayStack: ['overlay-1'] });
    const result = executeAction(action, state) as ActionResult & { kind: 'closeOverlay' };
    expect(result.kind).toBe('closeOverlay');
    expect(result.overlayId).toBe('overlay-1');
  });

  it('setVariable returns new value', () => {
    const action: Action = {
      kind: 'setVariable',
      variableId: 'count',
      value: 10,
    };
    const state = makeState();
    const result = executeAction(action, state) as ActionResult & { kind: 'setVariable' };
    expect(result.kind).toBe('setVariable');
    expect(result.variableId).toBe('count');
    expect(result.value).toBe(10);
  });

  it('toggleVariable flips boolean value', () => {
    const action: Action = {
      kind: 'toggleVariable',
      variableId: 'isOpen',
    };
    const state = makeState({
      variables: {
        isOpen: { id: 'isOpen', name: 'Is Open', type: 'boolean', value: false },
      },
    });
    const result = executeAction(action, state) as ActionResult & { kind: 'toggleVariable' };
    expect(result.kind).toBe('toggleVariable');
    expect(result.variableId).toBe('isOpen');
    expect(result.newValue).toBe(true);
  });

  it('toggleVariable toggles true to false', () => {
    const action: Action = {
      kind: 'toggleVariable',
      variableId: 'isOpen',
    };
    const state = makeState({
      variables: {
        isOpen: { id: 'isOpen', name: 'Is Open', type: 'boolean', value: true },
      },
    });
    const result = executeAction(action, state) as ActionResult & { kind: 'toggleVariable' };
    expect(result.newValue).toBe(false);
  });

  it('setVariable with expression evaluates relative to current value', () => {
    const action: Action = {
      kind: 'setVariable',
      variableId: 'count',
      value: 0,
      expression: 'count + 1',
    };
    const state = makeState({
      variables: {
        count: { id: 'count', name: 'Count', type: 'number', value: 5 },
      },
    });
    const result = executeAction(action, state) as ActionResult & { kind: 'setVariable' };
    expect(result.kind).toBe('setVariable');
    expect(result.value).toBe(6);
  });

  it('uses operator precedence in variable expressions', () => {
    const action: Action = {
      kind: 'setVariable',
      variableId: 'score',
      value: 0,
      expression: 'score + 3 * 4',
    };
    const state = makeState({
      variables: {
        score: { id: 'score', name: 'Score', type: 'number', value: 2 },
      },
    });
    const result = executeAction(action, state) as ActionResult & { kind: 'setVariable' };
    expect(result.value).toBe(14);
  });

  it('toggleVisibility returns target and new visible state', () => {
    const action: Action = {
      kind: 'toggleVisibility',
      targetId: 'layer-1',
      visible: false,
    };
    const state = makeState();
    const result = executeAction(action, state) as ActionResult & { kind: 'toggleVisibility' };
    expect(result.kind).toBe('toggleVisibility');
    expect(result.targetId).toBe('layer-1');
    expect(result.visible).toBe(false);
  });

  it('openURL returns url and newTab flag', () => {
    const action: Action = {
      kind: 'openURL',
      url: 'https://example.com',
      newTab: true,
    };
    const state = makeState();
    const result = executeAction(action, state) as ActionResult & { kind: 'openURL' };
    expect(result.kind).toBe('openURL');
    expect(result.url).toBe('https://example.com');
    expect(result.newTab).toBe(true);
  });

  it('scrollTo returns target and container', () => {
    const action: Action = {
      kind: 'scrollTo',
      targetId: 'section-3',
      containerId: 'scroll-container',
      behavior: 'smooth',
      offset: 20,
    };
    const state = makeState();
    const result = executeAction(action, state) as ActionResult & { kind: 'scrollTo' };
    expect(result.kind).toBe('scrollTo');
    expect(result.targetId).toBe('section-3');
    expect(result.behavior).toBe('smooth');
    expect(result.offset).toBe(20);
  });

  it('dismiss returns result with dismiss kind', () => {
    const action: Action = { kind: 'dismiss' };
    const state = makeState();
    const result = executeAction(action, state) as ActionResult & { kind: 'dismiss' };
    expect(result.kind).toBe('dismiss');
  });

  it('goBack returns result with goBack kind', () => {
    const action: Action = { kind: 'goBack' };
    const state = makeState();
    const result = executeAction(action, state) as ActionResult & { kind: 'goBack' };
    expect(result.kind).toBe('goBack');
  });

  it('startAnimation returns animation target and id', () => {
    const action: Action = {
      kind: 'startAnimation',
      targetId: 'node-1',
      animationId: 'bounce',
    };
    const state = makeState();
    const result = executeAction(action, state) as ActionResult & { kind: 'startAnimation' };
    expect(result.kind).toBe('startAnimation');
    expect(result.animationId).toBe('bounce');
  });

  it('stopAnimation returns animation id', () => {
    const action: Action = {
      kind: 'stopAnimation',
      targetId: 'node-1',
      animationId: 'bounce',
    };
    const state = makeState();
    const result = executeAction(action, state) as ActionResult & { kind: 'stopAnimation' };
    expect(result.kind).toBe('stopAnimation');
    expect(result.animationId).toBe('bounce');
  });
});
