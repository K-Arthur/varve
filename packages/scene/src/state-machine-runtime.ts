/**
 * Pure state machine runtime for interactive motion.
 *
 * Evaluates transitions, conditions, and inputs without touching rendering or
 * timeline playback. This keeps the runtime testable and reusable across the
 * editor, prototype player, and export pipeline.
 *
 * Research basis: Rive State Machine (blend states + input-driven transitions),
 * Figma prototype interactions, W3C SCXML state-machine data model.
 */

import type { Document } from './document';
import { findEntryState, findSMTransitions, getStateMachine } from './state-machine';
import type { SMState, SMTransition, StateMachine } from './state-machine-types';

export interface SMRuntime {
  doc: Document;
  smId: string;
  currentStateId: string;
  /** Current input values keyed by input id. */
  inputs: Record<string, boolean | number>;
  /** Active transition, or null when idle. */
  activeTransition: SMTransition | null;
  /** Active transition progress [0,1], or null when idle. */
  transitionProgress: number | null;
}

export function createStateMachineRuntime(doc: Document, smId: string): SMRuntime {
  const sm = getStateMachine(doc, smId);
  if (!sm) throw new Error(`State machine not found: ${smId}`);
  const entry = findEntryState(doc, smId);
  if (!entry) throw new Error(`State machine has no entry state: ${smId}`);
  const inputs: Record<string, boolean | number> = {};
  for (const input of sm.inputs) {
    inputs[input.id] = input.defaultValue ?? (input.type === 'boolean' ? false : 0);
  }
  return {
    doc,
    smId,
    currentStateId: entry.id,
    inputs,
    activeTransition: null,
    transitionProgress: null,
  };
}

export function getStateMachineFromRuntime(runtime: SMRuntime): StateMachine | undefined {
  return getStateMachine(runtime.doc, runtime.smId);
}

export function getCurrentState(runtime: SMRuntime): SMState | undefined {
  const sm = getStateMachineFromRuntime(runtime);
  return sm?.states.find((s) => s.id === runtime.currentStateId);
}

export function getCurrentStateTimelineId(runtime: SMRuntime): string | undefined {
  return getCurrentState(runtime)?.timelineId;
}

export function getSMInputValue(runtime: SMRuntime, inputId: string): boolean | number | undefined {
  return runtime.inputs[inputId];
}

export function setSMInput(
  runtime: SMRuntime,
  inputId: string,
  value: boolean | number,
): SMRuntime {
  const sm = getStateMachineFromRuntime(runtime);
  if (!sm) return runtime;
  const input = sm.inputs.find((i) => i.id === inputId);
  if (!input) return runtime;

  const nextInputs = { ...runtime.inputs, [inputId]: value };
  const next: SMRuntime = { ...runtime, inputs: nextInputs };

  // Auto-evaluate transitions triggered by input changes.
  return evaluateTransition(next, 'onVariableChange');
}

export function triggerSMEvent(runtime: SMRuntime, trigger: SMTransition['trigger']): SMRuntime {
  return evaluateTransition(runtime, trigger);
}

export function advanceSMTransition(runtime: SMRuntime, deltaMs: number): SMRuntime {
  if (!runtime.activeTransition || runtime.transitionProgress === null) return runtime;
  const duration = runtime.activeTransition.duration ?? 0;
  if (duration <= 0) {
    return { ...runtime, activeTransition: null, transitionProgress: null };
  }
  const nextProgress = Math.min(1, runtime.transitionProgress + deltaMs / duration);
  if (nextProgress >= 1) {
    return { ...runtime, activeTransition: null, transitionProgress: null };
  }
  return { ...runtime, transitionProgress: nextProgress };
}

function evaluateTransition(runtime: SMRuntime, trigger: SMTransition['trigger']): SMRuntime {
  const sm = getStateMachineFromRuntime(runtime);
  if (!sm) return runtime;

  const transitions = findSMTransitions(runtime.doc, runtime.smId, runtime.currentStateId);
  for (const transition of transitions) {
    if (transition.trigger !== trigger) continue;
    if (transition.condition && !evaluateCondition(transition.condition, runtime)) continue;

    return {
      ...runtime,
      currentStateId: transition.toStateId,
      activeTransition: transition,
      transitionProgress: 0,
    };
  }

  return runtime;
}

export function evaluateCondition(condition: string, runtime: SMRuntime): boolean {
  // Safe expression evaluator: only allows input.* comparisons and basic math.
  const sanitized = condition
    .replace(/[^a-zA-Z0-9_.\s\-+*/<>=!&|()]/g, '')
    .replace(/\binputs\./g, 'inputs.');

  try {
    const inputs = buildInputValues(runtime);
    // eslint-disable-next-line no-new-func
    const result = new Function('inputs', `return ${sanitized};`)(inputs);
    return Boolean(result);
  } catch {
    return false;
  }
}

function buildInputValues(runtime: SMRuntime): Record<string, boolean | number> {
  const sm = getStateMachineFromRuntime(runtime);
  if (!sm) return {};
  const values: Record<string, boolean | number> = {};
  for (const input of sm.inputs) {
    const val = runtime.inputs[input.id];
    values[input.name] = val ?? input.defaultValue ?? (input.type === 'boolean' ? false : 0);
  }
  return values;
}
