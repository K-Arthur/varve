/**
 * System clipboard integration for Varve node data.
 *
 * Copies nodes as `application/vnd.varve+json` (preserves structure for
 * in-app paste) and `text/plain` (fallback for paste-into-text-editor).
 * The legacy `application/vnd.strata+json` type is written and read
 * alongside it so clipboard payloads survive an upgrade between builds.
 * Reads clipboard in a single pass for Varve JSON, SVG text, and images.
 *
 * The payload includes both image assets and raster-mask assets referenced by
 * the copied node closure so cross-document paste remains self-contained.
 *
 * Research basis: Clipboard API (W3C), custom MIME types for structured data.
 */
import type { Platform } from '@varve/platform';
import type { MockupTemplateAsset } from '@varve/scene';
import {
  type Document,
  type DocumentAsset,
  type DocumentIconAsset,
  deserializeTiles,
  type RasterLayerNode,
  type RasterMaskAsset,
  type SceneNode,
  type SerializableTiles,
  serializeTiles,
} from '@varve/scene';
import type { Affine } from '@varve/shared';

export { clipboardRichTextWarning, parseClipboardRichText } from './clipboardRichText';

export const VARVE_MIME = 'application/vnd.varve+json';
export const LEGACY_MIME = 'application/vnd.strata+json';
/**
 * Chromium refuses a ClipboardItem containing any non-standard MIME type
 * unless it carries the `web ` prefix, and rejects the *whole* write if one
 * entry is invalid. So the unprefixed item below always threw there, dropping
 * copy into the text-only fallback — which writes node names, not nodes. Copy
 * appeared to work and paste silently did nothing.
 *
 * The prefixed write is attempted first and the unprefixed one kept as a
 * fallback: WebKitGTK, where the desktop app runs, accepts the plain type and
 * is not guaranteed to accept the prefixed one.
 */
export const WEB_VARVE_MIME = `web ${VARVE_MIME}`;
export const WEB_LEGACY_MIME = `web ${LEGACY_MIME}`;
const NATIVE_CLIPBOARD_READ_TYPES = [
  VARVE_MIME,
  LEGACY_MIME,
  WEB_VARVE_MIME,
  WEB_LEGACY_MIME,
  'image/svg+xml',
  'text/svg+xml',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'text/plain',
];
const VARVE_CLIPBOARD_FORMAT = 'varve-clipboard';
/** Version 1 is read for existing system clipboard contents; new writes use v2. */
const VARVE_CLIPBOARD_VERSION = 2 as const;
const LEGACY_CLIPBOARD_VERSION = 1 as const;
const MAX_CLIPBOARD_JSON_BYTES = 64 * 1024 * 1024;
const MAX_CLIPBOARD_NODES = 100_000;
const MAX_CLIPBOARD_DEPTH = 256;

/** Every type a Varve payload may arrive under, prefixed or not. */
function isVarvePayloadType(type: string): boolean {
  return (
    type === VARVE_MIME ||
    type === LEGACY_MIME ||
    type === WEB_VARVE_MIME ||
    type === WEB_LEGACY_MIME
  );
}

export interface ClipboardData {
  /** Versioned fragment envelope. Absent only on legacy pre-envelope copies. */
  format?: typeof VARVE_CLIPBOARD_FORMAT;
  version?: typeof LEGACY_CLIPBOARD_VERSION | typeof VARVE_CLIPBOARD_VERSION;
  /** Source document identity, used to distinguish in-document paste from a foreign paste. */
  sourceDocumentId?: string;
  nodes: SceneNode[];
  /** Original selected roots, in user selection order. */
  rootIds?: string[];
  rasterMaskAssets?: Record<string, RasterMaskAsset>;
  assets?: Record<string, DocumentAsset>;
  iconAssets?: Record<string, DocumentIconAsset>;
  mockupTemplates?: Record<string, MockupTemplateAsset>;
  /** Generative edit records whose source/result nodes are in this fragment. */
  generativeEdits?: NonNullable<Document['generativeEdits']>;
  components?: Document['components'];
  styles?: Document['styles'];
  paints?: Document['paints'];
  variableStore?: Document['variableStore'];
  interactions?: Document['interactions'];
  timelines?: Document['timelines'];
  stories?: Document['stories'];
  motionExtensions?: Document['motionExtensions'];
  motionPresets?: Document['motionPresets'];
  /**
   * Placed-world transform of each copied selection root, keyed by the
   * node's ORIGINAL id. Optional and forward-compatible: clipboard payloads
   * without it (old copies, foreign writers) do not claim a destination-
   * independent world pose and are placed using the fallback center policy.
   *
   * When present, paste converts through world space:
   *   newLocal = targetParentWorld⁻¹ · anchor
   * so a child copied from inside artboard A lands at the same WORLD pose
   * after pasting into artboard B (or at the document top level) instead of
   * being reinterpreted in the destination's local frame. The source document
   * identity determines whether this is an in-document pose or a foreign
   * fragment that must be centered for the destination.
   */
  worldAnchor?: Record<string, Affine>;
}

export interface ClipboardImportItem {
  data: string | Uint8Array;
  mimeType: string;
  name: string;
}

export interface UnifiedClipboardResult {
  varveData: ClipboardData | null;
  importItems: ClipboardImportItem[];
  /** Plain text that is not an SVG. Text editors remain the native owner. */
  plainText?: string;
  /** Bounded HTML snapshot for the editable rich-text importer. */
  htmlText?: string;
}

export type TransferIntent = 'paste' | 'copy' | 'cut' | 'import' | 'drop';

export interface TransferRequest {
  readonly operationId: string;
  readonly gestureId: string;
  readonly intent: TransferIntent;
  readonly sessionId?: string;
  readonly createdAt: number;
}

export type ClipboardRequest = TransferRequest;

export interface ClipboardCapabilities {
  readonly text: boolean;
  readonly html: boolean;
  readonly raster: boolean;
  readonly customMime: boolean;
  readonly fileTransfer: boolean;
  readonly permission: 'granted' | 'denied' | 'unknown';
}

export interface ClipboardSnapshot {
  readonly request: TransferRequest;
  readonly capturedAt: number;
  readonly capabilities: ClipboardCapabilities;
  readonly orderedItems: readonly string[];
  readonly alternatives: readonly string[];
}

export interface TransferOutcome {
  readonly request: TransferRequest;
  readonly status: 'committed' | 'empty' | 'failed' | 'cancelled' | 'superseded';
  readonly committedRoots: readonly string[];
  readonly warnings: readonly string[];
  readonly capabilities?: ClipboardCapabilities;
}

export type ClipboardWriteOutcome =
  | { status: 'editable'; mimeTypes: string[] }
  | { status: 'text-only'; reason: 'editable-format-unavailable' }
  | {
      status: 'failed';
      reason: 'clipboard-unavailable' | 'permission-denied' | 'write-failed';
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function serializeClipboardNode(node: SceneNode): SceneNode {
  if (node.kind !== 'rasterLayer') return node;
  const raster = node as RasterLayerNode;
  if (!(raster.tiles instanceof Map)) return node;
  return { ...raster, tiles: serializeTiles(raster.tiles) } as unknown as SceneNode;
}

function parseClipboardNode(value: unknown): SceneNode | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.kind !== 'string') {
    return null;
  }
  if (
    !['shape', 'text', 'group', 'frame', 'table', 'adjustment', 'path', 'rasterLayer'].includes(
      value.kind,
    )
  ) {
    return null;
  }
  if (value.id.length === 0 || value.id.length > 256) return null;
  if (
    'transform' in value &&
    (!Array.isArray(value.transform) ||
      value.transform.length !== 6 ||
      value.transform.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry)))
  ) {
    return null;
  }
  if ((value.kind === 'group' || value.kind === 'frame') && !Array.isArray(value.children)) {
    return null;
  }
  if (
    (value.kind === 'group' || value.kind === 'frame') &&
    (value.children as unknown[]).some((child) => typeof child !== 'string' || child.length > 256)
  ) {
    return null;
  }
  if (value.kind !== 'rasterLayer' || value.tiles instanceof Map) {
    return value as unknown as SceneNode;
  }
  if (!isRecord(value.tiles)) return value as unknown as SceneNode;
  try {
    return {
      ...value,
      tiles: deserializeTiles(value.tiles as unknown as SerializableTiles),
    } as unknown as SceneNode;
  } catch {
    return null;
  }
}

function validateNodeGraph(nodes: SceneNode[]): boolean {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const state = new Map<string, 0 | 1 | 2>();
  for (const root of nodes) {
    if (state.get(root.id) === 2) continue;
    const stack: Array<{ id: string; depth: number; exit: boolean }> = [
      { id: root.id, depth: 0, exit: false },
    ];
    while (stack.length > 0) {
      const current = stack.pop()!;
      const node = byId.get(current.id);
      if (!node || current.depth > MAX_CLIPBOARD_DEPTH) return false;
      if (current.exit) {
        state.set(current.id, 2);
        continue;
      }
      if (state.get(current.id) === 1) return false;
      if (state.get(current.id) === 2) continue;
      state.set(current.id, 1);
      stack.push({ id: current.id, depth: current.depth, exit: true });
      if (node.kind === 'group' || node.kind === 'frame') {
        for (let index = node.children.length - 1; index >= 0; index -= 1) {
          stack.push({ id: node.children[index]!, depth: current.depth + 1, exit: false });
        }
      }
    }
  }
  return true;
}

function validResourceMap(value: unknown): boolean {
  if (!value) return true;
  if (!isRecord(value) || Object.keys(value).length > MAX_CLIPBOARD_NODES) return false;
  return Object.values(value).every((entry) => isRecord(entry) && finitePayload(entry));
}

/** Reject NaN/Infinity anywhere in a transported fragment without recursive stack growth. */
function finitePayload(value: unknown): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.depth > MAX_CLIPBOARD_DEPTH) return false;
    if (typeof current.value === 'number') {
      if (!Number.isFinite(current.value)) return false;
      continue;
    }
    if (Array.isArray(current.value)) {
      for (const child of current.value) stack.push({ value: child, depth: current.depth + 1 });
      continue;
    }
    if (isRecord(current.value)) {
      for (const child of Object.values(current.value)) {
        stack.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
  return true;
}

/** Validate and rehydrate a transport payload before it enters editor state. */
export function parseClipboardData(text: string): ClipboardData | null {
  if (new TextEncoder().encode(text).byteLength > MAX_CLIPBOARD_JSON_BYTES) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || !Array.isArray(raw.nodes) || raw.nodes.length > MAX_CLIPBOARD_NODES) {
    return null;
  }
  if (
    raw.format !== undefined &&
    (raw.format !== VARVE_CLIPBOARD_FORMAT ||
      (raw.version !== LEGACY_CLIPBOARD_VERSION && raw.version !== VARVE_CLIPBOARD_VERSION))
  ) {
    return null;
  }
  const nodes: SceneNode[] = [];
  const ids = new Set<string>();
  for (const value of raw.nodes) {
    const node = parseClipboardNode(value);
    if (!node || ids.has(node.id)) return null;
    ids.add(node.id);
    nodes.push(node);
  }
  if (!validateNodeGraph(nodes) || !finitePayload(nodes)) return null;
  const rootIds = raw.rootIds;
  if (
    rootIds !== undefined &&
    (!Array.isArray(rootIds) ||
      rootIds.some((id) => typeof id !== 'string' || !ids.has(id)) ||
      new Set(rootIds).size !== rootIds.length)
  ) {
    return null;
  }
  if (
    !validResourceMap(raw.rasterMaskAssets) ||
    !validResourceMap(raw.assets) ||
    !validResourceMap(raw.iconAssets) ||
    !validResourceMap(raw.mockupTemplates) ||
    !validResourceMap(raw.generativeEdits) ||
    !validResourceMap(raw.components) ||
    !validResourceMap(raw.styles) ||
    !validResourceMap(raw.paints) ||
    !validResourceMap(raw.variableStore) ||
    !validResourceMap(raw.interactions) ||
    !validResourceMap(raw.timelines) ||
    !validResourceMap(raw.stories) ||
    !validResourceMap(raw.motionExtensions) ||
    !validResourceMap(raw.motionPresets)
  ) {
    return null;
  }
  if (
    raw.worldAnchor !== undefined &&
    (!isRecord(raw.worldAnchor) ||
      Object.values(raw.worldAnchor).some(
        (anchor) =>
          !Array.isArray(anchor) ||
          anchor.length !== 6 ||
          anchor.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry)),
      ))
  ) {
    return null;
  }
  return {
    ...(raw.format === VARVE_CLIPBOARD_FORMAT
      ? {
          format: VARVE_CLIPBOARD_FORMAT as typeof VARVE_CLIPBOARD_FORMAT,
          version:
            raw.version === VARVE_CLIPBOARD_VERSION
              ? VARVE_CLIPBOARD_VERSION
              : LEGACY_CLIPBOARD_VERSION,
        }
      : {}),
    ...(typeof raw.sourceDocumentId === 'string' ? { sourceDocumentId: raw.sourceDocumentId } : {}),
    nodes,
    ...(rootIds ? { rootIds: [...rootIds] } : {}),
    ...(isRecord(raw.rasterMaskAssets)
      ? { rasterMaskAssets: raw.rasterMaskAssets as ClipboardData['rasterMaskAssets'] }
      : {}),
    ...(isRecord(raw.assets) ? { assets: raw.assets as ClipboardData['assets'] } : {}),
    ...(isRecord(raw.iconAssets)
      ? { iconAssets: raw.iconAssets as ClipboardData['iconAssets'] }
      : {}),
    ...(isRecord(raw.mockupTemplates)
      ? { mockupTemplates: raw.mockupTemplates as ClipboardData['mockupTemplates'] }
      : {}),
    ...(isRecord(raw.generativeEdits)
      ? { generativeEdits: raw.generativeEdits as ClipboardData['generativeEdits'] }
      : {}),
    ...(isRecord(raw.components)
      ? { components: raw.components as ClipboardData['components'] }
      : {}),
    ...(isRecord(raw.styles) ? { styles: raw.styles as ClipboardData['styles'] } : {}),
    ...(isRecord(raw.paints) ? { paints: raw.paints as ClipboardData['paints'] } : {}),
    ...(isRecord(raw.variableStore)
      ? { variableStore: raw.variableStore as unknown as ClipboardData['variableStore'] }
      : {}),
    ...(isRecord(raw.interactions)
      ? { interactions: raw.interactions as ClipboardData['interactions'] }
      : {}),
    ...(isRecord(raw.timelines) ? { timelines: raw.timelines as ClipboardData['timelines'] } : {}),
    ...(isRecord(raw.stories) ? { stories: raw.stories as ClipboardData['stories'] } : {}),
    ...(isRecord(raw.motionExtensions)
      ? { motionExtensions: raw.motionExtensions as ClipboardData['motionExtensions'] }
      : {}),
    ...(isRecord(raw.motionPresets)
      ? { motionPresets: raw.motionPresets as ClipboardData['motionPresets'] }
      : {}),
    ...(isRecord(raw.worldAnchor)
      ? { worldAnchor: raw.worldAnchor as ClipboardData['worldAnchor'] }
      : {}),
  };
}

function serializeClipboardData(
  nodes: SceneNode[],
  rasterMaskAssets?: Record<string, RasterMaskAsset>,
  assets?: Record<string, DocumentAsset>,
  iconAssets?: Record<string, DocumentIconAsset>,
  worldAnchor?: Record<string, Affine>,
  rootIds?: string[],
  mockupTemplates?: Record<string, MockupTemplateAsset>,
  sourceDocumentId?: string,
  generativeEdits?: NonNullable<Document['generativeEdits']>,
  components?: Document['components'],
  styles?: Document['styles'],
  paints?: Document['paints'],
  variableStore?: Document['variableStore'],
  interactions?: Document['interactions'],
  timelines?: Document['timelines'],
  stories?: Document['stories'],
  motionExtensions?: Document['motionExtensions'],
  motionPresets?: Document['motionPresets'],
): string {
  const data: ClipboardData = {
    format: VARVE_CLIPBOARD_FORMAT,
    version: VARVE_CLIPBOARD_VERSION,
    ...(sourceDocumentId ? { sourceDocumentId } : {}),
    nodes: nodes.map(serializeClipboardNode),
    ...(rootIds && rootIds.length > 0 ? { rootIds: [...rootIds] } : {}),
    ...(rasterMaskAssets && Object.keys(rasterMaskAssets).length > 0 ? { rasterMaskAssets } : {}),
    ...(assets && Object.keys(assets).length > 0 ? { assets } : {}),
    ...(iconAssets && Object.keys(iconAssets).length > 0 ? { iconAssets } : {}),
    ...(mockupTemplates && Object.keys(mockupTemplates).length > 0 ? { mockupTemplates } : {}),
    ...(worldAnchor && Object.keys(worldAnchor).length > 0 ? { worldAnchor } : {}),
    ...(generativeEdits && Object.keys(generativeEdits).length > 0 ? { generativeEdits } : {}),
    ...(components && Object.keys(components).length > 0 ? { components } : {}),
    ...(styles && Object.keys(styles).length > 0 ? { styles } : {}),
    ...(paints && Object.keys(paints).length > 0 ? { paints } : {}),
    ...(variableStore && Object.keys(variableStore.variables).length > 0 ? { variableStore } : {}),
    ...(interactions && Object.keys(interactions).length > 0 ? { interactions } : {}),
    ...(timelines && Object.keys(timelines).length > 0 ? { timelines } : {}),
    ...(stories && Object.keys(stories).length > 0 ? { stories } : {}),
    ...(motionExtensions && Object.keys(motionExtensions).length > 0 ? { motionExtensions } : {}),
    ...(motionPresets && Object.keys(motionPresets).length > 0 ? { motionPresets } : {}),
  };
  return JSON.stringify(data);
}

function isPermissionError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotAllowedError';
}

let clipboardWriteTail: Promise<void> = Promise.resolve();
let latestClipboardWrite = 0;

function enqueueClipboardWrite(
  operation: (generation: number) => Promise<ClipboardWriteOutcome>,
): Promise<ClipboardWriteOutcome> {
  const generation = ++latestClipboardWrite;
  const run = clipboardWriteTail.then(() => operation(generation));
  clipboardWriteTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Serialize clipboard writes and suppress late fallbacks from superseded requests. */
export function writeClipboardOutcome(
  nodes: SceneNode[],
  rasterMaskAssets?: Record<string, RasterMaskAsset>,
  assets?: Record<string, DocumentAsset>,
  iconAssets?: Record<string, DocumentIconAsset>,
  worldAnchor?: Record<string, Affine>,
  rootIds?: string[],
  mockupTemplates?: Record<string, MockupTemplateAsset>,
  platform?: Pick<Platform, 'kind' | 'writeClipboardData'>,
  sourceDocumentId?: string,
  generativeEdits?: NonNullable<Document['generativeEdits']>,
  components?: Document['components'],
  styles?: Document['styles'],
  paints?: Document['paints'],
  variableStore?: Document['variableStore'],
  interactions?: Document['interactions'],
  timelines?: Document['timelines'],
  stories?: Document['stories'],
  motionExtensions?: Document['motionExtensions'],
  motionPresets?: Document['motionPresets'],
): Promise<ClipboardWriteOutcome> {
  return enqueueClipboardWrite((generation) =>
    writeClipboardOutcomeNow(
      nodes,
      rasterMaskAssets,
      assets,
      iconAssets,
      worldAnchor,
      rootIds,
      mockupTemplates,
      platform,
      sourceDocumentId,
      generativeEdits,
      components,
      styles,
      paints,
      variableStore,
      interactions,
      timelines,
      stories,
      motionExtensions,
      motionPresets,
      generation,
    ),
  );
}

/**
 * Publish a single non-Varve representation (Copy Text/SVG/PNG) through the
 * same serialized write queue as object copies. A superseded operation is
 * reported as failed and cannot issue a late fallback write.
 */
export function writeClipboardRepresentation(
  mimeType: string,
  data: Uint8Array,
  plainText: string,
  platform?: Pick<Platform, 'kind' | 'writeClipboardData'>,
): Promise<ClipboardWriteOutcome> {
  return enqueueClipboardWrite((generation) =>
    writeClipboardRepresentationNow(mimeType, data, plainText, platform, generation),
  );
}

async function writeClipboardRepresentationNow(
  mimeType: string,
  data: Uint8Array,
  plainText: string,
  platform: Pick<Platform, 'kind' | 'writeClipboardData'> | undefined,
  generation: number,
): Promise<ClipboardWriteOutcome> {
  const isCurrentWrite = (): boolean => generation === latestClipboardWrite;
  if (!isCurrentWrite()) return { status: 'failed', reason: 'write-failed' };
  if (platform?.kind === 'tauri') {
    try {
      const written = await platform.writeClipboardData([{ mimeType, data }]);
      if (written && isCurrentWrite()) return { status: 'editable', mimeTypes: [mimeType] };
    } catch {
      // Continue through browser and text-only fallbacks.
    }
  }
  if (!isCurrentWrite() || typeof navigator === 'undefined' || !navigator.clipboard) {
    return { status: 'failed', reason: 'write-failed' };
  }
  const clipboardItemCtor = globalThis.ClipboardItem;
  if (typeof clipboardItemCtor === 'function' && typeof navigator.clipboard.write === 'function') {
    try {
      await navigator.clipboard.write([
        new clipboardItemCtor({
          [mimeType]: new Blob([data as unknown as BlobPart], { type: mimeType }),
          'text/plain': plainText,
        }),
      ]);
      if (!isCurrentWrite()) return { status: 'failed', reason: 'write-failed' };
      return { status: 'editable', mimeTypes: [mimeType, 'text/plain'] };
    } catch {
      // Text is still useful in an external editor.
    }
  }
  if (!isCurrentWrite() || typeof navigator.clipboard.writeText !== 'function') {
    return { status: 'failed', reason: 'write-failed' };
  }
  try {
    await navigator.clipboard.writeText(plainText);
    if (!isCurrentWrite()) return { status: 'failed', reason: 'write-failed' };
    return { status: 'text-only', reason: 'editable-format-unavailable' };
  } catch (error) {
    return {
      status: 'failed',
      reason: isPermissionError(error) ? 'permission-denied' : 'write-failed',
    };
  }
}

async function writeClipboardOutcomeNow(
  nodes: SceneNode[],
  rasterMaskAssets?: Record<string, RasterMaskAsset>,
  assets?: Record<string, DocumentAsset>,
  iconAssets?: Record<string, DocumentIconAsset>,
  worldAnchor?: Record<string, Affine>,
  rootIds?: string[],
  mockupTemplates?: Record<string, MockupTemplateAsset>,
  platform?: Pick<Platform, 'kind' | 'writeClipboardData'>,
  sourceDocumentId?: string,
  generativeEdits?: NonNullable<Document['generativeEdits']>,
  components?: Document['components'],
  styles?: Document['styles'],
  paints?: Document['paints'],
  variableStore?: Document['variableStore'],
  interactions?: Document['interactions'],
  timelines?: Document['timelines'],
  stories?: Document['stories'],
  motionExtensions?: Document['motionExtensions'],
  motionPresets?: Document['motionPresets'],
  generation?: number,
): Promise<ClipboardWriteOutcome> {
  const isCurrentWrite = (): boolean =>
    generation === undefined || generation === latestClipboardWrite;
  if (!isCurrentWrite()) return { status: 'failed', reason: 'write-failed' };
  let json: string;
  try {
    json = serializeClipboardData(
      nodes,
      rasterMaskAssets,
      assets,
      iconAssets,
      worldAnchor,
      rootIds,
      mockupTemplates,
      sourceDocumentId,
      generativeEdits,
      components,
      styles,
      paints,
      variableStore,
      interactions,
      timelines,
      stories,
      motionExtensions,
      motionPresets,
    );
  } catch {
    return { status: 'failed', reason: 'write-failed' };
  }
  // A browser/native clipboard write can succeed even when the payload is
  // larger than the reader's budget or cannot be rehydrated.  Cut must never
  // delete its source on the strength of such a write.  Validate the exact
  // bytes that will be offered before publishing them.
  const encodedJson = new TextEncoder().encode(json);
  if (encodedJson.byteLength > MAX_CLIPBOARD_JSON_BYTES || !parseClipboardData(json)) {
    return { status: 'failed', reason: 'write-failed' };
  }
  const text = nodes.map((n) => n.name).join('\n');
  const textBlob = new Blob([text], { type: 'text/plain' });
  if (platform?.kind === 'tauri') {
    try {
      const written = await platform.writeClipboardData([
        { mimeType: VARVE_MIME, data: new TextEncoder().encode(json) },
        { mimeType: LEGACY_MIME, data: new TextEncoder().encode(json) },
        { mimeType: 'text/plain', data: new TextEncoder().encode(text) },
      ]);
      if (written && isCurrentWrite()) {
        return { status: 'editable', mimeTypes: [VARVE_MIME, LEGACY_MIME, 'text/plain'] };
      }
    } catch {
      // Native rich clipboard support is optional; continue through the
      // browser API and its text-only fallback when it is unavailable.
    }
  }
  if (!isCurrentWrite()) return { status: 'failed', reason: 'write-failed' };
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    return { status: 'failed', reason: 'clipboard-unavailable' };
  }
  const clipboardItemCtor = globalThis.ClipboardItem;
  if (typeof clipboardItemCtor === 'function' && typeof navigator.clipboard.write === 'function') {
    try {
      await navigator.clipboard.write([
        new clipboardItemCtor({
          [WEB_VARVE_MIME]: new Blob([json], { type: WEB_VARVE_MIME }),
          [WEB_LEGACY_MIME]: new Blob([json], { type: WEB_LEGACY_MIME }),
          'text/plain': textBlob,
        }),
      ]);
      if (!isCurrentWrite()) return { status: 'failed', reason: 'write-failed' };
      return { status: 'editable', mimeTypes: [WEB_VARVE_MIME, WEB_LEGACY_MIME, 'text/plain'] };
    } catch (firstError) {
      if (!isCurrentWrite()) return { status: 'failed', reason: 'write-failed' };
      try {
        await navigator.clipboard.write([
          new clipboardItemCtor({
            [VARVE_MIME]: new Blob([json], { type: VARVE_MIME }),
            [LEGACY_MIME]: new Blob([json], { type: LEGACY_MIME }),
            'text/plain': textBlob,
          }),
        ]);
        if (!isCurrentWrite()) return { status: 'failed', reason: 'write-failed' };
        return { status: 'editable', mimeTypes: [VARVE_MIME, LEGACY_MIME, 'text/plain'] };
      } catch (secondError) {
        if (isPermissionError(firstError) || isPermissionError(secondError)) {
          // Continue to the explicit text-only fallback. It is useful in an
          // external editor but must never authorize a destructive Cut.
        }
      }
    }
  }
  if (!isCurrentWrite()) return { status: 'failed', reason: 'write-failed' };
  if (typeof navigator.clipboard.writeText !== 'function') {
    return { status: 'failed', reason: 'clipboard-unavailable' };
  }
  try {
    await navigator.clipboard.writeText(nodes.map((n) => n.name).join('\n'));
    if (!isCurrentWrite()) return { status: 'failed', reason: 'write-failed' };
    return { status: 'text-only', reason: 'editable-format-unavailable' };
  } catch (error) {
    if (!isCurrentWrite()) return { status: 'failed', reason: 'write-failed' };
    return {
      status: 'failed',
      reason: isPermissionError(error) ? 'permission-denied' : 'write-failed',
    };
  }
}

/**
 * Backward-compatible boolean for small callers. New destructive workflows
 * must use writeClipboardOutcome so text-only output cannot look editable.
 */
export async function writeClipboard(
  nodes: SceneNode[],
  rasterMaskAssets?: Record<string, RasterMaskAsset>,
  assets?: Record<string, DocumentAsset>,
  iconAssets?: Record<string, DocumentIconAsset>,
  worldAnchor?: Record<string, Affine>,
  rootIds?: string[],
  mockupTemplates?: Record<string, MockupTemplateAsset>,
  platform?: Pick<Platform, 'kind' | 'writeClipboardData'>,
  sourceDocumentId?: string,
  generativeEdits?: NonNullable<Document['generativeEdits']>,
  components?: Document['components'],
  styles?: Document['styles'],
  paints?: Document['paints'],
  variableStore?: Document['variableStore'],
  interactions?: Document['interactions'],
  timelines?: Document['timelines'],
  stories?: Document['stories'],
  motionExtensions?: Document['motionExtensions'],
  motionPresets?: Document['motionPresets'],
): Promise<boolean> {
  return (
    (
      await writeClipboardOutcome(
        nodes,
        rasterMaskAssets,
        assets,
        iconAssets,
        worldAnchor,
        rootIds,
        mockupTemplates,
        platform,
        sourceDocumentId,
        generativeEdits,
        components,
        styles,
        paints,
        variableStore,
        interactions,
        timelines,
        stories,
        motionExtensions,
        motionPresets,
      )
    ).status === 'editable'
  );
}

function createClipboardResult(): UnifiedClipboardResult {
  return { varveData: null, importItems: [] };
}

function isSvgText(text: string): boolean {
  return /^(?:\uFEFF|\s|<!--(?:[\s\S]*?)-->)*(?:<\?xml\b[^>]*>\s*)?(?:<!--(?:[\s\S]*?)-->\s*)*<svg(?:\s|>)/i.test(
    text,
  );
}

function hasRichClipboardContent(result: UnifiedClipboardResult): boolean {
  return Boolean(result.varveData || result.importItems.length > 0 || result.htmlText);
}

function addImageItem(
  result: UnifiedClipboardResult,
  data: string | Uint8Array,
  mimeType: string,
  name: string,
): void {
  result.importItems.push({
    data,
    mimeType,
    name: name || `clipboard.${mimeType.split('/')[1] ?? 'bin'}`,
  });
}

async function readClipboardItem(
  item: ClipboardItem,
  result: UnifiedClipboardResult,
  itemIndex: number,
): Promise<void> {
  const varveType = item.types.find(isVarvePayloadType);
  if (varveType) {
    try {
      const parsed = parseClipboardData(await (await item.getType(varveType)).text());
      if (parsed) {
        result.varveData = parsed;
        return;
      }
    } catch {
      // A malformed custom format must not hide a valid fallback item.
    }
  }
  const svgType = item.types.find((type) => type === 'image/svg+xml' || type === 'text/svg+xml');
  if (svgType) {
    try {
      const text = await (await item.getType(svgType)).text();
      if (isSvgText(text)) {
        addImageItem(result, text, 'image/svg+xml', `clipboard-${itemIndex}.svg`);
        return;
      }
    } catch {
      // Try the raster representation below.
    }
  }
  const imageType = item.types.find(
    (type) => type.startsWith('image/') && type !== 'image/svg+xml',
  );
  if (imageType) {
    try {
      const bytes = new Uint8Array(await (await item.getType(imageType)).arrayBuffer());
      addImageItem(
        result,
        bytes,
        imageType,
        `clipboard-${itemIndex}.${imageType.split('/')[1] ?? 'bin'}`,
      );
      return;
    } catch {
      // Keep looking for a safe text representation.
    }
  }
  if (item.types.includes('text/plain')) {
    try {
      const text = await (await item.getType('text/plain')).text();
      if (isSvgText(text)) {
        addImageItem(result, text, 'image/svg+xml', `clipboard-${itemIndex}.svg`);
      } else if (text) {
        result.plainText ??= text;
      }
    } catch {
      // Ignore one unreadable representation.
    }
  }
  if (item.types.includes('text/html')) {
    try {
      const html = await (await item.getType('text/html')).text();
      if (html) result.htmlText ??= html.slice(0, 4 * 1024 * 1024);
    } catch {
      // HTML is optional; plain text remains usable.
    }
  }
}

export async function readClipboardUnified(): Promise<UnifiedClipboardResult> {
  const result = createClipboardResult();
  try {
    const items = await navigator.clipboard.read();
    for (let i = 0; i < items.length; i++) await readClipboardItem(items[i]!, result, i);
  } catch {
    // Clipboard read failed or permission denied
  }
  return result;
}

/**
 * Read clipboard data from a DOM ClipboardEvent directly (async).
 *
 * This is the cross-platform path: `ClipboardEvent.clipboardData` is available
 * on all platforms and browsers (including Wayland) without the permission
 * issues that affect `navigator.clipboard.read()` with image MIME types.
 *
 * Reads image files as Uint8Array and SVG files as text strings, matching
 * the format expected by the import pipeline (importFile → importImageAsFile).
 */
export async function readFromClipboardEvent(
  event: ClipboardEvent,
): Promise<UnifiedClipboardResult> {
  const dt = event.clipboardData;
  if (!dt) return createClipboardResult();
  return readClipboardSnapshot(snapshotClipboardData(dt));
}

interface ClipboardFileSnapshot {
  file: File;
  index: number;
}

interface ClipboardDataSnapshot {
  varveData: ClipboardData | null;
  plainText: string | null;
  svgText: string | null;
  htmlText: string | null;
  files: ClipboardFileSnapshot[];
}

function snapshotClipboardData(dt: DataTransfer): ClipboardDataSnapshot {
  let varveData: ClipboardData | null = null;
  for (const type of [VARVE_MIME, LEGACY_MIME, WEB_VARVE_MIME, WEB_LEGACY_MIME]) {
    try {
      const text = dt.getData(type);
      if (text) {
        const parsed = parseClipboardData(text);
        if (parsed) {
          varveData = parsed;
          break;
        }
      }
    } catch {
      // Continue through compatible representations.
    }
  }
  let svgText: string | null = null;
  for (const type of ['image/svg+xml', 'text/svg+xml']) {
    try {
      const text = dt.getData(type);
      if (text && isSvgText(text)) {
        svgText = text;
        break;
      }
    } catch {
      // Continue through the text fallback.
    }
  }
  let plainText: string | null = null;
  try {
    const text = dt.getData('text/plain');
    if (text && isSvgText(text)) svgText ??= text;
    else if (text) plainText = text;
  } catch {
    // Text is optional.
  }
  let htmlText: string | null = null;
  try {
    const html = dt.getData('text/html');
    if (html) htmlText = html.slice(0, 4 * 1024 * 1024);
  } catch {
    // HTML is optional.
  }
  const files: ClipboardFileSnapshot[] = [];
  const seenFiles = new Set<File>();
  const addFile = (file: File | null, index: number): void => {
    if (!file || seenFiles.has(file) || !file.type.startsWith('image/')) return;
    seenFiles.add(file);
    files.push({ file, index });
  };
  for (let i = 0; i < dt.files.length; i++) addFile(dt.files[i] ?? null, i);
  for (let i = 0; i < dt.items.length; i++) {
    const item = dt.items[i];
    if (item?.kind === 'file') addFile(item.getAsFile(), i);
  }
  return { varveData, plainText, svgText, htmlText, files };
}

async function readClipboardSnapshot(
  snapshot: ClipboardDataSnapshot,
): Promise<UnifiedClipboardResult> {
  const result = createClipboardResult();
  result.varveData = snapshot.varveData;
  if (snapshot.plainText) result.plainText = snapshot.plainText;
  if (snapshot.htmlText) result.htmlText = snapshot.htmlText;
  if (snapshot.svgText) addImageItem(result, snapshot.svgText, 'image/svg+xml', 'clipboard.svg');
  if (snapshot.varveData) return result;
  const imported = await Promise.all(
    snapshot.files.map(async ({ file, index }) => {
      try {
        if (file.type === 'image/svg+xml') {
          const text = await file.text();
          // A clipboard commonly exposes the same SVG as both a string MIME
          // and a File. Suppress only the byte-identical representation; a
          // second SVG file remains a distinct logical item.
          if (snapshot.svgText && text === snapshot.svgText) return null;
          return isSvgText(text)
            ? {
                data: text,
                mimeType: 'image/svg+xml',
                name: file.name || `clipboard-${index}.svg`,
              }
            : null;
        }
        return {
          data: new Uint8Array(await file.arrayBuffer()),
          mimeType: file.type,
          name: file.name || `clipboard-${index}.${file.type.split('/')[1] ?? 'bin'}`,
        } satisfies ClipboardImportItem;
      } catch {
        // Isolate one unreadable item from the rest of the paste.
        return null;
      }
    }),
  );
  for (const item of imported) {
    if (item) addImageItem(result, item.data, item.mimeType, item.name);
  }
  return result;
}

interface OwnedClipboardSnapshot {
  data: ClipboardDataSnapshot;
  contract: ClipboardSnapshot;
}

let transferSequence = 0;
let latestTransferRequest: TransferRequest | null = null;
const pendingTransferRequests: TransferRequest[] = [];
const capturedClipboardSnapshots = new Map<string, OwnedClipboardSnapshot>();
const pendingPasteFallbacks = new Map<string, ReturnType<typeof setTimeout>>();

export function createTransferRequest(
  intent: TransferIntent = 'paste',
  sessionId?: string,
): TransferRequest {
  transferSequence += 1;
  const id = `${Date.now().toString(36)}-${transferSequence.toString(36)}`;
  const request: TransferRequest = {
    operationId: id,
    gestureId: id,
    intent,
    ...(sessionId ? { sessionId } : {}),
    createdAt: Date.now(),
  };
  latestTransferRequest = request;
  if (intent === 'paste') pendingTransferRequests.push(request);
  return request;
}

export function getLatestTransferRequest(): TransferRequest | null {
  return latestTransferRequest;
}

/**
 * Claim the oldest keyboard paste request for the next synchronous DOM event.
 * A browser can dispatch several paste events before an async import finishes;
 * keeping the identity in the request queue prevents those events from
 * sharing a global snapshot or fallback timer.
 */
export function claimPendingTransferRequest(): TransferRequest {
  return pendingTransferRequests[0] ?? createTransferRequest('paste');
}

function removePendingRequest(request: TransferRequest): void {
  const index = pendingTransferRequests.findIndex(
    (candidate) => candidate.operationId === request.operationId,
  );
  if (index >= 0) pendingTransferRequests.splice(index, 1);
  if (latestTransferRequest?.operationId === request.operationId) {
    latestTransferRequest = pendingTransferRequests[pendingTransferRequests.length - 1] ?? null;
  }
}

function capabilitiesForSnapshot(snapshot: ClipboardDataSnapshot): ClipboardCapabilities {
  return {
    text: Boolean(snapshot.plainText),
    html: Boolean(snapshot.htmlText),
    raster: snapshot.files.some(
      ({ file }) => file.type.startsWith('image/') && file.type !== 'image/svg+xml',
    ),
    customMime: Boolean(snapshot.varveData),
    fileTransfer: snapshot.files.length > 0,
    permission: 'granted',
  };
}

function contractForSnapshot(
  request: TransferRequest,
  snapshot: ClipboardDataSnapshot,
): ClipboardSnapshot {
  const alternatives = [
    snapshot.varveData ? VARVE_MIME : null,
    snapshot.svgText ? 'image/svg+xml' : null,
    snapshot.htmlText ? 'text/html' : null,
    snapshot.plainText ? 'text/plain' : null,
    ...snapshot.files.map(({ file }) => file.type),
  ].filter((value): value is string => Boolean(value));
  return {
    request,
    capturedAt: Date.now(),
    capabilities: capabilitiesForSnapshot(snapshot),
    orderedItems: snapshot.files.map(({ file }) => file.name || file.type),
    alternatives,
  };
}

export function getClipboardSnapshot(request?: TransferRequest): ClipboardSnapshot | null {
  const owned = request ?? latestTransferRequest;
  return owned ? (capturedClipboardSnapshots.get(owned.operationId)?.contract ?? null) : null;
}

/** Snapshot a paste event while its DataTransfer is live; never retain the event itself. */
export function captureClipboardEvent(
  event: ClipboardEvent,
  request?: TransferRequest,
): TransferRequest {
  const owned = request ?? pendingTransferRequests[0] ?? createTransferRequest('paste');
  const data = event.clipboardData ? snapshotClipboardData(event.clipboardData) : null;
  if (data) {
    capturedClipboardSnapshots.set(owned.operationId, {
      data,
      contract: contractForSnapshot(owned, data),
    });
  } else {
    capturedClipboardSnapshots.delete(owned.operationId);
  }
  removePendingRequest(owned);
  latestTransferRequest = owned;
  return owned;
}

/** Clear one captured event (or all legacy captures) after consuming it. */
export function clearCapturedClipboardEvent(request?: TransferRequest): void {
  if (request) {
    capturedClipboardSnapshots.delete(request.operationId);
    removePendingRequest(request);
    return;
  }
  capturedClipboardSnapshots.clear();
  pendingTransferRequests.length = 0;
  latestTransferRequest = null;
}

/** Whether a clipboard event belongs to a browser-owned editing surface. */
export function isNativeClipboardTarget(event: Event): boolean {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
  return path.some((entry) => {
    if (typeof HTMLElement === 'undefined' || !(entry instanceof HTMLElement)) return false;
    const tag = entry.tagName.toLowerCase();
    return (
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select' ||
      tag === 'dialog' ||
      entry.isContentEditable ||
      entry.getAttribute('contenteditable') === '' ||
      entry.getAttribute('role') === 'textbox' ||
      entry.hasAttribute('data-clipboard-native')
    );
  });
}

/**
 * Keydown-time fallback for engines that never fire a DOM `paste` event.
 *
 * The Ctrl+V keydown handler deliberately does nothing (no preventDefault,
 * no action) so the browser can deliver a `paste` ClipboardEvent, whose
 * `clipboardData` is the most reliable cross-platform read. Chrome and
 * Firefox fire that event even with non-editable focus — WebKit (incl.
 * WebKitGTK, i.e. the Linux Tauri webview) only fires it into editable
 * elements, so in a canvas app Ctrl+V otherwise dies without ever reaching
 * the paste action. The keydown handler schedules this fallback; a real
 * `paste` event cancels it before running the action itself, so exactly one
 * of the two paths executes.
 */
export function schedulePasteFallback(
  requestOrRun: TransferRequest | (() => void),
  runOrDelay: (() => void) | number = 150,
  delayMs = 150,
): TransferRequest {
  const request =
    typeof requestOrRun === 'function' ? createTransferRequest('paste') : requestOrRun;
  const run = typeof requestOrRun === 'function' ? requestOrRun : (runOrDelay as () => void);
  const timeout = typeof runOrDelay === 'number' ? runOrDelay : delayMs;
  cancelPasteFallback(request);
  pendingPasteFallbacks.set(
    request.operationId,
    setTimeout(() => {
      pendingPasteFallbacks.delete(request.operationId);
      removePendingRequest(request);
      latestTransferRequest = request;
      run();
    }, timeout),
  );
  return request;
}

export function cancelPasteFallback(request?: TransferRequest): void {
  const owned = request ?? pendingTransferRequests[0] ?? latestTransferRequest;
  if (owned) {
    const timer = pendingPasteFallbacks.get(owned.operationId);
    if (timer !== undefined) {
      clearTimeout(timer);
      pendingPasteFallbacks.delete(owned.operationId);
    }
    return;
  }
}

/**
 * Read clipboard with event-based fallback.
 *
 * Tries `navigator.clipboard.read()` first (async, may fail on Wayland).
 * Falls back to the last captured DOM paste event (always available for
 * Ctrl+V). Falls back once more to a native OS clipboard read via `platform`
 * (Tauri's Rust backend, bypassing the Web Clipboard API entirely) — this is
 * the only reliable path for menu-triggered ("right-click Paste") reads on
 * WebKitGTK/Wayland, which has no ClipboardEvent to capture and whose
 * `navigator.clipboard.read()` frequently can't surface image MIME types.
 */
export async function readClipboardUnifiedWithFallback(
  platform?: Pick<Platform, 'kind' | 'readClipboardData' | 'readClipboardImage'>,
  request?: TransferRequest,
): Promise<UnifiedClipboardResult> {
  // An explicit request is authoritative. For compatibility with menu and
  // test callers that do not have a request, only reuse the latest request if
  // it still owns an unread snapshot; otherwise create a fresh operation so a
  // previous gesture cannot leak into this read.
  const latestWithSnapshot =
    latestTransferRequest && capturedClipboardSnapshots.has(latestTransferRequest.operationId)
      ? latestTransferRequest
      : null;
  const owned = request ?? latestWithSnapshot ?? createTransferRequest('paste');
  const eventSnapshot = owned ? capturedClipboardSnapshots.get(owned.operationId)?.data : undefined;
  if (owned) {
    capturedClipboardSnapshots.delete(owned.operationId);
    removePendingRequest(owned);
  }
  let eventResult: UnifiedClipboardResult | null = null;
  if (eventSnapshot) {
    eventResult = await readClipboardSnapshot(eventSnapshot);
    if (hasRichClipboardContent(eventResult)) return eventResult;
  }
  const apiResult = await readClipboardUnified();
  if (hasRichClipboardContent(apiResult)) {
    return apiResult;
  }
  if (platform?.kind === 'tauri') {
    try {
      const nativeItem = await platform.readClipboardData(NATIVE_CLIPBOARD_READ_TYPES);
      if (nativeItem && nativeItem.data.byteLength <= MAX_CLIPBOARD_JSON_BYTES) {
        if (isVarvePayloadType(nativeItem.mimeType)) {
          const parsed = parseClipboardData(new TextDecoder().decode(nativeItem.data));
          if (parsed) return { varveData: parsed, importItems: [] };
        } else if (
          nativeItem.mimeType === 'image/svg+xml' ||
          nativeItem.mimeType === 'text/svg+xml'
        ) {
          const text = new TextDecoder().decode(nativeItem.data);
          if (isSvgText(text)) {
            return {
              varveData: null,
              importItems: [{ data: text, mimeType: 'image/svg+xml', name: 'clipboard.svg' }],
            };
          }
        } else if (nativeItem.mimeType.startsWith('image/')) {
          return {
            varveData: null,
            importItems: [
              {
                data: nativeItem.data,
                mimeType: nativeItem.mimeType,
                name: `clipboard.${nativeItem.mimeType.split('/')[1] ?? 'bin'}`,
              },
            ],
          };
        } else if (nativeItem.mimeType === 'text/plain') {
          const text = new TextDecoder().decode(nativeItem.data);
          if (isSvgText(text)) {
            return {
              varveData: null,
              importItems: [{ data: text, mimeType: 'image/svg+xml', name: 'clipboard.svg' }],
            };
          }
          if (text) return { varveData: null, importItems: [], plainText: text };
        }
      }
    } catch {
      // Native rich clipboard read failed; retain the image fallback below.
    }
    try {
      const bytes = await platform.readClipboardImage();
      if (bytes && bytes.length > 0) {
        return {
          varveData: null,
          importItems: [{ data: bytes, mimeType: 'image/png', name: 'clipboard.png' }],
        };
      }
    } catch {
      // Native clipboard read failed (e.g. arboard couldn't reach the OS
      // clipboard) — this is the last-resort tier, so fall through to the
      // empty result rather than rejecting the whole paste() action.
    }
  }
  return eventResult ?? apiResult;
}
