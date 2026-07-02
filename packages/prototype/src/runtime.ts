/**
 * Prototype runtime engine — event→trigger→action→state pipeline.
 *
 * The runtime maintains prototype state (current screen, variables, overlays,
 * visibility, animations) and processes events by matching triggers against
 * interactions, executing actions, and applying state mutations.
 *
 * Research basis: Figma prototype player (state-driven navigation + overlay
 * stack), Framer Motion state management, Redux-inspired action→reducer
 * pattern for predictable state transitions.
 */

import { processInteractions } from './interactions';
import type { ActionResult } from './actions';
import type { Interaction, NodeId, PrototypeState, PrototypeVariable } from './types';

/**
 * The prototype runtime instance.
 */
export interface PrototypeRuntime {
  interactions: Interaction[];
  state: PrototypeState;
  /** Pending delayed actions (for afterDelay triggers with delays) */
  pendingDelays: Array<{
    interactionId: string;
    actionIndex: number;
    resolveAt: number;
  }>;
}

/**
 * Create initial prototype state.
 */
export function createInitialState(
  currentScreenId: NodeId = '',
  variables?: Record<string, PrototypeVariable>,
): PrototypeState {
  return {
    variables: variables ?? {},
    currentScreenId,
    overlayStack: [],
    scrollPositions: {},
    visibilityOverrides: {},
    animationStates: {},
  };
}

/**
 * Create a prototype runtime.
 */
export function createRuntime(
  interactions: Interaction[],
  initialScreenId: string,
  initialVariables?: Record<string, PrototypeVariable>,
): PrototypeRuntime {
  return {
    interactions,
    state: createInitialState(initialScreenId, initialVariables),
    pendingDelays: [],
  };
}

/**
 * Handle a runtime event, return matched interaction results.
 * This is the main event→trigger→action entry point.
 */
export function handleEvent(
  runtime: PrototypeRuntime,
  event: Parameters<typeof processInteractions>[1],
) {
  return processInteractions(runtime.interactions, event, runtime.state);
}

/**
 * Apply an action result to the runtime state.
 * Mutates the runtime state directly (the runtime owns state).
 */
export function applyActionResult(runtime: PrototypeRuntime, result: ActionResult): void {
  switch (result.kind) {
    case 'navigateTo':
      runtime.state.currentScreenId = result.targetId;
      runtime.state.overlayStack = [];
      break;

    case 'openOverlay':
      if (!runtime.state.overlayStack.includes(result.targetId)) {
        runtime.state.overlayStack.push(result.targetId);
      }
      break;

    case 'closeOverlay': {
      const idx = runtime.state.overlayStack.indexOf(result.overlayId);
      if (idx >= 0) {
        runtime.state.overlayStack.splice(idx, 1);
      }
      break;
    }

    case 'swapWithOverlay': {
      const idx2 = runtime.state.overlayStack.indexOf(result.overlayId);
      if (idx2 >= 0) {
        runtime.state.overlayStack[idx2] = result.newTargetId;
      }
      break;
    }

    case 'setVariable':
      setVariable(runtime, result.variableId, result.value);
      break;

    case 'toggleVariable':
      setVariable(runtime, result.variableId, result.newValue);
      break;

    case 'toggleVisibility':
      runtime.state.visibilityOverrides[result.targetId] = result.visible;
      break;

    case 'scrollTo':
      // Scroll position is managed by the renderer; store intent
      if (result.containerId) {
        runtime.state.scrollPositions[result.containerId] = {
          x: 0,
          y: result.offset ?? 0,
        };
      }
      break;

    case 'startAnimation':
      runtime.state.animationStates[result.animationId] = 'running';
      break;

    case 'stopAnimation':
      runtime.state.animationStates[result.animationId] = 'stopped';
      break;

    case 'dismiss':
      runtime.state.overlayStack = [];
      break;

    case 'goBack':
      if (runtime.state.overlayStack.length > 0) {
        runtime.state.overlayStack.pop();
      }
      break;
  }
}

/**
 * Get a variable value from the runtime state.
 */
export function getVariable(
  runtime: PrototypeRuntime,
  variableId: string,
): string | number | boolean | undefined {
  return runtime.state.variables[variableId]?.value;
}

/**
 * Set a variable value in the runtime state.
 * Creates the variable if it doesn't exist.
 */
export function setVariable(
  runtime: PrototypeRuntime,
  variableId: string,
  value: string | number | boolean,
): void {
  const existing = runtime.state.variables[variableId];
  if (existing) {
    runtime.state.variables[variableId] = { ...existing, value };
  } else {
    runtime.state.variables[variableId] = {
      id: variableId,
      name: variableId,
      type:
        typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string',
      value,
    };
  }
}

/**
 * Get active overlay IDs from the runtime state.
 */
export function getActiveOverlays(runtime: PrototypeRuntime): string[] {
  return [...runtime.state.overlayStack];
}
