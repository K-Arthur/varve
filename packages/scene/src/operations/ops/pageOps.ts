/**
 * Page operation family: page.* (ADR-0149 D1).
 *
 * Every operation here is pure: `apply(document, payload)` returns a new
 * document and never mutates its input. Payloads are validated before apply.
 * Preconditions guard against unknown pages and invalid states.
 */

import { generateKeyBetween } from '@varve/shared';
import type { Document } from '../../document';
import {
  addPage,
  deletePageWithPolicy,
  duplicatePage,
  reorderPages,
  setPagePlacement,
  setPageSize,
  setPageSizeWithContentScale,
} from '../../document';
import type { DeletePagePolicy } from '../../document-pages';
import type { NodeId } from '../../types';
import { registerOperation } from '../registry';
import type { ValidationResult } from '../types';

// ── page.create ──────────────────────────────────────────────────────────────

export interface PageCreatePayload {
  /** Optional name; defaults to "Page N". */
  name?: string;
  width?: number;
  height?: number;
  /** Insert after this page's order key (defaults to append at end). */
  afterPageId?: NodeId;
}

function validatePageCreate(payload: unknown): ValidationResult<PageCreatePayload> {
  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, errors: ['page.create payload must be an object'] };
  }
  const p = payload as Record<string, unknown>;
  if (p.name !== undefined && typeof p.name !== 'string') {
    return { ok: false, errors: ['page.create name must be a string'] };
  }
  for (const key of ['width', 'height'] as const) {
    if (p[key] !== undefined && (typeof p[key] !== 'number' || !Number.isFinite(p[key]))) {
      return { ok: false, errors: [`page.create ${key} must be a finite number`] };
    }
    if (typeof p[key] === 'number' && p[key]! <= 0) {
      return { ok: false, errors: [`page.create ${key} must be positive`] };
    }
  }
  if (p.afterPageId !== undefined && typeof p.afterPageId !== 'string') {
    return { ok: false, errors: ['page.create afterPageId must be a string'] };
  }
  return { ok: true, value: p as unknown as PageCreatePayload };
}

function applyPageCreate(document: Document, payload: PageCreatePayload): Document {
  const pages = document.pages ?? [];
  const afterIdx = payload.afterPageId ? pages.findIndex((p) => p.id === payload.afterPageId) : -1;

  const next = addPage(document, {
    name: payload.name,
    width: payload.width,
    height: payload.height,
  });
  const created = next.pages?.[next.pages.length - 1];
  if (!created) return next;

  // Position the new page after `afterPageId` (or at the end): fix both the
  // fractional order key AND the array position, since numbering and spread
  // projection read the array order.
  let order: string;
  let arrayPosition: number;
  if (afterIdx < 0) {
    order = created.order;
    arrayPosition = next.pages!.length - 1;
  } else {
    const afterPage = pages[afterIdx]!;
    const before = pages[afterIdx + 1];
    order = generateKeyBetween(afterPage.order, before?.order ?? null);
    arrayPosition = afterIdx + 1;
  }

  const remaining = next.pages!.filter((p) => p.id !== created.id);
  const reorderedPages = [...remaining];
  reorderedPages.splice(arrayPosition, 0, { ...created, order });

  return { ...next, pages: reorderedPages };
}

// ── page.delete ──────────────────────────────────────────────────────────────

export interface PageDeletePayload {
  pageId: NodeId;
  /** Content disposition; defaults to delete-content (ADR-0126 D3). */
  policy?: DeletePagePolicy;
  /** Required when policy is move-to-page. */
  targetPageId?: NodeId;
}

// ── page.resize ──────────────────────────────────────────────────────────────

export interface PageResizePayload {
  pageId: NodeId;
  width: number;
  height: number;
  /** Scale content proportionally instead of resizing the page only. */
  scaleContent?: boolean;
}

// ── page.move-on-pasteboard ──────────────────────────────────────────────────

export interface PageMoveOnPasteboardPayload {
  pageId: NodeId;
  x: number;
  y: number;
}

/** Register the page.* operation family (idempotent guard inside registry). */
export function registerPageOperations(): void {
  registerOperation<PageCreatePayload>({
    type: 'page.create',
    schemaVersion: 1,
    validate: validatePageCreate,
    apply: applyPageCreate,
    summarize(payload) {
      return {
        label: `Create page${payload.name ? ` ${payload.name}` : ''}`,
        kind: 'create',
        affectedEntityIds: [],
      };
    },
    affectedEntities() {
      return [];
    },
    precondition(document, payload) {
      if (
        payload.afterPageId !== undefined &&
        !document.pages?.some((p) => p.id === payload.afterPageId)
      ) {
        return `after page does not exist: ${payload.afterPageId}`;
      }
      return null;
    },
    maxPayloadBytes: 8_000,
  });

  registerOperation<PageDeletePayload>({
    type: 'page.delete',
    schemaVersion: 1,
    validate(payload) {
      if (typeof payload !== 'object' || payload === null) {
        return { ok: false, errors: ['page.delete payload must be an object'] };
      }
      const p = payload as Record<string, unknown>;
      if (typeof p.pageId !== 'string' || p.pageId.length === 0) {
        return { ok: false, errors: ['page.delete requires pageId'] };
      }
      if (
        p.policy !== undefined &&
        !['delete-content', 'move-to-pasteboard', 'move-to-page'].includes(p.policy as string)
      ) {
        return { ok: false, errors: [`unknown delete policy: ${String(p.policy)}`] };
      }
      if (p.policy === 'move-to-page' && typeof p.targetPageId !== 'string') {
        return { ok: false, errors: ['page.delete move-to-page requires targetPageId'] };
      }
      return { ok: true, value: p as unknown as PageDeletePayload };
    },
    apply(document, payload) {
      return deletePageWithPolicy(
        document,
        payload.pageId,
        payload.policy ?? 'delete-content',
        payload.targetPageId,
      );
    },
    summarize(payload) {
      return {
        label: `Delete page${payload.policy ? ` (${payload.policy})` : ''}`,
        kind: 'delete',
        affectedEntityIds: [payload.pageId],
      };
    },
    affectedEntities(payload) {
      return [payload.pageId];
    },
    precondition(document, payload) {
      if (!document.pages?.some((p) => p.id === payload.pageId)) {
        return `page does not exist: ${payload.pageId}`;
      }
      if (document.pages.length <= 1) return 'cannot delete the last page';
      if (
        payload.policy === 'move-to-page' &&
        !document.pages.some((p) => p.id === payload.targetPageId && p.id !== payload.pageId)
      ) {
        return `target page does not exist: ${String(payload.targetPageId)}`;
      }
      return null;
    },
    maxPayloadBytes: 8_000,
  });

  registerOperation<{ pageId: NodeId }>({
    type: 'page.duplicate',
    schemaVersion: 1,
    validate(payload) {
      if (typeof payload !== 'object' || payload === null) {
        return { ok: false, errors: ['page.duplicate payload must be an object'] };
      }
      const p = payload as Record<string, unknown>;
      if (typeof p.pageId !== 'string' || p.pageId.length === 0) {
        return { ok: false, errors: ['page.duplicate requires pageId'] };
      }
      return { ok: true, value: p as unknown as { pageId: NodeId } };
    },
    apply(document, payload) {
      return duplicatePage(document, payload.pageId);
    },
    summarize(payload) {
      return { label: 'Duplicate page', kind: 'create', affectedEntityIds: [payload.pageId] };
    },
    affectedEntities(payload) {
      return [payload.pageId];
    },
    precondition(document, payload) {
      if (!document.pages?.some((p) => p.id === payload.pageId)) {
        return `page does not exist: ${payload.pageId}`;
      }
      return null;
    },
    maxPayloadBytes: 8_000,
  });

  registerOperation<{ pageIds: NodeId[] }>({
    type: 'page.reorder',
    schemaVersion: 1,
    validate(payload) {
      if (typeof payload !== 'object' || payload === null) {
        return { ok: false, errors: ['page.reorder payload must be an object'] };
      }
      const p = payload as Record<string, unknown>;
      if (!Array.isArray(p.pageIds) || p.pageIds.some((id) => typeof id !== 'string')) {
        return { ok: false, errors: ['page.reorder requires a pageIds string array'] };
      }
      return { ok: true, value: p as unknown as { pageIds: NodeId[] } };
    },
    apply(document, payload) {
      return reorderPages(document, payload.pageIds);
    },
    summarize(payload) {
      return {
        label: 'Reorder pages',
        kind: 'reorder',
        affectedEntityIds: payload.pageIds,
      };
    },
    affectedEntities(payload) {
      return payload.pageIds;
    },
    precondition(document, payload) {
      const existing = new Set((document.pages ?? []).map((p) => p.id));
      if (payload.pageIds.length !== existing.size) {
        return 'page.reorder count mismatch';
      }
      if (payload.pageIds.some((id) => !existing.has(id))) {
        return 'page.reorder references an unknown page';
      }
      return null;
    },
    maxPayloadBytes: 100_000,
  });

  registerOperation<PageResizePayload>({
    type: 'page.resize',
    schemaVersion: 1,
    validate(payload) {
      if (typeof payload !== 'object' || payload === null) {
        return { ok: false, errors: ['page.resize payload must be an object'] };
      }
      const p = payload as Record<string, unknown>;
      if (typeof p.pageId !== 'string' || p.pageId.length === 0) {
        return { ok: false, errors: ['page.resize requires pageId'] };
      }
      for (const key of ['width', 'height'] as const) {
        if (typeof p[key] !== 'number' || !Number.isFinite(p[key]) || p[key]! <= 0) {
          return { ok: false, errors: [`page.resize ${key} must be a positive finite number`] };
        }
      }
      return { ok: true, value: p as unknown as PageResizePayload };
    },
    apply(document, payload) {
      if (payload.scaleContent) {
        return setPageSizeWithContentScale(document, payload.pageId, payload.width, payload.height);
      }
      return setPageSize(document, payload.pageId, payload.width, payload.height);
    },
    summarize(payload) {
      return {
        label: `Resize page to ${payload.width}×${payload.height}`,
        kind: 'modify',
        affectedEntityIds: [payload.pageId],
      };
    },
    affectedEntities(payload) {
      return [payload.pageId];
    },
    precondition(document, payload) {
      if (!document.pages?.some((p) => p.id === payload.pageId)) {
        return `page does not exist: ${payload.pageId}`;
      }
      return null;
    },
    maxPayloadBytes: 8_000,
  });

  registerOperation<PageMoveOnPasteboardPayload>({
    type: 'page.move-on-pasteboard',
    schemaVersion: 1,
    validate(payload) {
      if (typeof payload !== 'object' || payload === null) {
        return { ok: false, errors: ['page.move-on-pasteboard payload must be an object'] };
      }
      const p = payload as Record<string, unknown>;
      if (typeof p.pageId !== 'string' || p.pageId.length === 0) {
        return { ok: false, errors: ['page.move-on-pasteboard requires pageId'] };
      }
      for (const key of ['x', 'y'] as const) {
        if (typeof p[key] !== 'number' || !Number.isFinite(p[key])) {
          return { ok: false, errors: [`page.move-on-pasteboard ${key} must be a finite number`] };
        }
      }
      return { ok: true, value: p as unknown as PageMoveOnPasteboardPayload };
    },
    apply(document, payload) {
      return setPagePlacement(document, payload.pageId, { x: payload.x, y: payload.y });
    },
    summarize(payload) {
      return {
        label: 'Move page on pasteboard',
        kind: 'move',
        affectedEntityIds: [payload.pageId],
      };
    },
    affectedEntities(payload) {
      return [payload.pageId];
    },
    precondition(document, payload) {
      if (!document.pages?.some((p) => p.id === payload.pageId)) {
        return `page does not exist: ${payload.pageId}`;
      }
      return null;
    },
    maxPayloadBytes: 8_000,
  });
}
