/**
 * @strata/platform — browser DOM helpers for file-system access and clipboard.
 *
 * Bridges the WICG File System Access API (Chromium) with a fallback to
 * `<input type=file>` / Blob download for Firefox and Safari. Clipboard
 * access uses the Web Clipboard API.
 */
import { contentHash, detectFileKind, stripExtension, uuid } from './pure';
import type { FileEntry, OpenFileResult } from './types';

// COMPLEXITY: 20

interface WindowWithFsAccess {
  showOpenFilePicker?: (opts: {
    multiple?: boolean;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }) => Promise<Array<FileSystemFileHandle>>;
  showSaveFilePicker?: (opts: {
    suggestedName?: string;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle>;
}

export function getWindow(): (Window & WindowWithFsAccess) | undefined {
  return typeof window !== 'undefined' ? (window as Window & WindowWithFsAccess) : undefined;
}

export const STRATA_ACCEPT = [
  { description: 'Strata document', accept: { 'application/json': ['.strata'] } },
];

export function ingestFile(filename: string, text: string): OpenFileResult {
  const name = stripExtension(filename);
  const now = Date.now();
  const entry: FileEntry = {
    id: uuid(),
    name,
    kind: detectFileKind(filename),
    projectId: null,
    createdAt: now,
    updatedAt: now,
    openedAt: now,
    size: text.length,
    pinned: false,
    trashedAt: null,
    ordering: '',
    contentHash: contentHash(text),
  };
  return { entry, documentJson: text };
}

export async function capturePlaceholder(
  filename: string,
  text: string,
  kind: ReturnType<typeof detectFileKind>,
): Promise<FileEntry> {
  const name = stripExtension(filename);
  const now = Date.now();
  return {
    id: uuid(),
    name,
    kind,
    projectId: null,
    createdAt: now,
    updatedAt: now,
    openedAt: 0,
    size: text.length,
    pinned: false,
    trashedAt: null,
    ordering: '',
    contentHash: contentHash(text),
  };
}

export function pickViaInput(extensions: string[]): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = extensions.join(',');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';
    let settled = false;
    const cleanup = () => {
      input.remove();
      window.removeEventListener('focus', onFocus);
    };
    const onFocus = () => {
      setTimeout(() => {
        if (!settled) {
          cleanup();
          resolve(null);
        }
      }, 300);
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        settled = true;
        cleanup();
        resolve(null);
        return;
      }
      settled = true;
      cleanup();
      file.text().then((text) => resolve({ name: file.name, text }));
    });
    document.body.appendChild(input);
    input.click();
    window.addEventListener('focus', onFocus, { once: true });
  });
}

export async function readClipboardImage(): Promise<Uint8Array | null> {
  const clipboard = navigator.clipboard;
  if (!clipboard || typeof clipboard.read !== 'function') return null;
  try {
    for (const item of await clipboard.read()) {
      const imageType = item.types.find((type) => type.startsWith('image/'));
      if (!imageType) continue;
      return new Uint8Array(await (await item.getType(imageType)).arrayBuffer());
    }
  } catch {}
  return null;
}
