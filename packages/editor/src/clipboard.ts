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

import type { DepthMapResource } from '@varve/engine';
import { getFontRegistry } from '@varve/engine';
import type {
  EmbeddingRights,
  FontEmbeddingPolicy,
  FontReference,
  FontSourceKind,
} from '@varve/engine/font';
import {
  collectFontData,
  FontLoader,
  fontReferenceKey,
  storeFontOnFilesystem,
} from '@varve/engine/font';
import type { Platform } from '@varve/platform';
import {
  activePageNodes,
  type Document,
  type DocumentAsset,
  type DocumentIconAsset,
  deserializeTiles,
  isContainer,
  type LayoutGrid,
  type MockupTemplateAsset,
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
/** Versions 1/2 remain readable; v3 carries frame-owned guide metadata. */
const VARVE_CLIPBOARD_VERSION = 3 as const;
const LEGACY_CLIPBOARD_VERSION = 1 as const;
const MAX_CLIPBOARD_JSON_BYTES = 64 * 1024 * 1024;
const MAX_CLIPBOARD_NODES = 100_000;
const MAX_CLIPBOARD_DEPTH = 256;
const MAX_CLIPBOARD_FONT_DEPENDENCIES = 256;
const MAX_CLIPBOARD_FONT_BYTES = 32 * 1024 * 1024;

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
  version?: 1 | 2 | typeof VARVE_CLIPBOARD_VERSION;
  /** Source document identity, used to distinguish in-document paste from a foreign paste. */
  sourceDocumentId?: string;
  nodes: SceneNode[];
  /** Original selected roots, in user selection order. */
  rootIds?: string[];
  /**
   * Node ids that support the roots but must not become visible paste roots.
   * These are explicit in v2; older payloads infer them from reachability.
   */
  dependencyIds?: string[];
  /** Accepted depth resources referenced by the copied mask/effect closure. */
  depthMaps?: Record<string, DepthMapResource>;
  /** Font metadata and permitted local bytes required by this fragment. */
  fontManifest?: Document['fontManifest'];
  fontDependencies?: ClipboardFontDependency[];
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
  /** v3: only owners present in the copied fragment are included. */
  frameGuideLayouts?: Record<string, LayoutGrid[]>;
}

export interface ClipboardFontDependency {
  family: string;
  fontReference?: FontReference;
  postScriptName?: string;
  requestedWeight?: number;
  requestedStyle?: string;
  source?: FontSourceKind;
  embeddingRights?: EmbeddingRights;
  embeddingPolicy?: FontEmbeddingPolicy;
  /** `embedded` means the original bytes are present in dataBase64. */
  status: 'embedded' | 'metadata-only' | 'missing' | 'restricted';
  dataBase64?: string;
}

/** Immutable selection and geometry snapshot used by delayed exports. */
export interface ClipboardSelectionSnapshot {
  document: Document;
  nodes: readonly SceneNode[];
  activeId: string;
  revision: number;
  selectionRevision: number;
  worldTransforms?: Readonly<Record<string, Affine>>;
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

/**
 * Return selected roots in the document's paint/display order.
 *
 * Selection state records the order in which the user clicked layers. That
 * order is useful for announcing a selection, but it must not change the
 * sibling order or z-order when a multi-root selection is exported as SVG or
 * transferred to another document. The walk is iterative so a malformed or
 * unusually deep document cannot grow the call stack during a clipboard
 * gesture.
 */
export function orderClipboardRoots(doc: Document, ids: readonly string[]): string[] {
  const selected = new Set(ids.filter((id) => Boolean(doc.nodes[id])));
  if (selected.size < 2) return [...selected];

  const ordered: string[] = [];
  const seen = new Set<string>();
  const seeds = [...activePageNodes(doc)];
  const seeded = new Set(seeds);
  for (const id of doc.rootChildren) {
    if (!seeded.has(id)) {
      seeds.push(id);
      seeded.add(id);
    }
  }
  const pending = seeds.reverse();
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    const node = doc.nodes[id];
    if (!node) continue;
    seen.add(id);
    if (selected.has(id)) ordered.push(id);
    if (isContainer(node)) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        pending.push(node.children[index]!);
      }
    }
  }

  // Selected nodes can belong to an inactive page, a detached master, or a
  // legacy document whose roots are not exposed by activePageNodes(). Keep
  // those items rather than silently dropping them, using selection order only
  // as the deterministic fallback for nodes with no display projection.
  for (const id of ids) {
    if (selected.has(id) && !ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}

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

interface ClipboardFontRequest {
  family: string;
  fontReference?: FontReference;
}

function clipboardFontRequestKey(request: ClipboardFontRequest): string {
  return request.fontReference
    ? `${request.family.toLowerCase()}\u0000${fontReferenceKey(request.fontReference)}`
    : request.family.toLowerCase();
}

function collectClipboardFontRequests(
  nodes: readonly SceneNode[],
  styles?: Document['styles'],
): ClipboardFontRequest[] {
  const requests = new Map<string, ClipboardFontRequest>();
  const add = (family: string | undefined, fontReference?: FontReference): void => {
    const normalized = family?.trim();
    if (!normalized) return;
    const request = { family: normalized, ...(fontReference ? { fontReference } : {}) };
    requests.set(clipboardFontRequestKey(request), request);
  };
  for (const node of nodes) {
    if (node.kind !== 'text') continue;
    add(node.fontFamily, node.fontReference);
    for (const paragraph of node.richText?.paragraphs ?? []) {
      for (const run of paragraph.runs ?? []) {
        add(run.format?.fontFamily, run.format?.fontReference);
      }
    }
  }
  for (const style of Object.values(styles ?? {})) {
    const candidate = style as unknown as {
      type?: string;
      fontFamily?: string;
      fontReference?: FontReference;
      format?: { fontFamily?: string; fontReference?: FontReference };
      characterFormat?: { fontFamily?: string; fontReference?: FontReference };
    };
    if (candidate.type === 'text') add(candidate.fontFamily, candidate.fontReference);
    add(candidate.format?.fontFamily, candidate.format?.fontReference);
    add(candidate.characterFormat?.fontFamily, candidate.characterFormat?.fontReference);
  }
  return [...requests.values()].sort((a, b) =>
    clipboardFontRequestKey(a).localeCompare(clipboardFontRequestKey(b)),
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  if (typeof btoa === 'function') return btoa(binary);
  const BufferCtor = (
    globalThis as unknown as {
      Buffer?: { from(value: Uint8Array): { toString(encoding: string): string } };
    }
  ).Buffer;
  return BufferCtor?.from(bytes).toString('base64') ?? '';
}

function base64ToBytes(value: string): Uint8Array | null {
  try {
    if (typeof atob === 'function') {
      const binary = atob(value);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1)
        bytes[index] = binary.charCodeAt(index);
      return bytes;
    }
    const BufferCtor = (
      globalThis as unknown as {
        Buffer?: { from(value: string, encoding: string): Uint8Array };
      }
    ).Buffer;
    return BufferCtor ? new Uint8Array(BufferCtor.from(value, 'base64')) : null;
  } catch {
    return null;
  }
}

function isEmbeddingPermitted(rights: EmbeddingRights | undefined): boolean {
  return rights === 'installable' || rights === 'editable' || rights === 'no-subsetting';
}

/** Build a portable, bounded font closure for a native/browser clipboard write. */
async function prepareClipboardFontDependencies(
  nodes: readonly SceneNode[],
  styles: Document['styles'] | undefined,
  manifest: Document['fontManifest'] | undefined,
): Promise<ClipboardFontDependency[]> {
  const requests = collectClipboardFontRequests(nodes, styles);
  if (requests.length === 0) return [];
  const manifestByKey = new Map<string, NonNullable<Document['fontManifest']>['fonts'][number]>();
  for (const entry of manifest?.fonts ?? []) {
    const key = entry.fontReference
      ? `${entry.familyName.toLowerCase()}\u0000${fontReferenceKey(entry.fontReference)}`
      : entry.familyName.toLowerCase();
    manifestByKey.set(key, entry);
  }
  const exactRequests = requests.filter((request) => request.fontReference);
  const records = await collectFontData(exactRequests, {
    // Copying a layer must never start a remote font download. An explicit
    // package export may fetch bundled assets; clipboard writes stay local.
    fetchBundled: false,
  });
  const recordsByKey = new Map(
    records.map((record) => [
      clipboardFontRequestKey({ family: record.family, fontReference: record.fontReference }),
      record,
    ]),
  );
  let embeddedBytes = 0;
  return requests.slice(0, MAX_CLIPBOARD_FONT_DEPENDENCIES).map((request) => {
    const exactKey = clipboardFontRequestKey(request);
    const entry =
      manifestByKey.get(exactKey) ??
      (!request.fontReference ? manifestByKey.get(request.family.toLowerCase()) : undefined);
    const record = request.fontReference ? recordsByKey.get(exactKey) : undefined;
    const rights = entry?.embeddingRights;
    const canEmbed = Boolean(record && request.fontReference && isEmbeddingPermitted(rights));
    const withinBudget = Boolean(
      canEmbed && record && embeddedBytes + record.data.byteLength <= MAX_CLIPBOARD_FONT_BYTES,
    );
    if (withinBudget && record) embeddedBytes += record.data.byteLength;
    const status: ClipboardFontDependency['status'] = withinBudget
      ? 'embedded'
      : rights === 'restricted'
        ? 'restricted'
        : request.fontReference && !record
          ? 'missing'
          : 'metadata-only';
    const identity = entry?.identity;
    return {
      family: request.family,
      ...(request.fontReference ? { fontReference: request.fontReference } : {}),
      ...(identity?.postScriptName ? { postScriptName: identity.postScriptName } : {}),
      ...(entry?.requestedWeight !== undefined ? { requestedWeight: entry.requestedWeight } : {}),
      ...(entry?.requestedStyle ? { requestedStyle: entry.requestedStyle } : {}),
      ...(entry?.source ? { source: entry.source } : {}),
      ...(rights ? { embeddingRights: rights } : {}),
      ...(entry?.embeddingPolicy ? { embeddingPolicy: entry.embeddingPolicy } : {}),
      status,
      ...(withinBudget && record ? { dataBase64: bytesToBase64(record.data) } : {}),
    };
  });
}

/** Restore permitted clipboard font bytes without dirtying the document. */
export async function restoreClipboardFontDependencies(
  dependencies: readonly ClipboardFontDependency[] | undefined,
): Promise<{ restored: number; skipped: number }> {
  let restored = 0;
  let skipped = 0;
  if (!dependencies) return { restored, skipped };
  const loader = new FontLoader(undefined, getFontRegistry());
  for (const dependency of dependencies.slice(0, MAX_CLIPBOARD_FONT_DEPENDENCIES)) {
    if (dependency.status !== 'embedded' || !dependency.fontReference || !dependency.dataBase64) {
      skipped++;
      continue;
    }
    const bytes = base64ToBytes(dependency.dataBase64);
    if (!bytes || bytes.byteLength > MAX_CLIPBOARD_FONT_BYTES) {
      skipped++;
      continue;
    }
    const reference = dependency.fontReference;
    const metadata = {
      providerId: 'clipboard',
      artifactHash: reference.artifactHash,
      collectionIndex: reference.collectionIndex,
      faceKey: fontReferenceKey(reference),
      ...(dependency.postScriptName ? { postScriptName: dependency.postScriptName } : {}),
    };
    try {
      const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      await storeFontOnFilesystem(dependency.family, buffer, metadata);
      const result = await loader.restoreFont(dependency.family, buffer, metadata);
      if (result.success) restored++;
      else skipped++;
    } catch {
      skipped++;
    }
  }
  return { restored, skipped };
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

function validFrameGuideLayouts(value: unknown, nodeIds: ReadonlySet<string>): boolean {
  if (value === undefined) return true;
  if (!isRecord(value) || Object.keys(value).length > MAX_CLIPBOARD_NODES) return false;
  for (const [ownerId, entries] of Object.entries(value)) {
    if (!nodeIds.has(ownerId) || !Array.isArray(entries) || entries.length > 32) return false;
    for (const entry of entries) {
      if (!isRecord(entry) || entry.type !== 'layout' || entry.frameId !== ownerId) return false;
      if (typeof entry.id !== 'string' || entry.id.length === 0 || entry.id.length > 256)
        return false;
      if (!finitePayload(entry)) return false;
    }
  }
  return true;
}

function validClipboardFontReference(value: unknown): value is FontReference {
  if (!isRecord(value) || typeof value.artifactHash !== 'string') return false;
  if (!/^[0-9a-f]{64}$/i.test(value.artifactHash)) return false;
  return (
    value.collectionIndex === undefined ||
    (typeof value.collectionIndex === 'number' &&
      Number.isInteger(value.collectionIndex) &&
      value.collectionIndex >= 0)
  );
}

function validClipboardFontDependencies(value: unknown): value is ClipboardFontDependency[] {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > MAX_CLIPBOARD_FONT_DEPENDENCIES) return false;
  let totalBytes = 0;
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      typeof candidate.family !== 'string' ||
      candidate.family.length > 512
    ) {
      return false;
    }
    if (
      candidate.fontReference !== undefined &&
      !validClipboardFontReference(candidate.fontReference)
    ) {
      return false;
    }
    if (
      !['embedded', 'metadata-only', 'missing', 'restricted'].includes(String(candidate.status))
    ) {
      return false;
    }
    if (candidate.dataBase64 !== undefined) {
      if (
        typeof candidate.dataBase64 !== 'string' ||
        candidate.dataBase64.length > Math.ceil((MAX_CLIPBOARD_FONT_BYTES * 4) / 3) + 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          candidate.dataBase64,
        )
      ) {
        return false;
      }
      const bytes = base64ToBytes(candidate.dataBase64);
      if (!bytes) return false;
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_CLIPBOARD_FONT_BYTES) return false;
    }
    if (!finitePayload(candidate)) return false;
  }
  return true;
}

function validClipboardFontManifest(value: unknown): value is Document['fontManifest'] {
  if (value === undefined) return true;
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2)) return false;
  return Array.isArray(value.fonts) && value.fonts.length <= MAX_CLIPBOARD_FONT_DEPENDENCIES;
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
    !validClipboardFontManifest(raw.fontManifest) ||
    !validClipboardFontDependencies(raw.fontDependencies)
  ) {
    return null;
  }
  if (
    raw.format !== undefined &&
    (raw.format !== VARVE_CLIPBOARD_FORMAT ||
      (raw.version !== LEGACY_CLIPBOARD_VERSION &&
        raw.version !== 2 &&
        raw.version !== VARVE_CLIPBOARD_VERSION))
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
  const dependencyIds = raw.dependencyIds;
  if (
    dependencyIds !== undefined &&
    (!Array.isArray(dependencyIds) ||
      dependencyIds.some((id) => typeof id !== 'string' || !ids.has(id)) ||
      new Set(dependencyIds).size !== dependencyIds.length ||
      (Array.isArray(rootIds) && dependencyIds.some((id) => rootIds.includes(id))))
  ) {
    return null;
  }
  if (
    !validResourceMap(raw.depthMaps) ||
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
    !validResourceMap(raw.motionPresets) ||
    !validFrameGuideLayouts(raw.frameGuideLayouts, ids)
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
              : raw.version === 2
                ? 2
                : LEGACY_CLIPBOARD_VERSION,
        }
      : {}),
    ...(typeof raw.sourceDocumentId === 'string' ? { sourceDocumentId: raw.sourceDocumentId } : {}),
    nodes,
    ...(rootIds ? { rootIds: [...rootIds] } : {}),
    ...(dependencyIds ? { dependencyIds: [...dependencyIds] } : {}),
    ...(isRecord(raw.depthMaps) ? { depthMaps: raw.depthMaps as ClipboardData['depthMaps'] } : {}),
    ...(validClipboardFontManifest(raw.fontManifest)
      ? { fontManifest: raw.fontManifest as ClipboardData['fontManifest'] }
      : {}),
    ...(Array.isArray(raw.fontDependencies)
      ? { fontDependencies: raw.fontDependencies as ClipboardFontDependency[] }
      : {}),
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
    ...(isRecord(raw.frameGuideLayouts)
      ? { frameGuideLayouts: raw.frameGuideLayouts as ClipboardData['frameGuideLayouts'] }
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
  dependencyIds?: string[],
  depthMaps?: Record<string, DepthMapResource>,
  fontManifest?: Document['fontManifest'],
  fontDependencies?: ClipboardFontDependency[],
  frameGuideLayouts?: Record<string, LayoutGrid[]>,
): string {
  const data: ClipboardData = {
    format: VARVE_CLIPBOARD_FORMAT,
    version: VARVE_CLIPBOARD_VERSION,
    ...(sourceDocumentId ? { sourceDocumentId } : {}),
    nodes: nodes.map(serializeClipboardNode),
    ...(rootIds && rootIds.length > 0 ? { rootIds: [...rootIds] } : {}),
    ...(dependencyIds && dependencyIds.length > 0 ? { dependencyIds: [...dependencyIds] } : {}),
    ...(depthMaps && Object.keys(depthMaps).length > 0 ? { depthMaps } : {}),
    ...(fontManifest ? { fontManifest } : {}),
    ...(fontDependencies && fontDependencies.length > 0 ? { fontDependencies } : {}),
    ...(rasterMaskAssets && Object.keys(rasterMaskAssets).length > 0 ? { rasterMaskAssets } : {}),
    ...(assets && Object.keys(assets).length > 0 ? { assets } : {}),
    ...(iconAssets && Object.keys(iconAssets).length > 0 ? { iconAssets } : {}),
    ...(mockupTemplates && Object.keys(mockupTemplates).length > 0 ? { mockupTemplates } : {}),
    ...(worldAnchor && Object.keys(worldAnchor).length > 0 ? { worldAnchor } : {}),
    ...(frameGuideLayouts && Object.keys(frameGuideLayouts).length > 0
      ? { frameGuideLayouts }
      : {}),
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
  dependencyIds?: string[],
  depthMaps?: Record<string, DepthMapResource>,
  fontManifest?: Document['fontManifest'],
  frameGuideLayouts?: Record<string, LayoutGrid[]>,
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
      dependencyIds,
      depthMaps,
      fontManifest,
      frameGuideLayouts,
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
  dependencyIds?: string[],
  depthMaps?: Record<string, DepthMapResource>,
  fontManifest?: Document['fontManifest'],
  frameGuideLayouts?: Record<string, LayoutGrid[]>,
): Promise<ClipboardWriteOutcome> {
  const isCurrentWrite = (): boolean =>
    generation === undefined || generation === latestClipboardWrite;
  if (!isCurrentWrite()) return { status: 'failed', reason: 'write-failed' };
  let json: string;
  try {
    const fontDependencies = await prepareClipboardFontDependencies(nodes, styles, fontManifest);
    if (!isCurrentWrite()) return { status: 'failed', reason: 'write-failed' };
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
      dependencyIds,
      depthMaps,
      fontManifest,
      fontDependencies,
      frameGuideLayouts,
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
  const text =
    rootIds && rootIds.length > 0
      ? rootIds
          .map((id) => nodes.find((node) => node.id === id)?.name)
          .filter((name): name is string => Boolean(name))
          .join('\n')
      : nodes.map((n) => n.name).join('\n');
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
    await navigator.clipboard.writeText(text);
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
  dependencyIds?: string[],
  depthMaps?: Record<string, DepthMapResource>,
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
        dependencyIds,
        depthMaps,
      )
    ).status === 'editable'
  );
}

function createClipboardResult(): UnifiedClipboardResult {
  return { varveData: null, importItems: [] };
}

async function hydrateClipboardFonts(
  result: UnifiedClipboardResult,
): Promise<UnifiedClipboardResult> {
  if (result.varveData?.fontDependencies) {
    await restoreClipboardFontDependencies(result.varveData.fontDependencies);
  }
  return result;
}

function isSvgText(text: string): boolean {
  return /^(?:\uFEFF|\s|<!--(?:[\s\S]*?)-->)*(?:<\?xml\b[^>]*>\s*)?(?:<!--(?:[\s\S]*?)-->\s*)*<svg(?:\s|>)/i.test(
    text,
  );
}

function hasRichClipboardContent(result: UnifiedClipboardResult): boolean {
  return Boolean(result.varveData || result.importItems.length > 0 || result.htmlText);
}

/** Extract one local SVG element from HTML clipboard data without executing or
 * fetching anything. The SVG still goes through the bounded SVG importer. */
function extractSvgFromHtml(html: string): string | null {
  if (!/<svg\b/i.test(html) || typeof DOMParser === 'undefined') return null;
  try {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const svg = document.querySelector('svg');
    if (!svg || typeof XMLSerializer === 'undefined') return null;
    const serialized = new XMLSerializer().serializeToString(svg);
    return isSvgText(serialized) ? serialized : null;
  } catch {
    return null;
  }
}

function addSvgItem(
  result: UnifiedClipboardResult,
  data: string,
  name: string,
  dedupe = true,
): void {
  // A single clipboard item can expose SVG through several equivalent MIME
  // representations (string MIME, HTML, and a file). Those alternatives are
  // one logical item and should be deduplicated. Separate ClipboardItem
  // entries, however, are distinct user content even when their bytes happen
  // to be identical, so the async Clipboard API can opt out of this check.
  if (
    dedupe &&
    result.importItems.some(
      (item) =>
        item.mimeType === 'image/svg+xml' && typeof item.data === 'string' && item.data === data,
    )
  ) {
    return;
  }
  addImageItem(result, data, 'image/svg+xml', name);
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
        // ClipboardItem boundaries are logical item boundaries. Do not merge
        // two separately copied, byte-identical SVGs into one pasted layer.
        addSvgItem(result, text, `clipboard-${itemIndex}.svg`, false);
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
        addSvgItem(result, text, `clipboard-${itemIndex}.svg`);
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
      if (html) {
        const bounded = html.slice(0, 4 * 1024 * 1024);
        result.htmlText ??= bounded;
        const svg = extractSvgFromHtml(bounded);
        if (svg) addSvgItem(result, svg, `clipboard-${itemIndex}.svg`);
      }
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
  return hydrateClipboardFonts(result);
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
  return hydrateClipboardFonts(await readClipboardSnapshot(snapshotClipboardData(dt)));
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
  if (snapshot.svgText) addSvgItem(result, snapshot.svgText, 'clipboard.svg');
  if (snapshot.htmlText) {
    const svg = extractSvgFromHtml(snapshot.htmlText);
    if (svg) addSvgItem(result, svg, 'clipboard-html.svg');
  }
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
  // Some Chromium builds expose only text to the DOM ClipboardEvent for a
  // custom `web ` MIME item, even though the async Clipboard API can read the
  // rich payload. Prefer the event snapshot when it contains artwork, but
  // fall through when it is text-only instead of turning an editable copy
  // into a pasted text layer.
  const eventResult = eventSnapshot ? await readClipboardSnapshot(eventSnapshot) : null;
  if (eventResult && hasRichClipboardContent(eventResult)) {
    return hydrateClipboardFonts(eventResult);
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
          if (parsed) return hydrateClipboardFonts({ varveData: parsed, importItems: [] });
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
