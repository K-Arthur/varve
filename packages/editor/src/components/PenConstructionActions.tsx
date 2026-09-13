import type { PenConstructionAction, PenConstructionDraft } from '../tools/types';
import './PenConstructionActions.css';

interface PenConstructionActionsProps {
  draft: PenConstructionDraft;
  onAction: (action: PenConstructionAction) => void;
}

/**
 * Touch-accessible actions for an in-progress Pen construction.
 *
 * The buttons deliberately dispatch to PenTool rather than emulating
 * keyboard events. That keeps Finish, Close, Cancel, and Undo Anchor as
 * separate transaction semantics and keeps the canvas surface free to draw.
 */
export function PenConstructionActions({ draft, onAction }: PenConstructionActionsProps) {
  const canClose = draft.points.length > 1;
  const canUndoAnchor = draft.undoAnchorAvailable;
  const stopCanvasInteraction = (event: React.SyntheticEvent) => {
    event.stopPropagation();
  };

  return (
    <div
      className="pen-construction-actions"
      role="toolbar"
      aria-label="Pen path actions"
      onPointerDown={stopCanvasInteraction}
      onPointerMove={stopCanvasInteraction}
      onPointerUp={stopCanvasInteraction}
      onPointerCancel={stopCanvasInteraction}
    >
      <span className="pen-construction-actions__title">Pen path</span>
      <button
        type="button"
        className="pen-construction-actions__button"
        aria-label="Finish open path"
        onClick={() => onAction('finish')}
      >
        Finish
      </button>
      <button
        type="button"
        className="pen-construction-actions__button"
        aria-label="Close path"
        title={canClose ? 'Close path' : 'Add another anchor before closing'}
        disabled={!canClose}
        onClick={() => onAction('close')}
      >
        Close
      </button>
      <button
        type="button"
        className="pen-construction-actions__button"
        aria-label="Undo last anchor"
        title={canUndoAnchor ? 'Undo last anchor' : 'No new anchor to undo'}
        disabled={!canUndoAnchor}
        onClick={() => onAction('undo-anchor')}
      >
        Undo anchor
      </button>
      <button
        type="button"
        className="pen-construction-actions__button pen-construction-actions__button--cancel"
        aria-label="Cancel path"
        onClick={() => onAction('cancel')}
      >
        Cancel
      </button>
    </div>
  );
}
