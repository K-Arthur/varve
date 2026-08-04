import type { NodeId } from '@varve/scene';

export interface RevealOptions {
  select?: boolean;
  fitViewport?: boolean;
  temporaryExpansion?: boolean;
  scrollToRow?: boolean;
  focusPanel?: boolean;
}

export interface RevealResult {
  found: boolean;
  ancestorExpansionRequired: boolean;
  expandedAncestorIds: NodeId[];
}

export interface LayerNavigationCommands {
  revealNode(nodeId: NodeId, options?: RevealOptions): RevealResult;
  revealFinding(nodeId: NodeId): RevealResult;
  nodeExists(nodeId: NodeId): boolean;
}
