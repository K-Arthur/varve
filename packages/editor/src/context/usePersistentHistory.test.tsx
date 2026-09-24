import { act, renderHook, waitFor } from '@testing-library/react';
import { createDocument } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { EditorHistorySession } from '../history/editorHistorySession';
import { usePersistentHistory } from './usePersistentHistory';

describe('persistent history session isolation', () => {
  it('uses session history when IndexedDB denies access during attach', async () => {
    const document = createDocument('Private browser', true);
    const originalAttach = EditorHistorySession.prototype.attach;
    let attempts = 0;
    const attach = vi
      .spyOn(EditorHistorySession.prototype, 'attach')
      .mockImplementation(async function (this: EditorHistorySession, current) {
        attempts++;
        if (attempts === 1) throw new DOMException('Storage blocked', 'SecurityError');
        return originalAttach.call(this, current);
      });
    try {
      const { result } = renderHook(() =>
        usePersistentHistory({
          document,
          selection: [],
          patch: vi.fn(),
          inTransactionRef: { current: false },
          historySkipRef: { current: false },
        }),
      );
      await waitFor(() => expect(result.current.attached).toBe(true));
      expect(attempts).toBe(2);
      expect(result.current.session?.attached).toBe(true);
      expect(result.current.attachIssues).toEqual([]);
    } finally {
      attach.mockRestore();
    }
  });

  it('retains an edit made while persistent history is attaching', async () => {
    const first = createDocument('Before', true);
    const edited = { ...first, name: 'Edited during attach' };
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const originalAttach = EditorHistorySession.prototype.attach;
    const attach = vi
      .spyOn(EditorHistorySession.prototype, 'attach')
      .mockImplementation(async function (this: EditorHistorySession, document) {
        await pending;
        return originalAttach.call(this, document);
      });
    const inTransactionRef = { current: false };
    const historySkipRef = { current: false };
    const { result, rerender } = renderHook(
      ({ document }) =>
        usePersistentHistory({
          document,
          selection: [],
          patch: vi.fn(),
          inTransactionRef,
          historySkipRef,
        }),
      { initialProps: { document: first } },
    );
    try {
      await waitFor(() => expect(attach).toHaveBeenCalledOnce());
      rerender({ document: edited });
      await act(async () => {
        finish();
        await pending;
      });
      await waitFor(() => expect(result.current.attached).toBe(true));
      await waitFor(async () => expect(await result.current.steps()).toHaveLength(2));
      const undo = await result.current.session!.undo();
      expect(undo!.document.name).toBe('Before');
    } finally {
      attach.mockRestore();
    }
  });

  it('does not capture a previous document into the next session after a late attach', async () => {
    const first = createDocument('First', true);
    const edited = { ...first, name: 'Edited while attaching' };
    const second = createDocument('Second', true);
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const originalAttach = EditorHistorySession.prototype.attach;
    const attach = vi
      .spyOn(EditorHistorySession.prototype, 'attach')
      .mockImplementation(async function (this: EditorHistorySession, document) {
        if (document.id === first.id) await pending;
        return originalAttach.call(this, document);
      });
    const capture = vi.spyOn(EditorHistorySession.prototype, 'capture');
    const inTransactionRef = { current: false };
    const historySkipRef = { current: false };
    const { result, rerender } = renderHook(
      ({ document }) =>
        usePersistentHistory({
          document,
          selection: [],
          patch: vi.fn(),
          inTransactionRef,
          historySkipRef,
        }),
      { initialProps: { document: first } },
    );
    try {
      await waitFor(() => expect(attach).toHaveBeenCalledOnce());
      rerender({ document: edited });
      rerender({ document: second });
      await waitFor(() => expect(result.current.session?.documentId).toBe(second.id));
      await waitFor(() => expect(result.current.attached).toBe(true));
      await act(async () => {
        finish();
        await pending;
      });
      expect(capture).not.toHaveBeenCalled();
      expect(await result.current.steps()).toHaveLength(1);
    } finally {
      attach.mockRestore();
      capture.mockRestore();
    }
  });

  it.each(['undo', 'redo', 'checkout', 'switchBranch'] as const)(
    'does not apply %s completed after switching documents',
    async (method) => {
      const first = createDocument('First', true);
      const second = createDocument('Second', true);
      let finish!: (result: { document: typeof first; selection: string[] }) => void;
      const pending = new Promise<{ document: typeof first; selection: string[] }>((resolve) => {
        finish = resolve;
      });
      const undo = vi.spyOn(EditorHistorySession.prototype, method).mockReturnValue(pending);
      const patch = vi.fn();
      const inTransactionRef = { current: false };
      const historySkipRef = { current: false };
      const { result, rerender } = renderHook(
        ({ document }) =>
          usePersistentHistory({
            document,
            selection: [],
            patch,
            inTransactionRef,
            historySkipRef,
          }),
        { initialProps: { document: first } },
      );
      try {
        await waitFor(() => expect(result.current.attached).toBe(true));
        const navigation =
          method === 'undo' || method === 'redo'
            ? result.current[method]()
            : result.current[method]('target');
        await waitFor(() => expect(undo).toHaveBeenCalledOnce());
        rerender({ document: second });
        await waitFor(() => expect(result.current.session?.documentId).toBe(second.id));
        await act(async () => {
          finish({ document: first, selection: [] });
          await navigation;
        });
        expect(patch).not.toHaveBeenCalled();
      } finally {
        undo.mockRestore();
      }
    },
  );
});
