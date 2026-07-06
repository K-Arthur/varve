/**
 * SubjectPickerOverlay — multi-blob mask component selector.
 *
 * Shown when AI segmentation returns multiple disconnected foreground regions.
 * User toggles which subjects to keep before committing the mask.
 */

import type { MaskComponent } from '@strata/engine';
import { useCallback, useState } from 'react';

export interface SubjectPickerSession {
  nodeId: string;
  width: number;
  height: number;
  components: MaskComponent[];
  /** Component ids selected for keep (defaults to largest). */
  keepIds: number[];
  /** Pending mask data URL before component filter applied. */
  pendingMaskDataUrl: string;
  method: string;
  confidence: number;
  feather: number;
  decontaminate: boolean;
}

interface SubjectPickerOverlayProps {
  session: SubjectPickerSession;
  onConfirm: (keepIds: number[]) => void;
  onCancel: () => void;
}

export function SubjectPickerOverlay({ session, onConfirm, onCancel }: SubjectPickerOverlayProps) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(session.keepIds));

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div
      className="subject-picker-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Select subjects"
    >
      <div className="subject-picker-overlay__panel">
        <h3 className="subject-picker-overlay__title">Multiple subjects detected</h3>
        <p className="subject-picker-overlay__hint">
          Click to include or exclude each detected region ({session.components.length} found).
        </p>
        <ul className="subject-picker-overlay__list">
          {session.components.map((c, i) => {
            const checked = selected.has(c.id);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  className={`subject-picker-overlay__item ${checked ? 'subject-picker-overlay__item--selected' : ''}`}
                  onClick={() => toggle(c.id)}
                  aria-pressed={checked}
                  aria-label={`Subject ${i + 1}, ${c.pixelCount} pixels`}
                >
                  <span className="subject-picker-overlay__item-label">
                    Subject {i + 1}
                    {i === 0 ? ' (largest)' : ''}
                  </span>
                  <span className="subject-picker-overlay__item-meta">
                    {c.bbox.w}x{c.bbox.h} — {c.pixelCount}px
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="subject-picker-overlay__actions">
          <button
            type="button"
            className="button--primary"
            disabled={selected.size === 0}
            onClick={() => onConfirm([...selected])}
          >
            Keep selected ({selected.size})
          </button>
          <button type="button" className="button--ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
