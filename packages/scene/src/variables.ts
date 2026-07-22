/**
 * Variable store with collections, groups, modes, aliases + math expressions.
 *
 * Extends the flat variable store with Figma-style **collections**
 * (named groups of variables with their own mode lists) and **groups**
 * (nested folder-like organization within collections).
 *
 * Backward-compatible: the original `variables`, `modes`, `activeMode`
 * fields remain for existing consumers.
 *
 * Research basis: Figma variables (post-2023), Tokens Studio math.
 * Evaluator is a Pratt parser (expr.ts) — no `eval`, no `Function`.
 */
import { evaluate } from './expr';
import type { PropertyBinding } from './types';

export type VariableType = 'color' | 'number' | 'string' | 'boolean';

export type VariableValue = string | number | boolean | Record<string, unknown>;

export interface Variable {
  id: string;
  name: string;
  type: VariableType;
  valuesByMode: Record<string, VariableValue>;
}

/**
 * A group of variables within a collection. Supports nesting.
 */
export interface VariableGroup {
  id: string;
  name: string;
  variableIds: string[];
  groups?: VariableGroup[];
}

/**
 * A collection groups related variables with their own mode list.
 * This is the Figma-equivalent organizational layer.
 */
export interface VariableCollection {
  id: string;
  name: string;
  modes: string[];
  activeMode: string;
  variableIds: string[];
  groups?: VariableGroup[];
}

export interface VariableStore {
  /** All variables across all collections (flat map for fast lookup). */
  variables: Record<string, Variable>;
  /** Named collections of variables. */
  collections: Record<string, VariableCollection>;
  /** The currently active collection id. */
  activeCollectionId: string;
  /** Backward-compat: global modes list. */
  modes: string[];
  /** Backward-compat: global active mode. */
  activeMode: string;
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createVariableStore(modes = ['default']): VariableStore {
  return {
    variables: {},
    collections: {},
    activeCollectionId: '',
    modes,
    activeMode: modes[0] ?? 'default',
  };
}

// ── Collection operations ───────────────────────────────────────────────────

let _colIdCounter = 0;
function nextColId(): string {
  return `col-${++_colIdCounter}`;
}

let _groupIdCounter = 0;
function nextGroupId(): string {
  return `grp-${++_groupIdCounter}`;
}

export function createCollection(
  store: VariableStore,
  name: string,
  modes?: string[],
): { collection: VariableCollection; store: VariableStore } {
  const id = nextColId();
  const collection: VariableCollection = {
    id,
    name,
    modes: modes ?? [...store.modes],
    activeMode: (modes ?? store.modes)[0] ?? 'default',
    variableIds: [],
  };
  return {
    collection,
    store: {
      ...store,
      collections: { ...store.collections, [id]: collection },
      activeCollectionId: id,
    },
  };
}

export function addVariableToCollection(
  store: VariableStore,
  collectionId: string,
  variable: Omit<Variable, 'id'>,
  groupName?: string,
): { variable: Variable; store: VariableStore } {
  const collection = store.collections[collectionId];
  if (!collection) throw new Error(`Collection ${collectionId} not found`);

  const id = nextVarId();
  const newVar: Variable = { ...variable, id };
  const newVariableIds = [...collection.variableIds, id];

  let newGroups = collection.groups;
  if (groupName && newGroups) {
    newGroups = addToGroup(newGroups, groupName, id);
  } else if (groupName) {
    newGroups = [{ id: nextGroupId(), name: groupName, variableIds: [id] }];
  }

  return {
    variable: newVar,
    store: {
      ...store,
      variables: { ...store.variables, [id]: newVar },
      collections: {
        ...store.collections,
        [collectionId]: { ...collection, variableIds: newVariableIds, groups: newGroups },
      },
    },
  };
}

function addToGroup(groups: VariableGroup[], path: string, variableId: string): VariableGroup[] {
  const parts = path.split('/');
  const name = parts[0]!;
  const rest = parts.slice(1).join('/');

  const existing = groups.find((g) => g.name === name);
  if (existing) {
    if (rest) {
      return groups.map((g) =>
        g.id === existing.id ? { ...g, groups: addToGroup(g.groups ?? [], rest, variableId) } : g,
      );
    }
    return groups.map((g) =>
      g.id === existing.id ? { ...g, variableIds: [...g.variableIds, variableId] } : g,
    );
  }

  const newGroup: VariableGroup = {
    id: nextGroupId(),
    name,
    variableIds: rest ? [] : [variableId],
    groups: rest ? addToGroup([], rest, variableId) : undefined,
  };
  return [...groups, newGroup];
}

export function setActiveCollection(store: VariableStore, collectionId: string): VariableStore {
  return { ...store, activeCollectionId: collectionId };
}

export function getCollectionVariables(store: VariableStore, collectionId: string): Variable[] {
  const collection = store.collections[collectionId];
  if (!collection) return [];
  return collection.variableIds.map((id) => store.variables[id]).filter((v): v is Variable => !!v);
}

// ── Group operations ────────────────────────────────────────────────────────

export function createGroup(
  store: VariableStore,
  collectionId: string,
  name: string,
): VariableStore {
  const collection = store.collections[collectionId];
  if (!collection) return store;

  const newGroup: VariableGroup = { id: nextGroupId(), name, variableIds: [] };
  const parts = name.split('/');

  if (parts.length > 1) {
    // Path-like name: "Semantic/Text" → ensure "Semantic" exists, then nest "Text" inside
    const rootName = parts[0]!;
    const childName = parts.slice(1).join('/');
    const existingRoot = collection.groups?.find((g) => g.name === rootName);

    if (existingRoot) {
      const newGroups =
        collection.groups?.map((g) =>
          g.id === existingRoot?.id
            ? { ...g, groups: [...(g.groups ?? []), { ...newGroup, name: childName }] }
            : g,
        ) ?? [];
      return {
        ...store,
        collections: {
          ...store.collections,
          [collectionId]: { ...collection, groups: newGroups },
        },
      };
    }

    // Root doesn't exist — create it with child nested
    const rootGroup: VariableGroup = {
      id: nextGroupId(),
      name: rootName,
      variableIds: [],
      groups: [{ ...newGroup, name: childName }],
    };
    return {
      ...store,
      collections: {
        ...store.collections,
        [collectionId]: { ...collection, groups: [...(collection.groups ?? []), rootGroup] },
      },
    };
  }

  // Simple group name — add to root
  return {
    ...store,
    collections: {
      ...store.collections,
      [collectionId]: {
        ...collection,
        groups: [...(collection.groups ?? []), newGroup],
      },
    },
  };
}

// ── Mode operations ─────────────────────────────────────────────────────────

export function addModeToCollection(
  store: VariableStore,
  collectionId: string,
  mode: string,
): VariableStore {
  const collection = store.collections[collectionId];
  if (!collection) return store;
  if (collection.modes.includes(mode)) return store;

  return {
    ...store,
    collections: {
      ...store.collections,
      [collectionId]: { ...collection, modes: [...collection.modes, mode] },
    },
  };
}

export function setCollectionMode(
  store: VariableStore,
  collectionId: string,
  mode: string,
): VariableStore {
  const collection = store.collections[collectionId];
  if (!collection) return store;
  if (!collection.modes.includes(mode)) return store;
  return {
    ...store,
    collections: {
      ...store.collections,
      [collectionId]: { ...collection, activeMode: mode },
    },
  };
}

// ── Variable operations (backward-compat) ───────────────────────────────────

let _varIdCounter = 0;
function nextVarId(): string {
  return `v${++_varIdCounter}`;
}

export function addVariable(
  store: VariableStore,
  variable: Omit<Variable, 'id'>,
): { variable: Variable; store: VariableStore } {
  const id = nextVarId();
  const newVar: Variable = { ...variable, id };
  return { variable: newVar, store: { ...store, variables: { ...store.variables, [id]: newVar } } };
}

export function updateVariable(
  store: VariableStore,
  id: string,
  patch: Partial<Variable>,
): VariableStore {
  const existing = store.variables[id];
  if (!existing) return store;
  return { ...store, variables: { ...store.variables, [id]: { ...existing, ...patch } } };
}

function removeVarFromGroups(groups: VariableGroup[], variableId: string): VariableGroup[] {
  return groups.map((g) => ({
    ...g,
    variableIds: g.variableIds.filter((vid) => vid !== variableId),
    groups: g.groups ? removeVarFromGroups(g.groups, variableId) : undefined,
  }));
}

export function deleteVariable(store: VariableStore, id: string): VariableStore {
  if (!store.variables[id]) return store;

  const vars = { ...store.variables };
  delete vars[id];

  const collections = Object.fromEntries(
    Object.entries(store.collections).map(([cid, col]) => [
      cid,
      {
        ...col,
        variableIds: col.variableIds.filter((vid) => vid !== id),
        groups: col.groups ? removeVarFromGroups(col.groups, id) : undefined,
      },
    ]),
  );

  return { ...store, variables: vars, collections };
}

// ── Merge ────────────────────────────────────────────────────────────────────

/**
 * Merge variables from two stores.
 * Source takes priority on conflict (variables, collections, modes, activeMode).
 */
export function mergeVariableStores(base: VariableStore, source: VariableStore): VariableStore {
  return {
    variables: { ...base.variables, ...source.variables },
    collections: { ...base.collections, ...source.collections },
    activeCollectionId: source.activeCollectionId || base.activeCollectionId,
    modes: source.modes.length > 0 ? source.modes : base.modes,
    activeMode: source.activeMode || base.activeMode || 'default',
  };
}

// ── Resolution ──────────────────────────────────────────────────────────────

/**
 * Resolve a variable's value for the active mode.
 * Searches across all collections, or within a specific collection.
 */
export function resolve(
  store: VariableStore,
  nameOrId: string,
  resolving: Set<string> = new Set(),
): VariableValue {
  const v =
    store.variables[nameOrId] ?? Object.values(store.variables).find((x) => x.name === nameOrId);
  if (!v) throw new Error(`unknown variable: ${nameOrId}`);

  if (resolving.has(v.id)) {
    throw new Error(`circular variable reference: ${nameOrId}`);
  }
  resolving.add(v.id);

  try {
    // Determine active mode — prefer collection-specific mode
    let activeMode = store.activeMode;
    for (const col of Object.values(store.collections)) {
      if (col.variableIds.includes(v.id)) {
        activeMode = col.activeMode;
        break;
      }
    }

    const raw =
      v.valuesByMode[activeMode] ??
      v.valuesByMode.default ??
      v.valuesByMode[store.modes[0] ?? 'default'];
    if (raw === undefined) throw new Error(`no value for variable: ${nameOrId}`);

    return resolveRawValue(store, raw, resolving);
  } finally {
    resolving.delete(v.id);
  }
}

function resolveRawValue(
  store: VariableStore,
  raw: VariableValue,
  resolving: Set<string>,
): VariableValue {
  if (typeof raw !== 'string' || !raw.includes('{')) {
    return raw;
  }

  const trimmed = raw.trim();
  const pureAlias = /^\{([^}]+)\}$/.exec(trimmed);
  if (pureAlias) {
    return resolve(store, pureAlias[1]!, resolving);
  }

  const aliases = collectAliases(store, raw, resolving);
  return evaluate(raw, aliases);
}

/**
 * Resolve a variable within a specific collection context.
 */
export function resolveVariableInCollection(
  store: VariableStore,
  collectionId: string,
  nameOrId: string,
): VariableValue {
  const collection = store.collections[collectionId];
  if (!collection) throw new Error(`Collection ${collectionId} not found`);

  const v = collection.variableIds
    .map((id) => store.variables[id])
    .find((x) => x?.id === nameOrId || x?.name === nameOrId);
  if (!v) throw new Error(`unknown variable in collection: ${nameOrId}`);

  const raw =
    v.valuesByMode[collection.activeMode] ??
    v.valuesByMode.default ??
    v.valuesByMode[collection.modes[0] ?? 'default'];
  if (raw === undefined) throw new Error(`no value for variable: ${nameOrId}`);

  return resolveRawValue(store, raw, new Set());
}

export function resolveBinding(store: VariableStore, binding: PropertyBinding): VariableValue {
  const baseValue = resolve(store, binding.variableId);
  if (binding.expression && typeof baseValue === 'number') {
    const aliases: Record<string, number> = { [binding.variableId]: baseValue };
    const expr = binding.expression;
    const matches = expr.match(/\{([^}]+)\}/g);
    if (matches) {
      for (const m of matches) {
        const alias = m.slice(1, -1);
        if (!(alias in aliases)) {
          try {
            const resolved = resolve(store, alias);
            if (typeof resolved === 'number') aliases[alias] = resolved;
          } catch {
            // ignore unresolvable aliases in expression
          }
        }
      }
    }
    return evaluate(expr, aliases);
  }
  return baseValue;
}

// ── Variable change detection / dependency map ────────────────────────────

/**
 * Compare two VariableStores and return the set of variable IDs whose values
 * differ between them (including added/removed variables).
 */
export function getChangedVariableIds(
  oldStore: VariableStore | undefined,
  newStore: VariableStore | undefined,
): Set<string> {
  const changed = new Set<string>();

  if (oldStore === newStore) return changed;
  if (!oldStore && !newStore) return changed;

  const oldVars = oldStore?.variables ?? {};
  const newVars = newStore?.variables ?? {};

  const allIds = new Set([...Object.keys(oldVars), ...Object.keys(newVars)]);

  for (const id of allIds) {
    const oldVar = oldVars[id];
    const newVar = newVars[id];

    if (!oldVar || !newVar) {
      changed.add(id);
      continue;
    }

    const oldModes = oldVar.valuesByMode;
    const newModes = newVar.valuesByMode;
    const modeKeys = new Set([...Object.keys(oldModes), ...Object.keys(newModes)]);

    for (const mode of modeKeys) {
      if (oldModes[mode] !== newModes[mode]) {
        changed.add(id);
        break;
      }
    }
  }

  return changed;
}

/**
 * Walk all nodes in a document and build a map of variableId → Set<nodeId>
 * showing which nodes have bindings referencing each variable.
 *
 * Follows alias chains: if variable A = "{B}" then nodes bound to A also
 * appear in B's set.
 *
 * Accepts a nodes map and optional variable store so the function does not
 * import the Document type (avoids circular dependency between document.ts
 * and variables.ts).
 */
export function buildVariableDependencyMap(
  nodes: Record<string, { bindings?: Record<string, { variableId: string }> }>,
  store?: VariableStore,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();

  // Walk all nodes and collect direct bindings (varId → nodeId)
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (!node.bindings) continue;
    for (const binding of Object.values(node.bindings)) {
      const varId = binding.variableId;
      if (!map.has(varId)) {
        map.set(varId, new Set());
      }
      map.get(varId)!.add(nodeId);
    }
  }

  // Follow alias chains: if var A = "{B}" then nodes bound to A also depend on B
  if (store) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const [varId, deps] of map) {
        const v = store.variables[varId];
        if (!v) continue;

        for (const raw of Object.values(v.valuesByMode)) {
          if (typeof raw !== 'string') continue;
          const refs = raw.match(/\{([^}]+)\}/g);
          if (!refs) continue;

          for (const ref of refs) {
            const refName = ref.slice(1, -1);
            // Resolve refName to a variable ID (name-based or id-based lookup)
            const refVar =
              store.variables[refName] ??
              Object.values(store.variables).find((x) => x.name === refName);
            if (!refVar) continue;

            if (!map.has(refVar.id)) {
              map.set(refVar.id, new Set());
            }

            // Propagate: nodes depending on this var also depend on the alias target
            for (const nodeId of deps) {
              if (!map.get(refVar.id)!.has(nodeId)) {
                map.get(refVar.id)!.add(nodeId);
                changed = true;
              }
            }
          }
        }
      }
    }
  }

  return map;
}

// ── Private helpers ─────────────────────────────────────────────────────────

function collectAliases(
  store: VariableStore,
  expr: string,
  resolving: Set<string>,
): Record<string, number> {
  const aliases: Record<string, number> = {};

  function walk(name: string) {
    if (aliases[name] !== undefined) return;
    const resolved = resolve(store, name, resolving);
    if (typeof resolved !== 'number') {
      throw new Error(`Alias '${name}' must be numeric for math, got ${typeof resolved}`);
    }
    aliases[name] = resolved;
  }

  const matches = expr.match(/\{([^}]+)\}/g);
  if (matches) {
    for (const m of matches) {
      walk(m.slice(1, -1));
    }
  }

  return aliases;
}
