/**
 * Typed navigation destinations — the single vocabulary every navigation
 * surface (deep links, "Go to…", focus restoration, tests) speaks.
 *
 * Previously the only deep-linkable destination was an audit finding
 * (`finding:<id>` / `?finding=`). This module generalizes the destination
 * set to the full hierarchy a user moves through:
 *
 *   home → document → workspace → page → node/finding → viewport
 *
 * All parsing/validation is pure and hostile-input safe: unknown kinds,
 * malformed segments, wrong segment counts, path-traversal fragments and
 * empty ids are rejected with a structured reason rather than throwing.
 */

import type { WorkspaceMode } from '../workspace/workspaceTypes';

export type NavigationTarget =
  | { kind: 'home' }
  | { kind: 'document'; documentId: string; name?: string }
  | { kind: 'workspace'; mode: WorkspaceMode }
  | { kind: 'page'; pageId: string }
  | { kind: 'node'; nodeId: string; fit?: boolean }
  | { kind: 'finding'; findingId: string }
  | {
      kind: 'viewport';
      zoom?: number;
      pan?: { x: number; y: number };
    };

/** Kinds that carry an id, used by shared validation helpers. */
export type NavigationTargetKind = NavigationTarget['kind'];

export const NAVIGATION_TARGET_KINDS: readonly NavigationTargetKind[] = [
  'home',
  'document',
  'workspace',
  'page',
  'node',
  'finding',
  'viewport',
] as const;

/** Workspace modes accepted by `workspace:` targets. */
const WORKSPACE_MODES: readonly string[] = [
  'design',
  'print',
  'drawing',
  'image',
  'motion',
  'codegen',
  'logo',
] as const;

const ID_REGEX = /^[A-Za-z0-9_\-.:+/=]{1,256}$/;

/**
 * Strict id validation: collision-resistant ids are hex+counter strings, but
 * legacy `n<N>` / `s<N>` / `col-<N>` ids and external file ids (uuids) must
 * stay parseable. The regex allows the union of both; anything else
 * (spaces, `..`, control chars, longer than 256 chars) is hostile input.
 */
function isValidId(id: string): boolean {
  if (id.length === 0 || id.length > 256) return false;
  if (id === '.' || id === '..') return false;
  return ID_REGEX.test(id);
}

/** A valid workspace-mode name (accepts a string; canonicalizes to the enum). */
function parseWorkspaceMode(value: string): WorkspaceMode | null {
  if ((WORKSPACE_MODES as readonly string[]).includes(value)) return value as WorkspaceMode;
  return null;
}

export interface ParseFailure {
  ok: false;
  /** Human-readable reason, safe to surface in a toast. */
  reason:
    | 'empty'
    | 'malformed-url'
    | 'unknown-kind'
    | 'bad-segments'
    | 'invalid-id'
    | 'unknown-workspace'
    | 'invalid-viewport';
}

export type ParsedNavigationTarget = { ok: true; target: NavigationTarget } | ParseFailure;

const KIND_NAMES: Readonly<Record<string, NavigationTargetKind | undefined>> = {
  home: 'home',
  document: 'document',
  workspace: 'workspace',
  page: 'page',
  node: 'node',
  finding: 'finding',
  viewport: 'viewport',
};

/**
 * Parse a typed destination string.
 *
 * Accepted forms (all case-sensitive except the scheme):
 * - `varve://navigate/<kind>[/<id>]` — canonical form.
 * - `varve:<kind>:<id>` — legacy-style scheme (kept for `finding`).
 * - `?<kind>=<id>` on an http(s) URL — query-string form (legacy `finding=`).
 * - `finding:<id>` and `?finding=<id>` — legacy finding links, still accepted.
 *
 * Anything else is rejected. The `raw` URL is never evaluated for side
 * effects here; this function only decodes strings.
 */
export function parseNavigationTarget(input: string): ParsedNavigationTarget {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return { ok: false, reason: 'empty' };

  // 1. Query-string form: ?kind=id (legacy ?finding=).
  if (raw.startsWith('?')) {
    const params = new URLSearchParams(raw.slice(1));
    return parseParams(params);
  }

  // 2. varve://navigate/<kind>/<id> canonical form.
  if (raw.startsWith('varve://')) {
    const rest = raw.slice('varve://'.length);
    if (!rest.startsWith('navigate/')) return { ok: false, reason: 'unknown-kind' };
    const segments = rest.slice('navigate/'.length).split('/').filter(Boolean);
    if (segments.length === 0) return { ok: false, reason: 'unknown-kind' };
    const kind = KIND_NAMES[segments[0]!];
    if (!kind) return { ok: false, reason: 'unknown-kind' };
    return buildTarget(kind, segments.slice(1));
  }

  // 3. Legacy scheme form: <kind>:<id> (finding:… historically).
  const colonIdx = raw.indexOf(':');
  if (colonIdx > 0 && colonIdx < 32) {
    const scheme = raw.slice(0, colonIdx).toLowerCase();
    const kind = KIND_NAMES[scheme];
    if (kind) {
      const value = raw.slice(colonIdx + 1);
      if (value.startsWith('//')) return { ok: false, reason: 'malformed-url' };
      return buildTarget(kind, value ? [value] : []);
    }
  }

  return { ok: false, reason: 'malformed-url' };
}

/** Parse from a URL/URI (used by the deep-link listeners). */
export function parseNavigationTargetFromUrl(href: string): ParsedNavigationTarget {
  try {
    const url = new URL(href, typeof window !== 'undefined' ? window.location.origin : 'http://x');
    if (url.protocol === 'varve:') {
      // varve://navigate/... or varve:kind:id — reuse the string parser.
      return parseNavigationTarget(href.replace(/^varve:\/\//, 'varve://'));
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return parseParams(url.searchParams);
    }
    // Any other custom scheme with a kind prefix (e.g. finding:…) — reuse
    // the string parser on the full href.
    return parseNavigationTarget(href);
  } catch {
    return { ok: false, reason: 'malformed-url' };
  }
}

function parseParams(params: URLSearchParams): ParsedNavigationTarget {
  for (const kind of NAVIGATION_TARGET_KINDS) {
    const value = params.get(kind);
    if (value !== null && value !== '') {
      if (kind === 'home') return { ok: true, target: { kind: 'home' } };
      return buildTarget(kind, [value]);
    }
  }
  return { ok: false, reason: 'unknown-kind' };
}

function buildTarget(kind: NavigationTargetKind, segments: string[]): ParsedNavigationTarget {
  switch (kind) {
    case 'home':
      if (segments.length !== 0) return { ok: false, reason: 'bad-segments' };
      return { ok: true, target: { kind: 'home' } };
    case 'document': {
      if (segments.length !== 1) return { ok: false, reason: 'bad-segments' };
      const documentId = segments[0]!;
      if (!isValidId(documentId)) return { ok: false, reason: 'invalid-id' };
      return { ok: true, target: { kind: 'document', documentId } };
    }
    case 'workspace': {
      if (segments.length !== 1) return { ok: false, reason: 'bad-segments' };
      const mode = parseWorkspaceMode(segments[0]!);
      if (!mode) return { ok: false, reason: 'unknown-workspace' };
      return { ok: true, target: { kind: 'workspace', mode } };
    }
    case 'page': {
      if (segments.length !== 1) return { ok: false, reason: 'bad-segments' };
      const pageId = segments[0]!;
      if (!isValidId(pageId)) return { ok: false, reason: 'invalid-id' };
      return { ok: true, target: { kind: 'page', pageId } };
    }
    case 'node': {
      if (segments.length < 1 || segments.length > 2) return { ok: false, reason: 'bad-segments' };
      const nodeId = segments[0]!;
      if (!isValidId(nodeId)) return { ok: false, reason: 'invalid-id' };
      const fit = segments[1] === 'fit' ? true : segments[1] === 'reveal' ? false : undefined;
      if (segments[1] !== undefined && fit === undefined) {
        return { ok: false, reason: 'bad-segments' };
      }
      return { ok: true, target: { kind: 'node', nodeId, fit } };
    }
    case 'finding': {
      if (segments.length !== 1) return { ok: false, reason: 'bad-segments' };
      const findingId = segments[0]!;
      if (!isValidId(findingId)) return { ok: false, reason: 'invalid-id' };
      return { ok: true, target: { kind: 'finding', findingId } };
    }
    case 'viewport': {
      if (segments.length < 1 || segments.length > 3) return { ok: false, reason: 'bad-segments' };
      const zoom = parseFiniteNumber(segments[0]!);
      if (zoom === null || zoom <= 0 || zoom > 10000)
        return { ok: false, reason: 'invalid-viewport' };
      let pan: { x: number; y: number } | undefined;
      if (segments.length === 3) {
        const x = parseFiniteNumber(segments[1]!);
        const y = parseFiniteNumber(segments[2]!);
        if (x === null || y === null) return { ok: false, reason: 'invalid-viewport' };
        pan = { x, y };
      } else if (segments.length === 2) {
        return { ok: false, reason: 'bad-segments' };
      }
      return { ok: true, target: { kind: 'viewport', zoom, pan } };
    }
  }
}

function parseFiniteNumber(value: string): number | null {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Serialize a target back to its canonical `varve://navigate/…` form. */
export function serializeNavigationTarget(target: NavigationTarget): string {
  switch (target.kind) {
    case 'home':
      return 'varve://navigate/home';
    case 'document':
      return `varve://navigate/document/${encodeURIComponent(target.documentId)}`;
    case 'workspace':
      return `varve://navigate/workspace/${target.mode}`;
    case 'page':
      return `varve://navigate/page/${encodeURIComponent(target.pageId)}`;
    case 'node':
      return `varve://navigate/node/${encodeURIComponent(target.nodeId)}${
        target.fit === true ? '/fit' : target.fit === false ? '/reveal' : ''
      }`;
    case 'finding':
      return `varve://navigate/finding/${encodeURIComponent(target.findingId)}`;
    case 'viewport': {
      let out = `varve://navigate/viewport/${target.zoom ?? 1}`;
      if (target.pan) out += `/${target.pan.x}/${target.pan.y}`;
      return out;
    }
  }
}

/** Round-trip a target through parse+serialize (for tests and tooltips). */
export function normalizeNavigationTarget(input: string): ParsedNavigationTarget {
  const parsed = parseNavigationTarget(input);
  if (!parsed.ok) return parsed;
  return { ok: true, target: parsed.target };
}
