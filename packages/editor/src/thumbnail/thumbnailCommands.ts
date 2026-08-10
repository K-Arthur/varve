/**
 * Thumbnail commands — the action layer for choosing what represents a file.
 *
 * Every command resolves the current document + selection + active file,
 * persists the source preference on the FileEntry (survives restarts), and
 * regenerates the canonical thumbnail through the shared scheduler. All
 * commands are registered in the action registry, so they are reachable
 * from the command palette (keyboard) and every menu surface.
 */

import type { Platform, ThumbnailSourcePreference } from '@varve/platform';
import { THUMBNAIL_VARIANTS } from '@varve/shared';
import { getActionRegistry } from '../actions/ActionRegistry';
import type { EditorContextValue } from '../context';
import { persistProjectThumbnail, preferenceToSource } from './thumbnailManager';
import { openThumbnailPicker } from './thumbnailPickerBridge';
import { renderDocThumbnail } from './thumbnailService';

export const THUMBNAIL_ACTION_IDS = {
  useSelection: 'setThumbnailFromSelection',
  usePage: 'setThumbnailFromPage',
  useFrame: 'setThumbnailFromFrame',
  openPicker: 'openThumbnailPicker',
  reset: 'resetFileThumbnail',
} as const;

export interface ThumbnailCommandContext {
  platform: Platform;
  document: EditorContextValue['state']['document'];
  selection: string[];
  fileId?: string;
  activePageId?: string;
  showToast: (opts: { message: string; type?: 'info' | 'success' | 'warning' | 'error' }) => void;
}

/** Apply a preference: persist it and regenerate the canonical thumbnail. */
export function applyThumbnailPreference(
  ctx: ThumbnailCommandContext,
  preference: ThumbnailSourcePreference,
  successMessage: string,
): void {
  const { platform, document, fileId, showToast } = ctx;
  if (!fileId) {
    showToast({
      message: 'Save the file once before choosing a thumbnail',
      type: 'warning',
    });
    return;
  }
  void platform
    .setThumbnailPreference(fileId, preference)
    .then(() => {
      persistProjectThumbnail(platform, document, {
        fileId,
        preference,
        priority: 'current-doc',
      });
      showToast({ message: successMessage, type: 'success' });
    })
    .catch(() => {
      showToast({ message: 'Could not save thumbnail choice', type: 'error' });
    });
}

/** Resolve the active file id from the editor context. */
export function activeFileId(ctx: Pick<EditorContextValue, 'state'>): string | undefined {
  return ctx.state.sessions.find((s) => s.id === ctx.state.activeId)?.fileId;
}

/**
 * Build the command context from the live editor. `selection` is the node id
 * list; the document is the current scene.
 */
export function commandContextFromEditor(
  ctx: Pick<EditorContextValue, 'state' | 'platform' | 'showToast'>,
): ThumbnailCommandContext | null {
  if (!ctx.platform) return null;
  return {
    platform: ctx.platform,
    document: ctx.state.document,
    selection: ctx.state.selection,
    fileId: activeFileId(ctx),
    activePageId: ctx.state.document.activePageId,
    showToast: (opts) => ctx.showToast(opts),
  };
}

function register(id: string, label: string, handler: () => void): void {
  const r = getActionRegistry();
  if (!r.has(id)) {
    r.register({ id, label, category: 'file' }, handler);
  }
}

/**
 * Register all thumbnail commands against the action registry.
 * Called from `registerEditorActions`; idempotent.
 */
export function registerThumbnailActions(
  ctx: Pick<EditorContextValue, 'state' | 'platform' | 'showToast'>,
): void {
  register(THUMBNAIL_ACTION_IDS.openPicker, 'Set File Thumbnail…', () => {
    openThumbnailPicker();
  });

  register(THUMBNAIL_ACTION_IDS.useSelection, 'Use Selection as File Thumbnail', () => {
    const c = commandContextFromEditor(ctx);
    if (!c) return;
    if (c.selection.length === 0) {
      c.showToast({ message: 'Select design content first', type: 'warning' });
      return;
    }
    applyThumbnailPreference(
      c,
      { type: 'selection', nodeIds: c.selection },
      'File thumbnail now shows the selection',
    );
  });

  register(THUMBNAIL_ACTION_IDS.usePage, 'Use Current Page as File Thumbnail', () => {
    const c = commandContextFromEditor(ctx);
    if (!c?.activePageId) return;
    applyThumbnailPreference(
      c,
      { type: 'page', pageId: c.activePageId },
      'File thumbnail now shows the current page',
    );
  });

  register(THUMBNAIL_ACTION_IDS.useFrame, 'Use Frame as File Thumbnail', () => {
    const c = commandContextFromEditor(ctx);
    if (!c) return;
    if (c.selection.length !== 1) {
      c.showToast({ message: 'Select exactly one frame', type: 'warning' });
      return;
    }
    const node = c.document.nodes[c.selection[0]!];
    if (!node || (node.kind !== 'frame' && node.kind !== 'group')) {
      c.showToast({ message: 'Select a frame first', type: 'warning' });
      return;
    }
    applyThumbnailPreference(
      c,
      { type: 'frame', nodeId: c.selection[0]! },
      'File thumbnail now shows the frame',
    );
  });

  register(THUMBNAIL_ACTION_IDS.reset, 'Reset File Thumbnail to Automatic', () => {
    const c = commandContextFromEditor(ctx);
    if (!c) return;
    applyThumbnailPreference(c, { type: 'automatic' }, 'File thumbnail is automatic again');
  });
}

/** Preview a source without persisting (picker dialogs, tests). */
export async function previewThumbnailSource(
  _platform: Platform,
  document: EditorContextValue['state']['document'],
  source: ThumbnailSourcePreference,
  fileId?: string,
): Promise<string | null> {
  const outcome = await renderDocThumbnail(document, {
    fileId,
    source: preferenceToSource(source),
    variant: THUMBNAIL_VARIANTS['picker-preview'],
  });
  return outcome.result?.dataUrl ?? null;
}
