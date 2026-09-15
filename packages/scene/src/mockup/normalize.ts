/**
 * Codec-time mockup normalization.
 *
 * Runs on every load (like the asset/icon sanitizers): drops invalid
 * templates and instance payloads, prunes templates no longer referenced,
 * and emits warnings so malformed mockup state never reaches the renderer.
 * Missing raster dependencies remain as references so a later reconnect or
 * asset restore can recover the template; export blocks until they return.
 */

import type { Document } from '../document';
import type { FrameNode } from '../types';
import { hashMockupTemplate, isMockupFrame, migrateMockupTemplateSchema } from './ops';
import type { MockupInstanceData, MockupTemplateAsset } from './types';
import { validateInstance, validateTemplate } from './validate';

export interface MockupNormalizeWarnings {
  push(warning: {
    code: string;
    message: string;
    severity: 'warning' | 'error';
    path?: string;
  }): void;
}

/** Validate a template payload and repair/clear it, or drop it entirely. */
export function sanitizeMockupTemplates(
  doc: Document,
  warnings: MockupNormalizeWarnings,
): Document {
  if (!doc.mockupTemplates) return doc;
  const kept: Record<string, MockupTemplateAsset> = {};
  let changed = false;
  for (const [id, template] of Object.entries(doc.mockupTemplates)) {
    if (!template) {
      changed = true;
      continue;
    }
    const validation = validateTemplate(template);
    if (!validation.ok) {
      changed = true;
      warnings.push({
        code: 'mockup.invalid-template',
        message: `Mockup template ${id} failed validation and was removed (${validation.errors[0] ?? 'unknown error'})`,
        severity: 'error',
      });
      continue;
    }
    if (template.id !== id) {
      warnings.push({
        code: 'mockup.template-id-normalized',
        message: `Mockup template ${id} had a mismatched id`,
        severity: 'warning',
      });
    }
    const migrated = migrateMockupTemplateSchema(template);
    if (migrated !== template) {
      warnings.push({
        code: 'mockup.template-schema-migrated',
        message: `Mockup template ${id} was migrated from schema ${template.schemaVersion} to ${migrated.schemaVersion}`,
        severity: 'warning',
      });
    }
    const repaired = repairTemplateAssetReferences(doc, id, migrated, warnings);
    const normalized = { ...repaired, contentHash: hashMockupTemplate(repaired) };
    if (
      migrated !== template ||
      repaired !== migrated ||
      normalized.contentHash !== template.contentHash
    ) {
      changed = true;
    }
    kept[id] = normalized;
  }
  if (!changed) {
    return doc;
  }
  return {
    ...doc,
    mockupTemplates: Object.keys(kept).length > 0 ? kept : undefined,
  };
}

/**
 * Preserve plate/mask references whose document asset is missing. Clearing a
 * reference during normalization would make a recoverable dependency loss
 * permanent and would let export silently omit the plate or mask. The
 * renderer can still show its safe fallback; the export barrier blocks until
 * the referenced asset is restored.
 */
function repairTemplateAssetReferences(
  doc: Document,
  templateId: string,
  template: MockupTemplateAsset,
  warnings: MockupNormalizeWarnings,
): MockupTemplateAsset {
  const missing = new Set<string>();
  if (template.plateImage && !doc.assets?.[template.plateImage.assetId]) {
    missing.add(template.plateImage.assetId);
  }
  for (const surface of template.surfaces) {
    if (surface.clipMaskAssetId && !doc.assets?.[surface.clipMaskAssetId]) {
      missing.add(surface.clipMaskAssetId);
    }
    if (surface.occlusionMaskAssetId && !doc.assets?.[surface.occlusionMaskAssetId]) {
      missing.add(surface.occlusionMaskAssetId);
    }
  }
  if (missing.size === 0) return template;
  warnings.push({
    code: 'mockup.missing-template-asset',
    message: `Mockup template ${templateId} references ${missing.size} missing raster asset(s); plate/mask references were preserved for recovery and export will remain blocked`,
    severity: 'warning',
  });
  return template;
}
/** Validate every frame mockup payload; drop invalid payloads. */
export function sanitizeMockupInstances(
  doc: Document,
  warnings: MockupNormalizeWarnings,
): Document {
  let changed = false;
  const nodes: Record<string, unknown> = {};
  for (const [id, node] of Object.entries(doc.nodes)) {
    nodes[id] = node;
    if (!node || typeof node !== 'object' || node.kind !== 'frame') continue;
    const frame = node as FrameNode;
    if (!frame.mockup) continue;
    const result = validateInstance(doc, frame.mockup as MockupInstanceData, id);
    for (const message of result.warnings) {
      warnings.push({
        code: 'mockup.missing-source',
        message: `Mockup frame ${id}: ${message}`,
        severity: 'warning',
      });
    }
    if (!result.ok) {
      warnings.push({
        code: 'mockup.invalid-instance',
        message: `Mockup payload on frame ${id} was invalid and removed (${result.errors[0] ?? 'unknown error'})`,
        severity: 'error',
      });
      nodes[id] = { ...frame, mockup: undefined };
      changed = true;
    }
  }
  return changed ? { ...doc, nodes: nodes as Document['nodes'] } : doc;
}

/**
 * Full codec pass: validate templates, validate instances, then prune
 * templates no longer referenced by any frame.
 */
export function sanitizeMockupState(doc: Document, warnings: MockupNormalizeWarnings): Document {
  let document = sanitizeMockupTemplates(doc, warnings);
  document = sanitizeMockupInstances(document, warnings);
  const used = new Set<string>();
  for (const node of Object.values(document.nodes)) {
    if (isMockupFrame(node)) used.add(node.mockup.templateId);
  }
  if (document.mockupTemplates) {
    const referenced = Object.fromEntries(
      Object.entries(document.mockupTemplates).filter(
        ([id, template]) => used.has(id) || template.library === true,
      ),
    );
    if (Object.keys(referenced).length !== Object.keys(document.mockupTemplates).length) {
      document = {
        ...document,
        mockupTemplates: Object.keys(referenced).length > 0 ? referenced : undefined,
      };
    }
  }
  return document;
}
