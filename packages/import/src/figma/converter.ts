import { type Affine, multiplyAffine, type Shape } from '@varve/engine';
import {
  createDocument,
  createEmbeddedAsset,
  type Document,
  type Effect,
  type ExportPreset,
  type Fill,
  type LayoutStyle,
  type ManagedColor,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
  makeTextNode,
  mintId,
  plainTextToRichText,
  type SceneNode,
  type Stroke,
  type TextNode,
  type VariableValue,
} from '@varve/scene';
import { parsePathData } from '../svg/shared';
import type {
  FigmaBounds,
  FigmaPaint,
  FigmaSourceDocument,
  FigmaSourceNode,
  FigmaTextStyle,
} from './source';

interface ConversionState {
  base: Document;
  nodes: Record<string, SceneNode>;
  nextId: number;
  sourceToVarve: Map<string, string>;
  componentIds: Map<string, string>;
  styleIds: Map<string, string>;
  variableIds: Map<string, string>;
  variableCollectionIds: Map<string, string>;
  styleSamples: Map<string, SceneNode>;
  interactions: Map<string, Array<Record<string, unknown>>>;
  warnings: string[];
  unsupportedFeatures: string[];
  fonts: Set<string>;
  images: FigmaSourceDocument['images'];
}

function allocate(state: ConversionState, prefix = 'n'): string {
  const id = mintId(prefix, state.nextId);
  state.nextId += 1;
  return id;
}

function addWarning(state: ConversionState, message: string): void {
  if (!state.warnings.includes(message)) state.warnings.push(message);
}

function addUnsupported(state: ConversionState, message: string): void {
  if (!state.unsupportedFeatures.includes(message)) state.unsupportedFeatures.push(message);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function color(value: FigmaPaint['color'] | undefined): ManagedColor {
  return {
    space: 'rgb',
    r: Math.round(Math.max(0, Math.min(1, value?.r ?? 0)) * 255),
    g: Math.round(Math.max(0, Math.min(1, value?.g ?? 0)) * 255),
    b: Math.round(Math.max(0, Math.min(1, value?.b ?? 0)) * 255),
    a: Math.round(Math.max(0, Math.min(1, value?.a ?? 1)) * 255),
  };
}

function transparent(): ManagedColor {
  return { space: 'rgb', r: 0, g: 0, b: 0, a: 0 };
}

function blendMode(value: string | undefined): SceneNode['blendMode'] {
  const map: Record<string, SceneNode['blendMode']> = {
    PASS_THROUGH: 'passThrough',
    NORMAL: 'normal',
    MULTIPLY: 'multiply',
    SCREEN: 'screen',
    OVERLAY: 'overlay',
    DARKEN: 'darken',
    LIGHTEN: 'lighten',
    COLOR_DODGE: 'colorDodge',
    COLOR_BURN: 'colorBurn',
    HARD_LIGHT: 'hardLight',
    SOFT_LIGHT: 'softLight',
    DIFFERENCE: 'difference',
    EXCLUSION: 'exclusion',
    HUE: 'hue',
    SATURATION: 'saturation',
    COLOR: 'color',
    LUMINOSITY: 'luminosity',
    PLUS_DARKER: 'plusDarker',
    PLUS_LIGHTER: 'plusLighter',
  };
  return map[value ?? 'NORMAL'] ?? 'normal';
}

function affine(node: FigmaSourceNode, parent: FigmaBounds | undefined): Affine {
  if (node.transform) return node.transform;
  return [1, 0, 0, 1, node.bounds.x - (parent?.x ?? 0), node.bounds.y - (parent?.y ?? 0)];
}

function gradientType(paint: FigmaPaint): 'linear' | 'radial' | 'angular' | 'diamond' {
  switch (paint.type) {
    case 'GRADIENT_RADIAL':
      return 'radial';
    case 'GRADIENT_ANGULAR':
      return 'angular';
    case 'GRADIENT_DIAMOND':
      return 'diamond';
    default:
      return 'linear';
  }
}

function gradientRotation(paint: FigmaPaint): number | undefined {
  const first = paint.gradientHandlePositions?.[0];
  const second = paint.gradientHandlePositions?.[1];
  if (!first || !second) return undefined;
  return (Math.atan2(second.y - first.y, second.x - first.x) * 180) / Math.PI;
}

/**
 * Convert Figma's normalized gradient handles into Varve's canonical affine
 * field. Figma emits three handles: linear start/end plus the perpendicular
 * axis point, or radial centre plus the two radius axes. Keeping all three
 * points avoids reducing authored skew/non-uniform scale to an angle.
 */
function gradientTransform(paint: FigmaPaint, bounds: FigmaBounds): Affine | undefined {
  let normalized: Affine | undefined;
  if (paint.gradientTransform) {
    normalized = [...paint.gradientTransform] as Affine;
  }
  const [first, second, third] = paint.gradientHandlePositions ?? [];
  if (!normalized && (!first || !second || !third)) return undefined;

  if (!normalized && paint.type === 'GRADIENT_LINEAR') {
    const ux = second.x - first.x;
    const uy = second.y - first.y;
    const vx = 2 * (third.x - first.x - ux * 0.5);
    const vy = 2 * (third.y - first.y - uy * 0.5);
    normalized = [ux, uy, vx, vy, first.x - vx * 0.5, first.y - vy * 0.5];
  }

  if (!normalized) {
    const ux = 2 * (second.x - first.x);
    const uy = 2 * (second.y - first.y);
    const vx = 2 * (third.x - first.x);
    const vy = 2 * (third.y - first.y);
    normalized = [ux, uy, vx, vy, first.x - (ux + vx) * 0.5, first.y - (uy + vy) * 0.5];
  }
  return multiplyAffine([bounds.w, 0, 0, bounds.h, 0, 0], normalized);
}

function assetForImage(
  state: ConversionState,
  ref: string,
  bounds: FigmaBounds,
): string | undefined {
  const source = state.images[ref];
  if (!source) {
    addWarning(
      state,
      `Image reference "${ref}" has no embedded bytes; the image placement was omitted`,
    );
    addUnsupported(state, 'image paints without embedded bytes');
    return undefined;
  }
  const asset = createEmbeddedAsset({
    dataUrl: source.dataUrl,
    mimeType: source.dataUrl.slice(5, source.dataUrl.indexOf(';')) || 'application/octet-stream',
    naturalWidth: source.width ?? Math.max(1, bounds.w),
    naturalHeight: source.height ?? Math.max(1, bounds.h),
  });
  state.base = { ...state.base, assets: { ...state.base.assets, [asset.id]: asset } };
  return asset.id;
}

function fill(state: ConversionState, paint: FigmaPaint, bounds: FigmaBounds): Fill | undefined {
  if (!paint.visible) return undefined;
  const opacity = Math.max(0, Math.min(1, paint.opacity));
  const common = { opacity, blendMode: blendMode(paint.blendMode), visible: true } as const;
  if (paint.type === 'SOLID' || paint.type === 'EMOJI') {
    return { type: 'solid', color: color(paint.color), ...common };
  }
  if (paint.type.startsWith('GRADIENT_') && paint.gradientStops) {
    const transform = gradientTransform(paint, bounds);
    return {
      type: 'gradient',
      gradient: {
        type: gradientType(paint),
        stops: paint.gradientStops.map((stop) => ({
          position: stop.position,
          color: color(stop.color),
        })),
        ...(transform ? { transform } : { rotation: gradientRotation(paint) }),
      },
      ...common,
    };
  }
  if (paint.type === 'IMAGE' && paint.imageRef) {
    const assetId = assetForImage(state, paint.imageRef, bounds);
    if (!assetId) return undefined;
    const asset = state.base.assets?.[assetId];
    return {
      type: 'image',
      image: {
        src: asset?.dataUrl ?? '',
        assetId,
        fit: imageFit(paint.scaleMode),
        x: 0,
        y: 0,
        scale: 1,
        imageWidth: asset?.naturalWidth,
        imageHeight: asset?.naturalHeight,
      },
      ...common,
    };
  }
  return undefined;
}

function imageFit(value: string | undefined): 'fill' | 'fit' | 'stretch' | 'tile' | 'crop' {
  switch (value) {
    case 'FIT':
      return 'fit';
    case 'CROP':
      return 'crop';
    case 'TILE':
      return 'tile';
    case 'STRETCH':
      return 'stretch';
    default:
      return 'fill';
  }
}

function fills(state: ConversionState, node: FigmaSourceNode): Fill[] {
  return node.fills
    .map((paintValue) => fill(state, paintValue, node.bounds))
    .filter((value): value is Fill => value !== undefined);
}

function strokeCap(value: string | undefined): Stroke['cap'] {
  if (value === 'ROUND') return 'round';
  if (value === 'SQUARE') return 'square';
  return 'butt';
}

function strokeJoin(value: string | undefined): Stroke['join'] {
  if (value === 'ROUND') return 'round';
  if (value === 'BEVEL') return 'bevel';
  return 'miter';
}

function strokes(node: FigmaSourceNode): Stroke[] {
  return node.strokes
    .filter((paintValue) => paintValue.type === 'SOLID')
    .map((paintValue) => ({
      color: color(paintValue.color),
      weight: Math.max(0, node.strokeWeight ?? 1),
      align:
        node.strokeAlign === 'INSIDE'
          ? 'inside'
          : node.strokeAlign === 'OUTSIDE'
            ? 'outside'
            : 'center',
      dashPattern: node.strokeDashes ?? [],
      dashOffset: 0,
      cap: strokeCap(node.strokeCap),
      join: strokeJoin(node.strokeJoin),
      miterLimit: Math.max(1, node.miterLimit ?? 4),
      visible: paintValue.visible,
    }));
}

function effects(node: FigmaSourceNode, state: ConversionState): Effect[] {
  return node.effects.flatMap((source) => {
    const colorValue = color(source.color);
    const offset = source.offset ?? { x: 0, y: 0 };
    const opacity = Math.max(0, Math.min(1, source.color?.a ?? 1));
    if (source.type === 'DROP_SHADOW' || source.type === 'INNER_SHADOW') {
      const effect: Effect = {
        type: source.type === 'DROP_SHADOW' ? 'dropShadow' : 'innerShadow',
        x: offset.x,
        y: offset.y,
        blur: source.radius ?? 0,
        spread: source.spread ?? 0,
        color: colorValue,
        opacity,
        blendMode: 'normal',
        visible: source.visible,
      };
      return [effect];
    }
    if (source.type === 'LAYER_BLUR' || source.type === 'BACKGROUND_BLUR') {
      const effect: Effect = {
        type: source.type === 'LAYER_BLUR' ? 'layerBlur' : 'backgroundBlur',
        radius: source.radius ?? 0,
        visible: source.visible,
      };
      return [effect];
    }
    addUnsupported(state, `effect ${source.type}`);
    return [];
  });
}

function pathPoints(path: string): ReturnType<typeof parsePathData> | undefined {
  const parsed = parsePathData(path, 1);
  return parsed.contours.some((contour) => contour.points.length >= 2) ? parsed : undefined;
}

function shapeForNode(node: FigmaSourceNode, state: ConversionState): Shape {
  const { w, h } = node.bounds;
  if (node.type === 'ELLIPSE')
    return { kind: 'ellipse', cx: w / 2, cy: h / 2, rx: w / 2, ry: h / 2 };
  if (node.type === 'LINE') return { kind: 'line', from: [0, 0], to: [w, h], tolerance: 3 };
  if (node.type === 'POLYGON')
    return {
      kind: 'polygon',
      cx: w / 2,
      cy: h / 2,
      radius: Math.min(w, h) / 2,
      sides: node.pointCount ?? 6,
      rotation: 0,
    };
  if (node.type === 'STAR')
    return {
      kind: 'star',
      cx: w / 2,
      cy: h / 2,
      innerRadius: Math.min(w, h) * (node.starInnerScale ?? 0.2),
      outerRadius: Math.min(w, h) / 2,
      points: node.pointCount ?? 5,
      rotation: 0,
    };
  if (node.type === 'VECTOR' && node.fillGeometry && node.fillGeometry.length > 0) {
    const parsed = pathPoints(node.fillGeometry[0]!.path);
    if (parsed)
      return {
        kind: 'path',
        points: parsed.points,
        closed: parsed.closed || parsed.contours.length > 1,
        tolerance: 3,
        ...(parsed.contours.length > 1
          ? { holes: parsed.contours.slice(1).map((contour) => contour.points) }
          : {}),
        fillRule: node.fillGeometry[0]!.windingRule === 'EVENODD' ? 'evenodd' : 'nonzero',
      };
  }
  if (node.type === 'VECTOR') addUnsupported(state, `vector geometry for "${node.name}"`);
  return { kind: 'rect', x: 0, y: 0, w, h };
}

function convertVectorRegions(
  state: ConversionState,
  source: FigmaSourceNode,
  parent: FigmaBounds | undefined,
  id: string,
  nodeFills: Fill[],
): SceneNode {
  const regionIds: string[] = [];
  for (const [index, geometry] of (source.geometryRegions ?? []).entries()) {
    const regionId = allocate(state, 'vector-region');
    const regionSource: FigmaSourceNode = {
      ...source,
      sourceId: `${source.sourceId}:region:${index}`,
      transform: [1, 0, 0, 1, 0, 0],
      children: [],
      fillGeometry: [geometry],
      geometryRegions: undefined,
    };
    const region = makeShapeNode(regionId, shapeForNode(regionSource, state), {
      name: `${source.name} region ${index + 1}`,
      transform: [1, 0, 0, 1, 0, 0],
      strokes: index === 0 ? strokes(source) : [],
      effects: index === 0 ? effects(source, state) : [],
    });
    state.nodes[regionId] = applyCommon(state, region, regionSource, undefined, nodeFills);
    regionIds.push(regionId);
  }
  const group = makeGroupNode(id, {
    name: source.name,
    children: regionIds,
    transform: affine(source, parent),
    effects: [],
  });
  return applyCommon(state, group, source, parent, nodeFills);
}

function sizing(value: string | undefined): 'fixed' | 'hug' | 'fill' | undefined {
  if (value === 'FIXED') return 'fixed';
  if (value === 'HUG') return 'hug';
  if (value === 'FILL') return 'fill';
  return undefined;
}

function align(value: string | undefined): 'start' | 'center' | 'end' | 'stretch' | undefined {
  if (value === 'CENTER') return 'center';
  if (value === 'MAX') return 'end';
  if (value === 'STRETCH') return 'stretch';
  if (value === 'MIN' || value === 'BASELINE') return 'start';
  return undefined;
}

function justify(value: string | undefined): LayoutStyle['justifyContent'] {
  if (value === 'CENTER') return 'center';
  if (value === 'MAX') return 'end';
  if (value === 'SPACE_BETWEEN') return 'spaceBetween';
  if (value === 'SPACE_AROUND') return 'spaceAround';
  if (value === 'SPACE_EVENLY') return 'spaceEvenly';
  return 'start';
}

function layoutStyle(node: FigmaSourceNode): LayoutStyle | undefined {
  if (node.layoutMode === 'NONE') return undefined;
  if (node.layoutMode === 'GRID') {
    const grid = node.layoutGrids?.find(
      (entry) => entry.pattern === 'GRID' || entry.pattern === 'COLUMNS',
    );
    const count = Math.max(1, grid?.count ?? 1);
    return {
      mode: 'grid',
      direction: 'row',
      gap: Math.max(0, node.itemSpacing ?? 0),
      wrap: true,
      padding: [
        node.paddingTop ?? 0,
        node.paddingRight ?? 0,
        node.paddingBottom ?? 0,
        node.paddingLeft ?? 0,
      ],
      grow: 0,
      shrink: 0,
      rowGap: Math.max(0, node.counterAxisSpacing ?? node.itemSpacing ?? 0),
      columnGap: Math.max(0, node.itemSpacing ?? 0),
      gridTemplateColumns: `repeat(${count}, 1fr)`,
      gridAutoFlow: 'row',
    };
  }
  return {
    mode: 'flex',
    direction: node.layoutMode === 'VERTICAL' ? 'column' : 'row',
    gap: Math.max(0, node.itemSpacing ?? 0),
    wrap: node.layoutWrap === 'WRAP',
    padding: [
      node.paddingTop ?? 0,
      node.paddingRight ?? 0,
      node.paddingBottom ?? 0,
      node.paddingLeft ?? 0,
    ],
    grow: 0,
    shrink: 0,
    alignItems: align(node.counterAxisAlignItems),
    justifyContent: justify(node.primaryAxisAlignItems),
  };
}

function exportPresets(node: FigmaSourceNode, state: ConversionState): ExportPreset[] | undefined {
  const presets: ExportPreset[] = [];
  for (const [index, setting] of (node.exportSettings ?? []).entries()) {
    const format = setting.format?.toLowerCase();
    if (
      format !== 'png' &&
      format !== 'jpg' &&
      format !== 'webp' &&
      format !== 'svg' &&
      format !== 'pdf-screen'
    ) {
      addUnsupported(state, `export format ${setting.format ?? 'unknown'}`);
      continue;
    }
    const constraint = setting.constraint;
    const scale: ExportPreset['scale'] =
      constraint?.type === 'WIDTH'
        ? { type: 'width', pixels: Math.max(1, constraint.value ?? 1) }
        : constraint?.type === 'HEIGHT'
          ? { type: 'height', pixels: Math.max(1, constraint.value ?? 1) }
          : { type: 'factor', value: Math.max(0.01, constraint?.value ?? 1) };
    presets.push({
      id: `figma-export-${node.sourceId}-${index}`,
      format,
      scale,
      suffix: setting.suffix ?? '',
      enabled: true,
    });
  }
  return presets.length > 0 ? presets : undefined;
}

function constraint(value: string | undefined): 'min' | 'max' | 'center' | 'stretch' | 'scale' {
  if (value === 'MAX') return 'max';
  if (value === 'CENTER') return 'center';
  if (value === 'STRETCH') return 'stretch';
  if (value === 'SCALE') return 'scale';
  return 'min';
}

function bindings(
  state: ConversionState,
  node: FigmaSourceNode,
): Record<string, { variableId: string }> | undefined {
  if (!node.boundVariables) return undefined;
  const result: Record<string, { variableId: string }> = {};
  for (const [property, raw] of Object.entries(node.boundVariables)) {
    const first = Array.isArray(raw) ? raw[0] : raw;
    const sourceId = first?.id;
    const variableId = sourceId ? state.variableIds.get(sourceId) : undefined;
    if (variableId) result[property === 'fills' ? 'fill' : property] = { variableId };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function textFormat(style: FigmaTextStyle | undefined): Record<string, unknown> | undefined {
  if (!style) return undefined;
  return {
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    fontSize: style.fontSize,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
  };
}

function richText(node: FigmaSourceNode): TextNode['richText'] | undefined {
  if (
    !node.text ||
    !node.characterStyleOverrides ||
    !node.styleOverrideTable ||
    !node.characterStyleOverrides.some((value) => value !== 0)
  )
    return undefined;
  const paragraphs = node.text.split('\n').map((line, paragraphIndex) => {
    const start = node
      .text!.split('\n')
      .slice(0, paragraphIndex)
      .reduce((sum, value) => sum + value.length + 1, 0);
    const runs: Array<{ text: string; format?: Record<string, unknown> }> = [];
    let offset = 0;
    while (offset < line.length) {
      const styleIndex = node.characterStyleOverrides![start + offset] ?? 0;
      let end = offset + 1;
      while (end < line.length && (node.characterStyleOverrides![start + end] ?? 0) === styleIndex)
        end += 1;
      const format = textFormat(node.styleOverrideTable![String(styleIndex)]);
      runs.push({ text: line.slice(offset, end), format });
      offset = end;
    }
    return { runs, format: undefined };
  });
  return { paragraphs } as TextNode['richText'];
}

function applyCommon<T extends SceneNode>(
  state: ConversionState,
  node: T,
  source: FigmaSourceNode,
  parent: FigmaBounds | undefined,
  nodeFills: Fill[],
): T {
  const firstSolid = nodeFills.find((entry) => entry.type === 'solid');
  const sourceStyle = source.styleRefs ? Object.values(source.styleRefs)[0] : undefined;
  const presets = exportPresets(source, state);
  if (sourceStyle && !state.styleSamples.has(sourceStyle))
    state.styleSamples.set(sourceStyle, node);
  if (source.textStyle?.fontFamily) state.fonts.add(source.textStyle.fontFamily);
  return {
    ...node,
    visible: source.visible,
    locked: source.locked,
    opacity: source.opacity,
    blendMode: blendMode(source.blendMode),
    rotation: source.transform ? 0 : (source.rotation ?? 0),
    transform: affine(source, parent),
    fill: firstSolid?.color ?? transparent(),
    fills: nodeFills,
    constraints: source.constraints
      ? {
          horizontal: constraint(source.constraints.horizontal),
          vertical: constraint(source.constraints.vertical),
        }
      : undefined,
    bindings: bindings(state, source),
    layoutSizingWidth:
      sizing(source.layoutSizingHorizontal) ??
      (source.layoutGrow && source.layoutGrow > 0 ? 'fill' : undefined),
    layoutSizingHeight: sizing(source.layoutSizingVertical),
    layoutSizing: sizing(source.layoutSizingHorizontal) ?? sizing(source.layoutSizingVertical),
    layoutPosition: source.layoutPositioning === 'ABSOLUTE' ? 'absolute' : 'flow',
    layoutAlign:
      source.layoutAlign === 'STRETCH'
        ? 'stretch'
        : source.layoutAlign === 'CENTER'
          ? 'center'
          : source.layoutAlign === 'MAX'
            ? 'end'
            : undefined,
    styleId: sourceStyle ? state.styleIds.get(sourceStyle) : undefined,
    ...(source.minWidth && source.minWidth > 0 ? { minWidth: source.minWidth } : {}),
    ...(source.maxWidth && source.maxWidth > 0 ? { maxWidth: source.maxWidth } : {}),
    ...(source.minHeight && source.minHeight > 0 ? { minHeight: source.minHeight } : {}),
    ...(source.maxHeight && source.maxHeight > 0 ? { maxHeight: source.maxHeight } : {}),
    ...(presets ? { presets } : {}),
  } as T;
}

function convertText(
  state: ConversionState,
  source: FigmaSourceNode,
  parent: FigmaBounds | undefined,
  id: string,
  nodeFills: Fill[],
): TextNode {
  const style = source.textStyle;
  const text = source.text ?? '';
  const node = makeTextNode(id, text, {
    name: source.name,
    w: source.bounds.w,
    h: source.bounds.h,
    transform: affine(source, parent),
    fill: nodeFills.find((entry) => entry.type === 'solid')?.color ?? {
      space: 'rgb',
      r: 0,
      g: 0,
      b: 0,
      a: 255,
    },
    fontFamily: style?.fontFamily,
    fontWeight: style?.fontWeight,
    fontStyle: style?.fontStyle,
    fontSize: style?.fontSize,
    lineHeight: style?.lineHeight
      ? style.lineHeight / Math.max(1, style.fontSize ?? 16)
      : undefined,
    letterSpacing: style?.letterSpacing,
    textAlign: style?.textAlign,
    textAlignVertical: style?.textAlignVertical,
    textCase: style?.textCase,
    textDecoration: style?.textDecoration,
    textResizing: style?.textResizing,
    richText: richText(source) ?? plainTextToRichText(text),
    strokes: strokes(source),
    effects: effects(source, state),
  });
  return applyCommon(state, { ...node, fills: nodeFills }, source, parent, nodeFills);
}

function convertNode(
  state: ConversionState,
  source: FigmaSourceNode,
  parent: FigmaBounds | undefined,
): string | undefined {
  if (source.type === 'SLICE') {
    addWarning(state, `Export slice "${source.name}" was preserved as metadata only`);
    addUnsupported(state, 'export slices');
    return undefined;
  }
  const id = state.sourceToVarve.get(source.sourceId) ?? allocate(state);
  state.sourceToVarve.set(source.sourceId, id);
  const nodeFills = fills(state, source);
  const childIds = source.children
    .map((child) => convertNode(state, child, source.bounds))
    .filter((value): value is string => value !== undefined);
  const transform = affine(source, parent);
  let node: SceneNode;
  if (source.type === 'TEXT') {
    node = convertText(state, source, parent, id, nodeFills);
  } else if (source.type === 'VECTOR' && (source.geometryRegions?.length ?? 0) > 1) {
    node = convertVectorRegions(state, source, parent, id, nodeFills);
  } else if (source.type === 'GROUP' || source.type === 'SECTION') {
    node = makeGroupNode(id, {
      name: source.name,
      children: childIds,
      transform,
      effects: effects(source, state),
    });
    if (source.type === 'SECTION')
      addWarning(state, `Section "${source.name}" is preserved as a non-renderable group`);
    node = applyCommon(state, node, source, parent, nodeFills);
  } else if (
    source.type === 'FRAME' ||
    source.type === 'COMPONENT' ||
    source.type === 'INSTANCE' ||
    source.type === 'COMPONENT_SET'
  ) {
    const frame = makeFrameNode(id, {
      name: source.name,
      w: source.bounds.w,
      h: source.bounds.h,
      children: childIds,
      transform,
      clipContent: source.type === 'FRAME' ? source.clipsContent : undefined,
      layoutStyle: layoutStyle(source),
      strokes: strokes(source),
      effects: effects(source, state),
    });
    if (source.type === 'INSTANCE') {
      const componentId = source.componentId
        ? state.componentIds.get(source.componentId)
        : undefined;
      if (componentId) frame.componentId = componentId;
      else if (source.componentId)
        addWarning(state, `Instance "${source.name}" references an unavailable component`);
      frame.propertyOverrides = Object.fromEntries(
        Object.entries(source.componentProperties ?? {})
          .map(([key, value]) => [key, value.value])
          .filter((entry) => typeof entry[1] === 'string' || typeof entry[1] === 'boolean'),
      );
    }
    node = applyCommon(state, frame, source, parent, nodeFills);
  } else if (source.children.length > 0) {
    // Preserve children for boolean operations and newer container-like node
    // types even when Varve has no specialized equivalent.
    if (source.type === 'BOOLEAN_OPERATION')
      addWarning(
        state,
        `Boolean operation "${source.name}" is preserved as an editable group; boolean geometry is not a native Varve node`,
      );
    else addUnsupported(state, `node type ${source.type}`);
    node = applyCommon(
      state,
      makeGroupNode(id, { name: source.name, children: childIds, transform }),
      source,
      parent,
      nodeFills,
    );
  } else {
    if (source.type === 'BOOLEAN_OPERATION')
      addWarning(
        state,
        `Boolean operation "${source.name}" is preserved as an editable group; boolean geometry is not a native Varve node`,
      );
    if (
      !['RECTANGLE', 'ELLIPSE', 'LINE', 'POLYGON', 'STAR', 'VECTOR'].includes(source.type) &&
      source.children.length === 0
    )
      addUnsupported(state, `node type ${source.type}`);
    const shape = makeShapeNode(id, shapeForNode(source, state), {
      name: source.name,
      transform,
      cornerRadius:
        source.rectangleCornerRadii ??
        (source.cornerRadius
          ? [source.cornerRadius, source.cornerRadius, source.cornerRadius, source.cornerRadius]
          : undefined),
      strokes: strokes(source),
      effects: effects(source, state),
    });
    node = applyCommon(state, shape, source, parent, nodeFills);
  }
  if (childIds.length > 0 && (node.kind === 'frame' || node.kind === 'group')) {
    const maskSource = source.children.find((child) => child.isMask);
    if (maskSource)
      node = {
        ...node,
        mask: {
          sourceNodeId: state.sourceToVarve.get(maskSource.sourceId) ?? childIds[0]!,
          type: 'alpha',
          visible: true,
          hideMaskSource: true,
        },
      } as typeof node;
  }
  state.nodes[id] = node;
  if (source.reactions && source.reactions.length > 0)
    state.interactions.set(source.sourceId, source.reactions);
  if (source.overflowDirection && source.overflowDirection !== 'NONE') {
    addUnsupported(state, `scroll behavior ${source.overflowDirection}`);
    addWarning(state, `Frame "${source.name}" has scrolling metadata that Varve cannot preserve`);
  }
  return id;
}

function convertInteraction(
  state: ConversionState,
  sourceId: string,
  reaction: Record<string, unknown>,
): { trigger: unknown; actions: unknown[] } | undefined {
  const triggerRecord =
    typeof reaction.trigger === 'object' && reaction.trigger !== null
      ? (reaction.trigger as Record<string, unknown>)
      : {};
  const triggerType = typeof triggerRecord.type === 'string' ? triggerRecord.type : 'ON_CLICK';
  const trigger = { kind: triggerKind(triggerType) };
  const actionRecord =
    typeof reaction.action === 'object' && reaction.action !== null
      ? (reaction.action as Record<string, unknown>)
      : {};
  const destination =
    typeof actionRecord.destinationId === 'string'
      ? state.sourceToVarve.get(actionRecord.destinationId)
      : undefined;
  const actionType = typeof actionRecord.type === 'string' ? actionRecord.type : '';
  if (actionType === 'BACK') return { trigger, actions: [{ kind: 'goBack' }] };
  if (actionType === 'URL' && typeof actionRecord.url === 'string')
    return { trigger, actions: [{ kind: 'openURL', url: actionRecord.url }] };
  if (
    !destination &&
    (actionType === 'NODE' || actionType === 'OVERLAY' || actionType === 'SCROLL_TO')
  ) {
    addWarning(state, `Prototype interaction from ${sourceId} has an unresolved destination`);
    addUnsupported(state, 'prototype destinations');
    return undefined;
  }
  if (actionType === 'OVERLAY')
    return {
      trigger,
      actions: [
        {
          kind: 'openOverlay',
          targetId: destination,
          transition: transition(actionRecord.transition),
        },
      ],
    };
  if (actionType === 'SCROLL_TO')
    return { trigger, actions: [{ kind: 'scrollTo', targetId: destination }] };
  if (actionType === 'NODE')
    return {
      trigger,
      actions: [
        {
          kind: 'navigateTo',
          targetId: destination,
          transition: transition(actionRecord.transition),
        },
      ],
    };
  addUnsupported(state, `prototype action ${actionType || 'unknown'}`);
  return undefined;
}

function triggerKind(value: string): string {
  if (value === 'ON_HOVER') return 'onHover';
  if (value === 'ON_PRESS') return 'onTap';
  if (value === 'ON_DRAG') return 'onDrag';
  if (value === 'ON_MOUSE_ENTER') return 'onMouseEnter';
  if (value === 'ON_MOUSE_LEAVE') return 'onMouseLeave';
  return 'onClick';
}

function transition(value: unknown): Record<string, unknown> {
  const record =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const type =
    record.type === 'SMART_ANIMATE'
      ? 'smartAnimate'
      : record.type === 'DISSOLVE'
        ? 'dissolve'
        : 'instant';
  return { kind: type, duration: numberOr(record.duration, 0), easing: { type: 'linear' } };
}

function sourceNodes(pages: FigmaSourceDocument['pages']): FigmaSourceNode[] {
  const result: FigmaSourceNode[] = [];
  const visit = (node: FigmaSourceNode): void => {
    result.push(node);
    node.children.forEach(visit);
  };
  for (const page of pages) {
    for (const child of page.children) visit(child);
  }
  return result;
}

function setupReferences(state: ConversionState, source: FigmaSourceDocument): void {
  // A component set is one reusable Varve component with structured variants,
  // not a collection of unrelated masters.  Keep a source-component → Varve
  // component map so instances of every variant resolve to the same target.
  const componentGroups = new Map<string, FigmaSourceDocument['components']>();
  for (const component of source.components) {
    const groupId = component.componentSetId ?? component.sourceId;
    const group = componentGroups.get(groupId) ?? [];
    group.push(component);
    componentGroups.set(groupId, group);
  }
  for (const group of componentGroups.values()) {
    const componentId = allocate(state, 'component');
    for (const component of group) state.componentIds.set(component.sourceId, componentId);
  }
  for (const style of source.styles) state.styleIds.set(style.sourceId, allocate(state, 'style'));
  for (const variable of source.variables)
    state.variableIds.set(variable.sourceId, allocate(state, 'variable'));
  const collectionSources = new Set(
    source.variables.map((variable) => variable.collectionId ?? 'default'),
  );
  for (const collection of collectionSources)
    state.variableCollectionIds.set(collection, allocate(state, 'collection'));
}

function variableValue(state: ConversionState, value: unknown): VariableValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.id === 'string') return `{${state.variableIds.get(record.id) ?? record.id}}`;
    if (
      typeof record.r === 'number' &&
      typeof record.g === 'number' &&
      typeof record.b === 'number'
    )
      return color({
        r: record.r,
        g: record.g,
        b: record.b,
        a: numberOr(record.a, 1),
      }) as unknown as Record<string, unknown>;
    return record;
  }
  return '';
}

function buildVariables(
  state: ConversionState,
  source: FigmaSourceDocument,
): Document['variableStore'] {
  if (source.variables.length === 0) return undefined;
  const variables: NonNullable<Document['variableStore']>['variables'] = {};
  const collections: NonNullable<Document['variableStore']>['collections'] = {};
  const grouped = new Map<string, typeof source.variables>();
  for (const variable of source.variables) {
    const key = variable.collectionId ?? 'default';
    const list = grouped.get(key) ?? [];
    list.push(variable);
    grouped.set(key, list);
    variables[state.variableIds.get(variable.sourceId)!] = {
      id: state.variableIds.get(variable.sourceId)!,
      name: variable.name,
      type: variable.type,
      valuesByMode: Object.fromEntries(
        Object.entries(variable.valuesByMode).map(([mode, value]) => [
          mode,
          variableValue(state, value),
        ]),
      ),
    };
  }
  for (const [sourceId, group] of grouped) {
    const id = state.variableCollectionIds.get(sourceId)!;
    const modes = [
      ...new Set(
        group.flatMap((variable) => (variable.modes.length > 0 ? variable.modes : ['default'])),
      ),
    ];
    collections[id] = {
      id,
      name: group[0]?.collectionName ?? 'Figma variables',
      modes,
      activeMode: group[0]?.activeMode ?? modes[0] ?? 'default',
      variableIds: group.map((variable) => state.variableIds.get(variable.sourceId)!),
    };
  }
  const firstCollection = Object.values(collections)[0];
  return {
    variables,
    collections,
    activeCollectionId: firstCollection?.id ?? '',
    modes: firstCollection?.modes ?? ['default'],
    activeMode: firstCollection?.activeMode ?? 'default',
  };
}

function buildComponents(
  state: ConversionState,
  source: FigmaSourceDocument,
): Document['components'] {
  const nodes = sourceNodes(source.pages);
  const result: Document['components'] = {};
  const groups = new Map<string, FigmaSourceDocument['components']>();
  for (const sourceComponent of source.components) {
    const id = state.componentIds.get(sourceComponent.sourceId);
    if (!id) continue;
    const group = groups.get(id) ?? [];
    group.push(sourceComponent);
    groups.set(id, group);
  }
  for (const [id, sourceComponents] of groups) {
    const first = sourceComponents[0];
    if (!first) continue;
    const componentSetId = first.componentSetId;
    const setNode = componentSetId
      ? nodes.find((node) => node.sourceId === componentSetId && node.type === 'COMPONENT_SET')
      : undefined;
    const master = setNode ?? nodes.find((node) => node.sourceId === first.sourceId);
    const masterRootId = master ? state.sourceToVarve.get(master.sourceId) : undefined;
    if (!id || !masterRootId) continue;
    const properties = Object.entries(master?.componentPropertyDefinitions ?? {}).flatMap(
      ([name, definition], index) => {
        const type: 'boolean' | 'instanceSwap' | 'variant' | 'text' =
          definition.type === 'BOOLEAN'
            ? 'boolean'
            : definition.type === 'INSTANCE_SWAP'
              ? 'instanceSwap'
              : definition.type === 'VARIANT'
                ? 'variant'
                : 'text';
        const defaultValue =
          typeof definition.defaultValue === 'boolean' ||
          typeof definition.defaultValue === 'string'
            ? definition.defaultValue
            : '';
        return [{ id: `${id}-property-${index}`, name, type, defaultValue }];
      },
    );
    const variants = sourceComponents.flatMap((sourceComponent) => {
      const variantNode = nodes.find((node) => node.sourceId === sourceComponent.sourceId);
      const propertyValues = variantNode?.variantProperties;
      if (!variantNode || !propertyValues || Object.keys(propertyValues).length === 0) return [];
      return [
        {
          id: `variant-${sourceComponent.sourceId}`,
          name: variantNode.name,
          propertyValues,
        },
      ];
    });
    result[id] = {
      id,
      name: source.componentSets.find((set) => set.sourceId === componentSetId)?.name ?? first.name,
      slots: [],
      masterRootId,
      properties,
      ...(variants.length > 0 ? { variants } : {}),
    };
  }
  return result;
}

function buildStyles(
  state: ConversionState,
  source: FigmaSourceDocument,
): NonNullable<Document['styles']> | undefined {
  if (source.styles.length === 0) return undefined;
  const result: NonNullable<Document['styles']> = {};
  for (const style of source.styles) {
    const id = state.styleIds.get(style.sourceId);
    const sample = state.styleSamples.get(style.sourceId);
    if (!id || !sample) continue;
    if (style.type === 'TEXT' && sample.kind === 'text')
      result[id] = {
        id,
        type: 'text',
        name: style.name,
        fontFamily: sample.fontFamily,
        fontWeight: sample.fontWeight,
        fontStyle: sample.fontStyle,
        fontSize: sample.fontSize,
        lineHeight: sample.lineHeight,
        letterSpacing: sample.letterSpacing,
        textAlign: sample.textAlign,
      };
    else if (style.type === 'EFFECT')
      result[id] = {
        id,
        type: 'effect',
        name: style.name,
        effects: 'effects' in sample ? sample.effects : [],
      };
    else if (style.type === 'GRID' && sample.kind === 'frame' && sample.layoutStyle)
      result[id] = { id, type: 'layout', name: style.name, layout: sample.layoutStyle };
    else
      result[id] = {
        id,
        type: 'color',
        name: style.name,
        fill: sample.fills?.[0] ?? {
          type: 'solid',
          color: transparent(),
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function buildInteractions(state: ConversionState): Document['interactions'] | undefined {
  const interactions: NonNullable<Document['interactions']> = {};
  for (const [sourceId, reactions] of state.interactions) {
    const nodeId = state.sourceToVarve.get(sourceId);
    if (!nodeId) continue;
    const converted = reactions
      .map((reaction) => convertInteraction(state, sourceId, reaction))
      .filter((value): value is NonNullable<typeof value> => value !== undefined);
    if (converted.length > 0)
      interactions[nodeId] = converted.map((entry, index) => ({
        id: `${nodeId}-interaction-${index}`,
        nodeId,
        name: 'Figma interaction',
        trigger: entry.trigger,
        actions: entry.actions,
        enabled: true,
      }));
  }
  return Object.keys(interactions).length > 0 ? interactions : undefined;
}

function rgbaCss(value: FigmaPaint['color'] | undefined): string {
  const r = Math.round(Math.max(0, Math.min(1, value?.r ?? 0)) * 255);
  const g = Math.round(Math.max(0, Math.min(1, value?.g ?? 0)) * 255);
  const b = Math.round(Math.max(0, Math.min(1, value?.b ?? 0)) * 255);
  const a = Math.max(0, Math.min(1, value?.a ?? 1));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function buildLayoutGrids(
  state: ConversionState,
  source: FigmaSourceDocument,
): NonNullable<NonNullable<Document['gridSettings']>['layoutGrids']> | undefined {
  const result: NonNullable<NonNullable<Document['gridSettings']>['layoutGrids']> = {};
  for (const node of sourceNodes(source.pages)) {
    const nodeId = state.sourceToVarve.get(node.sourceId);
    if (!nodeId || !node.layoutGrids || node.layoutGrids.length === 0) continue;
    const grid = node.layoutGrids.find((entry) => entry.visible) ?? node.layoutGrids[0];
    if (!grid) continue;
    const pattern = grid.pattern;
    if (pattern !== 'COLUMNS' && pattern !== 'ROWS' && pattern !== 'GRID') {
      addUnsupported(state, `layout grid pattern ${pattern}`);
      continue;
    }
    result[nodeId] = {
      type: 'layout',
      id: `figma-layout-grid-${nodeId}`,
      name: `${node.name} layout grid`,
      visible: grid.visible,
      snapEnabled: false,
      color: rgbaCss(grid.color),
      opacity: Math.max(0, Math.min(1, grid.color?.a ?? 0.3)),
      scope: 'frame',
      frameId: nodeId,
      layoutMode: pattern === 'COLUMNS' ? 'columns' : pattern === 'ROWS' ? 'rows' : 'uniform',
      ...(pattern === 'COLUMNS'
        ? { columnCount: Math.max(1, grid.count ?? 1), columnWidth: grid.sectionSize }
        : {}),
      ...(pattern === 'ROWS'
        ? { rowCount: Math.max(1, grid.count ?? 1), rowHeight: grid.sectionSize }
        : {}),
      gutter: Math.max(0, grid.gutterSize ?? 0),
      margin: [grid.offset ?? 0, grid.offset ?? 0, grid.offset ?? 0, grid.offset ?? 0],
      alignment:
        grid.alignment === 'MIN'
          ? 'left'
          : grid.alignment === 'MAX'
            ? 'right'
            : grid.alignment === 'CENTER'
              ? 'center'
              : 'stretch',
    };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export interface FigmaConversionResult {
  document: Document;
  nodeIds: string[];
  warnings: string[];
  unsupportedFeatures: string[];
}

export function convertFigmaSource(source: FigmaSourceDocument): FigmaConversionResult {
  const base = createDocument(source.name, true);
  const state: ConversionState = {
    base,
    nodes: {},
    nextId: base.nextId,
    sourceToVarve: new Map(),
    componentIds: new Map(),
    styleIds: new Map(),
    variableIds: new Map(),
    variableCollectionIds: new Map(),
    styleSamples: new Map(),
    interactions: new Map(),
    warnings: [...source.warnings],
    unsupportedFeatures: [...source.unsupportedFeatures],
    fonts: new Set(),
    images: source.images,
  };
  setupReferences(state, source);
  const pages: NonNullable<Document['pages']> = [];
  const rootChildren: string[] = [];
  for (let index = 0; index < source.pages.length; index += 1) {
    const page = source.pages[index]!;
    const contentRoot = allocate(state, 'page-content');
    const children = page.children
      .map((child) => convertNode(state, child, page.bounds))
      .filter((value): value is string => value !== undefined);
    state.nodes[contentRoot] = makeGroupNode(contentRoot, {
      name: `${page.name} content`,
      children,
    });
    const pageId = allocate(state, 'page');
    pages.push({
      id: pageId,
      name: page.name,
      width: Math.max(1, page.bounds.w || 1920),
      height: Math.max(1, page.bounds.h || 1080),
      order: `a${index}`,
      backgrounds: [],
      contentRoot,
    });
    rootChildren.push(contentRoot);
  }
  const layoutGrids = buildLayoutGrids(state, source);
  const document: Document = {
    ...state.base,
    nextId: state.nextId,
    nodes: state.nodes,
    rootChildren,
    pages: pages.length > 0 ? pages : undefined,
    activePageId: pages[0]?.id,
    globalChildren: [],
    components: buildComponents(state, source),
    styles: buildStyles(state, source),
    variableStore: buildVariables(state, source),
    interactions: buildInteractions(state),
    gridSettings: {
      ...(state.base.gridSettings ?? {}),
      ...(layoutGrids ? { layoutGrids } : {}),
    },
  };
  return {
    document,
    nodeIds: rootChildren,
    warnings: state.warnings,
    unsupportedFeatures: state.unsupportedFeatures,
  };
}
