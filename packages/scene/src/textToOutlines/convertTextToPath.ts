import { type TextOutlineOptions, textToOutlines } from '@strata/engine';
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

export interface ConvertTextToPathOptions {
  fontData?: ArrayBuffer;
  variableAxes?: Record<string, number>;
  /** Max characters before warning. -1 for no limit. */
  maxChars?: number;
}

export interface ConvertTextToPathResult {
  document: Document;
  warnings: string[];
}

/** Metadata key to store original text for recovery/search. */
export const ORIGINAL_TEXT_META_KEY = 'strata:originalText';

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

/**
 * Convert a text node to vector path outlines.
 *
 * The text node is replaced by a group node containing one ShapeNode per glyph.
 * Each ShapeNode uses a `kind: 'path'` shape with `holes` for counters in
 * compound glyphs (e.g., "O", "B", "8").
 *
 * @param doc Source document (not mutated)
 * @param nodeId ID of the text node to convert
 * @param opts Options including font binary data
 * @param idGen ID generator
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

  // Check character limit
  const maxChars = opts.maxChars ?? 20_000;
  if (maxChars > 0 && rawText.length > maxChars) {
    return {
      document: doc,
      warnings: [`Text is ${rawText.length} characters (max ${maxChars}). Refusing to outline.`],
    };
  }

  // Warn for long text
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

  // Run text-to-outlines
  const outlineOptions: TextOutlineOptions = {
    fontSize: textNode.fontSize ?? 16,
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
    return { document: doc, warnings };
  }

  if (result.glyphs.length === 0) {
    return { document: doc, warnings: [...warnings, 'No glyphs were outlined.'] };
  }

  // Create ShapeNode per glyph
  const glyphNodes: ShapeNode[] = [];
  let idCounter = 0;
  for (let i = 0; i < result.glyphs.length; i++) {
    const glyph = result.glyphs[i]!;
    const char = glyph.char;
    if (char.trim() === '' && glyph.points.length === 0) continue;

    const shapeNodeId = `${nodeId}-glyph-${idCounter++}`;
    const rings = glyph.rings;
    // First ring is outer contour, rest are holes
    const outerRing = rings.length > 0 ? rings[0]! : glyph.points;
    const holes = rings.length > 1 ? rings.slice(1) : undefined;

    // Determine fill color from text node
    const fillColor = textNode.fill
      ? cloneManagedColor(textNode.fill)
      : { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 };

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

    // Apply strokes from text node
    if (textNode.strokes && textNode.strokes.length > 0) {
      shapeNode.strokes = cloneStrokes(textNode.strokes);
    }

    glyphNodes.push(shapeNode);
  }

  if (glyphNodes.length === 0) {
    return {
      document: doc,
      warnings: [...warnings, 'No visible glyphs to outline (whitespace only).'],
    };
  }

  // Create a group to hold all glyph shapes
  const groupId = `${nodeId}-outlined`;
  const groupNode = makeGroupNode(groupId, {
    name: `${textNode.name ?? 'Text'} (outlined)`,
    transform: textNode.transform ?? [1, 0, 0, 1, 0, 0],
    rotation: textNode.rotation ?? 0,
    children: glyphNodes.map((n) => n.id),
    opacity: textNode.opacity ?? 1,
    blendMode: (textNode.blendMode ?? 'normal') as BlendMode,
    effects: textNode.effects ? cloneEffects(textNode.effects) : undefined,
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
  });

  // Add a metadata field with the original text
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
  for (const gn of glyphNodes) {
    newNodes[gn.id] = gn;
  }

  let newDoc: Document = { ...doc, nodes: newNodes as Document['nodes'] };

  // Replace text node reference with group
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

  return { document: newDoc, warnings };
}
