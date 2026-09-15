/**
 * Typography preflight validation — detects missing fonts, overflow,
 * broken chains, unsupported glyphs, and other typography issues.
 *
 * Research basis: Adobe InDesign preflight, Figma font resolution.
 */

import { managedColorToRgba } from '@varve/shared';
import type { Document } from './document';
import { DEFAULT_ARTWORK_FONT_FAMILY } from './fontDefaults';
import type { ManagedColor, NodeId } from './types';
import type { RichText } from './typography';

export type PreflightSeverity = 'error' | 'warning' | 'info';

export interface TypographyIssue {
  severity: PreflightSeverity;
  category:
    | 'missing-font'
    | 'overflow'
    | 'broken-chain'
    | 'unsupported-glyph'
    | 'contrast'
    | 'style-conflict'
    | 'orphaned-style';
  message: string;
  nodeId?: NodeId;
  frameId?: NodeId;
  chainId?: string;
  styleId?: NodeId;
}

export interface PreflightResult {
  issues: TypographyIssue[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

export function runTypographyPreflight(
  doc: Document,
  options: {
    availableFonts?: Set<string>;
    chains?: Map<string, import('./typography').TextChain>;
    /** v2.18 story threads (ADR-0159); checked alongside legacy chains. */
    stories?: Record<NodeId, import('./types').TextStory>;
    oversetMap?: Map<NodeId, import('./typography').OversetInfo>;
    supportedAxes?: Map<string, Set<string>>;
    fontMetadata?: Map<string, { glyphCount?: number; supportedAxes?: Set<string> }>;
  } = {},
): PreflightResult {
  const issues: TypographyIssue[] = [];
  const availableFonts = options.availableFonts ?? new Set<string>();
  const chains = options.chains ?? new Map<string, import('./typography').TextChain>();
  const oversetMap = options.oversetMap ?? new Map<NodeId, import('./typography').OversetInfo>();
  const supportedAxes = options.supportedAxes ?? new Map<string, Set<string>>();
  const fontMetadata =
    options.fontMetadata ?? new Map<string, { glyphCount?: number; supportedAxes?: Set<string> }>();

  for (const node of Object.values(doc.nodes)) {
    if (node.kind !== 'text') continue;

    const fontFamily = node.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY;

    if (!availableFonts.has(fontFamily)) {
      issues.push({
        severity: 'error',
        category: 'missing-font',
        message: `Font "${fontFamily}" is not available`,
        nodeId: node.id,
      });
    }

    if (node.richText) {
      const richIssues = validateRichText(node.richText, availableFonts);
      for (const issue of richIssues) {
        issues.push({ ...issue, nodeId: node.id });
      }
    }

    if (node.variableAxes && supportedAxes.size > 0) {
      const axes = supportedAxes.get(fontFamily) ?? fontMetadata.get(fontFamily)?.supportedAxes;
      if (axes) {
        for (const axis of Object.keys(node.variableAxes)) {
          if (!axes.has(axis)) {
            issues.push({
              severity: 'warning',
              category: 'style-conflict',
              message: `Variable axis "${axis}" is not supported by "${fontFamily}"`,
              nodeId: node.id,
            });
          }
        }
      }
    }

    if (node.text && fontMetadata.size > 0) {
      const meta = fontMetadata.get(fontFamily);
      if (meta?.glyphCount) {
        for (const char of node.text) {
          const code = char.codePointAt(0) ?? 0;
          // Private-use characters cannot be reliably covered by a fixed glyph count.
          if (code >= 0xe000 && code <= 0xf8ff) {
            issues.push({
              severity: 'warning',
              category: 'unsupported-glyph',
              message: `Private-use character may not be supported by "${fontFamily}"`,
              nodeId: node.id,
            });
            break;
          }
        }
      }
    }

    const overset = oversetMap.get(node.id);
    if (overset) {
      issues.push({
        severity: 'warning',
        category: 'overflow',
        message: `Text overflow: ${overset.oversetChars} characters don't fit`,
        nodeId: node.id,
        frameId: overset.frameId,
        chainId: overset.chainId,
      });
    }
  }

  for (const [chainId, chain] of chains) {
    for (const frameId of chain.frameIds) {
      if (!doc.nodes[frameId]) {
        issues.push({
          severity: 'error',
          category: 'broken-chain',
          message: `Chain "${chain.name}" references missing frame ${frameId}`,
          chainId,
          frameId,
        });
      }
    }
  }

  if (options.stories) {
    for (const story of Object.values(options.stories)) {
      if (!story) continue;
      for (const frameId of story.thread) {
        if (!doc.nodes[frameId]) {
          issues.push({
            severity: 'error',
            category: 'broken-chain',
            message: `Story "${story.name}" references missing frame ${frameId}`,
            chainId: story.id,
            frameId,
          });
        }
      }
    }
  }

  if (doc.styles) {
    const usedStyleIds = new Set<NodeId>();
    for (const node of Object.values(doc.nodes)) {
      if ('styleId' in node && node.styleId) usedStyleIds.add(node.styleId);
    }
    for (const style of Object.values(doc.styles)) {
      if (!usedStyleIds.has(style.id)) {
        issues.push({
          severity: 'info',
          category: 'orphaned-style',
          message: `Style "${style.name}" is not used by any node`,
          styleId: style.id,
        });
      }
    }
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const infoCount = issues.filter((i) => i.severity === 'info').length;

  return { issues, errorCount, warningCount, infoCount };
}

export function validateRichText(rich: RichText, availableFonts: Set<string>): TypographyIssue[] {
  const issues: TypographyIssue[] = [];

  for (const para of rich.paragraphs) {
    for (const run of para.runs) {
      if (!run.format) continue;
      const font = run.format.fontFamily;
      if (font && !availableFonts.has(font)) {
        issues.push({
          severity: 'error',
          category: 'missing-font',
          message: `Font "${font}" is not available in a text run`,
        });
      }
    }
  }

  return issues;
}

export function validateContrast(
  textColor: ManagedColor | readonly [number, number, number, number],
  backgroundColor: ManagedColor | readonly [number, number, number, number],
): { ratio: number; passes: boolean; level: 'AA' | 'AAA' | 'fail' } {
  const lum = (c: ManagedColor | readonly [number, number, number, number]) => {
    const [r, g, b] = !('space' in c) ? c : managedColorToRgba(c);
    const rs = r / 255;
    const gs = g / 255;
    const bs = b / 255;
    const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(rs) + 0.7152 * lin(gs) + 0.0722 * lin(bs);
  };

  const l1 = lum(textColor);
  const l2 = lum(backgroundColor);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  const ratio = (lighter + 0.05) / (darker + 0.05);

  let level: 'AA' | 'AAA' | 'fail' = 'fail';
  if (ratio >= 7) level = 'AAA';
  else if (ratio >= 4.5) level = 'AA';

  return { ratio, passes: ratio >= 4.5, level };
}
