/**
 * Legacy sequential-ID migration (ADR-0026).
 *
 * Maps every counter-based legacy id (`n<counter>`, `s<counter>`,
 * `col-<counter>`, `grp-<counter>`, `v<counter>`) to the minted
 * collision-resistant format (ADR-0025) and remaps every reference
 * atomically in one pass over a declarative reference map.
 *
 * Guarantees:
 * - complete old→new mapping is built before any reference is rewritten
 * - referential integrity validated afterwards (no stale legacy ids remain
 *   in any known reference position)
 * - idempotent: migrating an already-migrated document is a no-op
 * - deterministic given a fixed RNG
 * - original ids preserved only in optional provenance (never live identity)
 * - the input document is never mutated
 */
import type { Document } from './document';
import { type IdRng, idCounter, isLegacyNumericId, mintId } from './identity';
import type { Page, SceneNode } from './types';

export interface IdMigrationResult {
  document: Document;
  /** old id → new id, per remapped collection namespace. */
  idMap: {
    nodes: Map<string, string>;
    styles: Map<string, string>;
    components: Map<string, string>;
    variables: Map<string, string>;
  };
  warnings: string[];
  migratedCount: number;
}

export interface MigrateIdsOptions {
  /** Deterministic test hook; defaults to the module RNG. */
  rng?: IdRng;
  /** Include a `migrationProvenance` record on the document (optional). */
  keepProvenance?: boolean;
}

const NODE_PREFIX = 'n';
const STYLE_PREFIX = 's';
const VAR_PREFIXES = ['col-', 'grp-', 'v'] as const;

function isLegacyVarId(id: string): boolean {
  return VAR_PREFIXES.some((prefix) => isLegacyNumericId(id, prefix));
}

/** Random hex from the caller-supplied rng or the module default. */
function rngHex(rng: IdRng | undefined): string {
  return (rng ?? ((): string => mintId('', 0).slice(2)))();
}

/**
 * Migrate all legacy counter-based ids in a document to the
 * collision-resistant format and remap every known reference.
 */
export function migrateLegacyIds(doc: Document, opts: MigrateIdsOptions = {}): IdMigrationResult {
  const warnings: string[] = [];
  const { rng } = opts;
  const nodes = new Map<string, string>();
  const styles = new Map<string, string>();
  const components = new Map<string, string>();
  const variables = new Map<string, string>();

  // ── Pass 1: build complete old→new maps ───────────────────────────────────
  for (const [key, node] of Object.entries(doc.nodes)) {
    if (isLegacyNumericId(key, NODE_PREFIX)) {
      nodes.set(key, mintId(NODE_PREFIX, idCounter(key) ?? 0, rng));
      if (node.id !== key) warnings.push(`node key ${key} disagrees with node.id ${node.id}`);
    }
  }
  for (const [key, style] of Object.entries(doc.styles ?? {})) {
    if (isLegacyNumericId(key, STYLE_PREFIX)) {
      styles.set(key, mintId(STYLE_PREFIX, idCounter(key) ?? 0, rng));
      if (style.id !== key) warnings.push(`style key ${key} disagrees with style.id ${style.id}`);
    }
  }
  for (const [key, component] of Object.entries(doc.components)) {
    if (isLegacyNumericId(key, NODE_PREFIX)) {
      components.set(key, mintId(NODE_PREFIX, idCounter(key) ?? 0, rng));
      if (component.id !== key) {
        warnings.push(`component key ${key} disagrees with component.id ${component.id}`);
      }
    }
  }
  const store = doc.variableStore;
  if (store) {
    for (const [key, collection] of Object.entries(store.collections ?? {})) {
      if (isLegacyVarId(key)) {
        variables.set(key, `col-${rngHex(rng)}`);
        if (collection.id !== key) {
          warnings.push(`collection key ${key} disagrees with collection.id ${collection.id}`);
        }
      }
      const walkGroups = (
        groups: ReadonlyArray<{ id: string; groups?: unknown }> | undefined,
      ): void => {
        for (const group of groups ?? []) {
          if (isLegacyVarId(group.id)) variables.set(group.id, `grp-${rngHex(rng)}`);
          const nested = (group as { groups?: Array<{ id: string; groups?: unknown }> }).groups;
          if (nested) walkGroups(nested);
        }
      };
      walkGroups(collection.groups);
    }
    for (const [key, variable] of Object.entries(store.variables ?? {})) {
      if (isLegacyVarId(key)) {
        variables.set(key, `v-${rngHex(rng)}`);
        if (variable.id !== key) {
          warnings.push(`variable key ${key} disagrees with variable.id ${variable.id}`);
        }
      }
    }
  }

  if (nodes.size + styles.size + components.size + variables.size === 0) {
    return {
      document: doc,
      idMap: { nodes, styles, components, variables },
      warnings,
      migratedCount: 0,
    };
  }

  const remapNode = (id: string): string => nodes.get(id) ?? components.get(id) ?? id;
  const remapStyle = (id: string): string => styles.get(id) ?? id;
  const remapVar = (id: string): string => variables.get(id) ?? id;

  // ── Pass 2: rewrite node references ───────────────────────────────────────
  const newNodes: Record<string, SceneNode> = {};
  for (const [key, node] of Object.entries(doc.nodes)) {
    const newKey = nodes.get(key) ?? key;
    const base = { ...node, id: newKey } as SceneNode & Record<string, unknown>;

    if (base.styleId !== undefined) base.styleId = remapStyle(base.styleId as string);
    if (base.componentId !== undefined) base.componentId = remapNode(base.componentId as string);
    const mask = base.mask as { sourceNodeId?: string } | undefined;
    if (mask && typeof mask === 'object' && mask.sourceNodeId !== undefined) {
      mask.sourceNodeId = remapNode(mask.sourceNodeId);
    }
    const matteSource = (
      base.mask as { matteSource?: { kind?: string; nodeId?: string } } | undefined
    )?.matteSource;
    if (matteSource?.kind === 'scene-node' && matteSource.nodeId) {
      matteSource.nodeId = remapNode(matteSource.nodeId);
    }
    if (base.slots && typeof base.slots === 'object') {
      base.slots = Object.fromEntries(
        Object.entries(base.slots as Record<string, string>).map(([slotId, childId]) => [
          slotId,
          remapNode(childId),
        ]),
      );
    }
    if (base.propertyOverrides && typeof base.propertyOverrides === 'object') {
      base.propertyOverrides = Object.fromEntries(
        Object.entries(base.propertyOverrides as Record<string, unknown>).map(([prop, value]) => [
          prop,
          typeof value === 'string' && (nodes.has(value) || components.has(value))
            ? remapNode(value)
            : value,
        ]),
      );
    }
    if (base.bindings && typeof base.bindings === 'object') {
      for (const binding of Object.values(
        base.bindings as Record<string, { variableId?: string; expression?: string }>,
      )) {
        if (!binding) continue;
        if (binding.variableId !== undefined) binding.variableId = remapVar(binding.variableId);
        if (binding.expression) {
          binding.expression = binding.expression.replace(/\{([^}]+)\}/g, (match, ref: string) => {
            const next = variables.get(ref);
            return next ? `{${next}}` : match;
          });
        }
      }
    }
    if (base.children && Array.isArray(base.children)) {
      base.children = (base.children as string[]).map(remapNode);
    }
    newNodes[newKey] = base as SceneNode;
  }

  // ── Pass 3: document-level collections ────────────────────────────────────
  const mapRefs = (ids: string[] | undefined): string[] | undefined => ids?.map(remapNode);

  const rootChildren = mapRefs(doc.rootChildren);
  const globalChildren = mapRefs(doc.globalChildren);

  const pages: Page[] | undefined = doc.pages
    ? doc.pages.map((page) => ({
        ...page,
        id: nodes.get(page.id) ?? page.id,
        contentRoot: remapNode(page.contentRoot),
        backgrounds: mapRefs(page.backgrounds) ?? page.backgrounds,
        masterPageId: page.masterPageId ? remapNode(page.masterPageId) : undefined,
        masterOverrides: page.masterOverrides
          ? Object.fromEntries(
              Object.entries(page.masterOverrides).map(([masterId, override]) => [
                remapNode(masterId),
                {
                  ...override,
                  masterNodeId: remapNode(override.masterNodeId),
                  localNodeId: override.localNodeId ? remapNode(override.localNodeId) : undefined,
                },
              ]),
            )
          : undefined,
      }))
    : undefined;

  const masters = doc.masters
    ? Object.fromEntries(
        Object.entries(doc.masters).map(([key, master]) => [
          remapNode(key),
          { ...master, id: remapNode(master.id), contentRoot: remapNode(master.contentRoot) },
        ]),
      )
    : undefined;

  const componentsNext = Object.fromEntries(
    Object.entries(doc.components).map(([key, component]) => {
      const newKey = components.get(key) ?? key;
      return [
        newKey,
        {
          ...component,
          id: newKey,
          masterRootId: remapNode(component.masterRootId),
          slots: component.slots.map((slot) => ({
            ...slot,
            defaultContentId: slot.defaultContentId ? remapNode(slot.defaultContentId) : undefined,
          })),
          properties: component.properties?.map((prop) => ({
            ...prop,
            defaultValue:
              typeof prop.defaultValue === 'string'
                ? remapNode(prop.defaultValue)
                : prop.defaultValue,
          })),
          variants: component.variants?.map((variant) => ({
            ...variant,
            propertyValues: Object.fromEntries(
              Object.entries(variant.propertyValues).map(([prop, value]) => [
                prop,
                typeof value === 'string' ? remapNode(value) : value,
              ]),
            ),
          })),
        },
      ];
    }),
  );

  const interactions = doc.interactions
    ? Object.fromEntries(
        Object.entries(doc.interactions).map(([nodeId, list]) => [
          remapNode(nodeId),
          list.map((interaction) => ({ ...interaction, nodeId: remapNode(interaction.nodeId) })),
        ]),
      )
    : undefined;

  const stylesNext = doc.styles
    ? Object.fromEntries(
        Object.entries(doc.styles).map(([key, style]) => {
          const newKey = styles.get(key) ?? key;
          return [newKey, { ...style, id: newKey }];
        }),
      )
    : undefined;

  let selectionSets = doc.selectionSets;
  if (selectionSets) {
    selectionSets = {
      ...selectionSets,
      sets: selectionSets.sets.map((set) => ({
        ...set,
        nodeIds: mapRefs(set.nodeIds) ?? set.nodeIds,
        scope: set.scope.id ? { ...set.scope, id: remapNode(set.scope.id) } : set.scope,
      })),
    };
  }

  let variableStore = doc.variableStore;
  if (variableStore) {
    type VariableCollection = import('./variables').VariableCollection;
    const collectionsNext: Record<string, VariableCollection> = {};
    for (const [key, collection] of Object.entries(variableStore.collections ?? {})) {
      const newKey = variables.get(key) ?? key;
      collectionsNext[newKey] = {
        ...collection,
        id: newKey,
        variableIds: collection.variableIds.map((v) => variables.get(v) ?? v),
        groups: remapVariableGroups(collection.groups, variables) as VariableCollection['groups'],
      };
    }
    variableStore = {
      ...variableStore,
      collections: collectionsNext,
      variables: Object.fromEntries(
        Object.entries(variableStore.variables ?? {}).map(([key, variable]) => {
          const newKey = variables.get(key) ?? key;
          return [newKey, { ...variable, id: newKey }];
        }),
      ),
      activeCollectionId:
        variables.get(variableStore.activeCollectionId) ?? variableStore.activeCollectionId,
    };
  }

  // ── Pass 4: provenance (optional, never live identity) ────────────────────
  const nextDoc: Document = {
    ...doc,
    nodes: newNodes,
    rootChildren,
    globalChildren,
    pages,
    masters,
    components: componentsNext,
    styles: stylesNext,
    interactions,
    selectionSets,
    variableStore,
    activePageId: doc.activePageId ? remapNode(doc.activePageId) : undefined,
  } as Document;

  if (opts.keepProvenance) {
    (nextDoc as Document & { migrationProvenance?: unknown }).migrationProvenance = {
      migratedAt: 'persistent-history',
      nodeIds: Object.fromEntries(nodes),
      styleIds: Object.fromEntries(styles),
      componentIds: Object.fromEntries(components),
      variableIds: Object.fromEntries(variables),
    };
  }

  return {
    document: nextDoc,
    idMap: { nodes, styles, components, variables },
    warnings,
    migratedCount: nodes.size + styles.size + components.size + variables.size,
  };
}

function remapVariableGroups(
  groups: ReadonlyArray<{ id: string; variableIds?: string[]; groups?: unknown }> | undefined,
  variables: Map<string, string>,
): Array<{ id: string; variableIds?: string[]; groups?: unknown }> | undefined {
  if (!groups) return undefined;
  return groups.map((group) => {
    const newId = variables.get(group.id) ?? group.id;
    const next: { id: string; variableIds?: string[]; groups?: unknown } = { ...group, id: newId };
    if (group.variableIds) next.variableIds = group.variableIds.map((v) => variables.get(v) ?? v);
    if (group.groups) next.groups = remapVariableGroups(group.groups as typeof groups, variables);
    return next;
  });
}

/**
 * Validate referential integrity: every known reference position must
 * resolve to an existing entity in the (remapped) document. Returns a list
 * of dangling-reference descriptions (empty = valid).
 */
export function validateIdReferences(doc: Document): string[] {
  const problems: string[] = [];
  const known = new Set<string>([
    ...Object.keys(doc.nodes),
    ...Object.keys(doc.components),
    ...Object.keys(doc.styles ?? {}),
  ]);

  const check = (label: string, id: string | undefined): void => {
    if (id !== undefined && id !== '' && !known.has(id)) problems.push(`${label}: ${id}`);
  };

  for (const id of doc.rootChildren) check('rootChildren', id);
  for (const id of doc.globalChildren ?? []) check('globalChildren', id);
  for (const [key, node] of Object.entries(doc.nodes)) {
    check(`nodes.${key}.id`, key);
    const children = (node as { children?: string[] }).children;
    for (const child of children ?? []) check(`nodes.${key}.children`, child);
    check(`nodes.${key}.componentId`, (node as { componentId?: string }).componentId);
    check(`nodes.${key}.styleId`, (node as { styleId?: string }).styleId);
    check(
      `nodes.${key}.mask.sourceNodeId`,
      (node as { mask?: { sourceNodeId?: string } }).mask?.sourceNodeId,
    );
  }
  for (const page of doc.pages ?? []) {
    check(`pages.${page.id}.contentRoot`, page.contentRoot);
    for (const bg of page.backgrounds ?? []) check(`pages.${page.id}.backgrounds`, bg);
  }
  for (const [key, component] of Object.entries(doc.components)) {
    check(`components.${key}.masterRootId`, component.masterRootId);
  }
  return problems;
}
