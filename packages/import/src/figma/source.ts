/**
 * Bounded, source-shaped normalization for the official Figma file JSON
 * response. This deliberately does not expose raw Figma records to the scene
 * converter: source ids remain provenance only and are never scene ids.
 */

export const FIGMA_IMPORT_LIMITS = {
  maxBytes: 64 * 1024 * 1024,
  maxNodes: 100_000,
  maxDepth: 256,
  maxTextLength: 2_000_000,
} as const;

export interface FigmaPoint {
  x: number;
  y: number;
}

export interface FigmaPaint {
  type: string;
  visible: boolean;
  opacity: number;
  blendMode?: string;
  color?: { r: number; g: number; b: number; a?: number };
  gradientStops?: Array<{
    position: number;
    color: { r: number; g: number; b: number; a?: number };
  }>;
  gradientHandlePositions?: FigmaPoint[];
  imageRef?: string;
  scaleMode?: string;
}

export interface FigmaEffect {
  type: string;
  visible: boolean;
  radius?: number;
  spread?: number;
  offset?: FigmaPoint;
  color?: { r: number; g: number; b: number; a?: number };
}

export interface FigmaBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FigmaTextStyle {
  fontFamily?: string;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  fontSize?: number;
  letterSpacing?: number;
  lineHeight?: number;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textAlignVertical?: 'top' | 'middle' | 'bottom';
  textCase?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  textDecoration?: 'none' | 'underline' | 'line-through';
  textResizing?: 'autoWidth' | 'autoHeight' | 'fixed';
}

export interface FigmaSourceNode {
  sourceId: string;
  type: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode?: string;
  bounds: FigmaBounds;
  transform?: readonly [number, number, number, number, number, number];
  rotation?: number;
  children: FigmaSourceNode[];
  fills: FigmaPaint[];
  strokes: FigmaPaint[];
  effects: FigmaEffect[];
  cornerRadius?: number;
  rectangleCornerRadii?: [number, number, number, number];
  strokeWeight?: number;
  strokeAlign?: string;
  strokeCap?: string;
  strokeJoin?: string;
  strokeDashes?: number[];
  miterLimit?: number;
  fillGeometry?: Array<{ path: string; windingRule?: string }>;
  pointCount?: number;
  starInnerScale?: number;
  text?: string;
  textStyle?: FigmaTextStyle;
  styleOverrideTable?: Record<string, FigmaTextStyle>;
  characterStyleOverrides?: number[];
  layoutMode?: 'HORIZONTAL' | 'VERTICAL' | 'GRID' | 'NONE';
  layoutWrap?: 'NO_WRAP' | 'WRAP';
  itemSpacing?: number;
  counterAxisSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  primaryAxisSizingMode?: string;
  counterAxisSizingMode?: string;
  layoutSizingHorizontal?: string;
  layoutSizingVertical?: string;
  layoutGrow?: number;
  layoutAlign?: string;
  layoutPositioning?: string;
  overflowDirection?: string;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  layoutGrids?: FigmaLayoutGrid[];
  exportSettings?: FigmaExportSetting[];
  clipsContent?: boolean;
  constraints?: { horizontal?: string; vertical?: string };
  isMask?: boolean;
  booleanOperation?: string;
  componentId?: string;
  componentSetId?: string;
  variantProperties?: Record<string, string>;
  componentPropertyDefinitions?: Record<
    string,
    { type?: string; defaultValue?: unknown; variantOptions?: string[] }
  >;
  componentProperties?: Record<string, { type?: string; value?: unknown }>;
  styleRefs?: Record<string, string>;
  boundVariables?: Record<string, { id?: string } | Array<{ id?: string }>>;
  reactions?: Array<Record<string, unknown>>;
}

export interface FigmaLayoutGrid {
  pattern: 'COLUMNS' | 'ROWS' | 'GRID' | string;
  visible: boolean;
  color?: { r: number; g: number; b: number; a?: number };
  sectionSize?: number;
  gutterSize?: number;
  offset?: number;
  alignment?: string;
  count?: number;
}

export interface FigmaExportSetting {
  format?: string;
  suffix?: string;
  constraint?: { type?: string; value?: number };
  contentsOnly?: boolean;
}

export interface FigmaSourcePage {
  sourceId: string;
  name: string;
  bounds: FigmaBounds;
  children: FigmaSourceNode[];
}

export interface FigmaSourceComponent {
  sourceId: string;
  name: string;
  componentSetId?: string;
}

export interface FigmaSourceComponentSet {
  sourceId: string;
  name: string;
  description?: string;
}

export interface FigmaSourceStyle {
  sourceId: string;
  name: string;
  type: string;
  description?: string;
}

export interface FigmaSourceVariable {
  sourceId: string;
  name: string;
  type: 'color' | 'number' | 'string' | 'boolean';
  valuesByMode: Record<string, unknown>;
  collectionId?: string;
  collectionName?: string;
  modes: string[];
  activeMode: string;
}

export interface FigmaSourceDocument {
  name: string;
  version?: string;
  pages: FigmaSourcePage[];
  components: FigmaSourceComponent[];
  componentSets: FigmaSourceComponentSet[];
  styles: FigmaSourceStyle[];
  variables: FigmaSourceVariable[];
  images: Record<string, { dataUrl: string; width?: number; height?: number }>;
  warnings: string[];
  unsupportedFeatures: string[];
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function positive(value: unknown, fallback: number): number {
  return Math.max(0, finite(value, fallback));
}

function recordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function point(value: unknown): FigmaPoint | undefined {
  if (!isRecord(value)) return undefined;
  return { x: finite(value.x, 0), y: finite(value.y, 0) };
}

function color(value: unknown): FigmaPaint['color'] | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.r !== 'number' ||
    !Number.isFinite(value.r) ||
    typeof value.g !== 'number' ||
    !Number.isFinite(value.g) ||
    typeof value.b !== 'number' ||
    !Number.isFinite(value.b)
  ) {
    return undefined;
  }
  return { r: value.r, g: value.g, b: value.b, a: finite(value.a, 1) };
}

function paint(value: unknown): FigmaPaint | undefined {
  if (!isRecord(value)) return undefined;
  const stops = recordArray(value.gradientStops)
    .map((stop) => {
      const stopColor = color(stop.color);
      return stopColor ? { position: finite(stop.position, 0), color: stopColor } : undefined;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
  const handles = Array.isArray(value.gradientHandlePositions)
    ? value.gradientHandlePositions.map(point).filter((p): p is FigmaPoint => p !== undefined)
    : undefined;
  return {
    type: stringValue(value.type) ?? 'SOLID',
    visible: value.visible !== false,
    opacity: Math.max(0, Math.min(1, finite(value.opacity, 1))),
    blendMode: stringValue(value.blendMode),
    color: color(value.color),
    gradientStops: stops.length > 0 ? stops : undefined,
    gradientHandlePositions: handles,
    imageRef: stringValue(value.imageRef),
    scaleMode: stringValue(value.scaleMode),
  };
}

function effect(value: unknown): FigmaEffect | undefined {
  if (!isRecord(value)) return undefined;
  return {
    type: stringValue(value.type) ?? 'UNKNOWN',
    visible: value.visible !== false,
    radius: finite(value.radius, 0),
    spread: finite(value.spread, 0),
    offset: point(value.offset),
    color: color(value.color),
  };
}

function layoutGrid(value: unknown): FigmaLayoutGrid | undefined {
  if (!isRecord(value)) return undefined;
  return {
    pattern: stringValue(value.pattern) ?? 'UNKNOWN',
    visible: value.visible !== false,
    color: color(value.color),
    sectionSize: positive(value.sectionSize, 0),
    gutterSize: positive(value.gutterSize, 0),
    offset: finite(value.offset, 0),
    alignment: stringValue(value.alignment),
    count: Math.max(0, Math.floor(finite(value.count, 0))),
  };
}

function exportSetting(value: unknown): FigmaExportSetting | undefined {
  if (!isRecord(value)) return undefined;
  const constraint = isRecord(value.constraint)
    ? {
        type: stringValue(value.constraint.type),
        value: finite(value.constraint.value, 1),
      }
    : undefined;
  return {
    format: stringValue(value.format),
    suffix: stringValue(value.suffix),
    constraint,
    contentsOnly: value.contentsOnly === true,
  };
}

function affine(value: unknown): FigmaSourceNode['transform'] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const rowA = Array.isArray(value[0]) ? value[0] : undefined;
  const rowB = Array.isArray(value[1]) ? value[1] : undefined;
  if (!rowA || !rowB || rowA.length < 3 || rowB.length < 3) return undefined;
  const values = [rowA[0], rowB[0], rowA[1], rowB[1], rowA[2], rowB[2]].map((v) => finite(v, 0));
  if (!values.slice(0, 4).every(Number.isFinite)) return undefined;
  return values as unknown as FigmaSourceNode['transform'];
}

function bounds(raw: JsonRecord, parent: FigmaBounds | undefined): FigmaBounds {
  const box = isRecord(raw.absoluteBoundingBox) ? raw.absoluteBoundingBox : undefined;
  const size = isRecord(raw.size) ? raw.size : undefined;
  const w = Math.max(0, finite(box?.width ?? size?.x ?? raw.width, 0));
  const h = Math.max(0, finite(box?.height ?? size?.y ?? raw.height, 0));
  const x = finite(box?.x ?? raw.x, parent?.x ?? 0);
  const y = finite(box?.y ?? raw.y, parent?.y ?? 0);
  return { x, y, w, h };
}

function textStyle(raw: JsonRecord): FigmaTextStyle {
  const style = isRecord(raw.style) ? raw.style : {};
  const lineHeight =
    typeof style.lineHeightPx === 'number'
      ? style.lineHeightPx
      : typeof style.lineHeightPercentFontSize === 'number' && typeof style.fontSize === 'number'
        ? (style.lineHeightPercentFontSize / 100) * style.fontSize
        : undefined;
  const letter = isRecord(style.letterSpacing) ? finite(style.letterSpacing.value, 0) : undefined;
  const textResize = stringValue(style.textAutoResize);
  return {
    fontFamily: stringValue(style.fontFamily),
    fontWeight: finite(style.fontWeight, 400),
    fontStyle: stringValue(style.italic) === 'true' || style.italic === true ? 'italic' : 'normal',
    fontSize: finite(style.fontSize, 16),
    letterSpacing: letter,
    lineHeight,
    textAlign: mapTextAlign(stringValue(style.textAlignHorizontal)),
    textAlignVertical: mapTextAlignVertical(stringValue(style.textAlignVertical)),
    textCase: mapTextCase(stringValue(style.textCase)),
    textDecoration: mapTextDecoration(stringValue(style.textDecoration)),
    textResizing:
      textResize === 'WIDTH_AND_HEIGHT'
        ? 'fixed'
        : textResize === 'HEIGHT'
          ? 'autoHeight'
          : 'autoWidth',
  };
}

function mapTextAlign(value: string | undefined): FigmaTextStyle['textAlign'] {
  switch (value) {
    case 'CENTER':
      return 'center';
    case 'RIGHT':
      return 'right';
    case 'JUSTIFIED':
      return 'justify';
    default:
      return 'left';
  }
}

function mapTextAlignVertical(value: string | undefined): FigmaTextStyle['textAlignVertical'] {
  switch (value) {
    case 'CENTER':
      return 'middle';
    case 'BOTTOM':
      return 'bottom';
    default:
      return 'top';
  }
}

function mapTextCase(value: string | undefined): FigmaTextStyle['textCase'] {
  switch (value) {
    case 'UPPER':
      return 'uppercase';
    case 'LOWER':
      return 'lowercase';
    case 'TITLE':
      return 'capitalize';
    default:
      return 'none';
  }
}

function mapTextDecoration(value: string | undefined): FigmaTextStyle['textDecoration'] {
  if (value === 'UNDERLINE') return 'underline';
  if (value === 'STRIKETHROUGH') return 'line-through';
  return 'none';
}

function normalizeNode(
  raw: JsonRecord,
  path: string,
  depth: number,
  parent?: FigmaBounds,
): FigmaSourceNode {
  if (depth > FIGMA_IMPORT_LIMITS.maxDepth)
    throw new Error(`Figma node depth exceeds ${FIGMA_IMPORT_LIMITS.maxDepth}`);
  const sourceId = stringValue(raw.id) ?? `missing:${path}`;
  const type = stringValue(raw.type) ?? 'UNKNOWN';
  const nodeBounds = bounds(raw, parent);
  const rawChildren = recordArray(raw.children);
  const children = rawChildren.map((child, index) =>
    normalizeNode(child, `${path}.children[${index}]`, depth + 1, nodeBounds),
  );
  const rawOverrides = isRecord(raw.styleOverrideTable) ? raw.styleOverrideTable : undefined;
  const styleOverrides = rawOverrides
    ? Object.fromEntries(
        Object.entries(rawOverrides).map(([key, value]) => [
          key,
          textStyle(isRecord(value) ? { style: value } : {}),
        ]),
      )
    : undefined;
  const node: FigmaSourceNode = {
    sourceId,
    type,
    name: stringValue(raw.name) ?? type,
    visible: raw.visible !== false,
    locked: raw.locked === true,
    opacity: Math.max(0, Math.min(1, finite(raw.opacity, 1))),
    blendMode: stringValue(raw.blendMode),
    bounds: nodeBounds,
    transform: affine(raw.relativeTransform),
    rotation: finite(raw.rotation, 0),
    children,
    fills: recordArray(raw.fills)
      .map(paint)
      .filter((p): p is FigmaPaint => p !== undefined),
    strokes: recordArray(raw.strokes)
      .map(paint)
      .filter((p): p is FigmaPaint => p !== undefined),
    effects: recordArray(raw.effects)
      .map(effect)
      .filter((e): e is FigmaEffect => e !== undefined),
    cornerRadius: finite(raw.cornerRadius, 0),
    rectangleCornerRadii:
      Array.isArray(raw.rectangleCornerRadii) && raw.rectangleCornerRadii.length === 4
        ? (raw.rectangleCornerRadii.map((v) => positive(v, 0)) as [number, number, number, number])
        : undefined,
    strokeWeight: finite(raw.strokeWeight, 1),
    strokeAlign: stringValue(raw.strokeAlign),
    strokeCap: stringValue(raw.strokeCap),
    strokeJoin: stringValue(raw.strokeJoin),
    strokeDashes: Array.isArray(raw.strokeDashes)
      ? raw.strokeDashes.map((v) => positive(v, 0))
      : undefined,
    miterLimit: finite(raw.strokeMiterAngle, 4),
    fillGeometry: recordArray(raw.fillGeometry)
      .map((geometry) => ({
        path: stringValue(geometry.path) ?? '',
        windingRule: stringValue(geometry.windingRule),
      }))
      .filter((geometry) => geometry.path.length > 0),
    pointCount: Math.max(3, Math.floor(finite(raw.pointCount, 5))),
    starInnerScale: Math.max(0, Math.min(1, finite(raw.starInnerScale, 0.2))),
    text:
      typeof raw.characters === 'string'
        ? raw.characters.slice(0, FIGMA_IMPORT_LIMITS.maxTextLength)
        : undefined,
    textStyle: type === 'TEXT' ? textStyle(raw) : undefined,
    styleOverrideTable: styleOverrides,
    characterStyleOverrides: Array.isArray(raw.characterStyleOverrides)
      ? raw.characterStyleOverrides.map((value) =>
          typeof value === 'number' && Number.isInteger(value) ? value : 0,
        )
      : undefined,
    layoutMode:
      raw.layoutMode === 'HORIZONTAL' || raw.layoutMode === 'VERTICAL' || raw.layoutMode === 'GRID'
        ? raw.layoutMode
        : 'NONE',
    layoutWrap: raw.layoutWrap === 'WRAP' ? 'WRAP' : 'NO_WRAP',
    itemSpacing: finite(raw.itemSpacing, 0),
    counterAxisSpacing: finite(raw.counterAxisSpacing, 0),
    paddingTop: positive(raw.paddingTop, 0),
    paddingRight: positive(raw.paddingRight, 0),
    paddingBottom: positive(raw.paddingBottom, 0),
    paddingLeft: positive(raw.paddingLeft, 0),
    primaryAxisAlignItems: stringValue(raw.primaryAxisAlignItems),
    counterAxisAlignItems: stringValue(raw.counterAxisAlignItems),
    primaryAxisSizingMode: stringValue(raw.primaryAxisSizingMode),
    counterAxisSizingMode: stringValue(raw.counterAxisSizingMode),
    layoutSizingHorizontal: stringValue(raw.layoutSizingHorizontal),
    layoutSizingVertical: stringValue(raw.layoutSizingVertical),
    layoutGrow: finite(raw.layoutGrow, 0),
    layoutAlign: stringValue(raw.layoutAlign),
    layoutPositioning: stringValue(raw.layoutPositioning),
    overflowDirection: stringValue(raw.overflowDirection),
    minWidth: positive(raw.minWidth, 0),
    maxWidth: positive(raw.maxWidth, 0),
    minHeight: positive(raw.minHeight, 0),
    maxHeight: positive(raw.maxHeight, 0),
    layoutGrids: recordArray(raw.layoutGrids)
      .map(layoutGrid)
      .filter((grid): grid is FigmaLayoutGrid => grid !== undefined),
    exportSettings: recordArray(raw.exportSettings)
      .map(exportSetting)
      .filter((setting): setting is FigmaExportSetting => setting !== undefined),
    clipsContent: raw.clipsContent === true,
    constraints: isRecord(raw.constraints)
      ? {
          horizontal: stringValue(raw.constraints.horizontal),
          vertical: stringValue(raw.constraints.vertical),
        }
      : undefined,
    isMask: raw.isMask === true,
    booleanOperation: stringValue(raw.booleanOperation),
    componentId: stringValue(raw.componentId),
    componentSetId: stringValue(raw.componentSetId),
    variantProperties: isRecord(raw.variantProperties)
      ? Object.fromEntries(
          Object.entries(raw.variantProperties).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : undefined,
    componentPropertyDefinitions: isRecord(raw.componentPropertyDefinitions)
      ? Object.fromEntries(
          Object.entries(raw.componentPropertyDefinitions).map(([key, value]) => {
            const record = isRecord(value) ? value : {};
            return [
              key,
              {
                type: stringValue(record.type),
                defaultValue: record.defaultValue,
                variantOptions: Array.isArray(record.variantOptions)
                  ? record.variantOptions.filter((v): v is string => typeof v === 'string')
                  : undefined,
              },
            ];
          }),
        )
      : undefined,
    componentProperties: isRecord(raw.componentProperties)
      ? Object.fromEntries(
          Object.entries(raw.componentProperties).map(([key, value]) => {
            const record = isRecord(value) ? value : {};
            return [key, { type: stringValue(record.type), value: record.value }];
          }),
        )
      : undefined,
    styleRefs: isRecord(raw.styles)
      ? Object.fromEntries(
          Object.entries(raw.styles).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : undefined,
    boundVariables: isRecord(raw.boundVariables)
      ? Object.fromEntries(
          Object.entries(raw.boundVariables).map(([key, value]) => [
            key,
            Array.isArray(value)
              ? value.filter(isRecord).map((v) => ({ id: stringValue(v.id) }))
              : isRecord(value)
                ? { id: stringValue(value.id) }
                : {},
          ]),
        )
      : undefined,
    reactions: recordArray(raw.reactions),
  };
  return node;
}

function collectNodes(node: FigmaSourceNode, output: FigmaSourceNode[]): void {
  output.push(node);
  for (const child of node.children) collectNodes(child, output);
}

function parseJson(data: string | Uint8Array): unknown {
  const text =
    typeof data === 'string' ? data : new TextDecoder('utf-8', { fatal: true }).decode(data);
  if (new TextEncoder().encode(text).byteLength > FIGMA_IMPORT_LIMITS.maxBytes) {
    throw new Error(`Figma JSON exceeds the ${FIGMA_IMPORT_LIMITS.maxBytes} byte limit`);
  }
  return JSON.parse(text) as unknown;
}

function rootPayload(value: unknown): JsonRecord {
  if (!isRecord(value)) throw new Error('Figma source must be a JSON object');
  if (isRecord(value.document)) return value;
  if (isRecord(value.file) && isRecord(value.file.document)) return value.file;
  if (value.type === 'DOCUMENT') return { document: value };
  throw new Error('Figma source does not contain a DOCUMENT node');
}

function parseImages(value: unknown): FigmaSourceDocument['images'] {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, raw]) => {
      if (typeof raw === 'string' && raw.startsWith('data:')) return [[key, { dataUrl: raw }]];
      if (!isRecord(raw) || typeof raw.dataUrl !== 'string' || !raw.dataUrl.startsWith('data:'))
        return [];
      return [
        [key, { dataUrl: raw.dataUrl, width: finite(raw.width, 0), height: finite(raw.height, 0) }],
      ];
    }),
  );
}

function parseVariables(value: unknown): FigmaSourceVariable[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([id, raw]) => {
    if (!isRecord(raw)) return [];
    const type = raw.type;
    if (type !== 'COLOR' && type !== 'FLOAT' && type !== 'STRING' && type !== 'BOOLEAN') return [];
    const values = isRecord(raw.valuesByMode) ? raw.valuesByMode : {};
    return [
      {
        sourceId: id,
        name: stringValue(raw.name) ?? id,
        type:
          type === 'COLOR'
            ? 'color'
            : type === 'FLOAT'
              ? 'number'
              : type === 'STRING'
                ? 'string'
                : 'boolean',
        valuesByMode: values,
        collectionId: stringValue(raw.variableCollectionId),
        collectionName: stringValue(raw.collectionName),
        modes: Array.isArray(raw.modes)
          ? raw.modes.filter((v): v is string => typeof v === 'string')
          : ['default'],
        activeMode: stringValue(raw.activeMode) ?? 'default',
      } satisfies FigmaSourceVariable,
    ];
  });
}

export function decodeFigmaSource(data: string | Uint8Array): FigmaSourceDocument {
  const payload = rootPayload(parseJson(data));
  const document = payload.document;
  if (!isRecord(document) || document.type !== 'DOCUMENT')
    throw new Error('Figma source document node is invalid');
  const warnings: string[] = [];
  const unsupportedFeatures: string[] = [];
  const pages = recordArray(document.children).map((page, index) => {
    const pageNode = normalizeNode(page, `document.children[${index}]`, 0);
    if (pageNode.type !== 'CANVAS')
      warnings.push(`Top-level Figma node ${pageNode.type} was treated as a page`);
    return {
      sourceId: pageNode.sourceId,
      name: pageNode.name,
      bounds: pageNode.bounds,
      children: pageNode.children,
    } satisfies FigmaSourcePage;
  });
  const allNodes: FigmaSourceNode[] = [];
  for (const page of pages) for (const child of page.children) collectNodes(child, allNodes);
  if (allNodes.length > FIGMA_IMPORT_LIMITS.maxNodes)
    throw new Error(`Figma source exceeds the ${FIGMA_IMPORT_LIMITS.maxNodes} node limit`);
  const components = isRecord(payload.components)
    ? Object.entries(payload.components).map(([sourceId, raw]) => ({
        sourceId,
        name: isRecord(raw) ? (stringValue(raw.name) ?? sourceId) : sourceId,
        componentSetId: isRecord(raw) ? stringValue(raw.componentSetId) : undefined,
      }))
    : [];
  const componentSets = isRecord(payload.componentSets)
    ? Object.entries(payload.componentSets).map(([sourceId, raw]) => ({
        sourceId,
        name: isRecord(raw) ? (stringValue(raw.name) ?? sourceId) : sourceId,
        description: isRecord(raw) ? stringValue(raw.description) : undefined,
      }))
    : [];
  const styles = isRecord(payload.styles)
    ? Object.entries(payload.styles).map(([sourceId, raw]) => ({
        sourceId,
        name: isRecord(raw) ? (stringValue(raw.name) ?? sourceId) : sourceId,
        type: isRecord(raw) ? (stringValue(raw.styleType) ?? 'UNKNOWN') : 'UNKNOWN',
        description: isRecord(raw) ? stringValue(raw.description) : undefined,
      }))
    : [];
  for (const node of allNodes) {
    if (node.type === 'BOOLEAN_OPERATION')
      unsupportedFeatures.push(
        `Boolean operation "${node.name}" was preserved as editable children, not a native boolean node`,
      );
    if (node.type === 'VECTOR' && (node.fillGeometry?.length ?? 0) === 0)
      unsupportedFeatures.push(
        `Vector "${node.name}" did not include geometry=paths data and was imported as a bounds placeholder`,
      );
    if (
      node.fills.some(
        (fill) =>
          fill.type === 'IMAGE' && fill.imageRef && !parseImages(payload.images)[fill.imageRef],
      )
    )
      unsupportedFeatures.push(
        `Image paint on "${node.name}" needs the Figma image-fills endpoint or embedded plugin data`,
      );
    if (
      node.effects.some(
        (entry) =>
          entry.type !== 'DROP_SHADOW' &&
          entry.type !== 'INNER_SHADOW' &&
          entry.type !== 'LAYER_BLUR' &&
          entry.type !== 'BACKGROUND_BLUR',
      )
    )
      unsupportedFeatures.push(`Unsupported effect on "${node.name}" was omitted`);
  }
  return {
    name: stringValue(payload.name) ?? 'Imported Figma file',
    version: stringValue(payload.version),
    pages,
    components,
    componentSets,
    styles,
    variables: parseVariables(payload.variables),
    images: parseImages(payload.images),
    warnings: [...new Set(warnings)],
    unsupportedFeatures: [...new Set(unsupportedFeatures)],
  };
}

export function isFigmaJsonSource(data: string | Uint8Array): boolean {
  try {
    const value = rootPayload(parseJson(data));
    return isRecord(value.document) && value.document.type === 'DOCUMENT';
  } catch {
    return false;
  }
}
