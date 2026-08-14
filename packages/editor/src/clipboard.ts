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
import type { DocumentAsset, DocumentIconAsset, RasterMaskAsset, SceneNode } from '@varve/scene';
import type { Affine } from '@varve/shared';

const VARVE_MIME = 'application/vnd.varve+json';
const LEGACY_MIME = 'application/vnd.strata+json';

export interface ClipboardData {
  nodes: SceneNode[];
  rasterMaskAssets?: Record<string, RasterMaskAsset>;
  assets?: Record<string, DocumentAsset>;
  iconAssets?: Record<string, DocumentIconAsset>;
  /**
   * Placed-world transform of each copied selection root, keyed by the
   * node's ORIGINAL id. Optional and forward-compatible: clipboard payloads
   * without it (old copies, foreign writers) paste with legacy semantics
   * (source local coordinates preserved verbatim).
   *
   * When present, paste converts through world space:
   *   newLocal = targetParentWorld⁻¹ · anchor
   * so a child copied from inside artboard A lands at the same WORLD pose
   * after pasting into artboard B (or at the document top level) instead of
   * being reinterpreted in the destination's local frame.
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
}

export async function writeClipboard(
  nodes: SceneNode[],
  rasterMaskAssets?: Record<string, RasterMaskAsset>,
  assets?: Record<string, DocumentAsset>,
  iconAssets?: Record<string, DocumentIconAsset>,
  worldAnchor?: Record<string, Affine>,
): Promise<boolean> {
  try {
    const data: ClipboardData = {
      nodes,
      ...(rasterMaskAssets && Object.keys(rasterMaskAssets).length > 0 ? { rasterMaskAssets } : {}),
      ...(assets && Object.keys(assets).length > 0 ? { assets } : {}),
      ...(iconAssets && Object.keys(iconAssets).length > 0 ? { iconAssets } : {}),
      ...(worldAnchor && Object.keys(worldAnchor).length > 0 ? { worldAnchor } : {}),
    };
    const json = JSON.stringify(data);
    const blob = new Blob([json], { type: VARVE_MIME });
    const textBlob = new Blob([nodes.map((n) => n.name).join('\n')], { type: 'text/plain' });
    await navigator.clipboard.write([
      new ClipboardItem({
        [VARVE_MIME]: blob,
        [LEGACY_MIME]: blob,
        'text/plain': textBlob,
      }),
    ]);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(JSON.stringify(nodes.map((n) => n.name)));
      return true;
    } catch {
      return false;
    }
  }
}

export async function readClipboard(): Promise<ClipboardData | null> {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const mime = item.types.find((t) => t === VARVE_MIME || t === LEGACY_MIME);
      if (mime) {
        const blob = await item.getType(mime);
        const text = await blob.text();
        const parsed = JSON.parse(text) as ClipboardData;
        if (parsed.nodes && Array.isArray(parsed.nodes)) {
          return parsed;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Single clipboard read that returns both Strata JSON data and importable
 * items (SVG text, images) with raw data in the correct format.
 *
 * SVG is returned as raw text (not URL-encoded) so the SVG parser
 * receives valid XML. Images are returned as Uint8Array bytes so
 * importImageAsFile can process them.
 */
export async function readClipboardUnified(): Promise<UnifiedClipboardResult> {
  const result: UnifiedClipboardResult = { varveData: null, importItems: [] };
  // A single logical image is often exposed under more than one ClipboardItem
  // or MIME type (seen in practice on Linux/Wayland clipboard proxies) —
  // dedupe by name so one paste doesn't produce duplicate nodes.
  const seenNames = new Set<string>();
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (type === VARVE_MIME || type === LEGACY_MIME) {
          const blob = await item.getType(type);
          const text = await blob.text();
          const parsed = JSON.parse(text) as ClipboardData;
          if (parsed.nodes && Array.isArray(parsed.nodes)) {
            result.varveData = parsed;
          }
        } else if (type.startsWith('image/') && type !== 'image/svg+xml') {
          const name = `clipboard.${type.split('/')[1] ?? 'png'}`;
          if (seenNames.has(name)) continue;
          seenNames.add(name);
          const blob = await item.getType(type);
          const buffer = await blob.arrayBuffer();
          result.importItems.push({
            data: new Uint8Array(buffer),
            mimeType: type,
            name,
          });
        } else if (type === 'image/svg+xml' || type === 'text/svg+xml' || type === 'text/plain') {
          if (seenNames.has('clipboard.svg')) continue;
          const blob = await item.getType(type);
          const text = await blob.text();
          if (text.trim().startsWith('<svg') || text.trim().startsWith('<?xml')) {
            seenNames.add('clipboard.svg');
            result.importItems.push({
              data: text,
              mimeType: 'image/svg+xml',
              name: 'clipboard.svg',
            });
          }
        }
      }
    }
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
  const result: UnifiedClipboardResult = { varveData: null, importItems: [] };
  const dt = event.clipboardData;
  if (!dt) return result;

  // Try reading Varve JSON from clipboard data
  try {
    const varveDataStr = dt.getData('application/vnd.strata+json');
    if (varveDataStr) {
      const parsed = JSON.parse(varveDataStr) as ClipboardData;
      if (parsed.nodes && Array.isArray(parsed.nodes)) {
        result.varveData = parsed;
      }
    }
  } catch {
    // ignore parse errors
  }

  const seenNames = new Set<string>();

  // Helper: process a File from the clipboard into an import item
  async function processFile(file: File): Promise<void> {
    const type = file.type;
    if (!type.startsWith('image/')) return;
    const name = file.name || `clipboard.${type.split('/')[1] ?? 'png'}`;
    if (seenNames.has(name)) return;
    seenNames.add(name);

    if (type === 'image/svg+xml') {
      try {
        const text = await file.text();
        result.importItems.push({ data: text, mimeType: 'image/svg+xml', name });
      } catch {
        // skip unreadable SVG
      }
    } else {
      try {
        const buffer = await file.arrayBuffer();
        result.importItems.push({
          data: new Uint8Array(buffer),
          mimeType: type,
          name,
        });
      } catch {
        // skip unreadable image
      }
    }
  }

  // Priority 1: clipboardData.files (cross-platform, always available)
  const filePromises: Promise<void>[] = [];
  for (let i = 0; i < dt.files.length; i++) {
    const file = dt.files[i];
    if (file) filePromises.push(processFile(file));
  }

  // Priority 2: clipboardData.items (getAsFile for items not in files)
  for (let i = 0; i < dt.items.length; i++) {
    const item = dt.items[i];
    if (item?.kind !== 'file') continue;
    // Skip if already captured via files
    const file = item.getAsFile();
    if (file && !seenNames.has(file.name || `item-${i}`)) {
      filePromises.push(processFile(file));
    }
  }

  await Promise.allSettled(filePromises);
  return result;
}

/**
 * Module-level reference to the last paste event, captured by
 * the native paste listener in Shell. Used as a fallback when
 * `navigator.clipboard.read()` fails (common on Wayland).
 */
let capturedPasteEvent: ClipboardEvent | null = null;

/** Capture a paste event for later use by the paste action. */
export function captureClipboardEvent(event: ClipboardEvent): void {
  capturedPasteEvent = event;
}

/** Clear the captured paste event (e.g. after consuming it). */
export function clearCapturedClipboardEvent(): void {
  capturedPasteEvent = null;
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
  platform?: Pick<Platform, 'kind' | 'readClipboardImage'>,
): Promise<UnifiedClipboardResult> {
  const apiResult = await readClipboardUnified();
  if (apiResult.varveData || apiResult.importItems.length > 0) {
    clearCapturedClipboardEvent();
    return apiResult;
  }
  if (capturedPasteEvent) {
    const event = capturedPasteEvent;
    capturedPasteEvent = null;
    const eventResult = await readFromClipboardEvent(event);
    if (eventResult.varveData || eventResult.importItems.length > 0) {
      return eventResult;
    }
  }
  if (platform?.kind === 'tauri') {
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
  return apiResult;
}
