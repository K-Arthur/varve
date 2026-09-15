/**
 * Starter operation families: document.* and asset.*
 *
 * document.set mutates a small whitelist of document-level authored
 * properties; asset.register adds a content-addressed asset. Both are pure.
 */
import type { Document } from '../../document';
import type { DocumentAsset } from '../../types';
import { registerOperation } from '../registry';

const DOCUMENT_PROPERTIES = new Map<string, (v: unknown) => string | null>([
  ['name', (v) => (typeof v === 'string' ? null : 'name must be a string')],
  [
    'canvasWidth',
    (v) =>
      typeof v === 'number' && Number.isFinite(v) && v > 0
        ? null
        : 'canvasWidth must be a positive finite number',
  ],
  [
    'canvasHeight',
    (v) =>
      typeof v === 'number' && Number.isFinite(v) && v > 0
        ? null
        : 'canvasHeight must be a positive finite number',
  ],
  [
    'dpi',
    (v) =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0
        ? null
        : 'dpi must be a non-negative finite number',
  ],
  ['documentUnit', (v) => (typeof v === 'string' ? null : 'documentUnit must be a string')],
]);

export function registerDocumentAssetOperations(): void {
  registerOperation<{ property: string; value: unknown }>({
    type: 'document.set',
    schemaVersion: 1,
    validate(payload: unknown) {
      const p = payload as Record<string, unknown> | null;
      if (typeof p !== 'object' || p === null || typeof p.property !== 'string') {
        return { ok: false, errors: ['document.set requires property'] };
      }
      const check = DOCUMENT_PROPERTIES.get(p.property);
      if (!check) {
        return { ok: false, errors: [`document.set property not allowed: ${p.property}`] };
      }
      const error = check(p.value);
      if (error) return { ok: false, errors: [`document.set ${p.property}: ${error}`] };
      return { ok: true, value: p as unknown as { property: string; value: unknown } };
    },
    apply(document: Document, payload: { property: string; value: unknown }) {
      const next: Record<string, unknown> = { ...document, [payload.property]: payload.value };
      return next as unknown as Document;
    },
    summarize(payload: { property: string }) {
      return {
        label: `Change document ${payload.property}`,
        kind: 'modify',
        affectedEntityIds: [],
      };
    },
    affectedEntities() {
      return [];
    },
  });

  registerOperation<{ asset: DocumentAsset }>({
    type: 'asset.register',
    schemaVersion: 1,
    validate(payload: unknown) {
      const p = payload as Record<string, unknown> | null;
      if (typeof p !== 'object' || p === null) {
        return { ok: false, errors: ['asset.register requires an asset object'] };
      }
      const asset = p.asset as Record<string, unknown> | null;
      if (typeof asset !== 'object' || asset === null || typeof asset.id !== 'string') {
        return { ok: false, errors: ['asset.register requires asset.id'] };
      }
      if (typeof asset.dataUrl !== 'string' || !asset.dataUrl.startsWith('data:')) {
        return { ok: false, errors: ['asset.register requires a data: URL payload'] };
      }
      return { ok: true, value: p as unknown as { asset: DocumentAsset } };
    },
    apply(document: Document, payload: { asset: DocumentAsset }) {
      return {
        ...document,
        assets: { ...document.assets, [payload.asset.id]: payload.asset },
      };
    },
    summarize(payload: { asset: DocumentAsset }) {
      return { label: 'Register asset', kind: 'import', affectedEntityIds: [payload.asset.id] };
    },
    affectedEntities(payload: { asset: DocumentAsset }) {
      return [payload.asset.id];
    },
    precondition(document: Document, payload: { asset: DocumentAsset }) {
      const existing = document.assets?.[payload.asset.id];
      if (existing && existing.dataUrl !== payload.asset.dataUrl) {
        return `asset ${payload.asset.id} already registered with different content`;
      }
      return null;
    },
    maxPayloadBytes: 10_000_000,
  });
}
