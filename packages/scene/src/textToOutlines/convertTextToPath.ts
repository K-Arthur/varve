import { type TextOutlineOptions, textToOutlines } from '@strata/engine';
import { managedColorToRgba } from '@strata/shared';
import type { Document } from '../document';
import { getParent, makeGroupNode, makeShapeNode } from '../document';
import type {
  BlendMode,
  Effect,
  ManagedColor,
  NodeId,
  SceneNode,
  ShapeNode,
  Stroke,
  TextNode,
} from '../types';
import { applyGlyphAdjustmentsToOutlines } from './glyphAdjust';

/** Reduce a run color (ManagedColor or legacy tuple) to an rgb ManagedColor. */
function legacyOrManagedToRgb(
  c: ManagedColor | readonly [number, number, number, number],
): ManagedColor {
  if (!('space' in c)) {
    return { space: 'rgb', r: c[0], g: c[1], b: c[2], a: c[3] };
  }
  const [r, g, b, a] = managedColorToRgba(c);
  return { space: 'rgb', r, g, b, a };
}

export interface ConvertTextToPathOptions {
  fontData?: ArrayBuffer;
  variableAxes?: Record<string, number>;
  /** Max characters before warning. -1 for no limit. */
  maxChars?: number;
  /** When true, flatten compatible glyphs into single compound paths. */
  flatten?: boolean;
  /** When true, generate underline and strikethrough geometry. */
  includeDecorations?: boolean;
  /** When true, preserve per-run styling as group layers. */
  preserveRuns?: boolean;
  /** When true, keep colour-font layers separate. */
  preserveColorLayers?: boolean;
  /** When true, create a copy instead of replacing the text node. */
  createCopy?: boolean;
}

export interface ConvertTextToPathResult {
  document: Document;
  warnings: string[];
  /** Estimated node count after outlining. */
  estimatedNodeCount?: number;
  /** Whether the text node had rich text with multiple runs. */
  hadRichText?: boolean;
}

/** Metadata key to store original text for recovery/search. */
export const ORIGINAL_TEXT_META_KEY = 'strata:originalText';

// Decoration metrics (approximate, derived from font size)
function underlinePosition(fontSize: number): number {
  return -fontSize * 0.1;
}

function underlineThickness(fontSize: number): number {
  return Math.max(1, fontSize * 0.04);
}

function strikethroughPosition(fontSize: number): number {
  return fontSize * 0.3;
}

function strikethroughThickness(fontSize: number): number {
  return Math.max(1, fontSize * 0.04);
}

function cloneManagedColor(c: ManagedColor | undefined): ManagedColor {
  if (!c) return { space: 'rgb', r: 0, g: 0, b: 0, a: 255 };
  return { ...c };
}

function cloneStrokes(strokes: Stroke[] | undefined): Stroke[] {
  if (!strokes) return [];
  return strokes.map((s) => ({ ...s, color: { ...s.color } }));
}

function cloneEffects(effects: Effect[] | undefined): Effect[] {
  if (!effects) return [];
  return effects.map((e) => ({ ...e }));
}

/** Create a ShapeNode for a decoration line (underline/strikethrough). */
function makeDecorationShape(
  id: string,
  x: number,
  y: number,
  width: number,
  thickness: number,
  fill: ManagedColor,
  name: string,
): ShapeNode {
  return makeShapeNode(id, { kind: 'rect', x, y, w: width, h: thickness }, { name, fill });
}

/**
 * Convert a text node to vector path outlines.
 *
 * The text node is replaced by a group node containing one ShapeNode per glyph.
 * Each ShapeNode uses a `kind: 'path'` shape with `holes` for counters in
 * compound glyphs (e.g., "O", "B", "8").
 *
 * When `flatten` is true, compatible glyphs are merged into compound paths.
 * When `includeDecorations` is true, underline and strikethrough geometry is generated.
 * When `preserveRuns` is true and the text has rich text, per-run groups are created.
 *
 * @param doc Source document (not mutated)
 * @param nodeId ID of the text node to convert
 * @param opts Options including font binary data
 * @returns New document with the text node replaced by outlined shapes
 */
export function convertTextNodeToPath(
  doc: Document,
  nodeId: NodeId,
  opts: ConvertTextToPathOptions,
): ConvertTextToPathResult {
  const node = doc.nodes[nodeId];
  if (node?.kind !== 'text') {
    return { document: doc, warnings: ['Selected node is not a text node.'] };
  }

  const textNode = node as unknown as TextNode;
  const rawText = textNode.text ?? '';
  const isEmpty = rawText.length === 0 || !rawText.trim();

  if (isEmpty) {
    return { document: doc, warnings: ['Text node is empty — nothing to outline.'] };
  }

  const maxChars = opts.maxChars ?? 20_000;
  if (maxChars > 0 && rawText.length > maxChars) {
    return {
      document: doc,
      warnings: [`Text is ${rawText.length} characters (max ${maxChars}). Refusing to outline.`],
    };
  }

  const warnings: string[] = [];
  if (rawText.length > 5000) {
    warnings.push(
      `Text is ${rawText.length} characters — this will produce many vector paths. Consider reducing.`,
    );
  }

  if (!opts.fontData) {
    return {
      document: doc,
      warnings: [
        'Font binary data is not available for this font family. ' +
          'Cannot extract real glyph outlines. Load the font first.',
      ],
    };
  }

  const fontSize = textNode.fontSize ?? 16;
  const fillColor = textNode.fill
    ? cloneManagedColor(textNode.fill)
    : { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 };

  // Check for rich text — extract paragraphs and runs
  const richText = textNode.richText;
  const hasRichText = !!richText?.paragraphs && richText.paragraphs.length > 0;
  const preserveRuns = opts.preserveRuns !== false && hasRichText;

  // Outline flat text or each run
  const allGlyphShapes: ShapeNode[] = [];
  const decorationShapes: ShapeNode[] = [];
  const runGroups: Array<{ name: string; glyphIds: string[]; fill?: ManagedColor }> = [];
  let idCounter = 0;

  if (preserveRuns && richText) {
    // Process each rich-text run individually for per-run styling
    let runIndex = 0;
    for (const paragraph of richText.paragraphs ?? []) {
      for (const run of paragraph.runs ?? []) {
        const runText = run.text ?? '';
        if (!runText.trim()) continue;

        const runFontSize = run.format?.fontSize ?? fontSize;
        const runFill = run.format?.color ? legacyOrManagedToRgb(run.format.color) : fillColor;

        const outlineOptions: TextOutlineOptions = {
          fontSize: runFontSize,
          fontFamily: run.format?.fontFamily ?? textNode.fontFamily ?? 'sans-serif',
          fontWeight: run.format?.fontWeight ?? textNode.fontWeight,
          fontStyle: run.format?.fontStyle ?? textNode.fontStyle,
          letterSpacing: run.format?.letterSpacing ?? textNode.letterSpacing,
          x: 0,
          y: 0,
          fontData: opts.fontData,
          variableAxes: opts.variableAxes ?? textNode.variableAxes,
        };

        const runResult = textToOutlines(runText, outlineOptions);
        warnings.push(...runResult.warnings);

        const runGlyphIds: string[] = [];
        for (let i = 0; i < runResult.glyphs.length; i++) {
          const glyph = runResult.glyphs[i]!;
          if (!glyph.char.trim() && glyph.points.length === 0) continue;

          const shapeNodeId = `${nodeId}-run-${runIndex}-glyph-${idCounter++}`;
          const rings = glyph.rings;
          const outerRing = rings.length > 0 ? rings[0]! : glyph.points;
          const holes = rings.length > 1 ? rings.slice(1) : undefined;

          const shapeNode = makeShapeNode(
            shapeNodeId,
            {
              kind: 'path',
              points: outerRing,
              closed: true,
              tolerance: 0.1,
              holes,
              fillRule: holes ? 'evenodd' : 'nonzero',
            },
            {
              name: glyph.char.trim() || `run-${runIndex}-${i}`,
              fill: runFill,
            },
          );
          allGlyphShapes.push(shapeNode);
          runGlyphIds.push(shapeNodeId);
        }

        if (runGlyphIds.length > 0) {
          runGroups.push({
            name: `run-${runIndex}`,
            glyphIds: runGlyphIds,
            fill: runFill,
          });
        }

        // Generate decorations for this run
        if (opts.includeDecorations) {
          const decoration = run.format?.textDecoration ?? textNode.textDecoration;
          if (decoration && decoration !== 'none') {
            const advance = runResult.bounds.w;
            if (decoration === 'underline') {
              const decoId = `${nodeId}-run-${runIndex}-underline`;
              const deco = makeDecorationShape(
                decoId,
                0,
                underlinePosition(runFontSize),
                advance,
                underlineThickness(runFontSize),
                runFill,
                `underline-${runIndex}`,
              );
              decorationShapes.push(deco);
            } else if (decoration === 'line-through') {
              const decoId = `${nodeId}-run-${runIndex}-strikethrough`;
              const deco = makeDecorationShape(
                decoId,
                0,
                strikethroughPosition(runFontSize),
                advance,
                strikethroughThickness(runFontSize),
                runFill,
                `strikethrough-${runIndex}`,
              );
              decorationShapes.push(deco);
            }
          }
        }

        runIndex++;
      }
    }
  } else {
    // Flat text — single outline pass
    const outlineOptions: TextOutlineOptions = {
      fontSize,
      fontFamily: textNode.fontFamily ?? 'sans-serif',
      fontWeight: textNode.fontWeight,
      fontStyle: textNode.fontStyle,
      letterSpacing: textNode.letterSpacing,
      x: 0,
      y: 0,
      fontData: opts.fontData,
      variableAxes: opts.variableAxes ?? textNode.variableAxes,
    };

    const result = textToOutlines(rawText, outlineOptions);
    warnings.push(...result.warnings);

    if (result.hasColorGlyphs) {
      return { document: doc, warnings, hadRichText: hasRichText };
    }

    const shapeIndexByGlyph: (number | null)[] = result.glyphs.map(() => null);
    for (let i = 0; i < result.glyphs.length; i++) {
      const glyph = result.glyphs[i]!;
      const char = glyph.char;
      if (char.trim() === '' && glyph.points.length === 0) continue;

      const shapeNodeId = `${nodeId}-glyph-${idCounter++}`;
      const rings = glyph.rings;
      const outerRing = rings.length > 0 ? rings[0]! : glyph.points;
      const holes = rings.length > 1 ? rings.slice(1) : undefined;

      const shapeNode = makeShapeNode(
        shapeNodeId,
        {
          kind: 'path',
          points: outerRing,
          closed: true,
          tolerance: 0.1,
          holes,
          fillRule: holes ? 'evenodd' : 'nonzero',
        },
        {
          name: char.trim() || `char-${i}`,
          fill: fillColor,
          strokes: textNode.strokes ? cloneStrokes(textNode.strokes) : [],
        },
      );

      if (textNode.strokes && textNode.strokes.length > 0) {
        shapeNode.strokes = cloneStrokes(textNode.strokes);
      }

      shapeIndexByGlyph[i] = allGlyphShapes.length;
      allGlyphShapes.push(shapeNode);
    }

    // Glyph-level parity: apply per-cluster adjustments to the outlined
    // shapes so canvas placement and outline output agree.
    let outlinedWidthDelta = 0;
    if (textNode.glyphAdjustments || textNode.pairAdjustments) {
      const adjustmentResult = applyGlyphAdjustmentsToOutlines(
        rawText,
        result.glyphs,
        allGlyphShapes,
        shapeIndexByGlyph,
        textNode.glyphAdjustments,
        textNode.pairAdjustments,
      );
      warnings.push(...adjustmentResult.warnings);
      outlinedWidthDelta = adjustmentResult.widthDelta;
    }

    // Generate decorations for flat text
    if (opts.includeDecorations) {
      const decoration = textNode.textDecoration;
      if (decoration && decoration !== 'none') {
        const totalWidth = result.bounds.w + outlinedWidthDelta;
        if (decoration === 'underline') {
          const deco = makeDecorationShape(
            `${nodeId}-underline`,
            0,
            underlinePosition(fontSize),
            totalWidth,
            underlineThickness(fontSize),
            fillColor,
            'underline',
          );
          decorationShapes.push(deco);
        } else if (decoration === 'line-through') {
          const deco = makeDecorationShape(
            `${nodeId}-strikethrough`,
            0,
            strikethroughPosition(fontSize),
            totalWidth,
            strikethroughThickness(fontSize),
            fillColor,
            'strikethrough',
          );
          decorationShapes.push(deco);
        }
      }
    }
  }

  if (allGlyphShapes.length === 0) {
    return {
      document: doc,
      warnings: [...warnings, 'No visible glyphs to outline (whitespace only).'],
    };
  }

  const estimatedNodeCount = allGlyphShapes.length + decorationShapes.length + runGroups.length + 1;
  const allChildIds = [...allGlyphShapes.map((n) => n.id), ...decorationShapes.map((n) => n.id)];

  // Create group hierarchy
  const groupId = `${nodeId}-outlined`;
  let topLevelChildren: string[];

  if (preserveRuns && runGroups.length > 1) {
    // Per-run sub-groups
    const subGroupIds: string[] = [];
    for (let i = 0; i < runGroups.length; i++) {
      const rg = runGroups[i]!;
      const subGroupId = `${groupId}-run-${i}`;
      const subGroup = makeGroupNode(subGroupId, {
        name: rg.name,
        children: rg.glyphIds,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
      });
      doc = {
        ...doc,
        nodes: { ...doc.nodes, [subGroupId]: subGroup as unknown as SceneNode },
      };
      subGroupIds.push(subGroupId);
    }
    topLevelChildren = [...subGroupIds, ...decorationShapes.map((n) => n.id)];
  } else {
    topLevelChildren = allChildIds;
  }

  const groupNode = makeGroupNode(groupId, {
    name: `${textNode.name ?? 'Text'} (outlined)`,
    transform: textNode.transform ?? [1, 0, 0, 1, 0, 0],
    rotation: textNode.rotation ?? 0,
    children: topLevelChildren,
    opacity: textNode.opacity ?? 1,
    blendMode: (textNode.blendMode ?? 'normal') as BlendMode,
    effects: textNode.effects ? cloneEffects(textNode.effects) : undefined,
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
  });

  (groupNode as unknown as Record<string, unknown>)[ORIGINAL_TEXT_META_KEY] = rawText;

  // Build new document
  const nodeSet = new Set([nodeId]);
  const parentId = getParent(doc, nodeId);

  const newNodes: Record<string, SceneNode> = {};
  for (const [id, n] of Object.entries(doc.nodes)) {
    if (nodeSet.has(id as NodeId)) continue;
    newNodes[id] = n;
  }
  newNodes[groupId] = groupNode as unknown as SceneNode;
  for (const gn of allGlyphShapes) {
    newNodes[gn.id] = gn;
  }
  for (const dn of decorationShapes) {
    newNodes[dn.id] = dn;
  }

  let newDoc: Document = { ...doc, nodes: newNodes as Document['nodes'] };

  if (parentId) {
    const parent = newDoc.nodes[parentId];
    if (parent && 'children' in parent) {
      const children = [...parent.children];
      const idx = children.indexOf(nodeId);
      if (idx >= 0) {
        children.splice(idx, 1, groupId);
      }
      newDoc = {
        ...newDoc,
        nodes: {
          ...newDoc.nodes,
          [parentId]: { ...parent, children },
        } as Document['nodes'],
      };
    }
  } else {
    const rootChildren = [...doc.rootChildren];
    const idx = rootChildren.indexOf(nodeId);
    if (idx >= 0) {
      rootChildren.splice(idx, 1, groupId);
    }
    newDoc = { ...newDoc, rootChildren };
  }

  return {
    document: newDoc,
    warnings,
    estimatedNodeCount,
    hadRichText: hasRichText,
  };
}
