/**
 * document.transaction-capture — validated before/after transaction capture
 * (ADR-0017 §8.1 escape hatch).
 *
 * The editor bridge (M7) records a committed user transaction as a typed
 * operation whose payload is the deterministic semantic change list produced
 * by the `@varve/history` differ (entity-level added/removed, modified/
 * renamed deep-sets, ordered-array rewrites, grapheme text ranges). Apply
 * replays the change list over the pre-transaction document and must
 * reproduce the post-transaction document byte-for-byte (verified by
 * replayAndVerify at the history layer).
 *
 * This is NOT an untyped generic JSON patch:
 * - every change is validated (type, entity id, safe dotted path, JSON-safe
 *   values, finite numeric ranges) before it can be stored
 * - path segments are restricted to [A-Za-z0-9_-]; prototype-chain and
 *   constructor access is impossible
 * - values are JSON-safe (no functions, symbols, bigint, NaN, Infinity,
 *   undefined, or circular references)
 * - map-backed entity insertion/deletion follows the semantic collection
 *   registry (nodes/styles/paints/components/masters/assets/iconAssets/
 *   stateMachines/variables/...); ordered arrays are rewritten whole
 * - the change order is deterministic (the differ's emission order), so
 *   replay is deterministic
 *
 * Migration toward per-property typed operations continues by functional
 * area (mutation inventory, ADR-0017); this op is the capture boundary that
 * makes the persistent log complete in the interim.
 */

import type { Document } from '../../document';
import { graphemeClusters } from '../../text/grapheme';
import type { NodeId } from '../../types';
import { registerOperation } from '../registry';
import type { SemanticSummary } from '../types';

// ── Payload schema ────────────────────────────────────────────────────────────

export type CapturedChangeType =
  | 'added'
  | 'removed'
  | 'modified'
  | 'renamed'
  | 'reordered'
  | 'text';

export interface CapturedTextRanges {
  /** Grapheme-cluster range in the base document text ([start, end)). */
  baseStart: number;
  baseEnd: number;
  /** Grapheme-cluster range in the target document text ([start, end)). */
  targetStart: number;
  targetEnd: number;
}

export interface CapturedChange {
  changeType: CapturedChangeType;
  entityId: string;
  entityType: string;
  /** Full document-relative dotted path (absent for entity-level changes). */
  propertyPath?: string;
  before?: unknown;
  after?: unknown;
  textRanges?: CapturedTextRanges;
  summary: string;
}

export interface TransactionCapturePayload {
  /** The committed transaction this capture represents. */
  transactionId: string;
  /** Deterministic semantic change list (differ emission order). */
  changes: CapturedChange[];
  /** Human-readable step summary shown in the History panel. */
  summary: SemanticSummary;
  /** Canonical SHA-256 of the pre-transaction document. */
  beforeHash: string;
  /** Canonical SHA-256 of the post-transaction document. */
  afterHash: string;
}

// ── Limits (ADR-0030 security limits) ─────────────────────────────────────────

const MAX_CAPTURED_CHANGES = 20_000;
const MAX_ENTITY_ID_LENGTH = 200;
const MAX_ENTITY_TYPE_LENGTH = 40;
const MAX_SUMMARY_LENGTH = 512;
const MAX_STRING_VALUE_LENGTH = 5_000_000;
const HASH_RE = /^[0-9a-f]{64}$/;
const PATH_SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

/** Map-backed entity kinds (semantic collection registry, mirrors ADR-0028). */
const MAP_BACKED = new Set([
  'node',
  'style',
  'paint',
  'component',
  'master',
  'asset',
  'iconAsset',
  'stateMachine',
  'variable',
  'variableCollection',
  'variableMode',
]);

const CHANGE_TYPES = new Set<CapturedChangeType>([
  'added',
  'removed',
  'modified',
  'renamed',
  'reordered',
  'text',
]);

// ── Validation ────────────────────────────────────────────────────────────────

function validateSafePath(path: string): string | null {
  if (path.length === 0 || path.length > 2_000) return 'path length out of bounds';
  for (const segment of path.split('.')) {
    if (segment.length === 0) return 'empty path segment';
    if (!PATH_SEGMENT_RE.test(segment)) return `unsafe path segment: ${segment}`;
    if (segment === '__proto__' || segment === 'constructor' || segment === 'prototype') {
      return 'prototype-chain path segment is forbidden';
    }
  }
  return null;
}

/** JSON-safe deep validation: no functions, symbols, bigint, NaN, Infinity,
 *  undefined, or cycles; bounded string lengths; depth cap. */
function validateJsonSafe(value: unknown, depth: number, seen: Set<unknown>): string | null {
  if (depth > 64) return 'value nesting exceeds 64 levels';
  if (value === null || value === undefined) return null;
  const type = typeof value;
  if (type === 'string') {
    if ((value as string).length > MAX_STRING_VALUE_LENGTH)
      return 'string value exceeds size limit';
    return null;
  }
  if (type === 'number') {
    if (!Number.isFinite(value)) return 'non-finite number is forbidden';
    return null;
  }
  if (type === 'boolean') return null;
  if (type === 'function' || type === 'symbol' || type === 'bigint') {
    return 'non-serializable value type is forbidden';
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return 'circular reference is forbidden';
    seen.add(value);
    if (Array.isArray(value)) {
      if (value.length > 100_000) return 'array value exceeds size limit';
      for (const item of value) {
        const err = validateJsonSafe(item, depth + 1, seen);
        if (err) return err;
      }
    } else {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length > 100_000) return 'object value exceeds key limit';
      for (const item of entries) {
        const err = validateJsonSafe(item, depth + 1, seen);
        if (err) return err;
      }
    }
    seen.delete(value);
  }
  return null;
}

function validateChanges(changes: unknown): string | null {
  if (!Array.isArray(changes)) return 'changes must be an array';
  if (changes.length === 0) return 'changes must not be empty';
  if (changes.length > MAX_CAPTURED_CHANGES) {
    return `changes exceed ${MAX_CAPTURED_CHANGES} entries`;
  }
  for (const change of changes) {
    if (typeof change !== 'object' || change === null || Array.isArray(change)) {
      return 'each change must be an object';
    }
    const c = change as Record<string, unknown>;
    if (typeof c.changeType !== 'string' || !CHANGE_TYPES.has(c.changeType as CapturedChangeType)) {
      return `invalid changeType: ${String(c.changeType)}`;
    }
    if (typeof c.entityId !== 'string' || c.entityId.length === 0) {
      return 'change requires entityId';
    }
    if (c.entityId.length > MAX_ENTITY_ID_LENGTH) return 'entityId too long';
    if (typeof c.entityType !== 'string' || c.entityType.length === 0) {
      return 'change requires entityType';
    }
    if (c.entityType.length > MAX_ENTITY_TYPE_LENGTH) return 'entityType too long';
    if (c.propertyPath !== undefined) {
      if (typeof c.propertyPath !== 'string') return 'propertyPath must be a string';
      const err = validateSafePath(c.propertyPath);
      if (err) return `${err} (${c.propertyPath})`;
    }
    if (c.summary !== undefined && typeof c.summary !== 'string') {
      return 'change summary must be a string';
    }
    if (c.textRanges !== undefined) {
      const t = c.textRanges as unknown as CapturedTextRanges;
      if (
        !Number.isInteger(t.baseStart) ||
        !Number.isInteger(t.baseEnd) ||
        !Number.isInteger(t.targetStart) ||
        !Number.isInteger(t.targetEnd)
      ) {
        return 'textRanges must contain integers';
      }
      if (t.baseStart < 0 || t.baseEnd < t.baseStart) return 'invalid base text range';
      if (t.targetStart < 0 || t.targetEnd < t.targetStart) return 'invalid target text range';
    }
    const seen = new Set<unknown>();
    for (const key of ['before', 'after'] as const) {
      if (c[key] !== undefined) {
        const err = validateJsonSafe(c[key], 0, seen);
        if (err) return `${err} in ${key}`;
      }
    }
  }
  return null;
}

// ── Application (replay) ──────────────────────────────────────────────────────

function applyChanges(document: Document, changes: CapturedChange[]): Document {
  const next = structuredClone(document) as unknown as Record<string, unknown>;
  for (const change of changes) {
    switch (change.changeType) {
      case 'added': {
        if (!MAP_BACKED.has(change.entityType) || !change.propertyPath) continue;
        const container = resolveRecord(next, change.propertyPath, true);
        if (container !== undefined) container[change.entityId] = structuredClone(change.after);
        continue;
      }
      case 'removed': {
        if (!MAP_BACKED.has(change.entityType) || !change.propertyPath) continue;
        const container = resolveRecord(next, change.propertyPath);
        if (container !== undefined) delete container[change.entityId];
        continue;
      }
      case 'reordered': {
        setAtPath(next, change.propertyPath ?? '', structuredClone(change.after));
        continue;
      }
      case 'modified':
      case 'renamed': {
        setAtPath(next, change.propertyPath ?? '', structuredClone(change.after));
        continue;
      }
      case 'text': {
        applyTextChange(next, change);
        continue;
      }
    }
  }
  return next as unknown as Document;
}

function resolveRecord(
  root: Record<string, unknown>,
  path: string,
  createMissing = false,
): Record<string, unknown> | undefined {
  const segments = path.split('.');
  let current: unknown = root;
  for (const segment of segments) {
    if (current === undefined || current === null) return undefined;
    if (Array.isArray(current)) {
      const found = (current as Array<Record<string, unknown>>).find(
        (item) => item?.id === segment,
      );
      if (!found) return undefined;
      current = found;
    } else {
      const record = current as Record<string, unknown>;
      if (record[segment] === undefined) {
        if (!createMissing) return undefined;
        record[segment] = {};
      }
      current = record[segment];
    }
  }
  return typeof current === 'object' && current !== null && !Array.isArray(current)
    ? (current as Record<string, unknown>)
    : undefined;
}

function setAtPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  if (segments.length === 0) return;
  let current: unknown = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!;
    if (Array.isArray(current)) {
      const found = (current as Array<Record<string, unknown>>).find(
        (item) => item?.id === segment,
      );
      if (!found) return;
      current = found;
    } else if (typeof current === 'object' && current !== null) {
      const record = current as Record<string, unknown>;
      if (record[segment] === undefined || record[segment] === null) {
        record[segment] = {};
      }
      current = record[segment];
    } else {
      return;
    }
  }
  const last = segments[segments.length - 1]!;
  if (current === null || typeof current !== 'object') return;
  if (Array.isArray(current)) {
    const index = (current as Array<Record<string, unknown>>).findIndex(
      (item) => item?.id === last,
    );
    if (index < 0) return;
    (current as unknown[])[index] = value;
  } else {
    const record = current as Record<string, unknown>;
    if (value === undefined) delete record[last];
    else record[last] = value;
  }
}

function applyTextChange(root: Record<string, unknown>, change: CapturedChange): void {
  const path = change.propertyPath;
  if (!path || !change.textRanges) return;
  const containerPath = path.slice(0, path.lastIndexOf('.'));
  const node = resolveRecord(root, containerPath);
  if (!node) return;
  const currentText = node.text as string | undefined;
  if (typeof currentText !== 'string') return;
  const { baseStart, baseEnd, targetStart, targetEnd } = change.textRanges;
  const replacement = (typeof change.after === 'string' ? change.after : '').slice(
    targetStart,
    targetEnd,
  );
  node.text = spliceClusterRange(currentText, baseStart, baseEnd, replacement);
}

function spliceClusterRange(text: string, start: number, end: number, replacement: string): string {
  const clusters = graphemeClusters(text);
  let lo = start < 0 ? 0 : start;
  const hi = end > clusters.length ? clusters.length : end;
  if (lo > hi) lo = hi;
  return clusters.slice(0, lo).join('') + replacement + clusters.slice(hi).join('');
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerCaptureOperation(): void {
  registerOperation<TransactionCapturePayload>({
    type: 'document.transaction-capture',
    schemaVersion: 1,
    validate(payload: unknown) {
      if (typeof payload !== 'object' || payload === null) {
        return { ok: false, errors: ['document.transaction-capture payload must be an object'] };
      }
      const p = payload as Record<string, unknown>;
      if (typeof p.transactionId !== 'string' || p.transactionId.length === 0) {
        return { ok: false, errors: ['transactionId is required'] };
      }
      const changesErr = validateChanges(p.changes);
      if (changesErr) return { ok: false, errors: [changesErr] };
      const summary = p.summary as Record<string, unknown> | undefined;
      if (typeof summary !== 'object' || summary === null) {
        return { ok: false, errors: ['summary is required'] };
      }
      if (typeof summary.label !== 'string' || summary.label.length === 0) {
        return { ok: false, errors: ['summary.label is required'] };
      }
      if (summary.label.length > MAX_SUMMARY_LENGTH)
        return { ok: false, errors: ['summary.label too long'] };
      if (typeof summary.kind !== 'string' || summary.kind.length > 40) {
        return { ok: false, errors: ['summary.kind invalid'] };
      }
      if (!Array.isArray(summary.affectedEntityIds)) {
        return { ok: false, errors: ['summary.affectedEntityIds must be an array'] };
      }
      for (const id of summary.affectedEntityIds) {
        if (typeof id !== 'string' || id.length > MAX_ENTITY_ID_LENGTH) {
          return { ok: false, errors: ['summary.affectedEntityIds must contain entity ids'] };
        }
      }
      if (typeof p.beforeHash !== 'string' || !HASH_RE.test(p.beforeHash)) {
        return { ok: false, errors: ['beforeHash must be a 64-hex SHA-256'] };
      }
      if (typeof p.afterHash !== 'string' || !HASH_RE.test(p.afterHash)) {
        return { ok: false, errors: ['afterHash must be a 64-hex SHA-256'] };
      }
      return {
        ok: true,
        value: p as unknown as TransactionCapturePayload,
      };
    },
    apply(document: Document, payload: TransactionCapturePayload) {
      return applyChanges(document, payload.changes);
    },
    summarize(payload: TransactionCapturePayload) {
      return payload.summary;
    },
    affectedEntities(payload: TransactionCapturePayload) {
      const ids: NodeId[] = [];
      for (const id of payload.summary.affectedEntityIds) {
        if (typeof id === 'string') ids.push(id);
      }
      return ids;
    },
    maxPayloadBytes: 10_000_000,
  });
}
