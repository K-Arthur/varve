/** @vitest-environment jsdom */
/**
 * Regression coverage for the autosave/recovery wiring: an untitled
 * autosave must persist exactly one full recovery point per cycle.
 */

import { act, renderHook } from '@testing-library/react';
import type { Platform } from '@varve/platform';
import type { Document } from '@varve/scene';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPersistenceRevision } from '../../persistence/documentRevision';
import type { EditorState } from '../types';
import { useAutoBackupServices } from '../useAutoBackupServices';

const createRecoveryPoint = vi.fn().mockResolvedValue(undefined);

vi.mock('../../recovery', () => ({
  getSharedRecoveryManager: () => ({ createRecoveryPoint }),
}));

vi.mock('../../components/Settings/settings', () => ({
  loadSettings: () => ({ general: { autosaveInterval: 5 } }),
}));

vi.mock('../../backupService', () => ({
  BackupService: class {
    initialize = vi.fn().mockResolvedValue(undefined);
    shutdown = vi.fn().mockResolvedValue(undefined);
    markSaved = vi.fn().mockResolvedValue(undefined);
  },
}));

function makePlatform(): Platform {
  return {
    getFile: vi.fn().mockResolvedValue(undefined),
    upsertFile: vi.fn().mockResolvedValue(undefined),
  } as unknown as Platform;
}

function makeStateRef(fileId?: string) {
  const document = {
    formatVersion: '1.0',
    id: 'doc-test',
    name: 'test',
    rootChildren: [],
    nodes: {},
    components: {},
    nextId: 1,
  } as unknown as Document;
  return {
    current: {
      document,
      sessions: [{ id: 'session-1', name: 'Untitled', fileId }],
      activeId: 'session-1',
    } as unknown as EditorState,
  };
}

function makeRevision(stateRef: ReturnType<typeof makeStateRef>) {
  const state = stateRef.current;
  const meta = state.sessions[0] as { id: string; name: string; fileId?: string };
  return createPersistenceRevision({
    sessionId: meta.id,
    projectId: meta.fileId ?? meta.id,
    fileId: meta.fileId,
    fileName: meta.name,
    revision: 1,
    document: state.document,
  });
}

describe('useAutoBackupServices recovery writes', () => {
  beforeEach(() => {
    createRecoveryPoint.mockClear();
  });

  it('writes exactly one recovery point for an untitled autosave', async () => {
    const platform = makePlatform();
    const stateRef = makeStateRef();
    const { result, unmount } = renderHook(() => useAutoBackupServices(platform, stateRef));

    await act(async () => {
      result.current.autoSaveRef.current?.notifyEdit(makeRevision(stateRef));
      await result.current.autoSaveRef.current?.saveNow();
    });

    expect(createRecoveryPoint).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('persists a file-backed autosave and still writes one recovery point', async () => {
    const platform = makePlatform();
    const stateRef = makeStateRef('file-1');
    const { result, unmount } = renderHook(() => useAutoBackupServices(platform, stateRef));

    await act(async () => {
      result.current.autoSaveRef.current?.notifyEdit(makeRevision(stateRef));
      await result.current.autoSaveRef.current?.saveNow();
    });

    expect(platform.upsertFile).toHaveBeenCalledTimes(1);
    expect(createRecoveryPoint).toHaveBeenCalledTimes(1);
    expect(createRecoveryPoint.mock.calls[0]?.[2]).toBe('file-1');
    unmount();
  });
});
