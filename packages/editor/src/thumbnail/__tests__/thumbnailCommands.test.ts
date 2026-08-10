import type { Platform, ThumbnailSourcePreference } from '@varve/platform';
import { createMemoryPlatform } from '@varve/platform';
import { createDocument, makeShapeNode } from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getActionRegistry, resetActionRegistryForTesting } from '../../actions/ActionRegistry';
import type { EditorContextValue } from '../../context';
import { setThumbnailSchedulerForTest } from '../scheduler';
import {
  applyThumbnailPreference,
  registerThumbnailActions,
  THUMBNAIL_ACTION_IDS,
} from '../thumbnailCommands';

function editorLike(platform: Platform) {
  const doc = createDocument('pages');
  const page = doc.pages?.[0];
  const rect = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
  doc.nodes[rect.id] = rect;
  const root = doc.nodes[page?.contentRoot as string] as { children: string[] };
  root.children.push(rect.id);
  return {
    state: {
      document: doc,
      selection: ['n1'],
      activeId: 's1',
      sessions: [{ id: 's1', fileId: 'f1' }],
    },
    platform,
    showToast: vi.fn(),
  };
}

describe('thumbnail commands', () => {
  afterEach(() => {
    resetActionRegistryForTesting();
    setThumbnailSchedulerForTest(null);
  });

  it('registers every thumbnail action idempotently', () => {
    const platform = createMemoryPlatform();
    const editor = editorLike(platform) as unknown as EditorContextValue;
    registerThumbnailActions(editor);
    registerThumbnailActions(editor);
    for (const id of Object.values(THUMBNAIL_ACTION_IDS)) {
      expect(getActionRegistry().get(id)).toBeDefined();
    }
  });

  it('persists the preference on the file entry and warns without a file id', async () => {
    const platform = createMemoryPlatform();
    await platform.upsertFile(
      {
        id: 'f1',
        name: 'Design',
        kind: 'strata',
        projectId: null,
        createdAt: 1,
        updatedAt: 1,
        openedAt: 1,
        size: 10,
        pinned: false,
        trashedAt: null,
        ordering: '',
        contentHash: 'abc12345',
      },
      '{}',
    );
    const editor = editorLike(platform);
    const preference: ThumbnailSourcePreference = { type: 'frame', nodeId: 'n1' };
    applyThumbnailPreference(
      {
        platform,
        document: editor.state.document,
        selection: ['n1'],
        fileId: 'f1',
        showToast: editor.showToast,
      },
      preference,
      'ok',
    );
    await vi.waitFor(async () => {
      const entry = await platform.getFile('f1');
      expect(entry?.thumbnailPreference).toEqual(preference);
    });
    expect(editor.showToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('refuses to apply without a saved file id', () => {
    const platform = createMemoryPlatform();
    const editor = editorLike(platform);
    applyThumbnailPreference(
      {
        platform,
        document: editor.state.document,
        selection: ['n1'],
        fileId: undefined,
        showToast: editor.showToast,
      },
      { type: 'automatic' },
      'ok',
    );
    expect(editor.showToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
  });
});
