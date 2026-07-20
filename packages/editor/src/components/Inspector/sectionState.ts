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
      result[key as SectionId] = {
        collapsed:
          typeof v.collapsed === 'boolean' ? v.collapsed : defaults[key as SectionId].collapsed,
        hidden: typeof v.hidden === 'boolean' ? v.hidden : defaults[key as SectionId].hidden,
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
