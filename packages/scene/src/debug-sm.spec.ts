import { describe, expect, it } from 'vitest';
import { createDocument } from './document';
import { addSMInput, addSMState, addSMTransition, createStateMachine } from './state-machine';
import { createStateMachineRuntime, getCurrentState, setSMInput } from './state-machine-runtime';

function makeRuntime() {
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

describe('debug', () => {
  it('transitions on boolean input change when condition is true', () => {
    let { runtime, smId, entryId, secondId } = makeRuntime();
    console.log('entryId:', entryId);
    console.log('secondId:', secondId);
    console.log(
      'states before:',
      JSON.stringify(runtime.doc.stateMachines?.[smId]?.states?.map((s) => s.id)),
    );
    console.log(
      'transitions before:',
      JSON.stringify(runtime.doc.stateMachines?.[smId]?.transitions),
    );

    const { inputId, doc: d1 } = addSMInput(runtime.doc, smId, 'enabled', 'boolean');
    runtime = { ...runtime, doc: d1 };
    console.log('inputId:', inputId);
    console.log(
      'states after input:',
      JSON.stringify(runtime.doc.stateMachines?.[smId]?.states?.map((s) => s.id)),
    );
    console.log('inputs:', JSON.stringify(runtime.doc.stateMachines?.[smId]?.inputs));
    console.log(
      'transitions after input:',
      JSON.stringify(runtime.doc.stateMachines?.[smId]?.transitions),
    );

    const { doc: d2 } = addSMTransition(runtime.doc, smId, entryId, secondId, 'onVariableChange', {
      condition: 'inputs.enabled === true',
    });
    runtime = { ...runtime, doc: d2 };
    console.log(
      'states after transition:',
      JSON.stringify(runtime.doc.stateMachines?.[smId]?.states?.map((s) => s.id)),
    );
    console.log(
      'transitions after transition:',
      JSON.stringify(runtime.doc.stateMachines?.[smId]?.transitions),
    );

    console.log('currentStateId before setSMInput:', runtime.currentStateId);
    const before = setSMInput(runtime, inputId!, true);
    console.log('currentStateId after setSMInput:', before.currentStateId);
    console.log('getCurrentState(before)?.id:', getCurrentState(before)?.id);
    console.log('secondId:', secondId);

    expect(getCurrentState(before)?.id).toBe(secondId);
  });
});
