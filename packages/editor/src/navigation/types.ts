export type NavigationStep =
  | 'resolve'
  | 'check-stale'
  | 'resolve-subject'
  | 'switch-page'
  | 'expand-layers'
  | 'select-nodes'
  | 'zoom-canvas'
  | 'open-inspector'
  | 'expand-section'
  | 'flash-target'
  | 'done';

export interface NavigationResult {
  step: NavigationStep;
  ok: boolean;
  error?: string;
  findingId: string;
}

export interface FindingNavigationOptions {
  signal?: AbortSignal;
  skipSteps?: Set<NavigationStep>;
  onStep?: (step: NavigationStep) => void;
  preferFit?: boolean;
}

export interface SubjectResolution {
  kind: 'node' | 'nodes' | 'page' | 'document' | 'stale' | 'unknown';
  nodeIds: string[];
  pageId?: string;
  bounds?: { x: number; y: number; w: number; h: number };
}

export interface StaleState {
  stale: boolean;
  reason: 'deleted-node' | 'different-document' | 're-scan-needed' | 'page-deleted';
  message: string;
}
