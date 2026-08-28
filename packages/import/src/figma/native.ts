// COMPLEXITY: nativeNode currently exceeds the non-component guidance because it
// normalizes the source's broad node property surface. Keep extraction of field
// mappers on the backlog if support for additional native schema fields grows.

import {
  type FigDocument,
  type FigNode,
  nodeId,
  parseFig,
  parseFigBinary,
  resolveVectorNodePaths,
} from 'openfig-core';
import type {
  FigmaBounds,
  FigmaEffect,
  FigmaPaint,
  FigmaSourceDocument,
  FigmaSourceNode,
  FigmaTextStyle,
} from './source';
import { FIGMA_IMPORT_LIMITS } from './source';

const ZIP_CENTRAL_HEADER = 0x02014b50;
const ZIP_END_HEADER = 0x06054b50;
const MAX_ARCHIVE_ENTRIES = 4096;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_ARCHIVE_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_ARCHIVE_COMPRESSION_RATIO = 2000;

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown): RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}

function fieldValue(value: unknown, key: string): unknown {
  return asRecord(value)[key];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nonNegative(value: unknown, fallback = 0): number {
  return Math.max(0, finite(value, fallback));
}

function firstString(record: RecordValue, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return undefined;
}

function firstNumber(record: RecordValue, keys: string[], fallback = 0): number {
  for (const key of keys) {
    if (typeof record[key] === 'number' && Number.isFinite(record[key])) return record[key];
  }
  return fallback;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hashValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return hex(value);
  if (Array.isArray(value) && value.every((entry) => Number.isInteger(entry)))
    return hex(Uint8Array.from(value as number[]));
  return undefined;
}

function nodeIdentifier(node: FigNode, fallback: string): string {
  return nodeId(node) ?? fallback;
}

function nativeType(node: FigNode): string {
  const type = stringValue(node.type) ?? 'UNKNOWN';
  if (type === 'SYMBOL') return 'COMPONENT';
  if (type === 'ROUNDED_RECTANGLE') return 'RECTANGLE';
  return type;
}

function color(value: unknown): FigmaPaint['color'] | undefined {
  const raw = asRecord(value);
  const r = raw.r;
  const g = raw.g;
  const b = raw.b;
  if (
    typeof r !== 'number' ||
    !Number.isFinite(r) ||
    typeof g !== 'number' ||
    !Number.isFinite(g) ||
    typeof b !== 'number' ||
    !Number.isFinite(b)
  )
    return undefined;
  return { r, g, b, a: finite(raw.a ?? raw.alpha, 1) };
}

function gradientHandles(transform: unknown): FigmaPaint['gradientHandlePositions'] | undefined {
  const matrix = asRecord(transform);
  if (typeof matrix.m00 !== 'number' || typeof matrix.m01 !== 'number') return undefined;
  return [
    { x: finite(matrix.m02, 0), y: finite(matrix.m12, 0) },
    {
      x: finite(matrix.m00, 1) + finite(matrix.m02, 0),
      y: finite(matrix.m10, 0) + finite(matrix.m12, 0),
    },
  ];
}

function gradientTransform(transform: unknown): FigmaPaint['gradientTransform'] | undefined {
  const matrix = asRecord(transform);
  const values = [matrix.m00, matrix.m10, matrix.m01, matrix.m11, matrix.m02, matrix.m12];
  if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return undefined;
  }
  return values as unknown as FigmaPaint['gradientTransform'];
}

function paint(
  value: unknown,
  imageRef: (value: unknown) => string | undefined,
): FigmaPaint | undefined {
  const raw = asRecord(value);
  const type = stringValue(raw.type) ?? 'SOLID';
  const stops = arrayValue(raw.stops ?? raw.gradientStops).flatMap((entry) => {
    const stop = asRecord(entry);
    const stopColor = color(stop.color);
    return stopColor ? [{ position: finite(stop.position, 0), color: stopColor }] : [];
  });
  const image = asRecord(raw.image);
  return {
    type,
    visible: raw.visible !== false,
    opacity: Math.max(0, Math.min(1, finite(raw.opacity, 1))),
    blendMode: stringValue(raw.blendMode),
    color: color(raw.color),
    gradientStops: stops.length > 0 ? stops : undefined,
    gradientHandlePositions: gradientHandles(raw.transform),
    gradientTransform: gradientTransform(raw.transform),
    imageRef:
      imageRef(raw.imageRef ?? raw.imageHash ?? image.hash) ??
      stringValue(raw.imageRef) ??
      stringValue(raw.imageHash),
    scaleMode: firstString(raw, ['scaleMode', 'imageScaleMode']),
  };
}

function effect(value: unknown): FigmaEffect | undefined {
  const raw = asRecord(value);
  const type = stringValue(raw.type);
  if (!type) return undefined;
  return {
    type,
    visible: raw.visible !== false,
    radius: finite(raw.radius ?? raw.blur, 0),
    spread: finite(raw.spread, 0),
    offset: (() => {
      const offset = asRecord(raw.offset);
      return {
        x: finite(offset.x, 0),
        y: finite(offset.y, 0),
      };
    })(),
    color: color(raw.color),
  };
}

function affine(node: FigNode): FigmaSourceNode['transform'] | undefined {
  const transform = asRecord(node.transform);
  const values = [
    transform.m00,
    transform.m10,
    transform.m01,
    transform.m11,
    transform.m02,
    transform.m12,
  ];
  if (!values.every((value) => typeof value === 'number' && Number.isFinite(value)))
    return undefined;
  return values as unknown as FigmaSourceNode['transform'];
}

function pageLocalTransform(
  node: FigNode,
  page: FigmaBounds,
  localizeToPage: boolean,
): FigmaSourceNode['transform'] | undefined {
  const transform = affine(node);
  if (!transform || !localizeToPage) return transform;
  const [a, b, c, d, e, f] = transform;
  return [a, b, c, d, e - page.x, f - page.y];
}

function bounds(node: FigNode, pageBounds: FigmaBounds): FigmaBounds {
  const size = asRecord(node.size);
  const transform = asRecord(node.transform);
  return {
    x: finite(transform.m02, pageBounds.x),
    y: finite(transform.m12, pageBounds.y),
    w: nonNegative(size.x),
    h: nonNegative(size.y),
  };
}

function textStyle(node: FigNode): FigmaTextStyle | undefined {
  if (node.type !== 'TEXT') return undefined;
  const raw = asRecord(node);
  const textData = asRecord(raw.textData);
  const style = asRecord(raw.style ?? textData.style);
  const fontName = asRecord(raw.fontName ?? style.fontName);
  const letterSpacing = asRecord(style.letterSpacing ?? raw.letterSpacing);
  const lineHeight = firstNumber(
    { ...style, ...raw },
    ['lineHeightPx', 'lineHeight', 'lineHeightValue'],
    0,
  );
  const autoResize = firstString({ ...style, ...raw }, ['textAutoResize', 'textResizing']);
  return {
    fontFamily: firstString(fontName, ['family', 'fontFamily']),
    fontWeight: firstNumber({ ...fontName, ...style, ...raw }, ['weight', 'fontWeight'], 400),
    fontStyle:
      style.italic === true || raw.italic === true || style.fontStyle === 'italic'
        ? 'italic'
        : 'normal',
    fontSize: firstNumber({ ...style, ...raw }, ['fontSize', 'size'], 16),
    letterSpacing: firstNumber(letterSpacing, ['value', 'letterSpacing'], 0),
    lineHeight: lineHeight > 0 ? lineHeight : undefined,
    textAlign: (() => {
      const value = firstString({ ...style, ...raw }, ['textAlignHorizontal', 'textAlign']);
      if (value === 'CENTER') return 'center';
      if (value === 'RIGHT') return 'right';
      if (value === 'JUSTIFIED') return 'justify';
      return 'left';
    })(),
    textAlignVertical: (() => {
      const value = firstString({ ...style, ...raw }, ['textAlignVertical']);
      if (value === 'CENTER') return 'middle';
      if (value === 'BOTTOM') return 'bottom';
      return 'top';
    })(),
    textCase: (() => {
      const value = firstString({ ...style, ...raw }, ['textCase']);
      if (value === 'UPPER') return 'uppercase';
      if (value === 'LOWER') return 'lowercase';
      if (value === 'TITLE') return 'capitalize';
      return 'none';
    })(),
    textDecoration: (() => {
      const value = firstString({ ...style, ...raw }, ['textDecoration']);
      if (value === 'UNDERLINE') return 'underline';
      if (value === 'STRIKETHROUGH') return 'line-through';
      return 'none';
    })(),
    textResizing:
      autoResize === 'WIDTH_AND_HEIGHT'
        ? 'fixed'
        : autoResize === 'HEIGHT'
          ? 'autoHeight'
          : 'autoWidth',
  };
}

function styles(node: FigNode): Record<string, FigmaTextStyle> | undefined {
  const table = fieldValue(node, 'styleOverrideTable');
  const raw = asRecord(table);
  const entries = Object.entries(raw).flatMap(([key, value]) => {
    const source = asRecord(value);
    const fakeNode = {
      type: 'TEXT',
      fontName: source.fontName,
      fontSize: source.fontSize,
      fontWeight: source.fontWeight,
      style: source,
      textData: {},
    } as unknown as FigNode;
    const normalized = textStyle(fakeNode);
    return normalized ? [[key, normalized] as const] : [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function integerArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(
    (entry): entry is number => typeof entry === 'number' && Number.isFinite(entry),
  );
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  const raw = asRecord(value);
  const entries = Object.entries(raw).flatMap(([key, entry]) => {
    const string = stringValue(entry);
    return string ? [[key, string] as const] : [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function sourceReference(node: FigNode, keys: string[]): string | undefined {
  const raw = asRecord(node);
  for (const key of keys) {
    const direct = stringValue(raw[key]);
    if (direct) return direct;
    const nested = asRecord(raw[key]);
    const nestedId = nested.guid ? hashValue(nested.guid) : undefined;
    if (nestedId) return nestedId;
  }
  return undefined;
}

function dataUrl(bytes: Uint8Array, name: string): string {
  const extension = name.split('.').pop()?.toLowerCase();
  const mime =
    extension === 'png'
      ? 'image/png'
      : extension === 'jpg' || extension === 'jpeg'
        ? 'image/jpeg'
        : extension === 'webp'
          ? 'image/webp'
          : 'application/octet-stream';
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  return `data:${mime};base64,${globalThis.btoa(binary)}`;
}

function archiveString(data: Uint8Array, offset: number, length: number): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(offset, offset + length));
  } catch {
    throw new Error('Native .fig archive contains invalid UTF-8 entry names');
  }
}

function assertSafeArchive(data: Uint8Array): void {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const minimumEndRecord = 22;
  const searchStart = Math.max(0, data.byteLength - 0xffff - minimumEndRecord);
  let endOffset = -1;
  for (let offset = data.byteLength - minimumEndRecord; offset >= searchStart; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END_HEADER) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error('Native .fig archive is missing its ZIP directory');
  const entries = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff)
    throw new Error('ZIP64 native .fig archives are not supported by the bounded importer');
  if (entries > MAX_ARCHIVE_ENTRIES)
    throw new Error(`Native .fig archive contains more than ${MAX_ARCHIVE_ENTRIES} entries`);
  if (centralOffset + centralSize > data.byteLength)
    throw new Error('Native .fig archive has an invalid central directory');

  const centralEnd = centralOffset + centralSize;
  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > centralEnd || view.getUint32(offset, true) !== ZIP_CENTRAL_HEADER)
      throw new Error('Native .fig archive has a malformed central directory entry');
    const compressed = view.getUint32(offset + 20, true);
    const uncompressed = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const name = archiveString(data, offset + 46, nameLength);
    const segments = name.split(/[\\/]/u);
    if (name.startsWith('/') || segments.some((segment) => segment === '..'))
      throw new Error('Native .fig archive contains an unsafe path');
    if (uncompressed > MAX_ARCHIVE_ENTRY_BYTES)
      throw new Error(`Native .fig archive entry "${name}" exceeds the size limit`);
    totalUncompressed += uncompressed;
    if (totalUncompressed > MAX_ARCHIVE_UNCOMPRESSED_BYTES)
      throw new Error('Native .fig archive exceeds the uncompressed size limit');
    if (compressed > 0 && uncompressed / compressed > MAX_ARCHIVE_COMPRESSION_RATIO)
      throw new Error(`Native .fig archive entry "${name}" has an unsafe compression ratio`);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (nextOffset > centralEnd)
      throw new Error('Native .fig archive has a truncated central directory entry');
    offset = nextOffset;
  }
}

export function isFigmaNativeSource(data: string | Uint8Array): boolean {
  if (typeof data === 'string' || data.byteLength < 4) return false;
  return (
    (data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04) ||
    (data[0] === 0x66 && data[1] === 0x69 && data[2] === 0x67 && data[3] === 0x2d)
  );
}

function pageBounds(document: FigDocument): FigmaBounds {
  const render = asRecord(asRecord(document.meta).client_meta).render_coordinates;
  const raw = asRecord(render);
  return {
    x: finite(raw.x, 0),
    y: finite(raw.y, 0),
    w: Math.max(1, finite(raw.width, 1920)),
    h: Math.max(1, finite(raw.height, 1080)),
  };
}

function normalizedLayout(
  node: FigNode,
): Pick<
  FigmaSourceNode,
  | 'layoutMode'
  | 'layoutWrap'
  | 'itemSpacing'
  | 'counterAxisSpacing'
  | 'paddingTop'
  | 'paddingRight'
  | 'paddingBottom'
  | 'paddingLeft'
  | 'primaryAxisAlignItems'
  | 'counterAxisAlignItems'
  | 'primaryAxisSizingMode'
  | 'counterAxisSizingMode'
  | 'layoutSizingHorizontal'
  | 'layoutSizingVertical'
  | 'layoutGrow'
  | 'layoutPositioning'
> {
  const raw = asRecord(node);
  const mode = firstString(raw, ['stackMode', 'layoutMode']);
  const layoutMode =
    mode === 'HORIZONTAL' || mode === 'VERTICAL' || mode === 'GRID' ? mode : 'NONE';
  return {
    layoutMode,
    layoutWrap:
      firstString(raw, ['stackWrap', 'stackWrapMode', 'layoutWrap']) === 'WRAP'
        ? 'WRAP'
        : 'NO_WRAP',
    itemSpacing: firstNumber(raw, ['stackSpacing', 'itemSpacing', 'stackPrimaryGap']),
    counterAxisSpacing: firstNumber(raw, ['stackCounterSpacing', 'counterAxisSpacing', 'rowGap']),
    paddingTop: firstNumber(raw, ['stackPaddingTop', 'paddingTop']),
    paddingRight: firstNumber(raw, ['stackPaddingRight', 'paddingRight']),
    paddingBottom: firstNumber(raw, ['stackPaddingBottom', 'paddingBottom']),
    paddingLeft: firstNumber(raw, ['stackPaddingLeft', 'paddingLeft']),
    primaryAxisAlignItems: firstString(raw, ['stackPrimaryAlignItems', 'primaryAxisAlignItems']),
    counterAxisAlignItems: firstString(raw, ['stackCounterAlignItems', 'counterAxisAlignItems']),
    primaryAxisSizingMode: firstString(raw, ['stackPrimarySizing', 'primaryAxisSizingMode']),
    counterAxisSizingMode: firstString(raw, ['stackCounterSizing', 'counterAxisSizingMode']),
    layoutSizingHorizontal: firstString(raw, ['layoutSizingHorizontal']),
    layoutSizingVertical: firstString(raw, ['layoutSizingVertical']),
    layoutGrow: firstNumber(raw, ['layoutGrow', 'stackGrow']),
    layoutPositioning: firstString(raw, ['layoutPositioning']),
  };
}

function geometryPaths(
  document: FigDocument,
  node: FigNode,
): Array<{ path: string; windingRule?: string }> {
  try {
    const resolved = resolveVectorNodePaths(document, node);
    return resolved.fill
      .filter((entry) => entry.svgPath.length > 0)
      .map((entry) => ({ path: entry.svgPath, windingRule: entry.windingRule }));
  } catch {
    return [];
  }
}

function nativeNode(
  document: FigDocument,
  node: FigNode,
  id: string,
  parentBounds: FigmaBounds,
  pageOrigin: FigmaBounds,
  childNodes: (node: FigNode) => FigNode[],
  imageRef: (value: unknown) => string | undefined,
  warnings: string[],
  unsupportedFeatures: string[],
  depth: number,
  ancestors: Set<string>,
  localizeToPage: boolean,
): FigmaSourceNode {
  if (depth > FIGMA_IMPORT_LIMITS.maxDepth)
    throw new Error(`Native .fig node depth exceeds ${FIGMA_IMPORT_LIMITS.maxDepth}`);
  if (ancestors.has(id)) throw new Error(`Native .fig node graph contains a cycle at ${id}`);
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(id);
  const raw = asRecord(node);
  const type = nativeType(node);
  const nodeBounds = bounds(node, parentBounds);
  const geometry =
    type === 'VECTOR' || type === 'BOOLEAN_OPERATION' ? geometryPaths(document, node) : [];
  const children = childNodes(node)
    .filter((child) => fieldValue(child, 'phase') !== 'REMOVED')
    .map((child, index) =>
      nativeNode(
        document,
        child,
        nodeIdentifier(child, `${id}:child:${index}`),
        nodeBounds,
        pageOrigin,
        childNodes,
        imageRef,
        warnings,
        unsupportedFeatures,
        depth + 1,
        nextAncestors,
        type === 'CANVAS',
      ),
    );
  const paints = arrayValue(raw.fillPaints)
    .map((entry) => paint(entry, imageRef))
    .filter((entry): entry is FigmaPaint => entry !== undefined);
  const strokes = arrayValue(raw.strokePaints)
    .map((entry) => paint(entry, imageRef))
    .filter((entry): entry is FigmaPaint => entry !== undefined);
  const rawConstraints = asRecord(raw.constraints);
  const componentPropertyDefinitions = asRecord(raw.componentPropertyDefinitions);
  const componentProperties = asRecord(raw.componentProperties);
  const source: FigmaSourceNode = {
    sourceId: id,
    type,
    name: stringValue(raw.name) ?? type,
    visible: raw.visible !== false,
    locked: raw.locked === true,
    opacity: Math.max(0, Math.min(1, finite(raw.opacity, 1))),
    blendMode: stringValue(raw.blendMode),
    bounds: nodeBounds,
    transform: pageLocalTransform(node, pageOrigin, localizeToPage),
    children,
    fills: paints,
    strokes,
    effects: arrayValue(raw.effects)
      .map(effect)
      .filter((entry): entry is FigmaEffect => entry !== undefined),
    cornerRadius: finite(raw.cornerRadius, 0),
    rectangleCornerRadii:
      arrayValue(raw.rectangleCornerRadii).length === 4
        ? (arrayValue(raw.rectangleCornerRadii).map((value) => nonNegative(value)) as [
            number,
            number,
            number,
            number,
          ])
        : undefined,
    strokeWeight: finite(raw.strokeWeight, 1),
    strokeAlign: stringValue(raw.strokeAlign),
    strokeCap: firstString(raw, ['strokeCap', 'strokeLineCap']),
    strokeJoin: firstString(raw, ['strokeJoin', 'strokeLineJoin']),
    strokeDashes: integerArray(raw.strokeDashes ?? raw.strokeDashPattern),
    miterLimit: firstNumber(raw, ['miterLimit', 'strokeMiterLimit'], 4),
    fillGeometry: geometry,
    geometryRegions: geometry.length > 1 ? geometry : undefined,
    pointCount: Math.max(3, Math.floor(firstNumber(raw, ['pointCount', 'polygonCount'], 5))),
    starInnerScale: Math.max(
      0,
      Math.min(1, firstNumber(raw, ['starInnerScale', 'innerRadius'], 0.2)),
    ),
    text:
      typeof asRecord(raw.textData).characters === 'string'
        ? (asRecord(raw.textData).characters as string)
        : undefined,
    textStyle: textStyle(node),
    styleOverrideTable: styles(node),
    characterStyleOverrides: integerArray(raw.characterStyleOverrides),
    ...normalizedLayout(node),
    overflowDirection: firstString(raw, ['overflowDirection', 'scrollDirection']),
    constraints:
      Object.keys(rawConstraints).length > 0 || raw.horizontalConstraint || raw.verticalConstraint
        ? {
            horizontal:
              firstString(rawConstraints, ['horizontal']) ?? stringValue(raw.horizontalConstraint),
            vertical:
              firstString(rawConstraints, ['vertical']) ?? stringValue(raw.verticalConstraint),
          }
        : undefined,
    clipsContent: type === 'FRAME' && raw.frameMaskDisabled !== true,
    isMask: raw.isMask === true,
    booleanOperation: firstString(raw, ['booleanOperation', 'operation']),
    componentId: sourceReference(node, [
      'componentId',
      'mainComponentId',
      'mainSymbolId',
      'symbolID',
      'symbolId',
    ]),
    componentSetId: sourceReference(node, ['componentSetId', 'symbolSetId']),
    variantProperties: stringRecord(raw.variantProperties),
    componentPropertyDefinitions:
      Object.keys(componentPropertyDefinitions).length > 0
        ? Object.fromEntries(
            Object.entries(componentPropertyDefinitions).map(([key, value]) => {
              const definition = asRecord(value);
              return [
                key,
                {
                  type: stringValue(definition.type),
                  defaultValue: definition.defaultValue,
                  variantOptions: arrayValue(definition.variantOptions).filter(
                    (entry): entry is string => typeof entry === 'string',
                  ),
                },
              ];
            }),
          )
        : undefined,
    componentProperties:
      Object.keys(componentProperties).length > 0
        ? Object.fromEntries(
            Object.entries(componentProperties).map(([key, value]) => {
              const property = asRecord(value);
              return [key, { type: stringValue(property.type), value: property.value }];
            }),
          )
        : undefined,
    reactions: arrayValue(raw.reactions ?? raw.prototypeInteractions).filter(
      (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
    ),
  };
  if (
    ![
      'DOCUMENT',
      'CANVAS',
      'FRAME',
      'GROUP',
      'TEXT',
      'RECTANGLE',
      'ELLIPSE',
      'LINE',
      'POLYGON',
      'STAR',
      'VECTOR',
      'BOOLEAN_OPERATION',
      'COMPONENT',
      'COMPONENT_SET',
      'INSTANCE',
      'SLICE',
    ].includes(type)
  ) {
    unsupportedFeatures.push(`native .fig node type ${type}`);
    warnings.push(
      `Native .fig node type ${type} on "${source.name}" was preserved using the closest Varve container`,
    );
  }
  return source;
}

export function decodeFigmaNativeSource(data: Uint8Array): FigmaSourceDocument {
  if (data.byteLength > FIGMA_IMPORT_LIMITS.maxBytes)
    throw new Error(`Native .fig file exceeds the ${FIGMA_IMPORT_LIMITS.maxBytes} byte limit`);
  if (!isFigmaNativeSource(data)) throw new Error('Source is not a native .fig binary');
  if (data[0] === 0x50) assertSafeArchive(data);
  const document = data[0] === 0x66 ? parseFigBinary(data) : parseFig(data);
  if (document.nodes.length > FIGMA_IMPORT_LIMITS.maxNodes)
    throw new Error(`Native .fig file exceeds the ${FIGMA_IMPORT_LIMITS.maxNodes} node limit`);

  const warnings: string[] = [];
  const unsupportedFeatures: string[] = [];
  const page = pageBounds(document);
  const nodeIds = new Map<FigNode, string>();
  document.nodes.forEach((node, index) => {
    nodeIds.set(node, nodeIdentifier(node, `native:${index}`));
  });
  const children = (node: FigNode): FigNode[] =>
    document.childrenMap.get(nodeIds.get(node) ?? '') ?? [];
  const images: FigmaSourceDocument['images'] = {};
  for (const [name, bytes] of document.images) {
    const entry = { dataUrl: dataUrl(bytes, name) };
    images[name] = entry;
    images[name.replace(/^images\//u, '')] = entry;
    images[hex(new TextEncoder().encode(name))] = entry;
  }
  const imageRef = (value: unknown): string | undefined => {
    const key = hashValue(value);
    if (!key) return undefined;
    if (images[key]) return key;
    const prefixed = `images/${key}`;
    if (images[prefixed]) return prefixed;
    return key;
  };
  const pages: FigmaSourceDocument['pages'] = [];
  const pageNodes = document.nodes.filter(
    (node) =>
      node.type === 'CANVAS' &&
      fieldValue(node, 'phase') !== 'REMOVED' &&
      fieldValue(node, 'internalOnly') !== true,
  );
  for (const [index, pageNode] of pageNodes.entries()) {
    const id = nodeIds.get(pageNode) ?? `page:${index}`;
    const source = nativeNode(
      document,
      pageNode,
      id,
      page,
      page,
      children,
      imageRef,
      warnings,
      unsupportedFeatures,
      0,
      new Set(),
      true,
    );
    pages.push({
      sourceId: id,
      name: source.name,
      bounds: page,
      children: source.children,
    });
  }
  if (pages.length === 0) {
    const roots = document.nodes.filter(
      (node) =>
        !node.parentIndex && node.type !== 'DOCUMENT' && fieldValue(node, 'phase') !== 'REMOVED',
    );
    pages.push({
      sourceId: 'native:page',
      name: 'Imported page',
      bounds: page,
      children: roots.map((node, index) =>
        nativeNode(
          document,
          node,
          nodeIds.get(node) ?? `native:root:${index}`,
          page,
          page,
          children,
          imageRef,
          warnings,
          unsupportedFeatures,
          0,
          new Set(),
          true,
        ),
      ),
    });
  }
  const allNodes = pages.flatMap((entry) => entry.children);
  const components = allNodes
    .flatMap((root) => {
      const result: FigmaSourceNode[] = [];
      const visit = (node: FigmaSourceNode): void => {
        result.push(node);
        node.children.forEach(visit);
      };
      visit(root);
      return result;
    })
    .filter((node) => node.type === 'COMPONENT')
    .map((node) => ({
      sourceId: node.sourceId,
      name: node.name,
      componentSetId: node.componentSetId,
    }));
  const componentSets = allNodes
    .flatMap((root) => {
      const result: FigmaSourceNode[] = [];
      const visit = (node: FigmaSourceNode): void => {
        result.push(node);
        node.children.forEach(visit);
      };
      visit(root);
      return result;
    })
    .filter((node) => node.type === 'COMPONENT_SET')
    .map((node) => ({ sourceId: node.sourceId, name: node.name }));
  return {
    name: stringValue(asRecord(document.meta).file_name) ?? 'Imported Figma file',
    version: String(document.header.version),
    pages,
    components,
    componentSets,
    styles: [],
    variables: [],
    images,
    warnings: [...new Set(warnings)],
    unsupportedFeatures: [...new Set(unsupportedFeatures)],
  };
}
