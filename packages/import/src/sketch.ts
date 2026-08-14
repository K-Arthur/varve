import type { Affine } from '@varve/engine';
import {
  createDocument,
  type Document,
  type ManagedColor,
  makeGroupNode,
  makeShapeNode,
  makeTextNode,
  mintId,
  type NodeId,
  type SceneNode,
} from '@varve/scene';
import { strFromU8, unzipSync } from 'fflate';
import type { ImportOptions, ImportParser, ImportResult } from './types';

type JsonRecord = Record<string, unknown>;

interface BuildState {
  nextId: number;
  nodes: Record<NodeId, SceneNode>;
  warnings: string[];
}

interface SketchFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PARTIAL_WARNING =
  'Sketch import is partial: symbols, overrides, shared styles, and constraints are approximated';

export function createSketchParser(): ImportParser {
  return {
    format: 'sketch',
    supportedExtensions: () => ['sketch'],
    canParse: (data) => {
      if (typeof data === 'string') return false;
      return data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b;
    },
    parse: (data, options) => {
      const opts: ImportOptions = {
        embedImages: options?.embedImages ?? true,
        scale: options?.scale ?? 1,
        center: options?.center ?? false,
        keepPosition: options?.keepPosition ?? false,
      };

      if (typeof data === 'string') {
        return {
          document: createDocument('Imported Sketch', true),
          nodeIds: [],
          warnings: ['Sketch import requires binary ZIP data'],
        };
      }

      try {
        return parseSketchArchive(data, opts);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown Sketch import error';
        return {
          document: createDocument('Imported Sketch', true),
          nodeIds: [],
          warnings: [`Sketch import failed: ${message}`],
        };
      }
    },
  };
}

function parseSketchArchive(data: Uint8Array, opts: ImportOptions): ImportResult {
  const entries = unzipSync(data);
  const names = Object.keys(entries);
  for (const name of names) {
    if (isUnsafeZipPath(name)) {
      return {
        document: createDocument('Imported Sketch', true),
        nodeIds: [],
        warnings: [`Sketch archive contains unsafe path: ${name}`],
      };
    }
  }

  const pageNames = names.filter((name) => /^pages\/.+\.json$/i.test(name)).sort();
  if (pageNames.length === 0) {
    return {
      document: createDocument('Imported Sketch', true),
      nodeIds: [],
      warnings: ['Sketch archive does not contain any pages/*.json entries'],
    };
  }

  const docName = readDocumentName(entries) ?? 'Imported Sketch';
  const base = createDocument(docName, true);
  const state: BuildState = {
    nextId: base.nextId,
    nodes: {},
    warnings: [PARTIAL_WARNING],
  };
  const rootChildren: NodeId[] = [];

  for (const pageName of pageNames) {
    const page = parseJsonEntry(entries, pageName);
    if (!page) {
      state.warnings.push(`Sketch page ${pageName} could not be parsed`);
      continue;
    }
    const layers = arrayOfRecords(page.layers);
    for (let i = 0; i < layers.length; i++) {
      const id = convertLayer(layers[i]!, state, opts, i);
      if (id) rootChildren.push(id);
    }
  }

  const document: Document = {
    ...base,
    nextId: state.nextId,
    rootChildren,
    nodes: state.nodes,
  };

  return { document, nodeIds: rootChildren, warnings: dedupe(state.warnings) };
}

function isUnsafeZipPath(path: string): boolean {
  if (
    path.length === 0 ||
    path.startsWith('/') ||
    path.startsWith('\\') ||
    path.includes('\\') ||
    path.includes('\0') ||
    [...path].some((character) => character.charCodeAt(0) < 0x20)
  )
    return true;
  if (/^[a-zA-Z]:/.test(path)) return true;
  return path
    .split('/')
    .some(
      (segment) =>
        segment.length === 0 || segment === '.' || segment === '..' || segment.includes(':'),
    );
}

function readDocumentName(entries: Record<string, Uint8Array>): string | null {
  const doc = parseJsonEntry(entries, 'document.json');
  return stringValue(doc?.name);
}

function parseJsonEntry(entries: Record<string, Uint8Array>, name: string): JsonRecord | null {
  const bytes = entries[name];
  if (!bytes) return null;
  try {
    const parsed = JSON.parse(strFromU8(bytes));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function convertLayer(
  layer: JsonRecord,
  state: BuildState,
  opts: ImportOptions,
  index: number,
): NodeId | null {
  const id = allocate(state);
  const frame = readFrame(layer, opts.scale);
  const name = stringValue(layer.name) ?? className(layer) ?? 'Layer';
  const cls = className(layer);
  const transform = [1, 0, 0, 1, frame.x, frame.y] as Affine;
  const common = {
    name,
    transform,
    visible: booleanValue(layer.isVisible) ?? true,
    locked: booleanValue(layer.isLocked) ?? false,
    opacity: readOpacity(layer),
    order: `a${index}`,
    index,
  };

  if (cls === 'group' || cls === 'artboard' || cls === 'symbolMaster') {
    const children = arrayOfRecords(layer.layers)
      .map((child, childIndex) => convertLayer(child, state, opts, childIndex))
      .filter((childId): childId is NodeId => !!childId);
    if (cls !== 'group') state.warnings.push(`Sketch ${cls} imported as a group`);
    state.nodes[id] = makeGroupNode(id, { ...common, children });
    return id;
  }

  if (cls === 'rectangle' || cls === 'shapePath' || cls === 'shapeGroup') {
    state.nodes[id] = makeShapeNode(
      id,
      { kind: 'rect', x: 0, y: 0, w: frame.w, h: frame.h },
      { ...common, fill: readFill(layer) },
    );
    if (cls === 'shapeGroup')
      state.warnings.push('Sketch shape groups are flattened to rectangles');
    return id;
  }

  if (cls === 'oval') {
    state.nodes[id] = makeShapeNode(
      id,
      { kind: 'ellipse', cx: frame.w / 2, cy: frame.h / 2, rx: frame.w / 2, ry: frame.h / 2 },
      { ...common, fill: readFill(layer) },
    );
    return id;
  }

  if (cls === 'text') {
    state.nodes[id] = makeTextNode(id, readText(layer) ?? name, {
      ...common,
      fill: readFill(layer),
      fontSize: numberValue(layer.fontSize) ?? 16 * opts.scale,
    });
    return id;
  }

  if (cls === 'bitmap') {
    state.warnings.push('Sketch bitmap layers are imported as editable placeholder rectangles');
    state.nodes[id] = makeShapeNode(
      id,
      { kind: 'rect', x: 0, y: 0, w: frame.w, h: frame.h },
      { ...common, fill: { space: 'rgb', r: 180, g: 190, b: 200, a: 255 } },
    );
    return id;
  }

  state.warnings.push(`Unsupported Sketch layer class skipped: ${cls ?? 'unknown'}`);
  return null;
}

function allocate(state: BuildState): NodeId {
  // ADR-0025: collision-resistant ids so two imports of the same file
  // (or two branches) never collide.
  const id = mintId('n', state.nextId);
  state.nextId += 1;
  return id;
}

function className(layer: JsonRecord): string | null {
  return stringValue(layer._class) ?? stringValue(layer.class) ?? stringValue(layer.type);
}

function readFrame(layer: JsonRecord, scale: number): SketchFrame {
  const frame = isRecord(layer.frame) ? layer.frame : {};
  const w = numberValue(frame.width) ?? numberValue(frame.w) ?? 100;
  const h = numberValue(frame.height) ?? numberValue(frame.h) ?? 100;
  return {
    x: (numberValue(frame.x) ?? 0) * scale,
    y: (numberValue(frame.y) ?? 0) * scale,
    w: Math.max(1, w * scale),
    h: Math.max(1, h * scale),
  };
}

function readText(layer: JsonRecord): string | null {
  const attr = isRecord(layer.attributedString) ? layer.attributedString : null;
  return stringValue(attr?.string) ?? stringValue(layer.text);
}

function readFill(layer: JsonRecord): ManagedColor {
  const style = isRecord(layer.style) ? layer.style : null;
  const fills = Array.isArray(style?.fills) ? style.fills : [];
  const first = fills.find(
    (fill): fill is JsonRecord => isRecord(fill) && fill.isEnabled !== false,
  );
  const color = first && isRecord(first.color) ? first.color : null;
  if (!color) return { space: 'rgb', r: 57, g: 208, b: 198, a: 255 };
  return {
    space: 'rgb',
    r: normalizedChannel(color.red),
    g: normalizedChannel(color.green),
    b: normalizedChannel(color.blue),
    a: normalizedAlpha(color.alpha),
  };
}

function readOpacity(layer: JsonRecord): number {
  const style = isRecord(layer.style) ? layer.style : null;
  const contextSettings = isRecord(style?.contextSettings) ? style.contextSettings : null;
  return numberValue(contextSettings?.opacity) ?? 1;
}

function normalizedChannel(value: unknown): number {
  const n = numberValue(value) ?? 0;
  return Math.max(0, Math.min(255, Math.round(n <= 1 ? n * 255 : n)));
}

function normalizedAlpha(value: unknown): number {
  const n = numberValue(value) ?? 1;
  return Math.max(0, Math.min(255, Math.round(n <= 1 ? n * 255 : n)));
}

function arrayOfRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((item): item is JsonRecord => isRecord(item)) : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
