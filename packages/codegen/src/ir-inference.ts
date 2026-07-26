// COMPLEXITY: ~55 (inferSemanticRole=30, analyzeSceneForDesignIR=15)
// Plan: is within budget; no further extraction needed

/**
 * Inference rules and scene analysis for IR conversion.
 */

import type { Document, FrameNode, NodeId, SceneNode } from '@strata/scene';
import { buildAutoLayoutSpec, buildLayoutSpec, managedColorToCss } from './ir-builders';
import type {
  ComponentRef,
  InferenceContext,
  InferenceRule,
  LayoutSpec,
  ResponsiveBreakpointInference,
  SceneAnalysisResult,
  SemanticRole,
  TokenBindings,
  TokenLibrary,
} from './ir-types';
import { DEFAULT_LAYOUT_SPEC } from './ir-types';

// ── Semantic Inference Rules ───────────────────────────────────────────────────

const INFERENCE_RULES: InferenceRule[] = [
  {
    pattern: { namePattern: /button|btn|cta/i, kindPattern: ['frame', 'shape'] },
    role: { primary: 'button', inferred: true, confidence: 0.8 },
    confidence: 0.8,
  },
  {
    pattern: { kindPattern: ['frame', 'shape'], propertyPattern: { hasClickInteraction: true } },
    role: { primary: 'button', inferred: true, confidence: 0.7 },
    confidence: 0.7,
  },
  {
    pattern: { namePattern: /nav|navigation|menu/i, kindPattern: ['frame', 'group'] },
    role: { primary: 'navigation', inferred: true, confidence: 0.9 },
    confidence: 0.9,
  },
  {
    pattern: { namePattern: /link|anchor/i, kindPattern: ['frame', 'shape', 'text'] },
    role: { primary: 'link', inferred: true, confidence: 0.7 },
    confidence: 0.7,
  },
  {
    pattern: { namePattern: /header|head/i, kindPattern: ['frame', 'group'] },
    role: { primary: 'header', inferred: true, confidence: 0.85 },
    confidence: 0.85,
  },
  {
    pattern: { namePattern: /footer|foot/i, kindPattern: ['frame', 'group'] },
    role: { primary: 'footer', inferred: true, confidence: 0.85 },
    confidence: 0.85,
  },
  {
    pattern: { namePattern: /card/i, kindPattern: ['frame'] },
    role: { primary: 'card', inferred: true, confidence: 0.8 },
    confidence: 0.8,
  },
  {
    pattern: { namePattern: /icon|ic_/i, kindPattern: ['shape', 'group'] },
    role: { primary: 'icon', inferred: true, confidence: 0.9 },
    confidence: 0.9,
  },
  {
    pattern: { namePattern: /avatar|profile/i, kindPattern: ['frame', 'shape'] },
    role: { primary: 'avatar', inferred: true, confidence: 0.8 },
    confidence: 0.8,
  },
  {
    pattern: { namePattern: /badge|tag|label/i, kindPattern: ['frame', 'shape'] },
    role: { primary: 'badge', inferred: true, confidence: 0.75 },
    confidence: 0.75,
  },
  {
    pattern: { namePattern: /input|field|textfield|search/i, kindPattern: ['frame', 'shape'] },
    role: { primary: 'input', inferred: true, confidence: 0.8 },
    confidence: 0.8,
  },
  {
    pattern: { namePattern: /list|ul|ol/i, kindPattern: ['frame', 'group'] },
    role: { primary: 'list', inferred: true, confidence: 0.7 },
    confidence: 0.7,
  },
  {
    pattern: { namePattern: /section/i, kindPattern: ['frame', 'group'] },
    role: { primary: 'section', inferred: true, confidence: 0.7 },
    confidence: 0.7,
  },
  {
    pattern: { namePattern: /dialog|modal|overlay/i, kindPattern: ['frame'] },
    role: { primary: 'dialog', inferred: true, confidence: 0.85 },
    confidence: 0.85,
  },
  {
    pattern: { namePattern: /tooltip|hint|popover/i, kindPattern: ['frame'] },
    role: { primary: 'tooltip', inferred: true, confidence: 0.8 },
    confidence: 0.8,
  },
  {
    pattern: { namePattern: /progress|loading|spinner/i, kindPattern: ['frame', 'shape'] },
    role: { primary: 'progress', inferred: true, confidence: 0.75 },
    confidence: 0.75,
  },
  {
    pattern: { namePattern: /skeleton|placeholder/i, kindPattern: ['frame', 'shape'] },
    role: { primary: 'skeleton', inferred: true, confidence: 0.8 },
    confidence: 0.8,
  },
  {
    pattern: { namePattern: /form/i, kindPattern: ['frame', 'group'] },
    role: { primary: 'form', inferred: true, confidence: 0.7 },
    confidence: 0.7,
  },
  {
    pattern: { namePattern: /search/i, kindPattern: ['frame', 'group'] },
    role: { primary: 'search', inferred: true, confidence: 0.7 },
    confidence: 0.7,
  },
  {
    pattern: { namePattern: /banner|hero/i, kindPattern: ['frame', 'group'] },
    role: { primary: 'banner', inferred: true, confidence: 0.8 },
    confidence: 0.8,
  },
  {
    pattern: { namePattern: /table|grid/i, kindPattern: ['frame', 'group'] },
    role: { primary: 'table', inferred: true, confidence: 0.7 },
    confidence: 0.7,
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function matchesPattern(node: SceneNode, pattern: InferenceRule['pattern']): boolean {
  if (pattern.namePattern && !pattern.namePattern.test(node.name)) return false;
  if (pattern.kindPattern && !pattern.kindPattern.includes(node.kind)) return false;
  if (pattern.propertyPattern) {
    for (const [key, value] of Object.entries(pattern.propertyPattern)) {
      if ((node as unknown as Record<string, unknown>)[key] !== value) return false;
    }
  }
  return true;
}

function inferSemanticRole(node: SceneNode, context: InferenceContext): SemanticRole {
  let bestRole: SemanticRole = { primary: 'unknown', inferred: true, confidence: 0 };

  for (const rule of INFERENCE_RULES) {
    if (matchesPattern(node, rule.pattern)) {
      if (rule.role.confidence > bestRole.confidence) {
        bestRole = { ...rule.role };
        bestRole.evidence = [
          `Matched pattern: ${rule.pattern.namePattern?.source || 'property-based'}`,
        ];
      }
    }
  }

  if (context.parentRoles.some((r) => r.primary === 'navigation') && node.kind === 'text') {
    if (bestRole.confidence < 0.6) {
      bestRole = {
        primary: 'link',
        inferred: true,
        confidence: 0.6,
        evidence: ['Child of navigation'],
      };
    }
  }
  if (context.parentRoles.some((r) => r.primary === 'dialog') && node.kind === 'shape') {
    if (bestRole.confidence < 0.3) {
      bestRole = {
        primary: 'icon',
        inferred: true,
        confidence: 0.4,
        evidence: ['Child of dialog'],
      };
    }
  }

  if (bestRole.confidence < 0.5) {
    switch (node.kind) {
      case 'text':
        bestRole = { primary: 'text', inferred: true, confidence: 0.5, evidence: ['Text node'] };
        break;
      case 'frame':
        bestRole = {
          primary: 'container',
          inferred: true,
          confidence: 0.5,
          evidence: ['Frame node'],
        };
        break;
      case 'shape':
        bestRole = {
          primary: 'container',
          inferred: true,
          confidence: 0.4,
          evidence: ['Shape node'],
        };
        break;
      case 'group':
        bestRole = {
          primary: 'container',
          inferred: true,
          confidence: 0.5,
          evidence: ['Group node'],
        };
        break;
      case 'adjustment':
        bestRole = {
          primary: 'container',
          inferred: true,
          confidence: 0.3,
          evidence: ['Adjustment node'],
        };
        break;
    }
  }

  return bestRole;
}

// ── Document Structure ─────────────────────────────────────────────────────────

function buildDocumentStructure(doc: Document): Map<string, string[]> {
  const structure = new Map<string, string[]>();
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (node.kind === 'frame' || node.kind === 'group') {
      structure.set(id, (node as { children?: NodeId[] }).children || []);
    }
  }
  return structure;
}

// ── Scene Analysis ─────────────────────────────────────────────────────────────

function analyzeSceneForDesignIR(doc: Document): SceneAnalysisResult {
  const semanticMap = new Map<string, SemanticRole>();
  const layoutMap = new Map<string, LayoutSpec>();
  const componentMap = new Map<string, ComponentRef>();
  const tokenMap = new Map<string, TokenBindings>();
  const structure = buildDocumentStructure(doc);

  for (const [id, node] of Object.entries(doc.nodes)) {
    const context: InferenceContext = {
      parentRoles: [],
      siblingRoles: [],
      depth: 0,
      documentStructure: structure,
      siblings: [],
    };

    const role = inferSemanticRole(node, context);
    semanticMap.set(id, role);

    if (node.kind === 'frame') {
      const frameNode = node as FrameNode;
      if (frameNode.layoutStyle) {
        layoutMap.set(id, buildAutoLayoutSpec(frameNode));
      } else {
        const constraints = { horizontal: 'min' as const, vertical: 'min' as const };
        layoutMap.set(id, buildLayoutSpec(constraints, DEFAULT_LAYOUT_SPEC, node));
      }
    }

    if (node.kind === 'frame' && (node as { componentId?: string }).componentId) {
      const componentId = (node as { componentId: string }).componentId;
      componentMap.set(id, { componentId, slots: {}, overrides: {} });
    }
  }

  return { semanticMap, layoutMap, componentMap, tokenMap };
}

// ── Token Extraction ───────────────────────────────────────────────────────────

function inferTokenLibrary(doc: Document): TokenLibrary {
  const colors: Record<string, import('./ir-types').TokenValue> = {};
  const spacing: Record<string, import('./ir-types').TokenValue> = {};
  const typography: Record<string, import('./ir-types').TokenValue> = {};
  const effects: Record<string, import('./ir-types').TokenValue> = {};
  const radii: Record<string, import('./ir-types').TokenValue> = {};
  const custom: Record<string, import('./ir-types').TokenValue> = {};

  const colorFrequency = new Map<string, number>();
  for (const node of Object.values(doc.nodes)) {
    if (node.fills) {
      for (const f of node.fills) {
        if (f.type === 'solid' && f.color) {
          const key = managedColorToCss(f.color);
          colorFrequency.set(key, (colorFrequency.get(key) ?? 0) + 1);
        }
      }
    }
  }

  let colorIndex = 0;
  for (const [color, count] of colorFrequency) {
    if (count >= 3) {
      colors[`color-${colorIndex++}`] = { value: color, type: 'color' };
    }
  }

  return { colors, spacing, typography, effects, radii, custom };
}

// ── Responsive Breakpoint Inference ────────────────────────────────────────────

function inferResponsiveBreakpoints(
  node: SceneNode,
  siblingPositions: { x: number; w: number }[],
): ResponsiveBreakpointInference | undefined {
  if (node.kind !== 'frame' && node.kind !== 'group') return undefined;

  const children = (node as { children?: NodeId[] }).children ?? [];
  if (children.length < 3) return undefined;

  const childPositions = siblingPositions;
  if (childPositions.length < 2) return undefined;

  const xs = childPositions.map((p) => p.x);
  const sortedXs = [...xs].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sortedXs.length; i++) {
    gaps.push(sortedXs[i]! - sortedXs[i - 1]!);
  }

  if (gaps.length > 0) {
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    if (avgGap > 20 && gaps.every((g) => Math.abs(g - avgGap) / avgGap < 0.5)) {
      const totalWidth =
        xs.length > 0 ? Math.max(...xs) + (childPositions[0]?.w ?? 0) - Math.min(...xs) : 0;
      return {
        breakpoint: totalWidth + 48,
        confidence: 0.6,
        layoutChanges: {
          wrap: true,
          direction: 'column',
        },
      };
    }
  }

  return undefined;
}

export {
  analyzeSceneForDesignIR,
  buildDocumentStructure,
  INFERENCE_RULES,
  inferResponsiveBreakpoints,
  inferSemanticRole,
  inferTokenLibrary,
  matchesPattern,
};
