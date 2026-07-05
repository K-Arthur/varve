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

export type VariableValue = string | number | boolean;

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

export function deleteVariable(store: VariableStore, id: string): VariableStore {
  if (!store.variables[id]) return store;
  const vars = { ...store.variables };
  delete vars[id];
  return { ...store, variables: vars };
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
export function resolve(store: VariableStore, nameOrId: string): VariableValue {
  const v =
    store.variables[nameOrId] ?? Object.values(store.variables).find((x) => x.name === nameOrId);
  if (!v) throw new Error(`unknown variable: ${nameOrId}`);

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

  if (typeof raw === 'string' && raw.includes('{')) {
    const aliases = collectAliases(store, raw);
    return evaluate(raw, aliases);
  }

  return raw;
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

  if (typeof raw === 'string' && raw.includes('{')) {
    const aliases = collectAliases(store, raw);
    return evaluate(raw, aliases);
  }

  return raw;
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

// ── Private helpers ─────────────────────────────────────────────────────────

function collectAliases(store: VariableStore, expr: string): Record<string, number> {
  const aliases: Record<string, number> = {};
  const visited = new Set<string>();

  function walk(name: string) {
    if (visited.has(name)) return;
    visited.add(name);
    const resolved = resolve(store, name);
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
