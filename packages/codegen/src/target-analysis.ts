/**
 * Target analysis — detect feature gaps for a given export format across
 * an entire document or a set of nodes.
 *
 * Each code emitter exposes a `targetGaps(node, doc)` companion that reports
 * unsupported features for that node/format pair. This module aggregates those
 * reports document-wide so the Export dialog can show a preflight summary.
 */

import type { Document, SceneNode } from '@varve/scene';
import { cssTargetGaps } from './css';
import { cssModulesTargetGaps } from './css-modules';
import { flutterTargetGaps } from './flutter';
import { svgTargetGaps } from './svg';
import { swiftuiTargetGaps } from './swiftui';
import { tailwindTargetGaps } from './tailwind';
import type { TargetGap } from './types';

/** Code-export format identifiers handled by this analyser. */
export type CodeExportFormat =
  | 'css'
  | 'react'
  | 'react-cssmodules'
  | 'react-tailwind'
  | 'flutter'
  | 'swiftui'
  | 'svg'
  | 'svg-component'
  | 'vue'
  | 'svelte'
  | 'web-component';

/** Summary of all gaps found in a document for a given format. */
export interface TargetAnalysisResult {
  format: CodeExportFormat;
  gaps: TargetGap[];
  errorCount: number;
  warningCount: number;
}

type GapFn = (node: SceneNode, doc: Document) => TargetGap[];

const GAP_FNS: Record<CodeExportFormat, GapFn> = {
  css: cssTargetGaps,
  react: () => [],
  'react-cssmodules': cssModulesTargetGaps,
  'react-tailwind': tailwindTargetGaps,
  flutter: flutterTargetGaps,
  swiftui: swiftuiTargetGaps,
  svg: svgTargetGaps,
  'svg-component': svgTargetGaps,
  vue: () => [],
  svelte: () => [],
  'web-component': () => [],
};

/**
 * Collect all `TargetGap` entries for every node in `doc` for the given
 * export format. Walks the full node map (not just root children) so nested
 * nodes inside frames and groups are also checked.
 */
export function analyseDocument(doc: Document, format: CodeExportFormat): TargetAnalysisResult {
  const gapFn = GAP_FNS[format];
  const gaps: TargetGap[] = [];

  for (const node of Object.values(doc.nodes)) {
    const nodeGaps = gapFn(node, doc);
    gaps.push(...nodeGaps);
  }

  return {
    format,
    gaps,
    errorCount: gaps.filter((g) => g.severity === 'error').length,
    warningCount: gaps.filter((g) => g.severity === 'warning').length,
  };
}

/**
 * Check a single node against a format and return its gaps.
 * Convenience wrapper for use in the Inspector panel.
 */
export function analyseNode(node: SceneNode, doc: Document, format: CodeExportFormat): TargetGap[] {
  return GAP_FNS[format](node, doc);
}

/**
 * Return true if the given format string is a code-export format
 * supported by target analysis (as opposed to raster/print formats).
 */
export function isCodeExportFormat(format: string): format is CodeExportFormat {
  return format in GAP_FNS;
}
