import {
  type Document,
  getParent,
  type ManagedColor,
  type NodeId,
  nodeLocalBounds,
  nodeWorldTransform,
  type Paint,
  resolveNodePaints,
  resolveNodeStyles,
  resolvePresentationSlides,
  type SceneNode,
} from '@varve/scene';
import {
  applyAffine,
  contrastRatio,
  managedColorToRgba,
  relativeLuminance,
  tryInvertAffine,
} from '@varve/shared';

export type PresentationFindingSeverity = 'blocker' | 'warning' | 'info';

export interface PresentationFinding {
  code:
    | 'missing-frame'
    | 'empty-title'
    | 'small-text'
    | 'off-slide'
    | 'placeholder'
    | 'missing-alt'
    | 'missing-font'
    | 'missing-asset'
    | 'low-contrast';
  severity: PresentationFindingSeverity;
  entryId: string;
  slideTitle: string;
  nodeId?: NodeId;
  message: string;
}

export interface PresentationPreflightOptions {
  /** Minimum authored text size in slide pixels. This is advisory, not a delivery gate. */
  minimumTextSize?: number;
  /** Minimum WCAG contrast ratio to report when both solid colors are known. */
  minimumContrastRatio?: number;
}

const PLACEHOLDER_TEXT =
  /^(\[\s*(title|subtitle|body|image|placeholder)[^\]]*\]|\{\{[^}]+\}\}|lorem ipsum|todo)$/i;

function childrenOf(node: SceneNode): NodeId[] {
  return node.kind === 'frame' || node.kind === 'group' ? node.children : [];
}

function solidRgb(color: ManagedColor | undefined): [number, number, number] | null {
  if (!color || color.space === 'unresolved' || color.space === 'registration') return null;
  const [r, g, b, alpha] = managedColorToRgba(color);
  return alpha === 255 ? [r, g, b] : null;
}

function frameBackground(document: Document, frameId: NodeId): [number, number, number] | null {
  let currentId: NodeId | null = frameId;
  while (currentId) {
    const node = document.nodes[currentId];
    if (node?.kind === 'frame') {
      const color = solidRgb(node.fill);
      if (color) return color;
    }
    currentId = getParent(document, currentId);
  }
  return solidRgb(document.canvasBackground);
}

function colorForText(document: Document, node: Extract<SceneNode, { kind: 'text' }>) {
  const styledFill = textStyleValues(document, node)?.fill;
  if (styledFill && typeof styledFill === 'object' && 'space' in styledFill) {
    return solidRgb(styledFill as ManagedColor);
  }
  if (styledFill && typeof styledFill === 'object' && 'type' in styledFill) {
    const solid = styledFill as { type?: string; color?: ManagedColor };
    return solid.type === 'solid' ? solidRgb(solid.color) : null;
  }
  return solidRgb(node.fill);
}

function unavailableFontLabel(
  document: Document,
  family: string | undefined,
  fontReference: Extract<SceneNode, { kind: 'text' }>['fontReference'],
): string | null {
  const font = fontReference
    ? document.fontManifest?.fonts.find(
        (candidate) =>
          candidate.fontReference?.artifactHash === fontReference.artifactHash &&
          (!family || candidate.familyName === family),
      )
    : document.fontManifest?.fonts.find((candidate) => candidate.familyName === family);
  if (!font || ['available', 'restricted'].includes(font.status)) return null;
  return `${family ?? font.familyName} (${font.status})`;
}

function textStyleValues(document: Document, node: Extract<SceneNode, { kind: 'text' }>) {
  return node.styleId && document.styles
    ? resolveNodeStyles(node, node.styleId, document.styles)
    : undefined;
}

function localBoundsOnSlide(
  document: Document,
  frameId: NodeId,
  node: SceneNode,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const bounds = nodeLocalBounds(node, document);
  if (!bounds) return null;
  const nodeWorld = nodeWorldTransform(document, node.id);
  const frameWorld = nodeWorldTransform(document, frameId);
  const invFrame = tryInvertAffine(frameWorld);
  if (!invFrame) return null;
  const corners = [
    [bounds.x, bounds.y],
    [bounds.x + bounds.w, bounds.y],
    [bounds.x, bounds.y + bounds.h],
    [bounds.x + bounds.w, bounds.y + bounds.h],
  ].map(([x, y]) => applyAffine(invFrame, applyAffine(nodeWorld, [x!, y!] as const)));
  return {
    minX: Math.min(...corners.map(([x]) => x)),
    minY: Math.min(...corners.map(([, y]) => y)),
    maxX: Math.max(...corners.map(([x]) => x)),
    maxY: Math.max(...corners.map(([, y]) => y)),
  };
}

function missingImageReferences(document: Document, node: SceneNode): string[] {
  if (!('fills' in node || 'paintRefs' in node)) return [];
  const paints = document.paints as Record<string, Paint> | undefined;
  const fills = resolveNodePaints(node as unknown as Parameters<typeof resolveNodePaints>[0], {
    paints,
  });
  return fills.flatMap((fill) => {
    if (fill.type !== 'image' || !fill.image) return [];
    const { assetId, src } = fill.image;
    if (assetId && !document.assets?.[assetId]) return [assetId];
    if (!assetId && !src.trim()) return ['unlinked image source'];
    return [];
  });
}

function findContentFindings(
  document: Document,
  entryId: string,
  slideTitle: string,
  frame: Extract<SceneNode, { kind: 'frame' }>,
  minimumTextSize: number,
  minimumContrastRatio: number,
): PresentationFinding[] {
  const findings: PresentationFinding[] = [];
  const background = frameBackground(document, frame.id);
  const pending = [...frame.children];
  const visited = new Set<NodeId>();
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = document.nodes[id];
    if (!node || node.visible === false) continue;
    pending.push(...childrenOf(node));
    if (node.kind === 'text') {
      const styledValues = textStyleValues(document, node);
      const effectiveFontSize =
        typeof styledValues?.fontSize === 'number' ? styledValues.fontSize : node.fontSize;
      if (node.text.trim() && effectiveFontSize < minimumTextSize) {
        findings.push({
          code: 'small-text',
          severity: 'warning',
          entryId,
          slideTitle,
          nodeId: id,
          message: `Text is ${Math.round(effectiveFontSize)} px; the advisory minimum is ${minimumTextSize} px.`,
        });
      }
      if (PLACEHOLDER_TEXT.test(node.text.trim())) {
        findings.push({
          code: 'placeholder',
          severity: 'warning',
          entryId,
          slideTitle,
          nodeId: id,
          message: 'This text looks like an unfinished placeholder.',
        });
      }
      const textRgb = colorForText(document, node);
      const runColors = (node.richText?.paragraphs ?? []).flatMap((paragraph) =>
        paragraph.runs.flatMap((run) => (run.format?.color ? [solidRgb(run.format.color)] : [])),
      );
      const knownTextColors = [textRgb, ...runColors].filter(
        (color): color is [number, number, number] => color !== null,
      );
      const contrastRatios =
        background && knownTextColors.length > 0
          ? knownTextColors.map((color) =>
              contrastRatio(relativeLuminance(...color), relativeLuminance(...background)),
            )
          : [];
      const worstRatio = contrastRatios.length > 0 ? Math.min(...contrastRatios) : undefined;
      if (worstRatio !== undefined) {
        const ratio = worstRatio;
        if (ratio < minimumContrastRatio) {
          findings.push({
            code: 'low-contrast',
            severity: 'warning',
            entryId,
            slideTitle,
            nodeId: id,
            message: `Text contrast is ${ratio.toFixed(1)}:1 against the known solid slide background; the advisory minimum is ${minimumContrastRatio}:1.`,
          });
        }
      }
      const fontFamily =
        typeof styledValues?.fontFamily === 'string' ? styledValues.fontFamily : node.fontFamily;
      const fontReference =
        styledValues?.fontReference && typeof styledValues.fontReference === 'object'
          ? (styledValues.fontReference as typeof node.fontReference)
          : node.fontReference;
      const unavailableFonts = new Set<string>();
      const nodeFontProblem = unavailableFontLabel(document, fontFamily, fontReference);
      if (nodeFontProblem) unavailableFonts.add(nodeFontProblem);
      for (const paragraph of node.richText?.paragraphs ?? []) {
        for (const run of paragraph.runs) {
          const runFamily = run.format?.fontFamily ?? fontFamily;
          const runReference = run.format?.fontReference ?? fontReference;
          const runProblem = unavailableFontLabel(document, runFamily, runReference);
          if (runProblem) unavailableFonts.add(runProblem);
        }
      }
      if (unavailableFonts.size > 0) {
        findings.push({
          code: 'missing-font',
          severity: 'warning',
          entryId,
          slideTitle,
          nodeId: id,
          message: `Unavailable or substituted font: ${[...unavailableFonts].join(', ')}. Verify rendered text before delivery.`,
        });
      }
    }
    const missingAssets = missingImageReferences(document, node);
    if (missingAssets.length > 0) {
      findings.push({
        code: 'missing-asset',
        severity: 'warning',
        entryId,
        slideTitle,
        nodeId: id,
        message: `Image source(s) ${[...new Set(missingAssets)].map((assetId) => `“${assetId}”`).join(', ')} are not available in the document asset store.`,
      });
    }
    const bounds = localBoundsOnSlide(document, frame.id, node);
    if (
      bounds &&
      (bounds.minX < -1 ||
        bounds.minY < -1 ||
        bounds.maxX > frame.w + 1 ||
        bounds.maxY > frame.h + 1)
    ) {
      findings.push({
        code: 'off-slide',
        severity: 'warning',
        entryId,
        slideTitle,
        nodeId: id,
        message: 'Artwork extends beyond the slide frame; check the crop in preview.',
      });
    }
  }
  return findings;
}

/** Advisory presentation checks. Only unresolved included artwork blocks delivery. */
export function runPresentationPreflight(
  document: Document,
  deckId: string,
  options: PresentationPreflightOptions = {},
): PresentationFinding[] {
  const minimumTextSize = Math.max(1, options.minimumTextSize ?? 18);
  const minimumContrastRatio = Math.max(1, options.minimumContrastRatio ?? 4.5);
  const resolution = resolvePresentationSlides(document, deckId);
  const deliveryErrors = new Set(resolution.deliveryErrors.map(({ entry }) => entry.id));
  const findings: PresentationFinding[] = [];
  for (const resolved of resolution.slides) {
    const { entry, frame } = resolved;
    if (entry.skipped) continue;
    if (resolved.status === 'missing' || resolved.status === 'invalid-frame') {
      findings.push({
        code: 'missing-frame',
        severity: deliveryErrors.has(entry.id) ? 'blocker' : 'warning',
        entryId: entry.id,
        slideTitle: entry.title,
        message: 'The slide artwork is unavailable. Restore or replace its frame before delivery.',
      });
      continue;
    }
    if (!resolved.visible) continue;
    if (!frame) continue;
    if (!entry.title.trim()) {
      findings.push({
        code: 'empty-title',
        severity: 'warning',
        entryId: entry.id,
        slideTitle: `Slide ${resolved.index + 1}`,
        message: 'Add a descriptive slide title for navigation and recovery.',
      });
    }
    if (!entry.altText?.trim()) {
      findings.push({
        code: 'missing-alt',
        severity: 'info',
        entryId: entry.id,
        slideTitle: entry.title,
        message:
          'Add slide alt text for assistive descriptions; raster PDF output does not retain it.',
      });
    }
    findings.push(
      ...findContentFindings(
        document,
        entry.id,
        entry.title,
        frame,
        minimumTextSize,
        minimumContrastRatio,
      ),
    );
  }
  return findings;
}
