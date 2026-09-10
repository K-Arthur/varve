/**
 * Codec-time mockup normalization.
 *
 * Runs on every load (like the asset/icon sanitizers): drops invalid
 * templates and instance payloads, prunes templates no longer referenced,
 * and emits warnings so malformed mockup state never reaches the renderer.
 */

import type { Document } from '../document';
import type { FrameNode } from '../types';
import { isMockupFrame } from './ops';
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
  for (const [id, template] of Object.entries(doc.mockupTemplates)) {
    if (!template) continue;
    const validation = validateTemplate(template);
    if (!validation.ok) {
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
    kept[id] = template;
  }
  if (Object.keys(kept).length === Object.keys(doc.mockupTemplates).length) {
    return doc;
  }
  return {
    ...doc,
    mockupTemplates: Object.keys(kept).length > 0 ? kept : undefined,
  };
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
    const result = validateInstance(doc, frame.mockup as MockupInstanceData);
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
      Object.entries(document.mockupTemplates).filter(([id]) => used.has(id)),
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
