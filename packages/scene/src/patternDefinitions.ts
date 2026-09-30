import { deepCloneSubtree } from './clone';
import { nodeWorldBounds, nodeWorldTransform } from './coordinateService';
import type { Document } from './document';
import { cryptoId } from './document-utils';
import { resolveNodePaints } from './paint';
import type {
  Fill,
  NodeId,
  PatternDefinition,
  PatternDefinitionSource,
  PatternFillData,
  SceneNode,
} from './types';

const MAX_PATTERN_DEPENDENCY_DEPTH = 16;

export interface CreatePatternFromSelectionOptions {
  id?: string;
  name?: string;
  previewSrc?: string;
  repeat?: Partial<PatternDefinition['repeat']>;
}

export interface PatternFillPlacement {
  offsetX?: number;
  offsetY?: number;
  rotation?: number;
  imageWidth?: number;
  imageHeight?: number;
  alignment?: PatternFillData['alignment'];
}

/** Copy selected artwork into an independent pattern mini-scene. */
export function createPatternDefinitionFromSelection(
  doc: Document,
  selectedIds: readonly NodeId[],
  options: CreatePatternFromSelectionOptions = {},
): { document: Document; definition: PatternDefinition } {
  const ids = [...new Set(selectedIds)].filter((id) => Boolean(doc.nodes[id]));
  if (ids.length === 0) throw new Error('Select at least one existing artwork node.');

  // Avoid adding a selected child twice when its selected ancestor already
  // brings it into the copied subtree.
  const selected = new Set(ids);
  const roots = ids.filter((id) => {
    let parent = findParent(doc, id);
    while (parent) {
      if (selected.has(parent)) return false;
      parent = findParent(doc, parent);
    }
    return true;
  });
  const bounds = roots.map((id) => nodeWorldBounds(doc, id)).filter(isRect);
  if (bounds.length === 0) throw new Error('Selected artwork has no finite vector bounds.');
  const x = Math.min(...bounds.map((item) => item.x));
  const y = Math.min(...bounds.map((item) => item.y));
  const maxX = Math.max(...bounds.map((item) => item.x + item.w));
  const maxY = Math.max(...bounds.map((item) => item.y + item.h));
  const width = maxX - x;
  const height = maxY - y;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Selected artwork must have positive finite bounds.');
  }

  const copiedArtNodeIds = collectSubtreeNodeIds(doc, roots);
  for (const nodeId of copiedArtNodeIds) {
    const node = doc.nodes[nodeId] as SceneNode & { componentId?: string };
    if (node?.componentId) {
      throw new Error('Detach component instances before creating a pattern from their artwork.');
    }
  }
  const dependencyRoots = collectPatternDependencyRoots(doc, copiedArtNodeIds);
  const cloned = deepCloneSubtree(doc.nodes, doc.nextId, roots[0]!, {
    additionalRootIds: [...roots.slice(1), ...dependencyRoots],
  });
  const sourceNodes: Record<NodeId, SceneNode> = { ...cloned.nodes };
  const originalIdByCopy = new Map(
    [...cloned.idMap].map(([sourceId, copyId]) => [copyId, sourceId]),
  );
  const copiedRootIds = roots
    .map((id) => cloned.idMap.get(id))
    .filter((id): id is NodeId => Boolean(id));
  const dependencies = new Set<string>();
  const assetIds = new Set<string>();
  const styleIds = new Set<string>();

  for (const [sourceId, clonedNode] of Object.entries(sourceNodes)) {
    const originalId = originalIdByCopy.get(sourceId);
    const original = originalId ? doc.nodes[originalId] : undefined;
    const resolved = original
      ? resolveNodePaints(original as unknown as Parameters<typeof resolveNodePaints>[0], doc)
      : (clonedNode.fills ?? []);
    // Resolving the original's paints drops the remap `deepCloneSubtree` applied
    // to `pattern.tileSrc`, so a node-id tile source would point back into this
    // document while the definition's mini-scene owns only cloned ids. Re-apply
    // the mapping, and release a tile node the clone never carried rather than
    // leave the definition referencing a node it does not own. A data URL or
    // asset handle is not a node id in `doc.nodes` and passes through untouched.
    const fills = resolved.map((fill) => {
      const tileSrc = fill.type === 'pattern' ? fill.pattern?.tileSrc : undefined;
      if (!fill.pattern || !tileSrc || !doc.nodes[tileSrc as NodeId]) return fill;
      const mapped = cloned.idMap.get(tileSrc as NodeId);
      return { ...fill, pattern: { ...fill.pattern, tileSrc: mapped ?? '' } };
    });
    for (const fill of fills) {
      if (fill.type === 'pattern' && fill.pattern?.definitionId) {
        dependencies.add(fill.pattern.definitionId);
      }
      if (fill.type === 'image' && fill.image?.assetId) assetIds.add(fill.image.assetId);
    }
    const { paintRefs: _paintRefs, ...withoutPaintRefs } = clonedNode;
    sourceNodes[sourceId] = { ...withoutPaintRefs, fills } as SceneNode;
    const styleId = (clonedNode as SceneNode & { styleId?: string }).styleId;
    if (styleId) styleIds.add(styleId);
  }

  for (const id of assetIds) {
    if (!doc.assets?.[id]) {
      throw new Error(`Selected artwork depends on missing image asset "${id}".`);
    }
  }
  for (const id of styleIds) {
    if (!doc.styles?.[id]) throw new Error(`Selected artwork depends on missing style "${id}".`);
  }
  const graphErrors = validatePatternDefinitionDependencies(doc.patternDefinitions ?? {}, doc);
  if (graphErrors.length > 0) throw new Error(graphErrors[0]);
  for (const dependencyId of dependencies) {
    if (!doc.patternDefinitions?.[dependencyId]) {
      throw new Error(`Selected artwork depends on missing pattern "${dependencyId}".`);
    }
  }

  for (const id of [...roots, ...dependencyRoots]) {
    const clonedId = cloned.idMap.get(id);
    if (!clonedId) continue;
    const node = sourceNodes[clonedId];
    if (!node) continue;
    const world = nodeWorldTransform(doc, id);
    sourceNodes[clonedId] = {
      ...node,
      transform: [world[0], world[1], world[2], world[3], world[4] - x, world[5] - y],
      rotation: 0,
    } as SceneNode;
  }

  const id = options.id ?? `pattern-${cryptoId()}`;
  if (doc.patternDefinitions?.[id]) throw new Error(`Pattern ID "${id}" already exists.`);
  const definition: PatternDefinition = {
    id,
    name: options.name?.trim() || `Pattern from ${doc.nodes[roots[0]!]?.name ?? 'selection'}`,
    revision: 1,
    cell: { x: 0, y: 0, width, height },
    repeat: {
      arrangement: 'grid',
      gapX: 0,
      gapY: 0,
      rowShift: 0,
      columnShift: 0,
      mirrorX: false,
      mirrorY: false,
      originX: 0,
      originY: 0,
      ...options.repeat,
    },
    source: {
      kind: 'vector',
      rootIds: copiedRootIds,
      nodes: sourceNodes,
      assetIds: [...assetIds].sort(),
      styleIds: [...styleIds].sort(),
      componentIds: collectComponentIds(sourceNodes),
    },
    ...(options.previewSrc ? { previewSrc: options.previewSrc, previewRevision: 1 } : {}),
    ...(dependencies.size ? { dependencyPatternIds: [...dependencies].sort() } : {}),
  };
  const definitions = { ...(doc.patternDefinitions ?? {}), [id]: definition };
  const errors = validatePatternDefinitionDependencies(definitions, doc);
  if (errors.length > 0) throw new Error(errors[0]);

  return {
    definition,
    document: { ...doc, nextId: cloned.nextId, patternDefinitions: definitions },
  };
}

/** Add an imported or generated definition after checking its source graph. */
export function addPatternDefinition(doc: Document, definition: PatternDefinition): Document {
  if (doc.patternDefinitions?.[definition.id]) {
    throw new Error(`Pattern ID "${definition.id}" already exists.`);
  }
  const definitions = { ...(doc.patternDefinitions ?? {}), [definition.id]: definition };
  const errors = validatePatternDefinitionDependencies(definitions, doc);
  if (errors.length > 0) throw new Error(errors[0]);
  return { ...doc, patternDefinitions: definitions };
}

/** Update a shared definition atomically and retain source-equivalent previews. */
export function updatePatternDefinition(
  doc: Document,
  id: string,
  update: (current: PatternDefinition) => PatternDefinition,
): Document {
  const current = doc.patternDefinitions?.[id];
  if (!current) return doc;
  const proposed = update(current);
  const sourceChanged = proposed.source !== current.source || proposed.cell !== current.cell;
  const revision = current.revision + 1;
  const previewSrc = sourceChanged ? undefined : (proposed.previewSrc ?? current.previewSrc);
  const next: PatternDefinition = {
    ...proposed,
    id: current.id,
    revision,
    previewSrc,
    previewRevision: previewSrc ? revision : undefined,
  };
  const definitions = { ...doc.patternDefinitions, [id]: next };
  const errors = validatePatternDefinitionDependencies(definitions, doc);
  if (errors.length > 0) throw new Error(errors[0]);
  return { ...doc, patternDefinitions: definitions };
}

/** Make an isolated definition copy; source nodes receive fresh identities. */
export function makePatternDefinitionUnique(
  doc: Document,
  id: string,
  options: { id?: string; name?: string } = {},
): { document: Document; definition: PatternDefinition } {
  const source = doc.patternDefinitions?.[id];
  if (!source) throw new Error(`Pattern "${id}" does not exist.`);
  const uniqueId = options.id ?? `pattern-${cryptoId()}`;
  if (doc.patternDefinitions?.[uniqueId])
    throw new Error(`Pattern ID "${uniqueId}" already exists.`);
  let nextId = doc.nextId;
  let clonedSource: PatternDefinitionSource = source.source;
  if (source.source.kind === 'vector' && source.source.rootIds.length > 0) {
    const firstRoot = source.source.rootIds[0]!;
    const cloned = deepCloneSubtree(source.source.nodes, nextId, firstRoot, {
      additionalRootIds: Object.keys(source.source.nodes).filter((nodeId) => nodeId !== firstRoot),
    });
    nextId = cloned.nextId;
    clonedSource = {
      ...source.source,
      rootIds: source.source.rootIds
        .map((rootId) => cloned.idMap.get(rootId))
        .filter((rootId): rootId is NodeId => Boolean(rootId)),
      nodes: cloned.nodes,
      assetIds: [...source.source.assetIds],
    };
  } else if (source.source.kind === 'procedural') {
    clonedSource = { ...source.source, recipe: { ...source.source.recipe } };
  } else if (source.source.kind === 'raster') {
    clonedSource = { ...source.source };
  }
  const definition: PatternDefinition = {
    ...source,
    id: uniqueId,
    name: options.name?.trim() || `${source.name} copy`,
    revision: 1,
    source: clonedSource,
    ...(source.previewSrc ? { previewRevision: 1 } : { previewRevision: undefined }),
    dependencyPatternIds: source.dependencyPatternIds
      ? [...source.dependencyPatternIds]
      : undefined,
  };
  const definitions = { ...(doc.patternDefinitions ?? {}), [uniqueId]: definition };
  const errors = validatePatternDefinitionDependencies(definitions, doc);
  if (errors.length > 0) throw new Error(errors[0]);
  return { document: { ...doc, nextId, patternDefinitions: definitions }, definition };
}

/** Create an application fill whose phase, rotation, and scale are per-fill. */
export function patternFillForDefinition(
  definition: PatternDefinition,
  placement: PatternFillPlacement = {},
  resolvedTileSrc = definition.previewRevision === definition.revision
    ? (definition.previewSrc ?? '')
    : '',
): PatternFillData {
  return {
    tileSrc: resolvedTileSrc,
    definitionId: definition.id,
    spacing: 0,
    rotation: placement.rotation ?? 0,
    ...(placement.imageWidth !== undefined ? { imageWidth: placement.imageWidth } : {}),
    ...(placement.imageHeight !== undefined ? { imageHeight: placement.imageHeight } : {}),
    logicalWidth: definition.cell.width,
    logicalHeight: definition.cell.height,
    ...(placement.offsetX !== undefined || definition.repeat.originX !== 0
      ? { offsetX: placement.offsetX ?? definition.repeat.originX }
      : {}),
    ...(placement.offsetY !== undefined || definition.repeat.originY !== 0
      ? { offsetY: placement.offsetY ?? definition.repeat.originY }
      : {}),
    alignment: placement.alignment ?? 'object',
  };
}

/** Resolve a definition's portable tile bytes from its current preview cache. */
export function patternDefinitionTileSrc(
  definition: PatternDefinition,
  assets: Document['assets'],
): string {
  if (definition.source.kind === 'raster') {
    return assets?.[definition.source.assetId]?.dataUrl ?? '';
  }
  return definition.previewRevision === definition.revision ? (definition.previewSrc ?? '') : '';
}

/** Materialize the current shared tile/repeat defaults at the engine boundary. */
export function resolvePatternDefinitionFill(
  fill: Fill,
  doc: Pick<Document, 'patternDefinitions' | 'assets'>,
): Fill {
  if (fill.type !== 'pattern' || !fill.pattern?.definitionId) return fill;
  const definition = doc.patternDefinitions?.[fill.pattern.definitionId];
  if (!definition) return fill;
  return {
    ...fill,
    pattern: {
      ...fill.pattern,
      tileSrc: patternDefinitionTileSrc(definition, doc.assets),
      logicalWidth: definition.cell.width,
      logicalHeight: definition.cell.height,
      gapX: fill.pattern.gapX ?? definition.repeat.gapX,
      gapY: fill.pattern.gapY ?? definition.repeat.gapY,
      arrangement: fill.pattern.arrangement ?? definition.repeat.arrangement,
      rowShift: fill.pattern.rowShift ?? definition.repeat.rowShift,
      columnShift: fill.pattern.columnShift ?? definition.repeat.columnShift,
      mirrorX: fill.pattern.mirrorX ?? definition.repeat.mirrorX,
      mirrorY: fill.pattern.mirrorY ?? definition.repeat.mirrorY,
      offsetX: fill.pattern.offsetX ?? definition.repeat.originX,
      offsetY: fill.pattern.offsetY ?? definition.repeat.originY,
      imageWidth: fill.pattern.imageWidth ?? definition.cell.width,
      imageHeight: fill.pattern.imageHeight ?? definition.cell.height,
    },
  };
}

/** Detect missing references, cycles, and excessive recursive depth. */
export function validatePatternDefinitionDependencies(
  definitions: Record<string, PatternDefinition>,
  context?: Pick<Document, 'nodes' | 'components' | 'paints' | 'styles'>,
): string[] {
  const errors: string[] = [];
  const state = new Map<string, 'visiting' | 'visited'>();
  const stack: string[] = [];
  const dependenciesFor = (definition: PatternDefinition): Set<string> => {
    const dependencies = new Set(definition.dependencyPatternIds ?? []);
    if (definition.source.kind !== 'vector') return dependencies;

    const visitedNodes = new Set<NodeId>();
    const pending = Object.values(definition.source.nodes);
    while (pending.length > 0) {
      const node = pending.pop()!;
      if (visitedNodes.has(node.id)) continue;
      visitedNodes.add(node.id);
      const addFill = (fill: Fill | undefined) => {
        if (fill?.type === 'pattern' && fill.pattern?.definitionId) {
          dependencies.add(fill.pattern.definitionId);
        }
      };
      for (const fill of node.fills ?? []) addFill(fill);
      for (const paintId of node.paintRefs ?? []) addFill(context?.paints?.[paintId]?.fill);
      const styleId = (node as SceneNode & { styleId?: string }).styleId;
      const style = styleId ? context?.styles?.[styleId] : undefined;
      if (style?.type === 'color') addFill(style.fill);

      const componentId = (node as SceneNode & { componentId?: string }).componentId;
      const componentRootId = componentId
        ? context?.components?.[componentId]?.masterRootId
        : undefined;
      if (componentRootId) {
        const master = context?.nodes[componentRootId];
        if (master) pending.push(master);
      }
      if ('children' in node) {
        for (const childId of node.children) {
          const child = definition.source.nodes[childId] ?? context?.nodes[childId];
          if (child) pending.push(child);
        }
      }
    }
    return dependencies;
  };
  const visit = (id: string): void => {
    const current = state.get(id);
    if (current === 'visited') return;
    if (current === 'visiting') {
      const start = stack.indexOf(id);
      errors.push(`Recursive pattern dependency: ${[...stack.slice(start), id].join(' → ')}`);
      return;
    }
    state.set(id, 'visiting');
    stack.push(id);
    const definition = definitions[id];
    for (const dependencyId of definition ? dependenciesFor(definition) : []) {
      if (!definitions[dependencyId]) {
        errors.push(`Pattern "${id}" references missing pattern "${dependencyId}".`);
        continue;
      }
      if (stack.length >= MAX_PATTERN_DEPENDENCY_DEPTH) {
        errors.push(`Pattern dependency depth exceeds ${MAX_PATTERN_DEPENDENCY_DEPTH}.`);
        break;
      }
      visit(dependencyId);
    }
    stack.pop();
    state.set(id, 'visited');
  };
  for (const id of Object.keys(definitions).sort()) visit(id);
  return [...new Set(errors)];
}

function findParent(doc: Document, targetId: NodeId): NodeId | null {
  for (const [id, node] of Object.entries(doc.nodes)) {
    if ('children' in node && node.children.includes(targetId)) return id;
  }
  return null;
}

function collectSubtreeNodeIds(doc: Document, roots: readonly NodeId[]): Set<NodeId> {
  const result = new Set<NodeId>();
  const pending = [...roots];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (result.has(id)) continue;
    const node = doc.nodes[id];
    if (!node) continue;
    result.add(id);
    if ('children' in node) pending.push(...node.children);
  }
  return result;
}

function collectPatternDependencyRoots(
  doc: Document,
  copiedArtNodeIds: ReadonlySet<NodeId>,
): NodeId[] {
  const dependencyIds = new Set<NodeId>();
  const inspected = new Set<NodeId>();
  const pending = [...copiedArtNodeIds];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (inspected.has(id)) continue;
    inspected.add(id);
    const node = doc.nodes[id];
    if (!node) continue;
    const candidates = [
      node.mask?.sourceNodeId,
      node.kind === 'text' ? node.pathTextSettings?.pathNodeId : undefined,
      ...(node.fills ?? [])
        .filter((fill) => fill.type === 'pattern')
        .map((fill) => (fill.type === 'pattern' ? fill.pattern?.tileSrc : undefined)),
    ];
    for (const reference of candidates) {
      if (!reference || !doc.nodes[reference]) continue;
      if (!copiedArtNodeIds.has(reference)) dependencyIds.add(reference);
      if (!inspected.has(reference)) pending.push(reference);
    }
  }
  return [...dependencyIds].sort();
}

function collectComponentIds(nodes: Record<NodeId, SceneNode>): string[] {
  const ids = new Set<string>();
  for (const node of Object.values(nodes)) {
    const componentId = (node as SceneNode & { componentId?: string }).componentId;
    if (componentId) ids.add(componentId);
  }
  return [...ids].sort();
}

function isRect(value: ReturnType<typeof nodeWorldBounds>): value is NonNullable<typeof value> {
  return Boolean(
    value &&
      Number.isFinite(value.x) &&
      Number.isFinite(value.y) &&
      Number.isFinite(value.w) &&
      Number.isFinite(value.h),
  );
}
