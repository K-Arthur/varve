/**
 * Section visibility state — centralized collapse/hidden/preferences state
 * for all Inspector panel sections.
 *
 * Stored in EditorSettings (localStorage), separate from document undo/redo.
 * Each section has:
 * - collapsed: header visible, body hidden (user toggled)
 * - hidden: entire section removed from flow (user explicitly hid it)
 *
 * "Unavailable" is computed at render time from the registry's availability
 * predicates — it is NOT stored in user preferences.
 *
 * Research basis: Figma section visibility, VS Code panel organization.
 */
import {
  getAllSectionIds,
  getHideableSectionIds,
  getSectionDefinition,
  type SectionId,
} from './sectionRegistry';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface SectionState {
  collapsed: boolean;
  hidden: boolean;
  /** Nested subsections, keyed by local name (e.g. 'openTypeFeatures' under 'typography'). */
  subsections?: Record<string, SectionState>;
}

/** Full section-visibility state keyed by section ID. */
export type SectionVisibilityState = Record<SectionId, SectionState>;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function defaultStateForSection(sectionId: SectionId): SectionState {
  const def = getSectionDefinition(sectionId);
  return {
    collapsed: def ? !def.defaultExpanded : false,
    hidden: false,
  };
}

/** Create the default visibility state for all sections. */
export function createDefaultSectionState(): SectionVisibilityState {
  const state = {} as SectionVisibilityState;
  for (const id of getAllSectionIds()) {
    state[id] = defaultStateForSection(id);
  }
  return state;
}

/** Section state schema version for migration. */
export const SECTION_STATE_VERSION = 1;

/** Persisted shape including version for safe migration. */
export interface PersistedSectionState {
  version: number;
  sections: Partial<Record<string, SectionState>>;
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/** Migrate persisted state from older versions. Unknown IDs are ignored. */
export function migrateSectionState(
  raw: Record<string, unknown> | undefined | null,
): SectionVisibilityState {
  const defaults = createDefaultSectionState();
  if (!raw || typeof raw !== 'object') return defaults;

  // Handle legacy format: may be wrapped in { version, sections } or bare record
  let sections: Record<string, unknown>;
  if ('version' in raw && 'sections' in raw) {
    const persisted = raw as unknown as PersistedSectionState;
    sections = (persisted.sections ?? {}) as Record<string, unknown>;
  } else {
    // Legacy: bare Record<SectionId, { collapsed, hidden }>
    sections = raw as Record<string, unknown>;
  }

  const result = { ...defaults };
  for (const [key, value] of Object.entries(sections)) {
    if (key in result && typeof value === 'object' && value !== null) {
      const v = value as Record<string, unknown>;
      const subsections = v.subsections as Record<string, unknown> | undefined;
      const migratedSubsections: Record<string, SectionState> | undefined = subsections
        ? Object.fromEntries(
            Object.entries(subsections)
              .filter(([, sv]) => typeof sv === 'object' && sv !== null)
              .map(([sk, sv]) => {
                const s = sv as Record<string, unknown>;
                return [
                  sk,
                  {
                    collapsed: typeof s.collapsed === 'boolean' ? s.collapsed : false,
                    hidden: typeof s.hidden === 'boolean' ? s.hidden : false,
                  },
                ];
              }),
          )
        : undefined;
      result[key as SectionId] = {
        collapsed:
          typeof v.collapsed === 'boolean' ? v.collapsed : defaults[key as SectionId].collapsed,
        hidden: typeof v.hidden === 'boolean' ? v.hidden : defaults[key as SectionId].hidden,
        ...(migratedSubsections && Object.keys(migratedSubsections).length > 0
          ? { subsections: migratedSubsections }
          : {}),
      };
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// State operations (immutable)
// ---------------------------------------------------------------------------

/** Toggle collapsed state for a section. */
export function toggleCollapsed(
  state: SectionVisibilityState,
  sectionId: SectionId,
): SectionVisibilityState {
  const current = state[sectionId] ?? defaultStateForSection(sectionId);
  return {
    ...state,
    [sectionId]: { ...current, collapsed: !current.collapsed },
  };
}

/** Set collapsed state for a section. */
export function setCollapsed(
  state: SectionVisibilityState,
  sectionId: SectionId,
  collapsed: boolean,
): SectionVisibilityState {
  const current = state[sectionId] ?? defaultStateForSection(sectionId);
  return {
    ...state,
    [sectionId]: { ...current, collapsed },
  };
}

/** Hide a section (removes from panel flow). */
export function hideSection(
  state: SectionVisibilityState,
  sectionId: SectionId,
): SectionVisibilityState {
  const current = state[sectionId] ?? defaultStateForSection(sectionId);
  return {
    ...state,
    [sectionId]: { ...current, hidden: true },
  };
}

/** Show a previously hidden section. */
export function showSection(
  state: SectionVisibilityState,
  sectionId: SectionId,
): SectionVisibilityState {
  const current = state[sectionId] ?? defaultStateForSection(sectionId);
  return {
    ...state,
    [sectionId]: { ...current, hidden: false },
  };
}

/** Show all hidden sections in a panel. */
export function showAllSections(state: SectionVisibilityState): SectionVisibilityState {
  const next = { ...state };
  for (const id of getAllSectionIds()) {
    const current = next[id] ?? defaultStateForSection(id);
    if (current.hidden) {
      next[id] = { ...current, hidden: false };
    }
  }
  return next;
}

/** Restore all sections to their default collapsed/hidden state. */
export function restoreDefaultSectionState(_state: SectionVisibilityState): SectionVisibilityState {
  return createDefaultSectionState();
}

/** Restore only collapsed state to defaults (keep hidden preferences). */
export function restoreDefaultCollapsed(state: SectionVisibilityState): SectionVisibilityState {
  const next = { ...state };
  for (const id of getAllSectionIds()) {
    const current = next[id] ?? defaultStateForSection(id);
    const def = getSectionDefinition(id);
    next[id] = {
      ...current,
      collapsed: def ? !def.defaultExpanded : false,
    };
  }
  return next;
}

/** Hide all optional (non-essential) sections. */
export function hideOptionalSections(state: SectionVisibilityState): SectionVisibilityState {
  const next = { ...state };
  for (const id of getHideableSectionIds()) {
    const current = next[id] ?? defaultStateForSection(id);
    next[id] = { ...current, hidden: true };
  }
  return next;
}

// ---------------------------------------------------------------------------
// Nested subsection state operations
// ---------------------------------------------------------------------------

/** Get the sub-section state, or a default if not set. */
function getSubsectionState(
  state: SectionVisibilityState,
  sectionId: SectionId,
  subId: string,
): SectionState {
  const parent = state[sectionId];
  if (!parent?.subsections) {
    return { collapsed: false, hidden: false };
  }
  return parent.subsections[subId] ?? { collapsed: false, hidden: false };
}

/** Toggle collapsed state for a nested subsection. */
export function toggleSubSectionCollapsed(
  state: SectionVisibilityState,
  sectionId: SectionId,
  subId: string,
): SectionVisibilityState {
  const current = getSubsectionState(state, sectionId, subId);
  const parent = state[sectionId] ?? defaultStateForSection(sectionId);
  return {
    ...state,
    [sectionId]: {
      ...parent,
      subsections: {
        ...parent.subsections,
        [subId]: { ...current, collapsed: !current.collapsed },
      },
    },
  };
}

/** Set collapsed state for a nested subsection. */
export function setSubSectionCollapsed(
  state: SectionVisibilityState,
  sectionId: SectionId,
  subId: string,
  collapsed: boolean,
): SectionVisibilityState {
  const current = getSubsectionState(state, sectionId, subId);
  const parent = state[sectionId] ?? defaultStateForSection(sectionId);
  return {
    ...state,
    [sectionId]: {
      ...parent,
      subsections: {
        ...parent.subsections,
        [subId]: { ...current, collapsed },
      },
    },
  };
}

/** Check if a nested subsection is collapsed. */
export function isSubSectionCollapsed(
  state: SectionVisibilityState,
  sectionId: SectionId,
  subId: string,
): boolean {
  const parent = state[sectionId];
  if (!parent?.subsections) return false;
  const sub = parent.subsections[subId];
  return sub ? sub.collapsed : false;
}

/**
 * Hide a nested subsection. Hiding a subsection only persists the flag;
 * actual render-time hiding also requires the parent to be visible.
 * Returns the updated state.
 */
export function hideSubSection(
  state: SectionVisibilityState,
  sectionId: SectionId,
  subId: string,
): SectionVisibilityState {
  const current = getSubsectionState(state, sectionId, subId);
  const parent = state[sectionId] ?? defaultStateForSection(sectionId);
  return {
    ...state,
    [sectionId]: {
      ...parent,
      subsections: {
        ...parent.subsections,
        [subId]: { ...current, hidden: true },
      },
    },
  };
}

/** Show a previously hidden nested subsection. */
export function showSubSection(
  state: SectionVisibilityState,
  sectionId: SectionId,
  subId: string,
): SectionVisibilityState {
  const current = getSubsectionState(state, sectionId, subId);
  const parent = state[sectionId] ?? defaultStateForSection(sectionId);
  return {
    ...state,
    [sectionId]: {
      ...parent,
      subsections: {
        ...parent.subsections,
        [subId]: { ...current, hidden: false },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/** Get the effective visibility for a section. */
export function isSectionVisible(state: SectionVisibilityState, sectionId: SectionId): boolean {
  const s = state[sectionId];
  return s ? !s.hidden : true;
}

/** Get the effective collapsed state for a section. */
export function isSectionCollapsed(state: SectionVisibilityState, sectionId: SectionId): boolean {
  const s = state[sectionId];
  return s ? s.collapsed : !(getSectionDefinition(sectionId)?.defaultExpanded ?? true);
}

/** Count hidden sections. */
export function countHiddenSections(state: SectionVisibilityState): number {
  let count = 0;
  for (const id of getAllSectionIds()) {
    if (state[id]?.hidden) count++;
  }
  return count;
}

/** Get list of hidden section IDs. */
export function getHiddenSectionIds(state: SectionVisibilityState): SectionId[] {
  const hidden: SectionId[] = [];
  for (const id of getAllSectionIds()) {
    if (state[id]?.hidden) hidden.push(id);
  }
  return hidden;
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/** Get section IDs sorted by their effective order. */
export function getOrderedSectionIds(
  state: SectionVisibilityState,
  sectionIds?: SectionId[],
): SectionId[] {
  const ids = sectionIds ?? getAllSectionIds();
  return [...ids].sort((a, b) => {
    const orderA = state[a]?.order ?? getSectionDefinition(a)?.order ?? 500;
    const orderB = state[b]?.order ?? getSectionDefinition(b)?.order ?? 500;
    return orderA - orderB;
  });
}

/** Move a section before another section. */
export function moveSectionBefore(
  state: SectionVisibilityState,
  sectionId: SectionId,
  targetId: SectionId,
): SectionVisibilityState {
  if (sectionId === targetId) return state;
  const ordered = getOrderedSectionIds(state);
  const fromIdx = ordered.indexOf(sectionId);
  const toIdx = ordered.indexOf(targetId);
  if (fromIdx === -1 || toIdx === -1) return state;
  const reordered = [...ordered];
  reordered.splice(fromIdx, 1);
  reordered.splice(toIdx, 0, sectionId);
  return assignStableOrders(state, reordered);
}

/** Move a section after another section. */
export function moveSectionAfter(
  state: SectionVisibilityState,
  sectionId: SectionId,
  targetId: SectionId,
): SectionVisibilityState {
  if (sectionId === targetId) return state;
  const ordered = getOrderedSectionIds(state);
  const fromIdx = ordered.indexOf(sectionId);
  let toIdx = ordered.indexOf(targetId);
  if (fromIdx === -1 || toIdx === -1) return state;
  if (fromIdx < toIdx) toIdx += 1;
  const reordered = [...ordered];
  reordered.splice(fromIdx, 1);
  reordered.splice(toIdx, 0, sectionId);
  return assignStableOrders(state, reordered);
}

/** Move a section up one position. */
export function moveSectionUp(
  state: SectionVisibilityState,
  sectionId: SectionId,
): SectionVisibilityState {
  const ordered = getOrderedSectionIds(state);
  const idx = ordered.indexOf(sectionId);
  if (idx <= 0) return state;
  return moveSectionBefore(state, sectionId, ordered[idx - 1]);
}

/** Move a section down one position. */
export function moveSectionDown(
  state: SectionVisibilityState,
  sectionId: SectionId,
): SectionVisibilityState {
  const ordered = getOrderedSectionIds(state);
  const idx = ordered.indexOf(sectionId);
  if (idx === -1 || idx >= ordered.length - 1) return state;
  return moveSectionAfter(state, sectionId, ordered[idx + 1]);
}

/** Move a section to the start of the list. */
export function moveSectionToStart(
  state: SectionVisibilityState,
  sectionId: SectionId,
): SectionVisibilityState {
  const ordered = getOrderedSectionIds(state);
  if (ordered[0] === sectionId) return state;
  const reordered = [sectionId, ...ordered.filter((id) => id !== sectionId)];
  return assignStableOrders(state, reordered);
}

/** Move a section to the end of the list. */
export function moveSectionToEnd(
  state: SectionVisibilityState,
  sectionId: SectionId,
): SectionVisibilityState {
  const ordered = getOrderedSectionIds(state);
  if (ordered[ordered.length - 1] === sectionId) return state;
  const reordered = [...ordered.filter((id) => id !== sectionId), sectionId];
  return assignStableOrders(state, reordered);
}

/** Reset section ordering to registry defaults. */
export function resetSectionOrder(state: SectionVisibilityState): SectionVisibilityState {
  const next = { ...state };
  for (const id of getAllSectionIds()) {
    const def = getSectionDefinition(id);
    next[id] = { ...next[id], order: def?.order };
  }
  return next;
}

/** Assign stable integer orders (10, 20, 30...) to avoid float drift. */
function assignStableOrders(
  state: SectionVisibilityState,
  orderedIds: SectionId[],
): SectionVisibilityState {
  const next = { ...state };
  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i];
    next[id] = { ...next[id], order: (i + 1) * 10 };
  }
  return next;
}
