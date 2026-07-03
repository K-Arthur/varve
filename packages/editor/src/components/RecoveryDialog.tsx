/**
 * RecoveryDialog — modal that lists crash-recovery sessions.
 *
 * Shows unsaved auto-save recovery points with per-session Restore/Discard
 * controls and bulk actions. Keyboard accessible with aria-live region.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { RecoverySession } from '../recovery';

export interface RecoveryDialogProps {
  open: boolean;
  sessions: RecoverySession[];
  onRestore: (id: string) => void;
  onDiscard: (id: string) => void;
  onRestoreAll: () => void;
  onDiscardAll: () => void;
  onClose: () => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function RecoveryDialog({
  open,
  sessions,
  onRestore,
  onDiscard,
  onRestoreAll,
  onDiscardAll,
  onClose,
}: RecoveryDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const prevOpen = useRef(open);

  useEffect(() => {
    if (open && !prevOpen.current) {
      dialogRef.current?.showModal();
    } else if (!open && prevOpen.current) {
      dialogRef.current?.close();
    }
    prevOpen.current = open;
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [onClose],
  );

  if (!open && sessions.length === 0) return null;

  return (
    <dialog
      ref={dialogRef}
      className="recovery-dialog"
      aria-modal="true"
      aria-label="Recover unsaved documents"
      onKeyDown={handleKeyDown}
      onClose={onClose}
    >
      <div className="recovery-dialog__header">
        <h2 className="recovery-dialog__title">Recover unsaved documents</h2>
        <p className="recovery-dialog__subtitle">
          We found auto-saved versions of documents that were open when the editor was last closed.
        </p>
        <button
          type="button"
          className="recovery-dialog__close"
          aria-label="Close"
          onClick={onClose}
        >
          &times;
        </button>
      </div>

      <div role="status" aria-live="polite" className="sr-only">
        {sessions.length > 0
          ? `${sessions.length} recovered document${sessions.length > 1 ? 's' : ''} available`
          : 'No recovered documents'}
      </div>

      {sessions.length === 0 ? (
        <div className="recovery-dialog__empty">
          <p>No recovered documents found.</p>
        </div>
      ) : (
        <div className="recovery-dialog__list">
          {sessions.map((session) => (
            <div key={session.id} className="recovery-dialog__item">
              <div className="recovery-dialog__item-info">
                <span className="recovery-dialog__item-name">{session.tabName}</span>
                <span className="recovery-dialog__item-time">{formatTime(session.timestamp)}</span>
                {session.fileId && <span className="recovery-dialog__item-file">Saved file</span>}
              </div>
              <div className="recovery-dialog__item-actions">
                <button
                  type="button"
                  className="recovery-dialog__btn recovery-dialog__btn--restore"
                  onClick={() => onRestore(session.id)}
                >
                  Restore
                </button>
                <button
                  type="button"
                  className="recovery-dialog__btn recovery-dialog__btn--discard"
                  onClick={() => onDiscard(session.id)}
                >
                  Discard
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {sessions.length > 0 && (
        <div className="recovery-dialog__footer">
          <button
            type="button"
            className="recovery-dialog__btn recovery-dialog__btn--primary"
            onClick={onRestoreAll}
          >
            Restore All
          </button>
          <button
            type="button"
            className="recovery-dialog__btn recovery-dialog__btn--secondary"
            onClick={onDiscardAll}
          >
            Discard All
          </button>
        </div>
      )}
    </dialog>
  );
}
