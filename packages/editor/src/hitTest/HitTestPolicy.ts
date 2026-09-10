import type { NodeId, SceneNode } from '@varve/scene';
import type { HitTestPolicyName } from './policyTypes';

export type { HitTestPolicyName } from './policyTypes';

export interface HitTestPolicy {
  tolerancePx: number;
  strokeTolerancePx: number;
  includeLocked: boolean;
  includeHidden: boolean;
  includeContainers: boolean;
  preferLeaves: boolean;
  includeTransparentFill: boolean;
  alphaTestImages: boolean;
  respectClips: boolean;
  scopeRootId?: NodeId | null;
  returnFirstHit: boolean;
  maxCandidates: number;
  stopAtContainerBoundary: boolean;
}

export const HIT_TEST_POLICIES = {
  hover: {
    tolerancePx: 6,
    strokeTolerancePx: 4,
    includeLocked: false,
    includeHidden: false,
    includeContainers: true,
    preferLeaves: false,
    includeTransparentFill: true,
    alphaTestImages: false,
    respectClips: true,
    scopeRootId: undefined,
    returnFirstHit: true,
    maxCandidates: 0,
    stopAtContainerBoundary: false,
  } satisfies HitTestPolicy,

  click: {
    tolerancePx: 8,
    strokeTolerancePx: 6,
    includeLocked: false,
    includeHidden: false,
    includeContainers: true,
    preferLeaves: false,
    includeTransparentFill: false,
    alphaTestImages: false,
    respectClips: true,
    scopeRootId: undefined,
    returnFirstHit: true,
    maxCandidates: 0,
    stopAtContainerBoundary: false,
  } satisfies HitTestPolicy,

  deepSelect: {
    tolerancePx: 8,
    strokeTolerancePx: 6,
    includeLocked: false,
    includeHidden: false,
    includeContainers: false,
    preferLeaves: true,
    includeTransparentFill: true,
    alphaTestImages: false,
    respectClips: true,
    scopeRootId: undefined,
    returnFirstHit: false,
    maxCandidates: 32,
    stopAtContainerBoundary: false,
  } satisfies HitTestPolicy,

  touch: {
    tolerancePx: 12,
    strokeTolerancePx: 10,
    includeLocked: false,
    includeHidden: false,
    includeContainers: true,
    preferLeaves: false,
    includeTransparentFill: true,
    alphaTestImages: false,
    respectClips: true,
    scopeRootId: undefined,
    returnFirstHit: true,
    maxCandidates: 0,
    stopAtContainerBoundary: false,
  } satisfies HitTestPolicy,

  pen: {
    tolerancePx: 6,
    strokeTolerancePx: 5,
    includeLocked: false,
    includeHidden: false,
    includeContainers: true,
    preferLeaves: false,
    includeTransparentFill: false,
    alphaTestImages: false,
    respectClips: true,
    scopeRootId: undefined,
    returnFirstHit: true,
    maxCandidates: 0,
    stopAtContainerBoundary: false,
  } satisfies HitTestPolicy,

  contextMenu: {
    tolerancePx: 4,
    strokeTolerancePx: 3,
    includeLocked: false,
    includeHidden: false,
    includeContainers: true,
    preferLeaves: false,
    includeTransparentFill: true,
    alphaTestImages: false,
    respectClips: true,
    scopeRootId: undefined,
    returnFirstHit: true,
    maxCandidates: 0,
    stopAtContainerBoundary: false,
  } satisfies HitTestPolicy,

  marquee: {
    tolerancePx: 0,
    strokeTolerancePx: 0,
    includeLocked: false,
    includeHidden: false,
    includeContainers: true,
    preferLeaves: false,
    includeTransparentFill: true,
    alphaTestImages: false,
    respectClips: true,
    scopeRootId: undefined,
    returnFirstHit: false,
    maxCandidates: 0,
    stopAtContainerBoundary: false,
  } satisfies HitTestPolicy,

  touchDeepSelect: {
    tolerancePx: 14,
    strokeTolerancePx: 12,
    includeLocked: false,
    includeHidden: false,
    includeContainers: true,
    preferLeaves: false,
    includeTransparentFill: true,
    alphaTestImages: false,
    respectClips: true,
    scopeRootId: undefined,
    returnFirstHit: false,
    maxCandidates: 64,
    stopAtContainerBoundary: false,
  } satisfies HitTestPolicy,

  debug: {
    tolerancePx: 4,
    strokeTolerancePx: 3,
    includeLocked: true,
    includeHidden: true,
    includeContainers: true,
    preferLeaves: false,
    includeTransparentFill: true,
    alphaTestImages: true,
    respectClips: true,
    scopeRootId: undefined,
    returnFirstHit: false,
    maxCandidates: 0,
    stopAtContainerBoundary: false,
  } satisfies HitTestPolicy,
} as const;

export function getPolicy(name: HitTestPolicyName): HitTestPolicy {
  return HIT_TEST_POLICIES[name];
}

export function mergePolicy(base: HitTestPolicy, overrides: Partial<HitTestPolicy>): HitTestPolicy {
  return { ...base, ...overrides };
}

export function policyForPointerType(
  pointerType: string,
  base: HitTestPolicy = HIT_TEST_POLICIES.click,
): HitTestPolicy {
  if (pointerType === 'touch') return mergePolicy(base, HIT_TEST_POLICIES.touch);
  if (pointerType === 'pen') return mergePolicy(base, HIT_TEST_POLICIES.pen);
  return base;
}

export function screenToWorldTolerance(tolerancePx: number, zoom: number): number {
  return tolerancePx / Math.max(0.001, zoom);
}

export function filterCandidatesByPolicy<T extends { nodeId: NodeId; node: SceneNode }>(
  candidates: T[],
  policy: HitTestPolicy,
  getNodeOpacity: (nodeId: NodeId) => number,
): T[] {
  return candidates.filter((c) => {
    const opacity = getNodeOpacity(c.nodeId);
    if (!policy.includeLocked && c.node.locked) return false;
    if (!policy.includeHidden && c.node.visible === false) return false;
    if (!policy.includeTransparentFill && opacity === 0) return false;
    return true;
  });
}
