/**
 * Action execution system — evaluates prototype actions against the current
 * state and returns action results for the runtime to apply.
 *
 * Each action is a pure function: (action, state) => ActionResult.
 * The runtime is responsible for applying action results to mutate state.
 *
 * Research basis: Figma prototype actions (navigateTo, openOverlay, etc.),
 * Framer Actions API, W3C Web Animations API for scroll/animation actions.
 */

import type { Action, PrototypeState, TransitionConfig } from './types';
import { evaluatePrototypeExpression } from './variables';

/**
 * Result of executing a prototype action.
 * The runtime uses these to apply state mutations.
 */
export type ActionResult =
  | { kind: 'navigateTo'; targetId: string; transition: TransitionConfig }
  | {
      kind: 'openOverlay';
      targetId: string;
      position?:
        | 'center'
        | 'topLeft'
        | 'topRight'
        | 'bottomLeft'
        | 'bottomRight'
        | { x: number; y: number };
      closeOnBackdrop?: boolean;
      transition: TransitionConfig;
    }
  | { kind: 'closeOverlay'; overlayId: string; transition: TransitionConfig }
  | {
      kind: 'swapWithOverlay';
      overlayId: string;
      newTargetId: string;
      transition: TransitionConfig;
    }
  | { kind: 'openURL'; url: string; newTab?: boolean }
  | { kind: 'setVariable'; variableId: string; value: string | number | boolean }
  | { kind: 'toggleVariable'; variableId: string; newValue: boolean }
  | { kind: 'toggleVisibility'; targetId: string; visible: boolean }
  | {
      kind: 'scrollTo';
      targetId: string;
      containerId?: string;
      behavior?: 'smooth' | 'instant' | 'auto';
      offset?: number;
    }
  | { kind: 'startAnimation'; targetId: string; animationId: string }
  | { kind: 'stopAnimation'; targetId: string; animationId: string }
  | { kind: 'dismiss' }
  | { kind: 'goBack' };

/**
 * Simple expression evaluator for prototype math expressions.
 * Supports patterns like "count + 1", "score * 2", etc.
 * Uses a safe evaluator — no eval, no Function constructor.
 */
export function evaluateExpression(expression: string, variables: Record<string, number>): number {
  const value = evaluatePrototypeExpression(expression, variables);
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Execute an action against the current prototype state.
 * Returns the action result describing what state changes to apply.
 */
export function executeAction(action: Action, state: PrototypeState): ActionResult {
  switch (action.kind) {
    case 'navigateTo':
      return {
        kind: 'navigateTo',
        targetId: action.targetId,
        transition: action.transition,
      };

    case 'openOverlay':
      return {
        kind: 'openOverlay',
        targetId: action.targetId,
        position: action.position,
        closeOnBackdrop: action.closeOnBackdrop,
        transition: action.transition,
      };

    case 'closeOverlay':
      return {
        kind: 'closeOverlay',
        overlayId: action.overlayId,
        transition: action.transition,
      };

    case 'swapWithOverlay':
      return {
        kind: 'swapWithOverlay',
        overlayId: action.overlayId,
        newTargetId: action.newTargetId,
        transition: action.transition,
      };

    case 'openURL':
      return {
        kind: 'openURL',
        url: action.url,
        newTab: action.newTab,
      };

    case 'setVariable': {
      let value: string | number | boolean = action.value;
      if (action.expression) {
        const currentVar = state.variables[action.variableId];
        const currentValue =
          currentVar && typeof currentVar.value === 'number'
            ? currentVar.value
            : typeof action.value === 'number'
              ? action.value
              : 0;
        const vars: Record<string, number> = {};
        vars[action.variableId] = currentValue;
        value = evaluateExpression(action.expression, vars);
      }
      return {
        kind: 'setVariable',
        variableId: action.variableId,
        value,
      };
    }

    case 'toggleVariable': {
      const current = state.variables[action.variableId];
      const newValue = !(current && current.value === true);
      return {
        kind: 'toggleVariable',
        variableId: action.variableId,
        newValue,
      };
    }

    case 'toggleVisibility': {
      return {
        kind: 'toggleVisibility',
        targetId: action.targetId,
        visible: action.visible ?? !state.visibilityOverrides[action.targetId],
      };
    }

    case 'scrollTo':
      return {
        kind: 'scrollTo',
        targetId: action.targetId,
        containerId: action.containerId,
        behavior: action.behavior,
        offset: action.offset,
      };

    case 'startAnimation':
      // animationId references Document.timelines[id] — see @varve/scene motion model
      return {
        kind: 'startAnimation',
        targetId: action.targetId,
        animationId: action.animationId,
      };

    case 'stopAnimation':
      return {
        kind: 'stopAnimation',
        targetId: action.targetId,
        animationId: action.animationId,
      };

    case 'dismiss':
      return { kind: 'dismiss' };

    case 'goBack':
      return { kind: 'goBack' };
  }
}
