import type { ComponentPropertyType, Document, NodeId } from '@varve/scene';
import {
  addChild,
  addComponentProperty,
  addNode,
  createComponent,
  createVariant,
  getParent,
  instantiate,
  removeNode,
} from '@varve/scene';

import type { VariantCandidate } from './componentVariantDetector';

export interface VariantPropertyAssignment {
  name: string;
  type: ComponentPropertyType;
  memberValues: Record<NodeId, string>;
}

export interface VariantAssignment {
  nodeId: NodeId;
  variantName: string;
}

export interface VariantPromotionPlan {
  componentName: string;
  masterNodeId: NodeId;
  properties: VariantPropertyAssignment[];
  variantAssignments: VariantAssignment[];
}

export interface PromoteResult {
  success: boolean;
  componentId?: NodeId;
  instanceIds?: NodeId[];
  error?: string;
}

export function buildPromotionPlan(
  candidate: VariantCandidate,
  doc: Document,
  overrides?: {
    componentName?: string;
    properties?: Array<{ name: string; type: ComponentPropertyType }>;
    variantNames?: Record<NodeId, string>;
  },
): VariantPromotionPlan {
  const masterNodeId = candidate.nodeIds[0] ?? candidate.nodeIds[0]!;
  const componentName = overrides?.componentName ?? candidate.groupName;

  const properties: VariantPropertyAssignment[] = candidate.differingProperties.map((dp) => {
    const type: ComponentPropertyType = dp.property === 'textContent' ? 'text' : 'variant';
    const memberValues: Record<NodeId, string> = {};
    for (const member of candidate.memberDetails) {
      const node = doc.nodes[member.nodeId];
      if (!node) continue;
      const value = extractPropertyValue(node, dp.property);
      if (value !== null) {
        memberValues[member.nodeId] = value;
      }
    }
    const override = overrides?.properties?.find((p) => p.name === dp.property);
    return {
      name: override?.name ?? dp.property,
      type: override?.type ?? type,
      memberValues,
    };
  });

  const variantAssignments: VariantAssignment[] = candidate.memberDetails.map((member, i) => {
    const customName = overrides?.variantNames?.[member.nodeId];
    if (customName) {
      return { nodeId: member.nodeId, variantName: customName };
    }
    const variantName = i === 0 ? 'Default' : `Variant ${i}`;
    return { nodeId: member.nodeId, variantName };
  });

  return {
    componentName,
    masterNodeId,
    properties,
    variantAssignments,
  };
}

function extractPropertyValue(
  node: import('@varve/scene').SceneNode,
  property: string,
): string | null {
  switch (property) {
    case 'fill':
      if ('fills' in node) {
        const fills = node.fills as
          | { color?: { space: string; r: number; g: number; b: number } }[]
          | undefined;
        const visible = fills?.[0];
        if (visible?.color && visible.color.space === 'rgb') {
          return `rgb(${visible.color.r},${visible.color.g},${visible.color.b})`;
        }
      }
      if ('fill' in node) {
        const f = node.fill as { space?: string; r?: number; g?: number; b?: number } | undefined;
        if (f?.space === 'rgb') return `rgb(${f.r},${f.g},${f.b})`;
      }
      return 'none';
    case 'width':
      return 'w' in node ? String((node as { w: number }).w) : null;
    case 'height':
      return 'h' in node ? String((node as { h: number }).h) : null;
    case 'opacity':
      return String((node as { opacity: number }).opacity ?? 1);
    case 'stroke':
      return 'strokes' in node
        ? ((node as { strokes: { width?: number }[] }).strokes?.[0]?.width ?? 0).toString()
        : '0';
    case 'effects':
      return 'effects' in node
        ? String((node as { effects: unknown[] }).effects?.length ?? 0)
        : 'none';
    case 'cornerRadius': {
      const cr = (node as { cornerRadius?: number | number[] }).cornerRadius;
      return Array.isArray(cr) ? String(cr[0]) : String(cr ?? 0);
    }
    case 'textContent':
      return (node as { text?: string }).text ?? '';
    case 'fontSize':
      return String((node as { fontSize?: number }).fontSize ?? 16);
    default:
      return null;
  }
}

export function promoteToVariantSet(
  doc: Document,
  _candidate: VariantCandidate,
  plan: VariantPromotionPlan,
): PromoteResult {
  const master = doc.nodes[plan.masterNodeId];
  if (master?.kind !== 'frame') {
    return { success: false, error: 'Master node must be a frame' };
  }

  const { component, doc: withDef } = createComponent(
    doc,
    plan.componentName,
    plan.masterNodeId,
    [],
  );
  let next: Document = withDef;

  for (const propDef of plan.properties) {
    const type: ComponentPropertyType = propDef.type;
    const defaultValue = propDef.memberValues[plan.masterNodeId] ?? '';
    const result = addComponentProperty(next, component.id, {
      name: propDef.name,
      type,
      defaultValue,
    });
    next = result.doc;
  }

  for (const assignment of plan.variantAssignments) {
    const propValues: Record<string, string | boolean | NodeId> = {};
    for (const propDef of plan.properties) {
      const value = propDef.memberValues[assignment.nodeId];
      if (value !== undefined) {
        propValues[propDef.name] = value;
      }
    }
    const result = createVariant(next, component.id, assignment.variantName, propValues);
    next = result.doc;
  }

  const instanceIds: NodeId[] = [];
  for (const assignment of plan.variantAssignments) {
    if (assignment.nodeId === plan.masterNodeId) continue;

    const original = next.nodes[assignment.nodeId];
    if (original?.kind !== 'frame') continue;

    const parentId = getParent(next, assignment.nodeId);
    const { node: instanceNode, doc: withInstance } = instantiate(next, component);
    next = withInstance;

    const placed: import('@varve/scene').SceneNode = {
      ...instanceNode,
      transform: original.transform,
      opacity: original.opacity,
      rotation: original.rotation,
      visible: original.visible,
      locked: original.locked,
      variant: assignment.variantName,
    };

    next = removeNode(next, assignment.nodeId);
    next = parentId ? addChild(next, parentId, placed) : addNode(next, placed);
    instanceIds.push(instanceNode.id);
  }

  return {
    success: true,
    componentId: component.id,
    instanceIds,
  };
}
