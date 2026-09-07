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
const VARVE_CLIPBOARD_VERSION = 1;
const MAX_CLIPBOARD_JSON_BYTES = 64 * 1024 * 1024;
const MAX_CLIPBOARD_NODES = 100_000;

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
  version?: typeof VARVE_CLIPBOARD_VERSION;
  /** Source document identity, used to distinguish in-document paste from a foreign paste. */
  sourceDocumentId?: string;
  nodes: SceneNode[];
  /** Original selected roots, in user selection order. */
  rootIds?: string[];
  rasterMaskAssets?: Record<string, RasterMaskAsset>;
  assets?: Record<string, DocumentAsset>;
  iconAssets?: Record<string, DocumentIconAsset>;
  mockupTemplates?: Record<string, MockupTemplateAsset>;
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
  if (value.kind !== 'rasterLayer' || value.tiles instanceof Map) {
    return value as unknown as SceneNode;
  }
  if (!isRecord(value.tiles)) return value as unknown as SceneNode;
  return {
    ...value,
    tiles: deserializeTiles(value.tiles as unknown as SerializableTiles),
  } as unknown as SceneNode;
}

/** Validate and rehydrate a transport payload before it enters editor state. */
export function parseClipboardData(text: string): ClipboardData | null {
  if (text.length > MAX_CLIPBOARD_JSON_BYTES) return null;
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
    (raw.format !== VARVE_CLIPBOARD_FORMAT || raw.version !== VARVE_CLIPBOARD_VERSION)
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
  const rootIds = raw.rootIds;
  if (
    rootIds !== undefined &&
    (!Array.isArray(rootIds) ||
      rootIds.some((id) => typeof id !== 'string' || !ids.has(id)) ||
      new Set(rootIds).size !== rootIds.length)
  ) {
    return null;
  }
  return {
    ...(raw.format === VARVE_CLIPBOARD_FORMAT
      ? { format: VARVE_CLIPBOARD_FORMAT as typeof VARVE_CLIPBOARD_FORMAT, version: 1 as const }
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
  };
  return JSON.stringify(data);
}

function isPermissionError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotAllowedError';
}

export async function writeClipboardOutcome(
  nodes: SceneNode[],
  rasterMaskAssets?: Record<string, RasterMaskAsset>,
  assets?: Record<string, DocumentAsset>,
  iconAssets?: Record<string, DocumentIconAsset>,
  worldAnchor?: Record<string, Affine>,
  rootIds?: string[],
  mockupTemplates?: Record<string, MockupTemplateAsset>,
  platform?: Pick<Platform, 'kind' | 'writeClipboardData'>,
  sourceDocumentId?: string,
): Promise<ClipboardWriteOutcome> {
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
    );
  } catch {
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
      if (written) {
        return { status: 'editable', mimeTypes: [VARVE_MIME, LEGACY_MIME, 'text/plain'] };
      }
    } catch {
      // Native rich clipboard support is optional; continue through the
      // browser API and its text-only fallback when it is unavailable.
    }
  }
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
      return { status: 'editable', mimeTypes: [WEB_VARVE_MIME, WEB_LEGACY_MIME, 'text/plain'] };
    } catch (firstError) {
      try {
        await navigator.clipboard.write([
          new clipboardItemCtor({
            [VARVE_MIME]: new Blob([json], { type: VARVE_MIME }),
            [LEGACY_MIME]: new Blob([json], { type: LEGACY_MIME }),
            'text/plain': textBlob,
          }),
        ]);
        return { status: 'editable', mimeTypes: [VARVE_MIME, LEGACY_MIME, 'text/plain'] };
      } catch (secondError) {
        if (isPermissionError(firstError) || isPermissionError(secondError)) {
          // Continue to the explicit text-only fallback. It is useful in an
          // external editor but must never authorize a destructive Cut.
        }
      }
    }
  }
  if (typeof navigator.clipboard.writeText !== 'function') {
    return { status: 'failed', reason: 'clipboard-unavailable' };
  }
  try {
    await navigator.clipboard.writeText(nodes.map((n) => n.name).join('\n'));
    return { status: 'text-only', reason: 'editable-format-unavailable' };
  } catch (error) {
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

function hasCanvasClipboardContent(result: UnifiedClipboardResult): boolean {
  return Boolean(result.varveData || result.importItems.length > 0);
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
      if (text && !isSvgText(text)) result.plainText ??= text;
    } catch {
      // Ignore one unreadable representation.
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
  let plainText: string | null = null;
  try {
    const text = dt.getData('text/plain');
    if (text && !isSvgText(text)) plainText = text;
  } catch {
    // Text is optional.
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
  return { varveData, plainText, files };
}

async function readClipboardSnapshot(
  snapshot: ClipboardDataSnapshot,
): Promise<UnifiedClipboardResult> {
  const result = createClipboardResult();
  result.varveData = snapshot.varveData;
  if (snapshot.plainText) result.plainText = snapshot.plainText;
  if (snapshot.varveData) return result;
  const imported = await Promise.all(
    snapshot.files.map(async ({ file, index }) => {
      try {
        if (file.type === 'image/svg+xml') {
          const text = await file.text();
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

/**
 * Module-level reference to the last paste event, captured by
 * the native paste listener in Shell. Used as a fallback when
 * `navigator.clipboard.read()` fails (common on Wayland).
 */
let capturedPasteSnapshot: ClipboardDataSnapshot | null = null;

/** Snapshot a paste event while its DataTransfer is live; never retain the event itself. */
export function captureClipboardEvent(event: ClipboardEvent): void {
  capturedPasteSnapshot = event.clipboardData ? snapshotClipboardData(event.clipboardData) : null;
}

/** Clear the captured paste event (e.g. after consuming it). */
export function clearCapturedClipboardEvent(): void {
  capturedPasteSnapshot = null;
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
let pendingPasteFallback: ReturnType<typeof setTimeout> | null = null;

export function schedulePasteFallback(run: () => void, delayMs = 150): void {
  cancelPasteFallback();
  pendingPasteFallback = setTimeout(() => {
    pendingPasteFallback = null;
    run();
  }, delayMs);
}

export function cancelPasteFallback(): void {
  if (pendingPasteFallback !== null) {
    clearTimeout(pendingPasteFallback);
    pendingPasteFallback = null;
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
): Promise<UnifiedClipboardResult> {
  const eventSnapshot = capturedPasteSnapshot;
  capturedPasteSnapshot = null;
  let eventResult: UnifiedClipboardResult | null = null;
  if (eventSnapshot) {
    eventResult = await readClipboardSnapshot(eventSnapshot);
    if (hasCanvasClipboardContent(eventResult)) return eventResult;
  }
  const apiResult = await readClipboardUnified();
  if (hasCanvasClipboardContent(apiResult)) {
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
          if (text && !isSvgText(text))
            return { varveData: null, importItems: [], plainText: text };
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
