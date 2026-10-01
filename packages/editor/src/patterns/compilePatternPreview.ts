import { exportNodeToSvg } from '@varve/codegen';
import type { Document, PatternDefinition } from '@varve/scene';
import { type PatternSourceImage, periodicPatternSourceMarkup } from './patternPeriodicSource';

/** Compile editable source nodes into the SVG tile consumed by current renderers. */
export function compilePatternPreview(document: Document, definition: PatternDefinition): string {
  const source = definition.source;
  if (source.kind !== 'vector') {
    if (source.kind === 'raster') {
      const asset = document.assets?.[source.assetId];
      if (asset?.dataUrl) return asset.dataUrl;
    }
    if (definition.previewSrc && definition.previewRevision === definition.revision) {
      return definition.previewSrc;
    }
    throw new Error('This pattern source does not have a current render preview.');
  }

  const roots = source.rootIds
    .map((id) => source.nodes[id])
    .filter((node): node is NonNullable<typeof node> => Boolean(node));
  if (roots.length === 0) throw new Error('Pattern source has no artwork to render.');

  const sourceDocument = {
    ...document,
    nodes: { ...document.nodes, ...source.nodes },
    rootChildren: source.rootIds,
    components: document.components ?? {},
  } as Document;
  const { width, height } = definition.cell;
  if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error('Pattern tile dimensions must be positive and finite.');
  }
  const sourceImages: PatternSourceImage[] = [];
  for (const node of roots) {
    const svg = exportNodeToSvg(node, sourceDocument, { background: 'transparent' });
    if (/(?:href|xlink:href)="(?:https?:|file:|\/\/)/i.test(svg)) {
      throw new Error(`Pattern motif "${node.name}" still references an external image.`);
    }
    const match = /\bviewBox="([^"]+)"/.exec(svg);
    const values = match?.[1]
      ?.trim()
      .split(/[\s,]+/)
      .map(Number);
    if (values?.length !== 4 || values.some((value) => !Number.isFinite(value))) {
      throw new Error(`Pattern motif "${node.name}" could not be exported with finite bounds.`);
    }
    const [x, y, width, height] = values as [number, number, number, number];
    if (width <= 0 || height <= 0) continue;
    const href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    sourceImages.push({ href, x, y, width, height });
  }
  if (sourceImages.length === 0)
    throw new Error('Pattern source contains no visible vector artwork.');
  const imageMarkup = periodicPatternSourceMarkup(
    sourceImages,
    { width, height },
    {
      tileWidth: width,
      tileHeight: height,
      gapX: definition.repeat.gapX,
      gapY: definition.repeat.gapY,
      arrangement: definition.repeat.arrangement,
      rowShift: definition.repeat.rowShift,
      columnShift: definition.repeat.columnShift,
      mirrorX: definition.repeat.mirrorX,
      mirrorY: definition.repeat.mirrorY,
      offsetX: 0,
      offsetY: 0,
    },
  );
  const tileSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    imageMarkup.join('') +
    '</svg>';
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(tileSvg)}`;
}
