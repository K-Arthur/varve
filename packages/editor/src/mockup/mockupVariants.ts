/**
 * Mockup variant export.
 *
 * Renders one PNG per selected template without touching the document: each
 * variant is built as an in-memory document copy (template embedded,
 * bindings remapped by sourceSlot), rendered through the canonical
 * `exportNodeAsRaster` path at the requested scale, and saved with a
 * deterministic, collision-free name. Failures are per-variant; the current
 * document, its history, and the source artwork are never mutated.
 */

import { createEngine } from '@varve/engine';
import {
  addMockupTemplate,
  applyMockupTemplateRemap,
  type Document,
  isMockupFrame,
  type NodeId,
  type SceneNode,
} from '@varve/scene';
import { downloadBlob, exportNodeAsRaster } from '../components/SpecPanel/export';
import type { EditorContextValue } from '../context';
import { resolveTemplateForDocument } from './mockupActions';

export interface MockupVariantPlan {
  frameId: NodeId;
  templateIds: string[];
  /** Raster scale (1 = document units at 1:1). */
  scale: number;
  /** Optional base name; defaults to the frame name. */
  name?: string;
}

export interface MockupVariantResult {
  templateId: string;
  fileName: string;
  status: 'success' | 'failed' | 'cancelled';
  error?: string;
  byteCount?: number;
}

export interface MockupVariantProgress {
  completed: number;
  total: number;
  currentTemplateId: string;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'mockup'
  );
}

function uniqueFileName(base: string, used: Set<string>): string {
  let candidate = `${base}.png`;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${counter}.png`;
    counter++;
  }
  used.add(candidate);
  return candidate;
}

export async function exportMockupVariants(
  editor: EditorContextValue,
  plan: MockupVariantPlan,
  onProgress?: (progress: MockupVariantProgress) => void,
  signal?: AbortSignal,
): Promise<MockupVariantResult[]> {
  const baseDoc = editor.state.document;
  const frame = baseDoc.nodes[plan.frameId];
  if (!isMockupFrame(frame) || plan.templateIds.length === 0) return [];

  let engine: Awaited<ReturnType<typeof createEngine>> | null = null;
  const results: MockupVariantResult[] = [];
  const usedNames = new Set<string>();
  const baseName = slugify(plan.name?.trim() || frame.name || 'mockup');
  const total = plan.templateIds.length;

  for (const [index, templateId] of plan.templateIds.entries()) {
    if (signal?.aborted) {
      results.push({ templateId, fileName: '', status: 'cancelled' });
      break;
    }
    const resolved = resolveTemplateForDocument(baseDoc, templateId);
    if (!resolved) {
      results.push({ templateId, fileName: '', status: 'failed', error: 'Template not found' });
      onProgress?.({ completed: index + 1, total, currentTemplateId: templateId });
      continue;
    }
    const variantDoc: Document = (() => {
      const added = addMockupTemplate(baseDoc, resolved.template);
      const applied = applyMockupTemplateRemap(added.document, plan.frameId, added.templateId);
      return applied.document;
    })();
    const variantNode = variantDoc.nodes[plan.frameId] as SceneNode | undefined;
    if (!variantNode) {
      results.push({ templateId, fileName: '', status: 'failed', error: 'Frame missing' });
      continue;
    }
    const fileName = uniqueFileName(`${baseName}-${slugify(resolved.template.name)}`, usedNames);
    try {
      if (!engine) engine = await createEngine('auto');
      const rendered = await exportNodeAsRaster(variantNode, variantDoc, engine, {
        format: 'image/png',
        scale: Math.max(0.05, Math.min(16, plan.scale)),
        transparency: true,
        signal,
      });
      downloadBlob(rendered.blob, fileName);
      results.push({
        templateId,
        fileName,
        status: 'success',
        byteCount: rendered.blob.size,
      });
    } catch (error) {
      if (signal?.aborted) {
        results.push({ templateId, fileName, status: 'cancelled' });
        break;
      }
      results.push({
        templateId,
        fileName,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Export failed',
      });
    }
    onProgress?.({ completed: index + 1, total, currentTemplateId: templateId });
  }
  return results;
}
