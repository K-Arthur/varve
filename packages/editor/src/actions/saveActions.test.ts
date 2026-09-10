import { describe, expect, it, vi } from 'vitest';
import type { EditorContextValue } from '../context';
import { createActionHandlers } from './createActionHandlers';

function makeEditor(overrides: Partial<EditorContextValue> = {}): EditorContextValue {
  return {
    state: {
      sessions: [
        { id: 'session-1', name: 'Poster', dirty: true, filePath: '/home/u/Poster.varve' },
      ],
      activeId: 'session-1',
    },
    saveCopy: vi.fn(async () => true),
    setShowDocumentInfo: vi.fn(),
    platform: {
      revealInFileManager: vi.fn(async () => undefined),
      fileManagerLabel: () => 'Reveal in Files',
    },
    ...overrides,
  } as unknown as EditorContextValue;
}

describe('createActionHandlers — save actions', () => {
  it('saveCopy delegates to the editor save-copy coordinator', () => {
    const e = makeEditor();
    const handlers = createActionHandlers(e, {});
    handlers.saveCopy?.();
    expect(e.saveCopy).toHaveBeenCalledTimes(1);
  });

  it('documentInfo opens the Document Info surface', () => {
    const e = makeEditor();
    const handlers = createActionHandlers(e, {});
    handlers.documentInfo?.();
    expect(e.setShowDocumentInfo).toHaveBeenCalledWith(true);
  });

  it('revealInFiles reveals the active session path', () => {
    const e = makeEditor();
    const handlers = createActionHandlers(e, {});
    handlers.revealInFiles?.();
    expect(e.platform?.revealInFileManager).toHaveBeenCalledWith('/home/u/Poster.varve');
  });

  it('revealInFiles is a no-op when the active session has no path', () => {
    const e = makeEditor({
      state: { sessions: [{ id: 's', name: 'Untitled', dirty: true }], activeId: 's' } as never,
    });
    const handlers = createActionHandlers(e, {});
    handlers.revealInFiles?.();
    expect(e.platform?.revealInFileManager).not.toHaveBeenCalled();
  });
});
