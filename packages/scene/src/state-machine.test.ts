import { describe, expect, it } from 'vitest';
import { createDocument } from './document';
import {
  addSMInput,
  addSMState,
  addSMTransition,
  createStateMachine,
  findEntryState,
  findSMTransitions,
  getStateMachine,
  getStateMachines,
  removeSMInput,
  removeSMState,
  removeSMTransition,
  removeStateMachine,
} from './state-machine';

describe('StateMachine', () => {
  it('creates a state machine and retrieves it', () => {
    const doc = createDocument('test');
    const d1 = createStateMachine(doc, 'sm-1', 'My Machine');
    const sm = getStateMachine(d1, 'sm-1');
    expect(sm).toBeDefined();
    expect(sm!.name).toBe('My Machine');
    expect(sm!.states).toEqual([]);
    expect(sm!.transitions).toEqual([]);
    expect(sm!.inputs).toEqual([]);
  });

  it('getStateMachines returns empty object when none exist', () => {
    const doc = createDocument('test');
    expect(getStateMachines(doc)).toEqual({});
  });

  it('adds states to a state machine', () => {
    const doc = createDocument('test');
    const d1 = createStateMachine(doc, 'sm-1', 'Anim');
    const { doc: d2, stateId } = addSMState(d1, 'sm-1', 'Idle', 'tl-1', true);
    expect(stateId).toBeTruthy();
    const sm = getStateMachine(d2, 'sm-1')!;
    expect(sm.states).toHaveLength(1);
    expect(sm.states[0]!.name).toBe('Idle');
    expect(sm.states[0]!.timelineId).toBe('tl-1');
    expect(sm.states[0]!.isEntryState).toBe(true);
  });

  it('adds multiple states and finds entry state', () => {
    const doc = createDocument('test');
    const d1 = createStateMachine(doc, 'sm-1', 'Test');
    const { doc: d2 } = addSMState(d1, 'sm-1', 'Idle', 'tl-1', true);
    const { doc: d3 } = addSMState(d2, 'sm-1', 'Hover', 'tl-2');
    const { doc: d4 } = addSMState(d3, 'sm-1', 'Active', 'tl-3');
    const entry = findEntryState(d4, 'sm-1');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('Idle');
    expect(entry!.isEntryState).toBe(true);
  });

  it('findEntryState returns first state when no entry is marked', () => {
    const doc = createDocument('test');
    const d1 = createStateMachine(doc, 'sm-1', 'Test');
    const { doc: d2 } = addSMState(d1, 'sm-1', 'A', 'tl-a');
    const { doc: d3 } = addSMState(d2, 'sm-1', 'B', 'tl-b');
    const entry = findEntryState(d3, 'sm-1');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('A');
  });

  it('removes a state from a state machine', () => {
    const doc = createDocument('test');
    const d1 = createStateMachine(doc, 'sm-1', 'Test');
    const { doc: d2, stateId } = addSMState(d1, 'sm-1', 'Idle', 'tl-1');
    const d3 = removeSMState(d2, 'sm-1', stateId);
    const sm = getStateMachine(d3, 'sm-1')!;
    expect(sm.states).toHaveLength(0);
  });

  it('removing a state also removes its transitions', () => {
    const doc = createDocument('test');
    const d1 = createStateMachine(doc, 'sm-1', 'Test');
    const { doc: d2, stateId: fromId } = addSMState(d1, 'sm-1', 'A', 'tl-a');
    const { doc: d3, stateId: toId } = addSMState(d2, 'sm-1', 'B', 'tl-b');
    const { doc: d4 } = addSMTransition(d3, 'sm-1', fromId, toId, 'onClick');
    expect(getStateMachine(d4, 'sm-1')!.transitions).toHaveLength(1);
    const d5 = removeSMState(d4, 'sm-1', fromId);
    const sm = getStateMachine(d5, 'sm-1')!;
    expect(sm.states).toHaveLength(1);
    expect(sm.transitions).toHaveLength(0);
  });

  it('adds transitions to a state machine', () => {
    const doc = createDocument('test');
    const d1 = createStateMachine(doc, 'sm-1', 'Test');
    const { doc: d2, stateId: fromId } = addSMState(d1, 'sm-1', 'A', 'tl-a');
    const { doc: d3, stateId: toId } = addSMState(d2, 'sm-1', 'B', 'tl-b');
    const { doc: d4, transitionId } = addSMTransition(d3, 'sm-1', fromId, toId, 'onClick');
    expect(transitionId).toBeTruthy();
    const sm = getStateMachine(d4, 'sm-1')!;
    expect(sm.transitions).toHaveLength(1);
    expect(sm.transitions[0]!.fromStateId).toBe(fromId);
    expect(sm.transitions[0]!.toStateId).toBe(toId);
    expect(sm.transitions[0]!.trigger).toBe('onClick');
  });

  it('removes a transition', () => {
    const doc = createDocument('test');
    const d1 = createStateMachine(doc, 'sm-1', 'Test');
    const { doc: d2, stateId: fromId } = addSMState(d1, 'sm-1', 'A', 'tl-a');
    const { doc: d3, stateId: toId } = addSMState(d2, 'sm-1', 'B', 'tl-b');
    const { doc: d4, transitionId } = addSMTransition(d3, 'sm-1', fromId, toId, 'onClick');
    const d5 = removeSMTransition(d4, 'sm-1', transitionId);
    const sm = getStateMachine(d5, 'sm-1')!;
    expect(sm.transitions).toHaveLength(0);
  });

  it('findSMTransitions returns transitions from a specific state', () => {
    const doc = createDocument('test');
    const d1 = createStateMachine(doc, 'sm-1', 'Test');
    const { doc: d2, stateId: fromId } = addSMState(d1, 'sm-1', 'A', 'tl-a');
    const { doc: d3, stateId: toId1 } = addSMState(d2, 'sm-1', 'B', 'tl-b');
    const { doc: d4, stateId: toId2 } = addSMState(d3, 'sm-1', 'C', 'tl-c');
    const { doc: d5 } = addSMTransition(d4, 'sm-1', fromId, toId1, 'onClick');
    const { doc: d6 } = addSMTransition(d5, 'sm-1', fromId, toId2, 'onHover');
    const transitions = findSMTransitions(d6, 'sm-1', fromId);
    expect(transitions).toHaveLength(2);
    expect(transitions.map((t) => t.trigger).sort()).toEqual(['onClick', 'onHover']);
  });

  it('findSMTransitions returns empty for state with no transitions', () => {
    const doc = createDocument('test');
    const d1 = createStateMachine(doc, 'sm-1', 'Test');
    const { doc: d2 } = addSMState(d1, 'sm-1', 'A', 'tl-a');
    expect(findSMTransitions(d2, 'sm-1', 'nonexistent')).toHaveLength(0);
  });

  it('adds inputs to a state machine', () => {
    const doc = createDocument('test');
    const d1 = createStateMachine(doc, 'sm-1', 'Test');
    const { doc: d2, inputId } = addSMInput(d1, 'sm-1', 'isHovered', 'boolean');
    expect(inputId).toBeTruthy();
    const sm = getStateMachine(d2, 'sm-1')!;
    expect(sm.inputs).toHaveLength(1);
    expect(sm.inputs[0]!.name).toBe('isHovered');
    expect(sm.inputs[0]!.type).toBe('boolean');
  });

  it('removes an input', () => {
    const doc = createDocument('test');
    const d1 = createStateMachine(doc, 'sm-1', 'Test');
    const { doc: d2, inputId } = addSMInput(d1, 'sm-1', 'count', 'number');
    const d3 = removeSMInput(d2, 'sm-1', inputId);
    const sm = getStateMachine(d3, 'sm-1')!;
    expect(sm.inputs).toHaveLength(0);
  });

  it('operations on missing state machine return doc unchanged', () => {
    const doc = createDocument('test');
    const d1 = removeStateMachine(doc, 'does-not-exist');
    expect(d1).toBe(doc);
    const { doc: d2, stateId } = addSMState(doc, 'does-not-exist', 'X', 'tl');
    expect(d2).toBe(doc);
    expect(stateId).toBe('');
    const d3 = removeSMState(doc, 'does-not-exist', 'st-1');
    expect(d3).toBe(doc);
  });

  it('supports multiple state machines', () => {
    const doc = createDocument('test');
    const d1 = createStateMachine(doc, 'sm-1', 'First');
    const d2 = createStateMachine(d1, 'sm-2', 'Second');
    expect(Object.keys(getStateMachines(d2))).toHaveLength(2);
  });

  it('removes a state machine', () => {
    const doc = createDocument('test');
    const d1 = createStateMachine(doc, 'sm-1', 'Remove Me');
    const d2 = removeStateMachine(d1, 'sm-1');
    expect(getStateMachine(d2, 'sm-1')).toBeUndefined();
    expect(Object.keys(getStateMachines(d2))).toHaveLength(0);
  });

  it('adds states and sets entry state priority', () => {
    const doc = createDocument('test');
    const d1 = createStateMachine(doc, 'sm-1', 'Test');
    const { doc: d2 } = addSMState(d1, 'sm-1', 'A', 'tl-a');
    const { doc: d3, stateId: entryId } = addSMState(d2, 'sm-1', 'B', 'tl-b', true);
    const { doc: d4 } = addSMState(d3, 'sm-1', 'C', 'tl-c');
    const entry = findEntryState(d4, 'sm-1');
    expect(entry!.id).toBe(entryId);
    expect(entry!.name).toBe('B');
  });
});
