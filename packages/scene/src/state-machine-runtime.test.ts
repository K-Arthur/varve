import { describe, expect, it } from 'vitest';
import { createDocument } from './document';
import { addSMInput, addSMState, addSMTransition, createStateMachine } from './state-machine';
import {
  advanceSMTransition,
  createStateMachineRuntime,
  getCurrentState,
  getCurrentStateTimelineId,
  type SMRuntime,
  setSMInput,
  triggerSMEvent,
} from './state-machine-runtime';

function makeRuntime(): { runtime: SMRuntime; smId: string; entryId: string; secondId: string } {
  let doc = createDocument('Test');
  const smId = 'sm-1';
  doc = createStateMachine(doc, smId, 'Test SM');
  const { stateId: entryId, doc: d1 } = addSMState(doc, smId, 'Idle', 'tl-idle', true);
  doc = d1;
  const { stateId: secondId, doc: d2 } = addSMState(doc, smId, 'Active', 'tl-active');
  doc = d2;
  doc = addSMTransition(doc, smId, entryId, secondId, 'onClick').doc;
  const runtime = createStateMachineRuntime(doc, smId);
  return { runtime, smId, entryId: entryId!, secondId: secondId! };
}

describe('state-machine-runtime', () => {
  it('starts at the entry state', () => {
    const { runtime, entryId } = makeRuntime();
    expect(getCurrentState(runtime)?.id).toBe(entryId);
  });

  it('returns the entry state timeline id', () => {
    const { runtime } = makeRuntime();
    expect(getCurrentStateTimelineId(runtime)).toBe('tl-idle');
  });

  it('transitions on a matching trigger', () => {
    const { runtime, secondId } = makeRuntime();
    const next = triggerSMEvent(runtime, 'onClick');
    expect(getCurrentState(next)?.id).toBe(secondId);
  });

  it('ignores triggers with no matching transition', () => {
    const { runtime, entryId } = makeRuntime();
    const next = triggerSMEvent(runtime, 'onHover');
    expect(getCurrentState(next)?.id).toBe(entryId);
  });

  it('transitions on boolean input change when condition is true', () => {
    let { runtime, smId, entryId, secondId } = makeRuntime();
    const { inputId, doc: d1 } = addSMInput(runtime.doc, smId, 'enabled', 'boolean');
    runtime = { ...runtime, doc: d1 };
    const { doc: d2 } = addSMTransition(runtime.doc, smId, entryId, secondId, 'onVariableChange', {
      condition: 'inputs.enabled === true',
    });
    runtime = { ...runtime, doc: d2 };
    const before = setSMInput(runtime, inputId!, true);
    expect(getCurrentState(before)?.id).toBe(secondId);
  });

  it('does not transition when boolean condition is false', () => {
    let { runtime, smId, entryId, secondId } = makeRuntime();
    const { inputId, doc: d1 } = addSMInput(runtime.doc, smId, 'enabled', 'boolean');
    runtime = { ...runtime, doc: d1 };
    const { doc: d2 } = addSMTransition(runtime.doc, smId, entryId, secondId, 'onVariableChange', {
      condition: 'inputs.enabled === true',
    });
    runtime = { ...runtime, doc: d2 };
    const before = setSMInput(runtime, inputId!, false);
    expect(getCurrentState(before)?.id).toBe(entryId);
  });

  it('transitions on numeric input threshold', () => {
    let { runtime, smId, entryId, secondId } = makeRuntime();
    const { inputId, doc: d1 } = addSMInput(runtime.doc, smId, 'progress', 'number');
    runtime = { ...runtime, doc: d1 };
    const { doc: d2 } = addSMTransition(runtime.doc, smId, entryId, secondId, 'onVariableChange', {
      condition: 'inputs.progress > 0.5',
    });
    runtime = { ...runtime, doc: d2 };
    const before = setSMInput(runtime, inputId!, 0.2);
    expect(getCurrentState(before)?.id).toBe(entryId);
    const after = setSMInput(before, inputId!, 0.8);
    expect(getCurrentState(after)?.id).toBe(secondId);
  });

  it('advances transition progress over time', () => {
    let { runtime, smId, entryId, secondId } = makeRuntime();
    const { doc: d2 } = addSMTransition(runtime.doc, smId, entryId, secondId, 'onKeyPress', {
      duration: 200,
    });
    runtime = { ...runtime, doc: d2 };
    const next = triggerSMEvent(runtime, 'onKeyPress');
    expect(getCurrentState(next)?.id).toBe(secondId);
    expect(next.transitionProgress).toBe(0);
    const half = advanceSMTransition(next, 100);
    expect(half.transitionProgress).toBe(0.5);
    expect(half.activeTransition).not.toBeNull();
    const advanced = advanceSMTransition(half, 150);
    expect(advanced.transitionProgress).toBeNull();
    expect(advanced.activeTransition).toBeNull();
  });
});
