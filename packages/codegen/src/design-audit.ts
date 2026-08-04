/**
 * Combined design audit — aggregates vector, raster, color, and codegen
 * readiness findings. Contrast/typography audit is handled by the scene
 * intelligence module directly (runIntelligenceAudit from @varve/scene).
 *
 * Produces a normalized DesignAuditReport consumable by IntelligencePanel,
 * export UI, or JSON output.
 */

import type { Document, SceneNode } from '@varve/scene';
import { analyzeFlattening } from './flattening';
import type { AuditCategory, AuditFinding, DesignAuditReport } from './ir-types';
import { runRasterAudit } from './raster-audit';
import { runVectorAudit } from './vector-audit';

export interface DesignAuditOptions {
  categories?: AuditCategory[];
  rootIds?: string[];
  includeCodegenReady?: boolean;
}

/** Run a comprehensive design audit (sync, no dynamic imports). */
export function runDesignAudit(doc: Document, opts: DesignAuditOptions = {}): DesignAuditReport {
  const allFindings: AuditFinding[] = [];
  const categories = opts.categories ?? ['vector', 'raster', 'color', 'codegen'];

  if (categories.includes('vector')) {
    allFindings.push(...runVectorAudit(doc, opts.rootIds));
  }

  if (categories.includes('raster')) {
    allFindings.push(...runRasterAudit(doc, opts.rootIds));
  }

  if (opts.includeCodegenReady && opts.rootIds) {
    const rootNodes = opts.rootIds.map((id) => doc.nodes[id]).filter(Boolean) as SceneNode[];
    const flattening = analyzeFlattening(rootNodes, doc);
    allFindings.push({
      nodeId: 'document',
      nodeName: doc.name,
      category: 'codegen',
      severity: flattening.flattenedNodes > 0 ? 'warning' : 'info',
      message:
        flattening.flattenedNodes > 0
          ? `${flattening.flattenedNodes} of ${flattening.totalNodes} nodes need raster fallback for web export.`
          : 'All nodes can be emitted as native HTML/CSS.',
      autoFixAvailable: false,
    });
  }

  const byCategory: Record<AuditCategory, AuditFinding[]> = {
    contrast: [],
    typography: [],
    layout: [],
    accessibility: [],
    vector: [],
    raster: [],
    color: [],
    performance: [],
    spacing: [],
    codegen: [],
  };

  for (const finding of allFindings) {
    const cat = byCategory[finding.category];
    if (cat) cat.push(finding);
    else byCategory.codegen.push(finding);
  }

  return {
    documentId: doc.id,
    timestamp: Date.now(),
    findings: allFindings,
    byCategory,
    totalErrors: allFindings.filter((f) => f.severity === 'error').length,
    totalWarnings: allFindings.filter((f) => f.severity === 'warning').length,
    totalInfo: allFindings.filter((f) => f.severity === 'info').length,
  };
}

/** Assess codegen readiness: can the document be exported as native HTML/CSS? */
export function runCodegenReadiness(
  doc: Document,
  rootIds: string[],
): {
  ready: boolean;
  issues: string[];
  summary: string;
} {
  const rootNodes = rootIds.map((id) => doc.nodes[id]).filter(Boolean) as SceneNode[];
  const flattening = analyzeFlattening(rootNodes, doc);
  const issues: string[] = [];

  if (flattening.flattenedNodes > 0) {
    issues.push(`${flattening.flattenedNodes} nodes need raster fallback`);
  }

  for (const node of rootNodes) {
    const blend = node.blendMode;
    if (
      blend &&
      !['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'].includes(blend)
    ) {
      issues.push(`Node "${node.name}" uses blend mode "${blend}" (limited CSS support)`);
    }
  }

  return {
    ready: issues.length === 0,
    issues,
    summary:
      issues.length > 0
        ? `Code export ready with ${issues.length} caveats`
        : 'Code export ready — all nodes can be emitted as native HTML/CSS',
  };
}
