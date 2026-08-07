/**
 * Generic panel lifecycle + local-state codec for built-in panels.
 *
 * Every built-in panel that is detachable needs:
 * - DetachablePanelLifecycle (prepareForTransfer / restoreFromTransfer)
 * - PanelLocalStateCodec (bounded serialization of panel-local UI state)
 *
 * Panel-local state is captured from the panel's DOM via data attributes:
 * - data-panel-state="..." (JSON-serializable object: scroll, filter, tab, etc.)
 * Panels may attach richer state by setting data attributes on their root.
 *
 * The codec enforces the 64 KiB budget and never serializes DOM nodes,
 * functions, credentials, or document content.
 */

import {
  DEFAULT_PANEL_LOCAL_STATE_BYTES,
  type DetachablePanelLifecycle,
  type PanelLocalStateCodec,
  type PanelTransferContext,
  type PanelTransferSnapshot,
  type PanelTypeId,
} from './panelRegistry';

// ---------------------------------------------------------------------------
// DOM state capture (works for any panel with a data-panel-root)
// ---------------------------------------------------------------------------

export interface CapturedPanelDomState {
  /** Scroll position of the panel's scrollable element. */
  scrollTop?: number;
  scrollLeft?: number;
  /** Filter/search text if present. */
  filter?: string;
  /** Active tab id if present. */
  activeTab?: string;
  /** Expanded node ids for tree panels. */
  expandedNodeIds?: string[];
  /** Any extra state the panel sets via data-panel-state. */
  extra?: Record<string, unknown>;
}

const _PANEL_ROOT_SELECTOR = '[data-panel-root]';

export function capturePanelDomState(panelTypeId: string): CapturedPanelDomState {
  const root = document.querySelector(`[data-panel-root="${panelTypeId}"]`);
  if (!root) return {};

  const state: CapturedPanelDomState = {};

  const scrollable = root.querySelector('[data-panel-scroll]');
  if (scrollable instanceof HTMLElement) {
    state.scrollTop = scrollable.scrollTop;
    state.scrollLeft = scrollable.scrollLeft;
  }

  const filter = root.querySelector('[data-panel-filter]');
  if (filter instanceof HTMLInputElement) {
    state.filter = filter.value;
  }

  const activeTab = root.querySelector('[data-panel-active-tab]');
  if (activeTab instanceof HTMLElement && activeTab.dataset.panelActiveTab) {
    state.activeTab = activeTab.dataset.panelActiveTab;
  }

  const expanded = root.querySelectorAll('[data-panel-expanded="true"]');
  if (expanded.length > 0) {
    state.expandedNodeIds = [...expanded].map((el) => el.dataset.nodeId ?? '').filter(Boolean);
  }

  const extraEl =
    root instanceof HTMLElement && root.dataset.panelState
      ? root
      : root.querySelector('[data-panel-state]');
  if (extraEl instanceof HTMLElement && extraEl.dataset.panelState) {
    try {
      const parsed = JSON.parse(extraEl.dataset.panelState) as Record<string, unknown>;
      state.extra = parsed;
    } catch {
      // Ignore malformed panel state
    }
  }

  return state;
}

export function restorePanelDomState(panelTypeId: string, state: CapturedPanelDomState): void {
  const root = document.querySelector(`[data-panel-root="${panelTypeId}"]`);
  if (!root) return;

  const scrollable = root.querySelector('[data-panel-scroll]');
  if (scrollable instanceof HTMLElement) {
    if (typeof state.scrollTop === 'number') scrollable.scrollTop = state.scrollTop;
    if (typeof state.scrollLeft === 'number') scrollable.scrollLeft = state.scrollLeft;
  }

  const filter = root.querySelector('[data-panel-filter]');
  if (filter instanceof HTMLInputElement && typeof state.filter === 'string') {
    filter.value = state.filter;
  }

  const activeTab = root.querySelector('[data-panel-active-tab]');
  if (activeTab instanceof HTMLElement && state.activeTab) {
    activeTab.dataset.panelActiveTab = state.activeTab;
  }
}

// ---------------------------------------------------------------------------
// Generic lifecycle
// ---------------------------------------------------------------------------

export const PANEL_LOCAL_STATE_SCHEMA_VERSION = 1;

export function createGenericPanelLifecycle(): DetachablePanelLifecycle {
  return {
    async prepareForTransfer(context: PanelTransferContext): Promise<PanelTransferSnapshot> {
      const state = capturePanelDomState(context.panelTypeId);
      const bytes = new TextEncoder().encode(JSON.stringify(state)).byteLength;
      return {
        schemaVersion: PANEL_LOCAL_STATE_SCHEMA_VERSION,
        panelTypeId: context.panelTypeId,
        state,
        byteSize: bytes,
      };
    },
    async restoreFromTransfer(snapshot: PanelTransferSnapshot): Promise<void> {
      const state = snapshot.state as CapturedPanelDomState | undefined;
      if (state) {
        restorePanelDomState(snapshot.panelTypeId, state);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Generic bounded codec
// ---------------------------------------------------------------------------

export function createGenericPanelCodec(
  maxBytes = DEFAULT_PANEL_LOCAL_STATE_BYTES,
): PanelLocalStateCodec {
  return {
    maxBytes,
    encode(instanceState: unknown): PanelTransferSnapshot | null {
      if (instanceState === null || typeof instanceState !== 'object') return null;
      const candidate = instanceState as PanelTransferSnapshot;
      if (
        typeof candidate.schemaVersion !== 'number' ||
        typeof candidate.panelTypeId !== 'string' ||
        candidate.state === undefined
      ) {
        return null;
      }
      const bytes = new TextEncoder().encode(JSON.stringify(candidate)).byteLength;
      if (bytes > maxBytes) return null;
      return { ...candidate, byteSize: bytes };
    },
    decode(snapshot: PanelTransferSnapshot): unknown | null {
      if (snapshot.byteSize > maxBytes) return null;
      return snapshot.state;
    },
  };
}

// ---------------------------------------------------------------------------
// Per-panel wiring helper
// ---------------------------------------------------------------------------

export interface DetachablePanelWiring {
  lifecycle: DetachablePanelLifecycle;
  localStateCodec: PanelLocalStateCodec;
}

/** Shared wiring instance for all built-in detachable panels. */
let sharedWiring: DetachablePanelWiring | null = null;

export function getBuiltinDetachableWiring(): DetachablePanelWiring {
  if (!sharedWiring) {
    sharedWiring = {
      lifecycle: createGenericPanelLifecycle(),
      localStateCodec: createGenericPanelCodec(),
    };
  }
  return sharedWiring;
}

export function resetBuiltinDetachableWiring(): void {
  sharedWiring = null;
}

export type { PanelTypeId };
