import type { Document } from './document';
import type {
  SMInput,
  SMInputType,
  SMState,
  SMTransition,
  SMTransitionTrigger,
  StateMachine,
} from './state-machine-types';

function stateId(): string {
  return `st-${Math.random().toString(36).slice(2, 8)}`;
}
function transitionId(): string {
  return `tr-${Math.random().toString(36).slice(2, 8)}`;
}
function inputId(): string {
  return `in-${Math.random().toString(36).slice(2, 8)}`;
}

export function getStateMachines(doc: Document): Record<string, StateMachine> {
  return doc.stateMachines ?? {};
}

export function getStateMachine(doc: Document, smId: string): StateMachine | undefined {
  return doc.stateMachines?.[smId];
}

export function createStateMachine(doc: Document, id: string, name: string): Document {
  const sm: StateMachine = { id, name, states: [], transitions: [], inputs: [] };
  return {
    ...doc,
    stateMachines: { ...doc.stateMachines, [id]: sm },
  };
}

export function removeStateMachine(doc: Document, smId: string): Document {
  if (!doc.stateMachines?.[smId]) return doc;
  const next = { ...doc.stateMachines };
  delete next[smId];
  return { ...doc, stateMachines: next };
}

export function addSMState(
  doc: Document,
  smId: string,
  name: string,
  timelineId: string,
  isEntryState?: boolean,
): { doc: Document; stateId: string } {
  const sm = doc.stateMachines?.[smId];
  if (!sm) return { doc, stateId: '' };
  const id = stateId();
  const state: SMState = { id, name, timelineId, isEntryState };
  const updated: StateMachine = { ...sm, states: [...sm.states, state] };
  return {
    doc: { ...doc, stateMachines: { ...doc.stateMachines, [smId]: updated } },
    stateId: id,
  };
}

export function removeSMState(doc: Document, smId: string, stateId: string): Document {
  const sm = doc.stateMachines?.[smId];
  if (!sm) return doc;
  const idx = sm.states.findIndex((s) => s.id === stateId);
  if (idx < 0) return doc;
  const nextStates = [...sm.states];
  nextStates.splice(idx, 1);
  const nextTransitions = sm.transitions.filter(
    (t) => t.fromStateId !== stateId && t.toStateId !== stateId,
  );
  const updated: StateMachine = { ...sm, states: nextStates, transitions: nextTransitions };
  return { ...doc, stateMachines: { ...doc.stateMachines, [smId]: updated } };
}

export function addSMTransition(
  doc: Document,
  smId: string,
  fromStateId: string,
  toStateId: string,
  trigger: SMTransitionTrigger,
  opts?: {
    condition?: string;
    duration?: number;
    easing?: import('@strata/shared').EasingDefinition;
    priority?: number;
    canInterrupt?: boolean;
  },
): { doc: Document; transitionId: string } {
  const sm = doc.stateMachines?.[smId];
  if (!sm) return { doc, transitionId: '' };
  const id = transitionId();
  const transition: SMTransition = { id, fromStateId, toStateId, trigger, ...opts };
  const updated: StateMachine = { ...sm, transitions: [...sm.transitions, transition] };
  return {
    doc: { ...doc, stateMachines: { ...doc.stateMachines, [smId]: updated } },
    transitionId: id,
  };
}

export function removeSMTransition(doc: Document, smId: string, transitionId: string): Document {
  const sm = doc.stateMachines?.[smId];
  if (!sm) return doc;
  const idx = sm.transitions.findIndex((t) => t.id === transitionId);
  if (idx < 0) return doc;
  const next = [...sm.transitions];
  next.splice(idx, 1);
  const updated: StateMachine = { ...sm, transitions: next };
  return { ...doc, stateMachines: { ...doc.stateMachines, [smId]: updated } };
}

export function addSMInput(
  doc: Document,
  smId: string,
  name: string,
  type: SMInputType,
): { doc: Document; inputId: string } {
  const sm = doc.stateMachines?.[smId];
  if (!sm) return { doc, inputId: '' };
  const id = inputId();
  const input: SMInput = { id, name, type };
  const updated: StateMachine = { ...sm, inputs: [...sm.inputs, input] };
  return {
    doc: { ...doc, stateMachines: { ...doc.stateMachines, [smId]: updated } },
    inputId: id,
  };
}

export function removeSMInput(doc: Document, smId: string, inputId: string): Document {
  const sm = doc.stateMachines?.[smId];
  if (!sm) return doc;
  const idx = sm.inputs.findIndex((i) => i.id === inputId);
  if (idx < 0) return doc;
  const next = [...sm.inputs];
  next.splice(idx, 1);
  const updated: StateMachine = { ...sm, inputs: next };
  return { ...doc, stateMachines: { ...doc.stateMachines, [smId]: updated } };
}

export function findEntryState(doc: Document, smId: string): SMState | undefined {
  const sm = doc.stateMachines?.[smId];
  if (!sm) return undefined;
  return sm.states.find((s) => s.isEntryState) ?? sm.states[0];
}

export function findSMTransitions(
  doc: Document,
  smId: string,
  fromStateId: string,
): SMTransition[] {
  const sm = doc.stateMachines?.[smId];
  if (!sm) return [];
  return sm.transitions.filter((t) => t.fromStateId === fromStateId);
}

// --- State mutation helpers (used by inspector) ---

export function renameSMState(
  doc: Document,
  smId: string,
  stateId: string,
  name: string,
): Document {
  const sm = doc.stateMachines?.[smId];
  if (!sm) return doc;
  const states = sm.states.map((s) => (s.id === stateId ? { ...s, name } : s));
  return { ...doc, stateMachines: { ...doc.stateMachines, [smId]: { ...sm, states } } };
}

export function setSMStateEntry(doc: Document, smId: string, stateId: string): Document {
  const sm = doc.stateMachines?.[smId];
  if (!sm) return doc;
  const states = sm.states.map((s) => ({ ...s, isEntryState: s.id === stateId }));
  return { ...doc, stateMachines: { ...doc.stateMachines, [smId]: { ...sm, states } } };
}

export function duplicateSMState(
  doc: Document,
  smId: string,
  sourceStateId: string,
): { doc: Document; stateId: string } {
  const sm = doc.stateMachines?.[smId];
  if (!sm) return { doc, stateId: '' };
  const src = sm.states.find((s) => s.id === sourceStateId);
  if (!src) return { doc, stateId: '' };
  const newId = stateId();
  const copy: SMState = { ...src, id: newId, name: `${src.name} Copy`, isEntryState: false };
  const updated: StateMachine = { ...sm, states: [...sm.states, copy] };
  return {
    doc: { ...doc, stateMachines: { ...doc.stateMachines, [smId]: updated } },
    stateId: newId,
  };
}

// --- Transition mutation helpers ---

export function setSMTransitionPriority(
  doc: Document,
  smId: string,
  transitionId: string,
  priority: number,
): Document {
  const sm = doc.stateMachines?.[smId];
  if (!sm) return doc;
  const transitions = sm.transitions.map((t) => (t.id === transitionId ? { ...t, priority } : t));
  return { ...doc, stateMachines: { ...doc.stateMachines, [smId]: { ...sm, transitions } } };
}

export function setSMTransitionTrigger(
  doc: Document,
  smId: string,
  transitionId: string,
  trigger: SMTransitionTrigger,
): Document {
  const sm = doc.stateMachines?.[smId];
  if (!sm) return doc;
  const transitions = sm.transitions.map((t) => (t.id === transitionId ? { ...t, trigger } : t));
  return { ...doc, stateMachines: { ...doc.stateMachines, [smId]: { ...sm, transitions } } };
}

export function setSMTransitionCondition(
  doc: Document,
  smId: string,
  transitionId: string,
  condition: string | undefined,
): Document {
  const sm = doc.stateMachines?.[smId];
  if (!sm) return doc;
  const transitions = sm.transitions.map((t) => (t.id === transitionId ? { ...t, condition } : t));
  return { ...doc, stateMachines: { ...doc.stateMachines, [smId]: { ...sm, transitions } } };
}

export function setSMTransitionTarget(
  doc: Document,
  smId: string,
  transitionId: string,
  toStateId: string,
): Document {
  const sm = doc.stateMachines?.[smId];
  if (!sm) return doc;
  const transitions = sm.transitions.map((t) => (t.id === transitionId ? { ...t, toStateId } : t));
  return { ...doc, stateMachines: { ...doc.stateMachines, [smId]: { ...sm, transitions } } };
}

export function duplicateSMTransition(
  doc: Document,
  smId: string,
  sourceTransitionId: string,
): { doc: Document; transitionId: string } {
  const sm = doc.stateMachines?.[smId];
  if (!sm) return { doc, transitionId: '' };
  const src = sm.transitions.find((t) => t.id === sourceTransitionId);
  if (!src) return { doc, transitionId: '' };
  const newId = transitionId();
  const copy: SMTransition = { ...src, id: newId };
  const updated: StateMachine = { ...sm, transitions: [...sm.transitions, copy] };
  return {
    doc: { ...doc, stateMachines: { ...doc.stateMachines, [smId]: updated } },
    transitionId: newId,
  };
}
