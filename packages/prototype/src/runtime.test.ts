import { describe, expect, it } from 'vitest';
import {
  applyActionResult,
  createInitialState,
  createRuntime,
  getActiveOverlays,
  getVariable,
  handleEvent,
  processDelays,
  setVariable,
} from './runtime';
import type { Action, Interaction, PrototypeVariable, TransitionConfig } from './types';

const defaultTransition: TransitionConfig = {
  kind: 'instant',
  duration: 0,
  easing: { kind: 'linear' },
};

function makeClickInteraction(id: string, nodeId: string, actions: Action[]): Interaction {
  return {
    id,
    nodeId,
    name: `Interaction ${id}`,
    trigger: { kind: 'onClick' },
    actions,
    enabled: true,
  };
}

describe('Prototype Runtime', () => {
  describe('createInitialState', () => {
    it('creates state with default values', () => {
      const state = createInitialState('screen-1');
      expect(state.currentScreenId).toBe('screen-1');
      expect(state.variables).toEqual({});
      expect(state.overlayStack).toEqual([]);
      expect(state.scrollPositions).toEqual({});
      expect(state.visibilityOverrides).toEqual({});
    });

    it('creates state with initial variables', () => {
      const vars: Record<string, PrototypeVariable> = {
        count: { id: 'count', name: 'Count', type: 'number', value: 0 },
      };
      const state = createInitialState('screen-1', vars);
      expect(state.variables.count?.value).toBe(0);
    });
  });

  describe('createRuntime', () => {
    it('creates runtime with initial state', () => {
      const runtime = createRuntime([], 'screen-1');
      expect(runtime.state.currentScreenId).toBe('screen-1');
      expect(runtime.interactions).toEqual([]);
    });

    it('creates runtime with interactions', () => {
      const interactions: Interaction[] = [
        makeClickInteraction('i1', 'btn-1', [
          { kind: 'setVariable', variableId: 'count', value: 1 },
        ]),
      ];
      const runtime = createRuntime(interactions, 'screen-1');
      expect(runtime.interactions).toHaveLength(1);
    });
  });

  describe('handleEvent', () => {
    it('processes click event and returns action results', () => {
      const interactions: Interaction[] = [
        makeClickInteraction('i1', 'btn-1', [
          { kind: 'setVariable', variableId: 'count', value: 1 },
        ]),
      ];
      const runtime = createRuntime(interactions, 'screen-1');
      const results = handleEvent(runtime, { type: 'click', nodeId: 'btn-1' });
      expect(results).toHaveLength(1);
      expect(results[0]?.interactionId).toBe('i1');
    });

    it('does not trigger for non-matching event', () => {
      const interactions: Interaction[] = [
        makeClickInteraction('i1', 'btn-1', [
          { kind: 'setVariable', variableId: 'count', value: 1 },
        ]),
      ];
      const runtime = createRuntime(interactions, 'screen-1');
      const results = handleEvent(runtime, { type: 'click', nodeId: 'btn-2' });
      expect(results).toHaveLength(0);
    });

    it('handles navigateTo action and updates current screen', () => {
      const interactions: Interaction[] = [
        makeClickInteraction('i1', 'btn-1', [
          { kind: 'navigateTo', targetId: 'screen-2', transition: defaultTransition },
        ]),
      ];
      const runtime = createRuntime(interactions, 'screen-1');
      const results = handleEvent(runtime, { type: 'click', nodeId: 'btn-1' });
      expect(results).toHaveLength(1);

      // Apply the navigate result
      const actionResult = results[0]?.actionResults[0];
      expect(actionResult).toBeDefined();
      applyActionResult(runtime, actionResult as NonNullable<typeof actionResult>);
      expect(runtime.state.currentScreenId).toBe('screen-2');
      expect(runtime.screenHistory).toEqual(['screen-1']);
    });

    it('goBack pops overlay or navigates back', () => {
      const runtime = createRuntime([], 'screen-1');
      runtime.state.overlayStack = ['overlay-1'];
      applyActionResult(runtime, { kind: 'goBack' });
      expect(runtime.state.overlayStack).toEqual([]);

      runtime.state.currentScreenId = 'screen-2';
      runtime.screenHistory = ['screen-1'];
      applyActionResult(runtime, { kind: 'goBack' });
      expect(runtime.state.currentScreenId).toBe('screen-1');
      expect(runtime.screenHistory).toEqual([]);
    });

    it('processes multiple interactions on same event', () => {
      const interactions: Interaction[] = [
        makeClickInteraction('i1', 'btn-1', [{ kind: 'setVariable', variableId: 'a', value: 1 }]),
        makeClickInteraction('i2', 'btn-1', [{ kind: 'setVariable', variableId: 'b', value: 2 }]),
      ];
      const runtime = createRuntime(interactions, 'screen-1');
      const results = handleEvent(runtime, { type: 'click', nodeId: 'btn-1' });
      expect(results).toHaveLength(2);
    });

    it('handles keydown events', () => {
      const interactions: Interaction[] = [
        {
          id: 'i1',
          nodeId: 'proto-root',
          name: 'Escape',
          trigger: { kind: 'onKeyPress', key: 'Escape' },
          actions: [{ kind: 'goBack' }],
          enabled: true,
        },
      ];
      const runtime = createRuntime(interactions, 'screen-1');
      const results = handleEvent(runtime, { type: 'keydown', key: 'Escape' });
      expect(results).toHaveLength(1);
    });
  });

  describe('getVariable / setVariable', () => {
    it('gets and sets variable values', () => {
      const runtime = createRuntime([], 'screen-1');
      setVariable(runtime, 'count', 5);
      expect(getVariable(runtime, 'count')).toBe(5);
    });

    it('overwrites existing variable values', () => {
      const runtime = createRuntime([], 'screen-1');
      setVariable(runtime, 'count', 5);
      setVariable(runtime, 'count', 10);
      expect(getVariable(runtime, 'count')).toBe(10);
    });
  });

  describe('getActiveOverlays', () => {
    it('returns empty array when no overlays', () => {
      const runtime = createRuntime([], 'screen-1');
      expect(getActiveOverlays(runtime)).toEqual([]);
    });

    it('returns active overlay IDs', () => {
      const runtime = createRuntime([], 'screen-1');
      runtime.state.overlayStack = ['overlay-1', 'overlay-2'];
      expect(getActiveOverlays(runtime)).toEqual(['overlay-1', 'overlay-2']);
    });
  });

  describe('applyActionResult', () => {
    it('opens overlay and adds to stack', () => {
      const runtime = createRuntime([], 'screen-1');
      applyActionResult(runtime, {
        kind: 'openOverlay',
        targetId: 'overlay-1',
        transition: defaultTransition,
      });
      expect(runtime.state.overlayStack).toContain('overlay-1');
    });

    it('closes overlay and removes from stack', () => {
      const runtime = createRuntime([], 'screen-1');
      runtime.state.overlayStack = ['overlay-1'];
      applyActionResult(runtime, {
        kind: 'closeOverlay',
        overlayId: 'overlay-1',
        transition: defaultTransition,
      });
      expect(runtime.state.overlayStack).not.toContain('overlay-1');
    });

    it('sets variable value', () => {
      const runtime = createRuntime([], 'screen-1');
      applyActionResult(runtime, {
        kind: 'setVariable',
        variableId: 'score',
        value: 100,
      });
      expect(getVariable(runtime, 'score')).toBe(100);
    });

    it('toggles boolean variable', () => {
      const runtime = createRuntime([], 'screen-1');
      setVariable(runtime, 'isOpen', false);
      applyActionResult(runtime, {
        kind: 'toggleVariable',
        variableId: 'isOpen',
        newValue: true,
      });
      expect(getVariable(runtime, 'isOpen')).toBe(true);
    });

    it('sets visibility override', () => {
      const runtime = createRuntime([], 'screen-1');
      applyActionResult(runtime, {
        kind: 'toggleVisibility',
        targetId: 'layer-1',
        visible: false,
      });
      expect(runtime.state.visibilityOverrides['layer-1']).toBe(false);
    });

    it('goBack pops overlay or navigates back', () => {
      const runtime = createRuntime([], 'screen-1');
      runtime.state.overlayStack = ['overlay-1'];
      applyActionResult(runtime, { kind: 'goBack' });
      expect(runtime.state.overlayStack).toEqual([]);
    });

    it('dismiss clears all overlays', () => {
      const runtime = createRuntime([], 'screen-1');
      runtime.state.overlayStack = ['overlay-1', 'overlay-2'];
      applyActionResult(runtime, { kind: 'dismiss' });
      expect(runtime.state.overlayStack).toEqual([]);
    });

    it('startAnimation updates animation state', () => {
      const runtime = createRuntime([], 'screen-1');
      applyActionResult(runtime, {
        kind: 'startAnimation',
        targetId: 'node-1',
        animationId: 'bounce',
      });
      expect(runtime.state.animationStates.bounce).toBe('running');
    });

    it('stopAnimation updates animation state', () => {
      const runtime = createRuntime([], 'screen-1');
      runtime.state.animationStates.bounce = 'running';
      applyActionResult(runtime, {
        kind: 'stopAnimation',
        targetId: 'node-1',
        animationId: 'bounce',
      });
      expect(runtime.state.animationStates.bounce).toBe('stopped');
    });
  });

  describe('processDelays', () => {
    it('processes pending delayed actions and returns completed results', () => {
      const runtime = createRuntime([], 'screen-1');
      runtime.pendingDelays.push({
        interactionId: 'i1',
        actionIndex: 0,
        resolveAt: Date.now() - 10, // already due
      });
      runtime.pendingDelays.push({
        interactionId: 'i2',
        actionIndex: 1,
        resolveAt: Date.now() + 10000, // still pending
      });
      const completed = processDelays(runtime, 50);
      expect(completed).toHaveLength(1);
      expect(completed[0]?.interactionId).toBe('i1');
      expect(completed[0]?.actionIndex).toBe(0);
      expect(runtime.pendingDelays).toHaveLength(1);
      expect(runtime.pendingDelays[0]?.interactionId).toBe('i2');
    });

    it('adds pending delay when action has delay > 0', () => {
      const runtime = createRuntime([], 'screen-1');
      const result = { kind: 'setVariable' as const, variableId: 'score', value: 100 };
      applyActionResult(runtime, result, 500);
      expect(runtime.pendingDelays).toHaveLength(1);
      expect(runtime.pendingDelays[0]?.actionIndex).toBe(0);
    });

    it('does not add delay when action has delay = 0', () => {
      const runtime = createRuntime([], 'screen-1');
      const result = { kind: 'setVariable' as const, variableId: 'score', value: 100 };
      applyActionResult(runtime, result, 0);
      expect(runtime.pendingDelays).toHaveLength(0);
    });
  });
});
