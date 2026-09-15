/**
 * Canonical, same-application route validation for auxiliary panel windows.
 *
 * A caller can choose the panel/session transaction metadata, but it cannot
 * turn the window service into a general navigation primitive. The editor
 * performs the stricter panel-registry and broker admission checks; this
 * boundary ensures only bounded, inert query data reaches a new webview.
 */

import { isWorkspaceWindowId, type WorkspaceWindowId } from './types';

const PANEL_WINDOW_SURFACE = 'panel-window';
const ALLOWED_QUERY_KEYS = new Set([
  'surface',
  'windowId',
  'session',
  'panels',
  'transaction',
  'panelInstanceId',
  'generation',
]);
const SAFE_ROUTE_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_PANEL_TYPES_PER_ROUTE = 8;

export interface PanelWindowRoute {
  readonly windowId: WorkspaceWindowId;
  readonly params: URLSearchParams;
}

function hasOne(params: URLSearchParams, key: string, expected?: string): boolean {
  const values = params.getAll(key);
  return values.length === 1 && (expected === undefined || values[0] === expected);
}

function hasOptionalSafeToken(params: URLSearchParams, key: string): boolean {
  const values = params.getAll(key);
  return values.length === 0 || (values.length === 1 && SAFE_ROUTE_TOKEN.test(values[0] ?? ''));
}

function hasOptionalPanelList(params: URLSearchParams): boolean {
  const values = params.getAll('panels');
  if (values.length === 0) return true;
  if (values.length !== 1) return false;
  const panelIds = (values[0] ?? '').split(',');
  return (
    panelIds.length > 0 &&
    panelIds.length <= MAX_PANEL_TYPES_PER_ROUTE &&
    panelIds.every((panelId) => SAFE_ROUTE_TOKEN.test(panelId))
  );
}

function hasOptionalGeneration(params: URLSearchParams): boolean {
  const values = params.getAll('generation');
  if (values.length === 0) return true;
  if (values.length !== 1 || !/^\d+$/.test(values[0] ?? '')) return false;
  const generation = Number(values[0]);
  return Number.isSafeInteger(generation) && generation >= 1;
}

/**
 * Parse an application-owned auxiliary route, returning null for every other
 * route shape. Hashes and duplicate/unknown query keys are rejected so the
 * raw route cannot carry another navigation target or unbounded side data.
 */
export function parsePanelWindowRoute(route: string): PanelWindowRoute | null {
  if (!route.startsWith('?') || route.length === 1 || route.includes('#')) return null;

  const params = new URLSearchParams(route.slice(1));
  if ([...params.keys()].some((key) => !ALLOWED_QUERY_KEYS.has(key))) return null;
  if (!hasOne(params, 'surface', PANEL_WINDOW_SURFACE) || !hasOne(params, 'windowId')) {
    return null;
  }

  const windowId = params.get('windowId');
  if (!isWorkspaceWindowId(windowId)) return null;
  if (!hasOptionalSafeToken(params, 'session')) return null;
  if (!hasOptionalSafeToken(params, 'transaction')) return null;
  if (!hasOptionalSafeToken(params, 'panelInstanceId')) return null;
  if (!hasOptionalPanelList(params)) return null;
  if (!hasOptionalGeneration(params)) return null;

  return { windowId, params };
}

/** Canonical fallback route when a platform caller supplies only a window id. */
export function defaultPanelWindowRoute(windowId: WorkspaceWindowId): string {
  return `?${new URLSearchParams({ surface: PANEL_WINDOW_SURFACE, windowId }).toString()}`;
}
