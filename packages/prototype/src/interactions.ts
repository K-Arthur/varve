/**
 * Interaction processing system — finds interactions for a node, matches
 * triggers against events, evaluates conditions, and executes actions.
 *
 * Research basis: Figma prototype interaction engine (trigger→action model),
 * Framer Events API (event bubbling + conditionals).
 */

import type { Interaction, PrototypeState, ConditionDefinition, PrototypeVariable, ComparisonOperator } from './types';
import { matchTrigger, type PrototypeEvent } from './triggers';
import { executeAction, type ActionResult } from './actions';

/**
 * Result of processing an interaction.
 */
export interface ProcessedInteraction {
  interactionId: string;
  interaction: Interaction;
  actionResults: ActionResult[];
}

/**
 * Find interactions attached to a specific node.
 * Only returns enabled interactions.
 */
export function findInteractions(
  interactions: Interaction[],
  nodeId: string,
): Interaction[] {
  return interactions.filter((i) => i.nodeId === nodeId && i.enabled);
}

/**
 * Process all applicable interactions for an event.
 * Returns processed results for every matched interaction.
 */
export function processInteractions(
  interactions: Interaction[],
  event: PrototypeEvent,
  state: PrototypeState,
): ProcessedInteraction[] {
  const results: ProcessedInteraction[] = [];

  for (const interaction of interactions) {
    if (!interaction.enabled) continue;

    const nodeId = event.type === 'load' || event.type === 'timeout' || event.type === 'keydown'
      ? interaction.nodeId
      : 'nodeId' in event
        ? event.nodeId
        : interaction.nodeId;

    if (!matchTrigger(interaction.trigger, event, interaction.nodeId, state)) {
      continue;
    }

    const actionResults: ActionResult[] = [];
    for (const action of interaction.actions) {
      if (action.condition) {
        const conditionMet = evaluateCondition(action.condition, state);
        if (!conditionMet) continue;
      }
      actionResults.push(executeAction(action, state));
    }

    if (actionResults.length > 0) {
      results.push({
        interactionId: interaction.id,
        interaction,
        actionResults,
      });
    }
  }

  return results;
}

/**
 * Evaluate a condition definition against the current prototype state.
 * Supports comparison operators and logical combinators (and/or/not).
 */
export function evaluateCondition(
  condition: ConditionDefinition,
  state: PrototypeState,
): boolean {
  if ('logicalOperator' in condition) {
    switch (condition.logicalOperator) {
      case 'and':
        return condition.conditions.every((c) => evaluateCondition(c, state));
      case 'or':
        return condition.conditions.some((c) => evaluateCondition(c, state));
      case 'not':
        return !evaluateCondition(condition.condition, state);
    }
  }

  const variable = state.variables[condition.variableId];
  if (!variable) return false;

  return compareValues(variable.value, condition.operator, condition.value);
}

/**
 * Compare two values using the given comparison operator.
 */
function compareValues(
  actual: string | number | boolean,
  operator: ComparisonOperator,
  expected: string | number | boolean,
): boolean {
  switch (operator) {
    case 'equals':
      return actual === expected;
    case 'notEquals':
      return actual !== expected;
    case 'greaterThan':
      return Number(actual) > Number(expected);
    case 'lessThan':
      return Number(actual) < Number(expected);
    case 'greaterThanOrEqual':
      return Number(actual) >= Number(expected);
    case 'lessThanOrEqual':
      return Number(actual) <= Number(expected);
    case 'contains':
      return String(actual).includes(String(expected));
    case 'startsWith':
      return String(actual).startsWith(String(expected));
    case 'endsWith':
      return String(actual).endsWith(String(expected));
    default:
      return false;
  }
}
