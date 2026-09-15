import { describe, expect, it } from 'vitest';
import { createDocument } from './document';
import { addSMState, addSMTransition, createStateMachine } from './state-machine';
import { validateStateMachine } from './state-machine-validation';

describe('state-machine-validation', () => {
  it('reports no-states error for empty machine', () => {
    let doc = createDocument('test');
    doc = createStateMachine(doc, 'sm-1', 'Empty');
    const result = validateStateMachine(doc, 'sm-1');
    expect(result.issues.some((i) => i.code === 'no-states')).toBe(true);
  });

  it('reports unreachable states', () => {
    let doc = createDocument('test');
    doc = createStateMachine(doc, 'sm-1', 'Test');
    const { stateId: a, doc: d1 } = addSMState(doc, 'sm-1', 'A', 'tl-a', true);
    const { stateId: b, doc: d2 } = addSMState(d1, 'sm-1', 'B', 'tl-b');
    const { stateId: isolated, doc: d3 } = addSMState(d2, 'sm-1', 'Isolated', 'tl-iso');
    doc = addSMTransition(d3, 'sm-1', a, b, 'onClick').doc;
    const result = validateStateMachine(doc, 'sm-1');
    expect(result.reachableStates.has(isolated)).toBe(false);
    expect(
      result.issues.some((i) => i.code === 'unreachable-state' && i.stateId === isolated),
    ).toBe(true);
  });

  it('reports missing transition targets', () => {
    let doc = createDocument('test');
    doc = createStateMachine(doc, 'sm-1', 'Test');
    const { stateId: a, doc: d1 } = addSMState(doc, 'sm-1', 'A', 'tl-a', true);
    doc = addSMTransition(d1, 'sm-1', a, 'nonexistent', 'onClick').doc;
    const result = validateStateMachine(doc, 'sm-1');
    expect(result.issues.some((i) => i.code === 'missing-to-state')).toBe(true);
  });

  it('reports ambiguous transitions with equal priority', () => {
    let doc = createDocument('test');
    doc = createStateMachine(doc, 'sm-1', 'Test');
    const { stateId: a, doc: d1 } = addSMState(doc, 'sm-1', 'A', 'tl-a', true);
    const { stateId: b, doc: d2 } = addSMState(d1, 'sm-1', 'B', 'tl-b');
    const { stateId: c, doc: d3 } = addSMState(d2, 'sm-1', 'C', 'tl-c');
    doc = addSMTransition(d3, 'sm-1', a, b, 'onClick').doc;
    doc = addSMTransition(doc, 'sm-1', a, c, 'onClick').doc;
    const result = validateStateMachine(doc, 'sm-1');
    expect(result.issues.some((i) => i.code === 'ambiguous-transition')).toBe(true);
  });

  it('reports malformed guards', () => {
    let doc = createDocument('test');
    doc = createStateMachine(doc, 'sm-1', 'Test');
    const { stateId: a, doc: d1 } = addSMState(doc, 'sm-1', 'A', 'tl-a', true);
    const { stateId: b, doc: d2 } = addSMState(d1, 'sm-1', 'B', 'tl-b');
    doc = addSMTransition(d2, 'sm-1', a, b, 'onClick', { condition: '((unbalanced' }).doc;
    const result = validateStateMachine(doc, 'sm-1');
    expect(result.issues.some((i) => i.code === 'malformed-guard')).toBe(true);
  });

  it('reports info on unconditional self-loops', () => {
    let doc = createDocument('test');
    doc = createStateMachine(doc, 'sm-1', 'Test');
    const { stateId: a, doc: d1 } = addSMState(doc, 'sm-1', 'A', 'tl-a', true);
    doc = addSMTransition(d1, 'sm-1', a, a, 'onClick').doc;
    const result = validateStateMachine(doc, 'sm-1');
    expect(result.issues.some((i) => i.code === 'self-loop')).toBe(true);
  });

  it('validates a well-formed machine without errors', () => {
    let doc = createDocument('test');
    doc = createStateMachine(doc, 'sm-1', 'Good');
    const { stateId: a, doc: d1 } = addSMState(doc, 'sm-1', 'Idle', 'tl-idle', true);
    const { stateId: b, doc: d2 } = addSMState(d1, 'sm-1', 'Active', 'tl-active');
    doc = addSMTransition(d2, 'sm-1', a, b, 'onClick').doc;
    const result = validateStateMachine(doc, 'sm-1');
    const errors = result.issues.filter((i) => i.severity === 'error');
    expect(errors).toHaveLength(0);
    expect(result.reachableStates.has(a)).toBe(true);
    expect(result.reachableStates.has(b)).toBe(true);
  });
});
