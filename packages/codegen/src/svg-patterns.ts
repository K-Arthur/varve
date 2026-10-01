import type { Fill, PatternDefinition, Document as SceneDocument, SceneNode } from '@varve/scene';
import { escapeXml, getChildren } from './shared';
import type { RasterAsset } from './types';
import { unbakeableWarpKind } from './warpBake';

export interface SvgPatternFillResolution {
  id: string;
  opacity: number;
  supported: boolean;
  warning?: string;
}

interface SvgPatternFillConfig extends SvgPatternFillResolution {
  supported: true;
  target: Extract<SceneNode, { kind: 'shape' }>;
  definition: PatternDefinition;
  tileWidth: number;
  tileHeight: number;
  periodWidth: number;
  periodHeight: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
}

export interface SvgPatternBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SvgPatternRenderHost {
  shapeBounds(target: Extract<SceneNode, { kind: 'shape' }>, doc: SceneDocument): SvgPatternBounds;
  renderVectorSource(
    doc: SceneDocument,
    roots: readonly SceneNode[],
    preserveColorSpace: boolean,
    rasterAssets?: Record<string, RasterAsset>,
  ): { defs: string[]; markup: string };
}

export function fmtPatternNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Number(n.toPrecision(12)).toString();
}

/** Resolve the one pattern paint server the current SVG fill stack can emit. */
export function svgPatternFillForNode(
  node: SceneNode,
  doc: SceneDocument,
): SvgPatternFillResolution | undefined {
  const entries = (node.fills ?? []).map((fill, index) => ({ fill, index }));
  const visiblePatterns = entries.filter(
    ({ fill }) => fill.visible !== false && fill.type === 'pattern',
  );
  if (visiblePatterns.length === 0) return undefined;
  const entry = visiblePatterns[0]!;
  if (node.kind !== 'shape') {
    return unsupportedPattern(
      node,
      entry.index,
      'SVG pattern fills currently require a shape target.',
    );
  }
  if (node.shape.kind === 'line' || node.shape.kind === 'arrow') {
    return unsupportedPattern(
      node,
      entry.index,
      'SVG pattern fills currently require a closed shape.',
    );
  }
  if (
    visiblePatterns.length !== 1 ||
    entries.filter(({ fill }) => fill.visible !== false).length !== 1
  ) {
    return unsupportedPattern(
      node,
      entry.index,
      'SVG export supports one visible fill per shape; separate stacked fills before export.',
    );
  }
  const resolved = resolveSvgPatternFill(node, entry.fill, entry.index, doc);
  if ('reason' in resolved) return unsupportedPattern(node, entry.index, resolved.reason);
  return { id: resolved.id, opacity: resolved.opacity, supported: true };
}

function unsupportedPattern(
  node: SceneNode,
  fillIndex: number,
  warning: string,
): SvgPatternFillResolution {
  return { id: svgPatternId(node.id, fillIndex), opacity: 1, supported: false, warning };
}

function resolveSvgPatternFill(
  node: SceneNode,
  fill: Fill,
  fillIndex: number,
  doc: SceneDocument,
): SvgPatternFillConfig | { reason: string } {
  if (node.kind !== 'shape' || fill.type !== 'pattern' || !fill.pattern) {
    return { reason: 'SVG pattern fills currently require a shape target.' };
  }
  if (unbakeableWarpKind(node)) {
    return {
      reason: 'A pattern fill on a warped container or text target cannot be preserved in SVG.',
    };
  }
  const pattern = fill.pattern;
  if (!pattern.definitionId) {
    return { reason: 'Only reusable pattern definitions can be exported as native SVG patterns.' };
  }
  const definition = doc.patternDefinitions?.[pattern.definitionId];
  if (!definition)
    return { reason: 'The linked pattern definition is missing from this document.' };
  if (definition.dependencyPatternIds?.length) {
    return { reason: 'Nested pattern definitions are not supported by SVG export.' };
  }
  if (pattern.alignment === 'document') {
    return {
      reason: 'Document-aligned pattern placement cannot be preserved by this SVG export path.',
    };
  }
  if (fill.blendMode !== 'normal') {
    return {
      reason: 'Pattern fill blend modes other than Normal are not supported by SVG export.',
    };
  }
  const repeat = definition.repeat;
  const arrangement = pattern.arrangement ?? repeat.arrangement;
  const rowShift = pattern.rowShift ?? repeat.rowShift;
  const columnShift = pattern.columnShift ?? repeat.columnShift ?? 0;
  if (
    arrangement !== 'grid' ||
    (rowShift !== 0 && rowShift !== undefined) ||
    (columnShift !== 0 && columnShift !== undefined) ||
    (pattern.mirrorX ?? repeat.mirrorX) ||
    (pattern.mirrorY ?? repeat.mirrorY)
  ) {
    return {
      reason:
        'Change the pattern to a grid repeat without stagger or mirroring for native SVG export.',
    };
  }
  const { width: cellWidth, height: cellHeight } = definition.cell;
  const tileWidth = pattern.imageWidth ?? cellWidth;
  const tileHeight = pattern.imageHeight ?? cellHeight;
  const gapX = pattern.gapX ?? repeat.gapX ?? 0;
  const gapY = pattern.gapY ?? repeat.gapY ?? 0;
  const periodWidth = tileWidth + gapX;
  const periodHeight = tileHeight + gapY;
  const offsetX = pattern.offsetX ?? repeat.originX;
  const offsetY = pattern.offsetY ?? repeat.originY;
  const rotation = pattern.rotation;
  const opacity = fill.opacity;
  if (
    ![
      cellWidth,
      cellHeight,
      definition.cell.x,
      definition.cell.y,
      tileWidth,
      tileHeight,
      gapX,
      gapY,
      periodWidth,
      periodHeight,
      offsetX,
      offsetY,
      rotation,
      opacity,
    ].every(Number.isFinite) ||
    cellWidth <= 0 ||
    cellHeight <= 0 ||
    tileWidth <= 0 ||
    tileHeight <= 0 ||
    periodWidth <= 0 ||
    periodHeight <= 0 ||
    opacity < 0 ||
    opacity > 1
  ) {
    return {
      reason:
        'Pattern dimensions, repeat periods, phase, rotation, and opacity must be finite and valid.',
    };
  }
  if (definition.source.kind === 'vector') {
    const source = definition.source;
    if (source.styleIds.length > 0 || source.componentIds.length > 0) {
      return {
        reason: 'Pattern motifs with linked styles or components are not supported by SVG export.',
      };
    }
    if (source.rootIds.length === 0 || source.rootIds.some((id) => !source.nodes[id])) {
      return { reason: 'The vector pattern source is empty or has missing motif nodes.' };
    }
    if (
      Object.values(source.nodes).some(
        (sourceNode) =>
          unbakeableWarpKind(sourceNode) ||
          (sourceNode.fills ?? []).some((item) => item.type === 'pattern'),
      )
    ) {
      return {
        reason:
          'Vector motifs with nested patterns or unbakeable warps are not supported by SVG export.',
      };
    }
    if (
      Object.values(source.nodes).some((sourceNode) =>
        (sourceNode.fills ?? []).some(
          (item) =>
            item.visible !== false &&
            item.type === 'image' &&
            !isEmbeddedPatternImage(item.image?.src),
        ),
      )
    ) {
      return { reason: 'Vector pattern motifs must embed image dependencies before SVG export.' };
    }
  } else if (definition.source.kind === 'raster') {
    const dataUrl = doc.assets?.[definition.source.assetId]?.dataUrl;
    if (!isEmbeddedPatternImage(dataUrl)) {
      return {
        reason:
          'The raster pattern source must be an embedded PNG, JPEG, WebP, GIF, or AVIF image.',
      };
    }
  } else if (
    definition.previewRevision !== definition.revision ||
    !isEmbeddedPatternImage(definition.previewSrc)
  ) {
    return { reason: 'The procedural pattern has no current embedded raster preview.' };
  }
  return {
    id: svgPatternId(node.id, fillIndex),
    opacity,
    supported: true,
    target: node,
    definition,
    tileWidth,
    tileHeight,
    periodWidth,
    periodHeight,
    offsetX,
    offsetY,
    rotation,
  };
}

function isEmbeddedPatternImage(source: string | undefined): source is string {
  return Boolean(source && /^data:image\/(?:png|jpeg|webp|gif|avif);/i.test(source));
}

function svgPatternId(nodeId: string, fillIndex: number): string {
  const encoded = Array.from(nodeId)
    .map((character) => (character.codePointAt(0) ?? 0).toString(16))
    .join('-');
  return `varve-pattern-${encoded || 'node'}-${fillIndex}`;
}

function svgPatternSourceId(definitionId: string): string {
  const encoded = Array.from(definitionId)
    .map((character) => (character.codePointAt(0) ?? 0).toString(16))
    .join('-');
  return `varve-pattern-source-${encoded || 'definition'}`;
}

/** Collect user-space SVG patterns and source motif dependencies for a subtree. */
export function collectSvgPatternDefs(
  rootNodes: readonly SceneNode[],
  doc: SceneDocument,
  host: SvgPatternRenderHost,
  preserveColorSpace = false,
  rasterAssets?: Record<string, RasterAsset>,
): string[] {
  const defs: string[] = [];
  const seenIds = new Map<string, string>();
  const addUnique = (definition: string): void => {
    const id = /\bid="([^"]+)"/.exec(definition)?.[1];
    if (id && seenIds.has(id)) return;
    if (id) seenIds.set(id, definition);
    defs.push(definition);
  };
  const visit = (node: SceneNode): void => {
    for (const [index, fill] of (node.fills ?? []).entries()) {
      if (fill.type !== 'pattern' || fill.visible === false) continue;
      const resolved = resolveSvgPatternFill(node, fill, index, doc);
      if ('reason' in resolved || !svgPatternFillForNode(node, doc)?.supported) continue;
      for (const definition of patternDefinitionElements(
        resolved,
        doc,
        host,
        preserveColorSpace,
        rasterAssets,
      )) {
        addUnique(definition);
      }
    }
    if (node.kind === 'group' || node.kind === 'frame') {
      for (const child of getChildren(doc, node)) visit(child);
    }
  };
  for (const node of rootNodes) visit(node);
  return defs;
}

function patternDefinitionElements(
  config: SvgPatternFillConfig,
  doc: SceneDocument,
  host: SvgPatternRenderHost,
  preserveColorSpace: boolean,
  rasterAssets?: Record<string, RasterAsset>,
): string[] {
  const definition = config.definition;
  const cell = definition.cell;
  const b = host.shapeBounds(config.target, doc);
  const x = b.x + config.offsetX;
  const y = b.y + config.offsetY;
  const rotation =
    config.rotation === 0
      ? ''
      : ` patternTransform="rotate(${fmtPatternNumber(config.rotation)} ${fmtPatternNumber(b.x + b.width / 2)} ${fmtPatternNumber(b.y + b.height / 2)})"`;
  const scaleX = config.tileWidth / cell.width;
  const scaleY = config.tileHeight / cell.height;
  const contentTransform = `matrix(${fmtPatternNumber(scaleX)} 0 0 ${fmtPatternNumber(scaleY)} ${fmtPatternNumber(-cell.x * scaleX)} ${fmtPatternNumber(-cell.y * scaleY)})`;
  let content: string;
  const dependencies: string[] = [];
  const sourceGroupId = svgPatternSourceId(definition.id);
  if (definition.source.kind === 'vector') {
    const sourceDoc: SceneDocument = {
      ...doc,
      nodes: { ...doc.nodes, ...definition.source.nodes },
      rootChildren: definition.source.rootIds,
    };
    const roots = definition.source.rootIds
      .map((id) => sourceDoc.nodes[id])
      .filter((node): node is SceneNode => Boolean(node));
    const rendered = host.renderVectorSource(sourceDoc, roots, preserveColorSpace, rasterAssets);
    if (/(?:href|xlink:href)\s*=\s*["'](?:https?:|file:|\/\/)/i.test(rendered.markup)) return [];
    dependencies.push(
      ...rendered.defs,
      `    <g id="${sourceGroupId}">\n${rendered.markup}\n    </g>`,
    );
    content = `      <use href="#${sourceGroupId}" transform="${contentTransform}" />`;
  } else {
    const source =
      definition.source.kind === 'raster'
        ? doc.assets?.[definition.source.assetId]?.dataUrl
        : definition.previewSrc;
    if (!isEmbeddedPatternImage(source)) return [];
    dependencies.push(
      `    <g id="${sourceGroupId}"><image href="${escapeXml(source)}" x="${fmtPatternNumber(cell.x)}" y="${fmtPatternNumber(cell.y)}" width="${fmtPatternNumber(cell.width)}" height="${fmtPatternNumber(cell.height)}" preserveAspectRatio="none" /></g>`,
    );
    content = `      <use href="#${sourceGroupId}" transform="${contentTransform}" />`;
  }

  const pattern = [
    `    <pattern id="${config.id}" patternUnits="userSpaceOnUse" patternContentUnits="userSpaceOnUse" x="${fmtPatternNumber(x)}" y="${fmtPatternNumber(y)}" width="${fmtPatternNumber(config.periodWidth)}" height="${fmtPatternNumber(config.periodHeight)}"${rotation}>`,
    content,
    '    </pattern>',
  ].join('\n');
  return [...dependencies, pattern];
}
