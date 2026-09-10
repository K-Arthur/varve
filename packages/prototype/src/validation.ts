/**
 * Prototype validation system — detects broken connections, missing targets,
 * orphan nodes, and configuration issues before presentation.
 *
 * Research basis: Figma prototype flow validator (orphan frames, broken
 * connections), Framer prototype error reporting, W3C link validation.
 */

import type { NodeId, PrototypeData } from './types';

export interface ValidationIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  nodeId?: NodeId;
  interactionId?: string;
}

/**
 * Validate a prototype's integrity.
 * Returns a list of issues found.
 */
export function validatePrototype(
  prototype: PrototypeData,
  allNodeIds: NodeId[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodeSet = new Set(allNodeIds);

  // Check for missing home screen
  if (prototype.homeScreenId && !nodeSet.has(prototype.homeScreenId)) {
    issues.push({
      code: 'missing-home-screen',
      severity: 'error',
      message: `Home screen "${prototype.homeScreenId}" does not exist`,
      nodeId: prototype.homeScreenId,
    });
  }

  // Track which nodes have interactions
  const nodesWithInteractions = new Set<NodeId>();

  // Validate each interaction
  for (const [nodeId, interactions] of Object.entries(prototype.interactions)) {
    for (const interaction of interactions) {
      nodesWithInteractions.add(nodeId);

      if (!interaction.enabled) {
        issues.push({
          code: 'disabled-interaction',
          severity: 'warning',
          message: `Interaction "${interaction.name}" on "${nodeId}" is disabled`,
          nodeId,
          interactionId: interaction.id,
        });
      }

      // Check action targets
      for (const action of interaction.actions) {
        if (
          action.kind === 'navigateTo' ||
          action.kind === 'openOverlay' ||
          action.kind === 'swapWithOverlay'
        ) {
          const targetId =
            action.kind === 'navigateTo'
              ? action.targetId
              : action.kind === 'openOverlay'
                ? action.targetId
                : action.newTargetId;

          if (targetId && !nodeSet.has(targetId)) {
            issues.push({
              code: 'broken-target',
              severity: 'error',
              message: `Action "${action.kind}" targets "${targetId}" which does not exist`,
              nodeId,
              interactionId: interaction.id,
            });
          }
        }

        if (action.kind === 'closeOverlay' || action.kind === 'swapWithOverlay') {
          const targetId = action.kind === 'closeOverlay' ? action.overlayId : action.overlayId;

          if (targetId && !nodeSet.has(targetId)) {
            issues.push({
              code: 'broken-target',
              severity: 'error',
              message: `Action "${action.kind}" references overlay "${targetId}" which does not exist`,
              nodeId,
              interactionId: interaction.id,
            });
          }
        }
      }
    }
  }

  // Find orphan nodes (nodes with no interactions attached)
  for (const nodeId of allNodeIds) {
    if (!nodesWithInteractions.has(nodeId) && nodeId !== prototype.homeScreenId) {
      issues.push({
        code: 'orphan-node',
        severity: 'info',
        message: `Node "${nodeId}" has no interactions attached`,
        nodeId,
      });
    }
  }

  return issues;
}
