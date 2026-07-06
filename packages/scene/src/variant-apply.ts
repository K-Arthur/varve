/**
 * Variant property execution — applies resolved component properties to instance subtrees.
 *
 * Property-to-layer matching uses layer name === property name (Figma convention).
 */
import type { Document } from './document';
import { isContainer } from './document';
import { resolveVariantProperties } from './component';
import type { ComponentDefinition, FrameNode, NodeId, SceneNode } from './types';

/**
 * Resolve variant + instance propertyOverrides for a component instance.
 */
export function resolveVariantPropertiesForNode(
  doc: Document,
  instanceId: NodeId,
): Record<string, string | boolean | NodeId> {
  const node = doc.nodes[instanceId];
  if (node?.kind !== 'frame') return {};
  const frame = node as FrameNode;
  if (!frame.componentId) return {};

  const component = doc.components[frame.componentId];
  if (!component) return {};

  const result: Record<string, string | boolean | NodeId> = {};
  for (const prop of component.properties ?? []) {
    result[prop.name] = prop.defaultValue;
  }

  if (frame.variant) {
    Object.assign(result, resolveVariantProperties(doc, frame.componentId, frame.variant));
  }

  if (frame.propertyOverrides) {
    Object.assign(result, frame.propertyOverrides);
  }

  return result;
}

function applyPropertyToNode(
  node: SceneNode,
  propName: string,
  value: string | boolean | NodeId,
  properties: ComponentDefinition['properties'],
): SceneNode {
  const propDef = properties?.find((p) => p.name === propName);
  if (!propDef || node.name !== propName) return node;

  if (propDef.type === 'boolean' && typeof value === 'boolean') {
    return { ...node, visible: value };
  }
  if (propDef.type === 'text' && node.kind === 'text' && typeof value === 'string') {
    return { ...node, text: value };
  }
  if (propDef.type === 'instanceSwap' && node.kind === 'frame' && typeof value === 'string') {
    return { ...node, componentId: value } as SceneNode;
  }
  return node;
}

/**
 * Build effective node map for an instance subtree with variant properties applied.
 */
export function buildVariantEffectiveNodes(
  doc: Document,
  instanceId: NodeId,
): Map<NodeId, SceneNode> {
  const result = new Map<NodeId, SceneNode>();
  const instance = doc.nodes[instanceId];
  if (instance?.kind !== 'frame' || !instance.componentId) return result;

  const component = doc.components[instance.componentId];
  if (!component) return result;

  const properties = resolveVariantPropertiesForNode(doc, instanceId);

  function walk(id: NodeId) {
    const node = doc.nodes[id];
    if (!node) return;

    let effective: SceneNode = node;
    const propValue = properties[node.name];
    if (propValue !== undefined) {
      effective = applyPropertyToNode(node, node.name, propValue, component.properties);
    }
    result.set(id, effective);

    if (isContainer(node)) {
      for (const childId of node.children) {
        walk(childId);
      }
    }
  }

  walk(instanceId);
  return result;
}

/**
 * Get a single node with variant + binding overlays for render.
 */
export function getEffectiveNode(
  doc: Document,
  nodeId: NodeId,
  variantCache: Map<NodeId, Map<NodeId, SceneNode>>,
): SceneNode | undefined {
  const node = doc.nodes[nodeId];
  if (!node) return undefined;

  for (const [, cache] of variantCache) {
    const overridden = cache.get(nodeId);
    if (overridden) return overridden;
  }

  return node;
}

/**
 * Collect variant caches for all component instances in a document.
 */
export function buildAllVariantCaches(doc: Document): Map<NodeId, Map<NodeId, SceneNode>> {
  const caches = new Map<NodeId, Map<NodeId, SceneNode>>();
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (node.kind === 'frame' && (node as FrameNode).componentId) {
      caches.set(id as NodeId, buildVariantEffectiveNodes(doc, id as NodeId));
    }
  }
  return caches;
}
