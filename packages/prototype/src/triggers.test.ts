import { describe, it, expect } from 'vitest';
import { matchTrigger } from './triggers';
import type {
  Trigger,
  PrototypeState,
} from './types';

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

describe('matchTrigger', () => {
  it('matches onClick trigger when mouse click event occurs on the node', () => {
    const trigger: Trigger = { kind: 'onClick' };
    const state = makeState();
    expect(matchTrigger(trigger, { type: 'click', nodeId: 'node-1' }, 'node-1', state)).toBe(true);
  });

  it('does not match onClick trigger on a different node', () => {
    const trigger: Trigger = { kind: 'onClick' };
    const state = makeState();
    expect(matchTrigger(trigger, { type: 'click', nodeId: 'other-node' }, 'node-1', state)).toBe(false);
  });

  it('matches onTap trigger', () => {
    const trigger: Trigger = { kind: 'onTap' };
    const state = makeState();
    expect(matchTrigger(trigger, { type: 'tap', nodeId: 'node-1' }, 'node-1', state)).toBe(true);
  });

  it('matches onHover trigger on mouseEnter', () => {
    const trigger: Trigger = { kind: 'onHover' };
    const state = makeState();
    expect(matchTrigger(trigger, { type: 'mouseenter', nodeId: 'node-1' }, 'node-1', state)).toBe(true);
  });

  it('matches onHoverEnd trigger on mouseLeave', () => {
    const trigger: Trigger = { kind: 'onHoverEnd' };
    const state = makeState();
    expect(matchTrigger(trigger, { type: 'mouseleave', nodeId: 'node-1' }, 'node-1', state)).toBe(true);
  });

  it('matches afterDelay trigger when timeout event fires', () => {
    const trigger: Trigger = { kind: 'afterDelay', ms: 1000 };
    const state = makeState();
    expect(matchTrigger(trigger, { type: 'timeout', triggerKind: 'afterDelay' }, 'node-1', state)).toBe(true);
  });

  it('matches onKeyPress trigger when key matches', () => {
    const trigger: Trigger = { kind: 'onKeyPress', key: 'Escape' };
    const state = makeState();
    expect(matchTrigger(trigger, { type: 'keydown', key: 'Escape' }, 'node-1', state)).toBe(true);
  });

  it('does not match onKeyPress when key differs', () => {
    const trigger: Trigger = { kind: 'onKeyPress', key: 'Escape' };
    const state = makeState();
    expect(matchTrigger(trigger, { type: 'keydown', key: 'Enter' }, 'node-1', state)).toBe(false);
  });

  it('matches onKeyPress with modifiers when all modifiers held', () => {
    const trigger: Trigger = {
      kind: 'onKeyPress',
      key: 'z',
      modifiers: ['ctrl'],
    };
    const state = makeState();
    expect(
      matchTrigger(trigger, { type: 'keydown', key: 'z', ctrlKey: true }, 'node-1', state),
    ).toBe(true);
  });

  it('does not match onKeyPress when modifier missing', () => {
    const trigger: Trigger = {
      kind: 'onKeyPress',
      key: 'z',
      modifiers: ['ctrl'],
    };
    const state = makeState();
    expect(
      matchTrigger(trigger, { type: 'keydown', key: 'z', ctrlKey: false }, 'node-1', state),
    ).toBe(false);
  });

  it('matches onVariableChange when variable value equals expected', () => {
    const trigger: Trigger = {
      kind: 'onVariableChange',
      variableId: 'count',
      equals: 5,
    };
    const state = makeState({
      variables: {
        count: { id: 'count', name: 'Count', type: 'number', value: 5 },
      },
    });
    expect(
      matchTrigger(trigger, { type: 'variableChange', variableId: 'count', newValue: 5 }, 'node-1', state),
    ).toBe(true);
  });

  it('does not match onVariableChange when value differs', () => {
    const trigger: Trigger = {
      kind: 'onVariableChange',
      variableId: 'count',
      equals: 5,
    };
    const state = makeState({
      variables: {
        count: { id: 'count', name: 'Count', type: 'number', value: 3 },
      },
    });
    expect(
      matchTrigger(trigger, { type: 'variableChange', variableId: 'count', newValue: 3 }, 'node-1', state),
    ).toBe(false);
  });

  it('matches onVariableChange without equals check for any change', () => {
    const trigger: Trigger = { kind: 'onVariableChange', variableId: 'count' };
    const state = makeState({
      variables: {
        count: { id: 'count', name: 'Count', type: 'number', value: 5 },
      },
    });
    expect(
      matchTrigger(trigger, { type: 'variableChange', variableId: 'count', newValue: 5 }, 'node-1', state),
    ).toBe(true);
  });

  it('matches onScroll when scroll event fires on the correct container', () => {
    const trigger: Trigger = { kind: 'onScroll', direction: 'down' };
    const state = makeState();
    expect(
      matchTrigger(trigger, { type: 'scroll', nodeId: 'container-1', scrollDelta: { x: 0, y: 100 } }, 'node-1', state),
    ).toBe(true);
  });

  it('matches onLoad on initial load', () => {
    const trigger: Trigger = { kind: 'onLoad' };
    const state = makeState();
    expect(matchTrigger(trigger, { type: 'load', nodeId: 'screen-1' }, 'screen-1', state)).toBe(true);
  });

  it('matches onFocus on focus event', () => {
    const trigger: Trigger = { kind: 'onFocus' };
    const state = makeState();
    expect(matchTrigger(trigger, { type: 'focus', nodeId: 'input-1' }, 'input-1', state)).toBe(true);
  });

  it('matches onDrag when drag threshold is exceeded', () => {
    const trigger: Trigger = { kind: 'onDrag', threshold: 10 };
    const state = makeState();
    expect(
      matchTrigger(
        trigger,
        { type: 'drag', nodeId: 'node-1', distance: 15, direction: 'horizontal' },
        'node-1',
        state,
      ),
    ).toBe(true);
  });

  it('does not match onDrag when distance is below threshold', () => {
    const trigger: Trigger = { kind: 'onDrag', threshold: 50 };
    const state = makeState();
    expect(
      matchTrigger(
        trigger,
        { type: 'drag', nodeId: 'node-1', distance: 10, direction: 'horizontal' },
        'node-1',
        state,
      ),
    ).toBe(false);
  });

  it('matches onMediaQuery when query evaluates to true', () => {
    const trigger: Trigger = { kind: 'onMediaQuery', query: '(max-width: 768px)' };
    const state = makeState();
    expect(
      matchTrigger(trigger, { type: 'mediaQuery', query: '(max-width: 768px)', matches: true }, 'node-1', state),
    ).toBe(true);
  });

  it('does not match onMediaQuery when query does not match', () => {
    const trigger: Trigger = { kind: 'onMediaQuery', query: '(max-width: 768px)' };
    const state = makeState();
    expect(
      matchTrigger(trigger, { type: 'mediaQuery', query: '(max-width: 768px)', matches: false }, 'node-1', state),
    ).toBe(false);
  });

  it('returns false for unknown trigger kind', () => {
    const trigger = { kind: 'unknownKind' } as unknown as Trigger;
    const state = makeState();
    expect(matchTrigger(trigger, { type: 'click', nodeId: 'node-1' }, 'node-1', state)).toBe(false);
  });
});
